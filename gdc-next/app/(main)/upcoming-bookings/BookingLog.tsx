'use client';

// BookingLog — a chronological activity log for one booking, shown at the bottom
// of the expanded card. It is DERIVED from timestamps the app already records
// (no separate event table): the request, contract sent/signed, each deposit /
// balance invoice + payment, planner submission, overtime, and cancellation.
// Every entry shows the date and time it happened, oldest → newest.
//
// Anything without a stored timestamp simply doesn't appear, so the log is
// always truthful about what we actually know.

import type { UpcomingBooking, BookingPayment } from './page';

interface Props {
  booking: UpcomingBooking;
  payments: BookingPayment[];
}

type Entry = { t: number; at: string; label: string };

function fmt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function kindLabel(kind: string): string {
  if (kind === 'deposit') return 'Deposit';
  if (kind === 'balance') return 'Balance';
  return 'Payment';
}

export default function BookingLog({ booking, payments }: Props) {
  const entries: Entry[] = [];
  const add = (ts: string | null | undefined, label: string) => {
    if (!ts) return;
    const t = Date.parse(ts);
    if (Number.isNaN(t)) return;
    entries.push({ t, at: ts, label });
  };

  // ── Request / creation ──
  add(booking.created_at, booking.is_manual ? 'Booking added (manual)' : 'Booking requested');

  // ── Contract ──
  add(booking.contract_sent_at, 'Contract sent to host');
  add(booking.contract_signed_at, 'Contract signed');

  // ── Payments ledger (deposit / balance) ──
  for (const p of payments) {
    const k = kindLabel(p.kind);
    add(p.requested_at, `${k} invoice sent`);
    if (p.marked_sent_at) add(p.marked_sent_at, `${k}: host said they'd pay`);
    if (p.status === 'paid' || p.status === 'waived') {
      add(p.confirmed_at ?? p.marked_sent_at ?? p.requested_at, `${k} received · receipt sent`);
    }
  }

  // ── Planner & Playlist — only the submission has an available time (the newest
  // host action, when that action was the planner). ──
  if (booking.last_activity_slot === 'song_list') {
    add(booking.last_activity_at, 'Planner & Playlist submitted by host');
  }

  // ── Overtime ──
  add(booking.overtime_invoiced_at, 'Overtime invoice sent');
  add(booking.overtime_paid_at, 'Overtime paid · receipt sent');

  // ── Cancellation ──
  if (booking.cancel_requested_at) {
    const who = booking.cancel_requested_by === 'dj' ? 'you' : 'host';
    const label = booking.cancel_status === 'accepted'
      ? 'Cancellation accepted'
      : booking.cancel_status === 'declined'
        ? 'Cancellation declined'
        : `Cancellation requested by ${who}`;
    add(booking.cancel_requested_at, label);
  }

  if (entries.length === 0) return null;

  entries.sort((a, b) => a.t - b.t);

  return (
    <div style={{ marginTop: '1.2rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,.08)' }}>
      <div style={{ fontSize: '.72rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,.55)', fontWeight: 700, marginBottom: '.7rem' }}>
        Booking log
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, position: 'relative' }}>
        {entries.map((e, i) => (
          <li
            key={`${e.t}-${i}`}
            style={{ position: 'relative', paddingLeft: '1.1rem', paddingBottom: i === entries.length - 1 ? 0 : '.7rem' }}
          >
            {/* dot */}
            <span style={{ position: 'absolute', left: 0, top: '.28rem', width: 8, height: 8, borderRadius: '50%', background: 'var(--neon,#00e0a4)' }} />
            {/* connector line */}
            {i !== entries.length - 1 && (
              <span style={{ position: 'absolute', left: 3.5, top: '.9rem', bottom: 0, width: 1, background: 'rgba(255,255,255,.12)' }} />
            )}
            <div style={{ fontSize: '.84rem', color: '#fff', fontWeight: 600, lineHeight: 1.35 }}>{e.label}</div>
            <div style={{ fontSize: '.72rem', color: 'rgba(255,255,255,.5)', marginTop: '.1rem' }}>{fmt(e.at)}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
