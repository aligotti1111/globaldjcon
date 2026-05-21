'use client';

// Mobile menu — slides over the page on mobile devices.
// Replaces gdcSetupMobileMenu() in vanilla ui-chrome.js.
//
// Open/close communication with Header uses a custom DOM event on
// `window` ('gdc:open-mobile-menu') instead of direct DOM manipulation
// or a shared context. This keeps Header and MobileMenu independent
// and avoids hydration races on initial load.
//
// CSS classes match index.css line 336-344 — `.mobile-menu` is hidden
// by default, `.mobile-menu.open` is visible. Inner panel uses
// `.mobile-menu-panel` + `.mobile-menu-item` styling already defined
// globally.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from './AuthProvider';
import { useUnreadInboxCount } from './useUnreadInboxCount';

export default function MobileMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  // Unread inbox count — shown as a small badge inside the Inbox menu item
  // so mobile users see new messages without opening the inbox first.
  const unreadCount = useUnreadInboxCount();

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

  return (
    <div
      id="mobile-menu"
      className={`mobile-menu${open ? ' open' : ''}`}
      onClick={(e) => {
        // Close when clicking the dim background outside the panel
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="mobile-menu-panel">
        <button onClick={close} className="mobile-menu-close" aria-label="Close menu">×</button>

        <Link href="/" onClick={close} className="mobile-menu-item">Home</Link>

        {user ? (
          <>
            {(() => {
              // Admin gets just the Admin Panel link — no profile/booking/inbox.
              const isAdmin = user.email?.toLowerCase() === 'admin@globaldjconnect.com';
              if (isAdmin) {
                return (
                  <Link href="/admin" onClick={close} className="mobile-menu-item primary">
                    Admin Panel
                  </Link>
                );
              }
              return (
                <>
                  {user.role === 'dj' && user.slug && (
                    <Link href={`/${user.slug}`} onClick={close} className="mobile-menu-item primary">
                      My Profile
                    </Link>
                  )}
                  {user.role === 'dj' && (
                    <Link href="/update-dj-profile" onClick={close} className="mobile-menu-item">
                      Update Profile
                    </Link>
                  )}
                  <Link href="/booking-requests" onClick={close} className="mobile-menu-item">Booking Requests</Link>
                  {user.role === 'dj' && (
                    <Link href="/upcoming-bookings" onClick={close} className="mobile-menu-item">
                      Upcoming Bookings
                    </Link>
                  )}
                  {user.role !== 'dj' && (
                    <Link href="/upcoming-events" onClick={close} className="mobile-menu-item">
                      Upcoming Events
                    </Link>
                  )}
                  <Link
                    href="/inbox"
                    onClick={close}
                    className="mobile-menu-item"
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <span>Inbox</span>
                    {unreadCount > 0 && (
                      <span
                        // Same neon pill aesthetic as the Header badge,
                        // sized for the wider mobile menu row.
                        style={{
                          background: 'var(--neon)',
                          color: 'var(--black)',
                          fontFamily: '"Space Mono", monospace',
                          fontSize: '.6rem',
                          fontWeight: 700,
                          minWidth: 20,
                          height: 20,
                          borderRadius: 10,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '0 6px',
                          letterSpacing: '.04em',
                        }}
                        aria-label={`${unreadCount} unread messages`}
                      >
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </Link>
                  {user.role !== 'dj' && (
                    <Link href="/account-settings" onClick={close} className="mobile-menu-item">
                      Account Settings
                    </Link>
                  )}
                </>
              );
            })()}
            <hr className="mobile-menu-divider" />
            <button onClick={handleSignOut} className="mobile-menu-item danger">
              Sign Out
            </button>
          </>
        ) : (
          <>
            <Link href="/login" onClick={close} className="mobile-menu-item primary">Sign In</Link>
            <Link href="/signup" onClick={close} className="mobile-menu-item">Create Account</Link>
          </>
        )}

        <hr className="mobile-menu-divider" />
        <Link href="/contact" onClick={close} className="mobile-menu-item">Contact</Link>
        <Link href="/privacy" onClick={close} className="mobile-menu-item">Privacy</Link>
      </div>
    </div>
  );
}
