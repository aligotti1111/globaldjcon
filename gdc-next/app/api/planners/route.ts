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
import { getActingContext, canSettings, type ActingRole } from '@/lib/acting';
import {
  pickTemplate,
  pickTemplateById,
  composeFields,
  applyPrefill,
  visibleFields,
  isCustomEventType,
  NOTES_FIELD_ID,
  DO_NOT_PLAY_FIELD_ID,
  HONOREE_FIELD_ID,
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
    .select('id, dj_id, name, event_type, is_standard, fields, template_key')
    .or(`is_standard.eq.true,dj_id.eq.${djId}`);
  return (data as unknown as PlannerTemplate[] | null) || [];
}

// The template LIST the DJ sees — ONE row per stock template, plus their own
// from-scratch customs. If the DJ has forked a stock template (a saved copy
// keyed by template_key), that stock row shows the fork's name and question
// count and reads as "theirs", but keeps the STOCK id as its row id so Edit and
// Rename resolve through pickTemplateById → the fork. This is what stops the
// two Wedding variants (and their forks) from stacking up as four rows.
function listTemplates(templates: PlannerTemplate[], djId: string) {
  const forkByKey = new Map<string, PlannerTemplate>();
  for (const t of templates) {
    if (!t.is_standard && t.dj_id === djId && t.template_key) {
      forkByKey.set(t.template_key, t);
    }
  }
  const stockRows = templates
    // Every DEFAULT event type gets its own row; the base spine (event_type
    // null) is not a planner a DJ sends, so it never shows in the list.
    .filter((t) => t.is_standard && t.event_type != null)
    .map((s) => {
      const fork = forkByKey.get(s.id);
      return {
        id: s.id,
        name: fork ? fork.name : s.name,
        eventType: s.event_type,
        // Forked → it's the DJ's now; unforked → the shared standard.
        isStandard: !fork,
        isMine: !!fork,
        count: fork
          ? visibleFields(fork.fields || []).length
          : composedCount(templates, djId, s),
      };
    });
  // From-scratch custom planners are standalone rows (no template_key).
  const customRows = templates
    .filter((t) => !t.is_standard && t.dj_id === djId && !t.template_key)
    .map((t) => ({
      id: t.id,
      name: t.name,
      eventType: t.event_type,
      isStandard: false,
      isMine: true,
      count: visibleFields(t.fields || []).length,
    }));
  return [...stockRows, ...customRows];
}

// The number a DJ sees next to a template in the list must be the number of
// questions a CLIENT is actually asked — i.e. the composed set, base + this
// event type's override — not just the override's own rows. Some stock
// event-type templates (anniversary, graduation, birthday) store ONLY their
// extra question, so counting t.fields alone shows "1" for a form the client
// receives with six questions. composeFields dedupes by id, so full-set
// templates (weddings, sweet 16) and the DJ's own saved copies count the same
// either way — only the override-only ones are corrected.
function composedCount(templates: PlannerTemplate[], djId: string, t: PlannerTemplate): number {
  if (t.event_type == null) return visibleFields(t.fields || []).length;
  // A custom planner is standalone — it doesn't fold in the base spine, so its
  // count is just its own visible questions.
  if (isCustomEventType(t.event_type)) return visibleFields(t.fields || []).length;
  const base =
    templates.find((x) => x.dj_id === djId && !x.is_standard && x.event_type == null) ??
    templates.find((x) => x.is_standard && x.event_type == null) ??
    null;
  return visibleFields(composeFields(base?.fields || [], t.fields || [])).length;
}

async function gate(): Promise<
  { ok: true; userId: string; role: ActingRole; db: SupabaseClient; admin: ReturnType<typeof createAdminClient> }
  | { ok: false; res: NextResponse }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, res: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) };
  }
  const admin = createAdminClient();
  // TEAM SEATS: a teammate acts on the OWNER's account. Both the Pro gate and
  // every dj_id-scoped read/write below must resolve to the OWNER (acting.djId),
  // never the logged-in member. Reading `.eq('id', user.id)` here was the bug:
  // a teammate's own row is Free/none, so canUsePro was false and they were told
  // the owner's Pro planner was "a Pro feature." (The owner's users row is also
  // hidden from a teammate by RLS, which is why this reads via the admin client.)
  const acting = await getActingContext(user.id);
  const djId = acting.djId;
  // `name`, not `dj_name` — there is no users.dj_name, and selecting one that
  // doesn't exist makes PostgREST reject the whole query and hand back null.
  // (That bug told every DJ they weren't Pro for an afternoon.)
  const { data, error } = await admin
    .from('users')
    .select('sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, comp_source')
    .eq('id', djId)
    .maybeSingle();
  // A failed query is not an un-subscribed DJ. Never let them share a branch.
  if (error) {
    return { ok: false, res: NextResponse.json({ error: 'Could not read your account.' }, { status: 500 }) };
  }
  const row = data as unknown as AccessFields | null;
  if (!row || !canUsePro(row)) {
    return { ok: false, res: NextResponse.json({ error: 'Planners are a Pro feature.' }, { status: 403 }) };
  }
  // `userId` is used below purely as the DJ id (dj_id filters, template
  // ownership, booking ownership) — so it is the OWNER's id, not the member's.
  return { ok: true, userId: djId, role: acting.role, db: admin as unknown as SupabaseClient, admin };
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

    const url = new URL(req.url);
    const bookingId = url.searchParams.get('bookingId') || '';

    // ── No-booking mode ── Used by the Planner & Playlist section in Booking
    // Settings and by the editor/preview it opens: manage the DJ's templates
    // with no booking to prefill from. With no eventType we return just the
    // template LIST; with one we compose that template (NO prefill — there's no
    // booking data, so the preview shows the raw fields) for the editor/preview.
    if (!bookingId) {
      const templates = await loadTemplates(db, userId);
      const raw = url.searchParams.get('eventType');
      // A specific template id disambiguates types with more than one template
      // (weddings: with / without ceremony). When present it wins over eventType.
      const templateId = url.searchParams.get('templateId');
      if (raw === null && !templateId) {
        return NextResponse.json({ templates: listTemplates(templates, userId) });
      }
      let base: ReturnType<typeof pickTemplate>['base'];
      let override: ReturnType<typeof pickTemplate>['override'];
      // A standalone template (the DJ's own fork or custom planner) is used
      // VERBATIM — no base spine composed underneath. editTemplateKey is the
      // key a Save writes to: the stock template id for a fork, null for a
      // custom (which keys on its own event_type marker).
      let standalone = false;
      let editTemplateKey: string | null = null;
      if (templateId) {
        const r = pickTemplateById(templates, userId, templateId);
        if (!r) return NextResponse.json({ error: 'Planner not found.' }, { status: 404 });
        base = r.base; override = r.override;
        standalone = r.standalone; editTemplateKey = r.templateKey;
      } else {
        const wt = raw!.trim() || null;
        ({ base, override } = pickTemplate(templates, userId, wt));
        // Disambiguate by NAME when a type has more than one template (weddings:
        // with / without ceremony) and no id was passed. pickTemplate takes the
        // first match by type, so without this the "no ceremony" editor would
        // resolve to the "with ceremony" row.
        const wantName = (url.searchParams.get('name') || '').trim();
        if (wantName && wt) {
          const sameType = templates.filter((t) => t.event_type === wt);
          if (sameType.length > 1) {
            const byName =
              sameType.find((t) => t.dj_id === userId && !t.is_standard && t.name === wantName) ??
              sameType.find((t) => t.name === wantName);
            if (byName) override = byName;
          }
        }
        // A DJ's own row (fork or custom) resolved by event type is standalone
        // too; a stock override seeds a fork keyed on its own id.
        if (override && !override.is_standard && override.dj_id === userId) {
          standalone = true;
          editTemplateKey = override.template_key ?? null;
        } else if (override && override.is_standard) {
          editTemplateKey = override.id;
        } else if (base) {
          editTemplateKey = base.is_standard ? base.id : (base.template_key ?? null);
        }
      }
      if (!base && !override) {
        return NextResponse.json({ error: 'No planner template available.' }, { status: 500 });
      }
      // Standalone (fork/custom) → its own questions verbatim; a stock seed →
      // the base spine composed with this template's questions.
      const fields = standalone
        ? (override?.fields || [])
        : composeFields(base?.fields || [], override?.fields || []);
      const resolved = override || base!;
      const wantType = resolved.event_type;
      return NextResponse.json({
        resolved: {
          id: resolved.id, name: resolved.name, eventType: resolved.event_type,
          isStandard: resolved.is_standard, isMine: !resolved.is_standard && resolved.dj_id === userId,
        },
        editEventType: wantType,
        editTemplateKey,
        fields,
        prefillCount: 0,
        prefilledIds: [],
        recipient: { name: null, email: null, hasAccount: false },
        eventType: wantType,
        bookingType: null,
        event: { date: null, venue: null },
        templates: listTemplates(templates, userId),
      });
    }

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

    // Which planner to compose? Normally the booking's own event type. But the
    // editor can ask for a SPECIFIC one via ?eventType= — that's how "customise"
    // next to a planner in the list opens that planner, not the resolved one.
    // The empty string means the base (event_type null).
    const raw = new URL(req.url).searchParams.get('eventType');
    const wantType = raw === null ? b.event_type : (raw.trim() || null);

    const { base, override } = pickTemplate(templates, userId, wantType);
    if (!base) {
      return NextResponse.json({ error: 'No planner template available.' }, { status: 500 });
    }
    const fields = composeFields(base.fields || [], override?.fields || []);

    // Prefill is computed here for the COUNT only, and thrown away. The real
    // one runs at send time in /api/planner/request and is what gets stored —
    // two prefills that could disagree would be two prefills, and the stored
    // one is the one the client sees.
    const prefilled = applyPrefill(fields, b, null, {});

    // Whichever row decided the outcome for the requested type — override if
    // there is one, else base. That's the row the DJ edits, and `editEventType`
    // is what a Save must write to (null = the base planner).
    const resolved = override || base;
    const editEventType = wantType;

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
      // The event type this composed set edits. The client-facing `event.date`
      // etc. still describe the BOOKING; this describes the TEMPLATE.
      editEventType,
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
      // For "use a different planner". One row per stock template (folding in
      // the DJ's fork of it) plus their own from-scratch customs.
      templates: listTemplates(templates, userId),
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

  // The two ends of the form are re-pinned regardless of where the DJ dragged
  // things — the same rule composeFields() enforces, so a saved template and a
  // freshly composed one can't come out in different orders:
  //
  //   · Guest of honour FIRST. It's what says the form was written for this
  //     event rather than fired at everybody.
  //   · Do NOT play and Notes LAST. The note is the client's only way to say
  //     something we didn't ask about, and buried mid-form nobody scrolls back.
  const pinned = new Set([DO_NOT_PLAY_FIELD_ID, NOTES_FIELD_ID]);
  return {
    fields: [
      ...out.filter((f) => f.id === HONOREE_FIELD_ID),
      ...out.filter((f) => f.id !== HONOREE_FIELD_ID && !pinned.has(f.id)),
      ...out.filter((f) => pinned.has(f.id)),
    ],
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
    // Editing the DJ's saved planner TEMPLATES (rename, save questions) is a
    // manager+ action, like the other saved-default surfaces (contract templates,
    // rider library). Assistants may SEND planners, not reshape the library.
    if (!canSettings(g.role)) {
      return NextResponse.json({ error: 'Your role cannot edit planner templates.' }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    // ── Rename ──────────────────────────────────────────────────────────────
    //
    // The pencil in the send modal renames a planner by id, without touching
    // its questions. Server-authoritative on purpose: the stock rows' fields
    // live here, so "rename the stock Wedding planner" can create the DJ's own
    // copy carrying those same questions — the client never has to send the
    // field list it doesn't hold.
    //
    //   · the DJ's own planner  → just update its name.
    //   · a stock planner       → upsert the DJ's copy for that event type,
    //                             seeded with the stock's questions, named X.
    //                             (If they already have a copy, only the name
    //                             changes — their customised questions stay.)
    if (typeof body.renamePlannerId === 'string' && body.renamePlannerId) {
      const renameId = body.renamePlannerId;
      const newName = clamp(body.name, 80);
      if (!newName) {
        return NextResponse.json({ error: 'A name is required.' }, { status: 400 });
      }

      const templates = await loadTemplates(db, userId);
      const target = templates.find((t) => t.id === renameId);
      if (!target) {
        // 404, not 403 — don't confirm another DJ's private template id exists.
        return NextResponse.json({ error: 'Planner not found.' }, { status: 404 });
      }

      // The DJ's own → rename in place, questions untouched.
      if (!target.is_standard && target.dj_id === userId) {
        const { error } = await db
          .from('planners')
          .update({ name: newName } as unknown as never)
          .eq('id', target.id)
          .eq('dj_id', userId);
        if (error) return NextResponse.json({ error: 'Could not rename.' }, { status: 500 });
        return NextResponse.json({ id: target.id, saved: true });
      }

      // A stock planner → make (or rename) the DJ's fork of THIS template,
      // keyed by template_key (the stock id) so it stays independent of any
      // other template of the same event type.
      const et = target.event_type ?? null;
      const key = target.id;
      const { data: existingMine } = await db
        .from('planners')
        .select('id')
        .eq('dj_id', userId)
        .eq('is_standard', false)
        .eq('template_key', key)
        .maybeSingle();
      const mineRow = existingMine as unknown as { id: string } | null;

      if (mineRow) {
        const { error } = await db
          .from('planners')
          .update({ name: newName } as unknown as never)
          .eq('id', mineRow.id)
          .eq('dj_id', userId);
        if (error) return NextResponse.json({ error: 'Could not rename.' }, { status: 500 });
        return NextResponse.json({ id: mineRow.id, saved: true });
      }

      const { data: made, error: makeErr } = await db
        .from('planners')
        .insert({
          dj_id: userId,
          name: newName,
          event_type: et,
          is_standard: false,
          template_key: key,
          fields: target.fields || [],
        } as unknown as never)
        .select('id')
        .single();
      if (makeErr || !made) {
        return NextResponse.json({ error: 'Could not rename.' }, { status: 500 });
      }
      return NextResponse.json({ id: (made as unknown as { id: string }).id, saved: true });
    }

    // null event_type = the DJ's base planner, used for every event type they
    // haven't customised specifically. A real value scopes it to that type.
    const eventType = typeof body.eventType === 'string' && body.eventType.trim()
      ? body.eventType.trim().slice(0, 80)
      : null;

    // Which STOCK template this save is a fork of. The editor gets it from the
    // GET (editTemplateKey) and hands it back here. Present → this is an
    // independent per-template fork, keyed by (dj_id, template_key), so two
    // templates of the same event type never share a row. Absent → a
    // from-scratch custom planner (keyed by its own event_type marker) or the
    // legacy base planner.
    const templateKey = typeof body.templateKey === 'string' && body.templateKey.trim()
      ? body.templateKey.trim().slice(0, 64)
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
    // Find the row this save updates. A fork is found by its template_key; a
    // custom or legacy base by event_type (.is() for null, .eq() otherwise —
    // `event_type = null` matches nothing in SQL, so an .eq(null) would never
    // find the base row and every save would INSERT a duplicate).
    const { data: existing } = await (
      templateKey !== null
        ? mine.eq('template_key', templateKey)
        : eventType === null
          ? mine.is('event_type', null)
          : mine.eq('event_type', eventType)
    ).maybeSingle();
    const row = existing as unknown as { id: string } | null;

    if (row) {
      const { error } = await db
        .from('planners')
        // template_key is set on update too, so a row created before this
        // migration (or via the legacy path) gets keyed on first save.
        .update({ name, fields, ...(templateKey !== null ? { template_key: templateKey } : {}) } as unknown as never)
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
        template_key: templateKey,
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
