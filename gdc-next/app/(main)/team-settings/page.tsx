'use client';

// /team-settings — the exception surface: Owner/Admin/Manager can flip the
// rider & guest-list toggles and edit the default rider here, even though the
// rest of Booking Settings is owner-only. Saves via the role-gated route.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import RiderBuilder from '@/components/RiderBuilder';
import { normalizeRiderItems, normalizeRiderMode, STARTER_RIDER, type RiderItem, type RiderMode } from '@/lib/rider';

export default function TeamSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(true);
  const [riderEnabled, setRiderEnabled] = useState(false);
  const [guestlistEnabled, setGuestlistEnabled] = useState(false);
  const [riderDefault, setRiderDefault] = useState<RiderItem[]>([]);
  const [riderMode, setRiderMode] = useState<RiderMode>('custom');
  const [riderPdfUrl, setRiderPdfUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/team/settings');
      if (res.status === 403) { setAllowed(false); return; }
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; riderEnabled?: boolean; guestlistEnabled?: boolean; riderDefault?: unknown; riderMode?: unknown; riderPdfUrl?: string | null };
      if (res.ok && data.ok) {
        setRiderEnabled(!!data.riderEnabled);
        setGuestlistEnabled(!!data.guestlistEnabled);
        setRiderDefault(normalizeRiderItems(data.riderDefault));
        setRiderMode(normalizeRiderMode(data.riderMode));
        setRiderPdfUrl(data.riderPdfUrl || null);
      }
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    setBusy(true); setErr(null); setNote(null);
    try {
      const res = await fetch('/api/team/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ riderEnabled, guestlistEnabled, riderMode, riderPdfUrl, riderDefault: riderDefault.filter((i) => i.section === 'hospitality' || i.section === 'custom') }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not save.');
      setNote('Saved.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setBusy(false); }
  }

  const muted = 'var(--muted,#8a8aa0)';
  const Toggle = ({ on, set, label, hint }: { on: boolean; set: (v: boolean) => void; label: string; hint: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '.7rem 0', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div style={{ color: muted, fontSize: '.8rem', lineHeight: 1.5 }}>{hint}</div>
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => set(!on)}
        style={{ position: 'relative', width: 46, height: 26, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0, padding: 0, background: on ? 'var(--neon,#00e0a4)' : 'rgba(255,255,255,.18)' }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff' }} />
      </button>
    </div>
  );

  if (loading) return <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem', color: muted }}>Loading…</div>;
  if (!allowed) return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem' }}>
      <Link href="/upcoming-bookings" style={{ color: muted, fontSize: '.85rem', textDecoration: 'none' }}>← Back</Link>
      <h1 style={{ margin: '.6rem 0' }}>Rider & Guest List Settings</h1>
      <p style={{ color: muted }}>Only the Owner, Admin, and Manager can change these settings.</p>
    </div>
  );

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem 3rem' }}>
      <Link href="/upcoming-bookings" style={{ color: muted, fontSize: '.85rem', textDecoration: 'none' }}>← Back to bookings</Link>
      <h1 style={{ margin: '.6rem 0 .3rem', fontSize: '1.6rem' }}>Rider & Guest List Settings</h1>
      <p style={{ color: muted, fontSize: '.88rem', lineHeight: 1.6, margin: '0 0 1.4rem' }}>
        Turn the club/bar Rider and Guest List steps on or off, and set the default hospitality items every rider starts from. The technical section is filled from each booking&rsquo;s equipment choice.
      </p>

      <Toggle on={riderEnabled} set={setRiderEnabled} label="Enable DJ Rider" hint="Adds the Rider step to club/bar bookings." />
      <Toggle on={guestlistEnabled} set={setGuestlistEnabled} label="Enable Guest List" hint="Adds the Guest List step to club/bar bookings." />

      <div style={{ marginTop: '1.4rem' }}>
        <div style={{ fontWeight: 700, marginBottom: '.6rem' }}>Default rider</div>
        <RiderBuilder
          mode={riderMode}
          onModeChange={setRiderMode}
          items={riderDefault}
          onItemsChange={setRiderDefault}
          pdfUrl={riderPdfUrl}
          onPdfUrlChange={setRiderPdfUrl}
          sections={['hospitality', 'custom']}
        />
        {riderMode === 'custom' && riderDefault.filter((i) => i.section === 'hospitality' || i.section === 'custom').length === 0 && (
          <button type="button" onClick={() => setRiderDefault(STARTER_RIDER.filter((i) => i.section === 'hospitality').map((i) => ({ ...i })))}
            style={{ marginTop: '.8rem', background: 'transparent', border: '1px solid var(--neon,#00e0a4)', borderRadius: 8, color: 'var(--neon,#00e0a4)', padding: '.5rem .9rem', fontSize: '.85rem', fontWeight: 700, cursor: 'pointer' }}>
            Load starter hospitality
          </button>
        )}
      </div>

      {err && <div style={{ color: '#ff8f8f', fontSize: '.85rem', marginTop: '1rem' }}>{err}</div>}
      {note && !err && <div style={{ color: 'var(--neon,#00e0a4)', fontSize: '.85rem', marginTop: '1rem' }}>{note}</div>}
      <div style={{ marginTop: '1.4rem' }}>
        <button type="button" onClick={save} disabled={busy}
          style={{ background: 'var(--neon,#00e0a4)', border: 'none', borderRadius: 8, color: '#06231b', padding: '.65rem 1.4rem', fontWeight: 700, fontSize: '.88rem', cursor: 'pointer' }}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
