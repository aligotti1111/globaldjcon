'use client';

// SlugAvailabilityCheck — lean, drop-in availability indicator for the
// profile-editing flows (UpdateDjProfile, AccountSettings).
//
// Differs from the signup SlugInput component in three ways:
//   1. Excludes the current user's own slug from the "taken" check —
//      otherwise editing your existing slug always looks taken.
//   2. No alternative-suggestion UI — profile editors just need to know
//      if they can hit Save.
//   3. Self-contained — only renders the status indicator. The caller's
//      existing input + label markup stays untouched.
//
// Behavior:
//   - Debounces 500ms after the user stops typing
//   - Shows "Checking…" while in flight
//   - Shows green "Available ✓" or red "Taken" once resolved
//   - Hides itself entirely when the slug is unchanged from the original
//     (no point checking if they haven't edited)
//   - Returns nothing when value is empty (caller's required-field
//     validation handles that)

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export type SlugStatus = 'idle' | 'checking' | 'available' | 'taken';

interface Props {
  // Current value being checked (caller normalizes via makeSlug if needed)
  value: string;
  // Original slug from the DB. Used to (a) skip the check entirely when
  // unchanged, and (b) exclude the user's own row from the query.
  originalSlug: string;
  // Current user's id — used to scope the "taken" query so we don't flag
  // the user's own existing slug as taken.
  userId: string;
  // Optional callback so the parent can disable Save when status is taken
  onStatusChange?: (status: SlugStatus) => void;
}

export function SlugAvailabilityCheck({
  value,
  originalSlug,
  userId,
  onStatusChange,
}: Props) {
  const db = createClient();
  const [status, setStatus] = useState<SlugStatus>('idle');
  // Track the last slug we kicked off a check for, so out-of-order
  // network responses don't overwrite a newer status.
  const latestRef = useRef<string>('');

  // Notify parent on status change
  useEffect(() => {
    onStatusChange?.(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    // Empty / unchanged slug → idle (no indicator). Empty case lets the
    // caller's "required" validation surface the error instead.
    if (!value || value.length === 0) {
      setStatus('idle');
      return;
    }
    if (value === originalSlug) {
      setStatus('idle');
      return;
    }

    setStatus('checking');
    latestRef.current = value;

    const timer = setTimeout(async () => {
      const slugAtStart = value;
      // Defensive: trim + lowercase the value before querying. The caller
      // should already pass a normalized slug (via makeSlug), but if they
      // forget, a mixed-case "AlexDJ" would fail to match the DB-stored
      // "alexdj" and we'd falsely report it as available.
      const queryValue = slugAtStart.trim().toLowerCase();
      try {
        // Look for any OTHER user with this slug (excluding the current
        // user). neq('id', userId) is the key fix vs. the signup version.
        const { data, error } = await db
          .from('users')
          .select('id')
          .eq('slug', queryValue)
          .neq('id', userId)
          .limit(1);

        if (latestRef.current !== slugAtStart) return; // stale response
        if (error) {
          // Fall back to idle — pre-flight check at save time will catch
          // any actual conflict.
          setStatus('idle');
          return;
        }
        setStatus(data && data.length > 0 ? 'taken' : 'available');
      } catch {
        if (latestRef.current === slugAtStart) setStatus('idle');
      }
    }, 500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, originalSlug, userId]);

  // No indicator when idle (unchanged or empty). Keeps the form quiet
  // until the user actually edits the slug.
  if (status === 'idle') return null;

  // Inline styles so the component works in any parent without needing
  // a CSS module import. Matches the brand neon/red palette.
  const baseStyle: React.CSSProperties = {
    display: 'inline-block',
    marginTop: '.4rem',
    fontFamily: "'Space Mono', monospace",
    fontSize: '.7rem',
    letterSpacing: '.04em',
    fontWeight: 700,
  };

  if (status === 'checking') {
    return <span style={{ ...baseStyle, color: '#888' }}>Checking…</span>;
  }
  if (status === 'available') {
    return <span style={{ ...baseStyle, color: '#00f5c4' }}>Available ✓</span>;
  }
  return <span style={{ ...baseStyle, color: '#ff5f5f' }}>Taken</span>;
}
