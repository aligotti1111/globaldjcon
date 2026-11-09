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
  priceRangeFor, buildBotSystemPrompt,
  cookieName, makeCookieValue, readCookieCount,
} from '@/lib/bookingBot';

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

  // What this DJ requires — so the bot can answer deposit/contract questions.
  const s = settings as unknown as Record<string, unknown>;
  const depRaw = djType === 'club' ? s.deposit_pct : s.mob_deposit_pct;
  const depositPct = Math.max(0, Math.round(Number(depRaw) || 0));
  const requireContract = s.require_contract === true;

  const system = buildBotSystemPrompt(
    row.name || 'this DJ', djType, range, faqText(row.faqs),
    row.booking_bot_instructions || '', row.phone || '',
    { depositPct, requireContract },
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
      body: JSON.stringify({ model: BOT_MODEL, max_tokens: BOT_MAX_TOKENS, system, messages }),
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
