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

// One row of the change history (from booking_change_requests) — every edit the
// owner made, plus the host's approve/decline where required.
export type ChangeLogItem = {
  field: string;
  old_value: string | null;
  new_value: string | null;
  status: string;          // 'applied' | 'pending' | 'approved' | 'declined' | 'superseded'
  created_at: string;
  responded_at: string | null;
};

interface Props {
  booking: UpcomingBooking;
  payments: BookingPayment[];
  changes?: ChangeLogItem[];
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

export default function BookingLog({ booking, payments, changes }: Props) {
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

  // ── Contract ── contract_sent_at is stamped when the contract is PREPARED,
  // which in the DJ-signs-first flow means status 'awaiting_dj': the contract
  // exists but hasn't gone to the host yet — the DJ still has to sign. Only
  // once it's past that (awaiting_client / signed) has it actually reached the
  // host. Mirror the pipeline strip, which reads awaiting_dj as "Not sent" and
  // must not claim the host has it.
  // Read the write-once log stamp so this entry survives a contract CANCEL
  // (which nulls contract_sent_at to free the quota slot). Fall back to
  // contract_sent_at for rows created before the log column existed.
  const contractSentAt = booking.contract_sent_log_at ?? booking.contract_sent_at;
  if (booking.contract_status === 'awaiting_dj') {
    add(contractSentAt, 'Contract prepared — awaiting your signature', 'dj');
  } else {
    add(contractSentAt, 'Contract sent to host', 'dj');
  }
  // Set when the DocuSeal contract is fully signed (all parties). You're the
  // signer in this flow, so attribute it to You.
  add(booking.contract_signed_at, 'Contract signed', 'dj');
  // Marked complete by hand (contract handled outside the app) — distinct from
  // the host signing it in-app above.
  add(booking.contract_completed_at, 'Contract marked complete', 'dj');
  add(booking.contract_completion_undone_at, 'Contract completion undone', 'dj');
  add(booking.contract_cancelled_at, 'Contract cancelled', 'dj');
  // A party declined to sign on DocuSeal (both sides were emailed).
  add(booking.contract_declined_at, 'Contract declined', 'dj');

  // ── Payments ledger (deposit / balance) ──
  for (const p of payments) {
    const k = kindLabel(p.kind);
    add(p.requested_at, `${k} requested`, 'dj');
    if (p.marked_sent_at) {
      // When the host picks a trackable option (cash / check) on the confirm
      // page, record which one — and whether it's at the event — in the log.
      const m = p.method === 'cash' ? ' in cash' : p.method === 'check' ? ' by check' : '';
      const when = p.client_intent === 'pay_at_event' ? ' at the event' : '';
      add(p.marked_sent_at, `${k}: host chose to pay${m}${when}`, 'host');
    }
    if (p.status === 'paid' || p.status === 'waived') {
      add(p.confirmed_at ?? p.marked_sent_at ?? p.requested_at, `${k} received · receipt sent`, 'dj');
    }
  }

  // ── Deposit skip ── The DJ can skip the deposit and go straight to the
  // balance. A manual skip / undo carries its own timestamp. It can ALSO be
  // auto-skipped: requesting a balance while no deposit money was collected
  // effectively skips it — that one is derived from the ledger (timestamped at
  // the balance request), and suppressed if a manual skip was recorded so the
  // same event isn't logged twice.
  // Marked complete by hand (cash on the night, a transfer outside the app) —
  // distinct from a confirmed payment in the ledger above.
  add(booking.deposit_completed_at, 'Deposit marked complete', 'dj');
  add(booking.deposit_completion_undone_at, 'Deposit completion undone', 'dj');
  // Balance / final invoice marked complete by hand (outside the app).
  add(booking.balance_completed_at, 'Balance marked complete', 'dj');
  add(booking.balance_completion_undone_at, 'Balance completion undone', 'dj');
  add(booking.deposit_skipped_at, 'Deposit skipped', 'dj');
  add(booking.deposit_skip_undone_at, 'Deposit skip undone', 'dj');
  // A deposit / balance REQUEST that was cancelled (its payment row is deleted,
  // so these write-once stamps keep the event on the log).
  add(booking.deposit_request_cancelled_at, 'Deposit request cancelled', 'dj');
  add(booking.balance_request_cancelled_at, 'Balance request cancelled', 'dj');
  if (!booking.deposit_skipped_at) {
    const depositRealPaid = payments
      .filter((p) => p.kind === 'deposit')
      .reduce((sum, p) => sum + Number(p.amount_paid || 0), 0);
    const depositSettled = payments.some(
      (p) => p.kind === 'deposit' && (p.status === 'paid' || p.status === 'waived'),
    );
    const balance = payments.find((p) => p.kind === 'balance');
    if (balance && !depositSettled && depositRealPaid <= 0) {
      add(balance.requested_at, 'Deposit auto-skipped — balance requested', 'dj');
    }
  }

  // ── Planner & Playlist (mobile) — one stage, two moments: you send it, the
  // host submits it. Both carry their own timestamp (the planner row's
  // created_at / submitted_at), folded onto the booking server-side. Club
  // shares the song_list slot for the rider, so gate this to non-club. ──
  if (booking.booking_type !== 'club') {
    add(booking.planner_sent_at, 'Planner & Playlist sent to host', 'dj');
    add(booking.planner_submitted_at, 'Planner & Playlist submitted by host', 'host');
  }

  // ── Club / bar: rider + guest list host confirmations. ──
  add(booking.rider_confirmed_at, 'Rider confirmed by host', 'host');
  add(booking.guestlist_confirmed_at, 'Guest list confirmed by host', 'host');

  // ── Overtime (DJ-driven) ── Use the write-once log stamps so "invoice sent"
  // and "paid" survive a CLEAR (which nulls the state columns to reset the UI).
  // Fall back to the state columns for rows created before the log columns.
  add(booking.overtime_invoiced_log_at ?? booking.overtime_invoiced_at, 'Overtime invoice sent', 'dj');
  add(booking.overtime_paid_log_at ?? booking.overtime_paid_at, 'Overtime paid · receipt sent', 'dj');
  add(booking.overtime_cancelled_at, 'Overtime invoice cancelled', 'dj');

  // ── Cancellation ── TWO moments, each at its own time: the REQUEST (whoever
  // asked) always shows; if it was answered, the ACCEPT/DECLINE shows too — at
  // cancel_responded_at (the OTHER party). Previously only one line rendered,
  // and the answer stole the request's timestamp; the request just vanished.
  if (booking.cancel_requested_at) {
    const byDj = booking.cancel_requested_by === 'dj';
    add(booking.cancel_requested_at, `Cancellation requested by ${byDj ? 'you' : 'host'}`, byDj ? 'dj' : 'host');
    // The responder is the opposite party. Fall back to the request time only
    // if the response wasn't separately stamped (legacy rows).
    const respondedAt = booking.cancel_responded_at || booking.cancel_requested_at;
    if (booking.cancel_status === 'accepted') {
      add(respondedAt, 'Cancellation accepted', byDj ? 'host' : 'dj');
    } else if (booking.cancel_status === 'declined') {
      add(respondedAt, 'Cancellation declined', byDj ? 'host' : 'dj');
    }
  }

  // ── Booking-detail changes (owner edits + host approvals) ── Each change is a
  // step: the owner made it, and for approval-required fields the host's
  // approve/decline is its own later step.
  for (const c of (changes || [])) {
    const val = `${c.field}: ${c.old_value || '—'} → ${c.new_value || '—'}`;
    if (c.status === 'applied') {
      add(c.created_at, `Updated ${val}`, 'dj');
    } else {
      add(c.created_at, `Requested change (needs host approval) — ${val}`, 'dj');
      if (c.status === 'approved') add(c.responded_at, `Host approved change — ${c.field}`, 'host');
      else if (c.status === 'declined') add(c.responded_at, `Host declined change — ${c.field}`, 'host');
      else if (c.status === 'superseded') add(c.responded_at, `Change replaced by a newer one — ${c.field}`, 'dj');
      else if (c.status === 'cancelled') add(c.responded_at, `Cancelled requested change — ${c.field}`, 'dj');
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
