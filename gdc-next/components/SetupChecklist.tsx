'use client';

// SetupChecklist — a ONE-TIME "Review booking settings" nudge shown only to a
// DJ during their FIRST subscription. Once they open or dismiss it, the account
// flag users.setup_reviewed flips true and it never shows again — including
// after a cancel → resubscribe, and across devices (the flag lives on the
// account, not in per-browser localStorage).
//
// On the homepage it portals into the search row (#gdc-setup-slot) so it shares
// that line; anywhere else it renders as a slim strip under the header.
//
// Only the ACCOUNT OWNER with booking access (subscribed/comped) ever sees it.

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { createClient } from '@/lib/supabase/client';
import { canBook, type AccessFields } from '@/lib/access';

// ── Legacy helpers kept for import compatibility (BookingSettingsClient still
//    calls markStepViewed on tab view). They no longer drive this component but
//    remain harmless no-op-ish localStorage writers. ─────────────────────────
const viewedKey = (userId: string) => `gdc_setup_viewed_${userId}`;

export function readViewedSteps(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(viewedKey(userId));
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

export function markStepViewed(userId: string, stepId: string) {
  try {
    const set = readViewedSteps(userId);
    if (set.has(stepId)) return;
    set.add(stepId);
    localStorage.setItem(viewedKey(userId), JSON.stringify([...set]));
    window.dispatchEvent(new Event('gdc-setup-progress'));
  } catch { /* localStorage may be unavailable — non-fatal */ }
}

interface Row {
  dj_type: 'mobile' | 'club' | null;
  sub_tier: number | null;
  sub_status: string | null;
  sub_period_end: string | null;
  comp_tier: number | null;
  comp_expires_at: string | null;
  comp_source: string | null;
  setup_reviewed: boolean | null;
}

export default function SetupChecklist() {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const [row, setRow] = useState<Row | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const actingRole = (user as { actingRole?: string } | null)?.actingRole ?? 'owner';
  const isDjOwner = !!user && user.role === 'dj' && actingRole === 'owner';
  const userId = user?.id ?? null;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('users')
        .select('dj_type, sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, comp_source, setup_reviewed')
        .eq('id', userId)
        .maybeSingle();
      setRow((data as unknown as Row) ?? null);
    } catch {
      setRow(null);
    }
  }, [userId]);

  useEffect(() => { if (isDjOwner) load(); }, [isDjOwner, pathname, load]);

  // Locate the homepage search-row slot (retry a few frames; it lives in the
  // hero's injected markup, which may mount a beat after this component).
  useEffect(() => {
    if (!isDjOwner) { setSlot(null); return; }
    let raf = 0; let tries = 0;
    const find = () => {
      const el = typeof document !== 'undefined' ? document.getElementById('gdc-setup-slot') : null;
      if (el) { setSlot(el); return; }
      if (tries++ < 20) raf = requestAnimationFrame(find); else setSlot(null);
    };
    find();
    return () => cancelAnimationFrame(raf);
  }, [isDjOwner, pathname]);

  // Mark the account as having seen the prompt (persists across resubscribe /
  // devices), and hide it immediately.
  const markReviewed = useCallback(() => {
    setDismissed(true);
    void fetch('/api/dj/setup-reviewed', { method: 'POST' }).catch(() => {});
  }, []);

  if (loading || !isDjOwner || dismissed) return null;
  if (!row) return null;
  const djType = row.dj_type;
  if (djType !== 'mobile' && djType !== 'club') return null;
  // Only subscribed/comped owners, and only until they've reviewed once.
  if (!canBook(row as unknown as AccessFields)) return null;
  if (row.setup_reviewed) return null;

  const NEON = 'var(--neon,#00e0a4)';
  const prompt = (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
      <Link
        href="/booking-settings"
        onClick={markReviewed}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none',
          background: NEON, color: '#04121a', fontWeight: 700, fontSize: '.72rem',
          padding: '.4rem .8rem', borderRadius: 999, letterSpacing: '.02em',
        }}
      >
        Review booking settings →
      </Link>
      <button
        type="button"
        onClick={markReviewed}
        aria-label="Dismiss"
        style={{
          background: 'transparent', border: 'none', color: 'var(--muted,#8a8aa0)',
          fontSize: '.9rem', lineHeight: 1, cursor: 'pointer', padding: '2px 4px',
        }}
      >
        ✕
      </button>
    </div>
  );

  if (slot) return createPortal(prompt, slot);
  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,.1)', background: 'rgba(0,0,0,.35)', padding: '.4rem .75rem' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', justifyContent: 'center' }}>{prompt}</div>
    </div>
  );
}
