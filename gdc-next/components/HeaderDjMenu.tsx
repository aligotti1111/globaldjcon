'use client';

// HeaderDjMenu — desktop avatar+name dropdown for DJ accounts.
// Sits in the top-right header just before the booking-requests icon.
// Replaces the standalone View My Profile / Update Profile / Log Out
// buttons by absorbing all three (and a couple more nav targets) into
// one menu.
//
// Items in the dropdown:
//   - View My Profile         → /<dj-slug>
//   - Edit My Profile         → /update-dj-profile
//   - Upcoming Bookings       → /upcoming-bookings
//   - Add Booking Manually    → /upcoming-bookings  (DJ taps the Add
//                                button on that page — keeps this menu
//                                lightweight and avoids URL-param plumbing)
//   - Sign Out                → triggers signOut from AuthProvider
//
// No avatar uploaded? Shows initials from the DJ's name.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';

interface HeaderDjMenuProps {
  /** DJ's display name (the one shown next to the avatar in the header). */
  name: string;
  /** DJ's slug — used for the "View My Profile" link. */
  slug: string | null;
  /** Public avatar URL — when null, we render an initials circle instead. */
  avatarUrl: string | null;
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '?';
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + second).toUpperCase().slice(0, 2);
}

export default function HeaderDjMenu({ name, slug, avatarUrl }: HeaderDjMenuProps) {
  const router = useRouter();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [popPos, setPopPos] = useState<{ top: number; right: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Position the dropdown using fixed coords based on the trigger's rect.
  // Required because the header is `overflow: hidden` (for the scanline
  // pseudo-element), so an absolutely-positioned dropdown would get clipped.
  // Recompute on scroll/resize while open so it stays anchored.
  useEffect(() => {
    if (!open) { setPopPos(null); return; }
    function compute() {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPopPos({
        top: r.bottom + 8,
        right: window.innerWidth - r.right,
      });
    }
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open]);

  async function handleSignOut() {
    setOpen(false);
    await signOut();
    router.push('/');
    router.refresh();
  }

  const initials = initialsFrom(name);

  return (
    <div ref={wrapRef} className="hdr-dj-menu-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="hdr-dj-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="hdr-dj-menu-avatar" />
        ) : (
          <span className="hdr-dj-menu-avatar hdr-dj-menu-avatar-fallback">{initials}</span>
        )}
        <span className="hdr-dj-menu-name">{name}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="hdr-dj-menu-chev" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && popPos && (
        <div
          className="hdr-dj-menu-pop"
          role="menu"
          style={{ top: popPos.top, right: popPos.right }}
        >
          {slug && (
            <Link href={`/${slug}`} className="hdr-dj-menu-item" role="menuitem" onClick={() => setOpen(false)}>
              View My Profile
            </Link>
          )}
          <Link href="/update-dj-profile" className="hdr-dj-menu-item" role="menuitem" onClick={() => setOpen(false)}>
            Edit My Profile
          </Link>
          <Link href="/upcoming-bookings" className="hdr-dj-menu-item" role="menuitem" onClick={() => setOpen(false)}>
            Upcoming Bookings
          </Link>
          <Link href="/upcoming-bookings?add=1" className="hdr-dj-menu-item" role="menuitem" onClick={() => setOpen(false)}>
            Add Booking Manually
          </Link>
          <div className="hdr-dj-menu-sep" />
          <button
            type="button"
            className="hdr-dj-menu-item hdr-dj-menu-item-danger"
            role="menuitem"
            onClick={handleSignOut}
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
