// POST /api/bookings/create
//
// Server-side booking creation for the public booking forms
// (MobileBookingForm + ClubBookingForm). This route closes a trust-boundary
// hole: bookings used to be INSERTed straight from the browser with
// client-computed money fields (quoted_rate / discount_amount /
// deposit_amount / …) that a logged-in booker could forge in devtools
// before submit — and the forged price then flowed into the DJ's card,
// the emails, and the DocuSeal contract.
//
// The client now sends only its CHOICES — package index, times, promo code,
// equipment, offer amount — and this route re-derives EVERY money field and
// package snapshot from the DJ's own booking_settings, using the SAME pure
// helpers the client uses for its live preview (calcPrice / computeDiscount /
// computeRate). Honest users therefore get numbers identical to what the
// form showed them.
//
// The client may also send `expectedTotal` (the total its preview showed).
// It is used ONLY to detect pricing drift — the DJ changed rates, a sale
// ended, or a promo code expired between page load and submit. On a
// mismatch we return 409 ("pricing changed, please review") instead of
// silently booking at a different price. expectedTotal is NEVER trusted
// for storage.
//
// Body (discriminated by bookingType):
//   { bookingType: 'mobile', djId, dateKey, eventType, eventTypeOther,
//     eventSubType, birthdayAge, surprise, venueName, venueAddress,
//     venueLat, venueLon, room, guests, startTime, endTime, phone,
//     cocktailNeeded, cocktailStart, cocktailSameRoom, packageIndex,
//     promoCode, message, expectedTotal }
//   { bookingType: 'club', djId, dateKey, country, venueType, setType,
//     venueName, venueAddress, phone, venueLat, venueLon, startTime,
//     endTime, equipment, venueEquipDetail, offerAmount, promoCode,
//     notes, expectedTotal }
//
// requester_id ALWAYS comes from the session — never from the body.
// Returns: { ok: true, id, booking: <server-computed money snapshot> }

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  type BookingSettings,
  type MobilePackage,
  type DayData,
  type DiscountResult,
  parseBookingSettings,
  computeDiscount,
} from '@/app/(main)/[slug]/bookingSettings';
import {
  calcPrice,
  getPackageCategory,
  buildEventDetails,
} from '@/app/(main)/[slug]/mobileBookingForm';
import { computeRate } from '@/app/(main)/[slug]/clubRate';

export const runtime = 'nodejs';
export const maxDuration = 15;

// "HH:MM" 24-hour — the only shape MOB_TIME_OPTIONS ever produces.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// "YYYY-MM-DD" — the calendar's dateKey shape.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Sanity cap for club offers. The offer is genuinely booker-chosen money
// (it can't be recomputed server-side, only bounded), so require a real
// positive amount below an obviously-absurd ceiling. The old client check
// (`offerNum && !isNaN(offerNum)`) let NEGATIVE offers straight through.
const MAX_OFFER = 1_000_000;

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const boolOrNull = (v: unknown): boolean | null =>
  v === true ? true : v === false ? false : null;

// Drift check between the client's previewed total and our recomputed one.
// Both sides compute in plain JS floats from the same inputs, so honest
// submissions match exactly; the epsilon only absorbs JSON round-tripping.
function totalsDiffer(expected: number | null, actual: number | null): boolean {
  if (expected == null || actual == null) {
    return (expected == null) !== (actual == null);
  }
  return Math.abs(expected - actual) > 0.005;
}

// Vanilla effective-slug fallback — mirrors deriveSlugFromName in
// app/(main)/[slug]/page.tsx (dj-profile.html line 429). The forms used to
// insert dj_slug from the ProfileView prop, which is users.slug with this
// derivation as fallback; we reproduce that here so dj_slug can come from
// the server instead of the request body.
function deriveSlugFromName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad('Invalid JSON body');
  }

  const bookingType = str(body.bookingType);
  if (bookingType !== 'mobile' && bookingType !== 'club') {
    return bad('Invalid bookingType');
  }

  const djId = str(body.djId);
  const dateKey = str(body.dateKey);
  if (!djId) return bad('Missing djId');
  if (!DATE_RE.test(dateKey)) return bad('Invalid event date');

  // Load the DJ server-side — booking_settings is the single source of
  // truth for every money field. It's a JSON *string* on users.
  const admin = createAdminClient();
  const { data: djRow, error: djErr } = await admin
    .from('users')
    .select('id, name, slug, booking_settings')
    .eq('id', djId)
    .maybeSingle<{
      id: string;
      name: string | null;
      slug: string | null;
      booking_settings: string | null;
    }>();
  if (djErr) return bad('DJ lookup failed: ' + djErr.message, 500);
  if (!djRow) return bad('DJ not found.', 404);

  const settings: BookingSettings = parseBookingSettings(djRow.booking_settings) || {};
  const djSlug = djRow.slug || deriveSlugFromName(djRow.name) || null;

  // Shared non-money fields
  const venueName = str(body.venueName).trim();
  const venueAddress = str(body.venueAddress).trim();
  const phone = str(body.phone).trim();
  const startTime = str(body.startTime);
  const endTime = str(body.endTime);
  const venueLat = numOrNull(body.venueLat);
  const venueLon = numOrNull(body.venueLon);
  const promoCode = str(body.promoCode).trim().toUpperCase();
  const hasExpected = Object.prototype.hasOwnProperty.call(body, 'expectedTotal');
  const expectedTotal = hasExpected ? numOrNull(body.expectedTotal) : null;

  if (!venueName) return bad('Please enter the venue name.');
  if (!venueAddress) return bad('Please enter the venue address.');
  if (!phone) return bad('Please enter your phone number.');
  if (!startTime || !TIME_RE.test(startTime)) return bad('Please select a valid start time.');
  if (endTime && !TIME_RE.test(endTime)) return bad('Please select a valid end time.');

  // ────────────────────────────────────────────────────────────────────
  // MOBILE branch — package-priced bookings (MobileBookingForm)
  // ────────────────────────────────────────────────────────────────────
  if (bookingType === 'mobile') {
    const eventType = str(body.eventType);
    const eventTypeOther = str(body.eventTypeOther);
    const eventSubType = str(body.eventSubType);
    const birthdayAge = str(body.birthdayAge);
    const surprise = body.surprise === true;
    const room = str(body.room);
    const guests = str(body.guests);
    const message = str(body.message);
    const cocktailNeeded = boolOrNull(body.cocktailNeeded);
    const cocktailStart = str(body.cocktailStart);
    const cocktailSameRoom = boolOrNull(body.cocktailSameRoom);
    const rawPackageIndex = body.packageIndex;
    const packageIndex =
      typeof rawPackageIndex === 'number' && Number.isInteger(rawPackageIndex)
        ? rawPackageIndex
        : null;

    if (!eventType) return bad('Please select an event type.');
    if (cocktailStart && !TIME_RE.test(cocktailStart)) {
      return bad('Please select a valid cocktail hour start time.');
    }

    // Derivations — EXACT mirror of MobileBookingForm's submit handler.
    const isWedding = eventType === 'weddings';
    const wantsCocktail = isWedding && cocktailNeeded === true;
    const cat = getPackageCategory(eventType);
    const packagesAll = settings.mob_packages || {};
    const categoryPkgs: MobilePackage[] = packagesAll[cat] || [];
    const hasAnyPackages = Object.values(packagesAll).some((arr) =>
      Array.isArray(arr) && arr.some((p) => p && p.title && p.title.trim())
    );
    const depositPct = settings.mob_deposit_pct || 0;

    if (wantsCocktail) {
      if (!cocktailStart) return bad('Please select a cocktail hour start time.');
      if (cocktailSameRoom == null) {
        return bad('Please choose whether the cocktail hour is in the same room as the reception.');
      }
    }
    // cocktailWarn — same condition as the client (cocktail must start
    // before the reception/event start).
    if (cocktailNeeded === true && cocktailStart && startTime && cocktailStart >= startTime) {
      return bad(`Cocktail hour start time must be before the ${isWedding ? 'reception' : 'event'} start time.`);
    }

    // Package selection — only validated when the DJ has packages at all.
    // No-packages mode → pure quote request (price/deposit/package null).
    let selectedPkg: MobilePackage | null = null;
    if (hasAnyPackages) {
      if (packageIndex == null || packageIndex < 0) return bad('Please select a package.');
      selectedPkg = categoryPkgs[packageIndex] ?? null;
      if (!selectedPkg) return bad('Invalid package selected.');
    }

    // Recompute EVERYTHING money-related server-side — same helpers, same
    // order, same rounding as the client's submit handler.
    const finalPrice = hasAnyPackages && selectedPkg
      ? calcPrice(selectedPkg, startTime, endTime, depositPct, wantsCocktail, cocktailStart)
      : { isQuote: true, price: null, overtimeHours: 0, depositAmount: null, cocktailAddon: 0 };

    const finalDiscount: DiscountResult =
      finalPrice.price != null
        ? computeDiscount(finalPrice.price, settings, promoCode)
        : { amount: 0, kind: null, label: '' };
    const finalTotal =
      finalPrice.price != null ? Math.max(0, finalPrice.price - finalDiscount.amount) : null;

    // Sales-tax SNAPSHOT — computed once here and frozen onto the booking
    // row, so a DJ later changing their tax settings can never re-price an
    // existing booking (or an already-signed contract). Same formulas as
    // the form's live preview (MobileBookingForm): tax on the post-discount
    // total, to the cent; then the deposit on the TAX-INCLUSIVE total, to
    // the cent. (The old code took the deposit on the PRE-tax total, which
    // stored a different number than the one the client agreed to.)
    // tax_pct is stored even when 0, so "no tax at booking time" is itself
    // frozen; the amounts stay null only when there's no price (quote mode).
    const taxPct = (settings as { tax_enabled?: boolean }).tax_enabled
      ? Number((settings as { tax_pct?: number }).tax_pct) || 0
      : 0;
    const taxAmount =
      finalTotal != null ? Number(((finalTotal * taxPct) / 100).toFixed(2)) : null;
    const totalWithTax =
      finalTotal != null && taxAmount != null
        ? Number((finalTotal + taxAmount).toFixed(2))
        : null;
    const finalDeposit =
      totalWithTax != null && depositPct > 0
        ? Number(((totalWithTax * depositPct) / 100).toFixed(2))
        : null;

    // Price drift — the DJ edited packages / a sale ended / the promo code
    // expired between page load and submit. Ask the booker to review
    // instead of silently booking at a different number.
    if (hasExpected && totalsDiffer(expectedTotal, finalTotal)) {
      return NextResponse.json(
        {
          error: 'Pricing for this booking has changed since you loaded the page. Please review the updated price and try again.',
          code: 'PRICE_MISMATCH',
        },
        { status: 409 },
      );
    }

    const eventDetails = buildEventDetails(eventType, {
      subType: eventSubType,
      birthdayAge,
      surprise,
    });

    const parsedGuests = guests ? parseInt(guests, 10) : NaN;

    const insertPayload = {
      dj_id: djRow.id,
      requester_id: user.id, // session-derived — NEVER from the body
      dj_slug: djSlug,
      booking_type: 'mobile',
      event_date: dateKey,
      event_type: eventType === 'other' ? (eventTypeOther.trim() || 'other') : eventType,
      event_details: eventDetails,
      venue_name: venueName,
      venue_address: venueAddress,
      venue_lat: venueLat,
      venue_lon: venueLon,
      room_details: room.trim() || null,
      // parseInt(guests) like the client did — supabase-js serialized NaN
      // to null on the wire, so NaN → null here matches the old behavior.
      guest_count: Number.isFinite(parsedGuests) ? parsedGuests : null,
      start_time: startTime,
      end_time: endTime || null,
      phone,
      cocktail_needed: wantsCocktail ? true : (isWedding ? !!cocktailNeeded : null),
      cocktail_start_time: wantsCocktail ? cocktailStart : null,
      cocktail_same_room: wantsCocktail ? !!cocktailSameRoom : null,
      // Cocktail add-on snapshot: the separately-charged cocktail price
      // (0 when bundled/included) and the package's included flag.
      cocktail_price: wantsCocktail && finalPrice.cocktailAddon > 0 ? finalPrice.cocktailAddon : null,
      cocktail_included: wantsCocktail
        ? (selectedPkg?.cocktailIncluded !== false)
        : null,
      setup_hours: selectedPkg?.setupHours
        ? String(selectedPkg.setupHours)
        : null,
      package_title: selectedPkg?.title || null,
      package_details: selectedPkg?.details || null,
      // Snapshot the selected package's photos (main + extras) so the
      // booking's photo view doesn't change if the DJ edits the package later.
      package_photos: JSON.stringify(
        [
          selectedPkg?.photo,
          ...(((selectedPkg as { photos?: string[] } | null)?.photos) ?? []),
        ].filter((u): u is string => !!u)
      ),
      package_category: cat,
      package_index: hasAnyPackages ? packageIndex : null,
      quoted_rate: finalTotal,
      deposit_pct: depositPct || null,
      deposit_amount: finalDeposit,
      // Frozen tax snapshot (see above) — every display surface and the
      // contract read THESE, never the DJ's current settings.
      tax_pct: taxPct,
      tax_amount: taxAmount,
      total_with_tax: totalWithTax,
      // Discount snapshot — what was applied, for the DJ's records + usage
      // history. original_rate keeps the pre-discount total for reference.
      original_rate: finalDiscount.amount > 0 ? finalPrice.price : null,
      discount_code: finalDiscount.kind === 'code' ? promoCode : null,
      discount_label: finalDiscount.amount > 0 ? finalDiscount.label : null,
      discount_amount: finalDiscount.amount > 0 ? finalDiscount.amount : null,
      overtime_rate: !finalPrice.isQuote && selectedPkg && Number(selectedPkg.overtime) > 0
        ? Number(selectedPkg.overtime)
        : null,
      is_quote: finalPrice.isQuote,
      notes: message.trim() || null,
      status: 'pending',
    };

    // Insert with the SESSION client (not admin) so bookings RLS applies
    // exactly as it did for the old browser-side insert.
    const { data: createdRow, error: insertError } = await supabase
      .from('bookings')
      .insert(insertPayload as unknown as never)
      .select('id')
      .single<{ id: string }>();
    if (insertError || !createdRow) {
      return bad(insertError?.message || 'Booking insert failed.', 500);
    }

    // Server-computed money snapshot — the client uses this (not its own
    // preview) for the notification emails so they always match the DB row.
    return NextResponse.json({
      ok: true,
      id: createdRow.id,
      booking: {
        quoted_rate: insertPayload.quoted_rate,
        original_rate: insertPayload.original_rate,
        discount_code: insertPayload.discount_code,
        discount_label: insertPayload.discount_label,
        discount_amount: insertPayload.discount_amount,
        deposit_pct: insertPayload.deposit_pct,
        deposit_amount: insertPayload.deposit_amount,
        tax_pct: insertPayload.tax_pct,
        tax_amount: insertPayload.tax_amount,
        total_with_tax: insertPayload.total_with_tax,
        is_quote: insertPayload.is_quote,
        cocktail_price: insertPayload.cocktail_price,
      },
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // CLUB branch — rate/offer-based bookings (ClubBookingForm)
  // ────────────────────────────────────────────────────────────────────
  const country = str(body.country) || 'US';
  const venueType = str(body.venueType);
  const setType = str(body.setType);
  const equipment = str(body.equipment);
  const venueEquipDetail = str(body.venueEquipDetail);
  const offerAmountRaw = str(body.offerAmount);
  const notes = str(body.notes);

  if (venueType !== 'bar' && venueType !== 'club') return bad('Please select Bar or Club.');
  if (!setType) return bad('Please select a set type.');
  if (!endTime) return bad('Please select an end time.');
  if (!['sound_system', 'decks_only', 'venue_provides'].includes(equipment)) {
    return bad('Please select an equipment option.');
  }

  // Equipment-supported check — same rules the form enforces:
  //   sound_system   → DJ supports it if equip_full
  //   decks_only     → DJ supports it if equip_full OR equip_decks
  //   venue_provides → always supported
  const equipmentSupported =
    equipment === 'venue_provides' ||
    (equipment === 'sound_system' && !!settings.equip_full) ||
    (equipment === 'decks_only' && !!(settings.equip_full || settings.equip_decks));
  if (!equipmentSupported) {
    return bad("This DJ isn't able to bring that equipment. Please pick another option.");
  }

  // Per-day data (rate overrides etc.) + rate recomputation — the same
  // computeRate the form uses for its live preview.
  const dayData: DayData = settings.booking_days?.[dateKey] || {};
  const rateInfo = computeRate(settings, dayData, equipment, startTime, endTime);
  const isOffers = rateInfo.rateType === 'offers';

  // Offer validation — the offer is booker-chosen money, so it can only be
  // bounded, not recomputed. FIX over the old client code: `offerNum &&
  // !isNaN(offerNum)` allowed negative offers; require > 0 and a sane cap.
  let offerNum: number | null = null;
  if (isOffers) {
    if (!offerAmountRaw.trim()) return bad('Please enter your offer amount.');
    const n = Number(offerAmountRaw.trim());
    if (!Number.isFinite(n) || n <= 0) {
      return bad('Please enter a valid offer amount greater than 0.');
    }
    if (n > MAX_OFFER) {
      return bad('Offer amount is too large. Please enter a realistic offer.');
    }
    offerNum = n;
  }

  // For flat-rate bookings, rateInfo.rate IS the total. For hourly
  // bookings, the total is rate × hours (rateInfo.hourlyTotal). quoted_rate
  // stores the FULL price agreed for the gig.
  const computedTotal = !isOffers && rateInfo.rate
    ? (rateInfo.rateType === 'hourly' && rateInfo.hourlyTotal
        ? rateInfo.hourlyTotal
        : rateInfo.rate)
    : null;

  // Apply discount to the computed total (sale/promo). quoted_rate stores
  // the discounted price; original_rate keeps the pre-discount total.
  const clubFinalDiscount: DiscountResult = computedTotal != null
    ? computeDiscount(Number(computedTotal), settings, promoCode)
    : { amount: 0, kind: null, label: '' };
  const computedTotalDiscounted = computedTotal != null
    ? Math.max(0, Number(computedTotal) - clubFinalDiscount.amount)
    : null;

  // Quote mode — DJ has booking enabled and (supported) equipment picked,
  // but no rate configured for it and not in offers mode.
  const isQuoteMode = !isOffers && rateInfo.rate == null;

  // Deposit — the DJ's standing club deposit %, applied to the final
  // (discounted) total. club_deposit_pct isn't in the BookingSettings type
  // yet (same cast the form uses).
  const clubDepositPct = (settings as { club_deposit_pct?: number }).club_deposit_pct || 0;

  // Sales-tax SNAPSHOT — same frozen-at-creation rule as the mobile branch:
  // tax on the post-discount total, to the cent; deposit on the
  // TAX-INCLUSIVE total, to the cent. (The old code took the deposit on the
  // PRE-tax total AND Math.round'ed it to whole dollars — two ways to
  // disagree with the number the form showed.) Offers-mode bookings have no
  // agreed price yet, so the amounts stay null until a price exists;
  // tax_pct is still frozen now.
  const clubTaxPct = (settings as { tax_enabled?: boolean }).tax_enabled
    ? Number((settings as { tax_pct?: number }).tax_pct) || 0
    : 0;
  const clubTaxAmount = computedTotalDiscounted != null
    ? Number(((computedTotalDiscounted * clubTaxPct) / 100).toFixed(2))
    : null;
  const clubTotalWithTax = computedTotalDiscounted != null && clubTaxAmount != null
    ? Number((computedTotalDiscounted + clubTaxAmount).toFixed(2))
    : null;
  const clubDepositAmount = (clubDepositPct > 0 && clubTotalWithTax != null)
    ? Number(((clubTotalWithTax * clubDepositPct) / 100).toFixed(2))
    : null;

  // Price drift check (see mobile branch). For offers-mode bookings the
  // client previews no quoted total, so expectedTotal is null on both sides.
  if (hasExpected && totalsDiffer(expectedTotal, computedTotalDiscounted)) {
    return NextResponse.json(
      {
        error: 'Pricing for this booking has changed since you loaded the page. Please review the updated price and try again.',
        code: 'PRICE_MISMATCH',
      },
      { status: 409 },
    );
  }

  // Initial negotiation log entry — seeded at insert time so the history
  // modal can replay the full thread (the FIRST price is the booker's offer
  // or the flat/hourly total). Quote-mode bookings have no price yet and
  // get an empty log; sendDraftQuote seeds it later.
  const initialPrice = isOffers && offerNum && !isNaN(offerNum)
    ? offerNum
    : computedTotalDiscounted;
  const initialLog: Array<{ from: 'dj' | 'booker'; amount: number; message: string; created_at: string }> =
    initialPrice != null
      ? [{
          from: 'booker' as const,
          amount: initialPrice,
          message: notes.trim() || '',
          created_at: new Date().toISOString(),
        }]
      : [];

  const insertPayload = {
    dj_id: djRow.id,
    requester_id: user.id, // session-derived — NEVER from the body
    dj_slug: djSlug,
    booking_type: 'club',
    event_date: dateKey,
    country,
    venue_type: venueType,
    set_type: setType,
    venue_name: venueName,
    venue_address: venueAddress,
    phone,
    venue_lat: venueLat,
    venue_lon: venueLon,
    start_time: startTime,
    end_time: endTime,
    equipment,
    venue_equip_detail: venueEquipDetail.trim() || null,
    offer_amount: isOffers && offerNum && !isNaN(offerNum) ? offerNum : null,
    // Full computed total — flat: per-event rate; hourly: rate × hours;
    // offers: null (only the visitor's offer exists).
    quoted_rate: computedTotalDiscounted,
    original_rate: clubFinalDiscount.amount > 0 ? Number(computedTotal) : null,
    discount_code: clubFinalDiscount.kind === 'code' ? promoCode : null,
    discount_label: clubFinalDiscount.amount > 0 ? clubFinalDiscount.label : null,
    discount_amount: clubFinalDiscount.amount > 0 ? clubFinalDiscount.amount : null,
    deposit_pct: clubDepositPct > 0 ? clubDepositPct : null,
    deposit_amount: clubDepositAmount,
    // Frozen tax snapshot (see above) — every display surface and the
    // contract read THESE, never the DJ's current settings.
    tax_pct: clubTaxPct,
    tax_amount: clubTaxAmount,
    total_with_tax: clubTotalWithTax,
    currency: rateInfo.currency,
    notes: notes.trim() || null,
    is_quote: isQuoteMode,
    negotiation_log: initialLog,
    status: 'pending',
  };

  const { data: createdRow, error: insertError } = await supabase
    .from('bookings')
    .insert(insertPayload as unknown as never)
    .select('id')
    .single<{ id: string }>();
  if (insertError || !createdRow) {
    return bad(insertError?.message || 'Booking insert failed.', 500);
  }

  return NextResponse.json({
    ok: true,
    id: createdRow.id,
    booking: {
      offer_amount: insertPayload.offer_amount,
      quoted_rate: insertPayload.quoted_rate,
      original_rate: insertPayload.original_rate,
      discount_code: insertPayload.discount_code,
      discount_label: insertPayload.discount_label,
      discount_amount: insertPayload.discount_amount,
      deposit_pct: insertPayload.deposit_pct,
      deposit_amount: insertPayload.deposit_amount,
      tax_pct: insertPayload.tax_pct,
      tax_amount: insertPayload.tax_amount,
      total_with_tax: insertPayload.total_with_tax,
      is_quote: insertPayload.is_quote,
      currency: insertPayload.currency,
    },
  });
}
