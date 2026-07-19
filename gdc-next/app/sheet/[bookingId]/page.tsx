// /sheet/[bookingId] — the planner, as the thing you actually work from.
//
// WHY IT'S A PAGE AND NOT A GENERATED PDF
// A PDF library would mean a dependency, a server render, a download, and a file
// that's stale the moment the client adds a song. This is a page. Cmd-P makes
// the PDF; the browser already knows how. On a phone it's Share → Print → Save
// to Files, or just leave the tab open, which is what most people will do.
// It's always current because it isn't a copy.
//
// OUTSIDE (main). Deliberately: that layout carries the nav, the header, the
// whole app chrome — and every pixel of it would print. This page is on its own
// so the paper has the gig on it and nothing else.
//
// DJ-AUTHED, by session. /planner/[id] is the client's capability url; this is
// keyed on a BOOKING id, which turns up in the app's own urls and is not a
// secret, so ownership is checked properly.
//
// SCREEN IS DARK, PAPER IS WHITE. The DJ reads this in a booth with the lights
// down, so on screen it matches the app. Printed, dark means a page of grey mush
// and an empty cartridge — so @media print inverts the whole thing. Same page,
// two completely different jobs, and neither compromises for the other.

import { notFound, redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  visibleFields,
  isNa,
  responseValue,
  hasAnswer,
  playLink,
  pickTemplate,
  composeFields,
  applyPrefill,
  DO_NOT_PLAY_FIELD_ID,
  HONOREE_FIELD_ID,
  titleCaseLabel,
  type PlannerField,
  type PlannerResponses,
  type PlannerTemplate,
  type Track,
  type Person,
  type TimelineRow,
} from '@/lib/planner';
import { MOB_EVENT_LABELS } from '@/lib/constants';
import PrintButton from './PrintButton';
import styles from './sheet.module.css';

// Prefilled time questions that only echoed the booking's own start/end (and
// wedding cocktail) — now shown in the header, never asked. Filtered from any
// planner's fields so they don't print twice.
const LEGACY_TIME_FIELD_IDS = new Set(['music_start', 'music_end', 'w_cocktail_start']);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A page with a client's names, songs and phone number on it. Never indexed.
export const metadata = {
  title: 'Planner & Playlist — Global DJ Connect',
  robots: { index: false, follow: false },
};

function fmtTime(t: string | null | undefined): string {
  if (!t) return '';
  const [hRaw, m] = t.split(':');
  const h = Number(hRaw);
  if (!Number.isFinite(h)) return '';
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m || '00'} ${ampm}`;
}

function fmtDate(d: string | null): string {
  if (!d) return '';
  // T12:00:00 — bare parses as UTC midnight and prints the day before.
  return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

export default async function SheetPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();
  const db = admin as unknown as SupabaseClient;

  const { data: pData } = await db
    .from('booking_planners')
    .select('id, dj_id, fields, responses, status, submitted_at')
    .eq('booking_id', bookingId)
    .maybeSingle();
  const planner = pData as unknown as {
    id: string;
    dj_id: string;
    fields: PlannerField[] | null;
    responses: PlannerResponses | null;
    status: string;
    submitted_at: string | null;
  } | null;

  // The booking is needed either way — for the header, and (when no planner has
  // been sent yet) for its dj_id and event_type so we can resolve a BLANK sheet.
  const { data: bData } = await admin
    .from('bookings')
    .select('dj_id, event_type, event_details, event_date, start_time, end_time, venue_name, venue_address, guest_count, phone, cocktail_needed, cocktail_start_time, requester_name, package_title')
    .eq('id', bookingId)
    .maybeSingle();
  const b = bData as unknown as {
    dj_id: string | null;
    event_type: string | null;
    // Event-type detail from the booking form (surprise party, type of
    // anniversary/graduation/reunion, birthday age). Null when the type has no
    // sub-question.
    event_details: string | null;
    event_date: string | null;
    start_time: string | null;
    end_time: string | null;
    venue_name: string | null;
    venue_address: string | null;
    guest_count: number | null;
    phone: string | null;
    cocktail_needed: boolean | null;
    cocktail_start_time: string | null;
    requester_name: string | null;
    package_title: string | null;
  } | null;

  // 404 rather than 403 on someone else's booking — a DJ probing ids shouldn't
  // learn which ones exist. Ownership is read from whichever record we have:
  // the planner if one exists, otherwise the booking itself.
  const ownerId = planner?.dj_id ?? b?.dj_id ?? null;
  if (!b || ownerId !== user.id) notFound();

  // ── Fields + responses, at ANY stage ───────────────────────────────────
  //
  // The run sheet has to be downloadable before a planner is even sent — a DJ
  // wants to print a blank and fill it by hand, or just have the document. So:
  //
  //   · planner exists  → show its snapshot (blank, partial, or submitted).
  //   · no planner yet  → resolve the DJ's template for this event type and
  //                       render it blank, prefilled only with what the booking
  //                       already knows (times, venue). Nothing is written to
  //                       the DB — sending the planner is still a separate,
  //                       deliberate act.
  let responses: PlannerResponses;
  let fields: PlannerField[];
  let status: string;
  let submitted_at: string | null;

  if (planner) {
    responses = planner.responses ?? {};
    fields = visibleFields(planner.fields ?? []);
    status = planner.status;
    submitted_at = planner.submitted_at;
  } else {
    const { data: tData } = await db
      .from('planners')
      .select('id, dj_id, name, event_type, is_standard, fields')
      .or(`is_standard.eq.true,dj_id.eq.${b.dj_id}`);
    const templates = (tData as unknown as PlannerTemplate[] | null) || [];
    const { base, override } = pickTemplate(templates, b.dj_id ?? '', b.event_type);
    const composed = composeFields(base?.fields || [], override?.fields || []);

    const { data: djData } = await admin
      .from('users')
      .select('name')
      .eq('id', b.dj_id ?? '')
      .maybeSingle();
    const djName = (djData as unknown as { name?: string | null } | null)?.name || null;

    responses = applyPrefill(
      composed,
      b as unknown as Parameters<typeof applyPrefill>[1],
      djName,
      {},
    );
    fields = visibleFields(composed);
    status = 'sent';       // not started — the "not submitted" banner shows
    submitted_at = null;
  }

  // Drop the legacy time questions (music start/end, wedding cocktail start).
  // They only ever echoed the booking's own times, which are already in the
  // header — so they're filtered here for old snapshots the same way the client
  // page does it.
  fields = fields.filter((f) => !LEGACY_TIME_FIELD_IDS.has(f.id));

  // The printable is the SAME form the client fills — every question, in the
  // same order (honoree first, Do NOT Play + Notes last), each printed whether
  // it's answered or blank. So it matches the on-screen planner exactly; nothing
  // is hidden just because it hasn't been answered yet. (The old run sheet
  // pulled honoree into the title and hid Do NOT Play / Notes until answered,
  // which is why they went missing on a blank one.)
  //
  // honoree is still read, only to give the page a nicer title when it's filled
  // — it still prints as its own question in the body like everything else.
  const honoree = fields.find((f) => f.id === HONOREE_FIELD_ID);

  // The "Your booking" strip — the SAME labelled rows the client sees at the top
  // of their form, so the printable matches the filled-out one: field, then
  // info, one per line. Event-aware, like the client page.
  const isWedding = b?.event_type === 'weddings';
  const startLabel = isWedding ? 'Reception start' : 'Start time';
  const endLabel = isWedding ? 'Reception end' : 'End time';
  const showCocktail = isWedding && !!b?.cocktail_needed && !!b?.cocktail_start_time;
  const known: { k: string; v: string }[] = [
    { k: 'Event', v: b?.event_type ? (MOB_EVENT_LABELS[b.event_type] || '') : '' },
    { k: 'Date', v: fmtDate(b?.event_date ?? null) },
    ...(showCocktail ? [{ k: 'Cocktail hour', v: fmtTime(b?.cocktail_start_time ?? null) }] : []),
    { k: startLabel, v: fmtTime(b?.start_time ?? null) },
    { k: endLabel, v: fmtTime(b?.end_time ?? null) },
    { k: 'Venue', v: [b?.venue_name, b?.venue_address].filter(Boolean).join(' · ') },
    { k: 'Occasion', v: b?.event_details || '' },
    { k: 'Guests', v: b?.guest_count ? `${b.guest_count}` : '' },
    { k: 'Booked by', v: b?.requester_name || '' },
    { k: 'Your number', v: b?.phone || '' },
  ].filter((r) => !!r.v);

  return (
    // id + data-sheet let the Download button find the page root (to force the
    // light/paper styling during capture) and the sheet itself (what actually
    // goes into the PDF). See PrintButton.
    <div className={styles.page} id="runSheet">
      <div className={styles.sheet} data-sheet>


        <header className={styles.head}>
          <div className={styles.headTop}>
            <h1 className={styles.title}>
              {honoree ? peopleText(responses[honoree.id]) || (b?.requester_name ?? 'Planner & Playlist') : (b?.requester_name ?? 'Planner & Playlist')}
            </h1>
            <PrintButton />
          </div>
          <div className={styles.known}>
            {known.map((row) => (
              <div key={row.k} className={styles.knownRow}>
                <span className={styles.knownK}>{row.k}</span>
                <span className={styles.knownV}>{row.v}</span>
              </div>
            ))}
          </div>
          {status !== 'submitted' && (
            // The client hasn't finished. Printing a half-filled (or blank,
            // not-yet-sent) sheet is fine — but the DJ must not read a blank as
            // "nothing planned" when it's "not answered yet".
            <div className={styles.warn}>
              {planner
                ? 'Not submitted yet — the client may still be filling this in.'
                : 'Blank planner — not sent to the client yet.'}
            </div>
          )}
        </header>

        {/* Every question, in template order — same as the client's form.
            Answered ones show the answer; unanswered ones print a blank line to
            write on. Do NOT Play and Notes are here too, in their normal place,
            so nothing is missing on a blank or half-filled sheet. */}
        <div className={styles.grid}>
          {fields.map((f) => (
            <section
              key={f.id}
              className={f.id === DO_NOT_PLAY_FIELD_ID ? `${styles.block} ${styles.blockNo}` : styles.block}
            >
              <div className={styles.label}>{titleCaseLabel(f.label)}</div>
              <Answer field={f} responses={responses} />
            </section>
          ))}
        </div>

        <footer className={styles.foot}>
          Global DJ Connect · {submitted_at
            ? `submitted ${new Date(submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
            : 'in progress'}
        </footer>
      </div>
    </div>
  );
}

/** The honoree names, as a title. "Sam & Alex" for a couple. */
function peopleText(r: PlannerResponses[string] | undefined): string {
  const v = responseValue(r);
  if (!Array.isArray(v)) return '';
  return (v as Person[]).map((p) => p.name).filter(Boolean).join(' & ');
}

// A blank answer prints as writable rule(s), not a dash — so a downloaded
// planner (blank or half-filled) is a form you can fill by hand. Line counts are
// sized to the question: a name gets one line, a must-play list gets five, a
// free-text note gets two.
function BlankLines({ field }: { field: PlannerField }) {
  const count =
    field.id === HONOREE_FIELD_ID ? 1 :          // guest of honour — one name, one line
    field.type === 'songlist' ? 5 :              // must plays — at least five
    field.type === 'longtext' ? 2 :              // "anything else…" — two lines max
    field.type === 'textlist' || field.type === 'people' || field.type === 'timeline' ? 4 :
    1;
  return (
    <div className={styles.fillLines}>
      {Array.from({ length: count }).map((_, i) => <div key={i} className={styles.fillLine} />)}
    </div>
  );
}

function Answer({ field, responses }: { field: PlannerField; responses: PlannerResponses }) {
  const r = responses[field.id];
  if (isNa(r)) return <div className={styles.na}>N/A</div>;
  if (!hasAnswer(r)) return <BlankLines field={field} />;
  const v = responseValue(r);

  switch (field.type) {
    case 'time':
      return <div className={styles.val}>{fmtTime(String(v))}</div>;
    case 'yesno':
      return <div className={styles.val}>{v === true ? 'Yes' : 'No'}</div>;
    case 'song':
      return <TrackLine t={v as Track} />;
    case 'songlist':
      return (
        <div className={styles.list}>
          {(v as Track[]).map((t, i) => <TrackLine key={i} t={t} n={i + 1} />)}
        </div>
      );
    case 'textlist':
      return (
        <ul className={styles.bullets}>
          {(v as string[]).map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      );
    case 'people':
      return (
        <ol className={styles.people}>
          {(v as Person[]).map((p, i) => (
            <li key={i}>
              <span className={styles.pName}>{p.name}</span>
              {p.role ? <span className={styles.pRole}> — {p.role}</span> : null}
              {/* The one line that stops a name going wrong over a mic. It
                  prints in bold-ish mono precisely because the DJ is scanning
                  this at speed with a microphone already in their hand. */}
              {p.pronunciation ? <span className={styles.say}> [{p.pronunciation}]</span> : null}
            </li>
          ))}
        </ol>
      );
    case 'timeline':
      return (
        <table className={styles.timeline}>
          <tbody>
            {(v as TimelineRow[]).map((row, i) => (
              <tr key={i}>
                <td className={styles.tTime}>{fmtTime(row.time) || '—'}</td>
                <td>{row.label || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'link':
      return <div className={styles.val}>{String(v)}</div>;
    default:
      return <div className={styles.val}>{String(v)}</div>;
  }
}

function TrackLine({ t, n }: { t: Track; n?: number }) {
  return (
    <div className={styles.track}>
      {n ? <span className={styles.trackNum}>{n}.</span> : null}
      <span className={styles.trackText}>
        <strong>{t.title || '(untitled)'}</strong>
        {t.artist ? <span className={styles.artist}> — {t.artist}</span> : null}
      </span>
      {/* On screen, a tap to the track. On paper it's just underlined text,
          which is why the title and artist are the real content and the link is
          decoration — a printed sheet has to work with no device at all. */}
      <a href={playLink(t, 'spotify')} target="_blank" rel="noopener noreferrer" className={styles.trackLink}>
        play
      </a>
    </div>
  );
}
