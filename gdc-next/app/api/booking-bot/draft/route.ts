// /api/booking-bot/draft — Phase 2 extraction.
//
// POST { slug, messages } → { draft } : pull the booking details the client gave
// the Booking Assistant into a structured object the request form can pre-fill.
// Same eligibility gate as /api/booking-bot (Premium Pro owner, bot on). This is
// a second, cheap Claude call that returns JSON only — we never trust the model
// to quote a price here; this is pure field extraction.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { effectiveTier, type AccessFields } from '@/lib/access';
import {
  BOT_MODEL, BOT_MAX_MESSAGES, BOT_MAX_INPUT_CHARS, BOT_MIN_TIER,
} from '@/lib/bookingBot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f-]{36}$/i;

interface DjRow extends AccessFields {
  id: string; role: string | null; dj_type: string | null; booking_bot_enabled: boolean | null;
}

const EXTRACT_SYSTEM = `You extract booking details from a chat between a potential client and a DJ's booking assistant.
Return ONLY a JSON object (no prose, no markdown fences) with exactly these string keys:
"eventType", "date", "startTime", "endTime", "venueName", "venueAddress", "fullName", "email", "phone", "notes".
Rules:
- Use the client's own words. Use an EMPTY STRING for anything not clearly stated. Never invent or guess.
- "date": normalize to YYYY-MM-DD only if the year/month/day are unambiguous; otherwise empty string.
- "eventType": a short label like "Wedding", "Birthday party", "Club night".
- "notes": anything else useful the client said (guest count, vibe, requests) — keep it brief.`;

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

  const djType = (row?.dj_type || '').toLowerCase();
  const eligible =
    !!row && row.role === 'dj' &&
    (djType === 'mobile' || djType === 'club') &&
    effectiveTier(row as AccessFields) >= BOT_MIN_TIER &&
    row.booking_bot_enabled === true;
  if (!eligible) return NextResponse.json({ error: 'Not available.' }, { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'Not configured.' }, { status: 503 });

  const raw = Array.isArray(body?.messages) ? body.messages : [];
  const messages = raw
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content).slice(0, BOT_MAX_INPUT_CHARS) }))
    .slice(-BOT_MAX_MESSAGES);
  if (messages.length === 0) return NextResponse.json({ error: 'Nothing to extract.' }, { status: 400 });

  // Add one trailing user turn asking for the JSON, so the model answers with it.
  const askMessages = [...messages, { role: 'user' as const, content: 'Extract the booking details now as the JSON object described.' }];

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY as string,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: BOT_MODEL, max_tokens: 400, system: EXTRACT_SYSTEM, messages: askMessages }),
    });
    if (!resp.ok) return NextResponse.json({ error: 'Extraction failed.' }, { status: 502 });
    const data = await resp.json();
    const text: string = Array.isArray(data?.content)
      ? data.content.filter((c: { type?: string }) => c?.type === 'text').map((c: { text?: string }) => c?.text || '').join('')
      : '';
    // Pull the JSON object even if the model wrapped it in fences or prose.
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : {};
    const s = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 500) : '');
    const draft = {
      eventType: s(parsed.eventType),
      date: s(parsed.date),
      startTime: s(parsed.startTime),
      endTime: s(parsed.endTime),
      venueName: s(parsed.venueName),
      venueAddress: s(parsed.venueAddress),
      fullName: s(parsed.fullName),
      email: s(parsed.email),
      phone: s(parsed.phone),
      notes: s(parsed.notes),
    };
    return NextResponse.json({ draft });
  } catch {
    return NextResponse.json({ error: 'Extraction failed.' }, { status: 502 });
  }
}
