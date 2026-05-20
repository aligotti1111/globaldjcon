'use client';

// BookingClaimedBanner — one-time confirmation toast shown after a manual
// booking is auto-claimed to a newly-signed-up account.
//
// Trigger: AuthProvider stashes a result object in localStorage under
// `gdc_booking_claimed_result` after successfully calling /api/claim-booking.
// It also dispatches a `gdc-booking-claimed` custom event (because same-tab
// localStorage writes don't fire `storage` events).
//
// Behavior:
//   - Reads the result key on mount + on the custom event
//   - Shows a green confirmation banner with booking summary
//   - "View" link points to /booking-requests (host claim) or
//     /upcoming-bookings (DJ claim)
//   - User can dismiss with × — clears localStorage so it won't re-show
//   - Auto-dismisses after 10 seconds (also clears localStorage)
//
// Mounted in (main)/layout.tsx alongside EmailVerifiedBanner.

import { useEffect, useState } from 'react';
import Link from 'next/link';

const STORAGE_KEY = 'gdc_booking_claimed_result';
const AUTO_DISMISS_MS = 10_000;

interface ClaimResult {
  direction: 'host' | 'dj';
  booking: {
    id: string;
    event_date: string | null;
    start_time: string | null;
    end_time: string | null;
    venue_name: string | null;
    venue_address: string | null;
    from_name: string | null;
  };
  at: number;
}

function readResult(): ClaimResult | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ClaimResult;
  } catch {
    return null;
  }
}

function clearResult() {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export default function BookingClaimedBanner() {
  const [result, setResult] = useState<ClaimResult | null>(null);

  // Pick up the result on mount + on the custom event the AuthProvider
  // fires after a successful claim.
  useEffect(() => {
    setResult(readResult());
    function refresh() { setResult(readResult()); }
    window.addEventListener('gdc-booking-claimed', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('gdc-booking-claimed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // Auto-dismiss after timeout once the banner is visible.
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => {
      clearResult();
      setResult(null);
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [result]);

  function handleDismiss() {
    clearResult();
    setResult(null);
  }

  if (!result) return null;

  const target = result.direction === 'dj' ? '/upcoming-bookings' : '/booking-requests';
  const targetLabel = result.direction === 'dj' ? 'Upcoming Bookings' : 'Booking Requests';

  // Build a concise details string: "Sept 28 at venue"
  const dateStr = formatShortDate(result.booking.event_date);
  const venue = (result.booking.venue_name || '').trim()
    || (result.booking.venue_address || '').split(',')[0].trim()
    || 'event';
  const detailsStr = [dateStr, venue].filter(Boolean).join(' at ');
  const fromStr = result.booking.from_name
    ? `The booking from ${result.booking.from_name}`
    : 'Your booking';

  return (
    <div
      style={{
        background: 'rgba(0, 245, 196, 0.08)',
        borderBottom: '1px solid rgba(0, 245, 196, 0.3)',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        flexWrap: 'wrap',
        fontFamily: "'Space Mono', monospace",
        fontSize: '12px',
        letterSpacing: '0.04em',
        color: '#00f5c4',
        position: 'relative',
        zIndex: 50,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span>
        <strong style={{ color: '#a0ffe6' }}>{fromStr}</strong>
        {detailsStr ? ` for ${detailsStr}` : ''} has been added to your account.{' '}
        <Link
          href={target}
          style={{ color: '#a0ffe6', textDecoration: 'underline' }}
          onClick={handleDismiss}
        >
          View in {targetLabel} →
        </Link>
      </span>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#00f5c4',
          cursor: 'pointer',
          fontSize: '16px',
          lineHeight: 1,
          padding: '0 4px',
          marginLeft: '4px',
          opacity: 0.7,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; }}
      >
        ×
      </button>
    </div>
  );
}

function formatShortDate(d: string | null): string {
  if (!d) return '';
  const [y, m, day] = d.split('-').map((s) => parseInt(s, 10));
  if (!y || !m || !day) return '';
  const dt = new Date(y, m - 1, day);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
