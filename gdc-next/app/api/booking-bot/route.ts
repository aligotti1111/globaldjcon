// /api/booking-bot — the PUBLIC, booker-facing profile assistant.
//
// POST { slug, messages } → { reply } | { locked: true, reply } | { error }
//
// Lives only on a DJ's public profile. Answers a potential client's questions,
// quotes a price RANGE from that DJ's packages (mobile) or hourly/flat rate
// (club), and collects booking details. It never quotes exact, confirms a date,
// or takes payment.
//
// GATING (all server-side):
//   • The profile owner is a DJ, mobile or club type.
//   • Their tier is Premium Pro or higher (BOT_MIN_TIER).
//   • They switched the bot on (booking_bot_enabled).
//
// FREE-MESSAGE WALL: an anonymous visitor gets BOT_FREE_MESSAGES answers; after
// that the route returns { locked: true } with a "create an account" message and
// stops calling the model. The count is kept in a signed cookie so clearing the
// chat can't reset it. Logged-in users (hosts) skip the wall.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { effectiveTier, type AccessFields } from '@/lib/access';
import { parseBookingSettings } from '@/app/(main)/[slug]/bookingSettings';
import type { Faq } from '@/app/(main)/[slug]/profileTypes';
import {
  BOT_MODEL, BOT_MAX_TOKENS, BOT_MAX_MESSAGES, BOT_MAX_INPUT_CHARS,
  BOT_FREE_MESSAGES, BOT_MIN_TIER,
  priceRangeFor, buildBotSystemPrompt, mobilePackagesText,
  cookieName, makeCookieValue, readCookieCount,
} from '@/lib/bookingBot';
import { usableMethods, METHOD_TYPES, type PaymentMethod } from '@/lib/paymentMethods';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f-]{36}$/i;

interface DjRow extends AccessFields {
  id: string;
  role: string | null;
  name: string | null;
  dj_type: string | null;
  booking_bot_enabled: boolean | null;
  booking_bot_instructions: string | null;
  phone: string | null;
  faqs: string | null;
  booking_settings: unknown;
}

function cookieFromReq(req: Request, name: string): string | undefined {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

function faqText(raw: string | null): string {
  if (!raw) return '';
  try {
    const arr = JSON.parse(raw) as Faq[];
    if (!Array.isArray(arr)) return '';
    return arr
      .filter((f) => f && (f.question || f.answer))
      .slice(0, 20)
      .map((f) => `Q: ${(f.question || '').trim()}\nA: ${(f.answer || '').trim()}`)
      .join('\n\n')
      .slice(0, 3000);
  } catch { return ''; }
}

export async function POST(req: Request) {
  let body: { slug?: string; messages?: { role?: string; content?: string }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }); }
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
  if (!slug) return NextResponse.json({ error: 'Missing profile.' }, { status: 400 });

  const admin = createAdminClient() as unknown as SupabaseClient;
  const q = UUID_RE.test(slug)
    ? admin.from('users').select('*').eq('id', slug)
    : admin.from('users').select('*').eq('slug', slug);
  const { data: row } = await q.maybeSingle<DjRow>();

  // Eligibility — any failure means "no bot here"; keep the message generic.
  const djType = (row?.dj_type || '').toLowerCase();
  const eligible =
    !!row && row.role === 'dj' &&
    (djType === 'mobile' || djType === 'club') &&
    effectiveTier(row as AccessFields) >= BOT_MIN_TIER &&
    row.booking_bot_enabled === true;
  if (!eligible || !row) {
    return NextResponse.json({ error: 'The assistant is not available for this profile.' }, { status: 403 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'Assistant is not configured yet.' }, { status: 503 });
  }

  // Is the visitor signed in? Logged-in users skip the free-message wall.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const anon = !user;

  const cname = cookieName(row.id);
  const used = anon ? readCookieCount(row.id, cookieFromReq(req, cname)) : 0;

  // Hit the wall: stop before calling the model.
  if (anon && used >= BOT_FREE_MESSAGES) {
    return NextResponse.json({
      locked: true,
      reply: `Thanks for your interest! To keep chatting with ${row.name || 'this DJ'} and start your booking request, please create a free account.`,
    });
  }

  // Sanitize the conversation.
  const raw = Array.isArray(body?.messages) ? body.messages : [];
  const messages = raw
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content).slice(0, BOT_MAX_INPUT_CHARS) }))
    .slice(-BOT_MAX_MESSAGES);
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'No message.' }, { status: 400 });
  }

  const settings = parseBookingSettings(row.booking_settings);
  const range = priceRangeFor(djType, settings);

  // What this DJ requires — so the bot can answer deposit/contract/equipment questions.
  const s = settings as unknown as Record<string, unknown>;
  const depRaw = djType === 'club' ? s.deposit_pct : s.mob_deposit_pct;
  const depositPct = Math.max(0, Math.round(Number(depRaw) || 0));
  const requireContract = s.require_contract === true;

  // Accepted payment methods (so the bot can answer cash/check/"how can I pay").
  const rp = row as unknown as Record<string, unknown>;
  const pmList = Array.isArray(rp.payment_methods) ? (rp.payment_methods as PaymentMethod[]) : [];
  const labels = usableMethods(pmList).map((m) => METHOD_TYPES[m.type]?.label || m.type);
  if (rp.stripe_connect_ready === true && !labels.includes('Card')) labels.push('Card');
  const payments = Array.from(new Set(labels)).join(', ');

  // Equipment / sound: what the DJ provides vs. needs from the venue.
  const detail = (v: unknown) => { const t = String(v ?? '').trim(); return t ? ` (${t})` : ''; };
  let equipment = '';
  if (s.equip_full === true) {
    equipment = `${row.name || 'This DJ'} provides a full sound system (speakers) AND decks/controller — they bring the gear${detail(s.equip_full_detail)}.`;
  } else if (s.equip_decks === true) {
    equipment = `${row.name || 'This DJ'} brings their own decks/controller only — the venue/host provides the sound system (speakers)${detail(s.equip_decks_detail)}.`;
  } else if (s.equip_none === true) {
    equipment = `${row.name || 'This DJ'} needs all equipment provided by the venue/host (they don't bring gear)${detail(s.equip_none_detail)}.`;
  }

  const packages = settings ? mobilePackagesText(djType, settings) : '';

  // How far ahead this DJ accepts bookings — so the bot refuses dates past the
  // window and doesn't promise availability it can't see. Falls back to the
  // same defaults the public calendar uses (club 12 months, mobile 24).
  const winRaw = djType === 'club' ? s.booking_window_months : (s.mob_booking_window_months ?? s.booking_window_months);
  const windowMonths = Math.max(1, Math.round(Number(winRaw) || (djType === 'club' ? 12 : 24)));
  const tz = String(rp.timezone || '').trim() || 'America/New_York';
  let todayLabel = '';
  let cutoffLabel = '';
  try {
    const now = new Date();
    todayLabel = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', day: 'numeric', year: 'numeric' }).format(now);
    const cutoff = new Date(now.getFullYear(), now.getMonth() + windowMonths, now.getDate());
    cutoffLabel = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', year: 'numeric' }).format(cutoff);
  } catch { /* bad tz — labels stay empty, window months still apply */ }

  // Which dates are NOT available — so the bot can tell a booker a date is taken
  // instead of happily collecting details for it. A date is unavailable if the
  // DJ marked it booked/unavailable in their calendar, OR it's full from approved
  // bookings (club = any approved; mobile = approved count >= that day's capacity).
  const todayISO = (() => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); } })();
  const blockedSet = new Set<string>();
  const dayMap = (djType === 'club' ? s.booking_days : s.mob_booking_days) as Record<string, { booked?: boolean; unavailable?: boolean; bookings_available?: number }> | undefined;
  const capacityFor = (dk: string): number => {
    if (djType === 'club') return 1;
    const c = dayMap?.[dk]?.bookings_available;
    return typeof c === 'number' && c > 0 ? c : 1;
  };
  if (dayMap && typeof dayMap === 'object') {
    for (const [dk, v] of Object.entries(dayMap)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dk) && dk >= todayISO && (v?.booked === true || v?.unavailable === true)) blockedSet.add(dk);
    }
  }
  try {
    const { data: appr } = await admin
      .from('bookings')
      .select('event_date')
      .eq('dj_id', row.id)
      .eq('status', 'approved')
      .gte('event_date', todayISO);
    const counts = new Map<string, number>();
    for (const b of (appr || []) as { event_date?: string }[]) {
      const dk = String(b?.event_date || '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(dk)) counts.set(dk, (counts.get(dk) || 0) + 1);
    }
    for (const [dk, n] of counts) { if (n >= capacityFor(dk)) blockedSet.add(dk); }
  } catch { /* booked-date lookup is best-effort */ }
  // Only carry the next ~12 months of blocked dates into the prompt — that's the
  // window a booker realistically asks about, and it keeps the (repeated-every-
  // turn) system prompt small. Further-out conflicts are caught by the DJ's
  // approval + the live calendar.
  const horizonISO = (() => { const d = new Date(); d.setMonth(d.getMonth() + 12); try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d); } catch { return d.toISOString().slice(0, 10); } })();
  const blockedDates = Array.from(blockedSet).filter((d) => d <= horizonISO).sort().join(', ');

  // The DJ's public About section: bio + the quick-fact cards they turned on.
  const rr0 = row as unknown as Record<string, unknown>;
  const aboutLines: string[] = [];
  const bio = String(rr0.bio ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (bio) aboutLines.push(`Bio: ${bio.slice(0, 800)}`);
  try {
    const st = typeof rr0.about_stats === 'string' ? JSON.parse(rr0.about_stats) : (rr0.about_stats || {});
    const on = (c: unknown): c is Record<string, unknown> => !!c && typeof c === 'object' && (c as Record<string, unknown>).on === true;
    const push = (label: string, v: unknown) => { const t = String(v ?? '').trim(); if (t) aboutLines.push(`${label}: ${t}`); };
    if (on(st.established)) push('Established', (st.established as Record<string, unknown>).year);
    if (on(st.events)) push('Events experience', (st.events as Record<string, unknown>).tier);
    if (on(st.eventsTotal)) push('Total events', (st.eventsTotal as Record<string, unknown>).count);
    if (on(st.insured)) push('Insured', (st.insured as Record<string, unknown>).answer);
    if (on(st.destination)) push('Destination events', (st.destination as Record<string, unknown>).answer);
    if (on(st.backup)) push('Backup equipment', (st.backup as Record<string, unknown>).answer);
    if (on(st.ownEquipment)) push('Owns equipment', (st.ownEquipment as Record<string, unknown>).answer);
    if (on(st.residencies)) push('Residencies', (st.residencies as Record<string, unknown>).text || (st.residencies as Record<string, unknown>).answer);
    if (on(st.mixer)) push('Preferred mixer', (st.mixer as Record<string, unknown>).text);
    if (on(st.decks)) push('Preferred decks', (st.decks as Record<string, unknown>).text);
    if (on(st.goToFormat)) push('Go-to format', (st.goToFormat as Record<string, unknown>).value);
    if (on(st.followers)) push('Social following', (st.followers as Record<string, unknown>).count);
  } catch { /* ignore malformed about_stats */ }
  const about = aboutLines.join('\n').slice(0, 1500);

  // Discount date-exclusions: dates where the sale and/or promo codes don't apply.
  const exclRaw = Array.isArray(s.exclusions) ? (s.exclusions as Array<Record<string, unknown>>) : [];
  const exclusions = exclRaw
    .filter((e) => e && typeof e.date === 'string')
    .map((e) => {
      const what = e.sale && e.codes ? 'sale & promo codes' : e.sale ? 'the sale' : e.codes ? 'promo codes' : 'discounts';
      return `${e.date} (${what} excluded)`;
    })
    .slice(0, 30)
    .join('; ');

  // Travel / service area: base location + how far the DJ travels.
  const rr = row as unknown as Record<string, unknown>;
  const base = [rr.city, rr.state].map((v) => String(v ?? '').trim()).filter(Boolean).join(', ');
  const td = String(rr.travel_distance ?? '').trim().toLowerCase();
  let travel = '';
  if (td === 'worldwide') {
    travel = `${row.name || 'This DJ'}${base ? ` is based in ${base} and` : ''} travels worldwide (available anywhere).`;
  } else if (Number(td) > 0) {
    travel = `${row.name || 'This DJ'}${base ? ` is based in ${base} and` : ''} travels up to ${Number(td)} miles for events.`;
  } else if (base) {
    travel = `${row.name || 'This DJ'} is based in ${base}.`;
  }

  // If the visitor is signed in AND has their OWN booking(s) with THIS DJ, pull a
  // short summary so the bot can help them with what they already booked. Scoped
  // to requester_id === their user id and dj_id === this DJ (their data only).
  let existingBooking = '';
  if (user) {
    const { data: mine } = await admin
      .from('bookings')
      .select('id, event_date, start_time, end_time, event_type, package_title, package_details, status, deposit_pct, deposit_amount, total_with_tax, currency, contract_status, planner_status')
      .eq('requester_id', user.id)
      .eq('dj_id', row.id)
      .order('event_date', { ascending: false })
      .limit(3);
    const rows = Array.isArray(mine) ? mine : [];
    if (rows.length) {
      // Pull payment requests for these bookings so the bot knows whether the
      // deposit/balance has been REQUESTED yet (a payments row exists) and its
      // state. 'requested'/'pending' = sent, not fully paid; 'paid' = done.
      const ids = rows.map((b) => (b as Record<string, unknown>).id).filter(Boolean);
      const payByBooking: Record<string, { deposit?: string; balance?: string }> = {};
      if (ids.length) {
        const { data: pays } = await admin
          .from('payments')
          .select('booking_id, kind, status')
          .in('booking_id', ids as string[]);
        for (const p of (Array.isArray(pays) ? pays : [])) {
          const pr = p as Record<string, unknown>;
          const bid = String(pr.booking_id);
          const k = String(pr.kind);
          if (k !== 'deposit' && k !== 'balance') continue;
          (payByBooking[bid] ||= {})[k as 'deposit' | 'balance'] = String(pr.status);
        }
      }
      const payWord = (s?: string) => !s ? 'not requested yet' : (s === 'paid' ? 'paid' : (s === 'waived' ? 'waived' : 'requested (awaiting payment)'));
      const strip = (h: unknown) => String(h ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
      existingBooking = rows.map((b) => {
        const r = b as Record<string, unknown>;
        const pay = payByBooking[String(r.id)] || {};
        const bits: string[] = [];
        bits.push(`Date: ${r.event_date || 'TBD'}${r.start_time ? ` ${r.start_time}${r.end_time ? `–${r.end_time}` : ''}` : ''}`);
        if (r.event_type) bits.push(`Event: ${r.event_type}`);
        if (r.package_title) bits.push(`Package: ${r.package_title}`);
        const det = strip(r.package_details).slice(0, 400);
        if (det) bits.push(`Includes: ${det}`);
        if (r.status) bits.push(`Status: ${r.status}`);
        if (r.contract_status) bits.push(`Contract: ${r.contract_status}`);
        if (r.planner_status) bits.push(`Planner: ${r.planner_status}`);
        const ccy = String(r.currency || 'USD');
        if (Number(r.total_with_tax) > 0) bits.push(`Total: ${ccy} ${Math.round(Number(r.total_with_tax))}`);
        bits.push(`Deposit: ${payWord(pay.deposit)}`);
        bits.push(`Balance: ${payWord(pay.balance)}`);
        return '- ' + bits.join(' · ');
      }).join('\n');
    }
  }

  const system = buildBotSystemPrompt(
    row.name || 'this DJ', djType, range, faqText(row.faqs),
    row.booking_bot_instructions || '', row.phone || '',
    { depositPct, requireContract, equipment, packages, exclusions, travel, payments, windowMonths, todayLabel, cutoffLabel, blockedDates }, existingBooking, about,
  );

  let reply = '';
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY as string,
        'anthropic-version': '2023-06-01',
      },
      // Cache the (large, repeated-every-turn) system prompt so follow-up
      // messages in the same conversation re-read it at ~1/10th the input cost.
      // No effect on output quality — identical tokens, just billed as a cache read.
      body: JSON.stringify({
        model: BOT_MODEL,
        max_tokens: BOT_MAX_TOKENS,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages,
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      console.error('[booking-bot] anthropic error', resp.status, detail.slice(0, 400));
      return NextResponse.json({ error: 'The assistant is unavailable right now.' }, { status: 502 });
    }
    const data = await resp.json();
    reply = Array.isArray(data?.content)
      ? data.content.filter((c: { type?: string }) => c?.type === 'text').map((c: { text?: string }) => c?.text || '').join('').trim()
      : '';
  } catch (e) {
    console.error('[booking-bot] fetch failed', e);
    return NextResponse.json({ error: 'The assistant is unavailable right now.' }, { status: 502 });
  }

  const res = NextResponse.json({
    reply: reply || "Sorry, I didn't catch that — could you rephrase?",
    // How many free messages are left after this one (anon only).
    remaining: anon ? Math.max(0, BOT_FREE_MESSAGES - (used + 1)) : null,
  });

  // Count this answer against the anon allowance.
  if (anon) {
    res.cookies.set(cname, makeCookieValue(row.id, used + 1), {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7,
    });
  }
  return res;
}
