'use client';

// useUnreadInboxCount — fetches the count of unread message THREADS where
// the current user is the recipient and the message was sent by someone
// else, then polls every 30s to keep it fresh.
//
// Used by the Header inbox icon (badge) and the MobileMenu inbox link.
//
// IMPORTANT — query semantics must match the inbox page's threadIsUnread()
// helper, otherwise the badge can show "1" while the inbox itself looks
// empty:
//   1. to_user_id = current user (addressed to me)
//   2. read = false                 (haven't opened it yet)
//   3. from_user_id ≠ current user  (don't count my own sends)
//
// We then collapse to distinct thread IDs (parent_id when set, else the
// message's own id) so the badge counts THREADS not individual messages.
// A thread with the parent + 2 unread replies = 1 thread, not 3.
//
// Returns 0 when no user is logged in or there's an error — never throws.
// Skips polling when the tab is hidden to avoid wasted requests.

import { useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthProvider';
import { createClient } from '@/lib/supabase/client';

const POLL_MS = 30_000; // 30 seconds — matches vanilla cadence

// Shape of the rows we pull. Keep this minimal — we only need the bits
// required to identify which thread each unread row belongs to.
type UnreadRow = {
  id: string;
  parent_id: string | null;
};

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
        // Pull just the id + parent_id of every unread message that's
        // addressed to me and NOT from me. The dataset is small (only
        // unread items for this user), so doing the thread collapse in
        // JS is cheap and avoids a Postgres-specific DISTINCT/RPC trick.
        const { data, error } = await db
          .from('messages')
          .select('id, parent_id')
          .eq('to_user_id', user!.id)
          .eq('read', false)
          .neq('from_user_id', user!.id);
        if (cancelled) return;
        if (error) {
          // Silently fall back — don't blow up the header on a transient
          // DB hiccup. Leave previous count in place.
          return;
        }
        const rows = (data || []) as UnreadRow[];

        // Collapse to distinct thread IDs. A reply's thread = its parent_id;
        // a top-level unread = its own id.
        const threadIds = new Set<string>();
        for (const row of rows) {
          threadIds.add(row.parent_id || row.id);
        }
        setCount(threadIds.size);
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
