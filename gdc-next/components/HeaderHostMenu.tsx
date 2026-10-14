'use client';

// HeaderHostMenu — desktop avatar+name dropdown for HOST accounts.
// The host equivalent of HeaderDjMenu: hosts had no desktop menu at all (just a
// bare Log Out button), so their two real destinations — Upcoming Events and
// Account Settings — were only reachable from the mobile burger. This puts them
// behind the same avatar dropdown DJs get, reusing the identical hdr-dj-menu-*
// styling so the two headers match.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';

interface HeaderHostMenuProps {
  /** Host's display name shown next to the avatar. */
  name: string;
  /** Public avatar URL — when null, we render an initials circle instead. */
  avatarUrl: string | null;
  /** Platform admin (single-admin, by email) — shows an "Admin Panel" link at
   *  the top of the dropdown. Only ever true for the one admin account. */
  isAdmin?: boolean;
}

// Inline icon set — matches the hamburger (MobileMenu) host icons exactly so
// the two menus read as the same product. Sized/colored via the shared
// .mm-icon class (16px, neon; red under the danger row).
const iconStroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};
function IconClock() {
  return (
    <svg className="mm-icon" viewBox="0 0 24 24" {...iconStroke} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}
function IconSettings() {
  return (
    <svg className="mm-icon" viewBox="0 0 24 24" {...iconStroke} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function IconLogout() {
  return (
    <svg className="mm-icon" viewBox="0 0 24 24" {...iconStroke} aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
function IconAdmin() {
  return (
    <svg className="mm-icon" viewBox="0 0 24 24" {...iconStroke} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 9h6M9 13h6M9 17h3" />
    </svg>
  );
}

function initialsFrom(name: string): string {
  const parts = (name || '').trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '?';
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + second).toUpperCase().slice(0, 2);
}

export default function HeaderHostMenu({ name, avatarUrl, isAdmin = false }: HeaderHostMenuProps) {
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
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
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

  // Fixed-position the dropdown from the trigger's rect — the header is
  // overflow:hidden, so an absolutely-positioned menu would be clipped.
  useEffect(() => {
    if (!open) { setPopPos(null); return; }
    function compute() {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPopPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
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
          <img
            src={avatarUrl}
            alt=""
            width={44}
            height={44}
            className="hdr-dj-menu-avatar"
            style={{ borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : (
          <span className="hdr-dj-menu-avatar hdr-dj-menu-avatar-fallback">{initials}</span>
        )}
        <span className="hdr-dj-menu-name">{name}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="hdr-dj-menu-chev" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && popPos && (
        <div className="hdr-dj-menu-pop" role="menu" style={{ top: popPos.top, right: popPos.right }}>
          {/* Admin Panel — only for the single platform-admin account. */}
          {isAdmin && (
            <>
              <Link href="/admin" className="hdr-dj-menu-item" role="menuitem" onClick={() => setOpen(false)}>
                <IconAdmin />Admin Panel
              </Link>
              <div className="hdr-dj-menu-sep" />
            </>
          )}
          <Link href="/upcoming-events" className="hdr-dj-menu-item" role="menuitem" onClick={() => setOpen(false)}>
            <IconClock />Upcoming Events
          </Link>
          <Link href="/past-events" className="hdr-dj-menu-item" role="menuitem" onClick={() => setOpen(false)}>
            <IconClock />Past Events
          </Link>
          <Link href="/account-settings" className="hdr-dj-menu-item" role="menuitem" onClick={() => setOpen(false)}>
            <IconSettings />Account Settings
          </Link>

          <div className="hdr-dj-menu-sep" />
          <button
            type="button"
            className="hdr-dj-menu-item hdr-dj-menu-item-danger"
            role="menuitem"
            onClick={handleSignOut}
          >
            <IconLogout />Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
