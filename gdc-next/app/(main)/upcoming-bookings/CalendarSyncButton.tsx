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
      <button type="button" className={className} onClick={() => setOpen(true)}>
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
