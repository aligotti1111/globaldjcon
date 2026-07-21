'use client';

// Header — matches the vanilla site's #view-public header structure exactly,
// so the existing CSS in index.css styles it correctly.
//
// Logged-in nav matches vanilla ui-chrome.js logic:
//   DJ:      View My Profile + Update Profile + Bookings + Inbox + Log Out
//   Others:  Bookings + Inbox + Settings (gear) + Log Out
//   Admin:   Admin button (in addition to above based on role)

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { useUnreadInboxCount } from './useUnreadInboxCount';
import { useUnreadBookingCount } from './useUnreadBookingCount';
import HeaderDjMenu from './HeaderDjMenu';
import AuthModal from './AuthModal';
import { createClient } from '@/lib/supabase/client';
import { canBook, type AccessFields } from '@/lib/access';

export default function Header() {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  // Unread inbox count (polled every 30s — see useUnreadInboxCount).
  // Returns 0 for logged-out users so the badge simply doesn't render.
  const unreadCount = useUnreadInboxCount();
  // Pending bookings count — pending requests where I'm the DJ, plus
  // counters where I'm the booker. See useUnreadBookingCount.
  const bookingCount = useUnreadBookingCount();

  // Which auth modal is open, if any. The header owns it because it owns the
  // buttons, and it renders once per page under (main)/layout, so one instance
  // covers every page.
  const [authModal, setAuthModal] = useState<null | 'login' | 'signup'>(null);

  const openMenu = () => {
    // Dispatch a custom event the MobileMenu component listens for.
    // We use an event (rather than shared state) to keep Header and
    // MobileMenu decoupled — they're rendered as siblings under
    // (main)/layout.tsx and don't share a parent state container.
    window.dispatchEvent(new CustomEvent('gdc:open-mobile-menu'));
  };

  // Sign out and do a FULL page reload so server components re-render
  // with the new (signed-out) auth state. Without the full reload, the
  // homepage and other server-rendered pages would keep stale data.
  const handleSignOut = async (e: React.MouseEvent) => {
    e.preventDefault();
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  const isDj = user?.role === 'dj';
  // Whether this DJ has bookings activated — gates the booking-only items in
  // the dropdown (Upcoming Bookings, Add Booking Manually).
  // Booking nav items (Upcoming Bookings, Add Booking Manually) are gated on
  // the DJ having booking access — an active subscription or comp. Replaces
  // the old booking_enabled toggle check (the toggle was removed; availability
  // is subscription-driven now). The auth user carries sub/comp via select('*').
  const bookingEnabled = user ? canBook(user as unknown as AccessFields) : false;
  // Admin is identified by email (single-admin model — see admin-auth.ts).
  // We swap the entire right-side toolbar for admin so they don't see the
  // host/DJ-oriented Booking + Inbox + Settings buttons that don't apply
  // to the platform owner.
  const isAdmin = user?.email?.toLowerCase() === 'admin@globaldjconnect.com';
  // When the DJ is already on their own profile page, hide the "View My
  // Profile" button — it would just link to where they already are.
  const onOwnProfile = isDj && user?.slug && pathname === `/${user.slug}`;
  const onUpdateProfile = pathname === '/update-dj-profile';
  const onAdmin = pathname === '/admin' || pathname.startsWith('/admin/');

  return (
    <header>
      <div className="header-bg" />
      <div className="header-inner">
        <button className="hamburger-btn" onClick={openMenu} aria-label="Menu">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        <Link href="/" style={{ textDecoration: 'none' }}>
          <div>
            <div className="eyebrow">▪ Connecting Party Hosts &amp; Venues to Premium DJs</div>
            <div className="logo">Global DJ Connect</div>
          </div>
        </Link>

        <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
          {loading ? null : user ? (
            <>
              {isAdmin ? (
                /* Admin toolbar: just one button to jump back to the panel.
                   Hidden when already on /admin to match the same pattern
                   used for View My Profile / Update Profile. Admin can still
                   browse the front-end normally — the platform looks the
                   same to them, minus the host/DJ-specific buttons. */
                <>
                  {!onAdmin && (
                    <Link
                      href="/admin"
                      className="btn btn-primary"
                      style={{ textDecoration: 'none' }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
                        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                      </svg>
                      <span className="btn-text">Admin Panel</span>
                    </Link>
                  )}
                </>
              ) : (
                <>
                  {/* DJ accounts get the avatar+name dropdown menu in
                      place of the standalone View My Profile / Update
                      Profile / Log Out buttons. The dropdown handles all
                      three actions plus Upcoming Bookings + Add Booking
                      Manually. Sits to the left of the booking icon. */}
                  {isDj && (
                    <HeaderDjMenu
                      name={user.name}
                      slug={user.slug}
                      avatarUrl={user.avatar_url}
                      bookingEnabled={bookingEnabled}
                    />
                  )}

                  {/* Shared by all logged-in non-admin users: Bookings + Inbox icons */}
                  <Link href="/booking-requests" className="inbox-nav-btn inbox-nav-btn--book" title="Booking Requests" style={{ textDecoration: 'none' }}>
                    <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
                      <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
                    </svg>
                    {/* Badge: pending bookings needing my attention. Same
                        styling as the inbox badge — visually consistent. */}
                    {bookingCount > 0 && (
                      <span className="inbox-badge" aria-label={`${bookingCount} bookings need attention`}>
                        {bookingCount > 9 ? '9+' : bookingCount}
                      </span>
                    )}
                  </Link>
                  <Link href="/inbox" className="inbox-nav-btn" title="Inbox" style={{ textDecoration: 'none' }}>
                    <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                    {/* Unread badge — hidden when count is 0. Display "9+"
                        for any double-digit count to keep the badge small. */}
                    {unreadCount > 0 && (
                      <span className="inbox-badge" aria-label={`${unreadCount} unread messages`}>
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </Link>

                  {/* Non-DJ users get the settings gear; DJs already have Update Profile above */}
                  {!isDj && (
                    <Link href="/account-settings" className="inbox-nav-btn" title="Account Settings" style={{ textDecoration: 'none' }}>
                      <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                      </svg>
                    </Link>
                  )}
                </>
              )}

              {/* Log Out — shown for everyone EXCEPT non-admin DJ accounts,
                  who reach Sign Out via the avatar dropdown above. Admins
                  keep the standalone button regardless of their stored role. */}
              {(!isDj || isAdmin) && (
                <button onClick={handleSignOut} className="btn btn-outline" type="button">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                  </svg>
                  <span className="btn-text">Log Out</span>
                </button>
              )}
            </>
          ) : (
            <>
              {/* Open the modal over the current page instead of routing to
                  /login — a logged-out visitor mid-browse keeps their place.
                  /login still exists for deep links and redirects. */}
              <button
                type="button"
                onClick={() => setAuthModal('login')}
                className="btn btn-outline"
                style={{ border: '1px solid' }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" />
                </svg>
                <span className="btn-text">Sign In</span>
              </button>
              <button
                type="button"
                onClick={() => setAuthModal('signup')}
                className="btn btn-primary"
                style={{ padding: '.7rem 1.3rem' }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                  <circle cx="8.5" cy="7" r="4" />
                  <line x1="20" y1="8" x2="20" y2="14" />
                  <line x1="23" y1="11" x2="17" y2="11" />
                </svg>
                <span className="btn-text">Create an Account</span>
              </button>
            </>
          )}
        </div>
      </div>

      {authModal && (
        <AuthModal initialMode={authModal} onClose={() => setAuthModal(null)} />
      )}
    </header>
  );
}
