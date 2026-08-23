'use client';

// TimezoneSection — "Your timezone" card in DJ Settings. Sets the clock used
// for the booking-request response window: a request auto-declines at the
// earlier of 10 days after it arrives, or midnight entering the event day, in
// this timezone. Also what the "Expires in N days" countdown counts against.
//
// Default is AUTOMATIC — derived from the DJ's ZIP (falling back to US Eastern).
// Picking a specific zone overrides that; picking "Automatic" clears it back.

import { useEffect, useState } from 'react';
import styles from './accountSettings.module.css';
import SectionBanner from '../update-dj-profile/SectionBanner';
import { TIMEZONE_OPTIONS } from '@/lib/bookingExpiry';

const NEON = 'var(--neon,#00e0a4)';
const MUTED = 'var(--muted,#8a8aa0)';

const AUTO = 'auto';

function labelFor(tz: string | null): string {
  const o = TIMEZONE_OPTIONS.find((x) => x.value === tz);
  return o ? o.label : (tz || 'US Eastern');
}

export default function TimezoneSection({ audience = 'dj' }: { audience?: 'dj' | 'host' } = {}) {
  const [sel, setSel] = useState<string>(AUTO); // 'auto' or an IANA zone
  const [fromZip, setFromZip] = useState<string | null>(null);
  // Hosts don't enter a ZIP, so "automatic" for them means the timezone their
  // device reports (the same clock their countdown will display in).
  const [browserTz, setBrowserTz] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    try { setBrowserTz(Intl.DateTimeFormat().resolvedOptions().timeZone || null); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/dj/timezone');
        const d = (await res.json().catch(() => ({}))) as {
          ok?: boolean; timezone?: string | null; fromZip?: string | null;
        };
        if (alive && res.ok && d.ok) {
          setSel(d.timezone || AUTO);
          setFromZip(d.fromZip ?? null);
        }
      } catch { /* keep default */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  async function save(next: string) {
    setSel(next);
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

  const autoLabel = audience === 'host'
    ? `Automatic — from your device${browserTz ? ` (${labelFor(browserTz)})` : ''}`
    : fromZip
      ? `Automatic — from your ZIP (${labelFor(fromZip)})`
      : 'Automatic — from your ZIP (US Eastern)';

  return (
    <div className={styles.card} style={{ padding: 0, overflow: 'hidden' }}>
      {/* Hero header — flush to the card edges, same as Booking Settings. */}
      <SectionBanner icon="clock" title="Your Timezone" subtitle="The clock your booking deadlines are measured in." />
      <div style={{ padding: '1.5rem' }}>
      <p style={{ color: MUTED, fontSize: '.85rem', lineHeight: 1.6, margin: '0 0 1rem' }}>
        {audience === 'host' ? (
          <>Sets the timezone your booking times and deadlines show in — like the
          &ldquo;Expires in&rdquo; countdown on requests you send. By default it uses
          your device&apos;s timezone.</>
        ) : (
          <>Booking requests you don&apos;t answer expire automatically — after 10 days, or at
          midnight going into the event day, whichever comes first. This sets the clock those
          deadlines (and the &ldquo;Expires in&rdquo; countdown on each request) are measured in.
          By default it follows your ZIP code.</>
        )}
      </p>

      {err && <p style={{ color: '#ff9a9a', fontSize: '.82rem', margin: '0 0 .7rem' }}>{err}</p>}

      <div style={{ display: 'flex', alignItems: 'center', gap: '.7rem', flexWrap: 'wrap' }}>
        <select
          value={sel}
          onChange={(e) => save(e.target.value)}
          disabled={saving}
          style={{
            background: '#16161f', color: '#fff', border: '1px solid rgba(255,255,255,.18)',
            borderRadius: 8, padding: '10px 12px', fontSize: '.85rem', outline: 'none',
            minWidth: 280, cursor: saving ? 'default' : 'pointer',
          }}
        >
          <option value={AUTO}>{autoLabel}</option>
          {TIMEZONE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {saving && <span style={{ color: MUTED, fontSize: '.8rem' }}>Saving…</span>}
        {saved && <span style={{ color: NEON, fontSize: '.8rem', fontWeight: 700 }}>Saved ✓</span>}
      </div>
      </div>{/* end inner padding wrapper */}
    </div>
  );
}
