// /planner-preview — the DJ's read-only look at the REAL client planner.
//
// WHY THIS EXISTS
// The send modal's "Preview" has to be the ACTUAL page the client fills in —
// same header, same logo, same "Your booking" strip, same questions with their
// real controls — not a summary list of field labels. So this renders the very
// same <PlannerForm> component the client uses, in `preview` mode: nothing
// saves, there's no Send button, and a banner makes clear it's a look.
//
// It resolves the template the same way the send does — pickTemplate →
// composeFields → applyPrefill — but keyed by EVENT TYPE (?eventType), not a
// planner id. That's deliberate: Customize saves a new DJ-owned row (new id)
// per event type, so resolving by type is what lets a just-saved change appear
// here. No eventType param → the booking's own type (the "auto" planner).
//
// DJ-ONLY. This reads with the DJ's session and refuses any booking that isn't
// theirs — the opposite of /planner/[id], which is a no-login capability URL
// for the client. No planner row is created; nothing is emailed.

import { redirect, notFound } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  pickTemplate,
  composeFields,
  applyPrefill,
  visibleFields,
  dropFieldsAnsweredByBooking,
  type PlannerField,
  type PlannerTemplate,
} from '@/lib/planner';
import { MOB_EVENT_LABELS } from '@/lib/constants';
import PlannerForm from '../planner/[id]/PlannerForm';
import PreviewTestButton from './PreviewTestButton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A preview link should never turn up in a search result.
export const metadata = {
  title: 'Preview — Planner & Playlist',
  robots: { index: false, follow: false },
};

/** "19:30:00" -> "7:30 PM". */
function fmtTime(t: string | null): string {
  if (!t) return '';
  const [hRaw, m] = t.split(':');
  const h = Number(hRaw);
  if (!Number.isFinite(h)) return '';
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m || '00'} ${ampm}`;
}

function fmtRange(s: string | null, e: string | null): string {
  const a = fmtTime(s), b = fmtTime(e);
  if (a && b) return `${a} – ${b}`;
  return a || b || '';
}

function fmtDate(d: string | null): string {
  if (!d) return '';
  // T12:00:00, not bare — a bare date parses as UTC midnight and renders a day
  // early in every US timezone.
  return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

export default async function PlannerPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ bookingId?: string; eventType?: string }>;
}) {
  const sp = await searchParams;
  const bookingId = sp.bookingId || '';
  // Resolve by EVENT TYPE, the same key Customize saves under — NOT a fixed
  // planner id. Saving a customization creates a NEW row with a new id, so a
  // preview pinned to an id would keep showing the old (stock) template. By
  // type, pickTemplate always finds the DJ's latest saved version.
  //   · key absent          → use the booking's own event type (the "auto" row)
  //   · key present, value   → that event type
  //   · key present, empty    → the base/default planner (event_type null)
  const rawType = sp.eventType;
  // DJ session — this is the DJ looking, not the client. No capability URL here.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=/planner-preview`);

  const admin = createAdminClient();
  const db = admin as unknown as SupabaseClient;

  // The DJ's display name and brand logo — same as the client would see. Read
  // up front because BOTH the booking and no-booking previews need it.
  const { data: djData } = await admin
    .from('users')
    .select('name, contract_logo_url')
    .eq('id', user.id)
    .maybeSingle();
  const dj = djData as unknown as { name?: string | null; contract_logo_url?: string | null } | null;
  const djName = dj?.name || 'your DJ';
  const logoUrl = dj?.contract_logo_url || null;

  // Templates the DJ can use: stock + their own. Resolve EXACTLY as the send
  // does so the preview equals what would be delivered.
  const { data: tData } = await db
    .from('planners')
    .select('id, dj_id, name, event_type, is_standard, fields')
    .or(`is_standard.eq.true,dj_id.eq.${user.id}`);
  const templates = (tData as unknown as PlannerTemplate[] | null) || [];

  // ── No-booking preview ── Opened from Booking Settings → Planner & Playlist.
  // There's no booking to prefill from, so render the RAW fields only: no
  // "Your booking" strip, no answers, no test-send button.
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) {
    const wantTypeNB = rawType === undefined ? null : (rawType.trim() ? rawType.trim() : null);
    const { base: baseNB, override: overNB } = pickTemplate(templates, user.id, wantTypeNB);
    if (!baseNB) notFound();
    // The QUESTIONS a client actually answers: drop the fields the booking
    // fills in — the ceremony toggle/start & cocktail (dropFieldsAnsweredByBooking)
    // and every prefill field (music start/end, day-of contact). These show in
    // the "Your booking" panel instead, exactly like the live planner.
    const fieldsNB = dropFieldsAnsweredByBooking(
      visibleFields(composeFields(baseNB.fields || [], overNB?.fields || [])),
      { ceremony_needed: false, cocktail_needed: false },
    ).filter((f) => !f.prefill);
    // The "Your booking" panel at the top, under the logo — the same facts the
    // live planner shows, with placeholder values since this template preview
    // has no booking attached. Weddings label the window "Reception" and carry
    // the Ceremony + Cocktail rows.
    const isWeddingNB = wantTypeNB === 'weddings';
    const knownNB: { k: string; v: string }[] = [
      { k: 'Event', v: wantTypeNB ? (MOB_EVENT_LABELS[wantTypeNB] || '—') : '—' },
      { k: 'Date', v: '—' },
      ...(isWeddingNB ? [{ k: 'Ceremony', v: '—' }, { k: 'Cocktail hour', v: '—' }] : []),
      { k: isWeddingNB ? 'Reception start' : 'Start time', v: '—' },
      { k: isWeddingNB ? 'Reception end' : 'End time', v: '—' },
      { k: 'Venue', v: '—' },
      { k: 'Guests', v: '—' },
      { k: 'Booked by', v: '—' },
      { k: 'Your number', v: '—' },
    ];
    return (
      <PlannerForm
        plannerId="preview"
        fields={fieldsNB}
        initialResponses={{}}
        initialStatus="sent"
        djName={djName}
        hostName={null}
        eventDateLabel=""
        venueName={null}
        logoUrl={logoUrl}
        known={knownNB}
        preview
      />
    );
  }

  // ── Booking preview ── the real booking, prefilled. Same columns the client
  // page and request route read (a mistyped column blanks the whole row).
  const { data: bData } = await admin
    .from('bookings')
    .select('id, dj_id, event_type, event_date, start_time, end_time, venue_name, venue_address, guest_count, phone, requester_name, cocktail_needed, cocktail_start_time, ceremony_needed, ceremony_start_time')
    .eq('id', bookingId)
    .maybeSingle();
  const b = bData as unknown as (Record<string, unknown> & {
    dj_id: string | null;
    event_type: string | null;
    event_date: string | null;
    start_time: string | null;
    end_time: string | null;
    venue_name: string | null;
    venue_address: string | null;
    guest_count: number | null;
    phone: string | null;
    requester_name: string | null;
    cocktail_start_time: string | null;
    ceremony_needed: boolean | null;
    ceremony_start_time: string | null;
  }) | null;
  if (!b) notFound();
  // Theirs, or nobody's. 404 not 403 — don't confirm a booking id exists.
  if (b.dj_id !== user.id) notFound();

  // wantType, mirroring /api/planners GET and the Customize editor exactly:
  const wantType = rawType === undefined ? b.event_type : (rawType.trim() ? rawType.trim() : null);

  // Resolve by type — base + the DJ's override for that type if they have one.
  // This is what makes a just-saved customization show up: pickTemplate returns
  // the DJ's row (whatever its id) over the stock one.
  const { base, override } = pickTemplate(templates, user.id, wantType);
  if (!base) notFound();

  // Strip the questions the booking already answers (ceremony toggle always;
  // ceremony / cocktail fields when the booking has none) so the preview equals
  // exactly what the client will be asked.
  const composed = dropFieldsAnsweredByBooking(
    composeFields(base.fields || [], override?.fields || []),
    b,
  );

  // Real prefill, same helper and args as the send — so the preview's "Your
  // booking" answers are the ones the client would actually see filled in.
  const responses = applyPrefill(
    composed,
    b as unknown as Parameters<typeof applyPrefill>[1],
    djName,
    {},
  );

  const fields: PlannerField[] = visibleFields(composed);

  // What we already know from the booking — the read-only "Your booking" strip.
  // Weddings read as a reception with an optional cocktail hour; everything else
  // is a single start–end.
  const isWedding = b.event_type === 'weddings';
  const eventLabel = b.event_type ? (MOB_EVENT_LABELS[b.event_type] || '') : '';
  const known: { k: string; v: string }[] = [
    { k: 'Event', v: eventLabel },
    { k: 'Date', v: fmtDate(b.event_date) },
    ...(isWedding && b.ceremony_needed && b.ceremony_start_time
      ? [{ k: 'Ceremony', v: fmtTime(b.ceremony_start_time) }]
      : []),
    ...(isWedding && b.cocktail_start_time
      ? [{ k: 'Cocktail hour', v: fmtTime(b.cocktail_start_time) }]
      : []),
    { k: isWedding ? 'Reception' : 'Time', v: fmtRange(b.start_time, b.end_time) },
    { k: 'Venue', v: [b.venue_name, b.venue_address].filter(Boolean).join(' · ') },
    { k: 'Guests', v: b.guest_count ? `${b.guest_count}` : '' },
    { k: 'Booked by', v: b.requester_name || '' },
    { k: 'Your number', v: b.phone || '' },
  ].filter((r) => !!r.v);

  // The template being previewed (the DJ's override for this type, else base) —
  // passed to the test send so the emailed copy matches this preview exactly.
  const previewPlannerId = override?.id || base.id;

  return (
    <>
      <PlannerForm
        plannerId="preview"
        fields={fields}
        initialResponses={responses}
        initialStatus="sent"
        djName={djName}
        hostName={b.requester_name || null}
        eventDateLabel={fmtDate(b.event_date)}
        venueName={b.venue_name || null}
        logoUrl={logoUrl}
        known={known}
        preview
      />
      <PreviewTestButton bookingId={bookingId} plannerId={previewPlannerId} />
    </>
  );
}
