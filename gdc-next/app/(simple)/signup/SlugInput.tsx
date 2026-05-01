'use client';

// SlugInput — reusable URL-slug input with real-time availability checking
// and alternative suggestions when the chosen slug is taken.
//
// Used by both the DJ and Venue signup forms. They pass in different
// alternative generators (different naming conventions per role).
//
// Behavior matches vanilla sgn-slug-dj.js / sgn-slug-venue.js:
//   1. User types into the slug input
//   2. After 500ms idle, query Supabase for slug availability
//   3. If available: green border + "Available ✓"
//   4. If taken: red border + "Taken" + render 6 alternative buttons
//      with their own per-button availability checks
//   5. Clicking an available alternative selects it as the new slug

import { useEffect, useRef, useState } from 'react';
import { makeSlug } from './helpers';
import styles from './signup.module.css';

export type SlugStatus = 'idle' | 'checking' | 'available' | 'taken';

interface AlternativeState {
  slug: string;
  status: 'checking' | 'available' | 'taken';
}

interface SlugInputProps {
  // Current value (canonical slug — already normalized via makeSlug)
  value: string;
  // Called when the user types or clicks an alternative.
  onChange: (newSlug: string) => void;
  // Called whenever the availability status changes — parent uses this
  // to decide if the form is submittable.
  onStatusChange: (status: SlugStatus) => void;
  // Function that generates alternatives when slug is taken (e.g.
  // generateDjAlternatives or generateVenueAlternatives from helpers.ts)
  generateAlternatives: (slug: string) => string[];
  // Placeholder text for the input
  placeholder?: string;
  // ── Editing mode (Update DJ Profile / Account Settings) ───────────
  // When the user already owns a profile and is just renaming it, we
  // need to (a) skip flagging their own existing slug as "Taken" and
  // (b) exclude their own row from the uniqueness query so a different
  // slug they pick that no one else uses comes back as "Available".
  excludeUserId?: string;
  // Original slug from the DB. When value matches this, the component
  // treats it as "their existing slug" → status forced to 'available'
  // and no DB query fires.
  originalSlug?: string;
}

export function SlugInput({
  value,
  onChange,
  onStatusChange,
  generateAlternatives,
  placeholder = 'your-url',
  excludeUserId,
  originalSlug,
}: SlugInputProps) {
  const [status, setStatus] = useState<SlugStatus>('idle');
  const [alternatives, setAlternatives] = useState<AlternativeState[]>([]);

  // Track the last slug we kicked off a check for, so out-of-order
  // network responses don't overwrite a newer status.
  const latestRequestRef = useRef<string>('');

  // Notify parent every time status changes
  useEffect(() => {
    onStatusChange(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Main availability check — debounced 500ms after the user stops typing
  useEffect(() => {
    if (!value || value.length === 0) {
      setStatus('idle');
      setAlternatives([]);
      return;
    }
    // Editing-mode shortcut: when the user is editing their own profile
    // and hasn't changed the slug from what's already in the DB, skip
    // the check entirely and report it as available — otherwise their
    // own row would come back from the query and we'd flag it as taken.
    if (originalSlug !== undefined && value === originalSlug) {
      setStatus('available');
      setAlternatives([]);
      return;
    }
    setStatus('checking');
    setAlternatives([]);
    latestRequestRef.current = value;

    const timer = setTimeout(async () => {
      const slugAtStart = value;
      try {
        // Server-side check via /api/check-slug. Uses the admin client
        // so RLS doesn't hide rows — critical on the editing pages where
        // a logged-in user's view is restricted to their own row.
        const res = await fetch('/api/check-slug', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: slugAtStart,
            excludeUserId: excludeUserId || undefined,
          }),
        });
        const json: { available?: boolean } = await res.json();

        // Discard if a newer query started while we were waiting
        if (latestRequestRef.current !== slugAtStart) return;

        if (!res.ok || typeof json.available !== 'boolean') {
          // On error, fall back to "idle" so the submit can still attempt
          // with its own pre-flight check
          setStatus('idle');
          return;
        }

        if (!json.available) {
          setStatus('taken');
          // Kick off availability checks for each alternative
          checkAlternatives(slugAtStart);
        } else {
          setStatus('available');
        }
      } catch {
        // On error, fall back to "idle" so the submit can still attempt
        // with its own pre-flight check
        if (latestRequestRef.current === slugAtStart) setStatus('idle');
      }
    }, 500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, originalSlug, excludeUserId]);

  // Run availability checks for each alternative in parallel
  async function checkAlternatives(takenSlug: string) {
    const candidates = generateAlternatives(takenSlug);
    // Initialize all as "checking"
    setAlternatives(candidates.map(slug => ({ slug, status: 'checking' })));

    // Check each candidate. We do them in parallel for speed but update
    // the state per-candidate so the UI reveals results progressively.
    await Promise.all(candidates.map(async (candidate) => {
      try {
        const res = await fetch('/api/check-slug', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: candidate,
            excludeUserId: excludeUserId || undefined,
          }),
        });
        const json: { available?: boolean } = await res.json();
        const isTaken = !json.available;
        setAlternatives(prev =>
          prev.map(a =>
            a.slug === candidate
              ? { ...a, status: isTaken ? 'taken' : 'available' }
              : a
          )
        );
      } catch {
        // Treat as taken on error — safer than letting the user pick
        // something we couldn't verify
        setAlternatives(prev =>
          prev.map(a => (a.slug === candidate ? { ...a, status: 'taken' } : a))
        );
      }
    }));
  }

  function handleAlternativeClick(altSlug: string) {
    // The parent owns the slug state; updating it triggers a re-check
    // for this slug, which should come back "available".
    onChange(altSlug);
  }

  // Visual state for the input border
  const inputClass = [
    styles.urlPreviewInput,
    status === 'available' ? styles.urlPreviewInputAvailable : '',
    status === 'taken' ? styles.urlPreviewInputTaken : '',
  ].filter(Boolean).join(' ');

  // Visual state for the status text
  const statusText =
    status === 'checking' ? 'Checking...' :
    status === 'available' ? 'Available ✓' :
    status === 'taken' ? 'Taken' :
    '';
  const statusClass = [
    styles.urlStatus,
    status === 'checking' ? styles.urlStatusChecking : '',
    status === 'available' ? styles.urlStatusAvailable : '',
    status === 'taken' ? styles.urlStatusTaken : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      <div className={styles.urlPreview}>
        <span className={styles.urlPreviewLabel}>Your Profile URL</span>
        <div className={styles.urlPreviewRow}>
          <span className={styles.urlPreviewPrefix}>globaldjconnect.com/</span>
          <input
            type="text"
            className={inputClass}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(makeSlug(e.target.value))}
          />
          <span className={statusClass}>{statusText}</span>
        </div>
      </div>

      {status === 'taken' && alternatives.length > 0 && (
        <div className={styles.slugAlternatives}>
          <div className={styles.slugAltLabel}>That URL is taken — pick one:</div>
          <div className={styles.slugAltOptions}>
            {alternatives.map(alt => {
              const btnClass = [
                styles.slugAltBtn,
                alt.status === 'checking' ? styles.slugAltBtnChecking : '',
                alt.status === 'taken' ? styles.slugAltBtnTaken : '',
              ].filter(Boolean).join(' ');
              return (
                <button
                  key={alt.slug}
                  type="button"
                  className={btnClass}
                  disabled={alt.status !== 'available'}
                  onClick={() => handleAlternativeClick(alt.slug)}
                >
                  globaldjconnect.com/{alt.slug}
                  {alt.status === 'checking' && ' (checking...)'}
                  {alt.status === 'taken' && ' (taken)'}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
