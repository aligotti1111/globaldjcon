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

import { useState, useCallback } from 'react';
import styles from './confirmModal.module.css';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // 'danger' variant uses red Confirm button (Deny / Cancel / Block).
  // 'primary' (default) uses the neon brand color (Approve / Accept).
  variant?: 'primary' | 'danger';
}

interface PendingState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export function useConfirm() {
  const [pending, setPending] = useState<PendingState | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const handleClose = (result: boolean) => {
    if (!pending) return;
    pending.resolve(result);
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
      onConfirm={() => handleClose(true)}
      onCancel={() => handleClose(false)}
    />
  ) : null;

  return { confirm, confirmDialog };
}

// ── The modal itself ───────────────────────────────────────────────────
interface Props {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmModal({
  title, message, confirmLabel, cancelLabel, variant, onConfirm, onCancel,
}: Props) {
  // Backdrop click cancels (matches CounterModal / ComposeMessageModal).
  // Clicking the box itself is stopped from bubbling to backdrop.
  return (
    <div className={styles.modalBackdrop} onClick={onCancel}>
      <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>{title}</div>
        {message && <div className={styles.message}>{message}</div>}
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
            onClick={onConfirm}
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
