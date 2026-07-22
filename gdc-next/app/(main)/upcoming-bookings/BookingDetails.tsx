'use client';

// BookingDetails — lifted out of UpcomingBookingsClient unchanged.
//
// The full info panel that opens under an expanded row. It owns the contract
// actions (send / resend / cancel / download / portal), the notes feed, the
// in-card flyer, and the payments ledger.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MOB_EVENT_TYPE_LABELS } from '../[slug]/mobileBookingForm';
import styles from './upcomingBookings.module.css';
import type { UpcomingBooking, BookingPayment } from './page';
import NotesFeed from '@/components/NotesFeed';
import ContractSendModal from './ContractSendModal';
import ContractPortal from '../update-dj-profile/ContractPortal';
import FlyerSlot from './FlyerSlot';
import PaymentsBlock from './PaymentsBlock';
import {
  MOBILE_EVENT_TYPES, NEON, capitalize, formatLongDate, formatTime12,
  type ContractAction,
} from './shared';

// ───────────────────────────────────────────────────────────────────────
// BookingDetails — full info panel shown when a row is expanded inline.
// Renders every field we have on file for the booking, grouped sensibly.
// Empty/null fields are hidden so the panel stays clean for manual bookings
// (which won't have requester/package/quote info).
// ───────────────────────────────────────────────────────────────────────

export default function BookingDetails({
  booking, djType, userId, clubDepositPct, taxPct, flyerUrl, onFlyerChange, onContractSigned, archive,
  payments, onPaymentsChange, canRequestDeposit, hasHostContact, onEdit, contractAction, onContractActionHandled,
}: {
  booking: UpcomingBooking;
  djType: 'club' | 'mobile';
  userId: string;
  clubDepositPct: number;
  taxPct: number;
  flyerUrl: string | null;
  onFlyerChange: (url: string | null) => void;
  onContractSigned?: () => void;
  archive?: boolean;
  payments: BookingPayment[];
  onPaymentsChange: (bookingId: string, rows: BookingPayment[]) => void;
  // Contract-step gate for Request Deposit — computed by BookingRow from the
  // same requires_contract / contract_status / status_overrides logic that
  // drives the status strip.
  canRequestDeposit: boolean;
  /**
   * Does this booking have a host name AND email to send to?
   *
   * Passed down rather than recomputed here, for the same reason
   * canRequestDeposit is: the strip and this panel must never disagree about
   * whether there's a recipient. Two copies of that rule is how you get a
   * greyed-out icon sitting above a live "Review & Send Contract" button.
   */
  hasHostContact: boolean;
  /** Opens the Add/Edit Manual Booking modal. Manual, non-archive rows only. */
  onEdit?: () => void;
  // One-shot request from the pipeline's contract dropdown. The portal and the
  // send/resend/cancel/download handlers all live here; the menu that wants
  // them lives a component up, on a row that may not even be expanded yet.
  contractAction?: ContractAction | null;
  onContractActionHandled?: () => void;
}) {
  const [contractOpen, setContractOpen] = useState(false);
  // Run the pipeline's request once, then clear it. Clearing FIRST matters:
  // otherwise the flag is still set on the next render and the portal reopens
  // the moment you close it. (downloadSigned/resendContract/cancelContract are
  // function declarations, so they're hoisted and callable from up here.)
  useEffect(() => {
    if (!contractAction) return;
    onContractActionHandled?.();
    switch (contractAction) {
      case 'open': setContractOpen(true); break;
      case 'download': void openSignedDoc('contract'); break;
      case 'download-audit': void openSignedDoc('audit'); break;
      case 'resend': void resendContract(); break;
      case 'cancel': void cancelContract(); break;
      case 'copy-link': void copyClientLink(); break;
    }
    // The handlers are stable for this booking and re-created every render;
    // listing them would re-fire the effect on every render instead of only
    // when a new action arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractAction]);
  const [sendContractId, setSendContractId] = useState<string | null>(null);
  const [contractSent, setContractSent] = useState(false);
  const [contractCancelled, setContractCancelled] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendDone, setResendDone] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  // The link, held for the explainer box rather than copied silently.
  const [linkBox, setLinkBox] = useState<string | null>(null);

  // Fetch the client's DocuSeal signing link and SHOW it, rather than dropping
  // it on the clipboard and saying "copied ✓".
  //
  // The link is a capability URL: the unguessable slug IS the credential.
  // Whoever opens it can sign as the client — no login, no password. That's
  // inherent to e-signature (the same link is what DocuSeal emails them, and
  // it's how DocuSign et al work), so surfacing it doesn't weaken anything.
  //
  // What it DOES create is a new way to be careless. A silent copy puts a
  // sign-as-the-client key on the clipboard with nothing said about it, and the
  // next paste might be a group chat. So: show the link, say what it is, and
  // let the DJ copy it having read that. One extra click, and the difference
  // between a tool and a trap.
  async function copyClientLink() {
    setCopyBusy(true);
    try {
      const res = await fetch('/api/contracts/client-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && json.url) setLinkBox(json.url);
      else alert(json.error || 'Could not get the client link.');
    } catch { alert('Could not get the link. Try again in a moment.'); }
    finally { setCopyBusy(false); }
  }

  // Copy from inside the box. Falls back to selecting the text when the
  // clipboard API is blocked (non-HTTPS, some mobile browsers) — the link is
  // on screen either way, which is the point of showing it.
  async function copyFromBox() {
    if (!linkBox) return;
    try {
      await navigator.clipboard.writeText(linkBox);
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2500);
    } catch {
      const el = document.getElementById('gdc-link-box') as HTMLInputElement | null;
      el?.select();
    }
  }
  const [signedBusy, setSignedBusy] = useState(false);
  const [signedDocs, setSignedDocs] = useState<{ contract?: string; audit?: string } | null>(null);
  const [locallySigned, setLocallySigned] = useState(false);

  // When a sent contract is opened, verify with DocuSeal whether it's actually
  // completed. The webhook flips the DB to 'signed', but a page loaded before
  // that won't know — so we check live and update the UI to "✓ Signed" without
  // needing a refresh. Runs once when the details panel mounts (on expand).
  useEffect(() => {
    const pending = !contractCancelled
      && (contractSent || booking.contract_status === 'awaiting_client')
      && booking.contract_status !== 'signed';
    if (!pending) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/contracts/signed-doc', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: booking.id }),
        });
        const json = (await res.json().catch(() => ({}))) as { contract?: string; audit?: string };
        if (alive && res.ok && (json.contract || json.audit)) {
          setSignedDocs({ contract: json.contract, audit: json.audit });
          setLocallySigned(true);
          onContractSigned?.(); // bubble up so the row's status strip shows Signed
        }
      } catch { /* ignore — leave as awaiting */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch the finished, signed contract PDF + audit log so the DJ can download both.
  async function downloadSigned() {
    await openSignedDoc('contract');
  }

  /**
   * Open one of the signed documents.
   *
   * The pipeline's dropdown says "Download …", so it has to actually open
   * something — the old behaviour only revealed two buttons further down the
   * expanded panel, which is a link, not a download.
   *
   * If we already have the URLs (the panel fetches them on mount for signed
   * bookings) we open straight away, keeping the user's click — browsers block
   * window.open once a gesture has been through an await. When we have to
   * fetch first that gesture may be gone, so setSignedDocs() still runs and the
   * panel's buttons appear as the fallback. The DJ gets the file either way.
   */
  async function openSignedDoc(which: 'contract' | 'audit') {
    const known = which === 'audit' ? signedDocs?.audit : signedDocs?.contract;
    if (known) { window.open(known, '_blank', 'noopener,noreferrer'); return; }

    setSignedBusy(true);
    try {
      const res = await fetch('/api/contracts/signed-doc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { contract?: string; audit?: string; error?: string };
      if (res.ok && (json.contract || json.audit)) {
        setSignedDocs({ contract: json.contract, audit: json.audit });
        const url = which === 'audit' ? json.audit : json.contract;
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
        else if (which === 'audit') alert('The audit log isn’t available for this contract yet.');
        else alert('The signed contract isn’t ready yet.');
      } else {
        alert(json.error || 'The signed contract isn’t ready yet.');
      }
    } catch { alert('Could not fetch the signed contract. Try again in a moment.'); }
    finally { setSignedBusy(false); }
  }

  // Re-email the client their copy to sign.
  async function resendContract() {
    setResendBusy(true); setResendDone(false);
    try {
      const res = await fetch('/api/contracts/send-client', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      if (!res.ok) throw new Error('resend failed');
      setResendDone(true);
    } catch { alert('Could not resend the contract. Try again in a moment.'); }
    finally { setResendBusy(false); }
  }

  // Void the sent contract and clear it so a new one can be sent.
  async function cancelContract() {
    if (!confirm('Cancel this sent contract? The client’s copy will be voided and you can review and send a new one.')) return;
    setCancelBusy(true);
    try {
      const res = await fetch('/api/contracts/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not cancel.');
      setContractSent(false); setResendDone(false); setContractCancelled(true);
    } catch (e) { alert(e instanceof Error ? e.message : 'Could not cancel the contract.'); }
    finally { setCancelBusy(false); }
  }

  // Pretty-format the helper labels.
  const setTypeLabel = booking.set_type
    ? (booking.set_type
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '))
    : null;

  const eventTypeLabel = booking.event_type
    ? (MOB_EVENT_TYPE_LABELS[booking.event_type]
        || MOBILE_EVENT_TYPES.find((e) => e.value === booking.event_type)?.label
        || booking.event_type)
    : null;

  // Currency-aware money formatting. Default USD if no currency set.
  function money(n: number | null | undefined): string | null {
    if (n == null) return null;
    const cur = booking.currency || 'USD';
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n);
    } catch {
      return `${cur} ${n}`;
    }
  }

  // Linkified address — clicking opens Google Maps directions to that address.
  // If we have lat/lon we use those for a more precise pin; otherwise fall
  // back to URL-encoded address text.
  const addressUrl = booking.venue_address
    ? (booking.venue_lat != null && booking.venue_lon != null
        ? `https://www.google.com/maps/search/?api=1&query=${booking.venue_lat},${booking.venue_lon}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(booking.venue_address)}`)
    : null;

  // Each row in `rows` is one or two label/value pairs. A pair appears
  // side-by-side; a single appears alone. We pre-filter empties so a row
  // collapses to a single column when one of its halves is empty.
  type Cell = { label: string; value: React.ReactNode | string | null | undefined };
  type DetailRow = Cell[];

  // Time-row label prefix: club bookings = "Set", weddings = "Reception",
  // all other mobile event types = "Event".
  const timeLabelPrefix =
    djType === 'club' ? 'Set' : (booking.event_type === 'weddings' ? 'Reception' : 'Event');

  // Agreed-rate breakdown. The stored agreed rate is the cocktail-INCLUSIVE
  // total. When there's a separately-charged cocktail price, show
  // "base + cocktail = total"; otherwise just the total.
  const agreedTotal = booking.counter_rate ?? booking.quoted_rate ?? booking.offer_amount ?? null;
  // Sales tax and the tax-inclusive total. The booking row carries a FROZEN
  // snapshot (tax_pct / tax_amount / total_with_tax) written at creation —
  // the stored snapshot always wins, so a DJ changing their tax settings
  // never re-prices existing bookings. The snapshot amounts were computed
  // on the price at creation: if the agreed price has changed since
  // (accepted counter, edited manual rate), recompute on the new price with
  // the FROZEN tax % — still never the DJ's current settings. Only legacy
  // rows with no snapshot at all (tax_pct null) fall back to the live
  // settings % (taxPct) with the old whole-dollar rounding.
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const snapTaxPct = booking.tax_pct != null ? Number(booking.tax_pct) : null;
  const snapTaxAmount = booking.tax_amount != null ? Number(booking.tax_amount) : null;
  const snapTotal = booking.total_with_tax != null ? Number(booking.total_with_tax) : null;
  // The pre-tax base the snapshot was computed on; "fresh" = it still
  // matches the current agreed price, so the stored amounts are the truth.
  const snapBase = (snapTaxAmount != null && snapTotal != null) ? round2(snapTotal - snapTaxAmount) : null;
  const snapshotFresh =
    snapBase != null && agreedTotal != null && Math.abs(Number(agreedTotal) - snapBase) < 0.005;
  const effTaxPct = snapTaxPct ?? taxPct;
  const cardTax = snapshotFresh
    ? (snapTaxAmount as number)
    : (effTaxPct > 0 && agreedTotal != null)
      ? (snapTaxPct != null
          ? round2((Number(agreedTotal) * effTaxPct) / 100)
          : Math.round((Number(agreedTotal) * effTaxPct) / 100))
      : 0;
  const cardTotal = snapshotFresh
    ? snapTotal
    : (agreedTotal != null ? round2(Number(agreedTotal) + cardTax) : null);
  const cocktailCharge = booking.cocktail_price != null ? Number(booking.cocktail_price) : 0;
  const ceremonyCharge = booking.ceremony_price != null ? Number(booking.ceremony_price) : 0;
  const hasSeparateCocktail = cocktailCharge > 0 && agreedTotal != null;
  const hasSeparateCeremony = ceremonyCharge > 0 && agreedTotal != null;
  const agreedBase = (hasSeparateCocktail || hasSeparateCeremony) ? (Number(agreedTotal) - cocktailCharge - ceremonyCharge) : null;
  const agreedRateValue = (hasSeparateCocktail || hasSeparateCeremony) ? (
    <span>
      {money(agreedBase)}
      {hasSeparateCocktail && <> + <span className={styles.cocktailHighlight}>{money(cocktailCharge)} cocktail</span></>}
      {hasSeparateCeremony && <> + <span className={styles.cocktailHighlight}>{money(ceremonyCharge)} ceremony</span></>}
      {' = '}{money(agreedTotal)}
    </span>
  ) : money(agreedTotal);

  // Discount note — shown under the agreed rate when the booking used a
  // sale/promo code (original price + which discount + amount saved).
  const bkDiscountAmt = booking.discount_amount != null ? Number(booking.discount_amount) : 0;
  const agreedRateWithDiscount = bkDiscountAmt > 0 ? (
    <span>
      {agreedRateValue}
      <span style={{ display: 'block', color: 'var(--neon)', fontSize: '.8rem', marginTop: 2 }}>
        {booking.discount_label || 'Discount'} — saved {money(bkDiscountAmt)}
        {booking.original_rate != null ? ` (was ${money(booking.original_rate)})` : ''}
      </span>
    </span>
  ) : agreedRateValue;

  // Build the rows. Null values get filtered out below.
  const rows: DetailRow[] = [
    // Row 1: Event Date + Venue Name (Event Type for mobile)
    [
      { label: 'Event Date', value: booking.event_date ? formatLongDate(booking.event_date) : null },
      djType === 'club'
        ? { label: 'Venue Name', value: booking.venue_name }
        : {
            label: 'Event Type',
            value: (() => {
              const ed = ((booking as { event_details?: string | null }).event_details || '').trim();
              if (!ed) return eventTypeLabel;
              return (
                <span>
                  {eventTypeLabel}
                  {ed.split(' · ').map((line, i) => (
                    <span key={i} style={{ display: 'block', opacity: 0.7, fontSize: '.85em' }}>{line}</span>
                  ))}
                </span>
              );
            })(),
          },
    ],
    // Row 2a: Cocktail Hour time (wedding bookings where the booker opted in),
    // shown above the reception start/end times.
    [
      {
        label: 'Cocktail Hour Time',
        value: booking.cocktail_needed && booking.cocktail_start_time
          ? formatTime12(booking.cocktail_start_time)
          : null,
      },
    ],
    // Row 2b: Ceremony Music time (wedding bookings where the booker opted in),
    // shown above the reception start/end times.
    [
      {
        label: 'Ceremony Music Time',
        value: booking.ceremony_needed && booking.ceremony_start_time
          ? formatTime12(booking.ceremony_start_time)
          : null,
      },
    ],
    // Row 2: Time labels — clubs use "Set", mobile uses "Event", except
    // weddings which use "Reception" (matches the booking form + emails).
    [
      { label: timeLabelPrefix + ' Start Time', value: booking.start_time ? formatTime12(booking.start_time) : null },
      { label: timeLabelPrefix + ' End Time', value: booking.end_time ? formatTime12(booking.end_time) : null },
    ],
    // Row 3: Venue Type + Venue Address (linkified to Google Maps)
    [
      djType === 'club'
        ? { label: 'Venue Type', value: booking.venue_type ? capitalize(booking.venue_type) : null }
        : { label: 'Venue Name', value: booking.venue_name },
      {
        label: 'Venue Address',
        value: addressUrl ? (
          <a href={addressUrl} target="_blank" rel="noreferrer" className={styles.addressLink}>
            {booking.venue_address}
          </a>
        ) : booking.venue_address,
      },
    ],
    // Row 4: DJ-type-specific extra info
    djType === 'club'
      ? [
          { label: 'Set Type', value: setTypeLabel },
          { label: 'Equipment', value: booking.equipment ? capitalize(booking.equipment.replace(/_/g, ' ')) : null },
        ]
      : [
          { label: 'Guest Count', value: booking.guest_count != null ? String(booking.guest_count) : null },
          { label: 'Room Details', value: booking.room_details },
        ],
    djType === 'club'
      ? []
      : [
          {
            label: 'Setup Time Required',
            value: booking.setup_hours
              ? `${booking.setup_hours} hr${booking.setup_hours === '1' ? '' : 's'} before start`
              : null,
          },
        ],
    // Row 5: Booked By + Contact Phone
    [
      { label: 'Booked By', value: booking.is_manual ? 'You (manual)' : (booking.requester_name || null) },
      { label: 'Contact Phone', value: booking.phone },
    ],
    // Row 6: Agreed Rate + Overtime Rate. (Package name moved to the package
    // details area below.) Mobile always shows an overtime cell with a
    // placeholder when the DJ set none; club hides it when unset.
    [
      { label: 'Agreed Rate', value: agreedRateWithDiscount },
      {
        label: 'Overtime Rate',
        value: booking.overtime_rate != null
          ? `${money(booking.overtime_rate)}/hr`
          : (djType === 'club' ? null : 'DJ has not listed overtime rate'),
      },
    ],
    // Row 7: Deposit
    [
      {
        label: 'Deposit',
        value: (() => {
          // Frozen snapshot first: deposit_amount as stored at creation
          // (computed on the tax-inclusive total — the exact number the
          // client's booking form showed). Trusted only while the agreed
          // price still matches the snapshot's base; after a renegotiation
          // we recompute below (still using the frozen tax %).
          if (snapshotFresh && booking.deposit_amount != null) {
            return booking.deposit_pct != null
              ? `${money(Number(booking.deposit_amount))} (${booking.deposit_pct}%)`
              : money(Number(booking.deposit_amount));
          }
          // Deposit % is taken on the tax-inclusive total (cardTotal).
          // A stored % wins; else the DJ's standing club % as a fallback.
          // Snapshot rows recompute to the cent; legacy rows keep the old
          // whole-dollar rounding.
          if (booking.deposit_pct != null) {
            return cardTotal != null
              ? `${money(snapTaxPct != null
                  ? round2((cardTotal * booking.deposit_pct) / 100)
                  : Math.round((cardTotal * booking.deposit_pct) / 100))} (${booking.deposit_pct}%)`
              : `${booking.deposit_pct}%`;
          }
          if (djType === 'club' && clubDepositPct > 0) {
            return cardTotal != null && cardTotal > 0
              ? `${money(Math.round((cardTotal * clubDepositPct) / 100))} (${clubDepositPct}%)`
              : `${clubDepositPct}%`;
          }
          // Last resort: a stored fixed deposit amount.
          if (booking.deposit_amount != null) {
            return money(booking.deposit_amount);
          }
          return null;
        })(),
      },
    ],
    // Row 8: Tax + Total. Uses the booking's FROZEN tax % (effTaxPct falls
    // back to the DJ's live setting only for legacy rows with no snapshot).
    [
      {
        label: 'Tax',
        value: (effTaxPct > 0 && cardTax > 0)
          ? `${money(cardTax)} (${effTaxPct}%)`
          : null,
      },
      {
        label: 'Total (with tax)',
        value: (effTaxPct > 0 && cardTotal != null && cardTax > 0)
          ? money(cardTotal)
          : null,
      },
    ],
  ];

  // Filter empty cells from each row; drop rows that become entirely empty.
  const visibleRows = rows
    .map((row) => row.filter((c) => c.value != null && c.value !== ''))
    .filter((row) => row.length > 0);

  const hasNotes = booking.notes && booking.notes.trim().length > 0;
  const hasPackageDetails = booking.package_details && booking.package_details.trim().length > 0;

  // Type-mismatch callout — surface a friendly note in the expanded panel
  // when the booking's type differs from the DJ's registered type. This
  // matches the same warning shown to hosts in the invite email.
  const bt = booking.booking_type;
  const typeMismatchNote = (djType === 'mobile' && bt === 'club')
    ? 'This is a Club / Bar booking. Your profile is registered as a Mobile DJ — the booking will still appear here in your upcoming bookings, but it won\u2019t be displayed publicly on your profile event list.'
    : (djType === 'club' && bt === 'mobile')
      ? 'This is a Mobile / Private booking. Your profile is registered as a Club / Bar DJ — the booking will still appear here in your upcoming bookings, but it won\u2019t be displayed publicly on your profile event list.'
      : null;

  return (
    <div className={styles.detailsPanel}>
      {typeMismatchNote && (
        <div className={styles.typeMismatchNote}>
          <strong>Note:</strong> {typeMismatchNote}
        </div>
      )}
      <div className={styles.detailsStack}>
        {visibleRows.map((row, i) => (
          <div key={i} className={styles.detailPairRow}>
            {row.map((cell) => (
              <div key={cell.label} className={styles.detailRow}>
                <div className={styles.detailLabel}>{cell.label}</div>
                <div className={styles.detailValue}>{cell.value}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* Event flyer inside the card — small thumbnail with download icon,
          plus replace/remove overlay controls. Club/bar bookings only. */}
      {djType === 'club' && (!archive || flyerUrl) && (
        <div className={styles.flyerCardSection}>
          <div className={styles.detailLabel}>Event Flyer</div>
          <FlyerSlot
            bookingId={booking.id}
            userId={userId}
            flyerUrl={flyerUrl}
            onChange={onFlyerChange}
            size="card"
            readOnly={archive}
          />
        </div>
      )}
      {(hasPackageDetails || booking.package_title) && (
        <div className={styles.detailLongBlock}>
          <div className={styles.detailLabel}>Package Details</div>
          {booking.package_title && (
            <div className={styles.packageName}>{booking.package_title}</div>
          )}
          {hasPackageDetails && (
            <div
              className={styles.detailLongValue}
              dangerouslySetInnerHTML={{ __html: booking.package_details || '' }}
            />
          )}
        </div>
      )}
      {booking.created_at && (
        <div className={styles.bookedOnFooter}>
          <span className={styles.bookedOnLabel}>Booked On</span>{' '}
          <span className={styles.bookedOnValue}>{formatLongDate(booking.created_at)}</span>
        </div>
      )}
      {hasNotes && (
        <div className={styles.detailLongBlock}>
          <div className={styles.detailLabel}>Notes</div>
          <div className={styles.detailLongValue}>{booking.notes}</div>
        </div>
      )}
      {/* Shared notes feed — both DJ and host can read + post. Shown for
          club/bar AND mobile (private) bookings — any real two-party
          booking. Manual events with no counterparty are excluded. */}
      {(bt === 'club' || bt === 'mobile') && (
        <div className={styles.notesFeedWrap} style={{ marginTop: '1rem' }}>
          <div className={styles.detailLabel}>Contract</div>
          {!contractCancelled && (contractSent || booking.contract_status === 'awaiting_client') && booking.contract_status !== 'signed' && !locallySigned ? (
            <div style={{ marginTop: 8 }}>
              <div style={{ color: '#f0b23e', fontWeight: 600 }}>Sent — awaiting client signature</div>
              <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.78rem', marginTop: 4 }}>You&rsquo;ve signed. The client has been emailed to sign.</div>
              {!archive && (
                <div style={{ display: 'flex', gap: '.5rem', marginTop: 8, flexWrap: 'wrap' }}>
                  <button type="button" onClick={resendContract} disabled={resendBusy} style={{ background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', cursor: resendBusy ? 'wait' : 'pointer', fontSize: '.8rem' }}>{resendBusy ? 'Resending…' : resendDone ? 'Resent ✓' : 'Resend to client'}</button>
                  <button type="button" onClick={copyClientLink} disabled={copyBusy} style={{ background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', cursor: copyBusy ? 'wait' : 'pointer', fontSize: '.8rem' }}>{copyBusy ? 'Getting link…' : copyDone ? 'Link copied ✓' : '🔗 Copy client link'}</button>
                  <button type="button" onClick={cancelContract} disabled={cancelBusy} style={{ background: 'transparent', border: '1px solid #ff7676', color: '#ff7676', fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', cursor: cancelBusy ? 'wait' : 'pointer', fontSize: '.8rem' }}>{cancelBusy ? 'Cancelling…' : 'Cancel contract'}</button>
                </div>
              )}
              {signedDocs ? (
                <div style={{ display: 'flex', gap: '.5rem', marginTop: 8, flexWrap: 'wrap' }}>
                  {signedDocs.contract && <a href={signedDocs.contract} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', background: 'var(--neon,#00e0a4)', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', fontSize: '.8rem', textDecoration: 'none' }}>⬇ Signed contract</a>}
                  {signedDocs.audit && <a href={signedDocs.audit} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', fontSize: '.8rem', textDecoration: 'none' }}>⬇ Audit log</a>}
                </div>
              ) : (
                <button type="button" onClick={downloadSigned} disabled={signedBusy} style={{ background: 'transparent', border: 'none', color: 'var(--muted,#8a8aa0)', fontWeight: 600, cursor: signedBusy ? 'wait' : 'pointer', fontSize: '.76rem', marginTop: 8, textDecoration: 'underline', padding: 0 }}>{signedBusy ? 'Checking…' : 'Download signed copy (once both have signed)'}</button>
              )}
            </div>
          ) : (booking.contract_status === 'signed' || locallySigned) ? (
            <div style={{ marginTop: 8 }}>
              <div style={{ color: '#00e0a4', fontWeight: 700 }}>✓ Contract signed</div>
              {signedDocs ? (
                <div style={{ display: 'flex', gap: '.5rem', marginTop: 8, flexWrap: 'wrap' }}>
                  {signedDocs.contract && <a href={signedDocs.contract} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', background: 'var(--neon,#00e0a4)', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', fontSize: '.8rem', textDecoration: 'none' }}>⬇ Signed contract</a>}
                  {signedDocs.audit && <a href={signedDocs.audit} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', fontSize: '.8rem', textDecoration: 'none' }}>⬇ Audit log</a>}
                </div>
              ) : (
                <button type="button" onClick={downloadSigned} disabled={signedBusy} style={{ background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', cursor: signedBusy ? 'wait' : 'pointer', fontSize: '.8rem', marginTop: 8 }}>{signedBusy ? 'Loading…' : '⬇ Download signed contract'}</button>
              )}
            </div>
          ) : archive ? (
            <div style={{ marginTop: 8, color: 'var(--muted,#8a8aa0)', fontSize: '.82rem' }}>
              {contractCancelled ? 'Contract was cancelled.' : 'No contract on file for this booking.'}
            </div>
          ) : (booking.is_manual && !hasHostContact) ? (
            /*
              A manual booking with nobody to send to.
              This button was live regardless — the section is gated on
              booking_type, which for a manual booking is the DJ's OWN type, so
              it's always true. Clicking it opened the contract portal, made the
              DJ pick a template and sign it, and only then hit NO_CLIENT_EMAIL.
              All that work before finding out there's no recipient.
              Same rule as the deposit, same door out: the modal the row's pencil
              opens, which already has Host Name, Host Email and the "Send
              booking details to host" checkbox.
            */
            <div style={{ marginTop: 8 }}>
              <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.82rem', lineHeight: 1.5, marginBottom: 10 }}>
                Add the host&rsquo;s full name and email to this booking before sending a contract &mdash; there&rsquo;s nobody to send it to yet.
              </div>
              {onEdit && (
                <button type="button" onClick={onEdit} style={{ background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.2rem', cursor: 'pointer', fontSize: '.82rem' }}>Add host details&hellip;</button>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              {contractCancelled && <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.78rem', marginBottom: 6 }}>Contract cancelled. Review and send a new one below.</div>}
              <button type="button" onClick={() => setContractOpen(true)} style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.2rem', cursor: 'pointer', fontSize: '.82rem' }}>Review &amp; Send Contract</button>
            </div>
          )}
        </div>
      )}
      {/* Payments — the manual-payment ledger for this booking. Rendered for
          the same set as the Contract section (real two-party bookings), plus
          any booking that already has payment rows. Purely informational —
          nothing here ever blocks another step. Archive mode still shows
          existing rows (read-only) but skips the section entirely when there
          is nothing to show. */}
      {(bt === 'club' || bt === 'mobile' || payments.length > 0) && (!archive || payments.length > 0) && (
        <div className={styles.notesFeedWrap} style={{ marginTop: '1rem' }}>
          <div className={styles.detailLabel}>Payments</div>
          <PaymentsBlock
            bookingId={booking.id}
            currency={booking.currency || 'USD'}
            payments={payments}
            onChange={(rows) => onPaymentsChange(booking.id, rows)}
            archive={archive}
            canRequestDeposit={canRequestDeposit}
            suggestedDeposit={booking.deposit_amount != null ? Number(booking.deposit_amount) : null}
            agreedTotal={
              booking.total_with_tax ?? booking.counter_rate ?? booking.quoted_rate ?? booking.offer_amount ?? null
            }
          />
        </div>
      )}
      {/* Planner & Playlist panel intentionally NOT shown on the booking card.
          The planner status + % lives in the status strip up top, and the full
          answers open from there (Open planner / Run sheet). Keeping the whole
          30-question panel out of the card keeps it short and money-first.
          To bring it back, re-mount <PlannerPanel bookingId={booking.id} />
          here, gated on `plannerStatus`. */}
      {(bt === 'club' || bt === 'mobile') && (
        <div className={styles.notesFeedWrap}>
          <NotesFeed bookingId={booking.id} currentUserId={userId} />
        </div>
      )}
      {/* The signing-link explainer. A modal, not a toast: the DJ has to read
          past it to get the link, which is the entire safeguard. */}
      {linkBox && (
        <div
          onClick={() => setLinkBox(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card,#14141f)', border: '1px solid rgba(255,255,255,.14)',
              borderRadius: 12, padding: '1.1rem 1.2rem', maxWidth: 460, width: '100%',
              boxShadow: '0 12px 40px rgba(0,0,0,.6)',
            }}
          >
            <div style={{ fontWeight: 800, color: 'var(--white,#fff)', fontSize: '.95rem', marginBottom: '.5rem' }}>
              Client signing link
            </div>
            <p style={{ margin: '0 0 .75rem', color: '#f5a623', fontSize: '.8rem', lineHeight: 1.55 }}>
              <strong>Anyone who opens it can sign as your client.</strong> Contracts
              are not password protected. Send it straight to client/host — not
              into a group chat or anywhere public.
            </p>
            <input
              id="gdc-link-box"
              readOnly
              value={linkBox}
              onFocus={(e) => e.currentTarget.select()}
              style={{
                width: '100%', background: 'var(--deep,#0b0b12)', border: '1px solid rgba(255,255,255,.14)',
                borderRadius: 6, color: 'var(--white,#fff)', padding: '.55rem .7rem',
                fontFamily: "'Space Mono', monospace", fontSize: '.72rem', marginBottom: '.8rem',
              }}
            />
            <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setLinkBox(null)}
                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.18)', color: 'var(--muted,#8a8aa0)', fontWeight: 700, borderRadius: 6, padding: '.5rem 1rem', cursor: 'pointer', fontSize: '.8rem' }}
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void copyFromBox()}
                style={{ background: NEON, border: 'none', color: '#06231b', fontWeight: 800, borderRadius: 6, padding: '.5rem 1.1rem', cursor: 'pointer', fontSize: '.8rem' }}
              >
                {copyDone ? '\u2713 Copied' : 'Copy link'}
              </button>
            </div>
          </div>
        </div>
      )}
      {contractOpen && (
        <ContractPortal
          userId={userId}
          djType={djType}
          controlledOpen
          bookingId={booking.id}
          eventType={booking.event_type}
          onRequestClose={() => setContractOpen(false)}
          onUseContract={(id) => { setContractOpen(false); setSendContractId(id); }}
        />
      )}
      {sendContractId && (
        <ContractSendModal
          bookingId={booking.id}
          userId={userId}
          contractId={sendContractId}
          onClose={() => setSendContractId(null)}
          onSent={() => { setContractSent(true); setSendContractId(null); setContractCancelled(false); setResendDone(false); }}
        />
      )}
    </div>
  );
}
