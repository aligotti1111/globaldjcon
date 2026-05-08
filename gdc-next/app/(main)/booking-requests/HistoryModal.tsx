// HistoryModal — chronological view of a booking's negotiation_log.
//
// Each booking row carries a JSON array of negotiation entries, written
// to whenever a price proposal is made or revised:
//   - Booker's initial offer (logged at insert time by ClubBookingForm)
//   - DJ's first quote (logged by sendDraftQuote in BookingRequestsClient)
//   - Counter offers from either side (logged by CounterModal)
//
// This modal renders the log read-only. Recipient name labelling:
//   - If the entry was sent by the viewing user, label it "Me"
//   - Otherwise, label it with the OTHER party's name (DJ or booker)

'use client';

import styles from './bookingRequests.module.css';
import type { BookingRow } from './page';

interface NegotiationEntry {
  from: string;       // 'dj' | 'booker'
  amount: number;
  message?: string;
  created_at: string; // ISO timestamp
}

interface Props {
  booking: BookingRow;
  isIncoming: boolean;       // true when viewer is the DJ on this booking
  onClose: () => void;
}

function fmtTimestamp(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function currencySymbol(code?: string | null): string {
  switch ((code || 'USD').toUpperCase()) {
    case 'USD': case 'CAD': case 'AUD': return '$';
    case 'EUR': return '€';
    case 'GBP': return '£';
    case 'JPY': return '¥';
    default: return '$';
  }
}

export default function HistoryModal({ booking: b, isIncoming, onClose }: Props) {
  const log = (b.negotiation_log as NegotiationEntry[] | null) || [];
  const sym = currencySymbol((b as BookingRow & { currency?: string }).currency);
  const cur = (b as BookingRow & { currency?: string }).currency || 'USD';

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>Counter History</div>
          <button
            type="button"
            onClick={onClose}
            className={styles.modalCloseBtn}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {log.length === 0 ? (
          <div style={{
            padding: '2rem 1rem',
            textAlign: 'center',
            color: 'var(--muted)',
            fontSize: '.85rem',
          }}>
            No counter history yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
            {log.map((entry, i) => {
              // Sender label from the viewer's perspective.
              // - DJ entries: "Me" if viewer is DJ (isIncoming), else the DJ's display name.
              // - Booker entries: "Me" if viewer is the booker (!isIncoming), else booker's name.
              const isFromDj = entry.from === 'dj';
              const sentByMe = (isFromDj && isIncoming) || (!isFromDj && !isIncoming);
              const otherPartyName = isFromDj
                ? (b.dj_name || 'DJ')
                : (b.requester_name || 'Booker');
              const senderLabel = sentByMe ? 'Me' : otherPartyName;
              return (
                <div
                  key={i}
                  style={{
                    padding: '.7rem .9rem',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    background: sentByMe
                      ? 'rgba(0, 245, 196, 0.05)'
                      : 'rgba(255, 255, 255, 0.02)',
                  }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: '.6rem',
                    marginBottom: '.25rem',
                  }}>
                    <div style={{
                      fontFamily: "'Space Mono', monospace",
                      fontSize: '.62rem',
                      letterSpacing: '.08em',
                      textTransform: 'uppercase',
                      color: sentByMe ? 'var(--neon)' : 'var(--white)',
                      fontWeight: 700,
                    }}>
                      {senderLabel}
                    </div>
                    <div style={{
                      fontSize: '.65rem',
                      color: 'var(--muted)',
                      fontFamily: "'Space Mono', monospace",
                    }}>
                      {fmtTimestamp(entry.created_at)}
                    </div>
                  </div>
                  <div style={{
                    fontSize: '1.1rem',
                    fontWeight: 700,
                    color: 'var(--white)',
                    marginBottom: entry.message ? '.35rem' : 0,
                  }}>
                    {sym}{Number(entry.amount).toLocaleString()}{' '}
                    <span style={{ fontSize: '.7rem', color: 'var(--muted)', fontWeight: 400 }}>{cur}</span>
                  </div>
                  {entry.message && (
                    <div style={{
                      fontSize: '.78rem',
                      color: 'rgba(255,255,255,.75)',
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      paddingTop: '.35rem',
                      borderTop: '1px solid var(--border)',
                    }}>
                      {entry.message}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            className={styles.counterCancelBtn}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
