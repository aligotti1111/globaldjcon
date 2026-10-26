'use client';

// CalendarSyncButton — the "Sync to Calendar" entry point on the bookings
// dashboard. A header button that opens a popup containing the full calendar
// subscription panel (CalendarSyncSection — the same one, reused so all the
// subscribe / copy / reset logic lives in one place). Moved here from DJ
// Settings so it sits with the bookings it syncs.

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import CalendarSyncSection from '../account-settings/CalendarSyncSection';

export default function CalendarSyncButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  // Esc closes; lock body scroll while the popup is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open]);

  return (
    <>
      {/* Ghost-outline button — a neutral bordered pill with a neon calendar
          icon and white label. Opens the sync popup. */}
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        style={{
          background: 'transparent', border: '1px solid var(--border, rgba(255,255,255,.18))',
          borderRadius: 10, padding: '8px 14px', font: 'inherit', fontSize: '.78rem',
          fontWeight: 600, letterSpacing: '.02em', color: 'var(--white,#fff)',
          cursor: 'pointer', whiteSpace: 'nowrap', textTransform: 'uppercase',
          display: 'inline-flex', alignItems: 'center', gap: 8, lineHeight: 1,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--neon,#00e0a4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        Sync to Calendar
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.6)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '6vh 1rem 2rem', overflowY: 'auto',
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', width: '100%', maxWidth: 560 }}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              style={{
                position: 'absolute', top: 10, right: 12, zIndex: 2, background: 'transparent',
                border: 'none', color: 'rgba(255,255,255,.75)', fontSize: '1.5rem', lineHeight: 1, cursor: 'pointer',
              }}
            >
              ×
            </button>
            <CalendarSyncSection />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
