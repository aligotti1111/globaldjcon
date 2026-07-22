'use client';

// AddManualBookingModal — the "+ Add Booking Manually" form.
//
// Lifted out of UpcomingBookingsClient verbatim: it's a quarter of that file
// and shares almost nothing with the bookings table beyond a few formatters
// (now in ./shared) and the booking type. Behaviour is unchanged.

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  searchAddresses, EVENT_SUBFIELDS, buildEventDetails, getPackageCategory,
  hoursBetween, durationLabel,
} from '../[slug]/mobileBookingForm';
import { type MobilePackage, packageTiers } from '../[slug]/bookingSettings';
import { COUNTRIES, COUNTRY_CODES_ADDR } from '../account-settings/helpers';
import styles from './upcomingBookings.module.css';
import type { UpcomingBooking } from './page';
import { COUNTRY_FLAGS, MOBILE_EVENT_TYPES, TIME_OPTIONS, NEON, formatSentDate } from './shared';

export default function AddManualBookingModal({
  userId, djType, djCountry, djName, bookingsPerDay, mobPackages, existingBookings,
  existing, focusHost, prefillDate, onClose, onAdded, onUpdated,
  taxEnabledDefault = false, taxPctDefault = 0, depositPctDefault = 0,
  settingsCurrency = 'USD',
}: {
  userId: string;
  djType: 'club' | 'mobile';
  djCountry: string;
  djName: string;
  bookingsPerDay: number;
  mobPackages: Record<string, MobilePackage[]> | null;
  existingBookings: UpcomingBooking[];
  existing: UpcomingBooking | null;
  /** From the DJ's booking settings — the starting position of the two
   *  toggles below, not a constraint. Either can be flipped per booking. */
  taxEnabledDefault?: boolean;
  taxPctDefault?: number;
  depositPctDefault?: number;
  /** booking_settings.rate_currency — the DJ bills in one currency, so this
   *  is read, not asked. Existing bookings still show their own. */
  settingsCurrency?: string;
  /**
   * Opened via "Add host details…" rather than the pencil. Scrolls to the Host
   * Details block, focuses Host Name, and calls the block out — the modal opens
   * at the top and that block is below the fold, so without this you arrive at
   * a form that looks identical to a normal edit and shows no sign of the thing
   * you clicked for.
   */
  focusHost?: boolean;
  // Optional initial date for the new-booking flow — used when the modal
  // is opened from the public calendar's "Add Booking Details" button so
  // the date is already populated.
  prefillDate?: string;
  onClose: () => void;
  onAdded: (b: UpcomingBooking) => void;
  onUpdated: (b: UpcomingBooking) => void;
}) {
  const isEdit = existing !== null;

  function trimTime(t: string | null): string {
    if (!t) return '';
    return t.length >= 5 ? t.slice(0, 5) : t;
  }
  // When editing, existing.event_date wins; otherwise use the optional
  // prefillDate (from the public calendar deep-link).
  const [eventDate, setEventDate] = useState(existing?.event_date || prefillDate || '');
  const [startTime, setStartTime] = useState(trimTime(existing?.start_time || null));
  const [endTime, setEndTime] = useState(trimTime(existing?.end_time || null));
  const [venueName, setVenueName] = useState(existing?.venue_name || '');
  const [venueAddress, setVenueAddress] = useState(existing?.venue_address || '');
  const [country, setCountry] = useState<string>(djCountry || 'United States');
  const [venueType, setVenueType] = useState<string>(existing?.venue_type || '');
  const [setType, setSetType] = useState<string>(existing?.set_type || '');
  const [eventType, setEventType] = useState<string>(existing?.event_type || '');
  // Event-type-specific sub-fields, mirrored from the public booking form.
  // Pre-filled from an existing booking's event_details so edits round-trip.
  const initEd = (existing as { event_details?: string | null } | null)?.event_details || '';
  const initBirthday = existing?.event_type === 'birthday';
  const [eventSubType, setEventSubType] = useState<string>(
    initBirthday ? '' : (EVENT_SUBFIELDS[existing?.event_type || ''] ? initEd : '')
  );
  const [birthdayAge, setBirthdayAge] = useState<string>(
    initBirthday ? (initEd.match(/age:\s*([^·]+)/i)?.[1]?.trim() || '') : ''
  );
  const [surprise, setSurprise] = useState<boolean>(
    initBirthday ? /surprise party:\s*yes/i.test(initEd) : false
  );
  const eventTypeMounted = useRef(false);
  // Selected package index (as a string; '' = none) within the category that
  // matches the chosen event type. Pre-fill from an existing booking.
  const [selectedPkgIdx, setSelectedPkgIdx] = useState<string>(
    existing?.package_index != null ? String(existing.package_index) : ''
  );
  // Per-instance edit of the selected package's details. null = use the
  // package's saved details as-is; a string = details edited for THIS booking
  // only (never written back to the DJ's saved package).
  const [editedDetails, setEditedDetails] = useState<string | null>(
    existing?.package_details ? existing.package_details : null
  );
  const [editingDetails, setEditingDetails] = useState(false);
  // Cocktail hour (weddings only) — optional add via a link under the date.
  const [showCocktail, setShowCocktail] = useState<boolean>(
    !!existing?.cocktail_start_time || existing?.cocktail_needed === true
  );
  const [cocktailStart, setCocktailStart] = useState<string>(trimTime(existing?.cocktail_start_time || null));
  // Optional overtime rate (per hour), added via a link under the rate box.
  const [showOvertime, setShowOvertime] = useState<boolean>(existing?.overtime_rate != null);
  const [overtimeRate, setOvertimeRate] = useState<string>(existing?.overtime_rate != null ? String(existing.overtime_rate) : '');
  const detailsEditRef = useRef<HTMLDivElement>(null);
  // Seed the editable area's content when edit mode opens (uncontrolled, so
  // typing doesn't reset the caret).
  useEffect(() => {
    if (editingDetails && detailsEditRef.current) {
      detailsEditRef.current.innerHTML = editedDetails ?? '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingDetails]);
  // Packages for the current event type's category (general/wedding/mitzvah),
  // mirroring how the public booking form filters packages. Empty until an
  // event type is actually selected.
  const eventChosen = eventType !== '';
  const isWedding = eventType === 'weddings';
  const pkgCategory = getPackageCategory(eventType);
  const categoryPkgs: MobilePackage[] = eventChosen ? (mobPackages?.[pkgCategory] || []) : [];
  const generalPkgs: MobilePackage[] = mobPackages?.['general'] || [];
  // Only packages with a usable title are "ready" — matches the public booking
  // form, so empty packages (created but never filled in) are hidden until
  // they have content. Wedding/Mitzvah packages inherit the general-category
  // title at the same index as a fallback. Completeness is per-package: a
  // finished package shows even if others in the group are still empty.
  const usablePkgs = categoryPkgs
    .map((pkg, idx) => {
      const fallback = generalPkgs[idx] || ({} as MobilePackage);
      const title = (pkg?.title?.trim()) || (fallback.title?.trim()) || '';
      const details = (pkg?.details ?? fallback.details) || '';
      const plainDetails = details.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
      const reqAll = pkg?.reqAll ?? fallback.reqAll ?? false;
      // Effective package (pkg overrides, inherits general fallback), then
      // resolve its priced hour tiers (generalized; legacy 4/5/6 supported).
      const eff = { ...fallback, ...(pkg || {}) } as MobilePackage;
      const tiers = packageTiers(eff);
      const price4 = tiers.length ? tiers[0].price : null; // smallest tier = auto-fill base
      // "Price set" = at least one priced tier, OR price-on-request.
      const hasPrice = reqAll || tiers.length > 0;
      // Only fully-ready packages show: title AND description AND price set.
      // Partial/empty packages stay hidden until completed. Completeness is
      // per-package, so a finished one shows even if others are still empty.
      if (!pkg || !title || !plainDetails || !hasPrice) return null;
      return { idx, title, details, price4, reqAll, overtime: (pkg?.overtime ?? fallback.overtime) ?? null };
    })
    .filter((p): p is NonNullable<typeof p> => p != null);
  // Clear sub-fields + package selection when the user switches event type
  // (skip first render so an edit's pre-filled values survive mount).
  useEffect(() => {
    if (!eventTypeMounted.current) { eventTypeMounted.current = true; return; }
    setEventSubType('');
    setBirthdayAge('');
    setSurprise(false);
    setSelectedPkgIdx('');
    setEditedDetails(null);
    setEditingDetails(false);
    setShowCocktail(false);
    setCocktailStart('');
    setShowOvertime(false);
    setOvertimeRate('');
  }, [eventType]);
  // Host invite — only relevant for manual bookings. If editing a row that
  // already has an email saved, prefill it. If the email was already sent
  // (host_email_sent_at populated), the UI shows a "sent" state instead of
  // the checkbox to prevent accidental double-sends.
  const [hostEmail, setHostEmail] = useState<string>(existing?.host_email || '');
  const [hostName, setHostName] = useState<string>(existing?.requester_name || '');
  const [sendInvite, setSendInvite] = useState<boolean>(false);
  const hostEmailAlreadySent = !!existing?.host_email_sent_at;

  /**
   * Tick "Send booking details to host" by itself once a valid email is typed.
   *
   * WHY IT ISN'T JUST `sendInvite = hostEmailValid`:
   *
   * 1. ONLY ON THE TRANSITION invalid -> valid. If it keyed off "the email is
   *    valid" it would arm itself the instant you opened an existing booking
   *    that already has an address — you'd click the pencil to fix a typo in
   *    the end time, hit Save, and a booking-details email would go out that
   *    you never asked for. prevValid starts at the email's validity AT MOUNT,
   *    so a booking that arrives with an address is already "valid" and never
   *    triggers. Only actually typing one does.
   *
   * 2. A MANUAL UNTICK STICKS. Once you've touched the checkbox you've made a
   *    decision; the next keystroke in the email field must not overrule it.
   *    Without this, unticking and then fixing a typo in the address silently
   *    re-arms the send.
   *
   * 3. NOT ONCE IT'S ALREADY SENT — that path renders the "sent on X" banner
   *    with a Resend button instead of a checkbox, and re-arming a control that
   *    isn't on screen is how you double-fire.
   */
  const hostEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hostEmail.trim());
  const inviteTouched = useRef(false);
  const prevEmailValid = useRef(hostEmailValid);
  useEffect(() => {
    const wasValid = prevEmailValid.current;
    prevEmailValid.current = hostEmailValid;
    if (hostEmailAlreadySent) return;
    if (inviteTouched.current) return;
    if (!wasValid && hostEmailValid) setSendInvite(true);
  }, [hostEmailValid, hostEmailAlreadySent]);
  const [hostEmailSentAt, setHostEmailSentAt] = useState<string | null>(
    existing?.host_email_sent_at || null,
  );

  /**
   * Host Details is REQUIRED, not optional, the moment you want a contract or a
   * deposit on this booking — there's nobody to send either one to without it.
   * The block is labelled "(optional)" because for a gig you just want on your
   * calendar, it is. Both are true; which one applies depends on what you're
   * trying to do, and the form can't know that on its own.
   *
   * So: when you arrived here from "Add host details…", say it in red. That's
   * the only moment we know for certain you're blocked.
   */
  const hostBlockRef = useRef<HTMLDivElement | null>(null);
  const hostNameRef = useRef<HTMLInputElement | null>(null);
  const hostMissing = !hostName.trim() || !hostEmail.trim();
  const flagHost = !!focusHost && hostMissing;

  // Scroll the block into view and put the cursor in the first empty field.
  //
  // rAF, not a bare call: the modal is mounting on this same tick and its
  // scroll container has no height yet, so scrollIntoView would measure zero
  // and do nothing. One frame later the layout is real.
  useEffect(() => {
    if (!focusHost) return;
    const id = requestAnimationFrame(() => {
      hostBlockRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      // Focus whichever field is actually empty — jumping the cursor to Host
      // Name when the name is filled and only the email is missing just makes
      // them tab past it.
      if (!hostName.trim()) hostNameRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
    // Mount-only: re-running on every hostName keystroke would drag the scroll
    // position back mid-typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusHost]);
  // Optional flat rate. Stored as offer_amount + currency so it flows
  // through the same fields used by the normal booking flow.
  const [rate, setRate] = useState<string>(
    existing?.offer_amount != null ? String(existing.offer_amount) : '',
  );
  /**
   * Not a choice any more — it comes from the DJ's settings.
   *
   * Asking per booking meant one DJ could end up with July in USD and August
   * in EUR, which is almost never what anyone means and quietly poisons any
   * future "earned this year" total. A DJ bills in one currency; that belongs
   * on their profile, not on each event.
   *
   * An EXISTING booking still shows what it was booked in — changing the
   * setting must not re-label an agreement that's already out there.
   */
  const rateCurrency = existing?.currency || settingsCurrency || 'USD';

  // ── Sales tax + deposit ───────────────────────────────────────────
  //
  // A manual booking is still a booking: the DJ is owed the same tax and will
  // ask for the same deposit as they would on one that came through the site.
  // Leaving these off meant a manually-added event quietly under-quoted itself
  // against every other row in the list.
  //
  // Defaults come from the DJ's settings, but BOTH directions are editable:
  //   - Tax on by default, this one's out of state → switch it off
  //   - No deposit normally, but this client is new → switch it on here
  //
  // When editing, the booking's own frozen values win. Manual bookings are
  // often entered after the fact, and re-opening one shouldn't silently
  // re-price it against whatever the settings happen to say today.
  const [applyTax, setApplyTax] = useState<boolean>(
    existing ? (existing.tax_pct != null && Number(existing.tax_pct) > 0) : taxEnabledDefault,
  );
  const [taxPctStr, setTaxPctStr] = useState<string>(
    existing?.tax_pct != null ? String(existing.tax_pct) : (taxPctDefault ? String(taxPctDefault) : ''),
  );
  const [applyDeposit, setApplyDeposit] = useState<boolean>(
    existing
      ? (existing.deposit_pct != null && Number(existing.deposit_pct) > 0)
      : depositPctDefault > 0,
  );
  const [depositPctStr, setDepositPctStr] = useState<string>(
    existing?.deposit_pct != null ? String(existing.deposit_pct) : (depositPctDefault ? String(depositPctDefault) : ''),
  );

  /**
   * The money, computed the same way the public booking form does it:
   * tax on the rate, deposit on the tax-INCLUSIVE total. Getting that order
   * wrong makes a manual booking's deposit disagree with an identical one
   * booked through the site.
   */
  const moneyPreview = (() => {
    const base = Number(rate.trim());
    if (!Number.isFinite(base) || base <= 0) return null;
    const tPct = applyTax ? Number(taxPctStr) || 0 : 0;
    const taxAmount = tPct > 0 ? Number(((base * tPct) / 100).toFixed(2)) : 0;
    const total = Number((base + taxAmount).toFixed(2));
    const dPct = applyDeposit ? Number(depositPctStr) || 0 : 0;
    const depositAmount = dPct > 0 ? Number(((total * dPct) / 100).toFixed(2)) : 0;
    return { base, tPct, taxAmount, total, dPct, depositAmount, balance: Number((total - depositAmount).toFixed(2)) };
  })();

  const currencySym = rateCurrency === 'EUR' ? '€' : rateCurrency === 'GBP' ? '£' : '$';
  const money = (n: number) =>
    `${currencySym}${n.toLocaleString(undefined, {
      minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
      maximumFractionDigits: 2,
    })}`;

  /**
   * Rendered under the rate field in both the club and mobile branches —
   * defined once so the two can't drift apart, which is how the club form
   * ends up quietly missing a feature the mobile one has.
   *
   * Hidden entirely until there's a rate. Tax and deposit on nothing is a
   * pair of switches that do nothing.
   */
  const taxDepositBlock = (
    <div
      style={{
        marginTop: '.75rem',
        padding: '.75rem .85rem',
        border: '1px solid rgba(255,255,255,.12)',
        borderRadius: 8,
        background: 'rgba(255,255,255,.02)',
      }}
    >
      <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={applyTax}
          onChange={(e) => setApplyTax(e.target.checked)}
          style={{ accentColor: NEON, width: 15, height: 15 }}
        />
        <span style={{ fontSize: '.78rem', color: 'var(--white,#fff)', fontWeight: 600 }}>
          Apply sales tax
        </span>
        {applyTax && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', marginLeft: 'auto' }}>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.001"
              value={taxPctStr}
              onChange={(e) => setTaxPctStr(e.target.value)}
              onWheel={(e) => e.currentTarget.blur()}
              placeholder="0"
              style={{
                width: 74, padding: '.3rem .45rem', textAlign: 'right',
                background: 'rgba(0,0,0,.3)', border: '1px solid rgba(255,255,255,.18)',
                borderRadius: 5, color: 'var(--white,#fff)', fontSize: '.78rem',
              }}
            />
            <span style={{ fontSize: '.78rem', color: 'var(--muted,#8a8aa0)' }}>%</span>
          </span>
        )}
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', marginTop: '.55rem' }}>
        <input
          type="checkbox"
          checked={applyDeposit}
          onChange={(e) => setApplyDeposit(e.target.checked)}
          style={{ accentColor: NEON, width: 15, height: 15 }}
        />
        <span style={{ fontSize: '.78rem', color: 'var(--white,#fff)', fontWeight: 600 }}>
          Require a deposit
        </span>
        {/* A dropdown, matching the deposit control in booking settings —
            same 5-to-95 steps, so the two places can't offer different
            choices for the same number. Also removes a free-text money field
            from a modal, which is one fewer thing a stray scroll can alter. */}
        {applyDeposit && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', marginLeft: 'auto' }}>
            <select
              value={depositPctStr}
              onChange={(e) => setDepositPctStr(e.target.value)}
              onWheel={(e) => e.currentTarget.blur()}
              style={{
                padding: '.3rem .45rem',
                background: 'rgba(0,0,0,.3)', border: '1px solid rgba(255,255,255,.18)',
                borderRadius: 5, color: 'var(--white,#fff)', fontSize: '.78rem',
              }}
            >
              <option value="">Select…</option>
              {/* Every whole percent, 1–100. No gaps means no stored value can
                  fail to appear, so the "keep an off-step value" special case
                  this used to need is gone. */}
              {Array.from({ length: 100 }, (_, i) => i + 1).map((p) => (
                <option key={p} value={String(p)}>{p}%</option>
              ))}
            </select>
          </span>
        )}
      </label>

      {/* Shown as soon as there's a rate, not only when tax or deposit are on.
          With both off the total simply equals the rate — and saying so is the
          point: the DJ can see at a glance that nothing was added, rather than
          having to infer it from an absent box. */}
      {moneyPreview && (
        <div style={{ marginTop: '.6rem', paddingTop: '.55rem', borderTop: '1px solid rgba(255,255,255,.1)', fontSize: '.75rem' }}>
          {moneyPreview.taxAmount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.15rem 0', color: 'var(--muted,#8a8aa0)' }}>
              <span>Sales tax ({moneyPreview.tPct}%)</span>
              <span>{money(moneyPreview.taxAmount)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.15rem 0', color: NEON, fontWeight: 700 }}>
            <span>Total Cost</span>
            <span>{money(moneyPreview.total)}</span>
          </div>
          {/* The payment schedule is its own thing — a gap and a rule so it
              reads as "how it gets paid" rather than more line items rolling
              into the total above. Mirrors the emailed bill. */}
          {moneyPreview.depositAmount > 0 && (
            <div style={{ marginTop: '.5rem', paddingTop: '.45rem', borderTop: '1px solid rgba(255,255,255,.1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.15rem 0', color: 'var(--muted,#8a8aa0)' }}>
                <span>Deposit ({moneyPreview.dPct}%)</span>
                <span>{money(moneyPreview.depositAmount)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.15rem 0', color: 'var(--white,#fff)', fontWeight: 700 }}>
                <span>Balance day of event</span>
                <span>{money(moneyPreview.balance)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  const [addrSuggestions, setAddrSuggestions] = useState<Array<{ display: string; lat: number | null; lon: number | null }>>([]);
  const [showAddrSuggestions, setShowAddrSuggestions] = useState(false);
  const addrTimerRef = useRef<NodeJS.Timeout | null>(null);
  const venueCoordsRef = useRef<{ lat: number; lon: number } | null>(
    existing?.venue_lat != null && existing?.venue_lon != null
      ? { lat: existing.venue_lat, lon: existing.venue_lon }
      : null,
  );

  const dateInputRef = useRef<HTMLInputElement>(null);
  const todayStr = new Date().toISOString().slice(0, 10);

  useEffect(() => () => { if (addrTimerRef.current) clearTimeout(addrTimerRef.current); }, []);

  // Derive the mobile-only email extras (event sub-detail, package name +
  // details, rate) from current form state, for the host invite email.
  function emailExtras() {
    const sel = (djType === 'mobile' && selectedPkgIdx !== '')
      ? usablePkgs.find((u) => String(u.idx) === selectedPkgIdx)
      : null;
    const rateNum = rate.trim() !== '' && !isNaN(Number(rate)) ? Number(rate) : null;
    return {
      eventDetails: djType === 'mobile'
        ? (buildEventDetails(eventType, { subType: eventSubType, birthdayAge, surprise }) || '')
        : '',
      packageTitle: sel?.title || '',
      packageDetails: djType === 'mobile' ? ((editedDetails ?? sel?.details) || '') : '',
      rate: rateNum,
      currency: rateCurrency,
    };
  }

  // Hit the email API. Returns ok / error message. Used for both "send"
  // (after save) and explicit "resend" actions.
  async function sendHostInviteEmail(opts: {
    bookingId: string;
    recipientEmail: string;
    isResend: boolean;
    // Snapshot of the current form values so the email reflects what the
    // user just saved, not stale values from the booking row.
    snapshot: {
      eventDate: string;
      startTime: string;
      endTime: string;
      venueName: string;
      venueAddress: string;
      venueType: string;
      setType: string;
      eventType: string;
      eventDetails: string;
      packageTitle: string;
      packageDetails: string;
      rate: number | null;
      currency: string;
    };
  }): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'manual_booking_invite',
          hostEmail: opts.recipientEmail,
          djName,
          djType,
          bookingId: opts.bookingId,
          eventDate: opts.snapshot.eventDate,
          startTime: opts.snapshot.startTime,
          endTime: opts.snapshot.endTime || null,
          venueName: opts.snapshot.venueName || null,
          venueAddress: opts.snapshot.venueAddress || null,
          venueType: opts.snapshot.venueType || null,
          setType: opts.snapshot.setType || null,
          eventType: opts.snapshot.eventType || null,
          eventDetails: opts.snapshot.eventDetails || null,
          packageTitle: opts.snapshot.packageTitle || null,
          packageDetails: opts.snapshot.packageDetails || null,
          rate: opts.snapshot.rate,
          currency: opts.snapshot.currency,
          isResend: opts.isResend,
        }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || 'Email send failed' };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
    }
  }

  // Standalone resend (edit mode, after the email's already been sent once).
  async function handleResend() {
    setResendBusy(true);
    setResendSuccess(false);
    setError(null);
    if (!existing) { setResendBusy(false); return; }
    const recipientEmail = (hostEmail || existing.host_email || '').trim();
    if (!recipientEmail || !recipientEmail.includes('@')) {
      setError('No valid host email on file to resend to.');
      setResendBusy(false);
      return;
    }

    // Same guard as handleSave — never send a host invite to a DJ account.
    try {
      const lookupRes = await fetch(
        `/api/lookup-dj-by-email?email=${encodeURIComponent(recipientEmail)}`,
      );
      if (lookupRes.ok) {
        const lookup = await lookupRes.json() as { found?: boolean; isDj?: boolean };
        if (lookup?.found && lookup.isDj) {
          setError(
            'This email is registered as a DJ account, which can\u2019t be added as the host of a booking. Update the email before resending.',
          );
          setResendBusy(false);
          return;
        }
      }
    } catch (e) {
      console.error('[upcoming-bookings] resend host email lookup failed', e);
    }

    const result = await sendHostInviteEmail({
      bookingId: existing.id,
      recipientEmail,
      isResend: true,
      snapshot: {
        eventDate, startTime, endTime, venueName, venueAddress,
        venueType, setType, eventType,
        ...emailExtras(),
      },
    });
    if (!result.ok) {
      setError(result.error || 'Resend failed.');
      setResendBusy(false);
      return;
    }
    // Update host_email_sent_at server-side too so future opens see fresh date.
    const supabase = createClient();
    const nowIso = new Date().toISOString();
    await supabase
      .from('bookings')
      .update({ host_email: recipientEmail, host_email_sent_at: nowIso } as unknown as never)
      .eq('id', existing.id)
      .eq('dj_id', userId);
    setHostEmailSentAt(nowIso);
    setResendSuccess(true);
    setResendBusy(false);
  }

  function openDatePicker() {
    const el = dateInputRef.current;
    if (!el) return;
    // showPicker is the modern API. Fall back to focus() on older browsers.
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); return; } catch { /* fall through */ }
    }
    el.focus();
  }

  async function handleSave() {
    setError(null);
    if (!eventDate) { setError('Pick a date.'); return; }
    if (!startTime) { setError('Pick a start time.'); return; }
    if (djType === 'mobile' && !endTime) { setError('Pick an end time.'); return; }
    if (djType === 'club' && !venueName.trim()) { setError('Venue name is required.'); return; }

    // Daily-cap check — only fires when adding NEW or moving an existing
    // booking onto a fuller day. Editing an existing booking on its own
    // date is exempt (we'd be counting it against itself).
    const sameDay = existingBookings.filter(
      (b) => b.event_date === eventDate && (!isEdit || b.id !== existing.id),
    ).length;
    const cap = djType === 'club' ? 1 : Math.max(1, bookingsPerDay || 1);
    if (sameDay >= cap) {
      const msg = djType === 'club'
        ? `You already have a booking on ${eventDate}. Club/bar DJs can only have one booking per day. Save anyway?`
        : `You already have ${sameDay} booking(s) on ${eventDate} (your daily cap is ${cap}). Save anyway?`;
      if (!confirm(msg)) return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const coords = venueCoordsRef.current;
      // Shared payload for both insert and update.
      const trimmedEmail = hostEmail.trim();

      // Block: the host_email field is for the booking's HOST (the person
      // who hired the DJ). It must not point to another DJ account — a DJ
      // can't accept their own gig as the host. Look the email up against
      // the user base and reject if it resolves to a DJ. Hosts and venues
      // are both valid as host-side accounts.
      if (trimmedEmail && trimmedEmail.includes('@')) {
        try {
          const lookupRes = await fetch(
            `/api/lookup-dj-by-email?email=${encodeURIComponent(trimmedEmail)}`,
          );
          if (lookupRes.ok) {
            const lookup = await lookupRes.json() as {
              found?: boolean;
              isDj?: boolean;
              name?: string | null;
            };
            if (lookup?.found && lookup.isDj) {
              setError(
                'This email is registered as a DJ account, which can\u2019t be added as the host of a booking. Enter a host or venue email, or leave the field blank.',
              );
              setSaving(false);
              return;
            }
          }
        } catch (e) {
          // Network failure on lookup — don't hard-block, just log. The
          // host-side has the same forgiving behavior.
          console.error('[upcoming-bookings] host email lookup failed', e);
        }
      }

      // Parse rate. Empty → null; invalid → error.
      const rateTrimmed = rate.trim();
      let rateNum: number | null = null;
      if (rateTrimmed) {
        rateNum = Number(rateTrimmed);
        if (!Number.isFinite(rateNum) || rateNum < 0) {
          setError('Rate must be a positive number.');
          setSaving(false);
          return;
        }
      }
      const pkgSelected = djType === 'mobile' && selectedPkgIdx !== '';
      const selectedUsable = pkgSelected ? usablePkgs.find((u) => String(u.idx) === selectedPkgIdx) : null;
      // Instance details: a selected package's (possibly edited) details, OR
      // free-text details typed when no packages exist for this type.
      const instanceDetails = djType === 'mobile'
        ? (((editedDetails ?? selectedUsable?.details) || '').trim() || null)
        : null;
      const payload = {
        booking_type: djType,
        event_date: eventDate,
        start_time: startTime,
        end_time: endTime || null,
        venue_name: venueName.trim() || null,
        venue_address: venueAddress.trim() || null,
        venue_lat: coords?.lat ?? null,
        venue_lon: coords?.lon ?? null,
        venue_type: djType === 'club' ? (venueType || null) : null,
        set_type: djType === 'club' ? (setType || null) : null,
        event_type: djType === 'mobile' ? (eventType || null) : null,
        event_details: djType === 'mobile'
          ? buildEventDetails(eventType, { subType: eventSubType, birthdayAge, surprise })
          : null,
        cocktail_needed: (djType === 'mobile' && isWedding && showCocktail) ? true : null,
        cocktail_start_time: (djType === 'mobile' && isWedding && showCocktail && cocktailStart) ? cocktailStart : null,
        package_title: selectedUsable ? selectedUsable.title : null,
        package_details: instanceDetails,
        package_category: (selectedUsable || instanceDetails) ? pkgCategory : null,
        package_index: selectedUsable ? selectedUsable.idx : null,
        overtime_rate: (djType === 'mobile' && showOvertime && overtimeRate.trim() !== '' && Number(overtimeRate) > 0)
          ? Number(overtimeRate) : null,
        host_email: trimmedEmail || null,
        requester_name: hostName.trim() || null,
        offer_amount: rateNum,
        currency: rateNum != null ? rateCurrency : null,
        // Frozen at save, exactly like a site booking — so a later settings
        // change can't re-price an event that already happened.
        //
        // ZERO, NOT NULL, WHEN TAX IS SWITCHED OFF. This used to write null,
        // on the assumption that null read as "no tax". It doesn't. Every
        // display surface does `snapTaxPct ?? liveTaxPct` — null means "this
        // row predates tax, fall back to the DJ's CURRENT setting". So a
        // manual booking saved with the tax toggle off was stored identically
        // to a legacy row, and the row's Value and the card's Tax line both
        // went and applied the DJ's live tax % to it anyway. Turning tax off
        // did nothing.
        //
        // A zero snapshot says "we asked, the answer was none" — a fact the
        // readers can't mistake for an absence. Writing all three together
        // also keeps the snapshot internally complete (total − tax === base),
        // which is what marks it fresh and stops the recompute path running
        // at all.
        //
        // Still null when there's no rate: no price means nothing was agreed,
        // and that genuinely is an absence.
        tax_pct: moneyPreview ? moneyPreview.tPct : null,
        tax_amount: moneyPreview ? moneyPreview.taxAmount : null,
        total_with_tax: moneyPreview ? moneyPreview.total : null,
        deposit_pct: moneyPreview && moneyPreview.dPct > 0 ? moneyPreview.dPct : null,
        deposit_amount: moneyPreview && moneyPreview.depositAmount > 0 ? moneyPreview.depositAmount : null,
      };
      const selectCols = 'id, event_date, start_time, end_time, venue_name, venue_address, venue_lat, venue_lon, venue_type, set_type, event_type, event_details, cocktail_needed, cocktail_start_time, package_title, package_details, package_category, package_index, overtime_rate, booking_type, is_manual, flyer_url, host_email, host_email_sent_at, requester_name, offer_amount, original_rate, discount_code, discount_label, discount_amount, currency, tax_pct, tax_amount, total_with_tax, deposit_pct, deposit_amount';

      // Decide whether to send the invite email after save.
      const shouldSend = sendInvite && !!trimmedEmail && trimmedEmail.includes('@') && !hostEmailAlreadySent;

      if (isEdit) {
        const { data, error: e } = await supabase
          .from('bookings')
          .update(payload as unknown as never)
          .eq('id', existing.id)
          .eq('dj_id', userId)
          .select(selectCols)
          .single();
        if (e) throw e;
        let updated = { ...(data as unknown as UpcomingBooking), is_manual: true };
        // Fire email if requested.
        if (shouldSend) {
          const result = await sendHostInviteEmail({
            bookingId: existing.id,
            recipientEmail: trimmedEmail,
            isResend: false,
            snapshot: {
              eventDate, startTime, endTime, venueName, venueAddress,
              venueType, setType, eventType,
              ...emailExtras(),
            },
          });
          if (result.ok) {
            const nowIso = new Date().toISOString();
            await supabase
              .from('bookings')
              .update({ host_email_sent_at: nowIso } as unknown as never)
              .eq('id', existing.id)
              .eq('dj_id', userId);
            updated = { ...updated, host_email_sent_at: nowIso };
            setHostEmailSentAt(nowIso);
          } else {
            // Save succeeded but email failed — surface the error and bail
            // so the user can decide what to do. Booking is already updated.
            setError('Booking saved, but email failed: ' + (result.error || 'unknown'));
            setSaving(false);
            onUpdated(updated);
            return;
          }
        }
        onUpdated(updated);
      } else {
        const insertRow = {
          ...payload,
          dj_id: userId,
          requester_id: userId,
          is_manual: true,
          status: 'approved',
        };
        const { data, error: e } = await supabase
          .from('bookings')
          .insert(insertRow as unknown as never)
          .select(selectCols)
          .single();
        if (e) throw e;
        let inserted = { ...(data as unknown as UpcomingBooking), is_manual: true };
        if (shouldSend) {
          const result = await sendHostInviteEmail({
            bookingId: inserted.id,
            recipientEmail: trimmedEmail,
            isResend: false,
            snapshot: {
              eventDate, startTime, endTime, venueName, venueAddress,
              venueType, setType, eventType,
              ...emailExtras(),
            },
          });
          if (result.ok) {
            const nowIso = new Date().toISOString();
            await supabase
              .from('bookings')
              .update({ host_email_sent_at: nowIso } as unknown as never)
              .eq('id', inserted.id)
              .eq('dj_id', userId);
            inserted = { ...inserted, host_email_sent_at: nowIso };
          } else {
            setError('Booking saved, but email failed: ' + (result.error || 'unknown'));
            setSaving(false);
            onAdded(inserted);
            return;
          }
        }
        onAdded(inserted);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{isEdit ? 'Edit Manual Booking' : 'Add Booking Manually'}</h2>
          <button type="button" onClick={onClose} className={styles.modalClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.modalBody}>
          {/* Event Type (+ secondary field) at the top, so the rest of the
              form (package/rate, reception labels, cocktail hour) keys off it. */}
          {djType === 'mobile' && (
            <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <label className={styles.field} style={{ flex: '0 0 auto', maxWidth: '100%' }}>
                <span className={styles.fieldLabel} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
                  Event Type
                  {eventChosen && EVENT_SUBFIELDS[eventType] && (
                    <svg width="26" height="10" viewBox="0 0 26 10" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
                      <line x1="1" y1="5" x2="21" y2="5" stroke="var(--neon)" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M17 1.5 L22 5 L17 8.5" stroke="var(--neon)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  className={styles.input}
                  style={{ width: '210px', maxWidth: '100%' }}
                >
                  <option value="">Select event type…</option>
                  {MOBILE_EVENT_TYPES.map((v) => (
                    <option key={v.value} value={v.value}>{v.label}</option>
                  ))}
                </select>
              </label>

              {/* Sub-category, to the right of the event-type box. */}
              {EVENT_SUBFIELDS[eventType]?.textLabel && (
                <label className={styles.field} style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <span className={styles.fieldLabel}>{EVENT_SUBFIELDS[eventType].textLabel}</span>
                  <input
                    type="text"
                    value={eventSubType}
                    onChange={(e) => setEventSubType(e.target.value)}
                    placeholder={EVENT_SUBFIELDS[eventType].textPlaceholder}
                    className={styles.input}
                    autoComplete="off"
                  />
                </label>
              )}
              {EVENT_SUBFIELDS[eventType]?.isBirthday && (
                <div className={styles.field} style={{ flex: '1 1 auto' }}>
                  <span className={styles.fieldLabel}>Guest of Honor Age?</span>
                  <input
                    type="number"
                    onWheel={(e) => e.currentTarget.blur()}
                    min={0}
                    inputMode="numeric"
                    value={birthdayAge}
                    onChange={(e) => setBirthdayAge(e.target.value)}
                    placeholder="30"
                    className={styles.input}
                    style={{ width: '100%' }}
                    autoComplete="off"
                  />
                  {/* Snug under the age box (the .field column gap handles spacing). */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.8rem', whiteSpace: 'nowrap' }}>
                    <input
                      type="checkbox"
                      checked={surprise}
                      onChange={(e) => setSurprise(e.target.checked)}
                      style={{ width: 15, height: 15, flexShrink: 0, accentColor: 'var(--neon)', cursor: 'pointer' }}
                    />
                    Is this a Surprise Party?
                  </label>
                </div>
              )}
            </div>
          )}
          {/* Date + Start Time + End Time on a single row. Clicking
              anywhere on the date field opens the native picker. */}
          <div className={styles.fieldRow3}>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Date</span>
              <div
                className={styles.dateWrap}
                onClick={openDatePicker}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDatePicker(); } }}
              >
                <input
                  ref={dateInputRef}
                  type="date"
                  min={todayStr}
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className={styles.dateInput}
                />
              </div>
            </div>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{isWedding ? 'Reception Start' : 'Start Time'}</span>
              <select value={startTime} onChange={(e) => setStartTime(e.target.value)} className={styles.input}>
                <option value="">Select…</option>
                {TIME_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                {isWedding ? 'Reception End' : <>End Time {djType === 'club' && <span className={styles.optional}>(optional)</span>}</>}
              </span>
              <select value={endTime} onChange={(e) => setEndTime(e.target.value)} className={styles.input}>
                <option value="">Select…</option>
                {TIME_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
          </div>
          {(isWedding || durationLabel(hoursBetween(startTime, endTime))) && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginTop: '-.3rem', marginBottom: '.35rem' }}>
              <div>
                {isWedding && (
                  !showCocktail ? (
                    <button
                      type="button"
                      onClick={() => setShowCocktail(true)}
                      style={{ background: 'none', border: 'none', color: 'var(--neon)', fontSize: '.78rem', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                    >
                      + Add Cocktail Hour
                    </button>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.55rem', flexWrap: 'wrap' }}>
                      <span className={styles.fieldLabel} style={{ margin: 0, color: 'var(--neon)' }}>Cocktail Hour Start</span>
                      <select
                        value={cocktailStart}
                        onChange={(e) => setCocktailStart(e.target.value)}
                        className={styles.input}
                        style={{ width: 'auto' }}
                      >
                        <option value="">Select…</option>
                        {TIME_OPTIONS.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => { setShowCocktail(false); setCocktailStart(''); }}
                        style={{ background: 'none', border: 'none', color: '#ff5f5f', fontSize: '.72rem', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                      >
                        Remove
                      </button>
                    </div>
                  )
                )}
              </div>
              {durationLabel(hoursBetween(startTime, endTime)) && (
                <div style={{ fontSize: '.72rem', color: '#ffd24a', whiteSpace: 'nowrap' }}>
                  Event Duration: {durationLabel(hoursBetween(startTime, endTime))}
                </div>
              )}
            </div>
          )}

          {/* Venue name + Rate on one line. Venue name takes the
              remaining width; the rate box is narrow (~5 chars). */}
          <div className={styles.venueRateRow}>
            <label className={styles.field} style={{ flex: 1, minWidth: 0 }}>
              <span className={styles.fieldLabel}>
                Venue Name {djType === 'mobile' && <span className={styles.optional}>(optional)</span>}
              </span>
              <input
                type="text"
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
                placeholder={djType === 'club' ? 'e.g. Black Velvet Lounge' : 'e.g. Riverside Park Pavilion'}
                className={styles.input}
                style={{ width: '100%' }}
              />
            </label>
            {djType === 'club' && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  Rate <span className={styles.optional}>(optional)</span>
                </span>
                <div className={styles.rateRow}>
                  <div className={styles.rateInputWrap}>
                    <span className={styles.rateSymbol}>
                      {rateCurrency === 'USD' ? '$' : rateCurrency === 'EUR' ? '€' : rateCurrency === 'GBP' ? '£' : rateCurrency === 'CAD' ? '$' : rateCurrency === 'AUD' ? '$' : rateCurrency}
                    </span>
                    <input
                      type="number"
                      onWheel={(e) => e.currentTarget.blur()}
                      inputMode="decimal"
                      min="0"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                      placeholder="0"
                      className={styles.rateInput}
                    />
                  </div>
                </div>
                {rate.trim() !== '' && taxDepositBlock}
              </label>
            )}
          </div>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>Venue Location</span>
            <div className={styles.addrRow}>
              <div className={styles.addrWrap}>
                <input
                  type="text"
                  value={venueAddress}
                  onChange={(e) => {
                    const val = e.target.value;
                    setVenueAddress(val);
                    venueCoordsRef.current = null;
                    if (addrTimerRef.current) clearTimeout(addrTimerRef.current);
                    if (val.trim().length < 3) {
                      setAddrSuggestions([]);
                      setShowAddrSuggestions(false);
                      return;
                    }
                    addrTimerRef.current = setTimeout(async () => {
                      const cc = COUNTRY_CODES_ADDR[country] || null;
                      const results = await searchAddresses(val.trim(), cc);
                      setAddrSuggestions(results);
                      setShowAddrSuggestions(results.length > 0);
                    }, 350);
                  }}
                onBlur={() => setTimeout(() => setShowAddrSuggestions(false), 150)}
                onFocus={() => { if (addrSuggestions.length > 0) setShowAddrSuggestions(true); }}
                placeholder="Start typing address…"
                className={styles.input}
                autoComplete="off"
              />
              {showAddrSuggestions && addrSuggestions.length > 0 && (
                <div className={styles.addrSuggestions}>
                  {addrSuggestions.map((s, i) => (
                    <div
                      key={i}
                      className={styles.addrSuggestion}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setVenueAddress(s.display);
                        if (s.lat != null && s.lon != null) {
                          venueCoordsRef.current = { lat: s.lat, lon: s.lon };
                        } else {
                          venueCoordsRef.current = null;
                        }
                        setShowAddrSuggestions(false);
                      }}
                    >
                      {s.display}
                    </div>
                  ))}
                </div>
              )}
              </div>
              <select
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value);
                  setAddrSuggestions([]);
                  setShowAddrSuggestions(false);
                  venueCoordsRef.current = null;
                }}
                className={styles.countrySelect}
                aria-label="Country for address search"
              >
                {COUNTRIES.filter((c) => c !== 'Other').map((c) => (
                  <option key={c} value={c}>
                    {COUNTRY_FLAGS[c] || '🌍'} {(COUNTRY_CODES_ADDR[c] || '??').toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Package + Rate — after Event Type. Both stay visible but
              disabled (unclickable) until an event type is selected. The
              selected package's saved details show indented below. */}
          {djType === 'mobile' && (
            <>
              <div className={styles.venueRateRow} style={{ opacity: eventChosen ? 1 : 0.5 }}>
                {/* Package gives up width once Overtime appears, so Rate and
                    Overtime can sit side by side instead of Overtime dropping
                    to its own line and pushing the form taller. */}
                <label
                  className={styles.field}
                  style={{ flex: showOvertime ? '1 1 90px' : '1 1 160px', minWidth: 0 }}
                >
                  <span className={styles.fieldLabel}>Package</span>
                  <select
                    value={selectedPkgIdx}
                    disabled={!eventChosen}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSelectedPkgIdx(v);
                      setEditingDetails(false);
                      const p = v !== '' ? usablePkgs.find((u) => String(u.idx) === v) : null;
                      // New selection starts from the package's saved details.
                      setEditedDetails(p ? (p.details || '') : null);
                      if (p) {
                        // Pre-fill the rate with the package's base (4hr) price;
                        // skip for price-on-request packages. The DJ can still
                        // edit the Rate box afterward.
                        if (!p.reqAll && p.price4 != null && String(p.price4) !== '') {
                          setRate(String(p.price4));
                        }
                        // If the package carries an overtime rate, surface it
                        // (editable); otherwise leave the overtime field as-is.
                        if (p.overtime != null && String(p.overtime).trim() !== '' && Number(p.overtime) > 0) {
                          setOvertimeRate(String(p.overtime));
                          setShowOvertime(true);
                        }
                      }
                    }}
                    className={styles.input}
                  >
                    {!eventChosen ? (
                      <option value="">Select event type first</option>
                    ) : usablePkgs.length === 0 ? (
                      <option value="">No packages for this type</option>
                    ) : (
                      <>
                        <option value="">— None —</option>
                        {usablePkgs.map((u) => (
                          <option key={u.idx} value={u.idx}>{u.title}</option>
                        ))}
                      </>
                    )}
                  </select>
                </label>
                <div className={styles.field} style={{ flex: '0 0 auto' }}>
                  <span className={styles.fieldLabel}>Rate <span className={styles.optional}>(optional)</span></span>
                  <div className={styles.rateRow}>
                    <div className={styles.rateInputWrap}>
                      <span className={styles.rateSymbol}>
                        {rateCurrency === 'USD' ? '$' : rateCurrency === 'EUR' ? '€' : rateCurrency === 'GBP' ? '£' : rateCurrency === 'CAD' ? '$' : rateCurrency === 'AUD' ? '$' : rateCurrency}
                      </span>
                      <input
                        type="number"
                        onWheel={(e) => e.currentTarget.blur()}
                        inputMode="decimal"
                        min="0"
                        value={rate}
                        onChange={(e) => setRate(e.target.value)}
                        placeholder="0"
                        className={styles.rateInput}
                        disabled={!eventChosen}
                      />
                    </div>
                  </div>
                  {/* The link stays under Rate; the FIELD it opens moves out of
                      this column into its own (below), so the two money boxes
                      end up on one line. */}
                  {!showOvertime && (
                    <button
                      type="button"
                      disabled={!eventChosen}
                      onClick={() => setShowOvertime(true)}
                      style={{ background: 'none', border: 'none', color: 'var(--neon)', fontSize: '.72rem', cursor: eventChosen ? 'pointer' : 'default', padding: 0, marginTop: '.35rem', textDecoration: 'underline', alignSelf: 'flex-start' }}
                    >
                      + Add Overtime Rate
                    </button>
                  )}
                </div>

                {/* Overtime — a sibling of Rate rather than a child, which is
                    what puts it alongside instead of underneath. */}
                {showOvertime && (
                  <div className={styles.field} style={{ flex: '0 0 auto' }}>
                    <span className={styles.fieldLabel}>
                      Overtime <span className={styles.optional}>(per hr)</span>
                    </span>
                    <div className={styles.rateRow}>
                      <div className={styles.rateInputWrap}>
                        <span className={styles.rateSymbol}>
                          {rateCurrency === 'USD' ? '$' : rateCurrency === 'EUR' ? '€' : rateCurrency === 'GBP' ? '£' : rateCurrency === 'CAD' ? '$' : rateCurrency === 'AUD' ? '$' : rateCurrency}
                        </span>
                        <input
                          type="number"
                          onWheel={(e) => e.currentTarget.blur()}
                          inputMode="decimal"
                          min="0"
                          value={overtimeRate}
                          onChange={(e) => setOvertimeRate(e.target.value)}
                          placeholder="0"
                          className={styles.rateInput}
                          disabled={!eventChosen}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setShowOvertime(false); setOvertimeRate(''); }}
                      style={{ background: 'none', border: 'none', color: '#ff5f5f', fontSize: '.72rem', cursor: 'pointer', padding: 0, marginTop: '.35rem', textDecoration: 'underline', alignSelf: 'flex-start' }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              {/* Tax + deposit — moved out of the Rate column so it spans the
                  full width under the row. Left inside, it was squeezed into
                  whatever Rate's column happened to be, which got narrow the
                  moment Overtime appeared beside it. */}
              {djType === 'mobile' && rate.trim() !== '' && taxDepositBlock}
              {/* Package details — shown indented/smaller, editable for THIS
                  booking only (never saved back to the package). When there are
                  no packages for this type, offer a free-text "Add Package
                  Detail" entry for this booking. */}
              {eventChosen && (() => {
                const sel = selectedPkgIdx !== ''
                  ? usablePkgs.find((u) => String(u.idx) === selectedPkgIdx)
                  : null;
                const noPackages = usablePkgs.length === 0;
                if (!sel && !noPackages) return null;
                const shown = editedDetails ?? (sel?.details || '');
                return (
                  <div style={{ marginLeft: '1rem', marginTop: '.1rem' }}>
                    {editingDetails ? (
                      <>
                        <div
                          ref={detailsEditRef}
                          contentEditable
                          suppressContentEditableWarning
                          onInput={(e) => setEditedDetails(e.currentTarget.innerHTML)}
                          style={{
                            fontSize: '.78rem', lineHeight: 1.5, opacity: 0.9,
                            border: '1px solid var(--neon)', borderRadius: 6,
                            padding: '.4rem .55rem', outline: 'none', minHeight: '2.5rem',
                          }}
                        />
                        <div style={{ textAlign: 'right', marginTop: '.2rem' }}>
                          <button
                            type="button"
                            onClick={() => setEditingDetails(false)}
                            style={{ background: 'none', border: 'none', color: 'var(--neon)', fontSize: '.72rem', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                          >
                            Done
                          </button>
                        </div>
                      </>
                    ) : shown ? (
                      <>
                        <div
                          style={{ fontSize: '.78rem', opacity: 0.7, lineHeight: 1.5 }}
                          dangerouslySetInnerHTML={{ __html: shown }}
                        />
                        {/* Centred under the package text, not tucked in the
                            right margin. "Edit" alone sat below a paragraph of
                            package details, level with nothing, and named no
                            object — at a glance it read as the edit control for
                            whatever field happened to be nearest. */}
                        <div style={{ textAlign: 'center', marginTop: '.5rem' }}>
                          <button
                            type="button"
                            onClick={() => { setEditedDetails((prev) => prev ?? sel?.details ?? ''); setEditingDetails(true); }}
                            style={{ background: 'none', border: 'none', color: 'var(--neon)', fontSize: '.72rem', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                          >
                            Edit package details
                          </button>
                        </div>
                      </>
                    ) : noPackages ? (
                      <button
                        type="button"
                        onClick={() => { setEditedDetails((prev) => prev ?? ''); setEditingDetails(true); }}
                        style={{ background: 'none', border: 'none', color: 'var(--neon)', fontSize: '.78rem', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                      >
                        + Add Package Detail
                      </button>
                    ) : null}
                  </div>
                );
              })()}
            </>
          )}

          {/* ── Host invitation section ─────────────────────────────────
              DJ can email the host with booking details. After the email
              sends once, the checkbox/send-button UI is replaced with a
              "sent on X" banner + a Resend button, so the DJ can't double-
              fire emails by accident. */}
          <div
            ref={hostBlockRef}
            className={styles.hostInviteBlock}
            style={flagHost ? {
              // Only when we KNOW they're blocked (arrived from "Add host
              // details"), never on a routine pencil edit — a red box round a
              // block genuinely marked optional would be crying wolf.
              //
              // Frame only, no fill. The tint sat behind the inputs and pushed
              // every field in the block off the modal's own surface colour —
              // so the whole area read as broken rather than as "these two
              // fields are the point". The border says it once.
              border: '1px solid rgba(255,86,86,.5)',
              borderRadius: 8,
              padding: '.9rem',
            } : undefined}
          >
            <div className={styles.fieldLabel} style={{ textAlign: 'left', opacity: flagHost ? 1 : 0.55, marginBottom: '.3rem' }}>
              Host Details{' '}
              {flagHost
                ? <span style={{ color: '#ff5656', fontWeight: 700 }}>(required)</span>
                : <span className={styles.optional}>(optional)</span>}
            </div>
            {/*
              The block ALWAYS says what it's for — including on a brand-new
              booking, which is the only moment the DJ is actually in a position
              to fill it in without coming back.

              It said "(optional)" and nothing else, which is true and useless:
              optional for WHAT? The DJ finds out days later, when they go to
              send a contract and can't. The consequence belongs next to the
              decision, not at the point it bites.

              Two voices, same fact:
                red   — you clicked "Add host details…", you're blocked NOW
                muted — just so you know, this is what these two fields buy you
            */}
            {flagHost ? (
              // The "tick Send booking details" half is gone and shouldn't come
              // back — the checkbox ticks itself now, so it was telling the DJ
              // to do something the form had already done.
              <div style={{ color: '#ff8a8a', fontSize: '.74rem', lineHeight: 1.4, marginBottom: '.45rem' }}>
                Email and Full Name needed to send booking details, contract, or request deposit.
              </div>
            ) : (
              <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.72rem', lineHeight: 1.4, marginBottom: '.45rem' }}>
                Email and Full Name needed to send booking details, contract, or request deposit.
              </div>
            )}
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <label className={styles.field} style={{ flex: '1 1 130px', minWidth: 0 }}>
                {/* "Full name", not "Name" — this goes on the contract. A DJ
                    typing "Jordan" here is putting "Jordan" on a signed
                    agreement, and the label is the only thing that says
                    otherwise before it's too late. */}
                <span className={styles.fieldLabel}>Host Full Name</span>
                <input
                  ref={hostNameRef}
                  type="text"
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  placeholder="e.g. Jordan Smith"
                  className={styles.input}
                  style={{ width: '100%', ...(flagHost && !hostName.trim() ? { borderColor: 'rgba(255,86,86,.55)' } : {}) }}
                  autoComplete="off"
                />
              </label>
              <label className={styles.field} style={{ flex: '1 1 160px', minWidth: 0 }}>
                <span className={styles.fieldLabel}>Host Email {hostEmailAlreadySent && <span className={styles.optional}>(sent)</span>}</span>
                <input
                  type="email"
                  value={hostEmail}
                  onChange={(e) => setHostEmail(e.target.value)}
                  placeholder="host@example.com"
                  className={styles.input}
                  style={{ width: '100%', ...(flagHost && !hostEmail.trim() ? { borderColor: 'rgba(255,86,86,.55)' } : {}) }}
                  autoComplete="off"
                />
              </label>
            </div>
            {hostEmailAlreadySent ? (
              <div className={styles.sentBanner}>
                <div className={styles.sentBannerText}>
                  Booking details sent {hostEmailSentAt ? `on ${formatSentDate(hostEmailSentAt)}` : ''}.
                </div>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendBusy || saving}
                  className={styles.resendBtn}
                >
                  {resendBusy ? 'Sending…' : (resendSuccess ? 'Sent ✓' : 'Resend Email')}
                </button>
              </div>
            ) : (
              <label className={styles.inviteCheckRow}>
                <input
                  type="checkbox"
                  checked={sendInvite}
                  // inviteTouched, not just setSendInvite: this is the DJ making
                  // a decision, and it has to outrank the auto-tick. Without it,
                  // unticking and then fixing a typo in the address silently
                  // re-arms the send.
                  onChange={(e) => { inviteTouched.current = true; setSendInvite(e.target.checked); }}
                  // The same regex the auto-tick uses. It was `includes('@')`,
                  // which called "a@" valid — so the box could be ticked on an
                  // address that can't receive anything, and the two rules would
                  // have disagreed about what "valid" means.
                  disabled={!hostEmailValid}
                />
                <span>
                  Send booking details to host
                  {!hostEmailValid && (
                    <span className={styles.checkHint}> · enter a valid email first</span>
                  )}
                </span>
              </label>
            )}
          </div>

          {error && <div className={styles.errorBox}>{error}</div>}
        </div>

        <div className={styles.modalFooter}>
          <button type="button" onClick={onClose} className={styles.cancelBtn} disabled={saving}>Cancel</button>
          <button type="button" onClick={handleSave} className={styles.saveBtn} disabled={saving}>
            {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Add Booking')}
          </button>
        </div>
      </div>
    </div>
  );
}
