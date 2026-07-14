'use client';

// HeaderDjMenu — desktop avatar+name dropdown for DJ accounts.
// Sits in the top-right header just before the booking-requests icon.
// Replaces the standalone View My Profile / Update Profile / Log Out
// buttons by absorbing all three (and a couple more nav targets) into
// one menu.
//
// Grouped into sections for scannability:
//   Account:   View My Profile · Upcoming Bookings · Add Booking Manually
//   Settings:  Booking Settings · Notifications · Account Settings · Manage Subscription
//   —          Sign Out
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
  /** Whether the DJ has bookings activated — gates the booking-only items. */
  bookingEnabled: boolean;
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '?';
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + second).toUpperCase().slice(0, 2);
}

// Small muted section caption inside the menu. Kept inline so this component
// doesn't depend on new CSS classes being added to the global stylesheet.
const sectionLabelStyle: React.CSSProperties = {
  padding: '10px 16px 4px',
  fontSize: '.6rem',
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: 'var(--muted, #8a8aa0)',
  opacity: 0.65,
};

export default function HeaderDjMenu({ name, slug, avatarUrl, bookingEnabled }: HeaderDjMenuProps) {
  const router = useRouter();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [popPos, setPopPos] = useState<{ top: number; right: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Open the Stripe billing portal (manage plan, update card, download
  // invoices). If the DJ has no paid subscription yet (comped or free — no
  // Stripe customer), fall back to the plans page so the click is never a
  // dead end.
  async function openBilling() {
    setOpen(false);
    if (portalLoading) return;
    setPortalLoading(true);
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && data.url) {
        window.open(data.url, '_blank', 'noopener');
        return;
      }
      router.push('/subscribe');
    } catch {
      router.push('/subscribe');
    } finally {
      setPortalLoading(false);
    }
  }

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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="hdr-dj-menu-chev" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && popPos && (
        <div
          className="hdr-dj-menu-pop"
          role="menu"
          style={{ top: popPos.top, right: popPos.right }}
        >
          {/* ── Account ── */}
          <div style={sectionLabelStyle}>Account</div>
          {slug && (
            <Link href={`/${slug}`} className="hdr-dj-menu-item" role="menuitem" onClick={() => setOpen(false)}>
              View My Profile
            </Link>
          )}
          {bookingEnabled && (
            <Link href="/upcoming-bookings" className="hdr-dj-menu-item" role="menuitem" onClick={() => setOpen(false)}>
              Upcoming Bookings
            </Link>
          )}
          {bookingEnabled && (
            <Link href="/upcoming-bookings?view=past" className="hdr-dj-menu-item" role="menuitem" onClick={() => setOpen(false)}>
              Past Bookings
            </Link>
          )}
          {bookingEnabled && (
            <Link href="/upcoming-bookings?add=1" className="hdr-dj-menu-item" role="menuitem" onClick={() => setOpen(false)}>
              Add Booking Manually
            </Link>
          )}

          {/* ── Settings ── */}
          <div className="hdr-dj-menu-sep" />
          <div style={sectionLabelStyle}>Settings</div>
          <Link href="/booking-settings" className="hdr-dj-menu-item" role="menuitem" onClick={() => setOpen(false)}>
            Booking Settings
          </Link>
          <Link href="/notifications" className="hdr-dj-menu-item" role="menuitem" onClick={() => setOpen(false)}>
            Notifications
          </Link>
          <Link href="/update-dj-profile" className="hdr-dj-menu-item" role="menuitem" onClick={() => setOpen(false)}>
            Account Settings
          </Link>
          <button
            type="button"
            className="hdr-dj-menu-item"
            role="menuitem"
            onClick={openBilling}
            disabled={portalLoading}
            style={{ background: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer' }}
          >
            {portalLoading ? 'Opening…' : 'Manage Subscription'}
          </button>

          {/* ── Sign out ── */}
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
