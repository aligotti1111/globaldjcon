'use client';

// useUpcomingBookingCount — counts the user's upcoming approved bookings
// (and, for hosts/venues, manual events). Used by the mobile menu to show
// a count next to the "Upcoming Bookings" / "Upcoming Events" link so the
// user can see at a glance how much they have on the calendar.
//
// What counts as "upcoming":
//   - For DJs: bookings where I'm the DJ, status = 'approved', event_date >= today
//   - For hosts/venues: bookings where I'm the requester, status = 'approved',
//     event_date >= today  PLUS  manual events I created (is_manual = true,
//     event_date >= today), still on the same `bookings` table.
//
// Polling: same cadence as useUnreadBookingCount (every 30s + on visibility
// change + on demand via 'gdc:refresh-booking-count' window event so booking
// approvals update the count immediately).
//
// Returns 0 when no user is logged in or there's an error — never throws.

import { useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthProvider';
import { createClient } from '@/lib/supabase/client';

const POLL_MS = 30_000;

export function useUpcomingBookingCount(role: 'dj' | 'host' | 'venue' | null | undefined): number {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!user?.id || !role) {
      setCount(0);
      return;
    }

    let cancelled = false;
    const db = createClient();

    async function fetchCount() {
      // Skip when tab is hidden — saves a request every 30s.
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        // YYYY-MM-DD floor in the user's local timezone — Postgres compares
        // event_date (a date column) lexicographically against the ISO
        // string, so this works without timezone conversion.
        const today = new Date();
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        const d = String(today.getDate()).padStart(2, '0');
        const todayStr = `${y}-${m}-${d}`;

        if (role === 'dj') {
          const res = await db
            .from('bookings')
            .select('id', { count: 'exact', head: true })
            .eq('dj_id', user!.id)
            .eq('status', 'approved')
            .gte('event_date', todayStr);
          if (cancelled) return;
          setCount(res.count || 0);
        } else {
          // Hosts/venues: all 'approved' bookings they requested. Manual
          // events also insert with status='approved' on the same table
          // (they're effectively self-approved), so this single query
          // covers both booking-request-approvals AND manual entries —
          // no double counting.
          const res = await db
            .from('bookings')
            .select('id', { count: 'exact', head: true })
            .eq('requester_id', user!.id)
            .eq('status', 'approved')
            .gte('event_date', todayStr);
          if (cancelled) return;
          setCount(res.count || 0);
        }
      } catch {
        // Silent fail — leave previous count in place.
      }
    }

    fetchCount();
    timerRef.current = setInterval(fetchCount, POLL_MS);

    function onVisibilityChange() {
      if (!document.hidden) fetchCount();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    function onRefresh() {
      fetchCount();
    }
    window.addEventListener('gdc:refresh-booking-count', onRefresh);

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('gdc:refresh-booking-count', onRefresh);
    };
  }, [user?.id, role]);

  return count;
}
