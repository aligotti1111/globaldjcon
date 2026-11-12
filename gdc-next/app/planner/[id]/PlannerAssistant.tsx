'use client';

// PlannerAssistant — a floating helper for the HOST filling out their Planner &
// Playlist. It knows this planner's fields and the event type (server-side) and
// walks the host through answering each question. Self-contained inline styles
// so it sits cleanly on either planner theme (dark or light). It only advises —
// the host still types their answers into the form itself.
//
// SONG PREVIEWS: when the assistant recommends a specific song it emits a
// [[SONG: Title — Artist]] marker. We turn each marker into a little card with
// album art and a 30-second play button, using the same Deezer-backed
// /api/songs/search the planner's song picker already uses. Only one preview
// plays at a time.

import { useState, useRef, useEffect } from 'react';

type Msg = { role: 'user' | 'assistant'; content: string };

// One track as /api/songs/search returns it (see lib/planner Track).
type Track = { title: string; artist?: string; album_art?: string; url?: string; preview?: string };

const GREETING =
  "Hi! I can help you fill out your planner. Not sure what to put for a question, or want song ideas for your event? Just ask — like “what should I put for must-play songs?”";

// [[SONG: Title — Artist]] markers the assistant drops inline.
const SONG_RE = /\[\[SONG:\s*([^\]]+?)\s*\]\]/g;

type Seg = { type: 'text'; text: string } | { type: 'song'; raw: string };
function parseSegments(content: string): Seg[] {
  const out: Seg[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  SONG_RE.lastIndex = 0;
  while ((m = SONG_RE.exec(content)) !== null) {
    if (m.index > last) out.push({ type: 'text', text: content.slice(last, m.index) });
    out.push({ type: 'song', raw: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < content.length) out.push({ type: 'text', text: content.slice(last) });
  return out;
}

function splitTitleArtist(raw: string): { title: string; artist?: string } {
  const parts = raw.split(/\s+—\s+|\s+–\s+|\s+-\s+/);
  if (parts.length >= 2) return { title: parts[0].trim(), artist: parts.slice(1).join(' - ').trim() };
  return { title: raw.trim() };
}

// A single recommended song, resolved to a real track with a playable preview.
function SongCard({
  raw, accent, playingUrl, onToggle,
}: {
  raw: string;
  accent: string;
  playingUrl: string | null;
  onToggle: (url: string) => void;
}) {
  const parsed = splitTitleArtist(raw);
  const [track, setTrack] = useState<Track | null>(null);
  const [status, setStatus] = useState<'loading' | 'done' | 'none'>('loading');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const q = [parsed.title, parsed.artist].filter(Boolean).join(' ');
        const res = await fetch(`/api/songs/search?q=${encodeURIComponent(q)}`);
        const d = (await res.json().catch(() => ({}))) as { tracks?: Track[] };
        const t = Array.isArray(d.tracks) && d.tracks.length ? d.tracks[0] : null;
        if (!alive) return;
        if (t) { setTrack(t); setStatus('done'); } else setStatus('none');
      } catch { if (alive) setStatus('none'); }
    })();
    return () => { alive = false; };
  }, [parsed.title, parsed.artist]);

  const title = track?.title || parsed.title;
  const artist = track?.artist || parsed.artist || '';
  const preview = track?.preview;
  const isPlaying = !!preview && playingUrl === preview;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#1b1b24', border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, padding: '8px 10px' }}>
      {/* Art / play button */}
      <button
        type="button"
        onClick={() => preview && onToggle(preview)}
        disabled={!preview}
        aria-label={preview ? (isPlaying ? 'Pause preview' : 'Play 30-second preview') : 'No preview available'}
        title={preview ? 'Play a 30-second preview' : 'No preview available'}
        style={{
          position: 'relative', width: 44, height: 44, flex: '0 0 auto', borderRadius: 8, overflow: 'hidden',
          border: 'none', padding: 0, cursor: preview ? 'pointer' : 'default',
          background: track?.album_art ? `center/cover no-repeat url(${track.album_art})` : '#2a2a35',
        }}
      >
        {preview && (
          <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.38)', color: '#fff', fontSize: 15 }}>
            {isPlaying ? '❚❚' : '▶'}
          </span>
        )}
      </button>

      {/* Title + artist */}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#f0f0f8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        <div style={{ fontSize: 11.5, color: '#9aa0b4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {status === 'loading' ? 'Finding it…' : (artist || (status === 'none' ? 'No preview found' : ''))}
        </div>
      </div>

      {/* Open the full track */}
      {track?.url && (
        <a href={track.url} target="_blank" rel="noopener noreferrer" aria-label="Open song" title="Open the full song"
          style={{ flex: '0 0 auto', color: accent, fontSize: 11, fontWeight: 700, textDecoration: 'none', padding: '4px 6px' }}>
          Open ↗
        </a>
      )}
    </div>
  );
}

export default function PlannerAssistant({
  plannerId,
  accent = '#1f9e74',
}: {
  plannerId: string;
  accent?: string;
}) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, open, busy]);

  // Play one 30-second preview at a time; tap the playing one to stop it.
  function togglePreview(url: string) {
    const a = audioRef.current;
    if (!a) return;
    if (playingUrl === url) { a.pause(); setPlayingUrl(null); return; }
    a.src = url;
    a.play().then(() => setPlayingUrl(url)).catch(() => setPlayingUrl(null));
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    const next: Msg[] = [...msgs, { role: 'user', content: text }];
    setMsgs(next);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/planner-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plannerId, messages: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'The helper is unavailable right now.');
      setMsgs((prev) => [...prev, { role: 'assistant', content: String(data.reply || '') }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open the planner helper"
        style={{
          position: 'fixed', right: 18, bottom: 18, zIndex: 4000,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '12px 18px', borderRadius: 999, border: 'none', cursor: 'pointer',
          background: accent, color: '#fff', fontWeight: 700, fontSize: 14,
          boxShadow: '0 8px 24px rgba(0,0,0,.35)', fontFamily: 'inherit',
        }}
      >
        💬 Need help?
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed', right: 18, bottom: 18, zIndex: 4000,
        width: 'min(380px, calc(100vw - 24px))', height: 'min(540px, 72dvh)',
        display: 'flex', flexDirection: 'column',
        background: '#15151c', color: '#f0f0f8', borderRadius: 16, overflow: 'hidden',
        boxShadow: '0 16px 48px rgba(0,0,0,.5)', border: '1px solid rgba(255,255,255,.08)',
        fontFamily: 'inherit',
      }}
    >
      {/* Shared audio element for the 30-second previews. */}
      <audio ref={audioRef} onEnded={() => setPlayingUrl(null)} style={{ display: 'none' }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#0e0e14', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, display: 'inline-block' }} />
          Planner Helper
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ background: 'none', border: 'none', color: '#9aa0b4', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>✕</button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 4px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ alignSelf: 'flex-start', maxWidth: '88%', background: '#23232e', borderRadius: 12, padding: '10px 13px', fontSize: 13.5, lineHeight: 1.55, color: '#d7d7e2' }}>
          {GREETING}
        </div>
        {msgs.map((m, i) => {
          if (m.role === 'user') {
            return (
              <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '88%', background: accent, color: '#fff', borderRadius: 12, padding: '10px 13px', fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                {m.content}
              </div>
            );
          }
          // Assistant: split prose from [[SONG]] markers. Prose goes in the
          // bubble; each marker becomes a playable song card below it.
          const segs = parseSegments(m.content);
          const text = segs.filter((s): s is { type: 'text'; text: string } => s.type === 'text').map((s) => s.text).join('').trim();
          const songs = segs.filter((s): s is { type: 'song'; raw: string } => s.type === 'song');
          return (
            <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '92%', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {text && (
                <div style={{ background: '#23232e', color: '#d7d7e2', borderRadius: 12, padding: '10px 13px', fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                  {text}
                </div>
              )}
              {songs.map((s, j) => (
                <SongCard key={j} raw={s.raw} accent={accent} playingUrl={playingUrl} onToggle={togglePreview} />
              ))}
            </div>
          );
        })}
        {busy && (
          <div style={{ alignSelf: 'flex-start', background: '#23232e', borderRadius: 12, padding: '10px 13px', fontSize: 13.5, color: '#9aa0b4' }}>Thinking…</div>
        )}
        {/* One-time disclaimer, shown once the helper has answered — so the host
            knows the suggestions are the platform's, not the DJ's. */}
        {msgs.some((m) => m.role === 'assistant') && (
          <div style={{ alignSelf: 'center', textAlign: 'center', maxWidth: '94%', color: '#8a8fa3', fontSize: 11, lineHeight: 1.5, padding: '2px 4px' }}>
            ℹ️ Suggestions and responses here are powered by Global DJ Connect and are not influenced by the DJ you&apos;ve booked.
          </div>
        )}
        {error && (
          <div style={{ alignSelf: 'flex-start', maxWidth: '88%', background: '#3a1f24', color: '#f3b9c1', borderRadius: 12, padding: '10px 13px', fontSize: 13 }}>{error}</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid rgba(255,255,255,.07)' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask about any question…"
          style={{ flex: 1, background: '#0e0e14', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, color: '#fff', padding: '10px 12px', fontSize: 13.5, outline: 'none', fontFamily: 'inherit' }}
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || !input.trim()}
          style={{ background: accent, border: 'none', borderRadius: 10, color: '#fff', padding: '0 14px', fontWeight: 700, fontSize: 13.5, cursor: busy || !input.trim() ? 'default' : 'pointer', opacity: busy || !input.trim() ? 0.6 : 1 }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
