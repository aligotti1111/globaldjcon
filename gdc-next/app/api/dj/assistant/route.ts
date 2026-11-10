// /api/dj/assistant — the DJ-facing, READ-ONLY assistant.
//
// GET  → { enabled } : is this viewer allowed to use the assistant? (paid tier,
//         not free). The widget uses this to decide whether to show itself.
// POST → { reply }   : answer the DJ's question about their own bookings /
//         earnings, or help them navigate. Loads a compact snapshot (same reads
//         the Finance page uses), hands it to Claude Haiku, returns the text.
//
// GATING: available to every PAID tier (Starter and up) — not free accounts.
// canBook() is exactly that test (live paid access with the booking suite), so
// we reuse it. The gate is enforced HERE, server-side, so a free account can't
// hit the endpoint directly and run up token cost.
//
// The model never acts — there are no tools. It only reads the snapshot and the
// navigation map baked into the system prompt (lib/djAssistant.ts).

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getActingContext, canBilling, canSettings, canManageTeam,
  canAcceptBookings, canSendContracts, canRequestDeposit, canDiscounts,
  canInvoice, canSendDocs, canEditProfile,
} from '@/lib/acting';
import { canBook, effectiveTier, TIERS, type AccessFields } from '@/lib/access';
import { effectiveTimezone, todayInTz } from '@/lib/bookingExpiry';
import {
  buildReceivedEvents,
  receivedByBooking,
  agreedTotal,
  isAccepted,
  resolveEventType,
  summarize,
  inRange,
  type FinanceBookingInput,
  type FinancePaymentInput,
} from '@/lib/finance';
import {
  ASSISTANT_MODEL,
  ASSISTANT_MAX_TOKENS,
  ASSISTANT_MAX_MESSAGES,
  ASSISTANT_MAX_INPUT_CHARS,
  buildSystemPrompt,
  formatSnapshot,
  type AssistantSnapshot,
  type BookingBrief,
} from '@/lib/djAssistant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACCESS_COLS =
  'name, slug, dj_type, timezone, role, assistant_enabled, sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, comp_source';

interface ProfileRow extends AccessFields {
  name: string | null;
  slug?: string | null;
  dj_type: string | null;
  timezone: string | null;
  role: string | null;
  // The DJ's own on/off switch for the assistant (Account Settings). Default ON
  // — only an explicit false hides it, so existing accounts keep it.
  assistant_enabled: boolean | null;
}

// Eligible = paid access AND the DJ hasn't switched it off.
function assistantEnabled(p: ProfileRow): boolean {
  return p.role !== 'host' && canBook(p as AccessFields) && p.assistant_enabled !== false;
}

// ── GET: eligibility for the widget ────────────────────────────────
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ enabled: false });

  const acting = await getActingContext(user.id);
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: p } = await admin
    .from('users').select(ACCESS_COLS).eq('id', acting.djId).maybeSingle<ProfileRow>();
  if (!p) return NextResponse.json({ enabled: false });
  return NextResponse.json({ enabled: assistantEnabled(p) });
}

// ── POST: answer a question ────────────────────────────────────────
export async function POST(req: Request) {
  try {
    return await handlePost(req);
  } catch (e) {
    // Surface the real reason instead of an opaque 500 so failures are
    // debuggable (and the widget shows something useful).
    console.error('[assistant] unhandled', e);
    return NextResponse.json(
      { error: 'Assistant error: ' + (e instanceof Error ? e.message : String(e)) },
      { status: 500 },
    );
  }
}

async function handlePost(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const acting = await getActingContext(user.id);
  const djId = acting.djId;
  const admin = createAdminClient() as unknown as SupabaseClient;

  const { data: profile } = await admin
    .from('users').select(ACCESS_COLS).eq('id', djId).maybeSingle<ProfileRow>();
  if (!profile || !assistantEnabled(profile)) {
    return NextResponse.json({ error: 'The assistant is unavailable.' }, { status: 403 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'Assistant is not configured yet.' }, { status: 503 });
  }

  // Parse + sanitize the conversation.
  let body: { messages?: { role?: string; content?: string }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }); }
  const raw = Array.isArray(body?.messages) ? body.messages : [];
  const messages = raw
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content).slice(0, ASSISTANT_MAX_INPUT_CHARS) }))
    .slice(-ASSISTANT_MAX_MESSAGES);
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'No question.' }, { status: 400 });
  }

  // ── Load the snapshot (same shape as the Finance page) ──
  const { data: bRows } = await admin
    .from('bookings')
    .select('id, event_date, start_time, end_time, status, accepted_at, event_type, booking_type, venue_name, contract_status, tax_amount, total_with_tax, counter_rate, quoted_rate, offer_amount, currency, overtime_amount, overtime_tax, overtime_paid_at, deposit_amount, deposit_pct, deposit_completed_at, balance_completed_at, status_overrides, is_manual')
    .eq('dj_id', djId)
    .is('deleted_at', null)
    .limit(2000);
  const allBookings = (bRows || []) as (FinanceBookingInput & {
    venue_name: string | null; contract_status: string | null;
    deposit_completed_at: string | null; balance_completed_at: string | null; status: string | null;
    event_date: string | null; booking_type: string | null;
  })[];

  const ids = allBookings.map((b) => b.id);
  let payments: FinancePaymentInput[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    if (chunk.length === 0) break;
    const { data: pRows } = await admin
      .from('booking_payments')
      .select('id, booking_id, kind, amount, amount_paid, status, method, currency, confirmed_at, requested_at, marked_sent_at, due_date')
      .in('booking_id', chunk);
    payments = payments.concat((pRows || []) as FinancePaymentInput[]);
  }

  const tz = effectiveTimezone(profile.timezone, null);
  const today = todayInTz(tz);
  const receivedMap = receivedByBooking(allBookings, payments);

  const toBrief = (b: typeof allBookings[number]): BookingBrief => {
    const agreed = agreedTotal(b);
    const received = receivedMap.get(b.id) || 0;
    return {
      date: (b.event_date || '').slice(0, 10) || null,
      eventType: resolveEventType(b),
      venue: b.venue_name || null,
      host: null,
      status: b.is_manual ? 'manual' : (b.status || 'unknown'),
      agreed,
      received,
      outstanding: Math.max(0, Math.round((agreed - received) * 100) / 100),
      currency: (b.currency || 'USD'),
      contract: b.contract_status || null,
      depositPaid: !!b.deposit_completed_at,
      balancePaid: !!b.balance_completed_at,
    };
  };

  // "Upcoming bookings" = CONFIRMED only — exactly what the dashboard shows.
  // isAccepted() = approved or manual, never pending/declined/cancelled. A
  // pending request is not a booking yet; it lives on /booking-requests.
  const upcoming = allBookings
    .filter((b) => isAccepted(b) && (b.event_date || '').slice(0, 10) >= today)
    .sort((a, z) => (a.event_date || '').localeCompare(z.event_date || ''))
    .slice(0, 40)
    .map(toBrief);

  const recentPast = allBookings
    .filter((b) => (b.event_date || '').slice(0, 10) < today && isAccepted(b))
    .sort((a, z) => (z.event_date || '').localeCompare(a.event_date || ''))
    .slice(0, 10)
    .map(toBrief);

  // Pending requests awaiting the DJ's approval — future, status 'pending'.
  // Surfaced separately so the assistant can mention them as a side note
  // without ever calling them a confirmed booking.
  const pendingRequests = allBookings
    .filter((b) => (b.status || '') === 'pending' && (b.event_date || '').slice(0, 10) >= today)
    .sort((a, z) => (a.event_date || '').localeCompare(z.event_date || ''))
    .slice(0, 20)
    .map(toBrief);

  // Finance totals — owner only (teammates never see money).
  let finance: AssistantSnapshot['finance'] = null;
  if (canBilling(acting.role)) {
    const events = buildReceivedEvents(allBookings, payments, today);
    const monthStart = today.slice(0, 7) + '-01';
    const yearStart = today.slice(0, 4) + '-01-01';
    const month = summarize(inRange(events, monthStart, today));
    const year = summarize(inRange(events, yearStart, today));
    let outstandingTotal = 0;
    let owingCount = 0;
    for (const b of allBookings) {
      if (!isAccepted(b)) continue;
      const out = Math.max(0, agreedTotal(b) - (receivedMap.get(b.id) || 0));
      if (out > 0.01) { outstandingTotal += out; owingCount += 1; }
    }
    finance = {
      receivedThisMonth: month.gross,
      receivedThisYear: year.gross,
      outstandingTotal: Math.round(outstandingTotal * 100) / 100,
      owingCount,
      currency: 'USD',
    };
  }

  const djType = ((): AssistantSnapshot['djType'] => {
    const t = (profile.dj_type || '').toLowerCase();
    if (t.includes('club') || t.includes('bar')) return 'club';
    if (t.includes('mobile')) return 'mobile';
    if (t.includes('both')) return 'both';
    return 'unknown';
  })();

  const snapshot: AssistantSnapshot = {
    djName: profile.name || 'DJ',
    today,
    djType,
    upcoming,
    pendingRequests,
    recentPast,
    finance,
  };

  // This DJ's own current plan — so the assistant answers "how many photos can I
  // add?" etc. with THEIR exact caps, not just the generic table.
  const myTier = effectiveTier(profile as AccessFields);
  const td = TIERS[myTier];
  const planLine = `\n\nTHIS DJ'S CURRENT PLAN: ${td.label}${td.monthlyPrice ? ` ($${td.monthlyPrice}/mo)` : ' (free)'}. Their media caps: ${td.photos} photos, ${td.videos} videos, ${td.mixes} mixes. Contracts: ${td.contractQuota}/billing cycle. Team seats: ${td.seats}. When they ask about their own limits, use THESE numbers; to raise a cap they upgrade at /subscribe.`;

  // The DJ's own profile slug — so the assistant can give a CLICKABLE link to
  // their availability calendar (and the right month) instead of describing a path.
  const mySlug = String((profile as unknown as { slug?: string | null }).slug || '').trim();
  const profileLine = mySlug
    ? `\n\nYOUR OWN PROFILE PAGE: /${mySlug} . Your booking calendar is /${mySlug}?tab=booking . To send the DJ to edit a day, their pricing, or availability, give a CLICKABLE markdown link to this — and when they name a specific date, deep-link to its month with &date=YYYY-MM-DD, e.g. [open your booking calendar on November 30](/${mySlug}?tab=booking&date=2026-11-30). Then they tap that day → "Edit day." Always prefer a clickable link to the booking calendar over telling them where to click.`
    : '';

  // Who is actually using the assistant. Teammates act under the DJ's account
  // but only within their seat's permissions — the assistant must respect that
  // and never route them to areas they can't open, or reveal owner-only data.
  const r = acting.role;
  const yn = (ok: boolean, restriction: string) => (ok ? 'ALLOWED' : `NOT ALLOWED — ${restriction}`);
  const rolePerm = acting.isMember
    ? [
        `\n\nWHO YOU ARE TALKING TO: a TEAMMATE on ${snapshot.djName}'s account, with the "${r}" role — NOT the owner. Honor their permissions strictly:`,
        `- Finance / earnings / payout totals: ${yn(canBilling(r), 'OWNER-ONLY. You have no finance data for them; if they ask about money totals or earnings, say it is limited to the account owner and you cannot show it.')}`,
        `- Billing / subscription / plan changes (/subscribe): OWNER-ONLY — never tell a teammate to change the plan or go to billing; say the owner handles that.`,
        `- Manage Team (invite/remove teammates, roles): ${yn(canManageTeam(r), 'owner/admin only; do not send them to Team settings.')}`,
        `- Settings (Booking Settings, Account Settings tabs like pricing/deposits/payment methods/tax): ${yn(canSettings(r), 'manager+ only; do not send them to Booking Settings or Account Settings to change these.')}`,
        `- Accept / deny / counter booking requests, add manual bookings: ${yn(canAcceptBookings(r), 'manager+ only.')}`,
        `- Send contracts: ${yn(canSendContracts(r), 'manager+ only.')}`,
        `- Request deposits / change money state: ${yn(canRequestDeposit(r), 'manager+ only.')}`,
        `- Discounts / promo codes: ${yn(canDiscounts(r), 'manager+ only.')}`,
        `- Send invoices / receipts: ${yn(canInvoice(r), 'not permitted for this seat.')}`,
        `- Send documents (planner, playlist, rider, guest list, flyer): ${yn(canSendDocs(r), 'not permitted for this seat.')}`,
        `- Edit the public profile (non-booking tabs): ${yn(canEditProfile(r), 'not permitted for this seat.')}`,
        `HARD RULE: Only guide the teammate through actions marked ALLOWED above, and only link them to pages those actions live on. For anything NOT ALLOWED, do NOT give steps, do NOT link the page, and do NOT reveal owner-only figures — briefly say it is outside their access and the account owner handles it. Never help a teammate get around their permissions.`,
      ].join('\n')
    : '';

  const system = buildSystemPrompt(snapshot.djName) + '\n\n' + formatSnapshot(snapshot) + planLine + profileLine + rolePerm;

  // ── Call Anthropic (no SDK dependency — plain REST) ──
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY as string,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ASSISTANT_MODEL,
        max_tokens: ASSISTANT_MAX_TOKENS,
        system,
        messages,
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      console.error('[assistant] anthropic error', resp.status, detail.slice(0, 500));
      return NextResponse.json({ error: 'The assistant is unavailable right now.' }, { status: 502 });
    }
    const data = await resp.json();
    const reply = Array.isArray(data?.content)
      ? data.content.filter((c: { type?: string }) => c?.type === 'text').map((c: { text?: string }) => c?.text || '').join('').trim()
      : '';
    return NextResponse.json({ reply: reply || "Sorry, I couldn't put together an answer. Try rephrasing?" });
  } catch (e) {
    console.error('[assistant] fetch failed', e);
    return NextResponse.json({ error: 'The assistant is unavailable right now.' }, { status: 502 });
  }
}
