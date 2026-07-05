'use client';

// ActivateBookingBanner — site-wide nudge for a DJ who has subscribed (or been
// comped) but hasn't finished setting up booking, so their Book button isn't
// live yet. Tells them the exact next step.
//
// Behavior:
//   • Shows only for a DJ with booking access (subscription/comp) AND
//     incomplete setup (mobile: no bookable package; club: no equipment).
//   • Disappears permanently the moment setup is complete.
//   • Dismissible. Once dismissed it hides for the rest of that day and
//     reshows the next day — but only within a 7-day window from when it
//     first appeared. After 7 days it stops nagging.
//
// It's self-contained: it fetches the DJ's own subscription + booking_settings
// client-side (RLS allows reading your own row), so it doesn't depend on the
// auth context carrying the sub/comp columns. All localStorage access happens
// inside the effect (client-only) to avoid SSR issues.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from './AuthProvider';
import { createClient } from '@/lib/supabase/client';
import { canBook, type AccessFields } from '@/lib/access';
import {
  parseBookingSettings,
  packageTiers,
  type BookingSettings,
} from '@/app/(main)/[slug]/bookingSettings';

const WINDOW_DAYS = 7;

// Local "YYYY-M-D" key for a date (used for per-day dismissal + window math).
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function parseDayKey(k: string): Date {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

// Setup completeness — mirrors the public-profile gate.
function isSetupComplete(djType: string | null, bs: BookingSettings | null): boolean {
  if (!bs) return false;
  if (djType === 'club') {
    return !!(bs.equip_full || bs.equip_decks || bs.equip_none);
  }
  // mobile: at least one bookable package (title + real pricing or reqAll)
  const packs = bs.mob_packages || {};
  return Object.values(packs).some(
    (arr) =>
      Array.isArray(arr) &&
      arr.some(
        (pkg) =>
          !!pkg &&
          !!(pkg.title && String(pkg.title).trim()) &&
          (pkg.reqAll === true || packageTiers(pkg).length > 0)
      )
  );
}

export default function ActivateBookingBanner() {
  const { user, loading } = useAuth();
  // What to render: a message + dj type, or null to hide.
  const [view, setView] = useState<{ msg: string } | null>(null);
  // Bumped on dismiss to re-run the visibility effect.
  const [tick, setTick] = useState(0);

  const userId = user?.id;
  const role = user?.role;

  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!userId || role !== 'dj') {
        if (mounted) setView(null);
        return;
      }

      const supabase = createClient();
      const { data } = await supabase
        .from('users')
        .select('sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, dj_type, booking_settings')
        .eq('id', userId)
        .maybeSingle();

      if (!mounted) return;
      if (!data) {
        setView(null);
        return;
      }

      const row = data as unknown as AccessFields & {
        dj_type: string | null;
        booking_settings: string | null;
      };

      const startKey = `gdc_activate_start_${userId}`;
      const dismKey = `gdc_activate_dismissed_${userId}`;

      // Only for subscribed/comped DJs.
      if (!canBook(row)) {
        setView(null);
        return;
      }

      // Complete → clear nudge state and never show again.
      const bs = parseBookingSettings(row.booking_settings);
      if (isSetupComplete(row.dj_type, bs)) {
        try {
          window.localStorage.removeItem(startKey);
          window.localStorage.removeItem(dismKey);
        } catch { /* ignore */ }
        setView(null);
        return;
      }

      // Establish/read the nudge start date.
      let start: string | null = null;
      try {
        start = window.localStorage.getItem(startKey);
        if (!start) {
          start = dayKey(new Date());
          window.localStorage.setItem(startKey, start);
        }
      } catch {
        // localStorage unavailable — fall back to showing (no persistence).
        start = dayKey(new Date());
      }

      // Past the 7-day window? Stop nagging.
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const startDate = parseDayKey(start);
      startDate.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((today.getTime() - startDate.getTime()) / 86_400_000);
      if (diffDays >= WINDOW_DAYS) {
        setView(null);
        return;
      }

      // Dismissed already today? Hide until tomorrow.
      let dismissed: string | null = null;
      try {
        dismissed = window.localStorage.getItem(dismKey);
      } catch { /* ignore */ }
      if (dismissed === dayKey(new Date())) {
        setView(null);
        return;
      }

      const msg =
        row.dj_type === 'club'
          ? "You're subscribed! Pick an equipment option to activate booking on your profile."
          : "You're subscribed! Add your first package to activate booking on your profile.";
      setView({ msg });
    })();

    return () => {
      mounted = false;
    };
  }, [userId, role, tick]);

  if (loading || !view) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(`gdc_activate_dismissed_${userId}`, dayKey(new Date()));
    } catch { /* ignore */ }
    setTick((t) => t + 1);
  }

  return (
    <div
      style={{
        background: 'rgba(0, 224, 164, 0.08)',
        borderBottom: '1px solid rgba(0, 224, 164, 0.3)',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        flexWrap: 'wrap',
        fontFamily: "'Space Mono', monospace",
        fontSize: '12px',
        letterSpacing: '0.04em',
        color: 'var(--neon, #00e0a4)',
        position: 'relative',
        zIndex: 50,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
      <span>{view.msg}</span>
      <Link
        href="/booking-settings"
        style={{
          background: 'transparent',
          border: '1px solid rgba(0, 224, 164, 0.4)',
          color: 'var(--neon, #00e0a4)',
          padding: '4px 10px',
          borderRadius: '4px',
          fontFamily: 'inherit',
          fontSize: '11px',
          letterSpacing: 'inherit',
          textTransform: 'uppercase',
          textDecoration: 'none',
          cursor: 'pointer',
        }}
      >
        Booking Settings
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          position: 'absolute',
          right: '12px',
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'transparent',
          border: 'none',
          color: 'var(--neon, #00e0a4)',
          fontSize: '16px',
          lineHeight: 1,
          cursor: 'pointer',
          opacity: 0.7,
        }}
      >
        ×
      </button>
    </div>
  );
}
