'use client';

// useUnreadInboxCount — fetches the count of unread messages where the
// current user is the recipient, and polls every 30s to keep it fresh.
//
// Used by the Header inbox icon (badge) and the MobileMenu inbox link.
//
// Returns 0 when no user is logged in or there's an error — never throws.
// Skips polling when the tab is hidden to avoid wasted requests.

import { useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthProvider';
import { createClient } from '@/lib/supabase/client';

const POLL_MS = 30_000; // 30 seconds — matches vanilla cadence

export function useUnreadInboxCount(): number {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  // We re-create the timer on user change. Ref so we can clear it cleanly.
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // No user → no count + no polling.
    if (!user?.id) {
      setCount(0);
      return;
    }

    let cancelled = false;
    const db = createClient();

    async function fetchCount() {
      // Skip when the tab isn't visible — saves a request every 30s for
      // every backgrounded tab.
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const { count: c, error } = await db
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('to_user_id', user!.id)
          .eq('read', false);
        if (cancelled) return;
        if (error) {
          // Silently fall back to 0 — don't blow up the header on a
          // transient DB hiccup.
          return;
        }
        setCount(c ?? 0);
      } catch {
        // Network blip — leave count at its previous value.
      }
    }

    // Initial fetch + interval poll
    fetchCount();
    timerRef.current = setInterval(fetchCount, POLL_MS);

    // Refresh as soon as the tab becomes visible again — more responsive
    // than waiting up to 30s after the user comes back.
    function onVisibilityChange() {
      if (!document.hidden) fetchCount();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Allow other parts of the app to manually refresh the count (e.g.
    // after the user opens /inbox and we know counts will change). We
    // listen for a custom event rather than coupling components.
    function onRefresh() {
      fetchCount();
    }
    window.addEventListener('gdc:refresh-inbox-count', onRefresh);

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('gdc:refresh-inbox-count', onRefresh);
    };
  }, [user?.id]);

  return count;
}
