'use client';

// ExpiryBadge — the "Expires in N days" pill on a pending request or an
// unanswered counter-offer. Counts down to the same deadline the auto-decline
// cron enforces: the earlier of MAX_RESPONSE_DAYS after the clock started, or
// midnight entering the event day, in the DJ's timezone. The clock starts at
// created_at for a pending request and at updated_at (when the counter was
// sent) for a countered one. Turns red inside the last two days so it reads as
// urgent.

import { expiryInfo } from '@/lib/bookingExpiry';
import type { BookingRow } from './page';

export default function ExpiryBadge({
  booking,
  tz,
}: {
  booking: BookingRow;
  tz: string | null | undefined;
}) {
  const status = booking.status || 'pending';
  // Both open-negotiation states expire: a pending request (DJ's court) and a
  // countered offer (booker's court).
  if (status !== 'pending' && status !== 'counter') return null;

  // No explicit tz (e.g. a host, who enters no ZIP) → use the device's zone.
  let resolvedTz = tz || null;
  if (!resolvedTz && typeof Intl !== 'undefined') {
    try { resolvedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { /* ignore */ }
  }
  // A counter-offer's clock starts when it was sent (updated_at), not when the
  // request first came in — matching the auto-decline cron.
  const startedAt = status === 'counter' ? (booking.updated_at || booking.created_at) : booking.created_at;
  const info = expiryInfo(startedAt, booking.event_date, resolvedTz);
  if (info.deadlineMs == null || !info.label) return null;

  const urgent = info.expired || info.daysLeft <= 2;
  const bg = urgent ? 'rgba(224,75,74,0.12)' : 'rgba(186,117,23,0.12)';
  const fg = urgent ? '#e04b4a' : '#b0791f';
  const bd = urgent ? 'rgba(224,75,74,0.40)' : 'rgba(186,117,23,0.35)';

  return (
    <div
      title="If you don't respond by then, the request is automatically declined."
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'center',
        background: bg, color: fg, border: `1px solid ${bd}`,
        borderRadius: 20, padding: '3px 11px', fontSize: '.72rem', fontWeight: 700,
        letterSpacing: '.02em', margin: 0, whiteSpace: 'nowrap',
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" />
      </svg>
      {info.label}
    </div>
  );
}
