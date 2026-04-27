'use client';

// Header — the single source of truth for the site header.
// Replaces ui-chrome.js header rendering and the inline <header> blocks
// duplicated across every HTML page.

import Link from 'next/link';
import { useAuth } from './AuthProvider';

export default function Header() {
  const { user, loading } = useAuth();

  return (
    <header>
      <div className="header-inner">
        <button
          className="hamburger-btn"
          onClick={() => {
            const menu = document.getElementById('mobile-menu');
            if (menu) menu.style.display = 'flex';
          }}
          aria-label="Menu"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <Link href="/" className="nav-logo">Global DJ Connect</Link>
        <nav className="nav-btns">
          {loading ? null : user ? (
            <>
              {user.role === 'dj' && user.slug && (
                <Link href={`/${user.slug}`} className="nav-link">My Profile</Link>
              )}
              <Link href="/booking-requests" className="nav-link">Bookings</Link>
              <Link href="/inbox" className="nav-link">Inbox</Link>
              <Link href="/account-settings" className="nav-link">Account</Link>
              {user.role === 'admin' && (
                <Link href="/admin" className="nav-link">Admin</Link>
              )}
            </>
          ) : (
            <>
              <Link href="/login" className="nav-link">Sign In</Link>
              <Link href="/signup" className="nav-link signup-cta">Create Account</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
