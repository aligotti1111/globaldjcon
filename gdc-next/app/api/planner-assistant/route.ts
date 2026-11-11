// POST /api/planner-assistant
//
// A HOST-facing helper for the Planner & Playlist page (/planner/[id]). The
// client has no account — exactly like the planner page itself, this is scoped
// by the planner's unguessable UUID (a capability URL). Given that id, it loads
// THIS planner's fields + the booking's event context and helps the host
// understand and answer each question for their specific kind of event
// (wedding, birthday, corporate, …). It never writes answers — the host types
// those into the form — it only explains and suggests.
//
// Read-only + same-exposure: it reveals nothing the holder of the planner link
// can't already see on the planner page. No session; reads with the admin
// client, same as /planner/[id] and /pay/[id].

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  ASSISTANT_MODEL,
  ASSISTANT_MAX_TOKENS,
  ASSISTANT_MAX_MESSAGES,
  ASSISTANT_MAX_INPUT_CHARS,
} from '@/lib/djAssistant';
import { visibleFields, type PlannerField, isSection } from '@/lib/planner';
import { canBook, type AccessFields } from '@/lib/access';
import { MOB_EVENT_LABELS } from '@/lib/constants';

export const runtime = 'nodejs';

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

// Render the planner's fields the way the host sees them — section headings,
// then each question with its type, choices and helper text — so the model can
// speak to the exact form in front of them.
function formatFields(fields: PlannerField[]): string {
  const out: string[] = [];
  for (const f of fields) {
    if (isSection(f)) {
      out.push(`\n## ${f.label}`);
      continue;
    }
    let line = `- "${f.label}" (${f.type}`;
    if (f.options && f.options.length) line += `: choose from ${f.options.join(' / ')}`;
    line += ')';
    if (f.help) line += ` — ${f.help}`;
    out.push(line);
  }
  return out.join('\n');
}

export async function POST(req: Request) {
  let body: { plannerId?: string; messages?: { role?: string; content?: string }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }); }

  const plannerId = str(body?.plannerId);
  if (!/^[0-9a-f-]{36}$/i.test(plannerId)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'The assistant is not available right now.' }, { status: 503 });
  }

  // Sanitize the conversation (same shape/guards as the DJ assistant).
  const raw = Array.isArray(body?.messages) ? body.messages : [];
  const messages = raw
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
    .map((m) => ({ role: m!.role as 'user' | 'assistant', content: String(m!.content).slice(0, ASSISTANT_MAX_INPUT_CHARS) }))
    .slice(-ASSISTANT_MAX_MESSAGES);
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'No question.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const db = admin as unknown as SupabaseClient;

  const { data: pData } = await db
    .from('booking_planners')
    .select('id, booking_id, dj_id, fields, status, cancelled_at')
    .eq('id', plannerId)
    .maybeSingle();
  const planner = pData as unknown as (Row & { booking_id?: string; dj_id?: string; fields?: PlannerField[]; cancelled_at?: string | null }) | null;
  if (!planner || planner.cancelled_at) {
    return NextResponse.json({ error: 'This planner is no longer available.' }, { status: 404 });
  }

  const { data: bData } = await admin
    .from('bookings')
    .select('event_date, start_time, end_time, venue_name, event_type, event_details, requester_name')
    .eq('id', planner.booking_id as string)
    .maybeSingle();
  const booking = bData as unknown as Row | null;

  const { data: djData } = await admin
    .from('users')
    .select('name, dj_type, planner_assistant_enabled, sub_tier, sub_status, sub_period_start, sub_period_end, comp_tier, comp_expires_at, comp_source')
    .eq('id', planner.dj_id as string).maybeSingle();
  const djRow = djData as (Row & { dj_type?: string | null; planner_assistant_enabled?: boolean | null }) | null;
  const djName = str(djRow?.name) || 'your DJ';

  // Same gate the planner page uses to decide whether to show the helper: paid
  // Mobile DJ account, with the toggle not switched off. Enforced here too so the
  // endpoint can't be hit directly for a free/lapsed or opted-out account.
  const djIsMobile = str(djRow?.dj_type).toLowerCase().includes('mobile');
  const djIsPaid = canBook((djRow || {}) as unknown as AccessFields);
  const assistantOn = djRow?.planner_assistant_enabled !== false;
  if (!djIsMobile || !djIsPaid || !assistantOn) {
    return NextResponse.json({ error: 'This helper is not available.' }, { status: 403 });
  }

  const eventType = str(booking?.event_type);
  const eventLabel = (eventType && MOB_EVENT_LABELS[eventType]) || eventType || 'your event';
  const hostName = str(booking?.requester_name);
  const occasion = str(booking?.event_details);
  const venue = str(booking?.venue_name);
  const fields = visibleFields((planner.fields as PlannerField[]) ?? []);

  const system = [
    `You are the friendly Planner & Playlist helper on Global DJ Connect. You are talking to ${hostName || 'the host'} — the person who booked ${djName} — while they fill out the planner for their ${eventLabel}${occasion ? ` (${occasion})` : ''}${venue ? ` at ${venue}` : ''}.`,
    `Your job: help them fill this planner out. Explain what any question means, suggest what to put, and give concrete examples that fit a ${eventLabel} specifically (first dance songs for a wedding, kid-friendly picks for a birthday, clean/corporate vibes for a corporate event, etc.). Be warm, encouraging and concise — a sentence or two, not an essay.`,
    `You CANNOT fill the form for them or save anything — they type their own answers into the page. You can tell them exactly what to type. Never ask them to log in, create an account, or leave this page; there is nothing to sign in to.`,
    `Only help with THIS planner and the music/event details for their party. If they ask something unrelated (billing, other events, the DJ's account), gently say this helper is just for planning their event and that they can reach out to ${djName} for anything else.`,
    `When they ask about a specific question, answer for the real field below. Here is the exact planner they are filling out, section by section:`,
    formatFields(fields),
  ].join('\n\n');

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY as string,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: ASSISTANT_MODEL, max_tokens: ASSISTANT_MAX_TOKENS, system, messages }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      console.error('[planner-assistant] anthropic error', resp.status, detail.slice(0, 500));
      return NextResponse.json({ error: 'The helper is unavailable right now.' }, { status: 502 });
    }
    const data = await resp.json();
    const reply = Array.isArray(data?.content)
      ? data.content.filter((c: { type?: string }) => c?.type === 'text').map((c: { text?: string }) => c?.text || '').join('').trim()
      : '';
    return NextResponse.json({ reply: reply || "Sorry, I couldn't put that together. Try asking another way?" });
  } catch (e) {
    console.error('[planner-assistant] fetch failed', e);
    return NextResponse.json({ error: 'The helper is unavailable right now.' }, { status: 502 });
  }
}
