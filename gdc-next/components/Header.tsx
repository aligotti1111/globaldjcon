'use client';

// Header — matches the vanilla site's #view-public header structure exactly,
// so the existing CSS in index.css styles it correctly.

import Link from 'next/link';
import { useAuth } from './AuthProvider';

export default function Header() {
  const { user, loading, signOut } = useAuth();

  const openMenu = () => {
    const menu = document.getElementById('mobile-menu');
    if (menu) menu.style.display = 'flex';
  };

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

        <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center' }}>
          {loading ? null : user ? (
            <>
              {user.role === 'dj' && user.slug && (
                <Link
                  href={`/${user.slug}`}
                  className="btn btn-outline"
                  style={{ textDecoration: 'none', padding: '.7rem 1.1rem' }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <span className="btn-text">View My Profile</span>
                </Link>
              )}
              {user.role === 'dj' && (
                <Link
                  href="/update-dj-profile"
                  className="btn btn-primary"
                  style={{ textDecoration: 'none' }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15.232 5.232l3.536 3.536M9 13l-4 4 4-4zm6.364-6.364A2 2 0 0118.2 9.4L8 19.6H4v-4L14.2 5.4a2 2 0 012.164-.532z" strokeLinejoin="round" strokeLinecap="round" />
                  </svg>
                  <span className="btn-text">Update Profile</span>
                </Link>
              )}
              <Link href="/booking-requests" className="inbox-nav-btn" title="Booking Requests" style={{ textDecoration: 'none' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
                </svg>
              </Link>
              <Link href="/inbox" className="inbox-nav-btn" title="Inbox" style={{ textDecoration: 'none' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </Link>
              <Link href="/account-settings" className="inbox-nav-btn" title="Account Settings" style={{ textDecoration: 'none' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>
              </Link>
              {user.role === 'admin' && (
                <Link
                  href="/admin"
                  className="btn btn-admin"
                  style={{ textDecoration: 'none' }}
                >
                  <span className="btn-text">Admin</span>
                </Link>
              )}
              <button onClick={signOut} className="btn btn-outline">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                <span className="btn-text">Log Out</span>
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="btn btn-outline"
                style={{ textDecoration: 'none', border: '1px solid' }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" />
                </svg>
                <span className="btn-text">Sign In</span>
              </Link>
              <Link
                href="/signup"
                className="btn btn-primary"
                style={{ textDecoration: 'none', padding: '.7rem 1.3rem' }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                  <circle cx="8.5" cy="7" r="4" />
                  <line x1="20" y1="8" x2="20" y2="14" />
                  <line x1="23" y1="11" x2="17" y2="11" />
                </svg>
                <span className="btn-text">Create an Account</span>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
