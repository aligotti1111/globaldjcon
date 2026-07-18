'use client';

// The DJ's read view of a client's Planner & Playlist.
//
// NOT the form. The client's page is a form because they're entering things
// over a week on a phone; this is read at 7pm in a venue on a laptop, once,
// looking for one specific thing — usually a name, a time, or whether they can
// play the song someone just requested.
//
// So the priorities are inverted from the form's:
//   · Do NOT play is loud and red. It's the one answer with a cost attached.
//   · Pronunciation sits under the name, because that's the moment it's needed.
//   · Unanswered questions still show, greyed. "They didn't say" is information
//     — a blank you can't see is a blank you find out about on the mic.
//   · N/A is rendered as an answer, because it is one: "no father-daughter
//     dance" and "hasn't got to that question" are different nights.
//
// Loads lazily — see the route's header for why the page doesn't just pass it.

import { useEffect, useState } from 'react';
import {
  isNa,
  responseValue,
  plannerProgress,
  playLink,
  isExactLink,
  titleCaseLabel,
  DO_NOT_PLAY_FIELD_ID,
  type PlannerField,
  type PlannerResponses,
  type Track,
  type Person,
  type TimelineRow,
} from '@/lib/planner';
import styles from './plannerPanel.module.css';

interface LoadedPlanner {
  id: string;
  status: 'sent' | 'partial' | 'submitted';
  sent_at: string | null;
  submitted_at: string | null;
  fields: PlannerField[];
  responses: PlannerResponses;
}

function fmtTime(t: string): string {
  // "19:30" → "7:30 PM". The client picked from a 24h list; the DJ reads clocks.
  const [hRaw, m] = t.split(':');
  const h = Number(hRaw);
  if (!Number.isFinite(h)) return t;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m || '00'} ${ampm}`;
}

function TrackLine({ t }: { t: Track }) {
  const title = t.title || '(untitled)';
  const href = playLink(t, 'spotify');
  // Exact vs search. The client picked it out of a list, so we resolved the real
  // Spotify track at that moment — this is the payoff: at 9pm you tap once and
  // land on the song, instead of tapping into a search and scanning it. When we
  // couldn't resolve one (typed free text, or the track isn't on Spotify), the
  // link is a search and says so, because a DJ who taps expecting the track and
  // gets a search needs to know why.
  const exact = isExactLink(t);
  return (
    <div className={styles.track}>
      {t.album_art
        // eslint-disable-next-line @next/next/no-img-element -- the catalogue's CDN, not our bucket; next/image would proxy someone else's art through our origin for no gain.
        ? <img src={t.album_art} alt="" className={styles.art} />
        : <span className={styles.artFallback} aria-hidden="true">♪</span>}
      <span className={styles.trackText}>
        <strong>{title}</strong>
        {t.artist ? <span className={styles.artist}> — {t.artist}</span> : null}
      </span>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={exact ? styles.trackLink : styles.trackLinkWeak}
        title={exact ? 'Open this track in Spotify' : 'Search Spotify — this one wasn\'t matched automatically'}
      >
        {exact ? 'Spotify' : 'search'}
      </a>
    </div>
  );
}

function Answer({ field, responses }: { field: PlannerField; responses: PlannerResponses }) {
  const r = responses[field.id];

  if (isNa(r)) return <div className={styles.na}>Not applicable</div>;

  const v = responseValue(r);
  const empty =
    v === undefined || v === null ||
    (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0);
  // Greyed, not hidden. See the header.
  if (empty) return <div className={styles.blank}>Not answered</div>;

  switch (field.type) {
    case 'time':
      return <div className={styles.val}>{fmtTime(String(v))}</div>;
    case 'yesno':
      return <div className={styles.val}>{v === true ? 'Yes' : 'No'}</div>;
    case 'link':
      return (
        <a href={String(v)} target="_blank" rel="noopener noreferrer" className={styles.link}>
          {String(v)}
        </a>
      );
    case 'longtext':
      return <div className={styles.longVal}>{String(v)}</div>;
    case 'song':
      return <TrackLine t={v as Track} />;
    case 'songlist':
      return (
        <div className={styles.list}>
          {(v as Track[]).map((t, i) => <TrackLine key={i} t={t} />)}
        </div>
      );
    case 'textlist': {
      const items = v as string[];
      // Do NOT play is the one list that gets shouted. Everything else is a
      // list of things to do; this is the list of things that end the night.
      const danger = field.id === DO_NOT_PLAY_FIELD_ID;
      return (
        <ul className={`${styles.bullets} ${danger ? styles.bulletsNo : ''}`}>
          {items.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      );
    }
    case 'people':
      return (
        <div className={styles.list}>
          {(v as Person[]).map((p, i) => (
            <div key={i} className={styles.person}>
              <span className={styles.personName}>{p.name || '(no name)'}</span>
              {p.role ? <span className={styles.role}>{p.role}</span> : null}
              {/* The reason this field type exists. Getting a name wrong over a
                  mic is the one thing a DJ can't take back — so it's under the
                  name, not tucked in a column at the end. */}
              {p.pronunciation ? <span className={styles.say}>say: {p.pronunciation}</span> : null}
            </div>
          ))}
        </div>
      );
    case 'timeline':
      return (
        <div className={styles.list}>
          {(v as TimelineRow[]).map((row, i) => (
            <div key={i} className={styles.timeRow}>
              <span className={styles.timeCell}>{row.time ? fmtTime(row.time) : '—'}</span>
              <span>{row.label || ''}</span>
            </div>
          ))}
        </div>
      );
    default:
      return <div className={styles.val}>{String(v)}</div>;
  }
}

export default function PlannerPanel({ bookingId }: { bookingId: string }) {
  const [planner, setPlanner] = useState<LoadedPlanner | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/planner/for-booking/${bookingId}`);
        const j = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) { setErr(j?.error || 'Could not load the planner.'); return; }
        setPlanner(j.planner || null);
      } catch {
        if (active) setErr('Could not load the planner.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    // Cleanup, or a row closed mid-request setStates on an unmounted component.
    return () => { active = false; };
  }, [bookingId]);

  if (loading) return <div className={styles.quiet}>Loading…</div>;
  if (err) return <div className={styles.quiet}>{err}</div>;
  // Not requested. The strip's dropdown is where you send one — this panel
  // doesn't duplicate the action, it would be a second button meaning the same
  // thing in a different place.
  if (!planner) return <div className={styles.quiet}>No planner has been sent for this booking yet.</div>;

  const { answered, total } = plannerProgress(planner.fields, planner.responses);
  const done = planner.status === 'submitted';

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={done ? styles.badgeDone : styles.badge}>
          {done ? 'Submitted' : planner.status === 'partial' ? 'In progress' : 'Sent — not started'}
        </span>
        <span className={styles.count}>{answered}/{total} answered</span>
        {/* Even a submitted planner stays open — a client who remembers their
            mother's song on the Friday must be able to add it. So the DJ needs
            to know how fresh this is, not just that it arrived. */}
        {planner.submitted_at ? (
          <span className={styles.when}>
            {new Date(planner.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        ) : null}
        {/* The night version. Opens outside the app chrome — one page, prints
            to paper, saves as a PDF, works on a phone in a booth. */}
        <a
          href={`/sheet/${bookingId}`}
          target="_blank"
          rel="noopener noreferrer"
          className={planner.submitted_at ? styles.sheetLink : `${styles.sheetLink} ${styles.sheetLinkPush}`}
        >
          Run sheet
        </a>
      </div>

      {planner.fields.map((f) => (
        <div key={f.id} className={f.id === DO_NOT_PLAY_FIELD_ID ? styles.fieldNo : styles.field}>
          <div className={styles.label}>{titleCaseLabel(f.label)}</div>
          <Answer field={f} responses={planner.responses} />
        </div>
      ))}
    </div>
  );
}
