'use client';

// TimezoneSection — "Your timezone" card in DJ Settings. Sets the clock used
// for the booking-request response window: a request auto-declines at the
// earlier of 10 days after it arrives, or midnight entering the event day, in
// THIS timezone. Also what the "Expires in N days" countdown counts against.
// Defaults to US Eastern until changed.

import { useEffect, useState } from 'react';
import styles from './accountSettings.module.css';
import { TIMEZONE_OPTIONS, DEFAULT_TZ } from '@/lib/bookingExpiry';

const NEON = 'var(--neon,#00e0a4)';
const MUTED = 'var(--muted,#8a8aa0)';

export default function TimezoneSection() {
  const [tz, setTz] = useState(DEFAULT_TZ);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/dj/timezone');
        const d = (await res.json().catch(() => ({}))) as { ok?: boolean; timezone?: string };
        if (alive && res.ok && d.ok && d.timezone) setTz(d.timezone);
      } catch { /* keep default */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  async function save(next: string) {
    setTz(next);
    setSaving(true); setSaved(false); setErr(null);
    try {
      const res = await fetch('/api/dj/timezone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: next }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error || 'Could not save your timezone.');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save your timezone.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <div className={styles.card}>
      <h2>Your timezone</h2>
      <p style={{ color: MUTED, fontSize: '.85rem', lineHeight: 1.6, margin: '0 0 1rem' }}>
        Booking requests you don&apos;t answer expire automatically — after 10 days, or at
        midnight going into the event day, whichever comes first. This sets the clock those
        deadlines (and the &ldquo;Expires in&rdquo; countdown on each request) are measured in.
      </p>

      {err && <p style={{ color: '#ff9a9a', fontSize: '.82rem', margin: '0 0 .7rem' }}>{err}</p>}

      <div style={{ display: 'flex', alignItems: 'center', gap: '.7rem', flexWrap: 'wrap' }}>
        <select
          value={tz}
          onChange={(e) => save(e.target.value)}
          disabled={saving}
          style={{
            background: '#16161f', color: '#fff', border: '1px solid rgba(255,255,255,.18)',
            borderRadius: 8, padding: '10px 12px', fontSize: '.85rem', outline: 'none',
            minWidth: 260, cursor: saving ? 'default' : 'pointer',
          }}
        >
          {TIMEZONE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {saving && <span style={{ color: MUTED, fontSize: '.8rem' }}>Saving…</span>}
        {saved && <span style={{ color: NEON, fontSize: '.8rem', fontWeight: 700 }}>Saved ✓</span>}
      </div>
    </div>
  );
}
