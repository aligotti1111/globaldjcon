'use client';

// PlannerForm — the client half of /planner/[id].
//
// A ~30-field form that someone fills in over a fortnight, on a phone, in bits,
// while doing something else. Every decision here follows from that sentence.
//
// AUTOSAVE IS NOT A FEATURE, IT'S THE FLOOR. Lose this once and they will not
// do it twice — they'll ring the DJ instead, and the whole thing was pointless.
// There is no Save button on purpose: a Save button is a thing to forget.
//
// N/A IS AN ANSWER. Blank means "hasn't got to it". N/A means "doesn't apply to
// my event". A DJ at 8pm deciding whether to call the father to the floor needs
// to tell those apart, and an empty field can't.
//
// THE PICKER IS NOT A GATE. Every song field searches a catalogue (Deezer) and
// every one of them still takes plain text — a client whose first dance is a
// demo their cousin recorded on a phone must be able to answer. See
// `source: 'manual'` in lib/planner.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './planner.module.css';
import {
  isNa,
  responseValue,
  askedFields,
  infoFields,
  titleCaseLabel,
  type PlannerField,
  type PlannerResponses,
  type Track,
  type Person,
  type TimelineRow,
} from '@/lib/planner';

// Every 30 minutes, 24 hours. Same options the booking form uses — a client
// picking "7:30 PM" here and on the booking form should get the same control.
const TIME_OPTIONS: { val: string; label: string }[] = (() => {
  const out: { val: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      out.push({
        val: `${hh}:${mm}`,
        label: `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${mm} ${h < 12 ? 'AM' : 'PM'}`,
      });
    }
  }
  return out;
})();

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * A known value, as one line of text.
 *
 * Only the simple types turn up here — `prefill` keys map to booking columns,
 * which are dates, times, names and numbers. A songlist can't be prefilled, so
 * it can't reach this. The fallback exists so a future prefill key can't render
 * "[object Object]" at a client.
 */
function infoText(f: PlannerField, responses: PlannerResponses): string {
  const v = responseValue(responses[f.id]);
  if (v === null || v === undefined) return '';
  if (f.type === 'time' && typeof v === 'string') {
    const [hRaw, m] = v.split(':');
    const h = Number(hRaw);
    if (!Number.isFinite(h)) return v;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${m || '00'} ${ampm}`;
  }
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return '';
}

export default function PlannerForm({
  plannerId, fields, initialResponses, initialStatus,
  djName, hostName, eventDateLabel, venueName, known,
}: {
  plannerId: string;
  fields: PlannerField[];
  initialResponses: PlannerResponses;
  initialStatus: 'sent' | 'partial' | 'submitted';
  djName: string;
  hostName: string | null;
  eventDateLabel: string;
  venueName: string | null;
  /** What we already know off the booking. Shown, never asked. */
  known: { k: string; v: string }[];
}) {
  const [responses, setResponses] = useState<PlannerResponses>(initialResponses);
  const [status, setStatus] = useState(initialStatus);
  const [save, setSave] = useState<SaveState>('idle');
  const [submitting, setSubmitting] = useState(false);

  // What hasn't reached the server yet. A ref, not state: it's written on every
  // keystroke and must not re-render the form to do it.
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    const batch = pending.current;
    if (Object.keys(batch).length === 0) return;
    pending.current = {};
    setSave('saving');
    try {
      const res = await fetch(`/api/planner/${plannerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses: batch }),
      });
      if (!res.ok) throw new Error('save failed');
      const j = await res.json() as { status?: 'sent' | 'partial' | 'submitted' };
      if (j.status) setStatus(j.status);
      setSave('saved');
    } catch {
      // Put it BACK. A failed save must not silently drop the answer — the
      // next keystroke retries the whole batch, and closing the tab is the only
      // way to lose it.
      pending.current = { ...batch, ...pending.current };
      setSave('error');
    }
  }, [plannerId]);

  // 800ms after they stop typing. Long enough not to fire per character, short
  // enough that putting the phone down mid-sentence still saves.
  const queue = useCallback((id: string, payload: unknown) => {
    pending.current[id] = payload;
    setSave('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 800);
  }, [flush]);

  /**
   * The last 800ms.
   *
   * Someone types their first dance and immediately locks their phone. The
   * debounce hasn't fired, `fetch` won't survive the page going away, and that
   * answer never existed. This is the difference between a form people finish
   * and a form people give up on.
   *
   * sendBeacon is the only thing that outlives the page — but it can ONLY POST,
   * and POST to this route means submit. So it sends `{ responses, submit:
   * false }`: the route treats a POST without `submit: true` as a plain save
   * (see /api/planner/[id]). Locking your phone must never submit your planner.
   *
   * pagehide, not beforeunload — iOS Safari fires beforeunload unreliably or
   * not at all, and a phone is where this form is actually filled in.
   */
  useEffect(() => {
    const onHide = () => {
      if (Object.keys(pending.current).length === 0) return;
      try {
        navigator.sendBeacon(
          `/api/planner/${plannerId}`,
          new Blob(
            [JSON.stringify({ responses: pending.current, submit: false })],
            { type: 'application/json' },
          ),
        );
        pending.current = {};
      } catch { /* nothing left to try */ }
    };
    const onVis = () => { if (document.visibilityState === 'hidden') onHide(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    return () => {
      // Named, so these actually detach. An anonymous listener passed to
      // addEventListener and a different reference passed to remove leaves the
      // first one attached forever.
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
    };
  }, [plannerId]);

  const setValue = useCallback((id: string, value: unknown) => {
    setResponses((r) => ({ ...r, [id]: { value } }));
    queue(id, { value });
  }, [queue]);

  const setNa = useCallback((id: string, na: boolean) => {
    setResponses((r) => {
      const next = { ...r };
      if (na) next[id] = { na: true }; else delete next[id];
      return next;
    });
    queue(id, na ? { na: true } : null);
  }, [queue]);

  const progress = useMemo(() => {
    let answered = 0;
    for (const f of fields) {
      const r = responses[f.id];
      if (!r) continue;
      if (isNa(r)) { answered++; continue; }
      const v = responseValue(r);
      if (v === null || v === undefined) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      if (Array.isArray(v) && v.length === 0) continue;
      answered++;
    }
    return { answered, total: fields.length };
  }, [fields, responses]);

  async function submit() {
    setSubmitting(true);
    if (timer.current) clearTimeout(timer.current);
    const batch = pending.current;
    pending.current = {};
    try {
      const res = await fetch(`/api/planner/${plannerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // submit: true is what separates this from the beacon's POST. The
        // route saves either way; only this one flips the status.
        body: JSON.stringify({ responses: batch, submit: true }),
      });
      if (!res.ok) throw new Error('submit failed');
      setStatus('submitted');
      setSave('saved');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      pending.current = batch;
      setSave('error');
    } finally {
      setSubmitting(false);
    }
  }

  // If we know it, show it; if we don't, ask it. Derived from the responses, so
  // the same field is a fact on a booking that has a start time and a question
  // on one that doesn't.
  const asked = askedFields(fields, responses);
  const info = infoFields(fields, responses);

  return (
    <div className={styles.page}>
      <div className={styles.sheet}>

        <header className={styles.head}>
          <div className={styles.headBar}>
            <div>
              <div className={styles.brand}>Global DJ Connect</div>
              <h1 className={styles.title}>Planner &amp; Playlist</h1>
            </div>
            {/* Download a PDF anytime — client or DJ. Opens the print view with
                ?download=1 so it downloads on open. Blank, half-filled, or done. */}
            <a
              className={styles.download}
              href={`/planner/${plannerId}/print?download=1`}
              target="_blank"
              rel="noopener noreferrer"
            >
              ↓ Download PDF
            </a>
          </div>
          <p className={styles.sub}>
            {hostName ? `${hostName} · ` : ''}{eventDateLabel}
            {venueName ? ` · ${venueName}` : ''}
          </p>
          <p className={styles.intro}>
            This is what {djName} works from on the night. Nothing is required and
            it saves as you go &mdash; fill in what you know, come back for the rest.
          </p>
          {status === 'submitted' && (
            <div className={styles.submitted}>
              <strong>Sent to {djName}.</strong> You still have time to update the
              information below &mdash; {djName} will be notified. Please have
              everything completed at least <strong>10 days before</strong> the event.
            </div>
          )}
        </header>

        {/* WHAT WE ALREADY KNOW.
            Everything in here came off the booking. Asking a client to type
            their own venue back to us is how they abandon the form on question
            three and never tell us the first dance — which is the only reason
            any of this exists.

            Read-only, and NOT as a compromise: the venue and times are in the
            signed contract. A client editing them in a planner would create two
            sources of truth that disagree, and the one with a signature on it
            would lose. A venue change is a conversation with the DJ. */}
        {(known.length > 0 || info.length > 0) && (
          <div className={styles.known}>
            <div className={styles.knownHead}>Your booking</div>
            {known.map((r) => (
              <div key={r.k} className={styles.knownRow}>
                <span className={styles.knownK}>{r.k}</span>
                <span className={styles.knownV}>{r.v}</span>
              </div>
            ))}
            {/* Prefilled QUESTIONS that came back with a real value — same
                thing, so they read the same way. A prefill with no value is
                still a question and stays in the list below. */}
            {info.map((f) => (
              <div key={f.id} className={styles.knownRow}>
                <span className={styles.knownK}>{titleCaseLabel(f.label)}</span>
                <span className={styles.knownV}>{infoText(f, responses)}</span>
              </div>
            ))}
            <p className={styles.knownNote}>
              These come from your booking and contract. If something has changed &mdash;
              a new venue, a different time &mdash; message {djName} directly; it has to be
              changed there, not here.
            </p>
          </div>
        )}

        <div className={styles.fields}>
          {asked.map((f) => (
            <Field
              key={f.id}
              field={f}
              response={responses[f.id]}
              onValue={(v) => setValue(f.id, v)}
              onNa={(na) => setNa(f.id, na)}
            />
          ))}
        </div>

        <footer className={styles.foot}>
          <div className={styles.progress}>
            {progress.answered} of {progress.total} answered
          </div>
          {status !== 'submitted' && (
            <button
              type="button"
              className={styles.submit}
              onClick={() => void submit()}
              disabled={submitting}
            >
              {submitting ? 'Sending…' : `Send to ${djName}`}
            </button>
          )}
        </footer>

        <p className={styles.note}>
          {/* Not "Saved ✓" as a permanent badge — a status that's always green
              stops being read. This only speaks when it has something to say. */}
          {save === 'saving' && 'Saving…'}
          {save === 'saved' && 'Saved'}
          {save === 'error' && (
            <span className={styles.err}>
              Couldn&rsquo;t save just then &mdash; keep typing, we&rsquo;ll try again.
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// One field
// ─────────────────────────────────────────────────────────────────────────

function Field({
  field, response, onValue, onNa,
}: {
  field: PlannerField;
  response: PlannerResponses[string] | undefined;
  onValue: (v: unknown) => void;
  onNa: (na: boolean) => void;
}) {
  const na = isNa(response);
  const v = responseValue(response);

  return (
    <div className={`${styles.field} ${na ? styles.fieldNa : ''}`}>
      <div className={styles.fieldHead}>
        <label className={styles.label}>{titleCaseLabel(field.label)}</label>
        {/* Every field gets this. A client can't delete a question the DJ asked
            (spec §7) — but "doesn't apply to us" is a real answer and they need
            a way to give it. */}
        <button
          type="button"
          className={styles.naBtn}
          onClick={() => onNa(!na)}
        >
          {na ? 'undo' : 'Not applicable'}
        </button>
      </div>

      {na ? (
        <div className={styles.naBox}>Not applicable</div>
      ) : (
        <>
          {field.help && <p className={styles.help}>{field.help}</p>}
          <Control field={field} value={v} onChange={onValue} />
        </>
      )}
    </div>
  );
}

function Control({
  field, value, onChange,
}: {
  field: PlannerField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.type) {
    case 'text':
      return (
        <input
          className={styles.input}
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'longtext':
      return (
        <textarea
          className={styles.textarea}
          rows={3}
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'time':
      return (
        <select
          className={styles.input}
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select a time…</option>
          {TIME_OPTIONS.map((t) => (
            <option key={t.val} value={t.val}>{t.label}</option>
          ))}
        </select>
      );

    case 'yesno':
      return (
        <div className={styles.yesno}>
          <button
            type="button"
            className={`${styles.toggle} ${value === true ? styles.toggleOn : ''}`}
            onClick={() => onChange(true)}
          >Yes</button>
          <button
            type="button"
            className={`${styles.toggle} ${value === false ? styles.toggleOn : ''}`}
            onClick={() => onChange(false)}
          >No</button>
        </div>
      );

    case 'select':
      return (
        <select
          className={styles.input}
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select…</option>
          {(field.options || []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );

    case 'link':
      return (
        <input
          className={styles.input}
          type="url"
          inputMode="url"
          placeholder="https://…"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'song':
      return <SongInput value={value as Track | undefined} onChange={onChange} />;

    case 'songlist':
      return <SongList value={(value as Track[]) || []} onChange={onChange} />;

    case 'textlist':
      return <TextList value={(value as string[]) || []} onChange={onChange} />;

    case 'people':
      return <PeopleList value={(value as Person[]) || []} onChange={onChange} />;

    case 'timeline':
      return <Timeline value={(value as TimelineRow[]) || []} onChange={onChange} />;

    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Song — search, hear it, tap it. Or type it. Or paste a link.
// ─────────────────────────────────────────────────────────────────────────

/** "At Last — Etta James" → { title, artist }. One split, on the first dash. */
function parseSong(s: string): Track {
  const t = s.trim();
  // A pasted link is a link, not a title. They asked for this explicitly:
  // "if they wanna add song on another site can they paste link" — so the same
  // box takes both, and works out which it got.
  if (/^https?:\/\//i.test(t)) return { title: t, source: 'link', url: t };
  const m = t.split(/\s+[—–-]\s+/);
  return m.length >= 2
    ? { title: m[0].trim(), artist: m.slice(1).join(' - ').trim(), source: 'manual' }
    : { title: t, source: 'manual' };
}

const songToText = (t: Track | undefined): string =>
  !t ? '' : t.artist ? `${t.title} — ${t.artist}` : t.title;

/**
 * ONE audio element for the whole page.
 *
 * Thirty <audio> tags is thirty songs that can play at once, and a client who
 * taps three previews in a row hearing all three. One element, one playing
 * track, and starting a new one stops the last.
 */
let sharedAudio: HTMLAudioElement | null = null;

function PreviewButton({ src }: { src: string }) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => {
    // Leaving the field mid-preview must not leave music playing.
    if (playing && sharedAudio) { sharedAudio.pause(); }
  }, [playing]);

  function toggle(e: React.MouseEvent) {
    // Inside a results row — without this, previewing PICKS the track.
    e.stopPropagation();
    if (!sharedAudio) sharedAudio = new Audio();
    if (playing) { sharedAudio.pause(); setPlaying(false); return; }
    sharedAudio.pause();
    sharedAudio.src = src;
    sharedAudio.onended = () => setPlaying(false);
    sharedAudio.onpause = () => setPlaying(false);
    // Autoplay policy blocks this without a user gesture — a tap IS one, so it
    // resolves. If it rejects anyway (data saver, locked device), fail quiet:
    // they lose a preview, not the form.
    sharedAudio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  return (
    <button type="button" className={styles.play} onClick={toggle}
      aria-label={playing ? 'Stop preview' : 'Play 30 second preview'}>
      {playing ? '❙❙' : '▶'}
    </button>
  );
}

function TrackRow({ t, onPick }: { t: Track; onPick: () => void }) {
  return (
    <button type="button" className={styles.hit} onClick={onPick}>
      {t.album_art
        // eslint-disable-next-line @next/next/no-img-element -- the catalogue's CDN, not our bucket. next/image would proxy someone else's art through our origin for nothing.
        ? <img src={t.album_art} alt="" className={styles.hitArt} />
        : <span className={styles.hitArt} aria-hidden="true" />}
      <span className={styles.hitText}>
        <span className={styles.hitTitle}>{t.title}</span>
        {t.artist ? <span className={styles.hitArtist}>{t.artist}</span> : null}
      </span>
      {t.preview ? <PreviewButton src={t.preview} /> : null}
    </button>
  );
}

/**
 * The song picker.
 *
 * Search the catalogue, hear it, tap it. Falls all the way back to plain text:
 * a client whose first dance is a demo their cousin recorded must still be able
 * to answer, so the picker is a convenience and NEVER a gate.
 */
function SongInput({
  value, onChange,
}: {
  value: Track | undefined;
  onChange: (v: Track | null) => void;
}) {
  // Local text so the caret doesn't jump: the stored value is a parsed object,
  // and re-deriving the string from it on every keystroke would fight the user
  // mid-word.
  const [text, setText] = useState(() => songToText(value));
  const [hits, setHits] = useState<Track[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const picked = value?.source === 'catalogue';

  // 300ms. Every keystroke would be a request per letter — "uptown funk" is 11
  // calls for one answer, against a catalogue that rate-limits.
  useEffect(() => {
    if (picked) return;
    const q = text.trim();
    if (q.length < 2) { setHits([]); return; }
    let active = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/songs/search?q=${encodeURIComponent(q)}`);
        const j = await res.json().catch(() => ({}));
        if (!active) return;
        setHits(Array.isArray(j.tracks) ? j.tracks : []);
        setOpen(true);
      } catch {
        if (active) setHits([]);
      } finally {
        if (active) setSearching(false);
      }
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [text, picked]);

  async function pick(t: Track) {
    setOpen(false);
    setHits([]);
    setText(songToText(t));
    // Store it IMMEDIATELY, then resolve. If the resolve is slow or fails, the
    // client's answer is already saved — the DJ's link is the only thing that
    // degrades, and it degrades to a search.
    onChange(t);
    if (!t.url) return;
    try {
      const res = await fetch('/api/songs/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: t.url }),
      });
      const j = await res.json().catch(() => ({}));
      const l = j?.links || {};
      if (l.spotify || l.apple || l.youtube) {
        onChange({
          ...t,
          ...(l.spotify ? { spotify_url: l.spotify } : {}),
          ...(l.apple ? { apple_url: l.apple } : {}),
          ...(l.youtube ? { youtube_url: l.youtube } : {}),
        });
      }
    } catch {
      // Already saved above. The DJ gets a search link. Nobody notices.
    }
  }

  // Picked: show what they chose, not a text box they might fight with.
  if (picked && value) {
    return (
      <div className={styles.chosen}>
        {value.album_art
          // eslint-disable-next-line @next/next/no-img-element -- see TrackRow.
          ? <img src={value.album_art} alt="" className={styles.hitArt} />
          : <span className={styles.hitArt} aria-hidden="true" />}
        <span className={styles.hitText}>
          <span className={styles.hitTitle}>{value.title}</span>
          {value.artist ? <span className={styles.hitArtist}>{value.artist}</span> : null}
        </span>
        {value.preview ? <PreviewButton src={value.preview} /> : null}
        <button
          type="button"
          className={styles.rm}
          aria-label="Change song"
          onClick={() => { setText(''); onChange(null); }}
        >✕</button>
      </div>
    );
  }

  return (
    <div className={styles.songWrap}>
      <input
        className={styles.input}
        placeholder="Search a song, or type it"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value.trim() ? parseSong(e.target.value) : null);
        }}
        onFocus={() => { if (hits.length) setOpen(true); }}
      />
      {open && hits.length > 0 && (
        <div className={styles.hits}>
          {hits.map((t, i) => <TrackRow key={t.deezer_id || i} t={t} onPick={() => pick(t)} />)}
        </div>
      )}
      {/* Says the quiet part out loud. A client who can't find their song has
          to know the box isn't the only way through, or they abandon here. */}
      <p className={styles.songHint}>
        {searching ? 'Searching…' : 'Can\'t find it? Type it in, or paste a link — that works too.'}
      </p>
    </div>
  );
}

/**
 * Must-plays. The longest list of songs in the planner — so this is where the
 * picker earns its keep, not the one-off fields.
 *
 * Every row is a full SongInput: search, preview, pick. The rows hold Tracks,
 * not strings, because a picked track carries artwork, a preview and the DJ's
 * resolved Spotify link — flattening it to text on the way in would throw all
 * of that away and leave the DJ back where they started.
 */
function SongList({
  value, onChange,
}: {
  value: Track[];
  onChange: (v: Track[]) => void;
}) {
  // undefined = an empty row they haven't filled yet. Kept in local state so an
  // empty row can exist on screen without being saved as an answer.
  //
  // Open with FIVE empty rows. A must-play list wants a few songs, and one lone
  // box reads like "name a song" — five boxes read like "list your songs". They
  // still only cross to the server when filled, and "+ Add another" adds more.
  const MIN_ROWS = 5;
  const [rows, setRows] = useState<(Track | undefined)[]>(() =>
    value.length >= MIN_ROWS
      ? [...value]
      : [...value, ...Array(MIN_ROWS - value.length).fill(undefined)]);

  const push = (next: (Track | undefined)[]) => {
    setRows(next);
    // Only real answers cross to the server. An empty row is someone mid-thought.
    onChange(next.filter((t): t is Track => !!t && !!t.title.trim()));
  };

  return (
    <div className={styles.list}>
      {rows.map((t, i) => (
        <div key={i} className={styles.songRow}>
          <div className={styles.songRowMain}>
            <SongInput
              value={t}
              onChange={(v) => { const n = [...rows]; n[i] = v || undefined; push(n); }}
            />
          </div>
          <button
            type="button"
            className={styles.rm}
            aria-label="Remove"
            onClick={() => push(rows.length === 1 ? [undefined] : rows.filter((_, j) => j !== i))}
          >✕</button>
        </div>
      ))}
      <button type="button" className={styles.add} onClick={() => push([...rows, undefined])}>
        + Add another
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Do NOT play — text only, deliberately. NO picker here, ever.
//
// A do-not-play often isn't a track: "nothing by Nickelback", "no country",
// "nothing explicit before 9". You can't search a catalogue for a rule. And a
// Play button next to a do-not-play would be the single worst button in the
// app — one mis-tap from the exact thing they asked you not to do.
// ─────────────────────────────────────────────────────────────────────────

function TextList({
  value, onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [rows, setRows] = useState<string[]>(() => value.length ? value : ['']);
  const push = (next: string[]) => {
    setRows(next);
    onChange(next.filter((s) => s.trim()));
  };
  return (
    <div className={styles.list}>
      {rows.map((r, i) => (
        <div key={i} className={styles.listRow}>
          <input
            className={`${styles.input} ${styles.inputNo}`}
            placeholder="A song, an artist, a whole genre…"
            value={r}
            onChange={(e) => { const n = [...rows]; n[i] = e.target.value; push(n); }}
          />
          <button
            type="button"
            className={styles.rm}
            aria-label="Remove"
            onClick={() => push(rows.length === 1 ? [''] : rows.filter((_, j) => j !== i))}
          >✕</button>
        </div>
      ))}
      <button type="button" className={styles.add} onClick={() => push([...rows, ''])}>
        + Add another
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// People — ORDER IS THE DATA. Entrance order, lighting order.
// `pronunciation` is why this type exists at all.
// ─────────────────────────────────────────────────────────────────────────

function PeopleList({
  value, onChange,
}: {
  value: Person[];
  onChange: (v: Person[]) => void;
}) {
  const [rows, setRows] = useState<Person[]>(() =>
    value.length ? value : [{ name: '' }]);

  const push = (next: Person[]) => {
    setRows(next);
    onChange(next.filter((p) => p.name?.trim()));
  };
  const set = (i: number, patch: Partial<Person>) => {
    const n = [...rows]; n[i] = { ...n[i], ...patch }; push(n);
  };
  // Up/down, not drag. Drag-and-drop on a phone fights the scroll, and this
  // list exists to be reordered — a control that only works on a desktop makes
  // the field useless for most of the people filling it in.
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const n = [...rows]; [n[i], n[j]] = [n[j], n[i]]; push(n);
  };

  return (
    <div className={styles.list}>
      <div className={styles.peopleHead}>
        <span>Name</span><span>Role</span><span>Say it like</span><span />
      </div>
      {rows.map((p, i) => (
        <div key={i} className={styles.peopleRow}>
          <input className={styles.input} placeholder="Name"
            value={p.name || ''} onChange={(e) => set(i, { name: e.target.value })} />
          <input className={styles.input} placeholder="Role"
            value={p.role || ''} onChange={(e) => set(i, { role: e.target.value })} />
          <input className={styles.input} placeholder="optional"
            value={p.pronunciation || ''} onChange={(e) => set(i, { pronunciation: e.target.value })} />
          <div className={styles.rowTools}>
            <button type="button" className={styles.mv} aria-label="Move up"
              onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
            <button type="button" className={styles.mv} aria-label="Move down"
              onClick={() => move(i, 1)} disabled={i === rows.length - 1}>↓</button>
            <button type="button" className={styles.rm} aria-label="Remove"
              onClick={() => push(rows.length === 1 ? [{ name: '' }] : rows.filter((_, j) => j !== i))}>✕</button>
          </div>
        </div>
      ))}
      <button type="button" className={styles.add} onClick={() => push([...rows, { name: '' }])}>
        + Add another
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Timeline — the run of show.
// ─────────────────────────────────────────────────────────────────────────

function Timeline({
  value, onChange,
}: {
  value: TimelineRow[];
  onChange: (v: TimelineRow[]) => void;
}) {
  const [rows, setRows] = useState<TimelineRow[]>(() =>
    value.length ? value : [{}]);

  const push = (next: TimelineRow[]) => {
    setRows(next);
    onChange(next.filter((r) => r.time || r.label?.trim()));
  };
  const set = (i: number, patch: Partial<TimelineRow>) => {
    const n = [...rows]; n[i] = { ...n[i], ...patch }; push(n);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const n = [...rows]; [n[i], n[j]] = [n[j], n[i]]; push(n);
  };

  return (
    <div className={styles.list}>
      {rows.map((r, i) => (
        <div key={i} className={styles.timeRow}>
          <select className={styles.input} value={r.time || ''}
            onChange={(e) => set(i, { time: e.target.value })}>
            <option value="">Time…</option>
            {TIME_OPTIONS.map((t) => <option key={t.val} value={t.val}>{t.label}</option>)}
          </select>
          <input className={styles.input} placeholder="What happens"
            value={r.label || ''} onChange={(e) => set(i, { label: e.target.value })} />
          <div className={styles.rowTools}>
            <button type="button" className={styles.mv} aria-label="Move up"
              onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
            <button type="button" className={styles.mv} aria-label="Move down"
              onClick={() => move(i, 1)} disabled={i === rows.length - 1}>↓</button>
            <button type="button" className={styles.rm} aria-label="Remove"
              onClick={() => push(rows.length === 1 ? [{}] : rows.filter((_, j) => j !== i))}>✕</button>
          </div>
        </div>
      ))}
      <button type="button" className={styles.add} onClick={() => push([...rows, {}])}>
        + Add another
      </button>
    </div>
  );
}
