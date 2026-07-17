// PATCH/POST /api/planner/[id]
//
// The client's autosave and submit. NO SESSION — a client filling in a planner
// has no GDC account and never will. The unguessable id IS the credential,
// exactly like /pay/[id] and the DocuSeal signing link.
//
// Which means this route is the only thing standing between a stranger with a
// link and the database. Everything below that looks paranoid is load-bearing.
//
// CLOUDFLARE EATS 502s. An origin 502 has its body discarded and replaced with
// Cloudflare's own "Bad gateway" HTML — so the client sees markup where JSON
// should be and the fetch throws on parse. Never return 502 from this app; 500
// passes through. (Same rule as /api/stripe/connect.)

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  visibleFields,
  type PlannerField,
  type PlannerResponses,
  type PlannerResponse,
} from '@/lib/planner';

export const runtime = 'nodejs';
// Per-planner state. Must never be cached or prerendered.
export const dynamic = 'force-dynamic';

// ── Caps ──────────────────────────────────────────────────────────────────
// A booking_planners row is ONE booking's answers, not a bucket. Without caps
// the capability URL is an unauthenticated write endpoint with no ceiling.
const MAX_TEXT = 200;
const MAX_LONGTEXT = 5000;
const MAX_URL = 2000;
const MAX_LIST_ROWS = 100;
const MAX_BODY_BYTES = 256 * 1024;

interface PlannerRow {
  id: string;
  status: string;
  fields: PlannerField[];
  responses: PlannerResponses;
}

const clamp = (s: unknown, max: number): string =>
  typeof s === 'string' ? s.slice(0, max) : '';

/**
 * Rebuild every value from scratch against the field's declared type.
 *
 * NOT validation — construction. We never store what the client sent; we store
 * what we built from it. A `song` becomes exactly {title, artist, source, ...}
 * with nothing else along for the ride, whatever arrived.
 *
 * The alternative — check the shape then store the original object — leaves
 * whatever extra keys they attached sitting in jsonb, to be rendered later by
 * a component that trusts the type.
 */
function sanitise(field: PlannerField, raw: unknown): unknown {
  // Only ever http(s). A `javascript:` url here becomes an href on the DJ's
  // panel — a stored XSS with a human trigger.
  const webUrl = (v: unknown): string | undefined =>
    typeof v === 'string' && /^https?:\/\//i.test(v) ? v.slice(0, MAX_URL) : undefined;
  const httpsUrl = (v: unknown): string | undefined =>
    typeof v === 'string' && /^https:\/\//i.test(v) ? v.slice(0, MAX_URL) : undefined;

  const track = (t: unknown) => {
    const o = (t ?? {}) as Record<string, unknown>;
    const src =
      o.source === 'catalogue' || o.source === 'link' || o.source === 'spotify'
        ? o.source
        : 'manual';
    const out: Record<string, unknown> = {
      title: clamp(o.title, MAX_TEXT),
      ...(o.artist ? { artist: clamp(o.artist, MAX_TEXT) } : {}),
      source: src,
      ...(o.spotify_id ? { spotify_id: clamp(o.spotify_id, 64) } : {}),
      ...(o.deezer_id ? { deezer_id: clamp(o.deezer_id, 64) } : {}),
    };
    // Every url rebuilt through the same guard. These come from our own search
    // route, but they arrive here via the CLIENT — so they're client input, and
    // a picked track is exactly as untrusted as a typed one.
    const url = webUrl(o.url);
    if (url) out.url = url;
    const art = httpsUrl(o.album_art);
    if (art) out.album_art = art;
    // The preview mp3 the client actually heard, and the DJ's resolved links.
    // https only: an http mp3 is a mixed-content block on our page anyway.
    const preview = httpsUrl(o.preview);
    if (preview) out.preview = preview;
    const sp = httpsUrl(o.spotify_url);
    if (sp) out.spotify_url = sp;
    const ap = httpsUrl(o.apple_url);
    if (ap) out.apple_url = ap;
    const yt = httpsUrl(o.youtube_url);
    if (yt) out.youtube_url = yt;
    return out;
  };

  switch (field.type) {
    case 'text':
    case 'time':
    case 'select':
      return clamp(raw, MAX_TEXT);
    case 'longtext':
      return clamp(raw, MAX_LONGTEXT);
    case 'yesno':
      return raw === true;
    case 'link':
      return typeof raw === 'string' && /^https?:\/\//i.test(raw)
        ? raw.slice(0, MAX_URL) : '';
    case 'song':
      return track(raw);
    case 'songlist':
      return Array.isArray(raw) ? raw.slice(0, MAX_LIST_ROWS).map(track) : [];
    case 'textlist':
      return Array.isArray(raw)
        ? raw.slice(0, MAX_LIST_ROWS).map((s) => clamp(s, MAX_TEXT)).filter(Boolean)
        : [];
    case 'people':
      return Array.isArray(raw)
        ? raw.slice(0, MAX_LIST_ROWS).map((p) => {
            const o = (p ?? {}) as Record<string, unknown>;
            return {
              name: clamp(o.name, MAX_TEXT),
              ...(o.role ? { role: clamp(o.role, MAX_TEXT) } : {}),
              ...(o.pronunciation ? { pronunciation: clamp(o.pronunciation, MAX_TEXT) } : {}),
            };
          })
        : [];
    case 'timeline':
      return Array.isArray(raw)
        ? raw.slice(0, MAX_LIST_ROWS).map((r) => {
            const o = (r ?? {}) as Record<string, unknown>;
            return {
              ...(o.time ? { time: clamp(o.time, 8) } : {}),
              ...(o.label ? { label: clamp(o.label, MAX_TEXT) } : {}),
            };
          })
        : [];
    default:
      return null;
  }
}

/**
 * Merge what they sent into what's stored, field by field.
 *
 * Keyed off the SNAPSHOT (row.fields), not off the request. An id we don't
 * recognise is dropped silently — the client can't invent questions (spec §7),
 * and without this check the capability URL lets anyone write arbitrary keys
 * into our jsonb.
 *
 * Hidden fields are dropped too: they aren't rendered, so an answer to one
 * didn't come from the form.
 */
function mergeResponses(
  row: PlannerRow,
  incoming: Record<string, unknown>,
): PlannerResponses {
  const allowed = new Map(visibleFields(row.fields ?? []).map((f) => [f.id, f]));
  const next: PlannerResponses = { ...(row.responses ?? {}) };

  for (const [id, val] of Object.entries(incoming)) {
    const field = allowed.get(id);
    if (!field) continue;                       // unknown or hidden — drop it

    const v = val as Record<string, unknown> | null;

    // N/A is an answer, and it's the only one that isn't a value.
    if (v && typeof v === 'object' && (v as { na?: unknown }).na === true) {
      next[id] = { na: true };
      continue;
    }
    // Clearing a field: back to unanswered, not to an empty answer.
    if (v === null || v === undefined) {
      delete next[id];
      continue;
    }
    const inner = v && typeof v === 'object' && 'value' in v
      ? (v as { value: unknown }).value
      : val;
    next[id] = { value: sanitise(field, inner) } as PlannerResponse;
  }
  return next;
}

async function load(db: SupabaseClient, id: string): Promise<PlannerRow | null> {
  const { data } = await db
    .from('booking_planners')
    .select('id, status, fields, responses')
    .eq('id', id)
    .maybeSingle();
  return (data as unknown as PlannerRow | null) ?? null;
}

/** PATCH — autosave. Body: { responses: { [fieldId]: {value}|{na:true}|null } } */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }

    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Too large.' }, { status: 413 });
    }
    let body: { responses?: Record<string, unknown> } = {};
    try { body = JSON.parse(text); } catch {
      return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
    }
    if (!body.responses || typeof body.responses !== 'object') {
      return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
    }

    const db = createAdminClient() as unknown as SupabaseClient;
    const row = await load(db, id);
    // 404, not 403 — "this planner exists but you can't have it" tells a
    // stranger their guess was right.
    if (!row) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

    const responses = mergeResponses(row, body.responses);

    // sent → partial on the first real keystroke. Never walk BACK from
    // submitted: a client tidying an answer after submitting hasn't unsubmitted.
    const status = row.status === 'submitted' ? 'submitted' : 'partial';

    const { error } = await db
      .from('booking_planners')
      .update({ responses, status } as unknown as never)
      .eq('id', id);
    if (error) {
      return NextResponse.json({ error: 'Could not save.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, status });
  } catch {
    // 500, never 502 — see the header.
    return NextResponse.json({ error: 'Could not save.' }, { status: 500 });
  }
}

/**
 * POST — submit, OR a beacon save.
 *
 * Body: { responses?, submit?: boolean }
 *
 * TWO CALLERS, AND THE FLAG IS WHY:
 *
 *  1. the Send button           → { responses, submit: true }
 *  2. navigator.sendBeacon      → { responses, submit: false }
 *
 * The beacon exists because `fetch` does not survive the page going away, and
 * someone typing their first dance and then locking their phone must not lose
 * it. But sendBeacon can ONLY issue POST — it cannot PATCH. So POST has to be
 * able to mean "save" as well as "submit", and `submit` is the only thing
 * separating them.
 *
 * Default is FALSE. If the flag is missing, malformed, or the body failed to
 * parse, this saves and does not submit. Locking your phone must never submit
 * your planner — that's a one-way door and the client didn't touch it.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }

    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Too large.' }, { status: 413 });
    }
    let body: { responses?: Record<string, unknown>; submit?: unknown } = {};
    try { body = JSON.parse(text || '{}'); } catch { /* a bad body saves nothing and submits nothing */ }

    // === true, not truthy. A beacon that somehow sent submit:"false" (a
    // string) would be truthy and would submit the planner.
    const isSubmit = body.submit === true;

    const db = createAdminClient() as unknown as SupabaseClient;
    const row = await load(db, id);
    // 404, not 403 — "this exists but you can't have it" tells a stranger their
    // guess was right.
    if (!row) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

    const responses = body.responses
      ? mergeResponses(row, body.responses)
      : (row.responses ?? {});

    const patch: Record<string, unknown> = { responses };
    if (isSubmit) {
      patch.status = 'submitted';
      patch.submitted_at = new Date().toISOString();
    } else {
      // Same rule as PATCH: sent → partial on real input, but never walk BACK
      // from submitted. A client tidying an answer after submitting hasn't
      // unsubmitted, and the DJ shouldn't see it revert to "Pending".
      patch.status = row.status === 'submitted' ? 'submitted' : 'partial';
    }

    const { error } = await db
      .from('booking_planners')
      .update(patch as unknown as never)
      .eq('id', id);
    if (error) {
      return NextResponse.json({ error: 'Could not save.' }, { status: 500 });
    }

    // planner_status on the booking is NOT set here. The trigger
    // (trg_sync_planner_status) owns it — two writers can't both be trusted to
    // remember, and a strip saying "Pending" on a planner that landed a week ago
    // is invisible until it's embarrassing.
    return NextResponse.json({ ok: true, status: patch.status });
  } catch {
    // 500, never 502 — see the header.
    return NextResponse.json({ error: 'Could not save.' }, { status: 500 });
  }
}
