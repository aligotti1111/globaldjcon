'use client';

// useUnreadBookingCount — counts bookings that NEED THE CURRENT USER'S
// ATTENTION (i.e., the ball is in their court). Used by the Header
// booking icon badge so users see at a glance there's something to act on.
//
// What counts as "needs my attention":
//   1. INCOMING bookings where I'm the DJ AND status is 'pending'
//      (someone requested me, I haven't approved/denied/countered yet)
//   2. OUTGOING bookings where I'm the requester AND status is 'counter'
//      (the DJ countered, ball is back in my court)
//
// What does NOT count:
//   - bookings I sent that are still 'pending' (waiting on the DJ)
//   - bookings I received that are in 'counter' status (waiting on booker)
//   - approved/denied/cancelled bookings (no action needed)
//
// Polling: every 30s, plus on tab visibility change, plus on demand
// via the 'gdc:refresh-booking-count' window event (fired by booking
// actions to update the badge immediately without waiting for the
// next poll tick).
//
// Returns 0 when no user is logged in or there's an error — never throws.

import { useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthProvider';
import { createClient } from '@/lib/supabase/client';

const POLL_MS = 30_000;

export function useUnreadBookingCount(): number {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!user?.id) {
      setCount(0);
      return;
    }

    let cancelled = false;
    const db = createClient();

    async function fetchCount() {
      // Skip when tab is hidden — saves a request every 30s.
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        // Two separate counts (incoming pending + outgoing counter) so we
        // can use indexed equality filters cleanly. Postgrest doesn't
        // expose a great way to do compound OR with different equality
        // pairs in a single count query without a custom RPC. Two small
        // count(*) calls are cheap enough.
        const [inRes, outRes] = await Promise.all([
          db
            .from('bookings')
            .select('id', { count: 'exact', head: true })
            .eq('dj_id', user!.id)
            .eq('status', 'pending'),
          db
            .from('bookings')
            .select('id', { count: 'exact', head: true })
            .eq('requester_id', user!.id)
            .eq('status', 'counter'),
        ]);
        if (cancelled) return;
        const total = (inRes.count || 0) + (outRes.count || 0);
        setCount(total);
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
  }, [user?.id]);

  return count;
}
