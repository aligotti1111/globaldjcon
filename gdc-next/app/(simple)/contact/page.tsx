'use client';

// Contact Us page.
// Mirrors vanilla contact.html behavior:
//   - If logged in, auto-fills name + email and locks those fields
//   - Validates all fields client-side
//   - Submits to /api/send-email with type 'contact_us'
//   - Shows success view on success, inline error on failure

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import styles from './contact.module.css';

const SUBJECTS = [
  'General Inquiry',
  'DJ Profile Issue',
  'Booking Help',
  'Account Issue',
  'Report a Problem',
  'Partnership / Advertising',
  'Other',
];

export default function ContactPage() {
  const { user, loading } = useAuth();

  // Pre-fill name/email from auth if signed in
  const initialName = useMemo(() => user?.name || '', [user]);
  const initialEmail = useMemo(() => user?.email || '', [user]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // When auth resolves, push the auth values into the form fields.
  // We use controlled inputs but seed them from auth once it's ready.
  const effectiveName = name || initialName;
  const effectiveEmail = email || initialEmail;
  const nameLocked = !loading && !!user && !!initialName;
  const emailLocked = !loading && !!user && !!initialEmail;

  async function handleSubmit() {
    setError(null);

    const trimmedName = effectiveName.trim();
    const trimmedEmail = effectiveEmail.trim().toLowerCase();
    const trimmedMessage = message.trim();

    if (!trimmedName || !trimmedEmail || !subject || !trimmedMessage) {
      setError('Please fill in all fields.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'contact_us',
          name: trimmedName,
          email: trimmedEmail,
          subject,
          message: trimmedMessage,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send');
      setSuccess(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.body}>
      <div className={styles.container}>
        <div className={styles.logo}>
          <Link href="/">
            <h1>GLOBAL DJ CONNECT</h1>
          </Link>
          <p className={styles.tagline}>Directory &amp; Booking</p>
        </div>

        <div className={styles.pageTitle}>Contact Us</div>
        <p className={styles.pageSub}>We&apos;ll get back to you as soon as possible</p>

        {error && (
          <div className={`${styles.alert} ${styles.alertError}`}>
            Error: {error}. Email us at{' '}
            <a href="mailto:info@globaldjconnect.com">info@globaldjconnect.com</a>
          </div>
        )}

        {success ? (
          <div className={styles.successView}>
            <div className={styles.successIcon}>✅</div>
            <div className={styles.successTitle}>Message Sent!</div>
            <p className={styles.successSub}>
              We received your message and will
              <br />get back to you shortly.
            </p>
          </div>
        ) : (
          <>
            <div className={styles.formGroup}>
              <label htmlFor="contact-name">Your Name</label>
              <input
                id="contact-name"
                type="text"
                placeholder="Jane Smith"
                value={effectiveName}
                onChange={(e) => setName(e.target.value)}
                readOnly={nameLocked}
              />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="contact-email">Email Address</label>
              <input
                id="contact-email"
                type="email"
                placeholder="your@email.com"
                value={effectiveEmail}
                onChange={(e) => setEmail(e.target.value)}
                readOnly={emailLocked}
              />
              {emailLocked && (
                <span className={styles.signedHint}>
                  ✓ Signed in — we&apos;ll reply to this email
                </span>
              )}
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="contact-subject">Subject</label>
              <select
                id="contact-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              >
                <option value="">Select a subject...</option>
                {SUBJECTS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="contact-message">Message</label>
              <textarea
                id="contact-message"
                placeholder="Tell us how we can help..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
            <button
              className={styles.submitBtn}
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? 'Sending...' : 'Send Message'}
            </button>
          </>
        )}

        <div className={styles.divider}>
          <Link href="/">← Back to Directory</Link>
        </div>
      </div>
    </div>
  );
}
