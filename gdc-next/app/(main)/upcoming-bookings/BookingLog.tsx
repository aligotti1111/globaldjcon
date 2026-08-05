'use client';

// BookingLog — a chronological activity log for one booking, shown at the bottom
// of the expanded card (owner-only). DERIVED from timestamps the app already
// records (no separate event table): the request, contract sent/signed, each
// deposit / balance invoice + payment, planner submission, rider / guest list
// confirmations, overtime, and cancellation.
//
// Every entry is attributed to who did it — the DJ (you / your team) or the
// HOST — with a colored dot + a small badge, and shows the date and time,
// oldest → newest. Anything without a stored timestamp simply doesn't appear.

import type { UpcomingBooking, BookingPayment } from './page';

interface Props {
  booking: UpcomingBooking;
  payments: BookingPayment[];
}

type Actor = 'dj' | 'host';
type Entry = { t: number; at: string; label: string; actor: Actor };

const NEON = 'var(--neon,#00e0a4)';
const HOST_COLOR = '#6ea8ff';

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
  const add = (ts: string | null | undefined, label: string, actor: Actor) => {
    if (!ts) return;
    const t = Date.parse(ts);
    if (Number.isNaN(t)) return;
    entries.push({ t, at: ts, label, actor });
  };

  // ── Request / creation ── (host requested it, or the DJ added it manually)
  add(booking.created_at, booking.is_manual ? 'Booking added (manual)' : 'Booking requested', booking.is_manual ? 'dj' : 'host');

  // ── Accepted ── (you approved the request; stamped at approval time)
  add(booking.accepted_at, 'Booking accepted', 'dj');

  // ── Contract ── (DJ sends; host signs)
  add(booking.contract_sent_at, 'Contract sent to host', 'dj');
  add(booking.contract_signed_at, 'Contract signed', 'host');

  // ── Payments ledger (deposit / balance) ──
  for (const p of payments) {
    const k = kindLabel(p.kind);
    add(p.requested_at, `${k} invoice sent`, 'dj');
    if (p.marked_sent_at) add(p.marked_sent_at, `${k}: host said they'd pay`, 'host');
    if (p.status === 'paid' || p.status === 'waived') {
      add(p.confirmed_at ?? p.marked_sent_at ?? p.requested_at, `${k} received · receipt sent`, 'dj');
    }
  }

  // ── Planner & Playlist (mobile) — host submission. Club shares the song_list
  // slot for the rider, so gate this to non-club. ──
  if (booking.booking_type !== 'club' && booking.last_activity_slot === 'song_list') {
    add(booking.last_activity_at, 'Planner & Playlist submitted by host', 'host');
  }

  // ── Club / bar: rider + guest list host confirmations. ──
  add(booking.rider_confirmed_at, 'Rider confirmed by host', 'host');
  add(booking.guestlist_confirmed_at, 'Guest list confirmed by host', 'host');

  // ── Overtime (DJ-driven) ──
  add(booking.overtime_invoiced_at, 'Overtime invoice sent', 'dj');
  add(booking.overtime_paid_at, 'Overtime paid · receipt sent', 'dj');

  // ── Cancellation ── the request is attributed to whoever asked; an
  // accept/decline is the OTHER party responding.
  if (booking.cancel_requested_at) {
    const byDj = booking.cancel_requested_by === 'dj';
    if (booking.cancel_status === 'accepted') {
      add(booking.cancel_requested_at, 'Cancellation accepted', byDj ? 'host' : 'dj');
    } else if (booking.cancel_status === 'declined') {
      add(booking.cancel_requested_at, 'Cancellation declined', byDj ? 'host' : 'dj');
    } else {
      add(booking.cancel_requested_at, `Cancellation requested by ${byDj ? 'you' : 'host'}`, byDj ? 'dj' : 'host');
    }
  }

  if (entries.length === 0) return null;

  entries.sort((a, b) => a.t - b.t);

  const badge = (actor: Actor) => (
    <span
      style={{
        fontSize: '.6rem', fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase',
        padding: '.08rem .4rem', borderRadius: 999, lineHeight: 1.5,
        color: actor === 'dj' ? '#06231b' : '#0b1c33',
        background: actor === 'dj' ? NEON : HOST_COLOR,
      }}
    >
      {actor === 'dj' ? 'You' : 'Host'}
    </span>
  );

  return (
    <div style={{ marginTop: '1.2rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.7rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <div style={{ fontSize: '.72rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,.55)', fontWeight: 700 }}>
          Booking log
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '.7rem' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.66rem', color: 'rgba(255,255,255,.55)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: NEON }} /> You
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.66rem', color: 'rgba(255,255,255,.55)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: HOST_COLOR }} /> Host
          </span>
        </div>
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, position: 'relative' }}>
        {entries.map((e, i) => (
          <li
            key={`${e.t}-${i}`}
            style={{ position: 'relative', paddingLeft: '1.1rem', paddingBottom: i === entries.length - 1 ? 0 : '.7rem' }}
          >
            {/* dot — colored by actor */}
            <span style={{ position: 'absolute', left: 0, top: '.28rem', width: 8, height: 8, borderRadius: '50%', background: e.actor === 'dj' ? NEON : HOST_COLOR }} />
            {/* connector line */}
            {i !== entries.length - 1 && (
              <span style={{ position: 'absolute', left: 3.5, top: '.9rem', bottom: 0, width: 1, background: 'rgba(255,255,255,.12)' }} />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem', flexWrap: 'wrap' }}>
              {badge(e.actor)}
              <span style={{ fontSize: '.84rem', color: '#fff', fontWeight: 600, lineHeight: 1.35 }}>{e.label}</span>
            </div>
            <div style={{ fontSize: '.72rem', color: 'rgba(255,255,255,.5)', marginTop: '.1rem' }}>{fmt(e.at)}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
