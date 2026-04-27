'use client';

// Mobile menu — slides over the page on mobile devices.
// Replaces the gdcSetupMobileMenu() function in ui-chrome.js.

import Link from 'next/link';
import { useAuth } from './AuthProvider';

export default function MobileMenu() {
  const { user, signOut } = useAuth();

  const close = () => {
    const menu = document.getElementById('mobile-menu');
    if (menu) menu.style.display = 'none';
  };

  return (
    <div
      id="mobile-menu"
      style={{ display: 'none' }}
      className="mobile-menu-overlay"
    >
      <div className="mobile-menu-inner">
        <button onClick={close} className="mobile-menu-close" aria-label="Close menu">×</button>
        <nav>
          <Link href="/" onClick={close}>Home</Link>
          {user ? (
            <>
              {user.role === 'dj' && user.slug && (
                <Link href={`/${user.slug}`} onClick={close}>My Profile</Link>
              )}
              <Link href="/booking-requests" onClick={close}>Bookings</Link>
              <Link href="/inbox" onClick={close}>Inbox</Link>
              <Link href="/account-settings" onClick={close}>Account</Link>
              {user.role === 'admin' && (
                <Link href="/admin" onClick={close}>Admin</Link>
              )}
              <button onClick={() => { signOut(); close(); }} className="mobile-menu-signout">
                Sign Out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" onClick={close}>Sign In</Link>
              <Link href="/signup" onClick={close}>Create Account</Link>
            </>
          )}
          <Link href="/contact" onClick={close}>Contact</Link>
          <Link href="/privacy" onClick={close}>Privacy</Link>
        </nav>
      </div>
    </div>
  );
}
