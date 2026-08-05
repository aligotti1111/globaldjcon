'use client';

// CalendarSyncSection — "Sync to your calendar" card in DJ Settings. Fetches
// the DJ's private subscription link (/api/dj/calendar-token, generated lazily),
// shows a one-tap Subscribe button (webcal://) plus a copyable URL for Google
// Calendar, per-platform instructions, and a Reset link that rotates the token.
//
// Subscribing once puts every approved booking on the DJ's phone AND computer,
// and keeps them in sync as bookings change or cancel — no per-event action.

import { useEffect, useState } from 'react';
import styles from './accountSettings.module.css';

const NEON = 'var(--neon,#00e0a4)';
const MUTED = 'var(--muted,#8a8aa0)';

export default function CalendarSyncSection() {
  const [webcalUrl, setWebcalUrl] = useState('');
  const [httpsUrl, setHttpsUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [howto, setHowto] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/dj/calendar-token');
        const d = (await res.json().catch(() => ({}))) as { ok?: boolean; webcalUrl?: string; httpsUrl?: string; error?: string };
        if (!alive) return;
        if (res.ok && d.ok) { setWebcalUrl(d.webcalUrl || ''); setHttpsUrl(d.httpsUrl || ''); }
        else setErr(d.error || 'Could not load your calendar link.');
      } catch { if (alive) setErr('Could not load your calendar link.'); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  async function copy() {
    try { await navigator.clipboard.writeText(httpsUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  }

  async function reset() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/dj/calendar-token', { method: 'POST' });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; webcalUrl?: string; httpsUrl?: string; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error || 'Could not reset the link.');
      setWebcalUrl(d.webcalUrl || ''); setHttpsUrl(d.httpsUrl || ''); setConfirmReset(false);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not reset the link.'); }
    finally { setBusy(false); }
  }

  if (loading) return null;

  return (
    <div className={styles.card}>
      <h2>Sync to your calendar</h2>
      <p style={{ color: MUTED, fontSize: '.85rem', lineHeight: 1.6, margin: '0 0 1rem' }}>
        Subscribe once and every confirmed booking lands on your phone and computer — and stays in
        sync as bookings change or cancel. Read-only, so nothing you edit in your calendar touches
        Global DJ Connect.
      </p>

      {err && (
        <p style={{ color: '#ff9a9a', fontSize: '.82rem', margin: '0 0 .8rem' }}>{err}</p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.6rem', alignItems: 'center', marginBottom: '.9rem' }}>
        <a
          href={webcalUrl}
          style={{
            display: 'inline-block', background: NEON, color: '#06231b', fontWeight: 800,
            fontSize: '.85rem', padding: '.6rem 1.1rem', borderRadius: 8, textDecoration: 'none',
          }}
        >
          Subscribe on this device
        </a>
        <button
          type="button"
          onClick={() => setHowto((v) => !v)}
          style={{ background: 'transparent', border: 'none', color: NEON, fontWeight: 700, fontSize: '.8rem', cursor: 'pointer', padding: '.4rem' }}
        >
          {howto ? 'Hide steps' : 'How do I add it?'}
        </button>
      </div>

      {/* Copyable URL — for Google Calendar (Other calendars → From URL) and any
          device where the button above isn't the one you're setting up. */}
      <div style={{ fontSize: '.72rem', letterSpacing: '.03em', color: MUTED, marginBottom: '.35rem', textTransform: 'uppercase' }}>
        Calendar link
      </div>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
        <input
          readOnly
          value={httpsUrl}
          onFocus={(e) => e.currentTarget.select()}
          style={{
            flex: '1 1 260px', minWidth: 0, background: '#16161f', color: '#fff',
            border: '1px solid rgba(255,255,255,.18)', borderRadius: 8, padding: '9px 11px',
            fontSize: '.8rem', outline: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        />
        <button
          type="button"
          onClick={copy}
          style={{
            background: 'transparent', color: NEON, border: `1px solid ${NEON}`,
            borderRadius: 8, padding: '9px 14px', fontWeight: 700, fontSize: '.8rem', cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
      </div>

      {howto && (
        <div style={{ marginTop: '1rem', fontSize: '.82rem', color: 'rgba(255,255,255,.8)', lineHeight: 1.7 }}>
          <p style={{ margin: '0 0 .5rem' }}><strong style={{ color: '#fff' }}>iPhone / iPad:</strong> tap <strong>Subscribe on this device</strong> above — iOS opens the Calendar app and asks you to confirm. Done.</p>
          <p style={{ margin: '0 0 .5rem' }}><strong style={{ color: '#fff' }}>Mac (Apple Calendar):</strong> File → New Calendar Subscription, paste the link, Subscribe.</p>
          <p style={{ margin: '0 0 .5rem' }}><strong style={{ color: '#fff' }}>Google Calendar (computer):</strong> left sidebar → Other calendars → <strong>+</strong> → From URL → paste the link → Add calendar. It then appears in the Google Calendar app on your phone too.</p>
          <p style={{ margin: 0, color: MUTED }}>Calendars refresh on the app&apos;s own schedule (often a few hours), so new bookings can take a little while to appear.</p>
        </div>
      )}

      {/* Reset — rotates the token so the old link stops working (use if it ever
          leaks). Existing subscriptions must be re-added with the new link. */}
      <div style={{ marginTop: '1.1rem', paddingTop: '.9rem', borderTop: '1px solid rgba(255,255,255,.08)' }}>
        {!confirmReset ? (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            style={{ background: 'transparent', border: 'none', color: MUTED, fontSize: '.78rem', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
          >
            Reset calendar link
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
            <span style={{ color: '#ffb4b4', fontSize: '.8rem' }}>Reset the link? Any device using the old one stops updating and must re-subscribe.</span>
            <button type="button" onClick={reset} disabled={busy} style={{ background: '#c0392b', color: '#fff', border: 'none', borderRadius: 6, padding: '.4rem .8rem', fontWeight: 700, fontSize: '.78rem', cursor: busy ? 'default' : 'pointer' }}>
              {busy ? 'Resetting…' : 'Yes, reset'}
            </button>
            <button type="button" onClick={() => setConfirmReset(false)} style={{ background: 'transparent', border: 'none', color: MUTED, fontSize: '.78rem', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
