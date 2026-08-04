'use client';

// Two small dialogs lifted out of BookingRow (refactor phase 1):
//  - ConfirmDialog: the generic confirm box, shared by the step-toggle and
//    cancel-request flows. The row still owns the descriptor state.
//  - PaymentMethodsModal: the payment-methods editor, wrapping the same
//    PaymentMethodsSection as Booking Settings so a rail added here is added
//    everywhere.
// Both are pure presentation; the row keeps the open/close state.

import { NEON } from './shared';
import PaymentMethodsSection from '../update-dj-profile/PaymentMethodsSection';

export interface ConfirmDescriptor {
  title: string;
  body: string;
  okLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onOk: () => void;
}

export function ConfirmDialog({ confirm, onClose }: { confirm: ConfirmDescriptor; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10001, background: 'rgba(0,0,0,.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-card,#14141f)', border: '1px solid rgba(255,255,255,.14)',
          borderRadius: 12, padding: '1.2rem 1.3rem', maxWidth: 420, width: '100%',
          boxShadow: '0 12px 40px rgba(0,0,0,.6)',
        }}
      >
        <div style={{ fontWeight: 800, color: 'var(--white,#fff)', fontSize: '1rem', marginBottom: '.55rem' }}>
          {confirm.title}
        </div>
        <div style={{ color: 'var(--muted,#b7b7c6)', fontSize: '.85rem', lineHeight: 1.55, marginBottom: '1.1rem' }}>
          {confirm.body}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.6rem' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.2)', color: 'var(--white,#fff)', fontWeight: 700, fontSize: '.82rem', borderRadius: 8, padding: '.55rem 1.1rem', cursor: 'pointer' }}
          >
            {confirm.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => { const ok = confirm.onOk; onClose(); ok(); }}
            style={{ background: confirm.danger ? '#ff6b6b' : NEON, border: 'none', color: confirm.danger ? '#2a0a0a' : '#06231b', fontWeight: 800, fontSize: '.82rem', borderRadius: 8, padding: '.55rem 1.2rem', cursor: 'pointer' }}
          >
            {confirm.okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PaymentMethodsModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.65)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '2rem 1rem', overflowY: 'auto',
      }}
    >
      {/* position:relative so the close button can pin to the card's own
          top-right corner. The card is taller than the viewport, so an X in the
          corner rides the top of the card and is on screen the moment it opens. */}
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', maxWidth: 620, width: '100%' }}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute', top: 12, right: 12, zIndex: 1,
            width: 32, height: 32, borderRadius: '50%',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,.5)', border: '1px solid rgba(255,255,255,.2)',
            color: 'var(--white,#fff)', cursor: 'pointer', lineHeight: 1,
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <PaymentMethodsSection userId={userId} />
      </div>
    </div>
  );
}
