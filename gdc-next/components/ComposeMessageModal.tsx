'use client';

// ComposeMessageModal — shared modal for composing a new message.
//
// Used by:
//   - DJ profile page (visitor → DJ)
//   - Booking-requests page (DJ ↔ booker on a specific booking)
//
// Behavior:
//   - INSERTs a row into `messages` with parent_id null (this is a NEW
//     thread — replies happen in the inbox).
//   - Fires inbox_notification email via /api/send-email so the recipient
//     gets pinged even if they never visit the site.
//   - Email failures are swallowed so a DB success isn't undone by an
//     email outage.
//
// Pattern matches CounterModal: portal-style fullscreen backdrop, single
// modalBox, close on backdrop click, stopPropagation on the box.

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './composeMessage.module.css';

interface Sender {
  id: string;
  name: string;
  email: string | null;
}

interface Props {
  // Who's sending (the logged-in user)
  sender: Sender;
  // Recipient identification — we use userId server-side for email lookup,
  // displayName for the modal title + greeting.
  recipientUserId: string;
  recipientName: string;
  // Optional pre-filled subject (e.g. "Booking inquiry: 2026-08-12")
  defaultSubject?: string;
  // Called when modal should close (after success or on cancel)
  onClose: () => void;
  // Called after a successful send (parent can show a toast etc.)
  onSent?: () => void;
}

export default function ComposeMessageModal({
  sender,
  recipientUserId,
  recipientName,
  defaultSubject = '',
  onClose,
  onSent,
}: Props) {
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Success state shown briefly before auto-closing the modal
  const [sent, setSent] = useState(false);

  async function submit() {
    setError(null);
    const subj = subject.trim();
    const msg = message.trim();
    if (!subj) { setError('Please enter a subject.'); return; }
    if (!msg) { setError('Please enter a message.'); return; }
    if (!recipientUserId) { setError('No recipient.'); return; }

    setSubmitting(true);
    const db = createClient();

    try {
      // Insert the message. parent_id is null because this is a new thread
      // (not a reply to an existing message). Replies happen in /inbox.
      const { error: insErr } = await db
        .from('messages')
        .insert([{
          parent_id: null,
          to_user_id: recipientUserId,
          from_user_id: sender.id,
          from_name: sender.name,
          from_email: sender.email,
          subject: subj,
          message: msg,
          read: false,
        }] as unknown as never);

      if (insErr) throw insErr;

      // Email the recipient that they have a new message. Server-side
      // looks up the recipient's email via admin API if not provided.
      // Wrapped in try/catch so a DB save isn't undone by an email outage.
      try {
        await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'inbox_notification',
            recipientUserId,
            recipientName,
            senderName: sender.name,
            senderEmail: sender.email || undefined,
            subject: subj,
            message: msg,
          }),
        });
      } catch (e) {
        console.warn('Inbox notification email failed:', e);
      }

      setSent(true);
      onSent?.();
      // Auto-close after a short success state so the user sees the ✓
      setTimeout(() => {
        onClose();
      }, 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>Message {recipientName}</div>
          <button
            type="button"
            onClick={onClose}
            className={styles.modalCloseBtn}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {sent ? (
          <div className={styles.sentBox}>
            <div className={styles.sentCheck}>✓</div>
            <div className={styles.sentText}>Message sent</div>
            <div className={styles.sentSub}>
              {recipientName} will be notified by email.
            </div>
          </div>
        ) : (
          <>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="What's this about?"
                className={styles.input}
                disabled={submitting}
                maxLength={200}
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Message</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Write your message..."
                className={styles.textarea}
                rows={6}
                disabled={submitting}
                maxLength={5000}
              />
              <div className={styles.charCount}>
                {message.length} / 5000
              </div>
            </div>

            {error && <div className={styles.errorText}>{error}</div>}

            <div className={styles.actionsRow}>
              <button
                type="button"
                onClick={onClose}
                className={styles.cancelBtn}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                className={styles.sendBtn}
                disabled={submitting}
              >
                {submitting ? 'Sending…' : 'Send Message'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
