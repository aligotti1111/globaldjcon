'use client';

// ContactModal — the Contact Us form as an in-place popup, so clicking
// "Contact Us" (footer, mobile menu) opens it over the current page instead
// of navigating away. Portals to <body> so it overlays everything.
//
// <ContactTrigger> renders the clickable label and owns the open state.
// The form logic mirrors the standalone /contact page.

import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/components/AuthProvider';
import styles from '@/app/(simple)/contact/contact.module.css';

const SUBJECTS = [
  'General Inquiry',
  'DJ Profile Issue',
  'Booking Help',
  'Account Issue',
  'Report a Problem',
  'Partnership / Advertising',
  'Other',
];

function ContactForm({ onClose }: { onClose: () => void }) {
  const { user, loading } = useAuth();
  const initialName = useMemo(() => user?.name || '', [user]);
  const initialEmail = useMemo(() => user?.email || '', [user]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

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
      setError(err instanceof Error ? err.message : 'Unknown error');
      setSubmitting(false);
    }
  }

  return (
    <>
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
            We received your message and will<br />get back to you shortly.
          </p>
          <button className={styles.submitBtn} onClick={onClose} style={{ marginTop: '1rem' }}>
            Close
          </button>
        </div>
      ) : (
        <>
          <div className={styles.formGroup}>
            <label htmlFor="cm-name">Your Name</label>
            <input id="cm-name" type="text" placeholder="Jane Smith"
              value={effectiveName} onChange={(e) => setName(e.target.value)} readOnly={nameLocked} />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="cm-email">Email Address</label>
            <input id="cm-email" type="email" placeholder="your@email.com"
              value={effectiveEmail} onChange={(e) => setEmail(e.target.value)} readOnly={emailLocked} />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="cm-subject">Subject</label>
            <select id="cm-subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">Select a subject...</option>
              {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="cm-message">Message</label>
            <textarea id="cm-message" placeholder="Tell us how we can help..."
              value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <button className={styles.submitBtn} onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Sending...' : 'Send Message'}
          </button>
        </>
      )}
    </>
  );
}

export function ContactTrigger({ className, children, style, onClick }: { className?: string; children: React.ReactNode; style?: React.CSSProperties; onClick?: () => void }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => { onClick?.(); setOpen(true); }}
        style={{ background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', ...style }}
      >
        {children}
      </button>
      {open && mounted && createPortal(
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 6000,
            background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            overflowY: 'auto', padding: '1.5rem',
          }}
        >
          <div
            className={styles.container}
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'relative', maxHeight: 'calc(100vh - 3rem)', overflowY: 'auto' }}
          >
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              style={{
                position: 'absolute', top: 14, right: 14, zIndex: 5,
                width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: '50%', border: '1px solid rgba(255,255,255,.25)',
                background: 'rgba(255,255,255,.08)', color: '#fff', fontSize: '1.05rem',
                lineHeight: 1, cursor: 'pointer',
              }}
            >
              ✕
            </button>
            <ContactForm onClose={() => setOpen(false)} />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
