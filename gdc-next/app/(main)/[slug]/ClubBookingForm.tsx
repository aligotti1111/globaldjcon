'use client';

// ClubBookingForm — visitor-side booking request form for club DJ profiles.
// Mirror of MobileBookingForm but tailored to the club workflow:
//
//   - Event Type (Bar / Club)
//   - Set Type (Opening / Headliner / Closing / Opening–Close / Opening & Closing)
//   - Venue name + address (freehand for now; autocomplete is a follow-up)
//   - Date (driven by the calendar — passed in via dateKey)
//   - Start / end times
//   - Equipment selection (filtered by what the DJ provides):
//       * sound_system  → only if equip_full
//       * decks_only    → if equip_full OR equip_decks
//       * venue_provides → always
//   - Rate display (read from booking_settings; per-day overrides supported
//     once day editor adds them — for now we use globals)
//   - For 'offers' rate type: input field for the visitor's offer amount
//   - Notes
//   - Submit → POST /api/bookings/create (server recomputes all pricing
//     from the DJ's booking_settings) + email DJ via /api/send-email
//
// The form is rendered inline in the booking tab below the calendar — it
// does NOT use a modal, matching MobileBookingForm's UX.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/components/AuthProvider';
import { isFullName, normalizeName, FULL_NAME_ERROR } from '@/lib/fullName';
import styles from './clubBookingForm.module.css';
import {
  type BookingSettings,
  type DayData,
  formatTime12,
  computeDiscount,
  isSaleActive,
  isPromoUsable,
  type DiscountResult,
} from './bookingSettings';
import {
  MOB_TIME_OPTIONS,
  formatLongDate,
  formatUSPhone,
  searchAddresses,
  type AddressSuggestion,
} from './mobileBookingForm';

import {
  CLUB_VENUE_TYPE_LABELS,
  CLUB_SET_TYPE_LABELS,
  currencySymbol,
} from '@/lib/constants';
import { computeRate, type RateInfo } from './clubRate';

interface DjLite {
  id: string;
  name: string | null;
  slug: string | null;
}

interface CurrentUser {
  id: string;
  email?: string | null;
  name?: string | null;
}

interface Props {
  dateKey: string;
  dj: DjLite;
  bookingSettings: BookingSettings;
  currentUser: CurrentUser;
  // Called when the visitor clicks Cancel or after a successful submit
  // — parent uses this to clear the selectedDate and dismiss the form.
  onClose: () => void;
}

// Rate calculation (RateInfo + computeRate) moved to ./clubRate so the
// server-side booking route (/api/bookings/create) recomputes the stored
// price with the EXACT same logic this form uses for its live preview.

// ─────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────

export default function ClubBookingForm({
  dateKey,
  dj,
  bookingSettings,
  currentUser,
  onClose,
}: Props) {
  // Full profile from auth context. The `currentUser` prop is a narrowed
  // { id, email, name } from the calendar; the stored phone (sms_phone) isn't
  // in it, so — same as MobileBookingForm — it has to come from here.
  const { user: authUser } = useAuth();

  // ── Form state ────────────────────────────────────────────────────
  const [venueType, setVenueType] = useState<'' | 'bar' | 'club'>('');
  const [setType, setSetType] = useState<string>('');
  // Promo code entry (client-typed). appliedCode set only after a valid Apply.
  const [promoInput, setPromoInput] = useState('');
  const [appliedCode, setAppliedCode] = useState('');
  const [promoError, setPromoError] = useState('');
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  /**
   * Prefilled from the number on the account when there is one — mirrors
   * MobileBookingForm. A host who signed up by phone already proved they
   * hold that number; re-asking is the app forgetting what it was just told.
   * Still editable in the no-number case (see knownPhone below).
   *
   * The stored value can be E.164 ("+19175551234"); the leading country code
   * comes off FIRST, because formatUSPhone only strips non-digits and handing
   * it 11 digits shifts every group left into a plausible-looking wrong number.
   */
  const accountPhone = (() => {
    const stored = (authUser as { sms_phone?: string | null } | null)?.sms_phone || '';
    const digits = stored.replace(/\D/g, '');
    const ten = digits.length === 11 && digits.startsWith('1')
      ? digits.slice(1)
      : digits;
    return ten.length === 10 ? formatUSPhone(ten) : '';
  })();
  const [phone, setPhone] = useState(accountPhone);
  /**
   * Whether the number came from the ACCOUNT — not whether the field happens
   * to have something in it. Deriving this from `phone` would flip true the
   * instant a host with no stored number typed one digit, yanking away the
   * input they were mid-way through.
   */
  const knownPhone = accountPhone !== '';

  // ── Name + email capture (mirrors MobileBookingForm) ──────────────
  // A contract names two parties and every post-booking message — offer,
  // confirmation, contract, planner, cancellation — is an email. A host who
  // signed up by phone has neither a surname nor an email on file, so, exactly
  // like the mobile form, we ask here, once, and ONLY when the account is
  // actually missing it. The create route accepts both: the email is saved to
  // the account (so future contracts/emails have somewhere to go); the name is
  // stored on the BOOKING row (requester_name), NOT written back to the
  // account, so filling it here never changes the host's profile.
  const accountName = normalizeName(
    (authUser as { name?: string | null } | null)?.name || currentUser.name || '',
  );
  const [fullName, setFullName] = useState(accountName);
  // Derived from the ACCOUNT, not the input — reading isFullName(fullName)
  // would make the field vanish the instant they typed the space before their
  // surname, mid-word.
  const needsFullName = !isFullName(accountName);
  const fullNameValid = isFullName(fullName);
  // Prefer the full profile's email, fall back to the narrowed prop.
  const needsEmail = !(((authUser?.email || currentUser.email) || '').trim());
  const [contactEmail, setContactEmail] = useState('');
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim());
  const [country, setCountry] = useState('US');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [equipment, setEquipment] = useState<string>('');
  const [venueEquipDetail, setVenueEquipDetail] = useState('');
  const [offerAmount, setOfferAmount] = useState('');
  const [notes, setNotes] = useState('');

  // Approved bookings already on this date for this DJ. Shown in red
  // under Set Times so the customer can see what's already booked.
  // Fetched via /api/dj-booked-sets — a customer's anon session can't
  // read another user's bookings directly (RLS), so the server route
  // returns just the time ranges. Pending requests are excluded.
  const [bookedSets, setBookedSets] = useState<Array<{ start: string | null; end: string | null }>>([]);
  useEffect(() => {
    if (!dateKey || !dj?.id) { setBookedSets([]); return; }
    let active = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/dj-booked-sets?djId=${encodeURIComponent(dj.id)}&date=${encodeURIComponent(dateKey)}`,
        );
        if (!res.ok) { if (active) setBookedSets([]); return; }
        const json = await res.json();
        if (!active) return;
        setBookedSets(Array.isArray(json.sets) ? json.sets : []);
      } catch {
        if (active) setBookedSets([]);
      }
    })();
    return () => { active = false; };
  }, [dateKey, dj?.id]);

  // Booked sets whose time range overlaps the customer's chosen Set
  // Start/End. Times are "HH:MM"; an end at/before start wraps midnight.
  const overlappingSets = useMemo(() => {
    if (!startTime || !endTime || bookedSets.length === 0) return [];
    const toRange = (s: string | null, e: string | null): [number, number] | null => {
      if (!s || !e) return null;
      const [sh, sm] = s.split(':').map(Number);
      const [eh, em] = e.split(':').map(Number);
      if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
      const start = sh * 60 + sm;
      let end = eh * 60 + em;
      if (end <= start) end += 24 * 60;
      return [start, end];
    };
    const mine = toRange(startTime, endTime);
    if (!mine) return [];
    return bookedSets.filter((b) => {
      const r = toRange(b.start, b.end);
      if (!r) return false;
      return mine[0] < r[1] && r[0] < mine[1];
    });
  }, [startTime, endTime, bookedSets]);

  // ── SSR-safe portal flag — Next.js renders on server where document
  // doesn't exist. Render null until mounted, then portal to body so
  // the modal escapes any parent stacking context. ──────────────────
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // ── Address autocomplete (Nominatim) ─────────────────────────────
  // Suggestions are fetched debounced (350ms) when the user has typed
  // 3+ chars. Coords from a picked suggestion stick on a ref so we can
  // include them in the booking insert (DJ uses them for distance check).
  const [addrSuggestions, setAddrSuggestions] = useState<AddressSuggestion[]>([]);
  const [showAddrSuggestions, setShowAddrSuggestions] = useState(false);
  const addrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const venueCoordsRef = useRef<{ lat: number; lon: number } | null>(null);
  // True once an address is chosen from the autocomplete dropdown — used
  // (with a 10-char minimum) to decide when the address checkmark shows.
  const [addressPicked, setAddressPicked] = useState(false);

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ── Field-level validation state ─────────────────────────────────
  // Tracks which required fields are missing after a submit attempt.
  // Used by FormSection (red label + inline error message) and inputs
  // (red border via inline style). Once the user starts typing/picking
  // in a flagged field, it's removed from this set so the highlight
  // clears immediately. Field IDs are arbitrary string keys.
  const [missingFields, setMissingFields] = useState<Set<string>>(new Set());
  function clearMissing(field: string) {
    setMissingFields((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  }
  // hasError(f) — true when this field is in the missing set. Inputs
  // call this to switch to the red border state.
  function hasError(field: string): boolean {
    return missingFields.has(field);
  }

  // ── Per-field "valid → show checkmark" flags ───────────────────────
  // Mirrors the mobile booking form: a green ✓ appears in a field once
  // its value is valid. Phone needs a real 10–15 digit number; text
  // fields need content (address needs 10+ chars or a dropdown pick);
  // time selects need a non-placeholder choice.
  const phoneValid = (() => {
    const d = phone.replace(/\D/g, '');
    return d.length >= 10 && d.length <= 15;
  })();
  const venueNameValid = venueName.trim() !== '';
  const venueAddressValid = addressPicked || venueAddress.trim().length >= 10;
  const startTimeValid = startTime !== '';
  const endTimeValid = endTime !== '';

  // Set duration — computed straight from the picked times so it shows
  // whenever both are selected, regardless of rate type. Times are
  // "HH:MM" 24h; an end at/before start wraps past midnight.
  const setDurationLabel = (() => {
    if (!startTime || !endTime) return null;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) mins += 24 * 60;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const hPart = h > 0 ? `${h} hr${h !== 1 ? 's' : ''}` : '';
    const mPart = m > 0 ? `${m} min` : '';
    return [hPart, mPart].filter(Boolean).join(' ');
  })();

  const [success, setSuccess] = useState(false);

  // Per-day data (rate overrides etc) — read once at mount
  const dayData: DayData = useMemo(
    () => bookingSettings.booking_days?.[dateKey] || {},
    [bookingSettings.booking_days, dateKey]
  );

  // Equipment options — ALL THREE are always shown to the booker so they
  // see every choice. We tag each with `supported` so the UI can mark
  // unsupported ones (the DJ doesn't bring that gear) and show an inline
  // "DJ won't bring this — pick another" message instead of a rate.
  //
  // Support rules:
  //   - sound_system  → DJ supports it if equip_full
  //   - decks_only    → DJ supports it if equip_full OR equip_decks
  //   - venue_provides → ALWAYS supported (DJ shows up empty-handed)
  const equipmentOptions = useMemo(() => {
    return [
      {
        value: 'sound_system',
        label: 'DJ Provides System + Decks',
        supported: !!bookingSettings.equip_full,
      },
      {
        value: 'decks_only',
        label: 'DJ Provides Decks',
        supported: !!(bookingSettings.equip_full || bookingSettings.equip_decks),
      },
      {
        value: 'venue_provides',
        label: 'Venue Provides All',
        supported: true,
      },
    ];
  }, [bookingSettings.equip_full, bookingSettings.equip_decks]);

  // Helper — is the currently-picked equipment supported by this DJ?
  const isEquipmentSupported = useMemo(() => {
    const opt = equipmentOptions.find((o) => o.value === equipment);
    return opt ? opt.supported : true;
  }, [equipment, equipmentOptions]);

  // Allow offers? Either the global rate type is 'offers', or this specific
  // day was overridden to offers in the day editor.
  const dayRateType = (dayData as DayData & { rateType?: string }).rateType;
  const allowOffers = bookingSettings.allow_offers
    || bookingSettings.global_rate_type === 'offers'
    || dayRateType === 'offers';

  // Rate info — recomputed whenever the inputs that affect it change
  const rateInfo = useMemo(
    () => computeRate(bookingSettings, dayData, equipment, startTime, endTime),
    [bookingSettings, dayData, equipment, startTime, endTime]
  );

  const isOffers = rateInfo.rateType === 'offers';
  const isHourly = rateInfo.rateType === 'hourly';

  // Discount layer — applies only to a real computed rate (not offers/quote).
  // Better of an active sale and the applied promo code wins (no stacking).
  const displayTotal = !isOffers && rateInfo.rate != null
    ? (rateInfo.rateType === 'hourly' && rateInfo.hourlyTotal != null
        ? rateInfo.hourlyTotal
        : Number(rateInfo.rate))
    : null;
  const saleOn = isSaleActive(bookingSettings.sale);
  const hasActiveCode = (bookingSettings.promo_codes || []).some((p) => isPromoUsable(p));
  const clubDiscount: DiscountResult = useMemo(() => {
    if (displayTotal == null) return { amount: 0, kind: null, label: '' };
    return computeDiscount(displayTotal, bookingSettings, appliedCode);
  }, [displayTotal, bookingSettings, appliedCode]);
  const discountedTotal = displayTotal != null ? Math.max(0, displayTotal - clubDiscount.amount) : null;

  // Deposit — the DJ's standing club deposit % (set in Booking Settings).
  // Applied to the final price the booker pays (discounted total if any,
  // else the plain total). Shown on the form and stored on the booking so
  // it carries into the contract.
  // Sales tax first (post-discount price), then the tax-inclusive total.
  const taxEnabled = !!(bookingSettings as { tax_enabled?: boolean }).tax_enabled;
  const taxPct = taxEnabled ? ((bookingSettings as { tax_pct?: number }).tax_pct || 0) : 0;
  const taxBase = discountedTotal != null ? discountedTotal : displayTotal;
  // Cents, not whole dollars — must match the server (which stores this) and
  // the mobile form. Math.round() here made $1,320 @ 4.5% preview as $59
  // while the DB recorded $59.40.
  const taxAmount = (taxPct > 0 && taxBase != null)
    ? Number(((taxBase * taxPct) / 100).toFixed(2))
    : 0;
  const grandTotal = taxBase != null ? taxBase + taxAmount : null;

  // Deposit % is taken on the tax-inclusive total.
  const clubDepositPct = (bookingSettings as { club_deposit_pct?: number }).club_deposit_pct || 0;
  const depositBase = grandTotal;
  const depositAmount = (clubDepositPct > 0 && depositBase != null)
    ? Number(((depositBase * clubDepositPct) / 100).toFixed(2))
    : 0;
  const depositBalance = depositBase != null ? Math.max(0, Number((depositBase - depositAmount).toFixed(2))) : null;

  function applyClubPromo() {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    const match = (bookingSettings.promo_codes || []).find(
      (p) => (p.code || '').trim().toUpperCase() === code && isPromoUsable(p)
    );
    if (match) { setAppliedCode(code); setPromoError(''); }
    else { setAppliedCode(''); setPromoError('Invalid or expired code'); }
  }

  // Quote mode — DJ has booking enabled and equipment picked, but no
  // rate configured for the picked equipment option (and they're not in
  // offers mode). The form stays open as a normal booking flow but
  // skips the rate display and flags the booking with is_quote=true so
  // the DJ can respond with a custom rate via the existing counter flow.
  // Triggered when: not offers mode AND equipment is supported AND no
  // matching rate field has a value > 0.
  const isQuoteMode = !isOffers && isEquipmentSupported && rateInfo.rate == null;

  // Show rate area only when we have enough info — equipment picked AND
  // both times set (vanilla parity). For offers, equipment + offerAmount
  // is enough; times are still required for the booking but rate display
  // doesn't change with them.
  const canShowRate = equipment && (isOffers || (startTime && endTime));

  // ── Submit ───────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Collect ALL missing required fields up front so the booker sees
    // every problem at once instead of having to fix → submit → fix
    // each one. The set drives both the top-of-form summary and the
    // per-field red-border / inline-error highlights.
    const missing = new Set<string>();
    if (!venueType) missing.add('venueType');
    if (!setType) missing.add('setType');
    if (!venueName.trim()) missing.add('venueName');
    if (!venueAddress.trim()) missing.add('venueAddress');
    // Name + email are only required when the account is missing them (phone
    // signups). Name must be a real first + last; email must be well-formed.
    if (needsFullName && !isFullName(normalizeName(fullName))) missing.add('fullName');
    if (needsEmail) {
      const em = contactEmail.trim();
      if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) missing.add('contactEmail');
    }
    if (!phone.trim()) missing.add('phone');
    if (!startTime) missing.add('startTime');
    if (!endTime) missing.add('endTime');
    if (!equipment) missing.add('equipment');
    if (isOffers && !offerAmount.trim()) missing.add('offerAmount');

    if (missing.size > 0) {
      setMissingFields(missing);
      // Top-of-form banner reads directly from missingFields.size — no
      // duplicate error text. setError stays null so the bottom area
      // remains clean (it's reserved for non-field errors like the
      // equipment compatibility check or network failures).
      // Scroll the first missing field into view so the booker isn't
      // confused about WHERE the highlights are.
      const firstFieldId = (() => {
        // Order matches the form layout top → bottom for natural scroll
        const order = ['venueType','setType','venueName','venueAddress','fullName','contactEmail','phone','startTime','endTime','equipment','offerAmount'];
        for (const f of order) {
          if (missing.has(f)) return f;
        }
        return null;
      })();
      if (firstFieldId) {
        // Defer to next paint so the new error UI is in the DOM
        setTimeout(() => {
          const el = document.querySelector(`[data-field="${firstFieldId}"]`);
          if (el && 'scrollIntoView' in el) {
            (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 50);
      }
      return;
    }

    // Equipment-supported check happens AFTER all required fields are
    // filled — it's not a "missing field" in the same sense, more a
    // compatibility error, so keep it as a top-level error message.
    if (!isEquipmentSupported) {
      setError('This DJ isn\'t able to bring that equipment. Please pick another option.');
      return;
    }

    // Offers mode — the offer must be a real positive amount. The old
    // `offerNum && !isNaN(offerNum)` check let negative offers through;
    // the server route now rejects those too — this check just surfaces
    // the error before the round-trip.
    if (isOffers) {
      const offerNum = Number(offerAmount.trim());
      if (!Number.isFinite(offerNum) || offerNum <= 0) {
        setError('Please enter a valid offer amount greater than 0.');
        return;
      }
      if (offerNum > 1000000) {
        setError('Offer amount is too large. Please enter a realistic offer.');
        return;
      }
    }

    setSubmitting(true);
    try {
      // Recompute the total the same way the on-screen preview does — sent
      // ONLY as expectedTotal so the server can detect price drift. The
      // /api/bookings/create route recomputes ALL money fields (rate,
      // discount, deposit, negotiation-log seed) from the DJ's own
      // booking_settings and is the sole authority for what gets stored.
      const computedTotal = !isOffers && rateInfo.rate
        ? (rateInfo.rateType === 'hourly' && rateInfo.hourlyTotal
            ? rateInfo.hourlyTotal
            : rateInfo.rate)
        : null;
      const clubFinalDiscount: DiscountResult = computedTotal != null
        ? computeDiscount(Number(computedTotal), bookingSettings, appliedCode)
        : { amount: 0, kind: null, label: '' };
      const computedTotalDiscounted = computedTotal != null
        ? Math.max(0, Number(computedTotal) - clubFinalDiscount.amount)
        : null;

      const res = await fetch('/api/bookings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingType: 'club',
          djId: dj.id,
          dateKey,
          country,
          venueType,
          setType,
          venueName: venueName.trim(),
          venueAddress: venueAddress.trim(),
          phone: phone.trim(),
          // Only sent when the account has none. The server writes it to
          // users.contact_email so every later email (contract, planner,
          // cancellation) has somewhere to go.
          contactEmail: needsEmail ? contactEmail.trim().toLowerCase() : null,
          // Only sent when the stored name was incomplete. The server stores
          // it on the booking (requester_name) — not your account — so the
          // contract has a full name without changing your profile.
          fullName: needsFullName ? normalizeName(fullName) : null,
          // Coords from a Nominatim suggestion the booker picked. Null when
          // they typed freehand or the search returned nothing. The
          // booking-requests card uses these for the venue distance check.
          venueLat: venueCoordsRef.current?.lat ?? null,
          venueLon: venueCoordsRef.current?.lon ?? null,
          startTime,
          endTime,
          equipment,
          venueEquipDetail,
          offerAmount,
          promoCode: appliedCode,
          notes,
          // Preview total — server-verified, never stored as-is. A 409
          // below means pricing changed while the form was open.
          expectedTotal: computedTotalDiscounted,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json && typeof json.error === 'string' && json.error) || 'Failed to submit booking.'
        );
      }
      // Server-computed money snapshot — used for the emails below so they
      // always match what was actually stored on the booking row.
      const created: {
        offer_amount: number | null;
        quoted_rate: number | null;
        original_rate: number | null;
        discount_label: string | null;
        discount_amount: number | null;
      } = json.booking;

      // Notify the DJ — fire-and-forget. Failures don't block the success
      // state since the booking is already saved.
      try {
        await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'booking_request',
            djUserId: dj.id,
            djName: dj.name,
            requesterName: normalizeName(fullName) || currentUser.name,
            eventDate: dateKey,
            venueName: venueName.trim(),
            venueAddress: venueAddress.trim(),
            venueType,
            setType,
            startTime,
            endTime,
            equipment,
            notes: notes.trim() || null,
            offerAmount: created.offer_amount,
            quotedRate: created.quoted_rate,
            originalRate: created.original_rate,
            discountLabel: created.discount_label,
            discountAmount: created.discount_amount,
            totalHours: rateInfo.hours,
            // Per-hour rate — only meaningful for hourly bookings; lets the
            // email show "$330/hr × 3 hr" alongside the total.
            hourlyRate: rateInfo.rateType === 'hourly' ? rateInfo.rate : null,
            currency: rateInfo.currency,
          }),
        });
      } catch {
        // Email is best-effort; ignore failures
      }

      // Confirmation copy to the booker — gives them a record of the
      // request they just sent and confirms it landed. Same info-card
      // layout as the DJ-side notification for visual consistency.
      try {
        await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'booking_request_confirmation',
            requesterUserId: currentUser.id,
            requesterName: normalizeName(fullName) || currentUser.name,
            djName: dj.name,
            eventDate: dateKey,
            venueName: venueName.trim(),
            venueAddress: venueAddress.trim(),
            venueType,
            setType,
            startTime,
            endTime,
            equipment,
            offerAmount: created.offer_amount,
            quotedRate: created.quoted_rate,
            originalRate: created.original_rate,
            discountLabel: created.discount_label,
            discountAmount: created.discount_amount,
            totalHours: rateInfo.hours,
            hourlyRate: rateInfo.rateType === 'hourly' ? rateInfo.rate : null,
            currency: rateInfo.currency,
          }),
        });
      } catch {
        // Best-effort
      }

      setSuccess(true);
      // Auto-dismiss the form after a short delay
      setTimeout(() => onClose(), 2500);
    } catch (err) {
      console.error('club booking submit failed', err);
      const msg = err instanceof Error ? err.message : 'Failed to submit booking.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success state ────────────────────────────────────────────────
  if (success) {
    if (!mounted) return null;
    return createPortal(
      <div className={styles.formWrap}>
        <div className={styles.successCard}>
          <div className={styles.successIcon}>✓</div>
          <div className={styles.successTitle}>Booking request sent!</div>
          <div className={styles.successBody}>
            We&apos;ve sent your request to {dj.name || 'the DJ'}.
            They&apos;ll be in touch shortly.
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // ── Form UI ──────────────────────────────────────────────────────
  if (!mounted) return null;
  return createPortal(
    <form onSubmit={handleSubmit} className={styles.formWrap}>
      <div className={styles.formCard}>
        {/* Header */}
        <div className={styles.formHeader}>
          <div>
            <div className={styles.formHeaderEyebrow}>Booking Request</div>
            <div className={styles.formHeaderDate}>{formatLongDate(dateKey)}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={styles.formCloseBtn}
            aria-label="Close booking form"
          >
            ✕
          </button>
        </div>

        {/* Top-of-form summary for missing-required-fields validation.
            The booker needs to see this BEFORE scrolling through the
            fields, since the inline highlights are below. Non-field
            errors (equipment-not-supported, submit network failures)
            still render in the submit area below. */}
        {missingFields.size > 0 && (
          <div style={{
            background: 'rgba(255, 95, 95, .08)',
            border: '1px solid rgba(255, 95, 95, .35)',
            borderRadius: 6,
            padding: '.6rem .8rem',
            color: '#ff5f5f',
            fontSize: '.82rem',
            fontFamily: 'DM Sans, sans-serif',
            marginBottom: '.75rem',
          }}>
            {missingFields.size === 1
              ? 'Please complete the highlighted field below.'
              : `Please complete the ${missingFields.size} highlighted fields below.`}
          </div>
        )}

        {/* Event Type */}
        <FormSection
          label="Event Type"
          fieldKey="venueType"
          hasError={hasError('venueType')}
          errorText="Please select Bar or Club."
          showCheck={venueType !== ''}
        >
          <div className={styles.pillRow}>
            {(['bar', 'club'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => { setVenueType(v); clearMissing('venueType'); }}
                className={`${styles.pill} ${venueType === v ? styles.pillActive : ''}`}
              >
                {CLUB_VENUE_TYPE_LABELS[v]}
              </button>
            ))}
          </div>
        </FormSection>

        {/* Set Type — only after venue type picked */}
        {venueType && (
          <FormSection
            label="Set Type"
            fieldKey="setType"
            hasError={hasError('setType')}
            errorText="Please select a set type."
          >
            <FieldCheck valid={setType !== ''}>
              <select
                value={setType}
                onChange={(e) => { setSetType(e.target.value); clearMissing('setType'); }}
                className={`${styles.input} ${styles.hasCheckSelect}`}
                style={hasError('setType') ? { borderColor: '#ff5f5f' } : undefined}
              >
                <option value="">Select…</option>
                {Object.entries(CLUB_SET_TYPE_LABELS).map(([val, lbl]) => (
                  <option key={val} value={val}>{lbl}</option>
                ))}
              </select>
            </FieldCheck>
          </FormSection>
        )}

        {/* Venue */}
        <FormSection
          label="Venue"
          fieldKey="venueName"
          hasError={hasError('venueName') || hasError('venueAddress')}
          errorText={
            hasError('venueName') && hasError('venueAddress')
              ? 'Please enter the venue name and address.'
              : hasError('venueName')
                ? 'Please enter the venue name.'
                : 'Please enter the venue address.'
          }
        >
          <FieldCheck valid={venueNameValid}>
            <input
              type="text"
              placeholder="Venue name"
              value={venueName}
              onChange={(e) => { setVenueName(e.target.value); clearMissing('venueName'); }}
              className={`${styles.input} ${styles.hasCheck}`}
              style={hasError('venueName') ? { borderColor: '#ff5f5f' } : undefined}
            />
          </FieldCheck>
          {/* Address with compact country picker pill on the right.
              Picking a country first scopes the address autocomplete. */}
          <div className={styles.addrRow} style={{ marginTop: '.5rem' }}>
            <div className={styles.addrInputWrap}>
              <input
                type="text"
                placeholder="Venue address"
                value={venueAddress}
                onChange={(e) => {
                  const val = e.target.value;
                  setVenueAddress(val);
                  clearMissing('venueAddress');
                  venueCoordsRef.current = null;
                  setAddressPicked(false);
                  if (addrTimerRef.current) clearTimeout(addrTimerRef.current);
                  if (val.trim().length < 3) {
                    setAddrSuggestions([]);
                    setShowAddrSuggestions(false);
                    return;
                  }
                  addrTimerRef.current = setTimeout(async () => {
                    const results = await searchAddresses(val.trim(), country);
                    setAddrSuggestions(results);
                    setShowAddrSuggestions(results.length > 0);
                  }, 350);
                }}
                onBlur={() => {
                  setTimeout(() => setShowAddrSuggestions(false), 150);
                }}
                onFocus={() => {
                  if (addrSuggestions.length > 0) setShowAddrSuggestions(true);
                }}
                className={`${styles.input} ${styles.hasCheck}`}
                style={hasError('venueAddress') ? { borderColor: '#ff5f5f' } : undefined}
                autoComplete="off"
              />
              {venueAddressValid && (
                <span className={styles.fieldCheckMark} aria-hidden="true">✓</span>
              )}
              {showAddrSuggestions && addrSuggestions.length > 0 && (
                <div className={styles.addrSuggestions}>
                  {addrSuggestions.map((s, i) => (
                    <div
                      key={i}
                      className={styles.addrSuggestion}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setVenueAddress(s.display);
                        setAddressPicked(true);
                        if (s.lat != null && s.lon != null) {
                          venueCoordsRef.current = { lat: s.lat, lon: s.lon };
                        } else {
                          venueCoordsRef.current = null;
                        }
                        setShowAddrSuggestions(false);
                        clearMissing('venueAddress');
                      }}
                    >
                      {s.display}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <CountryPicker
              value={country}
              onChange={(code) => {
                setCountry(code);
                setAddrSuggestions([]);
                setShowAddrSuggestions(false);
                venueCoordsRef.current = null;
              }}
            />
          </div>
        </FormSection>

        {/* Times */}
        <FormSection
          label="Set Times"
          fieldKey="startTime"
          hasError={hasError('startTime') || hasError('endTime')}
          errorText={
            hasError('startTime') && hasError('endTime')
              ? 'Please select start and end times.'
              : hasError('startTime')
                ? 'Please select a start time.'
                : 'Please select an end time.'
          }
        >
          <div className={styles.timeRow}>
            <div className={styles.timeCol}>
              <label className={styles.timeLabel}><span className={styles.timeLabelHl}>Set</span> Start</label>
              <FieldCheck valid={startTimeValid}>
                <select
                  value={startTime}
                  onChange={(e) => { setStartTime(e.target.value); clearMissing('startTime'); }}
                  className={`${styles.input} ${styles.hasCheckSelect}`}
                  style={hasError('startTime') ? { borderColor: '#ff5f5f' } : undefined}
                >
                  <option value="">Select…</option>
                  {MOB_TIME_OPTIONS.map((t) => (
                    <option key={t.val} value={t.val}>{t.label}</option>
                  ))}
                </select>
              </FieldCheck>
            </div>
            <div className={styles.timeCol}>
              <label className={styles.timeLabel}><span className={styles.timeLabelHl}>Set</span> End</label>
              <FieldCheck valid={endTimeValid}>
                <select
                  value={endTime}
                  onChange={(e) => { setEndTime(e.target.value); clearMissing('endTime'); }}
                  className={`${styles.input} ${styles.hasCheckSelect}`}
                  style={hasError('endTime') ? { borderColor: '#ff5f5f' } : undefined}
                >
                  <option value="">Select…</option>
                  {MOB_TIME_OPTIONS.map((t) => (
                    <option key={t.val} value={t.val}>{t.label}</option>
                  ))}
                </select>
              </FieldCheck>
            </div>
          </div>
          {/* Set duration — shows as soon as both times are picked. */}
          {setDurationLabel && (
            <div className={styles.durationHint}>
              {formatTime12(startTime)} → {formatTime12(endTime)} ({setDurationLabel})
            </div>
          )}
          {/* Overlap warning — chosen times collide with a booked set.
              Heads-up only; the booking is still allowed to go through. */}
          {overlappingSets.map((b, i) => (
            <div key={`ov-${i}`} className={styles.overlapWarn}>
              Chosen Time Overlaps {formatTime12(b.start || '')} – {formatTime12(b.end || '')} Booking
            </div>
          ))}
        </FormSection>

        {/* Equipment */}
        <FormSection
          label="Equipment for venue"
          fieldKey="equipment"
          hasError={hasError('equipment')}
          errorText="Please select an equipment option."
          showCheck={equipment !== ''}
        >
          <div className={styles.equipCol}>
            {equipmentOptions.map((opt) => {
              const isActive = equipment === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { setEquipment(opt.value); clearMissing('equipment'); }}
                  className={`${styles.equipBtn} ${isActive ? styles.pillActive : ''} ${
                    !opt.supported ? styles.pillUnsupported : ''
                  }`}
                  // Always allow click — the warning below explains the
                  // problem rather than silently disabling the option,
                  // which matches the requested UX.
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Inline warning when the booker picks something the DJ can't
              fulfill. Message names the DJ + the gear they can't bring,
              so the user knows exactly what's not possible. Submitting
              is blocked too — see handleSubmit. */}
          {equipment && !isEquipmentSupported && (
            <div className={styles.equipWarning}>
              {dj.name || 'This DJ'} is unable to provide{' '}
              {equipment === 'sound_system'
                ? 'a full sound system and decks'
                : 'decks/controller'}
              . Please pick a different option below.
            </div>
          )}

          {equipment === 'venue_provides' && (
            <input
              type="text"
              placeholder="Describe provided equipment (optional)"
              value={venueEquipDetail}
              onChange={(e) => setVenueEquipDetail(e.target.value)}
              className={styles.input}
              style={{ marginTop: '.5rem' }}
            />
          )}
        </FormSection>

        {/* Rate — always rendered. Inside, the content branches on form
            completeness: a calculating placeholder while required fields
            are missing, a quote-mode message when the DJ has no rate for
            the picked equipment, an equipment-unsupported notice, or the
            real rate display when everything's filled in. */}
        <FormSection
          label="Rate"
          fieldKey="offerAmount"
          hasError={isOffers && hasError('offerAmount')}
          errorText="Please enter your offer amount."
        >
          {(() => {
            // Path 1 — full rate display ready to render
            if (canShowRate && isEquipmentSupported && !isQuoteMode) {
              return (
                <>
                <RateDisplay
                  info={rateInfo}
                  allowOffers={allowOffers && !isOffers}
                  isOffersOnly={isOffers}
                  offerAmount={offerAmount}
                  setOfferAmount={(v) => { setOfferAmount(v); clearMissing('offerAmount'); }}
                  offerHasError={isOffers && hasError('offerAmount')}
                  baseRate={
                    (dayData as DayData & { base_rate?: number | string }).base_rate
                      || bookingSettings.base_rate
                      || rateInfo.rate
                  }
                />
                {!isOffers && displayTotal != null && (clubDiscount.amount > 0 || saleOn || hasActiveCode) && (
                  <div style={{ marginTop: 10, textAlign: 'center' }}>
                    {/* Discount summary — shown once, on top */}
                    {clubDiscount.amount > 0 && (
                      <div style={{ color: 'var(--neon,#00e0a4)', fontSize: '.9rem', fontWeight: 700, marginBottom: 6 }}>
                        {clubDiscount.label} — you save {currencySymbol(bookingSettings.rate_currency || 'USD')}{clubDiscount.amount.toLocaleString()}
                      </div>
                    )}
                    {clubDiscount.amount > 0 && discountedTotal != null && (
                      <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                        <span style={{ textDecoration: 'line-through', opacity: 0.5, fontSize: '.75em', marginRight: 8 }}>
                          {currencySymbol(bookingSettings.rate_currency || 'USD')}{displayTotal.toLocaleString()}
                        </span>
                        <span style={{ color: 'var(--neon,#00e0a4)' }}>
                          {currencySymbol(bookingSettings.rate_currency || 'USD')}{discountedTotal.toLocaleString()}
                        </span>
                      </div>
                    )}
                    {hasActiveCode && (
                      <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <input
                          type="text"
                          value={promoInput}
                          onChange={(e) => { setPromoInput(e.target.value.toUpperCase()); setPromoError(''); }}
                          placeholder="Promo code"
                          style={{ textTransform: 'uppercase', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border,rgba(255,255,255,.25))', background: 'transparent', color: 'inherit', maxWidth: 150 }}
                        />
                        <button type="button" onClick={applyClubPromo} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--neon,#00e0a4)', background: 'transparent', color: 'var(--neon,#00e0a4)', cursor: 'pointer', fontSize: '.8rem' }}>Apply</button>
                        {appliedCode && clubDiscount.kind === 'code' && <span style={{ color: 'var(--neon,#00e0a4)', fontSize: '.8rem' }}>✓ Applied</span>}
                        {appliedCode && clubDiscount.kind === 'sale' && <span style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.75rem' }}>Sale price is better — applied</span>}
                        {promoError && <span style={{ color: '#ff6b6b', fontSize: '.8rem' }}>{promoError}</span>}
                      </div>
                    )}
                  </div>
                )}
                {/* Itemized breakdown — Total set off, deposit/balance below. */}
                {!isOffers && discountedTotal != null && grandTotal != null && (taxPct > 0 || clubDepositPct > 0) && (
                  <div style={{ maxWidth: 260, margin: '12px auto 0', textAlign: 'left' }}>
                    {taxPct > 0 && (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', color: 'var(--white,#fff)', padding: '3px 0' }}>
                          <span>Subtotal</span><span>{currencySymbol(bookingSettings.rate_currency || 'USD')}{discountedTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', color: 'var(--white,#fff)', padding: '3px 0' }}>
                          <span>Tax ({taxPct.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })}%)</span><span>{currencySymbol(bookingSettings.rate_currency || 'USD')}{taxAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      </>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '1.2rem', fontWeight: 800, color: 'var(--neon,#00e0a4)', borderTop: '1px solid var(--border,rgba(255,255,255,.2))', paddingTop: 8, marginTop: 6, paddingBottom: 10, borderBottom: '1px solid var(--border,rgba(255,255,255,.2))', marginBottom: 10 }}>
                      <span>Total</span><span>{currencySymbol(bookingSettings.rate_currency || 'USD')}{grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    {clubDepositPct > 0 && (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', color: 'var(--white,#fff)', padding: '3px 0' }}>
                          <span>Deposit ({clubDepositPct}%)</span><span>{currencySymbol(bookingSettings.rate_currency || 'USD')}{depositAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        {depositBalance != null && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', color: 'var(--white,#fff)', padding: '3px 0' }}>
                            <span>Balance due day of event</span><span>{currencySymbol(bookingSettings.rate_currency || 'USD')}{depositBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
                </>
              );
            }
            // Path 2 — DJ has no rate configured for this equipment.
            // Booking goes through as a quote; DJ replies with custom
            // pricing through the counter flow.
            if (equipment && isEquipmentSupported && isQuoteMode) {
              return (
                <div className={styles.rateBox}>
                  <div className={styles.rateOffersHint}>
                    Rate not yet configured for this option — the DJ will
                    reply with a quote after you submit.
                  </div>
                </div>
              );
            }
            // Path 3 — equipment picked but DJ can't bring it. The
            // pillUnsupported warning above already explains; just keep
            // the rate box empty-stated here.
            if (equipment && !isEquipmentSupported) {
              return (
                <div className={styles.rateBox}>
                  <div className={styles.rateOffersHint} style={{ color: 'var(--amber)' }}>
                    Pick a supported equipment option above to see the rate.
                  </div>
                </div>
              );
            }
            // Path 4 — required fields aren't all filled yet. Show a
            // calm, static "we're waiting on you" message so the booker
            // knows the price will appear here. No animation.
            return (
              <div className={styles.rateBox}>
                <div style={{
                  padding: '1.1rem .5rem',
                  textAlign: 'center',
                }}>
                  <div style={{
                    color: 'var(--neon)',
                    fontSize: '.8rem',
                    lineHeight: 1.5,
                    fontFamily: 'DM Sans, sans-serif',
                  }}>
                    Once all required fields are populated, the estimated
                    price will display here.
                  </div>
                </div>
              </div>
            );
          })()}
        </FormSection>

        {/* Your Name — the contract names two parties, and this is the last
            moment the host is here to supply a surname. Plain field only when
            the account's stored name is missing one; complete names skip it. */}
        {needsFullName && (
          <FormSection
            label="Your Name"
            fieldKey="fullName"
            hasError={hasError('fullName')}
            errorText={FULL_NAME_ERROR}
          >
            <FieldCheck valid={fullNameValid}>
              <input
                type="text"
                placeholder="Jane Smith"
                value={fullName}
                onChange={(e) => { setFullName(e.target.value); clearMissing('fullName'); }}
                className={`${styles.input} ${styles.hasCheck}`}
                style={hasError('fullName') ? { borderColor: '#ff5f5f' } : undefined}
                autoComplete="name"
              />
            </FieldCheck>
          </FormSection>
        )}

        {/* Email — ONLY for accounts that don't have one (phone signups).
            Everything after this booking is an email; without an address the
            host would book and then never hear from anyone again. */}
        {needsEmail && (
          <FormSection
            label="Email Address"
            fieldKey="contactEmail"
            hasError={hasError('contactEmail')}
            errorText="Please enter a valid email for your booking documents."
          >
            <FieldCheck valid={emailValid}>
              <input
                type="email"
                inputMode="email"
                placeholder="your@email.com"
                value={contactEmail}
                onChange={(e) => { setContactEmail(e.target.value); clearMissing('contactEmail'); }}
                className={`${styles.input} ${styles.hasCheck}`}
                style={hasError('contactEmail') ? { borderColor: '#ff5f5f' } : undefined}
                autoComplete="email"
              />
            </FieldCheck>
          </FormSection>
        )}

        {/* Phone — shown as plain text (label + number on ONE line) when
            we already have it from the account, matching MobileBookingForm:
            an empty-looking input next to a number the host just proved they
            own reads as another chore. Only a host with no stored number
            gets the editable field. */}
        {knownPhone ? (
          <div className={styles.section}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
              <div className={styles.sectionLabel} style={{ marginBottom: 0 }}>Phone Number</div>
              <div style={{ color: 'var(--white,#fff)', fontSize: '.95rem', fontWeight: 600 }}>
                {phone}
              </div>
            </div>
          </div>
        ) : (
          <FormSection
            label="Phone Number"
            fieldKey="phone"
            hasError={hasError('phone')}
            errorText="Please enter your phone number."
          >
            <FieldCheck valid={phoneValid}>
              <input
                id="cbf-phone"
                type="tel"
                inputMode="tel"
                placeholder="(555) 555-5555"
                value={phone}
                onChange={(e) => { setPhone(formatUSPhone(e.target.value)); clearMissing('phone'); }}
                className={`${styles.input} ${styles.hasCheck}`}
                style={hasError('phone') ? { borderColor: '#ff5f5f' } : undefined}
                autoComplete="tel"
              />
            </FieldCheck>
          </FormSection>
        )}

        {/* Notes */}
        <FormSection label="Notes (optional)">
          <textarea
            placeholder="Anything the DJ should know about the event…"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={styles.textarea}
          />
        </FormSection>

        {/* Submit */}
        <div className={styles.submitArea}>
          {error && <div className={styles.errorMsg}>{error}</div>}
          <button
            type="submit"
            disabled={submitting}
            className={styles.submitBtn}
          >
            {submitting ? 'Sending…' : 'Request Booking'}
          </button>
        </div>
      </div>
    </form>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// FormSection — small wrapper that gives each section its own padded card
// row + label. Mirrors the look of the vanilla form.
// ─────────────────────────────────────────────────────────────────────────
function FormSection({
  label, children, hasError, fieldKey, errorText, showCheck,
}: {
  label: string;
  children: React.ReactNode;
  // When true, label turns red. Set by parent based on missing-fields set.
  hasError?: boolean;
  // Used by handleSubmit's scroll-to-first-error logic to find the section.
  fieldKey?: string;
  // Optional inline message rendered below children when hasError is true.
  errorText?: string;
  // When true, a green ✓ shows on the label line — used for pill-based
  // sections (Event Type, Set Type) where the check can't sit in a field.
  showCheck?: boolean;
}) {
  return (
    <div className={styles.section} data-field={fieldKey}>
      <div
        className={styles.sectionLabel}
        style={
          hasError
            ? { color: '#ff5f5f' }
            : showCheck
              ? { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }
              : undefined
        }
      >
        <span>{label}{hasError && ' *'}</span>
        {showCheck && !hasError && (
          <span className={styles.labelCheckMark} aria-hidden="true">✓</span>
        )}
      </div>
      {children}
      {hasError && errorText && (
        <div style={{
          marginTop: '.4rem',
          color: '#ff5f5f',
          fontSize: '.78rem',
          fontFamily: 'DM Sans, sans-serif',
        }}>
          {errorText}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// RateDisplay — shows rate amount + (for hourly) the running total. For
// offers mode, shows an input for the visitor's offer amount.
// ─────────────────────────────────────────────────────────────────────────
function RateDisplay({
  info,
  allowOffers,
  isOffersOnly,
  offerAmount,
  setOfferAmount,
  offerHasError,
  baseRate,
}: {
  info: RateInfo;
  allowOffers: boolean;
  isOffersOnly: boolean;
  offerAmount: string;
  setOfferAmount: (v: string) => void;
  offerHasError?: boolean;
  baseRate: number | string | null | undefined;
}) {
  const { rate, symbol, currency, hourlyTotal, hours, label, rateType } = info;
  const isHourly = rateType === 'hourly';

  // Offers-only mode (DJ has no fixed rate): show an offer input + base rate
  if (isOffersOnly) {
    const baseRateNum = baseRate != null && baseRate !== '' ? Number(baseRate) : null;
    return (
      <div className={styles.rateBox}>
        {baseRateNum && !isNaN(baseRateNum) && (
          <>
            <div className={styles.rateLabelMini}>Base Rate</div>
            <div className={styles.rateValueLarge}>
              {symbol}{baseRateNum.toLocaleString()}{' '}
              <span className={styles.rateCurrency}>{currency}</span>
            </div>
          </>
        )}
        <div className={styles.rateOffersHint}>
          This DJ accepts offers
          {baseRateNum ? ' — enter an amount at or above the base rate' : ''}:
        </div>
        <div className={styles.offerInputRow}>
          <span className={styles.offerSymbol}>{symbol}</span>
          <input
            type="number"
            min={baseRateNum || 0}
            placeholder="Your offer"
            value={offerAmount}
            onChange={(e) => setOfferAmount(e.target.value)}
            className={styles.offerInput}
            style={offerHasError ? { borderColor: '#ff5f5f' } : undefined}
          />
        </div>
      </div>
    );
  }

  // Flat / Hourly with a configured rate
  if (rate != null) {
    return (
      <div className={styles.rateBox}>
        <div className={styles.rateLabelMini}>{label}</div>
        <div className={styles.rateValueLarge}>
          {symbol}{rate.toLocaleString()}{' '}
          <span className={styles.rateCurrency}>
            {currency}{isHourly ? '/hr' : ''}
          </span>
        </div>
        {isHourly && hourlyTotal != null && hours != null && (
          <div className={styles.rateTotalRow}>
            <span className={styles.rateTotalLabel}>
              {hours % 1 === 0 ? hours : hours.toFixed(1)} hr{hours !== 1 ? 's' : ''} × {symbol}{rate.toLocaleString()}/{currency}
            </span>
            <span className={styles.rateTotalValue}>
              {symbol}{hourlyTotal.toLocaleString(undefined, {
                minimumFractionDigits: 0, maximumFractionDigits: 2,
              })}{' '}
              <span className={styles.rateCurrency}>{currency}</span>
            </span>
          </div>
        )}
        {/* If DJ accepts offers in addition to flat rate, allow visitor
            to submit an offer instead. */}
        {allowOffers && (
          <div className={styles.offerInputRow} style={{ marginTop: '.65rem' }}>
            <span className={styles.offerSymbol}>{symbol}</span>
            <input
              type="number"
              min={0}
              placeholder="Or submit an offer"
              value={offerAmount}
              onChange={(e) => setOfferAmount(e.target.value)}
              className={styles.offerInput}
            />
          </div>
        )}
      </div>
    );
  }

  // No rate configured — fall back to a generic "request a quote" message
  return (
    <div className={styles.rateBox}>
      <div className={styles.rateOffersHint}>
        Rate not yet configured for this option — the DJ will reply with a quote.
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// CountryPicker — compact flag + ISO-code pill that opens a dropdown
// for picking the country that scopes address autocomplete.
// ──────────────────────────────────────────────────────────────────────────
const COUNTRIES: { code: string; name: string; flag: string }[] = [
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'ES', name: 'Spain', flag: '🇪🇸' },
  { code: 'IT', name: 'Italy', flag: '🇮🇹' },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪' },
  { code: 'NO', name: 'Norway', flag: '🇳🇴' },
  { code: 'DK', name: 'Denmark', flag: '🇩🇰' },
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
  { code: 'AE', name: 'UAE', flag: '🇦🇪' },
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
  { code: 'CH', name: 'Switzerland', flag: '🇨🇭' },
  { code: 'IE', name: 'Ireland', flag: '🇮🇪' },
];

function CountryPicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open]);

  const sel = COUNTRIES.find((c) => c.code === value) || COUNTRIES[0];

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: '0 0 auto' }}>
      <div
        className={styles.countryPill}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        title="Filter by country"
      >
        <span className={styles.flag}>{sel.flag}</span>
        <span className={styles.code}>{sel.code}</span>
        <span className={styles.caret}>▾</span>
      </div>
      {open && (
        <div className={styles.countryPopover}>
          {COUNTRIES.map((c) => (
            <div
              key={c.code}
              className={`${styles.countryItem} ${c.code === value ? styles.countryItemActive : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(c.code);
                setOpen(false);
              }}
            >
              <span className={styles.flag}>{c.flag}</span>
              <span className={styles.name}>{c.name}</span>
              <span className={styles.code}>{c.code}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// FieldCheck — wraps a form control and shows a green ✓ at its right edge
// once `valid` is true. Matches the mobile booking form's checkmark. The
// wrapper is position:relative; the control gets .hasCheck (text inputs)
// or .hasCheckSelect (native selects) so its text clears the mark.
function FieldCheck({
  valid,
  children,
}: {
  valid: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.fieldCheckWrap}>
      {children}
      {valid && (
        <span className={styles.fieldCheckMark} aria-hidden="true">✓</span>
      )}
    </div>
  );
}
