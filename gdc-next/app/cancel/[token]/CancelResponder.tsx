'use client';

// The two buttons on /cancel/[token], plus every state the page can be in.
//
// Accepting is behind a confirm step on purpose: a mis-tap in an email client
// should not end somebody's wedding booking.

import { useState } from 'react';

interface Props {
  token: string;
  /** Non-null when there is nothing left to answer. */
  alreadyResolved: 'cancelled' | 'answered' | null;
  expired: boolean;
  askedBy: 'dj' | 'host';
  reason: string | null;
  otherName: string;
  /** null when we have no number on file — then no contact line is shown. */
  otherPhone: string | null;
  hasContract: boolean;
  eventDate: string;
  timeRange: string;
  venueName: string | null;
}

const wrap: React.CSSProperties = {
  maxWidth: 560,
  margin: '0 auto',
  padding: '3rem 1.25rem',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  color: '#1a1a2e',
};
const card: React.CSSProperties = {
  background: '#f8f8f8',
  border: '1px solid #e0e0e0',
  borderRadius: 10,
  padding: '1.1rem 1.25rem',
  margin: '1.25rem 0',
};
const btnBase: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '.85rem 1rem',
  borderRadius: 8,
  fontSize: '1rem',
  fontWeight: 700,
  cursor: 'pointer',
  border: 'none',
  marginBottom: '.65rem',
};

export default function CancelResponder(props: Props) {
  const {
    token, alreadyResolved, expired, askedBy, reason,
    otherName, otherPhone, hasContract, eventDate, timeRange, venueName,
  } = props;

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'accepted' | 'declined' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const askerLabel = askedBy === 'dj' ? 'Your DJ' : 'The host';

  async function respond(action: 'accept' | 'decline') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/bookings/cancel-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Something went wrong.');
      setDone(action === 'accept' ? 'accepted' : 'declined');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  // Shown after declining, and anywhere else the right next step is a phone
  // call. Omitted entirely when we have no number.
  const contactBlock = otherPhone ? (
    <div style={card}>
      <p style={{ margin: 0, fontSize: '.95rem' }}>
        Please reach out to <strong>{otherName}</strong> directly to talk it through:{' '}
        <a href={`tel:${otherPhone.replace(/[^\d+]/g, '')}`} style={{ color: '#0a7', fontWeight: 700 }}>
          {otherPhone}
        </a>
      </p>
    </div>
  ) : null;

  const contractNote = hasContract ? (
    <p style={{ fontSize: '.85rem', color: '#8a6d1a', background: '#fff7e6', border: '1px solid #f0d9a8', borderRadius: 8, padding: '.7rem .9rem' }}>
      There is a signed contract for this booking. Cancelling here does not void
      it — any terms you agreed to still stand.
    </p>
  ) : null;

  const eventCard = (
    <div style={card}>
      {eventDate && <div style={{ fontWeight: 700 }}>{eventDate}</div>}
      {timeRange && <div style={{ color: '#666', fontSize: '.9rem' }}>{timeRange}</div>}
      {venueName && <div style={{ color: '#666', fontSize: '.9rem' }}>{venueName}</div>}
    </div>
  );

  // ── Terminal states ───────────────────────────────────────────────
  if (done === 'accepted') {
    return (
      <div style={wrap}>
        <h1 style={{ fontSize: '1.6rem' }}>Booking cancelled</h1>
        <p style={{ color: '#666' }}>
          The booking has been cancelled and {otherName} has been notified.
        </p>
        {eventCard}
        {contractNote}
      </div>
    );
  }

  if (done === 'declined') {
    return (
      <div style={wrap}>
        <h1 style={{ fontSize: '1.6rem' }}>Cancellation declined</h1>
        <p style={{ color: '#666' }}>
          The booking still stands. {otherName} has been told you'd like to keep it.
        </p>
        {eventCard}
        {contactBlock}
      </div>
    );
  }

  if (alreadyResolved === 'cancelled') {
    return (
      <div style={wrap}>
        <h1 style={{ fontSize: '1.6rem' }}>This booking is already cancelled</h1>
        {eventCard}
        {contactBlock}
      </div>
    );
  }

  if (alreadyResolved === 'answered') {
    return (
      <div style={wrap}>
        <h1 style={{ fontSize: '1.6rem' }}>This request has already been answered</h1>
        <p style={{ color: '#666' }}>Nothing further to do here.</p>
        {eventCard}
        {contactBlock}
      </div>
    );
  }

  if (expired) {
    return (
      <div style={wrap}>
        <h1 style={{ fontSize: '1.6rem' }}>This link has expired</h1>
        <p style={{ color: '#666' }}>
          Cancellation links are good for 14 days.
        </p>
        {eventCard}
        {contactBlock}
      </div>
    );
  }

  // ── The actual decision ───────────────────────────────────────────
  return (
    <div style={wrap}>
      <h1 style={{ fontSize: '1.6rem', marginBottom: '.4rem' }}>Cancellation requested</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        {askerLabel} has asked to cancel this booking. It is still on until you answer.
      </p>

      {eventCard}

      {reason && (
        <div style={card}>
          <div style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.05em', color: '#888', marginBottom: '.3rem' }}>
            Reason given
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{reason}</div>
        </div>
      )}

      {!reason && (
        <p style={{ color: '#666', fontSize: '.9rem' }}>
          No reason was given. If you're unsure why, contact {otherName} before
          you answer.
        </p>
      )}

      {contractNote}

      {error && (
        <p style={{ color: '#c0392b', fontWeight: 600 }}>{error}</p>
      )}

      {!confirming ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
            style={{ ...btnBase, background: '#c0392b', color: '#fff' }}
          >
            Accept — cancel this booking
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => respond('decline')}
            style={{ ...btnBase, background: '#0a7', color: '#fff' }}
          >
            {busy ? 'Saving…' : 'Decline — keep this booking'}
          </button>
        </>
      ) : (
        <>
          <p style={{ fontWeight: 700 }}>
            Are you sure? This cancels the booking for {eventDate || 'this date'}.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => respond('accept')}
            style={{ ...btnBase, background: '#c0392b', color: '#fff' }}
          >
            {busy ? 'Cancelling…' : 'Yes, cancel this booking'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
            style={{ ...btnBase, background: '#e8e8e8', color: '#1a1a2e' }}
          >
            Go back
          </button>
        </>
      )}

      {contactBlock}
    </div>
  );
}
