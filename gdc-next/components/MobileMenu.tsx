'use client';

// Mobile menu — slides over the page on mobile devices.
// Replaces gdcSetupMobileMenu() in vanilla ui-chrome.js.
//
// Open/close communication with Header uses a custom DOM event on
// `window` ('gdc:open-mobile-menu') instead of direct DOM manipulation
// or a shared context. This keeps Header and MobileMenu independent
// and avoids hydration races on initial load.
//
// Layout: items are grouped under section headers — "Navigate" and
// "Manage" — with Sign Out on its own and Contact/Privacy in a muted
// footer group. Each row has a leading inline-SVG icon. CSS lives in
// index.css (.mobile-menu-*). Inbox is intentionally NOT in this menu —
// it's a persistent icon in the Header on every page.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from './AuthProvider';
import { useUpcomingBookingCount } from './useUpcomingBookingCount';
import { parseBookingSettings } from '@/app/(main)/[slug]/bookingSettings';

// Shared stroke attributes for the inline icon set. Icons are sized and
// colored via the .mm-icon CSS class (16px, neon by default).
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function IconHome() {
  return (
    <svg className="mm-icon" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}
function IconUser() {
  return (
    <svg className="mm-icon" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}
function IconEdit() {
  return (
    <svg className="mm-icon" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg className="mm-icon" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function IconSettings() {
  return (
    <svg className="mm-icon" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg className="mm-icon" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg className="mm-icon" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}
function IconLogout() {
  return (
    <svg className="mm-icon" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
function IconMessage() {
  return (
    <svg className="mm-icon" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function IconBell() {
  return (
    <svg className="mm-icon" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
function IconGear() {
  return (
    <svg className="mm-icon" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg className="mm-icon" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function IconAdmin() {
  return (
    <svg className="mm-icon" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 9h6M9 13h6M9 17h3" />
    </svg>
  );
}

export default function MobileMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener('gdc:open-mobile-menu', handleOpen);
    return () => window.removeEventListener('gdc:open-mobile-menu', handleOpen);
  }, []);

  const close = () => setOpen(false);
  const handleSignOut = async () => {
    await signOut();
    setOpen(false);
  };

  const isAdmin = user?.email?.toLowerCase() === 'admin@globaldjconnect.com';
  const isDj = user?.role === 'dj';
  // Gates the booking-only DJ items (Upcoming Bookings, Add Booking Manually).
  const bookingEnabled = parseBookingSettings(user?.booking_settings)?.booking_enabled === true;
  // Show a count next to the "Upcoming Bookings" / "Upcoming Events" link
  // so the user can see at a glance how many events they have queued.
  const upcomingCount = useUpcomingBookingCount(
    (user?.role === 'dj' || user?.role === 'host' || user?.role === 'venue')
      ? user.role
      : null
  );

  return (
    <div
      id="mobile-menu"
      className={`mobile-menu${open ? ' open' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="mobile-menu-panel">
        <button onClick={close} className="mobile-menu-close" aria-label="Close menu">×</button>

        {!user && (
          <>
            <div className="mobile-menu-group">Navigate</div>
            <Link href="/" onClick={close} className="mobile-menu-item">
              <IconHome />Home
            </Link>
            <div className="mobile-menu-section">
              <Link href="/login" onClick={close} className="mobile-menu-item primary">
                <IconUser />Sign In
              </Link>
              <Link href="/signup" onClick={close} className="mobile-menu-item">
                <IconEdit />Create Account
              </Link>
            </div>
          </>
        )}

        {user && isAdmin && (
          <>
            <div className="mobile-menu-group">Navigate</div>
            <Link href="/" onClick={close} className="mobile-menu-item">
              <IconHome />Home
            </Link>
            <Link href="/admin" onClick={close} className="mobile-menu-item primary">
              <IconAdmin />Admin Panel
            </Link>
            <div className="mobile-menu-section">
              <button onClick={handleSignOut} className="mobile-menu-item danger">
                <IconLogout />Sign Out
              </button>
            </div>
          </>
        )}

        {user && !isAdmin && (
          <>
            <div className="mobile-menu-group">Navigate</div>
            <Link href="/" onClick={close} className="mobile-menu-item">
              <IconHome />Home
            </Link>
            {isDj && user.slug && (
              <Link href={`/${user.slug}`} onClick={close} className="mobile-menu-item primary">
                <IconUser />My Profile
              </Link>
            )}
            {isDj && (
              <Link href="/update-dj-profile" onClick={close} className="mobile-menu-item">
                <IconEdit />Settings
              </Link>
            )}
            {!isDj && (
              <Link href="/account-settings" onClick={close} className="mobile-menu-item">
                <IconSettings />Account Settings
              </Link>
            )}

            <div
              className="mobile-menu-group"
              style={{ borderTop: '1px solid var(--border)', marginTop: '.35rem', paddingTop: '.5rem' }}
            >
              Manage
            </div>
            <Link href="/booking-requests" onClick={close} className="mobile-menu-item">
              <IconCalendar />Booking Requests
            </Link>
            {isDj && bookingEnabled && (
              <Link href="/upcoming-bookings" onClick={close} className="mobile-menu-item">
                <IconClock />Upcoming Bookings{upcomingCount > 0 ? ` (${upcomingCount})` : ''}
              </Link>
            )}
            {!isDj && (
              <Link href="/upcoming-events" onClick={close} className="mobile-menu-item">
                <IconClock />Upcoming Events{upcomingCount > 0 ? ` (${upcomingCount})` : ''}
              </Link>
            )}
            {isDj && bookingEnabled && (
              <Link href="/upcoming-bookings?add=1" onClick={close} className="mobile-menu-item">
                <IconPlus />Add Booking Manually
              </Link>
            )}
            {isDj && (
              <Link href="/booking-settings" onClick={close} className="mobile-menu-item">
                <IconGear />Booking Settings
              </Link>
            )}
            {isDj && (
              <Link href="/notifications" onClick={close} className="mobile-menu-item">
                <IconBell />Notifications
              </Link>
            )}

            <div className="mobile-menu-section">
              <button onClick={handleSignOut} className="mobile-menu-item danger">
                <IconLogout />Sign Out
              </button>
            </div>
          </>
        )}

        <div className="mobile-menu-section">
          <Link href="/contact" onClick={close} className="mobile-menu-item muted">
            <IconMessage />Contact
          </Link>
          <Link href="/privacy" onClick={close} className="mobile-menu-item muted">
            <IconShield />Privacy
          </Link>
        </div>
      </div>
    </div>
  );
}
