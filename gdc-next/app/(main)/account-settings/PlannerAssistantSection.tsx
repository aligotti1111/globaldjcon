'use client';

// PlannerAssistantSection — "Planner Helper for Clients" card in Account
// Settings (AI Assistant tab). This is the HOST-facing helper that appears on
// the client's Planner & Playlist page and walks them through filling it out.
//
// FREE for every paid Mobile DJ account — this card only lets the DJ turn it
// OFF for their clients. Owner-only (teammates ride the owner's setting). Saves
// immediately on toggle. Mobile-only: the caller only renders it for Mobile DJs
// (club/bar accounts send riders, not planners).

import { useEffect, useState } from 'react';
import styles from './accountSettings.module.css';
import SectionBanner from '../update-dj-profile/SectionBanner';

const NEON = 'var(--neon,#00e0a4)';
const MUTED = 'var(--muted,#8a8aa0)';

export default function PlannerAssistantSection() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/dj/planner-assistant-setting');
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
      const res = await fetch('/api/dj/planner-assistant-setting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error || 'Could not save.');
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
      <SectionBanner icon="bell" title="Planner Helper for Clients" subtitle="A chat helper on your clients' Planner & Playlist page." />
      <div style={{ padding: '1.5rem' }}>
        <p style={{ color: MUTED, fontSize: '.85rem', lineHeight: 1.6, margin: '0 0 1rem' }}>
          When you send a client their Planner &amp; Playlist, a friendly helper
          appears in the corner that walks them through each question and suggests
          song ideas for their kind of event. It&apos;s powered by Global DJ
          Connect — it only explains the form and never fills it in for them.
          Free on your plan. Turn it off here if you&apos;d rather your clients
          not see it.
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
