// /api/planners — the DJ's planner TEMPLATES.
//
//   GET  ?bookingId=…  what would be sent, what else could be, and to whom
//   PUT  { eventType, fields, name }   save the DJ's own version
//
// Not to be confused with /api/planner/* (singular), which is one booking's
// planner. This is the thing those are made FROM.
//
// THE POINT OF PUT — from the spec, and it's the whole feature:
//
//   A DJ customises their wedding planner ONCE. Every wedding after that uses
//   it automatically, with zero clicks.
//
// Which is why this upserts onto (dj_id, event_type) — the unique index means
// "which planner for this wedding?" has exactly one answer and Request never
// has to ask. Insert-per-save instead, and a DJ ends up with "Wedding",
// "Wedding v2", "Wedding FINAL", and a resolver picking between them at random.
//
// Cloudflare eats 502s. 500 only.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { canUsePro, type AccessFields } from '@/lib/access';
import {
  pickTemplate,
  composeFields,
  applyPrefill,
  visibleFields,
  NOTES_FIELD_ID,
  DO_NOT_PLAY_FIELD_ID,
  type PlannerTemplate,
  type PlannerField,
  type PlannerFieldType,
} from '@/lib/planner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LABEL = 120;
const MAX_HELP = 400;
const MAX_FIELDS = 120;
const MAX_OPTIONS = 20;

const TYPES: PlannerFieldType[] = [
  'text', 'longtext', 'time', 'song', 'songlist',
  'textlist', 'people', 'timeline', 'yesno', 'select', 'link',
];

const clamp = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().slice(0, n) : '');

async function loadTemplates(db: SupabaseClient, djId: string): Promise<PlannerTemplate[]> {
  const { data } = await db
    .from('planners')
    .select('id, dj_id, name, event_type, is_standard, fields')
    .or(`is_standard.eq.true,dj_id.eq.${djId}`);
  return (data as unknown as PlannerTemplate[] | null) || [];
}

async function gate(): Promise<
  { ok: true; userId: string; db: SupabaseClient; admin: ReturnType<typeof createAdminClient> }
  | { ok: false; res: NextResponse }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, res: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) };
  }
  const admin = createAdminClient();
  // `name`, not `dj_name` — there is no users.dj_name, and selecting one that
  // doesn't exist makes PostgREST reject the whole query and hand back null.
  // (That bug told every DJ they weren't Pro for an afternoon.)
  const { data, error } = await admin
    .from('users')
    .select('sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, comp_source')
    .eq('id', user.id)
    .maybeSingle();
  // A failed query is not an un-subscribed DJ. Never let them share a branch.
  if (error) {
    return { ok: false, res: NextResponse.json({ error: 'Could not read your account.' }, { status: 500 }) };
  }
  const row = data as unknown as AccessFields | null;
  if (!row || !canUsePro(row)) {
    return { ok: false, res: NextResponse.json({ error: 'Planners are a Pro feature.' }, { status: 403 }) };
  }
  return { ok: true, userId: user.id, db: admin as unknown as SupabaseClient, admin };
}

// ── GET ───────────────────────────────────────────────────────────────────
//
// Everything the send modal needs to open ALREADY DECIDED. The modal is a
// confirmation, not a questionnaire: it says "Wedding planner, 34 questions,
// going to Jordan" and offers one button. This is what makes that possible.
export async function GET(req: Request) {
  try {
    const g = await gate();
    if (!g.ok) return g.res;
    const { userId, db, admin } = g;

    const bookingId = new URL(req.url).searchParams.get('bookingId') || '';
    if (!/^[0-9a-f-]{36}$/i.test(bookingId)) {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }

    const { data: bData } = await admin
      .from('bookings')
      .select('id, dj_id, event_type, booking_type, is_manual, host_email, requester_name, requester_id, event_date, start_time, end_time, venue_name, venue_address, guest_count, cocktail_needed, cocktail_start_time, package_title')
      .eq('id', bookingId)
      .maybeSingle();
    const b = bData as unknown as (Record<string, unknown> & {
      dj_id: string | null; event_type: string | null;
      host_email: string | null; requester_name: string | null;
    }) | null;
    if (!b) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    // 404 not 403 — a DJ probing booking ids shouldn't learn which exist.
    if (b.dj_id !== userId) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

    const templates = await loadTemplates(db, userId);
    const { base, override } = pickTemplate(templates, userId, b.event_type);
    if (!base) {
      return NextResponse.json({ error: 'No planner template available.' }, { status: 500 });
    }
    const fields = composeFields(base.fields || [], override?.fields || []);

    // Prefill is computed here for the COUNT only, and thrown away. The real
    // one runs at send time in /api/planner/request and is what gets stored —
    // two prefills that could disagree would be two prefills, and the stored
    // one is the one the client sees.
    const prefilled = applyPrefill(fields, b, null, {});

    // The resolved template is whichever row actually decided the outcome —
    // the event-type override if there is one, else the base. That's the row
    // the DJ is about to edit when they hit Customize.
    const resolved = override || base;

    return NextResponse.json({
      resolved: {
        id: resolved.id,
        name: resolved.name,
        eventType: resolved.event_type,
        isStandard: resolved.is_standard,
        // Theirs or stock? The modal says "your Wedding planner" vs "the
        // standard Wedding planner", which is the difference between "I set
        // this up" and "this is what everyone gets".
        isMine: !resolved.is_standard && resolved.dj_id === userId,
      },
      fields,
      prefillCount: Object.keys(prefilled).length,
      // Which ones the client will be SHOWN rather than asked. Derived from the
      // same applyPrefill the send uses, so the preview can't promise a
      // question that never appears (or hide one that does).
      prefilledIds: Object.keys(prefilled),
      recipient: {
        name: b.requester_name || null,
        // Only what's ON the booking. A requester_id account email is resolved
        // at send time; the modal shouldn't leak an account address the DJ
        // never typed.
        email: b.host_email || null,
        hasAccount: !!b.requester_id,
      },
      eventType: b.event_type,
      bookingType: b.booking_type,
      // The booking, in one line: date · venue · who. The DJ is confirming they
      // picked the right ROW as much as the right planner — "am I about to mail
      // the Venetian wedding's planner to the birthday party?" — and a question
      // count can't answer that.
      event: {
        date: (b.event_date as string | null) || null,
        venue: (b.venue_name as string | null) || null,
      },
      // For "use a different planner". Stock rows plus the DJ's own.
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        eventType: t.event_type,
        isStandard: t.is_standard,
        isMine: !t.is_standard && t.dj_id === userId,
        count: visibleFields(t.fields || []).length,
      })),
    });
  } catch {
    return NextResponse.json({ error: 'Could not load planners.' }, { status: 500 });
  }
}

/**
 * Rebuild the DJ's field list from what they sent — never store it raw.
 *
 * The rules here are the difference between a template editor and a way to
 * destroy answers that have already been given:
 *
 *  · ids are COPIED, never generated for a field that already has one. An id
 *    is what `responses` is keyed by; renaming one orphans every answer ever
 *    given to it, silently, forever.
 *  · a stock field can be hidden but never removed — hidden is reversible by
 *    someone who doesn't know what they broke, deleted isn't. Enforced by the
 *    caller passing the full list; anything missing from it is treated as
 *    hidden rather than gone (see below).
 *  · duplicate ids are dropped. Two fields with one id collide in `responses`
 *    and the second silently wins.
 *  · a custom field's type must be one we can render, or the client gets a
 *    control that doesn't exist.
 */
function sanitiseFields(raw: unknown): { fields: PlannerField[]; error?: string } {
  if (!Array.isArray(raw)) return { fields: [], error: 'Bad fields.' };
  if (raw.length > MAX_FIELDS) return { fields: [], error: 'Too many questions.' };

  const seen = new Set<string>();
  const out: PlannerField[] = [];

  for (const r of raw) {
    const o = (r ?? {}) as Record<string, unknown>;
    const id = clamp(o.id, 64);
    if (!id) continue;
    if (seen.has(id)) continue;          // collision — first one wins
    seen.add(id);

    const type = TYPES.includes(o.type as PlannerFieldType)
      ? (o.type as PlannerFieldType)
      : 'text';
    const label = clamp(o.label, MAX_LABEL);
    if (!label) continue;                 // a question with no question

    const f: PlannerField = { id, type, label };
    const help = clamp(o.help, MAX_HELP);
    if (help) f.help = help;
    if (o.required === true) f.required = true;
    if (o.hidden === true) f.hidden = true;
    if (o.is_custom === true) f.is_custom = true;
    if (o.prefill) f.prefill = o.prefill as PlannerField['prefill'];
    if (type === 'select' && Array.isArray(o.options)) {
      const opts = o.options.slice(0, MAX_OPTIONS).map((s) => clamp(s, MAX_LABEL)).filter(Boolean);
      if (opts.length) f.options = opts;
    }
    out.push(f);
  }

  // Do NOT play and Notes are re-pinned to the end regardless of where the DJ
  // dragged them. Same rule composeFields() enforces, for the same reason: the
  // note is the client's only way to say something we didn't ask about, and
  // buried mid-form nobody scrolls back to it.
  const pinned = new Set([DO_NOT_PLAY_FIELD_ID, NOTES_FIELD_ID]);
  return {
    fields: [...out.filter((f) => !pinned.has(f.id)), ...out.filter((f) => pinned.has(f.id))],
  };
}

// ── PUT ───────────────────────────────────────────────────────────────────
//
// Save once, send forever. Upserts THE DJ's row for this event type.
export async function PUT(req: Request) {
  try {
    const g = await gate();
    if (!g.ok) return g.res;
    const { userId, db } = g;

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    // null event_type = the DJ's base planner, used for every event type they
    // haven't customised specifically. A real value scopes it to that type.
    const eventType = typeof body.eventType === 'string' && body.eventType.trim()
      ? body.eventType.trim().slice(0, 80)
      : null;

    const { fields, error: fErr } = sanitiseFields(body.fields);
    if (fErr) return NextResponse.json({ error: fErr }, { status: 400 });
    if (fields.length === 0) {
      return NextResponse.json({ error: 'A planner needs at least one question.' }, { status: 400 });
    }

    // A DJ editing the stock Wedding planner is creating THEIR Wedding planner.
    // The stock rows are shared by every DJ on the platform and are never
    // written to here — is_standard rows have dj_id null and no path to this
    // code touches them.
    const name = clamp(body.name, 80) || (eventType ? `My ${eventType} planner` : 'My planner');

    const mine = db
      .from('planners')
      .select('id')
      .eq('dj_id', userId)
      .eq('is_standard', false);
    // .is() for null, .eq() otherwise. `event_type = null` matches nothing in
    // SQL — an .eq(null) would never find the DJ's base row, so every save
    // would try to INSERT a second one and the unique index would start
    // rejecting saves with a constraint error nobody could explain.
    const { data: existing } = await (
      eventType === null
        ? mine.is('event_type', null)
        : mine.eq('event_type', eventType)
    ).maybeSingle();
    const row = existing as unknown as { id: string } | null;

    if (row) {
      const { error } = await db
        .from('planners')
        .update({ name, fields } as unknown as never)
        .eq('id', row.id);
      if (error) return NextResponse.json({ error: 'Could not save.' }, { status: 500 });
      return NextResponse.json({ id: row.id, saved: true });
    }

    const { data: created, error } = await db
      .from('planners')
      .insert({
        dj_id: userId,
        name,
        event_type: eventType,
        is_standard: false,
        fields,
      } as unknown as never)
      .select('id')
      .single();
    if (error || !created) {
      return NextResponse.json({ error: 'Could not save.' }, { status: 500 });
    }
    return NextResponse.json({ id: (created as unknown as { id: string }).id, saved: true });
  } catch {
    return NextResponse.json({ error: 'Could not save.' }, { status: 500 });
  }
}
