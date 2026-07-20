'use client';

// MobileBookingForm — booking-request form for mobile DJ profiles.
// Faithful port of vanilla djp-mob-public.js renderMobPubForm + submission
// logic (lines 709–1340).
//
// Renders as a centered popup modal (portaled to document.body), matching
// ClubBookingForm. The parent (MobilePublicCalendar) controls visibility
// by mounting/unmounting based on selectedDate, and provides onClose to
// dismiss. The X button in the header invokes onClose; backdrop click
// does NOT close (intentional — long forms shouldn't be lost by a stray
// tap), again matching ClubBookingForm.
//
// On submit, if the booker picked a Nominatim suggestion we capture the
// venue lat/lon and store them on the booking row. The DJ's booking-
// requests page (built in a later session) uses those coords + the DJ's
// own zip to flag out-of-range events. The booker is never warned —
// per Anthony's UX direction the warning is for the DJ only.
//
// DEFERRED:
//   - International phone formats (this session is US-only)
//   - mob_booking_request / mob_booking_confirm email types — these aren't
//     even in vanilla send-email.js (calls fail silently in prod). When the
//     email types are added in a later session, uncomment the fetch calls
//     near the bottom of handleSubmit. For now booking inserts succeed but
//     no email is sent — same behavior as vanilla.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './mobileBookingForm.module.css';
import {
  type BookingSettings,
  type MobilePackage,
  packageTiers,
  computeDiscount,
  isSaleActive,
  isPromoUsable,
  type DiscountResult,
} from './bookingSettings';
import {
  MOB_EVENT_TYPE_LABELS,
  EVENT_SUBFIELDS,
  buildEventDetails,
  MOB_TIME_OPTIONS,
  formatUSPhone,
  getPackageCategory,
  calcPrice,
  hoursBetween,
  halfHoursBetween,
  durationLabel,
  halfHourLabel,
  formatLongDate,
  searchAddresses,
  type AddressSuggestion,
} from './mobileBookingForm';

// Country list for the venue-address autocomplete scope — same set the
// homepage DJ search uses (idx-filters.js parity). Each entry pairs an
// ISO 3166-1 alpha-2 code (passed to Nominatim's countrycodes= param)
// with a flag emoji + display name. Dropdown shows "🇺🇸 US"; the booker
// picks the country first so address suggestions stay scoped to it.
const BOOKING_COUNTRIES: { code: string; flag: string; name: string }[] = [
  { code: 'us', flag: '🇺🇸', name: 'United States' },
  { code: 'gb', flag: '🇬🇧', name: 'United Kingdom' },
  { code: 'ca', flag: '🇨🇦', name: 'Canada' },
  { code: 'au', flag: '🇦🇺', name: 'Australia' },
  { code: 'de', flag: '🇩🇪', name: 'Germany' },
  { code: 'fr', flag: '🇫🇷', name: 'France' },
  { code: 'nl', flag: '🇳🇱', name: 'Netherlands' },
  { code: 'es', flag: '🇪🇸', name: 'Spain' },
  { code: 'it', flag: '🇮🇹', name: 'Italy' },
  { code: 'br', flag: '🇧🇷', name: 'Brazil' },
  { code: 'mx', flag: '🇲🇽', name: 'Mexico' },
  { code: 'jp', flag: '🇯🇵', name: 'Japan' },
  { code: 'za', flag: '🇿🇦', name: 'South Africa' },
  { code: 'nz', flag: '🇳🇿', name: 'New Zealand' },
  { code: 'ie', flag: '🇮🇪', name: 'Ireland' },
  { code: 'se', flag: '🇸🇪', name: 'Sweden' },
  { code: 'no', flag: '🇳🇴', name: 'Norway' },
  { code: 'dk', flag: '🇩🇰', name: 'Denmark' },
  { code: 'be', flag: '🇧🇪', name: 'Belgium' },
  { code: 'ch', flag: '🇨🇭', name: 'Switzerland' },
  { code: 'pt', flag: '🇵🇹', name: 'Portugal' },
];

interface DjLite {
  id: string;
  name: string | null;
  slug: string | null;
  event_types: string | null;  // comma-separated
  zip: string | null;          // for distance check
  travel_distance: string | null; // 'worldwide' or numeric miles
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
  onClose: () => void;
  // Fired once the booking row is successfully inserted — lets the parent
  // calendar refresh its pending-dates set so this date flips to "Pending".
  onSubmitted?: () => void;
}

export default function MobileBookingForm({
  dateKey,
  dj,
  bookingSettings,
  currentUser,
  onClose,
  onSubmitted,
}: Props) {
  // ── Form state ────────────────────────────────────────────────────
  const [phone, setPhone] = useState('');
  /**
   * Where this booking's paperwork gets sent.
   *
   * A host who signed up with a phone number has no email on their account,
   * and everything that happens after this form — the offer, the confirmation
   * with the bill, the contract to sign, the planner link, the cancellation
   * link — is an email. Without one they'd book successfully and then never
   * hear anything again, which is worse than not booking at all.
   *
   * So it's asked here, once, at the moment it actually buys them something.
   * Hosts who already have an email never see this field.
   */
  const [contactEmail, setContactEmail] = useState('');
  const needsEmail = !((currentUser.email || '').trim());
  const [eventType, setEventType] = useState('');
  // Promo code entry (client-typed). appliedCode is set only after a valid
  // code is confirmed via Apply; the actual discount is the better of an
  // active sale and the applied code (no stacking — see computeDiscount).
  const [promoInput, setPromoInput] = useState('');
  const [appliedCode, setAppliedCode] = useState('');
  const [promoError, setPromoError] = useState('');
  const [eventTypeOther, setEventTypeOther] = useState('');
  // Event-type-specific sub-fields (see EVENT_SUBFIELDS). subType covers the
  // six "Type of X" text fields; birthdayAge + surprise cover Birthday Party.
  const [eventSubType, setEventSubType] = useState('');
  const [birthdayAge, setBirthdayAge] = useState('');
  const [surprise, setSurprise] = useState(false);
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  // ISO alpha-2 country code scoping the venue-address autocomplete.
  // Defaults to 'us'; Nominatim suggestions are restricted to this country.
  const [venueCountry, setVenueCountry] = useState('us');
  const [room, setRoom] = useState('');
  const [guests, setGuests] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [message, setMessage] = useState('');

  // Cocktail-hour fields (all mobile events). For weddings the cocktail
  // prompt shows by default; for other events it's hidden behind an
  // "Add Cocktail Hour" link that expands the section.
  const [cocktailNeeded, setCocktailNeeded] = useState<boolean | null>(null);
  const [cocktailStart, setCocktailStart] = useState('');
  const [cocktailSameRoom, setCocktailSameRoom] = useState<boolean | null>(null);

  // Music-for-ceremony fields (weddings only). Independent add-on that
  // mirrors the cocktail-hour trio: needed? / start time / same room?
  const [ceremonyNeeded, setCeremonyNeeded] = useState<boolean | null>(null);
  const [ceremonyStart, setCeremonyStart] = useState('');
  const [ceremonySameRoom, setCeremonySameRoom] = useState<boolean | null>(null);

  // Package selection (index into packages array)
  const [selectedPkgIdx, setSelectedPkgIdx] = useState<number | null>(null);

  // Photo lightbox (when clicking a package thumbnail)
  const [photoLightboxUrl, setPhotoLightboxUrl] = useState<{ photos: string[]; details: string; active: number } | null>(null);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Id of the field that failed validation — drives scroll-to + a red
  // highlight ring so the booker is taken straight to what they missed.
  const [errorFieldId, setErrorFieldId] = useState<string | null>(null);
  const [successState, setSuccessState] = useState<{ isQuote: boolean } | null>(null);

  // ── Address autocomplete ─────────────────────────────────────────
  // Dropdown of Nominatim suggestions; coords stick to whichever one the
  // user picks (cleared if they type more after picking). Coords are
  // stored on the booking row so the DJ's booking-requests page can flag
  // out-of-range events — booker is never warned.
  const [addrSuggestions, setAddrSuggestions] = useState<AddressSuggestion[]>([]);
  const [showAddrSuggestions, setShowAddrSuggestions] = useState(false);
  const venueCoordsRef = useRef<{ lat: number; lon: number } | null>(null);
  // True once the booker selects an address from the autocomplete
  // dropdown. Used (alongside a 10-char minimum) to decide when the
  // address field's validity checkmark shows. Reset when they edit.
  const [addressPicked, setAddressPicked] = useState(false);
  const addrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── SSR-safe portal flag — Next.js renders on server where document
  // doesn't exist. Render null until mounted, then portal to body so
  // the modal escapes any parent stacking context. ──────────────────
  const rootRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // ── Derived data ─────────────────────────────────────────────────
  const dateLabel = formatLongDate(dateKey);
  const isWedding = eventType === 'weddings';
  // Cocktail hour is available for ALL mobile event types (not just weddings),
  // once an event type is chosen. isWedding is still used only for the
  // "Reception" vs "Event" time labels.
  const cocktailEligible = !!eventType;
  const eventTypesAllowed = useMemo(() => {
    return (dj.event_types || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }, [dj.event_types]);

  // Packages — picked by category, fall back to general[idx] for shared fields
  const cat = getPackageCategory(eventType);
  const packagesAll = bookingSettings.mob_packages || {};
  const categoryPkgs: MobilePackage[] = packagesAll[cat] || [];
  const generalPkgs: MobilePackage[] = packagesAll.general || [];

  // Has the DJ defined ANY usable package across ANY category? When false,
  // we treat the whole booking as a "request a quote" — no package selection,
  // no price, just the booker's event details + a message. The DJ will
  // respond with a price via their booking-requests page (eventually via
  // the Send Quote button — currently a placeholder).
  const hasAnyPackages = Object.values(packagesAll).some((arr) =>
    Array.isArray(arr) && arr.some((p) => p && p.title && p.title.trim())
  );

  // "Form is ready for package preview" — vanilla mobPubFormReady gate.
  // Note: this is what vanilla checks before showing packages, NOT what's
  // required for submit. Submit has its own validation below.
  const formReadyForPackages = !!(
    eventType && venueName.trim() && venueAddress.trim() && startTime && endTime
  );

  // Live price calculation when we have a package + times
  const selectedPkg =
    selectedPkgIdx != null ? categoryPkgs[selectedPkgIdx] : null;
  const depositPct = bookingSettings.mob_deposit_pct || 0;
  const wantsCocktail = isWedding && cocktailNeeded === true;
  const wantsCeremony = isWedding && ceremonyNeeded === true;
  const priceResult = useMemo(() => {
    if (!selectedPkg || !formReadyForPackages) return null;
    return calcPrice(selectedPkg, startTime, endTime, depositPct, wantsCocktail, cocktailStart, wantsCeremony);
  }, [selectedPkg, startTime, endTime, depositPct, formReadyForPackages, wantsCocktail, cocktailStart, wantsCeremony]);

  // Discount layer — applied on top of the computed price. Better of an active
  // sale and the applied promo code wins (no stacking). Deposit is taken from
  // the DISCOUNTED total.
  const saleOn = isSaleActive(bookingSettings.sale);
  const hasActiveCode = (bookingSettings.promo_codes || []).some((p) => isPromoUsable(p));
  const basePrice = priceResult?.price ?? null;
  const discount: DiscountResult = useMemo(() => {
    if (basePrice == null) return { amount: 0, kind: null, label: '' };
    return computeDiscount(basePrice, bookingSettings, appliedCode);
  }, [basePrice, bookingSettings, appliedCode]);
  const discountedTotal = basePrice != null ? Math.max(0, basePrice - discount.amount) : null;
  // Sales tax first (post-discount price), then the tax-inclusive total.
  const taxEnabled = !!(bookingSettings as { tax_enabled?: boolean }).tax_enabled;
  const taxPct = taxEnabled ? ((bookingSettings as { tax_pct?: number }).tax_pct || 0) : 0;
  const taxAmount = (taxPct > 0 && discountedTotal != null)
    ? Number(((discountedTotal * taxPct) / 100).toFixed(2))
    : 0;
  const grandTotal = discountedTotal != null ? discountedTotal + taxAmount : null;

  // Deposit taken on the tax-inclusive total.
  const discountedDeposit =
    grandTotal != null && depositPct > 0
      ? Number(((grandTotal * depositPct) / 100).toFixed(2))
      : null;

  // Show the itemized breakdown (Subtotal/Tax/Total…) when there's tax and/or
  // a deposit — otherwise the package price alone is the whole story.
  const showPriceBreakdown = !!priceResult && !priceResult.isQuote && priceResult.price != null
    && discountedTotal != null && grandTotal != null && (taxPct > 0 || depositPct > 0);

  function applyPromo() {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    const match = (bookingSettings.promo_codes || []).find(
      (p) => (p.code || '').trim().toUpperCase() === code && isPromoUsable(p)
    );
    if (match) {
      setAppliedCode(code);
      setPromoError('');
    } else {
      setAppliedCode('');
      setPromoError('Invalid or expired code');
    }
  }

  // Reset selected package when event type changes (vanilla parity —
  // line 874 of djp-mob-public.js sets mobPubSelectedPkg = null)
  useEffect(() => {
    setSelectedPkgIdx(null);
    setCocktailNeeded(null);
    setCeremonyNeeded(null);
    setCeremonyStart('');
    setCeremonySameRoom(null);
    // Clear event-type-specific sub-fields so stale values don't carry over
    // when the booker switches event type.
    setEventSubType('');
    setBirthdayAge('');
    setSurprise(false);
  }, [eventType]);

  // Cocktail-time warning: cocktail must start before reception
  const cocktailWarn =
    cocktailNeeded === true &&
    cocktailStart &&
    startTime &&
    cocktailStart >= startTime;

  // Clear the validation highlight once the booker fixes the flagged
  // field — keeps the red ring from lingering after they've filled it.
  useEffect(() => {
    if (!errorFieldId) return;
    const fixed =
      (errorFieldId === 'mpf-phone' && phone.trim()) ||
      (errorFieldId === 'mpf-event-type' && eventType) ||
      (errorFieldId === 'mpf-venue-name' && venueName.trim()) ||
      (errorFieldId === 'mpf-venue-address' && venueAddress.trim()) ||
      (errorFieldId === 'mpf-start-time' && startTime) ||
      (errorFieldId === 'mpf-cocktail-start' && !!cocktailStart && !cocktailWarn) ||
      (errorFieldId === 'mpf-cocktail-room' && cocktailSameRoom != null) ||
      (errorFieldId === 'mpf-ceremony-start' && !!ceremonyStart) ||
      (errorFieldId === 'mpf-ceremony-room' && ceremonySameRoom != null);
    if (fixed) {
      setErrorFieldId(null);
      setErrorMsg(null);
    }
  }, [errorFieldId, phone, eventType, venueName, venueAddress, startTime, cocktailStart, cocktailSameRoom, cocktailWarn, ceremonyStart, ceremonySameRoom]);

  // ── Phone formatting on input ────────────────────────────────────
  function handlePhoneChange(e: React.ChangeEvent<HTMLInputElement>) {
    setPhone(formatUSPhone(e.target.value));
  }

  // ── Lightbox ESC + body scroll lock ──────────────────────────────
  useEffect(() => {
    if (!photoLightboxUrl) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPhotoLightboxUrl(null);
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [photoLightboxUrl]);

  // ── Submit ────────────────────────────────────────────────────────
  async function handleSubmit() {
    setErrorMsg(null);
    setErrorFieldId(null);

    // Validation. fail() sets the message, then scrolls the offending
    // field into view and focuses it — errorFieldId drives a red ring
    // highlight via the .fieldError class.
    const fail = (msg: string, fieldId?: string): true => {
      setErrorMsg(msg);
      if (fieldId) {
        setErrorFieldId(fieldId);
        // Defer so the highlight class is applied before we scroll/focus.
        setTimeout(() => {
          const el = document.getElementById(fieldId);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            (el as HTMLElement).focus({ preventScroll: true });
          }
        }, 0);
      }
      return true;
    };

    if (!phone.trim() && fail('Please enter your phone number.', 'mpf-phone')) return;
    if (needsEmail) {
      const e = contactEmail.trim();
      if (!e && fail('Please enter an email address for your booking documents.', 'mpf-email')) return;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
        && fail('That email address doesn’t look right.', 'mpf-email')) return;
    }
    if (!eventType && fail('Please select an event type.', 'mpf-event-type')) return;
    if (!venueName.trim() && fail('Please enter the venue name.', 'mpf-venue-name')) return;
    if (!venueAddress.trim() && fail('Please enter the venue address.', 'mpf-venue-address')) return;
    if (!startTime && fail('Please select a start time.', 'mpf-start-time')) return;
    // When cocktail-hour music is needed, both the start time and the
    // same-room choice are required (weddings only).
    if (wantsCocktail) {
      if (!cocktailStart && fail('Please select a cocktail hour start time.', 'mpf-cocktail-start')) return;
      if (cocktailSameRoom == null && fail('Please choose whether the cocktail hour is in the same room as the reception.', 'mpf-cocktail-room')) return;
    }
    if (wantsCeremony) {
      if (!ceremonyStart && fail('Please select a ceremony start time.', 'mpf-ceremony-start')) return;
      if (ceremonySameRoom == null && fail('Please choose whether the ceremony is in the same room as the reception.', 'mpf-ceremony-room')) return;
    }
    if (cocktailWarn && fail(`Cocktail hour start time must be before the ${isWedding ? 'reception' : 'event'} start time.`, 'mpf-cocktail-start')) return;
    // Package validation only applies when the DJ has packages defined.
    // No-packages mode → fall through and submit as a quote-style request.
    if (hasAnyPackages) {
      if (selectedPkgIdx == null && fail('Please select a package.')) return;
      if (!selectedPkg && fail('Invalid package selected.')) return;
    }

    // Compute final price. In no-packages mode there's nothing to price —
    // the booking is a pure quote request, same shape vanilla uses for
    // is_quote bookings (price null, deposit null, package_title null).
    const finalPrice = hasAnyPackages && selectedPkg
      ? calcPrice(selectedPkg, startTime, endTime, depositPct, wantsCocktail, cocktailStart, wantsCeremony)
      : { isQuote: true, price: null, overtimeHours: 0, depositAmount: null, cocktailAddon: 0, ceremonyAddon: 0 };

    // Apply the discount to the final total; deposit comes off the discounted
    // amount. Stamp the booking with which discount was used so the DJ's
    // usage history can show who booked with it.
    const finalDiscount: DiscountResult =
      finalPrice.price != null
        ? computeDiscount(finalPrice.price, bookingSettings, appliedCode)
        : { amount: 0, kind: null, label: '' };
    const finalTotal =
      finalPrice.price != null ? Math.max(0, finalPrice.price - finalDiscount.amount) : null;
    // NOTE: finalPrice/finalDiscount/finalTotal are now PREVIEW-ONLY. The
    // stored money fields (quoted_rate, discount_*, deposit_amount, package
    // snapshots) are recomputed server-side by /api/bookings/create;
    // finalTotal is sent as expectedTotal purely so the server can detect
    // price drift (and 409 instead of booking at a different number).

    setSubmitting(true);

    try {
      // Compose the event-type-specific detail string (e.g. "25th
      // Anniversary" or "Guest of honor age: 30 · Surprise party: Yes").
      // Null for event types without sub-fields. Shown under Event Type on
      // the DJ's card and in both confirmation emails.
      const eventDetails = buildEventDetails(eventType, {
        subType: eventSubType,
        birthdayAge,
        surprise,
      });
      // Create the booking via the server route — it recomputes ALL money
      // fields (price, discount, deposit, package/discount snapshots) from
      // the DJ's own booking_settings, so a tampered client can't forge
      // amounts. We send only the booker's CHOICES.
      const res = await fetch('/api/bookings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingType: 'mobile',
          djId: dj.id,
          dateKey,
          eventType,
          eventTypeOther,
          eventSubType,
          birthdayAge,
          surprise,
          venueName: venueName.trim(),
          venueAddress: venueAddress.trim(),
          // Coords from the Nominatim autocomplete pick (null if user typed
          // freehand). Used by the DJ's booking-requests page to show a
          // distance warning when the venue is outside their travel range.
          venueLat: venueCoordsRef.current?.lat ?? null,
          venueLon: venueCoordsRef.current?.lon ?? null,
          room,
          guests,
          startTime,
          endTime,
          phone: phone.trim(),
          // Only sent when the account has none. The server writes it to
          // users.contact_email so every later email has somewhere to go.
          contactEmail: needsEmail ? contactEmail.trim().toLowerCase() : null,
          cocktailNeeded,
          cocktailStart,
          cocktailSameRoom,
          ceremonyNeeded,
          ceremonyStart,
          ceremonySameRoom,
          packageIndex: selectedPkgIdx,
          promoCode: appliedCode,
          message,
          // Preview total — server-verified, never stored as-is. A 409
          // below means pricing changed while the form was open.
          expectedTotal: finalTotal,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json && typeof json.error === 'string' && json.error) || 'Submission failed'
        );
      }
      // Server-computed money snapshot — used for the emails below so they
      // always match what was actually stored on the booking row.
      // Wedding/Mitzvah packages inherit title/details from the General package
      // at the same index when blank — mirror the card's display logic so the
      // emails name the package the booker actually saw.
      const pkgFallback = (selectedPkgIdx != null ? generalPkgs[selectedPkgIdx] : undefined) || {};
      const pkgTitleForEmail =
        (selectedPkg?.title?.trim() || pkgFallback.title?.trim()) || null;
      const pkgDetailsForEmail =
        (selectedPkg?.details || pkgFallback.details) || null;

      const created: {
        quoted_rate: number | null;
        original_rate: number | null;
        discount_label: string | null;
        discount_amount: number | null;
        is_quote: boolean;
        tax_pct: number | null;
        tax_amount: number | null;
        total_with_tax: number | null;
        deposit_pct: number | null;
        deposit_amount: number | null;
        cocktail_price: number | null;
        ceremony_price: number | null;
      } = json.booking;

      // Email the DJ that a new booking request came in. The send-email
      // route accepts djUserId and resolves the email server-side via the
      // admin API (fixes the post-Auth-migration djData.email null bug).
      // Failures are swallowed so a DB success isn't undone by an email
      // outage — the booking still appears in the DJ's Booking Requests.
      try {
        await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'booking_request',
            bookingId: json.id,
            djUserId: dj.id,
            djName: dj.name,
            requesterName: currentUser.name,
            eventDate: dateKey,
            // Event type — already saved to the DB above. We pass either
            // the canonical type ('wedding', 'mitzvah', etc.) or the
            // user-entered "other" label so the email reflects what the
            // booker actually picked.
            eventType: eventType === 'other'
              ? (eventTypeOther.trim() || 'other')
              : eventType,
            eventDetails,
            // Times — DJ wants to know start/end at a glance from the
            // email so they can decide quickly whether they're available.
            startTime,
            endTime: endTime || null,
            // Package title — gives the DJ context on what tier was
            // selected without opening the booking. Null for is_quote
            // bookings where no package is involved.
            packageTitle: pkgTitleForEmail,
            // HTML-formatted package details (bullets / checklists from the
            // DJ's profile editor). Shown under the Package row in the email
            // so the DJ sees exactly what tier was requested.
            packageDetails: pkgDetailsForEmail,
            venueName: venueName.trim(),
            venueAddress: venueAddress.trim(),
            // isWedding drives the "Reception Start/End Time" labelling in the
            // email. Cocktail hour itself is available for all mobile events.
            isWedding,
            cocktailNeeded: wantsCocktail ? true : null,
            cocktailStart: wantsCocktail ? cocktailStart : null,
            cocktailSameRoom: wantsCocktail ? !!cocktailSameRoom : null,
            ceremonyNeeded: wantsCeremony ? true : null,
            ceremonyStart: wantsCeremony ? ceremonyStart : null,
            ceremonySameRoom: wantsCeremony ? !!ceremonySameRoom : null,
            setupHours: selectedPkg?.setupHours ? String(selectedPkg.setupHours) : null,
            // Computed package price for this gig (null for is_quote
            // bookings). The email route reads quotedRate to show the
            // rate box instead of the "respond with a quote" prompt.
            quotedRate: created.quoted_rate,
            originalRate: created.original_rate,
            discountLabel: created.discount_label,
            discountAmount: created.discount_amount,
          }),
        });
      } catch (e) {
        console.warn('DJ email failed:', e);
      }

      // Confirmation copy to the booker — gives them a record of the
      // request they just sent and confirms it landed. Mirrors the
      // ClubBookingForm pattern. Best-effort; failures don't surface to
      // the user since the booking itself already succeeded above.
      try {
        await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'booking_request_confirmation',
            requesterUserId: currentUser.id,
            requesterName: currentUser.name,
            djName: dj.name,
            eventDate: dateKey,
            eventType: eventType === 'other'
              ? (eventTypeOther.trim() || 'other')
              : eventType,
            eventDetails,
            packageTitle: pkgTitleForEmail,
            packageDetails: pkgDetailsForEmail,
            venueName: venueName.trim(),
            venueAddress: venueAddress.trim(),
            startTime,
            endTime: endTime || null,
            isWedding,
            cocktailNeeded: wantsCocktail ? true : null,
            cocktailStart: wantsCocktail ? cocktailStart : null,
            cocktailSameRoom: wantsCocktail ? !!cocktailSameRoom : null,
            ceremonyNeeded: wantsCeremony ? true : null,
            ceremonyStart: wantsCeremony ? ceremonyStart : null,
            ceremonySameRoom: wantsCeremony ? !!ceremonySameRoom : null,
            setupHours: selectedPkg?.setupHours ? String(selectedPkg.setupHours) : null,
            quotedRate: created.quoted_rate,
            originalRate: created.original_rate,
            discountLabel: created.discount_label,
            discountAmount: created.discount_amount,
            // Frozen tax/deposit + add-on snapshot → the confirmation email's
            // itemized bill (sales tax, deposit, balance due day of event).
            taxPct: created.tax_pct,
            taxAmount: created.tax_amount,
            totalWithTax: created.total_with_tax,
            depositPct: created.deposit_pct,
            depositAmount: created.deposit_amount,
            cocktailPrice: created.cocktail_price,
            ceremonyPrice: created.ceremony_price,
          }),
        });
      } catch {
        // Best-effort
      }

      setSuccessState({ isQuote: created.is_quote });
      // Notify the parent so the calendar can refresh pending dates — the
      // just-requested date should immediately render a "Pending" pill.
      onSubmitted?.();
      // Auto-dismiss the form after a short delay (matches ClubBookingForm)
      setTimeout(() => onClose(), 2500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Submission failed';
      setErrorMsg(`Error: ${msg}`);
      setSubmitting(false);
    }
  }

  // ── Success state ────────────────────────────────────────────────
  if (successState) {
    if (!mounted) return null;
    const djName = dj.name || 'The DJ';
    return createPortal(
      <div className={styles.formWrap}>
        <div className={styles.successCard}>
          <div className={styles.successCheck}>✓</div>
          <div className={styles.successTitle}>
            {successState.isQuote ? 'Quote Request Sent' : 'Booking Request Sent'}
          </div>
          <div className={styles.successMsg}>
            {djName} will be in touch shortly.
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // ── Form render ──────────────────────────────────────────────────
  // Submit label: in no-packages mode, the booking is implicitly a quote
  // request (the DJ has nothing priced and will respond with a price).
  // When packages exist, fall back to the priceResult check.
  const submitLabel = !hasAnyPackages
    ? 'Request Quote'
    : priceResult?.isQuote
    ? 'Request Quote'
    : 'Request Booking';

  if (!mounted) return null;

  // Appends the red-ring highlight class to whichever field failed
  // validation. The highlight clears as soon as errorFieldId is reset
  // (on the next submit attempt or when that field is edited).
  const fieldClass = (id: string, base: string): string =>
    errorFieldId === id ? `${base} ${styles.fieldError}` : base;

  // ── Per-field "valid → show checkmark" flags ───────────────────────
  // A green check appears in a field once its value is valid. Rules vary
  // by field (per Anthony): Phone needs a real number; text fields just
  // need content; selects need a non-placeholder choice.
  //   - Phone: 10–15 digits once formatting is stripped (covers US/CA
  //     and international; rejects half-typed numbers).
  //   - Guests: a real positive number.
  //   - Text fields (venue name/address/room): any non-empty text.
  //   - Selects (event type, times): any value other than the
  //     "Select…" placeholder.
  // The Message box is intentionally excluded.
  const phoneValid = (() => {
    const digits = phone.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
  })();
  // Only meaningful when the field is shown at all.
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim());
  const guestsValid = guests.trim() !== '' && Number(guests) > 0;
  const venueNameValid = venueName.trim() !== '';
  // Address is valid for the checkmark once it's a substantial entry —
  // either 10+ characters typed, or selected from the autocomplete
  // dropdown (a real picked address is inherently complete).
  const venueAddressValid = addressPicked || venueAddress.trim().length >= 10;
  const roomValid = room.trim() !== '';
  const eventTypeValid = eventType !== ''
    && (eventType !== 'other' || eventTypeOther.trim() !== '');
  const startTimeValid = startTime !== '';
  const endTimeValid = endTime !== '';

  return createPortal(
    <div className={styles.formWrap}>
      <div ref={rootRef} className={styles.formCard}>
        <div className={styles.formHeaderRow}>
          <div>
            <div className={styles.formHeaderEyebrow}>Booking Request</div>
            <div className={styles.formHeaderDate}>{dateLabel}</div>
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

        {errorMsg && <div className={`${styles.alert} ${styles.alertError}`}>{errorMsg}</div>}

        {/* Phone */}
        <div className={styles.formRow}>
          <label htmlFor="mpf-phone">Phone Number</label>
          <FieldCheck valid={phoneValid}>
            <input
              id="mpf-phone"
              type="tel"
              inputMode="tel"
              placeholder="(555) 555-5555"
              value={phone}
              onChange={handlePhoneChange}
              className={`${fieldClass('mpf-phone', styles.input)} ${styles.hasCheck}`}
              autoComplete="tel"
            />
          </FieldCheck>
        </div>

        {/* Email — ONLY for accounts that don't have one (phone signups).
            Everything after this booking is an email; without an address the
            host would book and then never hear from anyone again. */}
        {needsEmail && (
          <div className={styles.formRow}>
            <label htmlFor="mpf-email">Email Address</label>
            <FieldCheck valid={emailValid}>
              <input
                id="mpf-email"
                type="email"
                inputMode="email"
                placeholder="your@email.com"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className={`${fieldClass('mpf-email', styles.input)} ${styles.hasCheck}`}
                autoComplete="email"
              />
            </FieldCheck>
            <small style={{ display: 'block', marginTop: '.35rem', color: 'var(--muted)', fontSize: '.7rem' }}>
              We&apos;ll send your confirmation, contract and planner here. Asked once —
              we&apos;ll remember it next time.
            </small>
          </div>
        )}

        {/* Event Type */}
        <div className={styles.formRow}>
          <label htmlFor="mpf-event-type">Type of Event</label>
          <FieldCheck valid={eventTypeValid}>
            <select
              id="mpf-event-type"
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className={`${fieldClass('mpf-event-type', styles.select)} ${styles.hasCheckSelect}`}
            >
              <option value="">Select event type...</option>
              {Object.entries(MOB_EVENT_TYPE_LABELS).map(([val, lbl]) =>
                eventTypesAllowed.includes(val) ? (
                  <option key={val} value={val}>{lbl}</option>
                ) : null
              )}
            </select>
          </FieldCheck>
          {eventType === 'other' && (
            <input
              type="text"
              placeholder="Describe your event..."
              value={eventTypeOther}
              onChange={(e) => setEventTypeOther(e.target.value)}
              className={styles.input}
              style={{ marginTop: '.4rem' }}
            />
          )}
          {/* Event-type-specific sub-fields. Six types take a single
              "Type of X" text field; Birthday takes age + surprise. */}
          {EVENT_SUBFIELDS[eventType]?.textLabel && (
            <div style={{ marginTop: '.6rem' }}>
              <label htmlFor="mpf-event-subtype">{EVENT_SUBFIELDS[eventType].textLabel}</label>
              <input
                id="mpf-event-subtype"
                type="text"
                placeholder={EVENT_SUBFIELDS[eventType].textPlaceholder}
                value={eventSubType}
                onChange={(e) => setEventSubType(e.target.value)}
                className={styles.input}
                style={{ marginTop: '.3rem' }}
              />
            </div>
          )}
          {EVENT_SUBFIELDS[eventType]?.isBirthday && (
            <div style={{ marginTop: '.6rem' }}>
              <label htmlFor="mpf-birthday-age">Guest of Honor Age?</label>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  marginTop: '.3rem',
                  flexWrap: 'wrap',
                }}
              >
                <input
                  id="mpf-birthday-age"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  placeholder="e.g. 30"
                  value={birthdayAge}
                  onChange={(e) => setBirthdayAge(e.target.value)}
                  className={styles.input}
                  style={{ width: '90px', flexShrink: 0 }}
                />
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '.55rem',
                    cursor: 'pointer',
                    fontSize: '.85rem',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={surprise}
                    onChange={(e) => setSurprise(e.target.checked)}
                    style={{
                      width: 16,
                      height: 16,
                      flexShrink: 0,
                      accentColor: 'var(--neon)',
                      cursor: 'pointer',
                    }}
                  />
                  Is this a Surprise Party?
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Venue Name */}
        <div className={styles.formRow}>
          <label htmlFor="mpf-venue-name">Venue Name</label>
          <FieldCheck valid={venueNameValid}>
            <input
              id="mpf-venue-name"
              type="text"
              placeholder="The Grand Ballroom"
              value={venueName}
              onChange={(e) => setVenueName(e.target.value)}
              className={`${fieldClass('mpf-venue-name', styles.input)} ${styles.hasCheck}`}
            />
          </FieldCheck>
        </div>

        {/* Venue Address — country dropdown + Nominatim autocomplete.
            The country select scopes suggestions; the booker picks it
            first so addresses only populate for the selected country. */}
        <div className={styles.formRow}>
          <label htmlFor="mpf-venue-address">Venue Address</label>
          <div className={styles.addressRow}>
            <select
              aria-label="Venue country"
              className={`${styles.select} ${styles.countrySelect}`}
              value={venueCountry}
              onChange={(e) => {
                setVenueCountry(e.target.value);
                // Country changed — existing suggestions no longer valid.
                setAddrSuggestions([]);
                setShowAddrSuggestions(false);
                venueCoordsRef.current = null;
              }}
            >
              {BOOKING_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.code.toUpperCase()}
                </option>
              ))}
            </select>
            <div className={styles.addressInputWrap}>
              <input
                id="mpf-venue-address"
                type="text"
                placeholder="123 Main St, City, State"
                value={venueAddress}
                onChange={(e) => {
                  const val = e.target.value;
                  setVenueAddress(val);
                  // User started typing again — invalidate previously picked coords
                  venueCoordsRef.current = null;
                  // No longer a dropdown-selected address.
                  setAddressPicked(false);
                  // Debounce the Nominatim fetch; vanilla uses 350ms
                  if (addrTimerRef.current) clearTimeout(addrTimerRef.current);
                  if (val.trim().length < 3) {
                    setAddrSuggestions([]);
                    setShowAddrSuggestions(false);
                    return;
                  }
                  addrTimerRef.current = setTimeout(async () => {
                    // Scope suggestions to the selected country.
                    const results = await searchAddresses(val.trim(), venueCountry);
                    setAddrSuggestions(results);
                    setShowAddrSuggestions(results.length > 0);
                  }, 350);
                }}
                onBlur={() => {
                  // Delay so click on a suggestion can fire before we hide
                  setTimeout(() => setShowAddrSuggestions(false), 150);
                }}
                onFocus={() => {
                  if (addrSuggestions.length > 0) setShowAddrSuggestions(true);
                }}
                className={`${fieldClass('mpf-venue-address', styles.input)} ${styles.hasCheck}`}
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
                      // Use onMouseDown not onClick — fires before the input's
                      // onBlur, so the suggestion list isn't dismissed first.
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
                      }}
                    >
                      {s.display}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Room Details */}
        <div className={styles.formRow}>
          <label htmlFor="mpf-room">
            Room Details <span className={styles.optional}>(optional)</span>
          </label>
          <FieldCheck valid={roomValid}>
            <input
              id="mpf-room"
              type="text"
              placeholder="e.g. Grand Ballroom, 3rd Floor Terrace"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              className={`${styles.input} ${styles.hasCheck}`}
            />
          </FieldCheck>
        </div>

        {/* Guests */}
        <div className={styles.formRow}>
          <label htmlFor="mpf-guests">Estimated Number of Guests</label>
          <FieldCheck valid={guestsValid}>
            <input
              id="mpf-guests"
              type="number"
              min={1}
              placeholder="150"
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
              className={`${styles.input} ${styles.smallNumberInput} ${styles.hasCheck}`}
            />
          </FieldCheck>
        </div>

        {/* Times */}
        <div className={styles.timesLabel}>{dateLabel}</div>
        <div className={styles.timesRow}>
          <div className={styles.timeCol}>
            <label htmlFor="mpf-start-time">
              {isWedding ? 'Reception Start Time' : 'Event Start Time'}
            </label>
            <FieldCheck valid={startTimeValid}>
              <select
                id="mpf-start-time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={`${fieldClass('mpf-start-time', styles.select)} ${styles.hasCheckSelect}`}
              >
                <option value="">Select time...</option>
                {MOB_TIME_OPTIONS.map(o => (
                  <option key={o.val} value={o.val}>{o.label}</option>
                ))}
              </select>
            </FieldCheck>
          </div>
          <div className={styles.timeCol}>
            <label htmlFor="mpf-end-time">
              {isWedding ? 'Reception End Time' : 'Event End Time'}
            </label>
            <FieldCheck valid={endTimeValid}>
              <select
                id="mpf-end-time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={`${styles.select} ${styles.hasCheckSelect}`}
              >
                <option value="">Select time...</option>
                {MOB_TIME_OPTIONS.map(o => (
                  <option key={o.val} value={o.val}>{o.label}</option>
                ))}
              </select>
            </FieldCheck>
          </div>
        </div>
        {durationLabel(hoursBetween(startTime, endTime)) && (
          <div className={styles.durationNoteRight}>
            {isWedding ? 'Reception Duration' : 'Event Duration'}: {durationLabel(hoursBetween(startTime, endTime))}
          </div>
        )}

        {/* Cocktail-hour subsection — WEDDINGS ONLY. General/Mitzvah and other
            mobile events no longer offer a cocktail-hour add-on. */}
        {cocktailEligible && isWedding && (
          <div className={styles.weddingFields}>
            <div className={styles.cocktailHeaderRow}>
              <div className={styles.weddingHeader}>Cocktail Hour</div>
            </div>
            <div className={styles.weddingPrompt}>Is music needed for cocktail hour?</div>
            <div className={styles.radioGroup}>
              <label className={styles.radioPill}>
                <input
                  type="radio"
                  name="mpf-cocktail-yn"
                  checked={cocktailNeeded === true}
                  onChange={() => setCocktailNeeded(true)}
                />
                <span className={styles.radioPillLabel}>Yes</span>
              </label>
              <label className={styles.radioPill}>
                <input
                  type="radio"
                  name="mpf-cocktail-yn"
                  checked={cocktailNeeded === false}
                  onChange={() => setCocktailNeeded(false)}
                />
                <span className={styles.radioPillLabel}>No</span>
              </label>
            </div>
            {cocktailNeeded === true && (
              <div>
                <div style={{ marginBottom: '.6rem' }}>
                  <label
                    htmlFor="mpf-cocktail-start"
                    style={{
                      fontFamily: "'Space Mono', monospace",
                      fontSize: '.58rem',
                      letterSpacing: '.06em',
                      textTransform: 'uppercase',
                      color: 'var(--white)',
                      display: 'block',
                      marginBottom: '.3rem',
                    }}
                  >
                    Cocktail Start Time
                  </label>
                  <select
                    id="mpf-cocktail-start"
                    value={cocktailStart}
                    onChange={(e) => setCocktailStart(e.target.value)}
                    className={fieldClass('mpf-cocktail-start', styles.select)}
                  >
                    <option value="">Select time...</option>
                    {MOB_TIME_OPTIONS.map(o => (
                      <option key={o.val} value={o.val}>{o.label}</option>
                    ))}
                  </select>
                  {cocktailWarn && (
                    <div className={styles.cocktailWarn}>
                      ⚠ Cocktail hour must start before the {isWedding ? 'reception' : 'event'}. Please select an earlier time.
                    </div>
                  )}
                  {!cocktailWarn && halfHourLabel(halfHoursBetween(cocktailStart, startTime)) && (
                    <div className={styles.cocktailDurationNote}>
                      Cocktail hour duration: {halfHourLabel(halfHoursBetween(cocktailStart, startTime))}
                    </div>
                  )}
                </div>
                <div id="mpf-cocktail-room" style={{ fontSize: '.85rem', color: errorFieldId === 'mpf-cocktail-room' ? 'var(--danger, #ff5f5f)' : 'var(--white)', marginBottom: '.5rem', scrollMarginTop: '90px' }}>
                  Is the cocktail hour in the same room as the {isWedding ? 'reception' : 'event'}?
                </div>
                <div className={styles.radioGroup}>
                  <label className={styles.radioPill}>
                    <input
                      type="radio"
                      name="mpf-cocktail-room"
                      checked={cocktailSameRoom === true}
                      onChange={() => setCocktailSameRoom(true)}
                    />
                    <span className={styles.radioPillLabel}>Yes</span>
                  </label>
                  <label className={styles.radioPill}>
                    <input
                      type="radio"
                      name="mpf-cocktail-room"
                      checked={cocktailSameRoom === false}
                      onChange={() => setCocktailSameRoom(false)}
                    />
                    <span className={styles.radioPillLabel}>No</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Music-for-ceremony subsection — WEDDINGS ONLY. Independent add-on
            that mirrors the cocktail-hour block above. */}
        {isWedding && (
          <div className={styles.weddingFields}>
            <div className={styles.cocktailHeaderRow}>
              <div className={styles.weddingHeader}>Music For Ceremony</div>
            </div>
            <div className={styles.weddingPrompt}>Is music needed for the ceremony?</div>
            <div className={styles.radioGroup}>
              <label className={styles.radioPill}>
                <input
                  type="radio"
                  name="mpf-ceremony-yn"
                  checked={ceremonyNeeded === true}
                  onChange={() => setCeremonyNeeded(true)}
                />
                <span className={styles.radioPillLabel}>Yes</span>
              </label>
              <label className={styles.radioPill}>
                <input
                  type="radio"
                  name="mpf-ceremony-yn"
                  checked={ceremonyNeeded === false}
                  onChange={() => setCeremonyNeeded(false)}
                />
                <span className={styles.radioPillLabel}>No</span>
              </label>
            </div>
            {ceremonyNeeded === true && (
              <div>
                <div style={{ marginBottom: '.6rem' }}>
                  <label
                    htmlFor="mpf-ceremony-start"
                    style={{
                      fontFamily: "'Space Mono', monospace",
                      fontSize: '.58rem',
                      letterSpacing: '.06em',
                      textTransform: 'uppercase',
                      color: 'var(--white)',
                      display: 'block',
                      marginBottom: '.3rem',
                    }}
                  >
                    Ceremony Start Time
                  </label>
                  <select
                    id="mpf-ceremony-start"
                    value={ceremonyStart}
                    onChange={(e) => setCeremonyStart(e.target.value)}
                    className={fieldClass('mpf-ceremony-start', styles.select)}
                  >
                    <option value="">Select time...</option>
                    {MOB_TIME_OPTIONS.map(o => (
                      <option key={o.val} value={o.val}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div id="mpf-ceremony-room" style={{ fontSize: '.85rem', color: errorFieldId === 'mpf-ceremony-room' ? 'var(--danger, #ff5f5f)' : 'var(--white)', marginBottom: '.5rem', scrollMarginTop: '90px' }}>
                  Is the ceremony in the same room as the reception?
                </div>
                <div className={styles.radioGroup}>
                  <label className={styles.radioPill}>
                    <input
                      type="radio"
                      name="mpf-ceremony-room"
                      checked={ceremonySameRoom === true}
                      onChange={() => setCeremonySameRoom(true)}
                    />
                    <span className={styles.radioPillLabel}>Yes</span>
                  </label>
                  <label className={styles.radioPill}>
                    <input
                      type="radio"
                      name="mpf-ceremony-room"
                      checked={ceremonySameRoom === false}
                      onChange={() => setCeremonySameRoom(false)}
                    />
                    <span className={styles.radioPillLabel}>No</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Packages */}
        {hasAnyPackages ? (
          <div className={styles.formRow}>
            <PackagesSection
              formReady={formReadyForPackages}
              eventType={eventType}
              categoryPkgs={categoryPkgs}
              generalPkgs={generalPkgs}
              selectedPkgIdx={selectedPkgIdx}
              onSelect={(idx) => setSelectedPkgIdx(idx)}
              onPhotoClick={(photos, details) => setPhotoLightboxUrl({ photos, details, active: 0 })}
              startTime={startTime}
              endTime={endTime}
              depositPct={depositPct}
              wantsCocktail={wantsCocktail}
              cocktailStart={cocktailStart}
              wantsCeremony={wantsCeremony}
            />
          </div>
        ) : (
          // No packages defined → quote-style notice. The DJ will respond
          // with a price via their booking-requests page.
          formReadyForPackages && (
            <div className={styles.formRow}>
              <div className={styles.noPackagesMsg}>
                This DJ accepts custom requests. Submit your details and they&apos;ll
                respond with a quote.
              </div>
            </div>
          )
        )}

        {/* Price display */}
        {priceResult && selectedPkgIdx != null && (
          <div className={styles.priceDisplay}>
            <div className={styles.priceLabel}>Estimated Price</div>

            {discount.amount > 0 && (
              <div className={styles.depositText} style={{ color: 'var(--neon,#00e0a4)', fontWeight: 700, marginBottom: 4 }}>
                {discount.label} — you save ${discount.amount.toLocaleString()}
              </div>
            )}

            {/* Package price — big on its own when there's no breakdown;
                demoted to a supporting size when a Total sits below. */}
            <div
              className={
                priceResult.isQuote
                  ? `${styles.priceValue} ${styles.priceValueQuote}`
                  : styles.priceValue
              }
            >
              {priceResult.isQuote || priceResult.price == null ? (
                'Price on Request'
              ) : discount.amount > 0 && discountedTotal != null ? (
                <>
                  <span style={{ textDecoration: 'line-through', opacity: 0.5, fontSize: '.7em', marginRight: 8 }}>
                    ${priceResult.price.toLocaleString()}
                  </span>
                  ${discountedTotal.toLocaleString()}
                </>
              ) : (
                `$${priceResult.price.toLocaleString()}`
              )}
            </div>

            {/* Itemized breakdown — the big Total sits at the bottom. */}
            {showPriceBreakdown && discountedTotal != null && grandTotal != null && (
              <div style={{ maxWidth: 260, margin: '12px auto 0', textAlign: 'left' }}>
                {taxPct > 0 && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', color: 'var(--white,#fff)', padding: '3px 0' }}>
                      <span>Subtotal</span><span>${discountedTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', color: 'var(--white,#fff)', padding: '3px 0' }}>
                      <span>Tax ({taxPct.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })}%)</span><span>${taxAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  </>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '1.2rem', fontWeight: 800, color: 'var(--neon,#00e0a4)', borderTop: '1px solid var(--border,rgba(255,255,255,.2))', paddingTop: 8, marginTop: 6, paddingBottom: 10, borderBottom: '1px solid var(--border,rgba(255,255,255,.2))', marginBottom: 10 }}>
                  <span>Total</span><span>${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                {depositPct > 0 && discountedDeposit != null && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', color: 'var(--white,#fff)', padding: '3px 0' }}>
                      <span>Deposit ({depositPct}%)</span><span>${discountedDeposit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', color: 'var(--white,#fff)', padding: '3px 0' }}>
                      <span>Balance due day of event</span><span>${(grandTotal - discountedDeposit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  </>
                )}
              </div>
            )}
            {priceResult.price != null && depositPct === 0 && taxPct === 0 && (
              <div className={styles.depositText}>No deposit required</div>
            )}
            {priceResult.cocktailAddon > 0 && (
              <div className={styles.cocktailNote}>
                Includes cocktail hour: +${priceResult.cocktailAddon.toLocaleString()}
              </div>
            )}
            {(priceResult.ceremonyAddon ?? 0) > 0 && (
              <div className={styles.cocktailNote}>Includes ceremony music: +${(priceResult.ceremonyAddon ?? 0).toLocaleString()}</div>
            )}
            {!priceResult.isQuote && priceResult.price != null && Number(selectedPkg?.overtime) > 0 && (
              <div className={styles.overtimeNote}>
                Overtime rate: ${Number(selectedPkg?.overtime).toLocaleString()}/hr
              </div>
            )}

            {!priceResult.isQuote && priceResult.price != null && hasActiveCode && (
              <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={promoInput}
                  onChange={(e) => { setPromoInput(e.target.value.toUpperCase()); setPromoError(''); }}
                  placeholder="Promo code"
                  style={{
                    textTransform: 'uppercase',
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--border,rgba(255,255,255,.25))',
                    background: 'transparent',
                    color: 'inherit',
                    maxWidth: 150,
                  }}
                />
                <button
                  type="button"
                  onClick={applyPromo}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--neon,#00e0a4)',
                    background: 'transparent',
                    color: 'var(--neon,#00e0a4)',
                    cursor: 'pointer',
                    fontSize: '.8rem',
                  }}
                >
                  Apply
                </button>
                {appliedCode && discount.kind === 'code' && (
                  <span style={{ color: 'var(--neon,#00e0a4)', fontSize: '.8rem' }}>✓ Applied</span>
                )}
                {appliedCode && discount.kind === 'sale' && (
                  <span style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.75rem' }}>
                    Sale price is better — applied
                  </span>
                )}
                {promoError && <span style={{ color: '#ff6b6b', fontSize: '.8rem' }}>{promoError}</span>}
              </div>
            )}
          </div>
        )}

        {/* Message */}
        <div className={styles.formRow}>
          <label htmlFor="mpf-message">
            Message <span className={styles.optional}>(optional)</span>
          </label>
          <textarea
            id="mpf-message"
            placeholder="Tell the DJ about your event..."
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className={styles.textarea}
          />
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className={styles.submitBtn}
        >
          {submitting ? 'Submitting...' : submitLabel}
        </button>
      </div>

      {/* Photo lightbox for package thumbnails */}
      {photoLightboxUrl && (
        <div
          className={styles.photoLightbox}
          onClick={() => setPhotoLightboxUrl(null)}
        >
          <div
            className={styles.photoLightboxInner}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.photoLightboxStage}>
              <div className={styles.photoLightboxMain}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoLightboxUrl.photos[photoLightboxUrl.active]}
                  alt="Package preview"
                  className={styles.photoLightboxImg}
                />
              </div>
              {photoLightboxUrl.photos.length > 1 && (
                <div className={styles.photoLightboxThumbs}>
                  {photoLightboxUrl.photos.map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`${styles.photoLightboxThumb} ${i === photoLightboxUrl.active ? styles.photoLightboxThumbActive : ''}`}
                      onClick={() => setPhotoLightboxUrl((cur) => cur ? { ...cur, active: i } : cur)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p} alt={`Photo ${i + 1}`} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            {photoLightboxUrl.details && (
              <div
                className={styles.photoLightboxDetails}
                // Details come from the DJ's profile editor — trusted source.
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: photoLightboxUrl.details }}
              />
            )}
            <button
              type="button"
              onClick={() => setPhotoLightboxUrl(null)}
              className={styles.photoLightboxClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PackagesSection — handles the placeholder, no-packages-found, and the
// package grid when ready. Pulled out for clarity.
// ─────────────────────────────────────────────────────────────────────────

function PackagesSection({
  formReady,
  eventType,
  categoryPkgs,
  generalPkgs,
  selectedPkgIdx,
  onSelect,
  onPhotoClick,
  startTime,
  endTime,
  depositPct,
  wantsCocktail,
  cocktailStart,
  wantsCeremony,
}: {
  formReady: boolean;
  eventType: string;
  categoryPkgs: MobilePackage[];
  generalPkgs: MobilePackage[];
  selectedPkgIdx: number | null;
  onSelect: (idx: number) => void;
  onPhotoClick: (photos: string[], details: string) => void;
  startTime: string;
  endTime: string;
  depositPct: number;
  wantsCocktail: boolean;
  cocktailStart: string;
  wantsCeremony: boolean;
}) {
  if (!formReady) {
    return (
      <div className={styles.packagesPlaceholder}>
        Available packages will appear once we have all the information about your event.
      </div>
    );
  }
  if (!eventType) {
    return null;
  }

  // Filter to packages with a usable title (matches vanilla's `if (!title) return`)
  const usablePackages = categoryPkgs
    .map((pkg, idx) => {
      const fallback = generalPkgs[idx] || {};
      const title = (pkg.title?.trim()) || (fallback.title?.trim());
      if (!pkg || !title) return null;
      return {
        idx,
        pkg,
        fallback,
        title,
        details: pkg.details ?? fallback.details,
        photo: pkg.photo ?? fallback.photo,
        // Extra photos are specific to THIS package — they must not inherit
        // from the general-category package at the same index (doing so made
        // slots 2-4 appear shared across packages in a group). Main photo can
        // still inherit; extras come only from this package's own `photos`.
        photos: [
          (pkg.photo ?? fallback.photo),
          ...(((pkg as { photos?: string[] }).photos) ?? []),
        ].filter((u): u is string => !!u),
      };
    })
    .filter((p): p is NonNullable<typeof p> => p != null);

  if (usablePackages.length === 0) {
    return (
      <div className={styles.noPackagesMsg}>
        No packages available for this event type. Message the DJ to discuss your event.
      </div>
    );
  }

  return (
    <>
      <div className={styles.packagesLabel}>Select a Package</div>
      <div className={styles.packagesGrid}>
        {usablePackages.map(({ idx, pkg, title, details, photo, photos }) => {
          const isSelected = selectedPkgIdx === idx;

          // Price preview on the card head. Dynamic: reflects the actual
          // selected event duration using the same tier logic as the
          // Estimated Price (calcPrice picks 4/5/6hr rate + overtime). Before
          // start/end times are chosen, calcPrice falls back to the base rate.
          let priceEl: React.ReactNode = null;
          if (pkg.reqAll) {
            priceEl = <div className={styles.packagePriceQuote}>Price on request</div>;
          } else {
            const cardPrice = calcPrice(pkg, startTime, endTime, depositPct, wantsCocktail, cocktailStart, wantsCeremony);
            if (cardPrice.isQuote || cardPrice.price == null) {
              if (packageTiers(pkg).length > 0) {
                priceEl = <div className={styles.packagePriceQuote}>Price on request</div>;
              }
            } else {
              priceEl = (
                <div className={styles.packagePrice}>
                  ${cardPrice.price.toLocaleString()}
                </div>
              );
            }
          }

          const hasBody = !!(details || photo);

          return (
            <div
              key={idx}
              className={`${styles.packageCard} ${isSelected ? styles.packageCardSelected : ''}`}
              onClick={() => onSelect(idx)}
              role="button"
            >
              {isSelected && (
                <div className={styles.packageCheck}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#050507" strokeWidth="3.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              )}

              <div
                className={`${styles.packageHead} ${hasBody ? styles.packageHeadHasBody : ''}`}
              >
                <div className={styles.packageTitle}>{title}</div>
                {priceEl && (
                  <div className={styles.packagePriceWrap}>{priceEl}</div>
                )}
              </div>

              {hasBody && (
                <div
                  className={`${styles.packageBody} ${isSelected ? styles.packageBodySelected : ''}`}
                >
                  <div className={styles.packageDetails}>
                    {details ? (
                      // Vanilla preserves the DJ's chosen formatting (bullets,
                      // numbered list, gdj-check-list). Details come from the
                      // DJ's profile editor — trusted source. Render as HTML.
                      // eslint-disable-next-line react/no-danger
                      <div dangerouslySetInnerHTML={{ __html: details }} />
                    ) : (
                      <div className={styles.packageDetailsEmpty}>
                        Details available on request
                      </div>
                    )}
                  </div>
                  {photo && (
                    <div
                      className={styles.packageThumb}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPhotoClick(photos && photos.length ? photos : [photo], details || '');
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo} alt="" />
                      <div className={styles.packageThumbOverlay} />
                      <div className={styles.packageThumbLabel}>Sample</div>
                    </div>
                  )}
                </div>
              )}

              {isSelected && !hasBody && <div style={{ height: '2rem' }} />}
            </div>
          );
        })}
      </div>
    </>
  );
}

// FieldCheck — wraps a form control and shows a green ✓ at its right edge
// once `valid` is true. The wrapper is position:relative so the check can
// be absolutely positioned; the control inside keeps extra right-padding
// (via the .hasCheck class) so long text never runs under the mark.
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
