'use client';

// ConfirmModal — drop-in replacement for window.confirm() with site-uniform
// styling. Used by booking-requests for Approve / Deny / Cancel / Decline /
// Block actions, and anywhere else we need a yes/no prompt.
//
// Imperative API via a hook:
//   const confirm = useConfirm();
//   const ok = await confirm({ title: 'Approve this booking?', confirmLabel: 'Approve' });
//   if (!ok) return;
//
// The hook returns the confirm() function + a <ConfirmModal/> JSX element
// to render once at the top level of the component.

import { useState, useCallback, type ReactNode } from 'react';
import styles from './confirmModal.module.css';

// Optional free-text field rendered inside the confirm box (e.g. a decline
// reason). When present, the entered text comes back via confirmWithReason.
interface ReasonInput {
  label?: string;
  placeholder?: string;
}

interface ConfirmOptions {
  title: string;
  // Body copy. Accepts rich content (e.g. a bulleted list of unsaved items),
  // not just a plain string.
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  // 'danger' variant uses red Confirm button (Deny / Cancel / Block).
  // 'primary' (default) uses the neon brand color (Approve / Accept).
  variant?: 'primary' | 'danger';
  reasonInput?: ReasonInput;
}

interface PendingState extends ConfirmOptions {
  resolve: (value: { ok: boolean; reason: string }) => void;
}

export function useConfirm() {
  const [pending, setPending] = useState<PendingState | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve: (r) => resolve(r.ok) });
    });
  }, []);

  // Same modal, but with an optional text field; resolves with the entered
  // reason alongside the yes/no result.
  const confirmWithReason = useCallback((opts: ConfirmOptions): Promise<{ ok: boolean; reason: string }> => {
    return new Promise<{ ok: boolean; reason: string }>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const handleClose = (ok: boolean, reason = '') => {
    if (!pending) return;
    pending.resolve({ ok, reason });
    setPending(null);
  };

  // Modal is rendered alongside whatever else the caller renders.
  // Caller drops `{confirmDialog}` once at the top of their JSX.
  const confirmDialog = pending ? (
    <ConfirmModal
      title={pending.title}
      message={pending.message}
      confirmLabel={pending.confirmLabel || 'Confirm'}
      cancelLabel={pending.cancelLabel || 'Cancel'}
      variant={pending.variant || 'primary'}
      reasonInput={pending.reasonInput}
      onConfirm={(reason) => handleClose(true, reason)}
      onCancel={() => handleClose(false)}
    />
  ) : null;

  return { confirm, confirmWithReason, confirmDialog };
}

// ── The modal itself ───────────────────────────────────────────────────
interface Props {
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  variant: 'primary' | 'danger';
  reasonInput?: ReasonInput;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

function ConfirmModal({
  title, message, confirmLabel, cancelLabel, variant, reasonInput, onConfirm, onCancel,
}: Props) {
  const [reason, setReason] = useState('');
  // Backdrop click cancels (matches CounterModal / ComposeMessageModal).
  // Clicking the box itself is stopped from bubbling to backdrop.
  return (
    <div className={styles.modalBackdrop} onClick={onCancel}>
      <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>{title}</div>
        {message && <div className={styles.message}>{message}</div>}
        {reasonInput && (
          <div style={{ margin: '0 0 1rem' }}>
            {reasonInput.label && (
              <div style={{ fontSize: '.72rem', letterSpacing: '.03em', color: 'rgba(255,255,255,.6)', marginBottom: '.4rem' }}>
                {reasonInput.label}
              </div>
            )}
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={reasonInput.placeholder || ''}
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'vertical',
                background: '#16161f', color: '#fff', border: '1px solid rgba(255,255,255,.18)',
                borderRadius: 8, padding: '9px 11px', fontSize: '.88rem', outline: 'none', fontFamily: 'inherit',
              }}
            />
          </div>
        )}
        <div className={styles.actionsRow}>
          <button
            type="button"
            onClick={onCancel}
            className={styles.cancelBtn}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            className={
              variant === 'danger' ? styles.confirmBtnDanger : styles.confirmBtn
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
