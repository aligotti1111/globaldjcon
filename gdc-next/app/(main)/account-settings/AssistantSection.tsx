'use client';

// AssistantSection — "AI Assistant" card in Account Settings. A simple on/off
// switch that hides or shows the floating booking helper for this account.
// Owner-only (teammates ride the owner's setting). Saves immediately on toggle.

import { useEffect, useState } from 'react';
import styles from './accountSettings.module.css';
import SectionBanner from '../update-dj-profile/SectionBanner';

const NEON = 'var(--neon,#00e0a4)';
const MUTED = 'var(--muted,#8a8aa0)';

export default function AssistantSection() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/dj/assistant-setting');
        const d = (await res.json().catch(() => ({}))) as { ok?: boolean; enabled?: boolean };
        if (alive && res.ok && d.ok) setEnabled(d.enabled !== false);
      } catch { /* keep default ON */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setSaving(true); setSaved(false); setErr(null);
    try {
      const res = await fetch('/api/dj/assistant-setting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error || 'Could not save.');
      // Tell the floating widget to show/hide immediately (no refresh needed).
      window.dispatchEvent(new CustomEvent('gdc:assistant-toggled', { detail: { enabled: next } }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setEnabled(!next); // revert on failure
      setErr(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <div className={styles.card} style={{ padding: 0, overflow: 'hidden' }}>
      <SectionBanner icon="bell" title="Your Personal AI Assistant" subtitle="Your in-app helper for questions about your bookings." />
      <div style={{ padding: '1.5rem' }}>
        <p style={{ color: MUTED, fontSize: '.85rem', lineHeight: 1.6, margin: '0 0 1rem' }}>
          Shows a chat helper in the corner of your dashboard. Ask it about your own
          bookings and earnings (&ldquo;who owes me money?&rdquo;, &ldquo;what&apos;s on the books next
          month?&rdquo;) or where to find things in the app. It&apos;s read-only — it never
          sends, changes, or shares anything. Turn it off here if you&apos;d rather not see it.
        </p>

        {err && <p style={{ color: '#ff9a9a', fontSize: '.82rem', margin: '0 0 .7rem' }}>{err}</p>}

        <div style={{ display: 'flex', alignItems: 'center', gap: '.8rem' }}>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={toggle}
            disabled={saving}
            style={{
              position: 'relative',
              width: 50, height: 28, borderRadius: 999,
              border: '1px solid rgba(255,255,255,.18)',
              background: enabled ? NEON : '#2a2a33',
              cursor: saving ? 'default' : 'pointer',
              transition: 'background .15s',
              flex: '0 0 auto',
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: enabled ? 24 : 2,
              width: 22, height: 22, borderRadius: '50%',
              background: '#fff', transition: 'left .15s',
            }} />
          </button>
          <span style={{ color: '#fff', fontSize: '.9rem', fontWeight: 600 }}>
            {enabled ? 'On' : 'Off'}
          </span>
          {saving && <span style={{ color: MUTED, fontSize: '.8rem' }}>Saving…</span>}
          {saved && <span style={{ color: NEON, fontSize: '.8rem', fontWeight: 700 }}>Saved ✓</span>}
        </div>
      </div>
    </div>
  );
}
