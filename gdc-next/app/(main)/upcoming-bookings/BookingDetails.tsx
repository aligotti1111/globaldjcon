'use client';

// BookingDetails — lifted out of UpcomingBookingsClient unchanged.
//
// The full info panel that opens under an expanded row. It owns the contract
// actions (send / resend / cancel / download / portal), the notes feed, the
// in-card flyer, and the payments ledger.

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { MOB_EVENT_TYPE_LABELS } from '../[slug]/mobileBookingForm';
import styles from './upcomingBookings.module.css';
import type { UpcomingBooking, BookingPayment } from './page';
import NotesFeed from '@/components/NotesFeed';
import ContractSendModal from './ContractSendModal';
import RiderSendModal from './RiderSendModal';
import type { NamedRider } from '@/lib/rider';
import ContractPortal from '../update-dj-profile/ContractPortal';
import FlyerSlot from './FlyerSlot';
import OvertimeSection from './OvertimeSection';
import BookingLog from './BookingLog';
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
  payments, canManageMoney = true, canManageContract = true, onEdit, contractAction, onContractActionHandled, isOwner = false,
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
  /** Manager+ money actions (confirm/waive/cancel). Assistants: false. */
  canManageMoney?: boolean;
  /** Manager+ contract actions. Assistants: false. */
  canManageContract?: boolean;
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
  /** Account owner only — gates the Booking log (owner-only feature). */
  isOwner?: boolean;
}) {
  const [contractOpen, setContractOpen] = useState(false);
  const [riderChooserOpen, setRiderChooserOpen] = useState(false);
  // Message host — starts a new thread in the DJ↔host inbox, mirroring the
  // inbox's own sendReply: a client-side insert into `messages` (RLS-guarded),
  // then a best-effort /api/send-email nudge so the host knows to check it.
  const hostUserId = (booking as { requester_id?: string | null }).requester_id || null;
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgText, setMsgText] = useState('');
  const [msgBusy, setMsgBusy] = useState(false);
  const [msgDone, setMsgDone] = useState(false);
  const [msgErr, setMsgErr] = useState<string | null>(null);
  async function sendHostMessage() {
    const t = msgText.trim();
    if (!t) { setMsgErr('Type a message first.'); return; }
    if (!hostUserId) { setMsgErr('This host booked without an account, so they have no inbox.'); return; }
    setMsgBusy(true); setMsgErr(null);
    try {
      const supabase = createClient();
      // Sender's display name — the same field the inbox shows on a thread.
      const { data: me } = await supabase.from('users').select('name').eq('id', userId).maybeSingle();
      const fromName = (me as { name?: string | null } | null)?.name || 'Your DJ';
      const subject = 'Message about your event'
        + (booking.event_date ? ' — ' + formatLongDate(booking.event_date) : '');
      // New top-level thread (parent_id left null).
      const { error } = await supabase.from('messages').insert([{
        to_user_id: hostUserId,
        from_user_id: userId,
        from_name: fromName,
        subject,
        message: t,
        read: false,
      }] as unknown as never);
      if (error) throw error;
      // Best-effort email nudge — identical shape to the inbox reply flow.
      try {
        await fetch('/api/send-email', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'inbox_notification',
            recipientUserId: hostUserId,
            recipientName: booking.requester_name || '',
            senderName: fromName,
            subject,
            message: t,
          }),
        });
      } catch { /* the inbox message already landed; the email is only a nudge */ }
      setMsgDone(true); setMsgBusy(false);
      setTimeout(() => { setMsgOpen(false); setMsgText(''); setMsgDone(false); }, 1200);
    } catch (e) {
      setMsgErr(e instanceof Error ? e.message : 'Could not send.'); setMsgBusy(false);
    }
  }
  // The DJ's saved NAMED riders → one quick-send button each for this booking.
  const [savedRiders, setSavedRiders] = useState<NamedRider[]>([]);
  useEffect(() => {
    if (booking.booking_type !== 'club' || archive) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/rider/library');
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; riders?: NamedRider[] };
        if (alive && d.ok && Array.isArray(d.riders)) setSavedRiders(d.riders);
      } catch { /* no saved riders — the Rider portal still opens */ }
    })();
    return () => { alive = false; };
  }, [booking.booking_type, archive]);
  async function sendNamedRider(r: NamedRider) {
    try {
      await fetch('/api/rider/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, items: r.items, mode: r.mode, pdfUrl: r.pdfUrl, name: r.name }),
      });
    } catch { /* best-effort quick send */ }
  }
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
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(booking.venue_address)}`
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

  // Numeric deposit + remaining balance. Mirrors the Deposit row's logic so the
  // receipt can always show what's still owed after the deposit is paid.
  const depositAmountNum: number | null = (() => {
    if (snapshotFresh && booking.deposit_amount != null) return Number(booking.deposit_amount);
    if (booking.deposit_pct != null && cardTotal != null) {
      return snapTaxPct != null
        ? round2((cardTotal * booking.deposit_pct) / 100)
        : Math.round((cardTotal * booking.deposit_pct) / 100);
    }
    if (djType === 'club' && clubDepositPct > 0 && cardTotal != null && cardTotal > 0) {
      return Math.round((cardTotal * clubDepositPct) / 100);
    }
    if (booking.deposit_amount != null) return Number(booking.deposit_amount);
    return null;
  })();
  const balanceDueNum: number | null =
    (cardTotal != null && depositAmountNum != null) ? round2(cardTotal - depositAmountNum) : null;
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
    // Row 1: Club → Event Date + Venue Name. Mobile → Event Type + Event Date +
    // Guest Count render together as a 3-up header grid (see eventHeaderBlock),
    // so nothing goes into the generic rows here.
    // (Club → Event Date + Set Time + Venue Name render together as a 3-up header
    // grid at the top of the Details card; see venueHeaderBlock.)
    // (Ceremony / Cocktail / Reception times are no longer plain rows — they're
    // rendered together as the "Schedule" timeline inside the Event card. See
    // scheduleBlock below.)
    // Venue block. Club: Type + Address, then Set Type + Equipment. Mobile: Venue
    // Name + Room on one line, Address on its own line. (Guest Count is pulled up
    // into the Event card — see below.)
    ...(djType === 'club'
      ? [
          [
            { label: 'Venue Type', value: booking.venue_type ? (
                booking.venue_type_desc ? (
                  <span>{capitalize(booking.venue_type)}<span style={{ display: 'block', fontSize: '.85em', color: 'var(--muted,#8a8aa0)', marginTop: 2, fontWeight: 400 }}>{booking.venue_type_desc}</span></span>
                ) : capitalize(booking.venue_type)
              ) : null },
            {
              label: 'Venue Address',
              value: addressUrl ? (
                <a href={addressUrl} target="_blank" rel="noreferrer" className={styles.addressLink}>
                  {booking.venue_address}
                </a>
              ) : booking.venue_address,
            },
          ],
          [
            { label: 'Set Type', value: setTypeLabel },
            { label: 'Equipment', value: booking.equipment ? capitalize(booking.equipment.replace(/_/g, ' ')) : null },
          ],
        ]
      : [
          [
            { label: 'Venue Name', value: booking.venue_name },
            { label: 'Room Details', value: booking.room_details },
          ],
          [
            {
              label: 'Venue Address',
              value: addressUrl ? (
                <a href={addressUrl} target="_blank" rel="noreferrer" className={styles.addressLink}>
                  {booking.venue_address}
                </a>
              ) : booking.venue_address,
            },
          ],
        ]),
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
    // Row 6: Agreed Rate. (Overtime moved out of the receipt to the Event card's
    // bottom-right — see overtimeControl below.)
    [
      { label: 'Agreed Rate', value: agreedRateWithDiscount },
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
    // Row 7b: Balance due on the day of the event (tax-inclusive total minus the
    // deposit). Always shown alongside the deposit so the receipt is complete.
    [
      { label: 'Balance due day of event', value: balanceDueNum != null ? money(balanceDueNum) : null },
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

  // Group the flat label/value rows into labelled cards — Event / Venue / Host /
  // Pricing — each with a gradient chip header (Pricing tinted). Same rows, same
  // values; purely how they're visually grouped. A row is placed by its labels.
  type SectionKey = 'EVENT' | 'VENUE' | 'HOST' | 'PRICING';
  const sectionForRow = (row: DetailRow): SectionKey => {
    const s = row.map((c) => c.label).join('|');
    if (/Venue|Room|Equipment|Set Type|Set Time/.test(s)) return 'VENUE';
    if (/Booked By|Contact Phone/.test(s)) return 'HOST';
    if (/Agreed Rate|Overtime|Deposit|Tax|Total|Balance|Offer|Rate/.test(s)) return 'PRICING';
    return 'EVENT';
  };
  const sectionOrder: Array<{ key: SectionKey; title: string }> = [
    { key: 'EVENT', title: 'Event' },
    // Club/bar bookings have no separate Event card, so this card carries the
    // date + set time as well — label it "Details" there instead of "Venue".
    { key: 'VENUE', title: djType === 'club' ? 'Details' : 'Venue' },
    { key: 'HOST', title: 'Host' },
    { key: 'PRICING', title: 'Pricing' },
  ];
  const groupedSections = sectionOrder
    .map((sec) => ({ ...sec, rows: visibleRows.filter((r) => sectionForRow(r) === sec.key) }))
    // Keep the Event card for mobile even if it has no generic rows — its header
    // (Type / Date / Guest) renders separately as eventHeaderBlock.
    .filter((g) => g.rows.length > 0 || (g.key === 'EVENT' && djType === 'mobile'));

  // Pricing renders as a receipt: label left, amount right, the total emphasised,
  // and the deposit/balance pulled into a separated "Payment schedule" band.
  const renderPricing = (prows: DetailRow[]) => {
    const cells = prows.flatMap((r) => r);
    const isSchedule = (l: string) => /Deposit|Balance due|Balance/i.test(l);
    const isTotal = (l: string) => /^Total/i.test(l);
    const main = cells.filter((c) => !isSchedule(c.label));
    const sched = cells.filter((c) => isSchedule(c.label));
    return (
      <>
        {main.map((c) => (
          <div key={c.label} className={`${styles.priceRow}${isTotal(c.label) ? ' ' + styles.priceRowTotal : ''}`}>
            <span className={styles.priceKey}>{c.label}</span>
            <span className={styles.priceVal}>{c.value}</span>
          </div>
        ))}
        {sched.length > 0 && (
          <div className={styles.paySched}>
            <div className={styles.schedLbl}>Payment schedule</div>
            {sched.map((c) => (
              <div key={c.label} className={styles.priceRow}>
                <span className={styles.priceKey}>{c.label}</span>
                <span className={styles.priceVal}>{c.value}</span>
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  // Overtime control — moved out of the pricing receipt to the Event card's
  // bottom-right. Mobile shows the OvertimeSection (rate + Send invoice / receipt,
  // or Manage once sent). Club shows the flat per-hour rate when one is set.
  const overtimeControl = djType === 'club'
    ? (booking.overtime_rate != null
        ? <span className={styles.detailValue}>Overtime {money(booking.overtime_rate)}/hr</span>
        : null)
    : (
      <OvertimeSection
        bookingId={booking.id}
        currency={booking.currency || 'USD'}
        taxPct={booking.tax_pct != null ? Number(booking.tax_pct) : taxPct}
        defaultRate={booking.overtime_rate != null ? Number(booking.overtime_rate) : null}
        initial={{
          hours: booking.overtime_hours ?? null,
          rate: booking.overtime_charge_rate ?? null,
          tax: booking.overtime_tax ?? null,
          amount: booking.overtime_amount ?? null,
          invoicedAt: booking.overtime_invoiced_at ?? null,
          paidAt: booking.overtime_paid_at ?? null,
        }}
        canManage={canManageMoney}
        rateLabel={booking.overtime_rate != null ? `${money(booking.overtime_rate)}/hr` : 'Not listed'}
      />
    );

  // Event header (mobile) — Type / Date / Guest count on one line as a 3-up grid
  // that wraps on narrow widths (matches the design mockup). Club uses the plain
  // rows above instead.
  const eventTypeHeaderValue = (() => {
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
  })();
  const eventHeaderBlock = djType === 'mobile' ? (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '13px 22px', marginTop: 20, marginBottom: 6 }}>
      <div>
        <div className={styles.detailLabel}>Event Type</div>
        <div className={styles.detailValue}>{eventTypeHeaderValue}</div>
      </div>
      {booking.event_date && (
        <div>
          <div className={styles.detailLabel}>Event Date</div>
          <div className={styles.detailValue}>{formatLongDate(booking.event_date)}</div>
        </div>
      )}
      {booking.guest_count != null && (
        <div>
          <div className={styles.detailLabel}>Guest Count</div>
          <div className={styles.detailValue}>{String(booking.guest_count)}</div>
        </div>
      )}
    </div>
  ) : null;

  // Details header (club/bar) — Event Date / Set Time / Venue Name on one line as
  // a 3-up grid that wraps on narrow widths.
  const setTimeStr = booking.start_time
    ? formatTime12(booking.start_time) + (booking.end_time ? ' – ' + formatTime12(booking.end_time) : '')
    : null;
  const venueHeaderBlock = djType === 'club' ? (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '13px 22px', marginTop: 10, marginBottom: 4 }}>
      {booking.event_date && (
        <div>
          <div className={styles.detailLabel}>Event Date</div>
          <div className={styles.detailValue}>{formatLongDate(booking.event_date)}</div>
        </div>
      )}
      {setTimeStr && (
        <div>
          <div className={styles.detailLabel}>Set Time</div>
          <div className={styles.detailValue}>{setTimeStr}</div>
        </div>
      )}
      {booking.venue_name && (
        <div>
          <div className={styles.detailLabel}>Venue Name</div>
          <div className={styles.detailValue}>{booking.venue_name}</div>
        </div>
      )}
    </div>
  ) : null;

  // Schedule timeline for the Event card — Ceremony / Cocktail hour / Reception,
  // each with a teal time and an optional room note. Non-wedding bookings collapse
  // to a single line (the event's start–end).
  const cSameRoom = (booking as { ceremony_same_room?: boolean | null }).ceremony_same_room;
  const kSameRoom = (booking as { cocktail_same_room?: boolean | null }).cocktail_same_room;
  const scheduleItems: { name: string; time: string; where?: string }[] = [];
  if (booking.ceremony_needed && booking.ceremony_start_time)
    scheduleItems.push({
      name: 'Ceremony',
      time: formatTime12(booking.ceremony_start_time),
      where: cSameRoom == null ? undefined : (cSameRoom ? '· same room as reception' : '· separate room'),
    });
  if (booking.cocktail_needed && booking.cocktail_start_time)
    scheduleItems.push({
      name: 'Cocktail hour',
      time: formatTime12(booking.cocktail_start_time),
      where: kSameRoom == null ? undefined : (kSameRoom ? '· same room as reception' : '· separate room'),
    });
  if (booking.start_time)
    scheduleItems.push({
      name: timeLabelPrefix,
      time: formatTime12(booking.start_time) + (booking.end_time ? ' – ' + formatTime12(booking.end_time) : ''),
    });
  // One time (every event except weddings with ceremony/cocktail) → a single
  // "Event Time" line, no "Schedule" heading. Multiple times → the full timeline.
  const scheduleBlock = scheduleItems.length > 1 ? (
    <div style={{ marginTop: 30 }}>
      <div className={styles.detailLabel} style={{ marginBottom: 10, fontSize: 12 }}>Schedule</div>
      {scheduleItems.map((it, i) => (
        <div
          key={i}
          style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '9px 0', borderTop: '1px solid rgba(255,255,255,.07)' }}
        >
          <span style={{ fontSize: 15, fontWeight: 600, minWidth: 110 }}>{it.name}</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: NEON }}>{it.time}</span>
          {it.where && <span style={{ fontSize: 13, color: 'var(--muted,#8a8aa0)' }}>{it.where}</span>}
        </div>
      ))}
    </div>
  ) : scheduleItems.length === 1 ? (
    <div style={{ marginTop: 30 }}>
      <div className={styles.detailLabel} style={{ marginBottom: 6, fontSize: 12 }}>Event Time</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: NEON }}>{scheduleItems[0].time}</div>
    </div>
  ) : null;

  // Package card — rendered just above the Pricing card (see the section map).
  const packageBlock = (hasPackageDetails || booking.package_title) ? (
    <div className={styles.packageBlock} style={{ gridColumn: '1 / -1', background: 'transparent', backgroundImage: 'none' }}>
      <div className={styles.detailChip}><span>Package</span></div>
      {booking.package_title && (
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--white,#fff)', marginTop: 12 }}>
          {booking.package_title}
        </div>
      )}
      {hasPackageDetails && (
        <div
          style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--muted,#8a8aa0)', marginTop: booking.package_title ? 6 : 12 }}
          dangerouslySetInnerHTML={{ __html: booking.package_details || '' }}
        />
      )}
    </div>
  ) : null;

  return (
    <div className={styles.detailsPanel}>
      {typeMismatchNote && (
        <div className={styles.typeMismatchNote}>
          <strong>Note:</strong> {typeMismatchNote}
        </div>
      )}
      <div className={styles.detailsSections}>
        {groupedSections.map((g) => (
          <Fragment key={g.key}>
          {g.key === 'PRICING' && packageBlock}
          <div
            className={`${styles.detailSection}${g.key === 'PRICING' ? ' ' + styles.detailSectionPricing : ''}`}
          >
            <div className={styles.detailChip}><span>{g.title}</span></div>
            {g.key === 'EVENT' && eventHeaderBlock}
            {g.key === 'VENUE' && venueHeaderBlock}
            {g.key === 'PRICING' ? renderPricing(g.rows) : g.rows.map((row, i) => (
              <div
                key={i}
                className={styles.detailPairRow}
                style={row.length === 1 ? { gridTemplateColumns: '1fr' } : undefined}
              >
                {row.map((cell) => (
                  <div key={cell.label} className={styles.detailRow}>
                    <div className={styles.detailLabel}>{cell.label}</div>
                    <div className={styles.detailValue}>{cell.value}</div>
                  </div>
                ))}
              </div>
            ))}
            {g.key === 'EVENT' && scheduleBlock}
            {g.key === 'EVENT' && overtimeControl && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.06)' }}>
                <span className={styles.detailLabel}>Overtime</span>
                {overtimeControl}
              </div>
            )}
            {g.key === 'HOST' && hostUserId && (
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => { setMsgErr(null); setMsgDone(false); setMsgOpen(true); }}
                  className={styles.detailValue}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', background: 'transparent', color: 'inherit', border: '1px solid rgba(255,255,255,.18)', borderRadius: 8, padding: '7px 14px', fontWeight: 600 }}
                >
                  ✉ Message host
                </button>
              </div>
            )}
          </div>
          </Fragment>
        ))}
      </div>
      {msgOpen && (
        <div
          onClick={() => { if (!msgBusy) setMsgOpen(false); }}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 440, background: '#0e0e14', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, padding: 18, boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}
          >
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Message host</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted,#8a8aa0)', marginBottom: 10 }}>
              Goes to {booking.requester_name?.trim() || 'the host'}'s inbox on the site — they also get an email nudge, and their reply lands back here.
            </div>
            <textarea
              value={msgText}
              onChange={(e) => setMsgText(e.target.value)}
              rows={5}
              placeholder="Hi — just following up about your event…"
              autoFocus
              style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', background: '#07070b', color: '#fff', border: '1px solid rgba(255,255,255,.14)', borderRadius: 10, padding: '10px 12px', fontSize: 14, lineHeight: 1.5 }}
            />
            {msgErr && <div style={{ color: '#ff6b6b', fontSize: 12.5, marginTop: 8 }}>{msgErr}</div>}
            {msgDone && <div style={{ color: NEON, fontSize: 12.5, marginTop: 8 }}>Sent ✓</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button
                type="button"
                onClick={() => { if (!msgBusy) setMsgOpen(false); }}
                style={{ cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,.16)', color: '#fff', borderRadius: 9, padding: '8px 14px', fontSize: 13, fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={msgBusy || msgDone}
                onClick={sendHostMessage}
                style={{ cursor: msgBusy ? 'default' : 'pointer', background: NEON, border: 'none', color: '#04150f', borderRadius: 9, padding: '8px 16px', fontSize: 13, fontWeight: 700, opacity: (msgBusy || msgDone) ? 0.7 : 1 }}
              >
                {msgBusy ? 'Sending…' : 'Send message'}
              </button>
            </div>
          </div>
        </div>
      )}
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
      {/* Package card now renders above the Pricing card — see the section map. */}
      {/* "Booked On <date>" footer removed — the booking log already records
          when the request came in, so it was redundant here. */}
      {hasNotes && (
        <div className={styles.detailLongBlock}>
          <div className={styles.detailLabel}>Notes</div>
          <div className={styles.detailLongValue}>{booking.notes}</div>
        </div>
      )}
      {/* Shared notes feed — both DJ and host can read + post. Shown for
          club/bar AND mobile (private) bookings — any real two-party
          booking. Manual events with no counterparty are excluded. */}
      {/* Contract + Payments sections removed from the expanded details — every
          action (Review & Send, Request Deposit, download, status) lives in the
          pipeline/status strip at the top of the card, so these were redundant. */}

      {/* Planner & Playlist panel intentionally NOT shown on the booking card.
          The planner status + % lives in the status strip up top, and the full
          answers open from there (Open planner / Run sheet). Keeping the whole
          30-question panel out of the card keeps it short and money-first.
          To bring it back, re-mount <PlannerPanel bookingId={booking.id} />
          here, gated on `plannerStatus`. */}
      {/* DJ Rider — club/bar only. Takes the slot mobile uses for Planner &
          Playlist. The DJ customizes this booking's rider here and deploys it
          to the host. */}
      {bt === 'club' && (
        <div style={{ margin: '0 0 1rem', display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          {savedRiders.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => sendNamedRider(r)}
              title={`Send your "${r.name}" rider to this host`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem', background: 'transparent', border: '1px solid var(--neon,#00e0a4)', borderRadius: 8, color: 'var(--neon,#00e0a4)', padding: '.55rem .9rem', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer' }}
            >
              Send &ldquo;{r.name}&rdquo;
            </button>
          ))}
          <button
            type="button"
            onClick={() => setRiderChooserOpen(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem', background: 'transparent', border: '1px solid rgba(255,255,255,.28)', borderRadius: 8, color: '#fff', padding: '.55rem .9rem', fontWeight: 600, fontSize: '.85rem', cursor: 'pointer' }}
          >
            Rider portal
          </button>
        </div>
      )}
      {riderChooserOpen && (
        <RiderSendModal bookingId={booking.id} onClose={() => setRiderChooserOpen(false)} />
      )}
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
      {/* Booking log — the full timeline, at the very bottom of the card.
          Owner-only feature. */}
      {isOwner && <BookingLog booking={booking} payments={payments} />}

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
