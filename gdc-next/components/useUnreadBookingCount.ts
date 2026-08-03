'use client';

// useUnreadBookingCount — counts bookings that NEED THE CURRENT USER'S
// ATTENTION (i.e., the ball is in their court), MINUS the ones the user has
// already reviewed. Used by the Header booking icon badge.
//
// What qualifies as "needs my attention":
//   1. INCOMING bookings where I'm the DJ AND status is 'pending'
//      (someone requested me, I haven't approved/denied/countered yet)
//   2. OUTGOING bookings where I'm the requester AND status is 'counter'
//      (the DJ countered, ball is back in my court)
//
// "Seen" behavior (matches the notification bell): clicking the booking icon
// marks everything currently qualifying as seen (persisted in localStorage), so
// the badge clears the instant you open the page and only comes back when
// something NEW arrives — a fresh request, or a booking that just moved into
// 'counter'. We key each qualifying booking by `${id}:${status}`, so a booking
// you already saw as 'pending' will re-alert if it later becomes 'counter'.
//
// Polling: every 30s, plus on tab visibility change, plus on demand via the
// 'gdc:refresh-booking-count' window event. The badge clears in real time via
// the 'gdc:mark-bookings-seen' event, which the Header fires when the icon is
// clicked.
//
// Returns 0 when no user is logged in or there's an error — never throws.

import { useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthProvider';
import { createClient } from '@/lib/supabase/client';

const POLL_MS = 30_000;
const SEEN_KEY = 'gdc_bookings_seen_keys';

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}

export function useUnreadBookingCount(): number {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  // The keys (`${id}:${status}`) that currently qualify — kept in a ref so the
  // "mark seen" handler can snapshot exactly what's on screen right now.
  const keysRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!user?.id) {
      setCount(0);
      keysRef.current = [];
      return;
    }

    let cancelled = false;
    const db = createClient();

    // Recompute the badge from the current qualifying keys minus the seen set.
    function recompute() {
      const seen = readSeen();
      const n = keysRef.current.reduce((a, k) => (seen.has(k) ? a : a + 1), 0);
      if (!cancelled) setCount(n);
    }

    async function fetchCount() {
      // Skip when tab is hidden — saves a request every 30s.
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        // Fetch the qualifying booking ids (incoming pending + outgoing
        // counter). These sets are small, so pulling ids instead of a bare
        // count is cheap and lets us diff against what's already been seen.
        const [inRes, outRes] = await Promise.all([
          db
            .from('bookings')
            .select('id')
            .eq('dj_id', user!.id)
            .eq('status', 'pending'),
          db
            .from('bookings')
            .select('id')
            .eq('requester_id', user!.id)
            .eq('status', 'counter'),
        ]);
        if (cancelled) return;
        const keys = [
          ...((inRes.data as { id: string }[] | null) || []).map((r) => `${r.id}:pending`),
          ...((outRes.data as { id: string }[] | null) || []).map((r) => `${r.id}:counter`),
        ];
        keysRef.current = keys;
        recompute();
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

    // Fired by the Header when the booking icon is clicked: snapshot everything
    // currently qualifying as "seen" and clear the badge immediately.
    function onMarkSeen() {
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(keysRef.current));
      } catch {
        /* ignore */
      }
      recompute();
    }
    window.addEventListener('gdc:mark-bookings-seen', onMarkSeen);

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('gdc:refresh-booking-count', onRefresh);
      window.removeEventListener('gdc:mark-bookings-seen', onMarkSeen);
    };
  }, [user?.id]);

  return count;
}
