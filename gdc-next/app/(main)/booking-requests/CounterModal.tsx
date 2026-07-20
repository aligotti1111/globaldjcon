'use client';

// CounterModal — counter-offer dialog used by both sides of a booking.
//
// DJ side (group='in'): on an INCOMING pending booking, DJ proposes a
// different rate. status flips to 'counter', counter_rate + counter_message
// stored, negotiation_log appended with from='dj'.
//
// Booker side (group='out'): on an OUTGOING booking that's now in 'counter'
// status (DJ countered), booker can counter back. status flips back to
// 'pending', counter_rate + counter_message updated, negotiation_log
// appended with from='booker'.
//
// PACKAGE EDITING (DJ side only, mobile bookings only):
// When the booking has a package attached, the DJ can also edit the
// package contents as part of their counter. We open a rich-text editor
// pre-filled with the original package_details HTML; on save we diff the
// edited content against the original and persist the diffed HTML (with
// inline <s>/<ins> markers so the host sees what changed).
// The booker side has no package editor — only the DJ owns the package.

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './bookingRequests.module.css';
import { currencySymbol } from '@/lib/constants';
import type { BookingRow } from './page';
import CounterPackageEditor from './CounterPackageEditor';
import { acceptDiff, isPackageEdited } from './packageDiff';

interface Props {
  booking: BookingRow;
  group: 'in' | 'out';            // 'in' = DJ countering, 'out' = booker re-countering
  onClose: () => void;
  // Called after a successful save so the parent can refresh its local
  // state. We pass the updated row so the parent can replace it in place.
  onSaved: (updated: BookingRow) => void;
}

function formatTime(t: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const hour12 = h % 12 || 12;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${hour12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function eventDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '—';
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return hrs > 0 ? `${hrs}hr${hrs > 1 ? 's' : ''}${rem > 0 ? ` ${rem}m` : ''}` : `${rem}m`;
}

export default function CounterModal({ booking, group, onClose, onSaved }: Props) {
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Package edit — only relevant when:
  //   1. The booking has a package_details HTML to edit, AND
  //   2. We're on the DJ side (group='in'). The booker doesn't own the
  //      package and shouldn't be modifying it.
  // When package_details already contains a prior diff (from an earlier
  // counter the DJ may have sent), we accept that diff first to get the
  // "current" state, then let the DJ edit from there. This way successive
  // counters build on the latest accepted version, not pile diffs onto
  // diffs.
  const canEditPackage = group === 'in' && !!booking.package_details;
  const baselinePackageHtml = canEditPackage
    ? (isPackageEdited(booking.package_details)
        ? acceptDiff(booking.package_details || '')
        : (booking.package_details || ''))
    : '';
  // packageDetailsHtml holds the FINAL value to save — already diffed
  // against the baseline. Initialized to the baseline (no edits yet).
  const [packageDetailsHtml, setPackageDetailsHtml] = useState<string>(baselinePackageHtml);
  // Whether the package editor is open. Default closed; DJ clicks
  // "Edit package" to expand it. Keeps the modal compact for DJs who
  // only want to counter the price.
  const [packageEditorOpen, setPackageEditorOpen] = useState(false);

  // Currency — vanilla pulls from booking.currency; we don't have that
  // field on the type yet so default to USD.
  const currency = 'USD';
  const sym = currencySymbol(currency);

  // Show the most recent rate exchanged so the DJ/booker has context for
  // their counter. Only shown when there's been at least one prior offer.
  const currentRate = booking.counter_rate || booking.quoted_rate;
  const currentRateLabel = booking.counter_rate ? 'Last Counter' : 'Their Offer';

  // Event details — show date/time/duration. The mobile booking adds an
  // event-type label; club bookings just show date/time.
  const dateStr = booking.event_date
    ? new Date(booking.event_date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : '—';
  const timeStr = booking.start_time && booking.end_time
    ? `${formatTime(booking.start_time)} – ${formatTime(booking.end_time)}`
    : booking.start_time
    ? formatTime(booking.start_time)
    : '—';
  const durStr = eventDuration(booking.start_time, booking.end_time);

  async function submit() {
    setError(null);
    if (!amount.trim() || isNaN(Number(amount)) || Number(amount) <= 0) {
      setError('Enter a valid counter amount.');
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in.');

      // Append to negotiation log (jsonb array). Pull current value first
      // so we don't clobber concurrent updates.
      const { data: current } = await supabase
        .from('bookings')
        .select('negotiation_log')
        .eq('id', booking.id)
        .single<{ negotiation_log: BookingRow['negotiation_log'] }>();
      const log = current?.negotiation_log || [];
      log.push({
        from: group === 'in' ? 'dj' : 'booker',
        amount: Number(amount),
        message: message.trim(),
        created_at: new Date().toISOString(),
      });

      // Status differs by side:
      //   DJ countering    → status='counter' (waiting on booker)
      //   Booker re-counter → status='pending' (back in DJ's court)
      const newStatus = group === 'in' ? 'counter' : 'pending';

      // Package edit: only include package_details in the update when
      // the DJ actually changed something. Otherwise leave the column
      // alone — overwriting it unconditionally would clobber prior
      // edits or wipe a valid existing package.
      const packageChanged =
        canEditPackage && packageDetailsHtml !== baselinePackageHtml;

      const updatePayload: Record<string, unknown> = {
        status: newStatus,
        counter_rate: Number(amount),
        counter_message: message.trim() || null,
        negotiation_log: log,
        updated_at: new Date().toISOString(),
      };
      if (packageChanged) {
        updatePayload.package_details = packageDetailsHtml;
      }

      // RLS: DJ side updates bookings WHERE dj_id = me;
      // booker side updates WHERE requester_id = me. Either side update
      // succeeds because the user owns one of those columns.
      const updateQuery = supabase
        .from('bookings')
        .update(updatePayload as unknown as never)
        .eq('id', booking.id);
      const finalQuery = group === 'in'
        ? updateQuery.eq('dj_id', user.id)
        : updateQuery.eq('requester_id', user.id);

      const { error: updErr } = await finalQuery;
      if (updErr) throw updErr;

      // Email the OTHER party (recipient) about the counter offer.
      // DJ countered → email the booker; booker countered → email the DJ.
      // Pass the full booking context so the email renders the same info
      // card the original booking_request used.
      // Failures are swallowed so the DB save isn't undone by an email outage.
      try {
        const isFromDj = group === 'in';
        const bExt = booking as BookingRow & {
          currency?: string;
          set_type?: string | null;
          venue_type?: string | null;
          venue_address?: string | null;
          package_title?: string | null;
        };
        await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'booking_counter',
            bookingId: booking.id,
            recipientUserId: isFromDj ? booking.requester_id : booking.dj_id,
            recipientName: isFromDj ? booking.requester_name : booking.dj_name,
            senderName: isFromDj ? booking.dj_name : booking.requester_name,
            fromRole: isFromDj ? 'dj' : 'booker',
            counterRate: Number(amount),
            counterMessage: message.trim() || null,
            eventDate: booking.event_date,
            startTime: booking.start_time,
            endTime: booking.end_time,
            setType: bExt.set_type,
            venueType: bExt.venue_type,
            venueName: booking.venue_name,
            venueAddress: bExt.venue_address,
            packageTitle: bExt.package_title,
            currency: bExt.currency || 'USD',
          }),
        });
      } catch (e) {
        console.warn('Counter email failed:', e);
      }

      // Build the updated row to hand back to the parent so it can patch
      // local state without a full re-fetch. Only include package_details
      // if it changed, mirroring what we sent to the DB.
      onSaved({
        ...booking,
        status: newStatus,
        counter_rate: Number(amount),
        counter_message: message.trim() || null,
        negotiation_log: log,
        updated_at: new Date().toISOString(),
        ...(packageChanged ? { package_details: packageDetailsHtml } : {}),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>
            {group === 'in' ? 'Send Counter Offer' : 'Counter Back'}
          </div>
          <button
            type="button"
            onClick={onClose}
            className={styles.modalCloseBtn}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Event details — same for both sides */}
        <div className={styles.counterDetailsBox}>
          <div className={styles.counterDetailRow}>
            <span className={styles.counterDetailLabel}>Date</span>
            <span className={styles.counterDetailVal}>{dateStr}</span>
          </div>
          <div className={styles.counterDetailRow}>
            <span className={styles.counterDetailLabel}>Time</span>
            <span className={styles.counterDetailVal}>{timeStr}</span>
          </div>
          <div className={styles.counterDetailRow}>
            <span className={styles.counterDetailLabel}>Duration</span>
            <span className={styles.counterDetailVal}>{durStr}</span>
          </div>
          {booking.venue_name && (
            <div className={styles.counterDetailRow}>
              <span className={styles.counterDetailLabel}>Venue</span>
              <span className={styles.counterDetailVal}>{booking.venue_name}</span>
            </div>
          )}
        </div>

        {/* Reference: prior rate */}
        {currentRate && (
          <div className={styles.counterCurrentRate}>
            <span className={styles.counterCurrentRateLabel}>{currentRateLabel}</span>
            <span className={styles.counterCurrentRateVal}>
              {sym}{Number(currentRate).toLocaleString()} {currency}
            </span>
          </div>
        )}

        {/* Counter amount input */}
        <div className={styles.counterFormGroup}>
          <label className={styles.counterFormLabel}>Your Counter Offer</label>
          <div className={styles.counterAmountRow}>
            <span className={styles.counterCurrencySym}>{sym}</span>
            <input
              type="number"
              onWheel={(e) => e.currentTarget.blur()}
              min="0"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
              className={styles.counterAmountInput}
            />
            <span className={styles.counterCurrencyCode}>{currency}</span>
          </div>
        </div>

        {/* Optional message */}
        <div className={styles.counterFormGroup}>
          <label className={styles.counterFormLabel}>
            Message <span className={styles.counterFormOpt}>(optional)</span>
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Add context for your counter..."
            rows={3}
            className={styles.counterMsgInput}
          />
        </div>

        {/* Package edit (DJ side, mobile bookings only). Collapsed by
            default — DJs who only want to counter price keep a compact
            modal. Click to expand the rich-text editor. */}
        {canEditPackage && (
          <div className={styles.counterFormGroup}>
            <button
              type="button"
              onClick={() => setPackageEditorOpen((v) => !v)}
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#ddd',
                padding: '10px 12px',
                borderRadius: 8,
                fontSize: 13,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
              aria-expanded={packageEditorOpen}
            >
              <span>
                {packageEditorOpen ? '▾' : '▸'} Edit package contents
                {packageDetailsHtml !== baselinePackageHtml && (
                  <span style={{ marginLeft: 8, color: '#6ee7b7', fontSize: 11 }}>
                    • edited
                  </span>
                )}
              </span>
              <span style={{ fontSize: 11, color: '#888' }}>
                {booking.package_title || 'Package'}
              </span>
            </button>
            {packageEditorOpen && (
              <div style={{ marginTop: 8 }}>
                <CounterPackageEditor
                  originalHtml={baselinePackageHtml}
                  onChange={setPackageDetailsHtml}
                />
              </div>
            )}
          </div>
        )}

        {error && <div className={styles.counterErr}>{error}</div>}

        <div className={styles.counterActions}>
          <button
            type="button"
            onClick={onClose}
            className={styles.counterCancelBtn}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className={styles.counterSubmitBtn}
          >
            {submitting ? 'Sending…' : 'Send Counter'}
          </button>
        </div>
      </div>
    </div>
  );
}
