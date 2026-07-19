// The printable Planner & Playlist — the shared view.
//
// Rendered by TWO pages, so the DJ's copy and the client's copy are identical:
//   · /sheet/[bookingId]        — DJ, keyed on the booking id + session auth.
//   · /planner/[id]/print       — client, keyed on the planner capability url
//                                 (no account), same as /planner/[id].
//
// It's a page-shaped block (dark on screen, black-on-white in the PDF via the
// .export class the Download button toggles), and it renders EVERY question in
// template order — answered ones show the answer, blank ones show writable
// rules — so a downloaded planner reads like a form you can fill by hand and
// matches the on-screen planner one-to-one.

import {
  isNa,
  responseValue,
  hasAnswer,
  playLink,
  DO_NOT_PLAY_FIELD_ID,
  HONOREE_FIELD_ID,
  titleCaseLabel,
  type PlannerField,
  type PlannerResponses,
  type Track,
  type Person,
  type TimelineRow,
} from '@/lib/planner';
import { MOB_EVENT_LABELS } from '@/lib/constants';
import PrintButton from './PrintButton';
import styles from './sheet.module.css';

export interface SheetBooking {
  event_type: string | null;
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
}

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

export default function PlannerSheetView({
  b, fields, responses, status, submittedAt, plannerExists,
}: {
  b: SheetBooking | null;
  fields: PlannerField[];
  responses: PlannerResponses;
  status: string;
  submittedAt: string | null;
  plannerExists: boolean;
}) {
  const honoree = fields.find((f) => f.id === HONOREE_FIELD_ID);

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
    // light/paper styling during capture) and the sheet itself. See PrintButton.
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
            <div className={styles.warn}>
              {plannerExists
                ? 'Not submitted yet — still being filled in.'
                : 'Blank planner — not sent to the client yet.'}
            </div>
          )}
        </header>

        {/* Every question, in template order — same as the client's form.
            Answered ones show the answer; unanswered ones print a blank line to
            write on. */}
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
          Global DJ Connect · {submittedAt
            ? `submitted ${new Date(submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
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

// A blank answer prints as writable rule(s), not a dash. Line counts are sized
// to the question: a name gets one line, a must-play list gets five, a note two.
function BlankLines({ field }: { field: PlannerField }) {
  const count =
    field.id === HONOREE_FIELD_ID ? 1 :
    field.type === 'songlist' ? 5 :
    field.type === 'longtext' ? 2 :
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
      <a href={playLink(t, 'spotify')} target="_blank" rel="noopener noreferrer" className={styles.trackLink}>
        play
      </a>
    </div>
  );
}
