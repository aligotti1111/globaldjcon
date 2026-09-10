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

import { useEffect, useState } from 'react';
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

  // The booking's frozen currency snapshot (legacy rows fall back to USD).
  // Not on the generated row type yet, so read via a local cast — same as the
  // email payload below already does.
  const currency = (booking as BookingRow & { currency?: string }).currency || 'USD';
  const sym = currencySymbol(currency);

  // Full offer history, so whoever's countering sees the whole back-and-forth,
  // not just the last number. Starts with the host's ORIGINAL ask (which lives
  // on the booking, not in the log), then every counter from the negotiation
  // log in order. The last row is the standing offer they're responding to.
  const origAmount =
    (booking as BookingRow & { offer_amount?: number | null }).offer_amount ??
    booking.quoted_rate;
  const history: { who: string; amount: number; when?: string | null }[] = [];
  if (origAmount != null) history.push({ who: 'Host — original request', amount: Number(origAmount) });
  for (const e of (booking.negotiation_log || [])) {
    history.push({
      who: e.from === 'dj' ? 'DJ counter' : 'Host counter',
      amount: Number(e.amount),
      when: e.created_at,
    });
  }
  // The DJ's sales-tax rate. Prefer the value frozen on the booking; if it's
  // missing (offers-mode requests never stored one, or the DJ turned tax on
  // after the request came in), fall back to the DJ's CURRENT setting so a new
  // counter still calculates tax on the amount being sent.
  const frozenTaxPct = Number((booking as BookingRow & { tax_pct?: number | null }).tax_pct) || 0;
  const [taxPct, setTaxPct] = useState<number>(frozenTaxPct);
  useEffect(() => {
    if (frozenTaxPct > 0 || !booking.dj_id) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('users').select('booking_settings').eq('id', booking.dj_id).maybeSingle<{ booking_settings: unknown }>();
        const raw = (data as { booking_settings?: unknown } | null)?.booking_settings;
        const bs = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const enabled = !!(bs as { tax_enabled?: boolean } | null)?.tax_enabled;
        const pct = Number((bs as { tax_pct?: number } | null)?.tax_pct) || 0;
        if (!cancelled && enabled && pct > 0) setTaxPct(pct);
      } catch { /* leave at frozen (0) */ }
    })();
    return () => { cancelled = true; };
  }, [frozenTaxPct, booking.dj_id]);
  const withTax = (n: number) => Number((n + (n * taxPct) / 100).toFixed(2));
  const fmt2 = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

      // TWO SIDES, TWO WRITE PATHS:
      //  · DJ side (group 'in') — the DJ countering. This is manager+ only and
      //    must persist for a TEAM MEMBER, whose browser write RLS would drop
      //    silently. Route it through the gated server endpoint, which scopes
      //    the write to the OWNER and appends the negotiation log server-side
      //    (the browser can't read the current log under RLS for a teammate).
      //  · Booker side (group 'out') — the booker re-countering. The booker
      //    owns the row (requester_id) and never has teammates, so a direct
      //    client write is correct and cheap.
      if (group === 'in') {
        const patch = { ...updatePayload };
        delete (patch as { negotiation_log?: unknown }).negotiation_log;
        const res = await fetch('/api/bookings/decision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: booking.id,
            action: 'counter',
            patch,
            appendLog: { from: 'dj', amount: Number(amount), message: message.trim() },
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || 'Could not save.');
        }
      } else {
        const { error: updErr } = await supabase
          .from('bookings')
          .update(updatePayload as unknown as never)
          .eq('id', booking.id)
          .eq('requester_id', user.id);
        if (updErr) throw updErr;
      }

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

        {/* Reference: the full offer history — original ask + every counter. */}
        {history.length > 0 && (
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '10px 12px', margin: '0 0 14px' }}>
            <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#8a8aa0', marginBottom: 8 }}>
              {history.length > 1 ? 'Offer history' : 'Their offer'}
            </div>
            {history.map((h, i) => {
              const isLatest = i === history.length - 1;
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10,
                    padding: '5px 0',
                    borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.05)',
                  }}
                >
                  <span style={{ fontSize: 12.5, color: isLatest ? '#fff' : '#9a9ab0', fontWeight: isLatest ? 700 : 400, paddingTop: 1 }}>
                    {h.who}{isLatest ? ' · current' : ''}
                  </span>
                  <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'block', fontSize: 13.5, color: isLatest ? '#6ee7b7' : '#c9c9d6', fontWeight: isLatest ? 800 : 600 }}>
                      {sym}{h.amount.toLocaleString()}
                    </span>
                    {taxPct > 0 && (
                      <span style={{ display: 'block', fontSize: 10.5, color: '#8a8aa0', marginTop: 1 }}>
                        + {taxPct}% tax · {sym}{fmt2(withTax(h.amount))}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
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
          {/* Live tax on the amount being sent — the counter is pre-tax, so
              show what it becomes with the DJ's sales tax added. */}
          {taxPct > 0 && Number(amount) > 0 && (
            <div style={{ marginTop: 8, fontSize: 15, color: '#a6a6bd' }}>
              + {taxPct}% tax · total <span style={{ color: '#6ee7b7', fontWeight: 800, fontSize: 18 }}>{sym}{fmt2(withTax(Number(amount)))} {currency}</span>
            </div>
          )}
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
