'use client';

// BookingBotSection — "Profile Booking Assistant" card in Account Settings.
// A Premium Pro feature: a chat helper on the DJ's PUBLIC profile that answers a
// booker's questions, quotes a price range, and gets their request started.
// Shows a toggle when the account is eligible (Premium Pro+), or an upsell when
// it isn't. Owner-only (enforced server-side too).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './accountSettings.module.css';
import SectionBanner from '../update-dj-profile/SectionBanner';

const NEON = 'var(--neon,#00e0a4)';
const MUTED = 'var(--muted,#8a8aa0)';

export default function BookingBotSection() {
  const [enabled, setEnabled] = useState(false);
  const [eligible, setEligible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/dj/booking-bot-setting');
        const d = (await res.json().catch(() => ({}))) as { ok?: boolean; enabled?: boolean; eligible?: boolean };
        if (alive && res.ok && d.ok) {
          setEnabled(d.enabled === true);
          setEligible(d.eligible !== false);
        }
      } catch { /* keep defaults */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  async function toggle() {
    if (!eligible) return;
    const next = !enabled;
    setEnabled(next);
    setSaving(true); setSaved(false); setErr(null);
    try {
      const res = await fetch('/api/dj/booking-bot-setting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error || 'Could not save.');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setEnabled(!next);
      setErr(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <div className={styles.card} style={{ padding: 0, overflow: 'hidden' }}>
      <SectionBanner icon="bell" title="Profile Booking Assistant" subtitle="A chat helper on your public profile that answers clients and starts their request." />
      <div style={{ padding: '1.5rem' }}>
        <p style={{ color: MUTED, fontSize: '.85rem', lineHeight: 1.6, margin: '0 0 1rem' }}>
          Adds a chat bubble to your public profile. It answers potential clients&apos;
          questions, gives them a ballpark price from your packages (or your hourly/flat
          rate), and collects their event details to start a booking request — which
          you still approve. It never confirms a date or takes payment.
        </p>

        {!eligible ? (
          <div style={{
            background: 'rgba(0,224,164,.06)', border: '1px solid rgba(0,224,164,.25)',
            borderRadius: 10, padding: '1rem', fontSize: '.85rem', color: '#d4d4dc',
          }}>
            The Booking Assistant is a <b style={{ color: NEON }}>Premium Pro</b> feature.{' '}
            <Link href="/subscribe" style={{ color: NEON, fontWeight: 700 }}>Upgrade to turn it on →</Link>
          </div>
        ) : (
          <>
            {err && <p style={{ color: '#ff9a9a', fontSize: '.82rem', margin: '0 0 .7rem' }}>{err}</p>}
            <div style={{ display: 'flex', alignItems: 'center', gap: '.8rem' }}>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={toggle}
                disabled={saving}
                style={{
                  position: 'relative', width: 50, height: 28, borderRadius: 999,
                  border: '1px solid rgba(255,255,255,.18)',
                  background: enabled ? NEON : '#2a2a33',
                  cursor: saving ? 'default' : 'pointer', transition: 'background .15s', flex: '0 0 auto',
                }}
              >
                <span style={{
                  position: 'absolute', top: 2, left: enabled ? 24 : 2,
                  width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left .15s',
                }} />
              </button>
              <span style={{ color: '#fff', fontSize: '.9rem', fontWeight: 600 }}>{enabled ? 'On' : 'Off'}</span>
              {saving && <span style={{ color: MUTED, fontSize: '.8rem' }}>Saving…</span>}
              {saved && <span style={{ color: NEON, fontSize: '.8rem', fontWeight: 700 }}>Saved ✓</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
