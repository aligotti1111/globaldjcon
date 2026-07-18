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
  DO_NOT_PLAY_FIELD_ID,
  NOTES_FIELD_ID,
  HONOREE_FIELD_ID,
  titleCaseLabel,
  type PlannerField,
  type PlannerResponses,
  type Track,
  type Person,
  type TimelineRow,
} from '@/lib/planner';
import PrintButton from './PrintButton';
import styles from './sheet.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A page with a client's names, songs and phone number on it. Never indexed.
export const metadata = {
  title: 'Run sheet — Global DJ Connect',
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

  // 404 rather than 403 on someone else's booking — a DJ probing ids shouldn't
  // learn which ones exist.
  if (!planner || planner.dj_id !== user.id) notFound();

  const { data: bData } = await admin
    .from('bookings')
    .select('event_type, event_date, start_time, end_time, venue_name, venue_address, guest_count, phone, requester_name, package_title')
    .eq('id', bookingId)
    .maybeSingle();
  const b = bData as unknown as {
    event_type: string | null;
    event_date: string | null;
    start_time: string | null;
    end_time: string | null;
    venue_name: string | null;
    venue_address: string | null;
    guest_count: number | null;
    phone: string | null;
    requester_name: string | null;
    package_title: string | null;
  } | null;

  const responses = planner.responses ?? {};
  const fields = visibleFields(planner.fields ?? []);

  // ── The three things that get their own place on the page ──────────────
  //
  // Everything else prints in template order. These don't, because at 9pm you
  // are not reading this page — you are hunting one thing on it.
  const honoree = fields.find((f) => f.id === HONOREE_FIELD_ID);
  const doNotPlay = fields.find((f) => f.id === DO_NOT_PLAY_FIELD_ID);
  const notes = fields.find((f) => f.id === NOTES_FIELD_ID);
  const pinned = new Set([HONOREE_FIELD_ID, DO_NOT_PLAY_FIELD_ID, NOTES_FIELD_ID]);
  const rest = fields.filter((f) => !pinned.has(f.id));

  const dnp = doNotPlay ? (responseValue(responses[doNotPlay.id]) as string[] | undefined) : undefined;
  const hasDnp = Array.isArray(dnp) && dnp.length > 0;

  return (
    <div className={styles.page}>
      <div className={styles.sheet}>

        <header className={styles.head}>
          <div className={styles.headTop}>
            <h1 className={styles.title}>
              {honoree ? peopleText(responses[honoree.id]) || (b?.requester_name ?? 'Run sheet') : (b?.requester_name ?? 'Run sheet')}
            </h1>
            <PrintButton />
          </div>
          <div className={styles.meta}>
            {[
              fmtDate(b?.event_date ?? null),
              [fmtTime(b?.start_time), fmtTime(b?.end_time)].filter(Boolean).join(' – '),
              b?.venue_name,
              b?.guest_count ? `${b.guest_count} guests` : '',
            ].filter(Boolean).join('  ·  ')}
          </div>
          {b?.venue_address ? <div className={styles.metaSub}>{b.venue_address}</div> : null}
          <div className={styles.metaSub}>
            {[b?.requester_name, b?.phone].filter(Boolean).join('  ·  ')}
          </div>
          {planner.status !== 'submitted' && (
            // The client hasn't finished. Printing a half-filled sheet is fine
            // — it's most of the night — but the DJ must not read a blank as
            // "nothing planned" when it's "not answered yet".
            <div className={styles.warn}>
              Not submitted yet — the client may still be filling this in.
            </div>
          )}
        </header>

        {/* DO NOT PLAY, FIRST AND LOUD.
            It's last on the client's form (they need to have thought about the
            night before they know what they hate) and first here (it's the only
            answer with a cost, and the one you need BEFORE someone requests
            it). Same data, opposite order, for the same reason. */}
        {hasDnp && (
          <section className={styles.dnp}>
            <div className={styles.dnpHead}>Do NOT play</div>
            <ul className={styles.dnpList}>
              {dnp!.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </section>
        )}

        <div className={styles.grid}>
          {rest.map((f) => (
            <section key={f.id} className={styles.block}>
              <div className={styles.label}>{titleCaseLabel(f.label)}</div>
              <Answer field={f} responses={responses} />
            </section>
          ))}
        </div>

        {notes && hasAnswer(responses[notes.id]) && (
          <section className={styles.notes}>
            <div className={styles.label}>{titleCaseLabel(notes.label)}</div>
            <div className={styles.notesBody}>{String(responseValue(responses[notes.id]) ?? '')}</div>
          </section>
        )}

        <footer className={styles.foot}>
          Global DJ Connect · {planner.submitted_at
            ? `submitted ${new Date(planner.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
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

function Answer({ field, responses }: { field: PlannerField; responses: PlannerResponses }) {
  const r = responses[field.id];
  if (isNa(r)) return <div className={styles.na}>N/A</div>;
  if (!hasAnswer(r)) return <div className={styles.blank}>—</div>;
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
