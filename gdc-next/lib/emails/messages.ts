// lib/emails/messages.ts
//
// Pure per-type email body builders extracted from app/api/send-email/route.ts.
// Each function takes already-computed plain inputs (strings/booleans/numbers/
// small objects the route's branch has in local vars — including the RESULTS of
// any IO it did, e.g. an itemized bill box) and returns the inner HTML body
// string. The route keeps the emailTemplate(...) wrap, the subject, recipient
// resolution, preference gating, the Resend send, SMS and all responses.
//
// NOTHING in this file performs IO: no async, no fetch, no supabase, no env
// reads, no Resend. The HTML is byte-identical to what the route produced
// inline — the only change is referencing parameters instead of branch locals.

import { SITE_URL } from '@/lib/emails/constants';
import {
  escHtml, fmtTimeRange, eventTypeLabel,
  statusColor, statusLabel, currencySymbol, setTypeLabel, venueTypeLabel,
} from '@/lib/emails/format';
import {
  ctaButton, bookingInfoBox, mobileBookingRequestBox, billBreakdownBox,
} from '@/lib/emails/layout';
import { googleCalendarLink } from '@/lib/ics';

// ── 1. WELCOME ─────────────────────────────────────────────────────────
export function buildWelcomeBody(opts: {
  isDj: boolean;
  recipientName: string | undefined;
  recipientSlug: string | undefined;
  showSubscribe: boolean;
}): string {
  const { isDj, recipientName, recipientSlug, showSubscribe } = opts;
  const subscribeBlock = showSubscribe
    ? `
        <div style="margin:24px 0 24px;padding:18px 20px;background:#fff7e6;border:1px solid #f0d9a8;border-radius:8px;">
          <p style="margin:0 0 6px;color:#7a5a13;font-weight:600;font-size:13px;letter-spacing:.04em;text-transform:uppercase;">Activate Bookings</p>
          <p style="margin:0 0 14px;color:#7a5a13;font-size:13px;line-height:1.6;">You're on the free plan. Subscribe to activate the booking feature — it lets you accept bookings directly through the site and manage requests, contracts, deposits, and payments all in one place.</p>
          ${ctaButton(`${SITE_URL}/subscribe`, 'Subscribe & Activate Bookings')}
        </div>`
    : '';

  // For DJs only: include their shareable public profile link so they
  // can drop it into bios, socials, etc. right out of the gate.
  const profileShareBlock = (isDj && recipientSlug)
    ? `
        <div style="margin:24px 0 24px;padding:16px 20px;background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;">
          <p style="margin:0 0 6px;color:#1a1a2e;font-weight:600;font-size:13px;letter-spacing:.04em;text-transform:uppercase;">Your Profile Link</p>
          <p style="margin:0 0 12px;color:#666;font-size:13px;">Share this anywhere — bios, socials, business cards. Hosts and venues can book you directly from it.</p>
          <p style="margin:0 0 14px;word-break:break-all;"><a href="${SITE_URL}/${encodeURIComponent(recipientSlug)}" style="color:#0a6f61;text-decoration:none;font-weight:600;">${SITE_URL}/${escHtml(recipientSlug)}</a></p>
          ${ctaButton(`${SITE_URL}/${encodeURIComponent(recipientSlug)}`, 'View My Profile')}
        </div>`
    : '';

  // DJs get a dedicated welcome: DJ-focused copy + their profile link box,
  // and NO dashboard button. Hosts/venues keep the generic welcome with the
  // "Open Dashboard" CTA.
  const welcomeBody = isDj
    ? `
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Welcome${recipientName ? `, ${escHtml(recipientName)}` : ''}!</h2>
        <p style="color:#666666;margin-bottom:8px;">You're officially on the Global DJ Connect network.</p>
        <p style="color:#666666;margin-bottom:24px;">Build your profile, manage &amp; automate booking requests, share your availability calendar, organize your schedule — everything you need in one place.</p>
        ${subscribeBlock}
        ${profileShareBlock}
      `
    : `
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Welcome${recipientName ? `, ${escHtml(recipientName)}` : ''}!</h2>
        <p style="color:#666666;margin-bottom:8px;">You're officially on the Global DJ Connect network.</p>
        <p style="color:#666666;margin-bottom:24px;">Browse DJs, send booking requests, manage gigs — everything you need is in your dashboard.</p>
        ${ctaButton(`${SITE_URL}`, 'Open Dashboard')}
      `;
  return welcomeBody;
}

// ── 2. INBOX NOTIFICATION ──────────────────────────────────────────────
export function buildInboxNotificationBody(opts: {
  recipientName: string | undefined;
  senderName: string | undefined;
  subject: string;
  message: string;
}): string {
  const { recipientName, senderName, subject, message } = opts;
  return `
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">New Message</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(recipientName || 'there')}, you have a new message from <strong>${escHtml(senderName || 'a Global DJ Connect user')}</strong>.</p>
        <div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
          <p style="margin:0 0 8px;color:#1a1a2e;font-size:13px;font-weight:600;">${escHtml(subject)}</p>
          <p style="margin:0;color:#666;font-size:13px;line-height:1.6;white-space:pre-wrap;">${escHtml(message)}</p>
        </div>
        ${ctaButton(`${SITE_URL}/inbox`, 'View Inbox')}
      `;
}

// ── 3. CLAIM REQUEST ───────────────────────────────────────────────────
export function buildClaimRequestBody(opts: {
  claimerName: string | undefined;
  claimerEmail: string | undefined;
  profileName: string | undefined;
  profileSlug: string | undefined;
  message: string;
}): string {
  const { claimerName, claimerEmail, profileName, profileSlug, message } = opts;
  return `
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">New Profile Claim</h2>
        <p style="color:#666;margin-bottom:16px;"><strong>${escHtml(claimerName || 'Someone')}</strong> (${escHtml(claimerEmail || 'no email')}) has claimed the profile <strong>${escHtml(profileName || profileSlug || '?')}</strong>.</p>
        ${message ? `<div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:24px;"><p style="margin:0;color:#666;font-size:13px;line-height:1.6;white-space:pre-wrap;">${escHtml(message)}</p></div>` : ''}
        ${ctaButton(`${SITE_URL}/admin`, 'Review in Admin Panel')}
      `;
}

// ── 4. CLAIM RECEIVED ──────────────────────────────────────────────────
export function buildClaimReceivedBody(opts: {
  claimerName: string | undefined;
  profileName: string | undefined;
}): string {
  const { claimerName, profileName } = opts;
  return `
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Claim Received</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(claimerName || 'there')}, we got your claim for <strong>${escHtml(profileName || 'your profile')}</strong>. We'll review it and get back to you shortly.</p>
      `;
}

// ── 5. BOOKING REQUEST (DJ-facing) ─────────────────────────────────────
export function buildBookingRequestBody(opts: {
  djName: string | undefined;
  requesterName: string | undefined;
  eventType: string | undefined;
  eventDetails: string | undefined;
  packageTitle: string | undefined;
  packageDetails: string | undefined;
  eventDate: string | undefined;
  startTime: string | undefined;
  endTime: string | undefined;
  venueName: string | undefined;
  venueAddress: string | undefined;
  isWedding: boolean;
  cocktailNeeded: boolean;
  cocktailStart: string | undefined;
  cocktailSameRoom: boolean;
  ceremonyNeeded: boolean;
  ceremonyStart: string | undefined;
  ceremonySameRoom: boolean;
  setupHours: string | null;
  setType: string | undefined;
  venueType: string | undefined;
  equipment: string | undefined;
  offerAmount: number | string | undefined;
  quotedRate: number | string | undefined;
  offerCurrency: string;
  totalHours: number | string | undefined;
  hourlyRate: number | string | undefined;
  discAmt: number;
  origRate: number | null;
  discLabel: string;
  dateStr: string;
  timeStr: string;
  billBox: string;
}): string {
  const {
    djName, requesterName, eventType, eventDetails, packageTitle, packageDetails,
    eventDate, startTime, endTime, venueName, venueAddress,
    isWedding, cocktailNeeded, cocktailStart, cocktailSameRoom,
    ceremonyNeeded, ceremonyStart, ceremonySameRoom, setupHours,
    setType, venueType, equipment,
    offerAmount, quotedRate, offerCurrency, totalHours, hourlyRate,
    discAmt, origRate, discLabel, dateStr, timeStr, billBox,
  } = opts;
  const hasOffer = offerAmount != null && String(offerAmount).trim() !== '';
  const hasQuoted = quotedRate != null && String(quotedRate).trim() !== '';
  const rateValueNum = hasOffer ? Number(offerAmount)
    : hasQuoted ? Number(quotedRate)
    : null;
  // Per-hour rate — present only for hourly-rate bookings. When set, the
  // rate box shows the "$X/hr × N hr" breakdown beside the total.
  const hourlyRateNum = hourlyRate != null && String(hourlyRate).trim() !== ''
    ? Number(hourlyRate) : null;

  // Discount breakdown — when the booking used a sale/promo code, show the
  // original price + which discount, as the rate's parenthetical.
  const discountBreakdown =
    discAmt > 0 && origRate != null
      ? `was ${currencySymbol(offerCurrency)}${origRate.toLocaleString()} — ${escHtml(discLabel)}, save ${currencySymbol(offerCurrency)}${discAmt.toLocaleString()}`
      : undefined;

  // Set type (club) — "Event Type" labelling belongs to mobile bookings.
  // setTypeLabel / venueTypeLabel title-case the stored value.
  const setTypeText = setTypeLabel(setType);
  const venueTypeDisplay = venueTypeLabel(venueType);
  // Equipment — booker picks which gear the DJ supplies. Maps the stored
  // code to the same wording shown in the booking form.
  const equipmentLabel = ({
    sound_system: 'DJ provides system + decks',
    decks_only: 'DJ provides decks',
    venue_provides: 'Venue provides all',
  } as Record<string, string>)[equipment || ''] || '';
  // Address row — link to Google Maps so the DJ/host can tap straight
  // through to directions.
  const mapsHref = venueAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venueAddress)}`
    : '';
  const row = (label: string, value: string) =>
    `<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">${label}:</strong> ${value}</p>`;
  const lastRow = (label: string, value: string) =>
    `<p style="margin:0;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">${label}:</strong> ${value}</p>`;

  // Mobile vs club: the club booking form always sends a setType; the
  // mobile form never does.
  const isMobileBooking = !setType;

  // DJ-facing rate box. Mobile and club share this — for mobile it
  // renders the "respond with your quote" prompt when no rate is set.
  const djRateBox = rateValueNum != null && !isNaN(rateValueNum)
    ? `<div style="background:#eafaf4;border:1px solid #b6e8d6;border-radius:8px;padding:14px 20px;margin-bottom:24px;">
           <p style="margin:0;color:#1a1a2e;font-size:14px;"><strong>${hasOffer ? 'Offered Rate' : 'Quoted Rate'}:</strong> ${currencySymbol(offerCurrency)}${escHtml(String(rateValueNum.toLocaleString()))} ${escHtml(offerCurrency)}${
           totalHours != null && String(totalHours).trim() !== '' && !hasOffer
             ? ` <span style="color:#666;">(${escHtml(String(totalHours))} hr total)</span>`
             : ''
         }</p>${
           hourlyRateNum != null && !isNaN(hourlyRateNum) && totalHours != null && String(totalHours).trim() !== ''
             ? `<p style="margin:6px 0 0;color:#666;font-size:13px;">${currencySymbol(offerCurrency)}${escHtml(String(hourlyRateNum.toLocaleString()))}/hr × ${escHtml(String(totalHours))} hr</p>`
             : ''
         }
         </div>`
    : `<div style="background:#fff7e6;border:1px solid #f0d9a8;border-radius:8px;padding:14px 20px;margin-bottom:24px;">
           <p style="margin:0;color:#7a5a13;font-size:14px;">This request doesn't include a set rate. Open the booking request and <strong>respond with your quote</strong> to move it forward.</p>
         </div>`;

  // Mobile bookings: card built by the shared helper with the fixed
  // field order, package details, and wedding/cocktail rows.
  const mobileCard = mobileBookingRequestBox({
    eventTypeText: eventTypeLabel(eventType),
    eventDetails: eventDetails || undefined,
    date: eventDate,
    startTime,
    endTime,
    venueName,
    venueAddress,
    packageTitle,
    packageDetails,
    rateLabel: rateValueNum != null && !isNaN(rateValueNum) ? 'Quoted Rate' : undefined,
    rateValue: rateValueNum != null && !isNaN(rateValueNum)
      ? `${currencySymbol(offerCurrency)}${rateValueNum.toLocaleString()} ${offerCurrency}`
      : undefined,
    rateBreakdown: discountBreakdown,
    isWedding,
    cocktailNeeded,
    cocktailStart,
    cocktailSameRoom,
    ceremonyNeeded,
    ceremonyStart,
    ceremonySameRoom,
    setupHours,
  });

  const djBody = isMobileBooking
    ? `${mobileCard}${
        rateValueNum != null && !isNaN(rateValueNum)
          ? ''
          : `<div style="background:#fff7e6;border:1px solid #f0d9a8;border-radius:8px;padding:14px 20px;margin-bottom:24px;">
                 <p style="margin:0;color:#7a5a13;font-size:14px;">This request doesn't include a set rate. Open the booking request and <strong>respond with your quote</strong> to move it forward.</p>
               </div>`
      }`
    : `<div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
          ${row('Date', dateStr)}
          ${timeStr !== '—' ? row('Time', escHtml(timeStr)) : ''}
          ${packageTitle ? row('Package', escHtml(packageTitle)) : ''}
          ${eventTypeLabel(eventType) ? row('Event Type', escHtml(eventTypeLabel(eventType))) : ''}
          ${venueName ? row('Venue', escHtml(venueName)) : ''}
          ${venueAddress ? row('Address', `<a href="${mapsHref}" style="color:#0a7d5a;text-decoration:underline;">${escHtml(venueAddress)}</a>`) : ''}
          ${venueTypeDisplay ? row('Venue Type', escHtml(venueTypeDisplay)) : ''}
          ${setTypeText ? row('Set Type', escHtml(setTypeText)) : ''}
          ${equipmentLabel ? lastRow('Equipment', escHtml(equipmentLabel)) : ''}
        </div>
        ${djRateBox}`;

  return `
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">New Booking Request</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(djName || 'there')}, you have a new booking request from <strong>${escHtml(requesterName || 'a booker')}</strong>.</p>
        <p style="color:#8a6d00;background:#fff8e1;border:1px solid #ffe08a;border-radius:8px;padding:10px 14px;margin:0 0 16px;font-size:13px;line-height:1.6;">Please respond within <strong>5 days</strong> (or by the event date, whichever comes first), or this request will be automatically declined.</p>
        ${djBody}
        ${billBox}
        ${ctaButton(`${SITE_URL}/booking-requests`, 'View Booking Request')}
      `;
}

// ── 5b. BOOKING REQUEST CONFIRMATION (booker-facing) ───────────────────
export function buildBookingRequestConfirmationBody(opts: {
  djName: string | undefined;
  requesterName: string | undefined;
  eventType: string | undefined;
  eventDetails: string | undefined;
  packageTitle: string | undefined;
  packageDetails: string | undefined;
  eventDate: string | undefined;
  startTime: string | undefined;
  endTime: string | undefined;
  venueName: string | undefined;
  venueAddress: string | undefined;
  isWedding: boolean;
  cocktailNeeded: boolean;
  cocktailStart: string | undefined;
  cocktailSameRoom: boolean;
  ceremonyNeeded: boolean;
  ceremonyStart: string | undefined;
  ceremonySameRoom: boolean;
  setupHours: string | null;
  setType: string | undefined;
  venueType: string | undefined;
  equipment: string | undefined;
  offerAmount: number | string | undefined;
  quotedRate: number | string | undefined;
  confCurrency: string;
  confTotalHours: number | string | undefined;
  confHourlyRate: number | string | undefined;
  confDiscAmt: number;
  confOrigRate: number | null;
  confDiscLabel: string;
  cocktailPrice: unknown;
  ceremonyPrice: unknown;
  taxPct: unknown;
  taxAmount: unknown;
  totalWithTax: unknown;
  depositPct: unknown;
  depositAmount: unknown;
}): string {
  const {
    djName, requesterName, eventType, eventDetails, packageTitle, packageDetails,
    eventDate, startTime, endTime, venueName, venueAddress,
    isWedding, cocktailNeeded, cocktailStart, cocktailSameRoom,
    ceremonyNeeded, ceremonyStart, ceremonySameRoom, setupHours,
    setType, venueType, equipment,
    offerAmount, quotedRate, confCurrency, confTotalHours, confHourlyRate,
    confDiscAmt, confOrigRate, confDiscLabel,
    cocktailPrice, ceremonyPrice, taxPct, taxAmount, totalWithTax, depositPct, depositAmount,
  } = opts;
  // Mobile vs club — same discriminator the DJ-side email uses.
  const isMobileBooking = !setType;
  const confHasOffer = offerAmount != null && String(offerAmount).trim() !== '';
  const confHasQuoted = quotedRate != null && String(quotedRate).trim() !== '';
  const confRateNum = confHasOffer ? Number(offerAmount)
    : confHasQuoted ? Number(quotedRate)
    : null;
  const confHourlyNum = confHourlyRate != null && String(confHourlyRate).trim() !== ''
    ? Number(confHourlyRate) : null;
  const confDiscountBreakdown =
    confDiscAmt > 0 && confOrigRate != null
      ? `was ${currencySymbol(confCurrency)}${confOrigRate.toLocaleString()} — ${escHtml(confDiscLabel)}, save ${currencySymbol(confCurrency)}${confDiscAmt.toLocaleString()}`
      : undefined;
  const confEquipmentLabel = ({
    sound_system: 'DJ provides system + decks',
    decks_only: 'DJ provides decks',
    venue_provides: 'Venue provides all',
  } as Record<string, string>)[equipment || ''] || '';
  // Mobile bookings render the identical card the DJ receives, via the
  // shared helper. Club bookings keep the existing bookingInfoBox layout.
  const confCard = isMobileBooking
    ? mobileBookingRequestBox({
        eventTypeText: eventTypeLabel(eventType),
        eventDetails: eventDetails || undefined,
        date: eventDate,
        startTime,
        endTime,
        venueName,
        venueAddress,
        packageTitle,
        packageDetails,
        rateLabel: confRateNum != null && !isNaN(confRateNum) ? 'Quoted Rate' : undefined,
        rateValue: confRateNum != null && !isNaN(confRateNum)
          ? `${currencySymbol(confCurrency)}${confRateNum.toLocaleString()} ${confCurrency}`
          : undefined,
        rateBreakdown: confDiscountBreakdown,
        isWedding,
        cocktailNeeded,
        cocktailStart,
        cocktailSameRoom,
        ceremonyNeeded,
        ceremonyStart,
        ceremonySameRoom,
        setupHours,
      })
    : bookingInfoBox({
        eventTypeText: eventTypeLabel(eventType),
        setTypeText: setTypeLabel(setType),
        date: eventDate,
        timeRange: fmtTimeRange(startTime, endTime),
        packageTitle,
        venueTypeText: venueTypeLabel(venueType),
        venueName,
        venueAddress,
        equipmentText: confEquipmentLabel,
        rateLabel: confRateNum != null && !isNaN(confRateNum)
          ? (confHasOffer ? 'Offered Rate' : 'Quoted Rate')
          : undefined,
        rateValue: confRateNum != null && !isNaN(confRateNum)
          ? `${currencySymbol(confCurrency)}${confRateNum.toLocaleString()} ${confCurrency}${
              confTotalHours != null && String(confTotalHours).trim() !== '' && !confHasOffer
                ? ` (${confTotalHours} hr total)` : ''
            }`
          : undefined,
        rateBreakdown: confHourlyNum != null && !isNaN(confHourlyNum)
          && confTotalHours != null && String(confTotalHours).trim() !== ''
          ? `${currencySymbol(confCurrency)}${confHourlyNum.toLocaleString()}/hr × ${confTotalHours} hr`
          : undefined,
      });
  // Mobile quote-style requests: tell the booker the DJ will reply with
  // an offer, matching the prompt the DJ sees on their side.
  const confQuoteNote = isMobileBooking && (confRateNum == null || isNaN(confRateNum))
    ? `<div style="background:#fff7e6;border:1px solid #f0d9a8;border-radius:8px;padding:14px 20px;margin:24px 0;">
           <p style="margin:0;color:#7a5a13;font-size:14px;">This request doesn't include a set rate — the DJ will <strong>respond with an offer</strong>.</p>
         </div>`
    : '';
  // Full bill breakdown for a package-priced (auto-quoted) booking.
  const confBill = billBreakdownBox({
    quotedRate: confRateNum != null && !isNaN(confRateNum) ? confRateNum : null,
    cocktailPrice: cocktailPrice != null ? Number(cocktailPrice) : null,
    ceremonyPrice: ceremonyPrice != null ? Number(ceremonyPrice) : null,
    taxPct: taxPct != null ? Number(taxPct) : null,
    taxAmount: taxAmount != null ? Number(taxAmount) : null,
    totalWithTax: totalWithTax != null ? Number(totalWithTax) : null,
    depositPct: depositPct != null ? Number(depositPct) : null,
    depositAmount: depositAmount != null ? Number(depositAmount) : null,
  }, currencySymbol(confCurrency), confCurrency);
  return `
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Booking Request Sent</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml((requesterName || '').trim().split(' ')[0] || 'there')}, your booking request has been sent to <strong>${escHtml(djName || 'the DJ')}</strong>. They'll respond shortly — you'll get an email when they do.</p>
        <p style="color:#8a6d00;background:#fff8e1;border:1px solid #ffe08a;border-radius:8px;padding:10px 14px;margin:0 0 16px;font-size:13px;line-height:1.6;">The DJ has up to <strong>5 days</strong> (or until your event date, whichever comes first) to respond. If they send you a quote or offer, you'll then have <strong>5 days</strong> to approve or decline it — otherwise it's automatically declined and you can send a new request anytime.</p>
        ${confCard}
        ${confBill}
        ${confQuoteNote}
        ${ctaButton(`${SITE_URL}/booking-requests`, 'View Your Request')}
      `;
}

// ── BOOKING CANCELLED (inner body; route sends to each party) ──────────
export function buildBookingCancelledBody(intro: string, infoCard: string): string {
  return `
      <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Booking Request Cancelled</h2>
      <p style="color:#666;margin-bottom:20px;">${intro}</p>
      ${infoCard}
      ${ctaButton(`${SITE_URL}/booking-requests`, 'View Booking Requests')}
    `;
}

// ── OFFER SENT (inner body; route sends to each party) ─────────────────
export function buildOfferSentBody(intro: string, cta: string, infoCard: string, billBox: string, extraRows: string): string {
  return `
      <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">DJ Offer Sent</h2>
      <p style="color:#666;margin-bottom:20px;">${intro}</p>
      ${infoCard}
      ${billBox}
      ${extraRows}
      ${cta}
    `;
}

// ── 6. BOOKING STATUS (club) ───────────────────────────────────────────
export function buildBookingStatusBody(opts: {
  requesterName: string | undefined;
  djName: string | undefined;
  status: string;
  dateStr: string;
  venueName: string | undefined;
  billBox: string;
}): string {
  const { requesterName, djName, status, dateStr, venueName, billBox } = opts;
  return `
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Booking ${statusLabel(status).charAt(0).toUpperCase() + statusLabel(status).slice(1)}</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml((requesterName || '').trim().split(' ')[0] || 'there')}, your booking request with <strong>${escHtml(djName || 'the DJ')}</strong> was <span style="color:${statusColor(status)};font-weight:600;">${escHtml(statusLabel(status))}</span>.</p>
        <div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
          <p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Date:</strong> ${dateStr}</p>
          ${venueName ? `<p style="margin:0;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Venue:</strong> ${escHtml(venueName)}</p>` : ''}
        </div>
        ${billBox}
        ${ctaButton(`${SITE_URL}/booking-requests`, 'View Booking')}
      `;
}

// ── 7. MOB BOOKING STATUS (mobile) ─────────────────────────────────────
export function buildMobBookingStatusBody(opts: {
  requesterName: string | undefined;
  djName: string | undefined;
  status: string;
  dateStr: string;
  venueName: string | undefined;
  billBox: string;
}): string {
  const { requesterName, djName, status, dateStr, venueName, billBox } = opts;
  return `
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Booking ${statusLabel(status).charAt(0).toUpperCase() + statusLabel(status).slice(1)}</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml((requesterName || '').trim().split(' ')[0] || 'there')}, your mobile booking request with <strong>${escHtml(djName || 'the DJ')}</strong> was <span style="color:${statusColor(status)};font-weight:600;">${escHtml(statusLabel(status))}</span>.</p>
        <div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
          <p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Date:</strong> ${dateStr}</p>
          ${venueName ? `<p style="margin:0;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Venue:</strong> ${escHtml(venueName)}</p>` : ''}
        </div>
        ${billBox}
        ${ctaButton(`${SITE_URL}/booking-requests`, 'View Booking')}
      `;
}

// ── 8. BOOKING COUNTER ─────────────────────────────────────────────────
export function buildBookingCounterBody(opts: {
  recipientName: string | undefined;
  senderName: string | undefined;
  setType: string | undefined;
  eventDate: string | undefined;
  startTime: string | undefined;
  endTime: string | undefined;
  packageTitle: string | undefined;
  venueType: string | undefined;
  venueName: string | undefined;
  venueAddress: string | undefined;
  counterRate: number | undefined;
  counterMessage: string | undefined;
  currency: string;
  sym: string;
  billBox: string;
}): string {
  const { recipientName, senderName, setType, eventDate, startTime, endTime, packageTitle, venueType, venueName, venueAddress, counterRate, counterMessage, currency, sym, billBox } = opts;
  return `
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">New Counter Offer</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml((recipientName || '').trim().split(' ')[0] || 'there')}, <strong>${escHtml(senderName || 'the other party')}</strong> sent a counter offer on your booking.</p>
        ${bookingInfoBox({
          setTypeText: setTypeLabel(setType),
          date: eventDate,
          timeRange: fmtTimeRange(startTime, endTime),
          packageTitle,
          venueTypeText: venueTypeLabel(venueType),
          venueName,
          venueAddress,
          rateLabel: 'Counter Offer',
          rateValue: counterRate ? `${sym}${Number(counterRate).toLocaleString()} ${currency}` : '',
          message: counterMessage,
        })}
        ${billBox}
        ${ctaButton(`${SITE_URL}/booking-requests`, 'Review Counter Offer')}
      `;
}

// ── 8b. QUOTE SENT ─────────────────────────────────────────────────────
export function buildQuoteSentBody(opts: {
  recipientName: string | undefined;
  djName: string | undefined;
  setType: string | undefined;
  eventDate: string | undefined;
  startTime: string | undefined;
  endTime: string | undefined;
  venueType: string | undefined;
  venueName: string | undefined;
  venueAddress: string | undefined;
  quotedRate: number | undefined;
  quoteMessage: string | undefined;
  currency: string;
  sym: string;
  billBox: string;
}): string {
  const { recipientName, djName, setType, eventDate, startTime, endTime, venueType, venueName, venueAddress, quotedRate, quoteMessage, currency, sym, billBox } = opts;
  return `
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Quote Received</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml((recipientName || '').trim().split(' ')[0] || 'there')}, <strong>${escHtml(djName || 'your DJ')}</strong> sent you a quote for your booking request.</p>
        ${bookingInfoBox({
          setTypeText: setTypeLabel(setType),
          date: eventDate,
          timeRange: fmtTimeRange(startTime, endTime),
          venueTypeText: venueTypeLabel(venueType),
          venueName,
          venueAddress,
          rateLabel: 'Quoted Rate',
          rateValue: quotedRate ? `${sym}${Number(quotedRate).toLocaleString()} ${currency}` : '',
          message: quoteMessage,
        })}
        ${billBox}
        <p style="color:#666;margin-bottom:16px;font-size:13px;">You can accept this quote, propose a counter-offer, or decline.</p>
        ${ctaButton(`${SITE_URL}/booking-requests`, 'Review Quote')}
      `;
}

// ── 8c. BOOKING APPROVED ───────────────────────────────────────────────
export function buildBookingApprovedBody(opts: {
  recipientName: string | undefined;
  otherPartyName: string | undefined;
  recipientRole: string | undefined;
  eventType: string | undefined;
  eventDetails: string | undefined;
  setType: string | undefined;
  venueType: string | undefined;
  venueName: string | undefined;
  venueAddress: string | undefined;
  startTime: string | undefined;
  endTime: string | undefined;
  packageTitle: string | undefined;
  agreedPrice: number | undefined;
  overtimeRate: number | undefined;
  currency: string;
  eventDate: string | undefined;
  billBox: string;
  progressBox: string;
}): string {
  const { recipientName, otherPartyName, recipientRole, eventType, eventDetails, setType, venueType, venueName, venueAddress, startTime, endTime, packageTitle, agreedPrice, overtimeRate, currency, eventDate, billBox, progressBox } = opts;
  const sym = currencySymbol(currency);
  const otherLabel = recipientRole === 'dj' ? 'Booker' : 'DJ';
  // ── Add to Calendar ── A one-tap Google Calendar link so this single
  // booking lands on a calendar without waiting on the feed.
  let addToCalHtml = '';
  if (eventDate && startTime) {
    const calSummary = `${eventType ? eventTypeLabel(eventType) : 'DJ Booking'}${venueName ? ` @ ${venueName}` : ''}`;
    const calLocation = [venueName, venueAddress].filter(Boolean).join(', ') || null;
    const calDetails = [
      otherPartyName ? `${otherLabel}: ${otherPartyName}` : null,
      agreedPrice ? `Agreed: ${sym}${Number(agreedPrice).toLocaleString()} ${currency}` : null,
      `${SITE_URL}/booking-requests`,
    ].filter(Boolean).join('\n');
    const gLink = googleCalendarLink({ summary: calSummary, date: eventDate, startTime, endTime, location: calLocation, details: calDetails });
    addToCalHtml = `<div style="margin:14px 0 22px;text-align:center;"><a href="${gLink}" style="display:inline-block;padding:10px 20px;background:#ffffff;color:#3c4043;text-decoration:none;font-weight:600;font-size:13px;border-radius:6px;border:1px solid #dadce0;font-family:Roboto,Arial,sans-serif;"><img src="https://developers.google.com/identity/images/g-logo.png" alt="" width="18" height="18" style="vertical-align:middle;margin-right:10px;">Add to Google Calendar</a></div>`;
  }
  return `
        <!-- Approved badge — green pill above the heading. -->
        <div style="display:inline-block;padding:5px 12px;background:rgba(61,220,132,0.12);border:1px solid rgba(61,220,132,0.4);border-radius:14px;color:#3ddc84;font-family:'Space Mono',monospace;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px;">✓ Booking Approved</div>
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin:4px 0 8px;">Price Agreed – Booking Confirmed</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml((recipientName || '').trim().split(' ')[0] || 'there')}, your booking with <strong>${escHtml(otherPartyName || ('the ' + otherLabel.toLowerCase()))}</strong> has been confirmed.</p>
        ${bookingInfoBox({
          eventTypeText: eventType ? eventTypeLabel(eventType) : undefined,
          eventDetails: eventDetails || undefined,
          setTypeText: setTypeLabel(setType),
          date: eventDate,
          timeRange: fmtTimeRange(startTime, endTime),
          packageTitle,
          venueTypeText: venueTypeLabel(venueType),
          venueName,
          venueAddress,
          rateLabel: 'Agreed Price',
          rateValue: agreedPrice ? `${sym}${Number(agreedPrice).toLocaleString()} ${currency}` : '',
        })}
        ${billBox}
        ${overtimeRate != null
          ? `<div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin:20px 0 28px;"><p style="margin:0;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Hourly Overtime Rate:</strong> ${sym}${Number(overtimeRate).toLocaleString()} ${currency}/hr</p></div>`
          : ''}
        <p style="color:#666;margin-bottom:16px;font-size:13px;">You can review full booking details and the other party's contact info in your dashboard.</p>
        ${ctaButton(`${SITE_URL}/booking-requests`, 'View Booking')}
        ${addToCalHtml}
        ${progressBox}
      `;
}

// ── 9. CONTACT US ──────────────────────────────────────────────────────
export function buildContactUsBody(opts: {
  senderName: string | undefined;
  senderEmail: string | undefined;
  subject: string;
  message: string;
}): string {
  const { senderName, senderEmail, subject, message } = opts;
  return `
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Contact Form Submission</h2>
        <p style="color:#666;margin-bottom:16px;"><strong>${escHtml(senderName || 'Someone')}</strong> (${escHtml(senderEmail || 'no email')}) sent a message.</p>
        <div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
          <p style="margin:0 0 8px;color:#1a1a2e;font-size:13px;font-weight:600;">${escHtml(subject)}</p>
          <p style="margin:0;color:#666;font-size:13px;line-height:1.6;white-space:pre-wrap;">${escHtml(message)}</p>
        </div>
      `;
}

// ── 10. PROFILE CLAIMED ────────────────────────────────────────────────
export function buildProfileClaimedBody(opts: {
  claimerName: string | undefined;
  profileName: string | undefined;
  profileSlug: string | undefined;
}): string {
  const { claimerName, profileName, profileSlug } = opts;
  return `
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Profile Approved</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(claimerName || 'there')}, your claim on <strong>${escHtml(profileName || 'your profile')}</strong> has been approved. You can now sign in and edit your profile.</p>
        ${ctaButton(`${SITE_URL}/${profileSlug || ''}`, 'View Profile')}
      `;
}

// ── 11. MANUAL BOOKING INVITE ──────────────────────────────────────────
export function buildManualBookingInviteBody(opts: {
  djName: string;
  djType: string | undefined;
  bookingId: string | undefined;
  eventDate: string | null | undefined;
  startTime: string | null | undefined;
  endTime: string | null | undefined;
  venueName: string | null | undefined;
  venueAddress: string | null | undefined;
  venueType: string | null | undefined;
  setType: string | null | undefined;
  eventType: string | null | undefined;
  eventDetails: string | null | undefined;
  packageTitle: string | null | undefined;
  packageDetails: string | null | undefined;
  rate: number | null | undefined;
  currency: string;
  isResend: boolean;
  taxPct: number;
  taxAmount: number;
  total: number | null;
  depositPct: number;
  depositAmount: number;
  balanceDue: number | null;
  overtimeRate: number | null;
  cocktailNeeded: boolean;
  cocktailStart: string | null | undefined;
  ceremonyNeeded: boolean;
  ceremonyStart: string | null | undefined;
  existingUserId: string | null;
  recipientEmail: string;
}): string {
  const { djName, djType, bookingId, eventDate, startTime, endTime, venueName, venueAddress, venueType, setType, eventType, eventDetails, packageTitle, packageDetails, rate, currency, isResend, taxPct, taxAmount, total, depositPct, depositAmount, balanceDue, overtimeRate, cocktailNeeded, cocktailStart, ceremonyNeeded, ceremonyStart, existingUserId, recipientEmail } = opts;
  const hasPrice = rate != null && Number.isFinite(rate) && rate > 0;
  const fmtAmt = (n: number) => `${currency} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const row = (label: string, val: string, bold = false, muted = false) =>
    `<tr><td style="padding:4px 0;font-size:14px;color:${muted ? '#888888' : '#333333'};${bold ? 'font-weight:700;' : ''}">${label}</td><td style="padding:4px 0;font-size:14px;text-align:right;color:${muted ? '#888888' : '#1a1a2e'};${bold ? 'font-weight:700;' : ''}">${val}</td></tr>`;
  const priceBlock = hasPrice
    ? `<div style="border:1px solid #eeeeee;border-radius:8px;padding:16px 18px;margin:0 0 20px;">
           <div style="font-size:17px;font-weight:800;color:#1a1a2e;margin-bottom:10px;text-transform:uppercase;letter-spacing:.04em;">Price</div>
           <table style="width:100%;border-collapse:collapse;">
             ${row('Rate', fmtAmt(rate as number))}
             ${taxAmount > 0 ? row(`Sales tax (${taxPct}%)`, fmtAmt(taxAmount)) : ''}
             ${row('Total', fmtAmt(total != null ? total : (rate as number) + taxAmount), true)}
           </table>
           ${depositAmount > 0 ? `
           <div style="font-size:17px;font-weight:800;color:#1a1a2e;margin:22px 0 10px;text-transform:uppercase;letter-spacing:.04em;">Payment Schedule</div>
           <table style="width:100%;border-collapse:collapse;">
             ${row(`Deposit${depositPct > 0 ? ` (${depositPct}%)` : ''} to reserve the date`, fmtAmt(depositAmount))}
             ${row('Balance due on event day', fmtAmt(balanceDue != null ? balanceDue : ((total != null ? total : (rate as number) + taxAmount) - depositAmount)), true)}
           </table>` : ''}
           ${overtimeRate != null ? `
           <div style="border-top:1px solid #eeeeee;margin:14px 0 0;"></div>
           <table style="width:100%;border-collapse:collapse;margin-top:10px;">
             ${row('Overtime rate', `${fmtAmt(overtimeRate)} / hr`, false, true)}
           </table>` : ''}
         </div>`
    : '';

  // Build the CTA. If the host's email already has an account, send them
  // to a dedicated claim landing page; otherwise send them to signup.
  const ctaHref = existingUserId
    ? `${SITE_URL}/claim-booking?id=${encodeURIComponent(bookingId || '')}`
    : `${SITE_URL}/signup?email=${encodeURIComponent(recipientEmail)}${
        bookingId ? `&claim_booking=${encodeURIComponent(bookingId)}` : ''
      }`;
  const ctaLabel = existingUserId ? 'Add Booking to My Account' : 'Create Account';
  const accountPitch = existingUserId
    ? `You already have an account at Global DJ Connect — click below to add this booking to your account.`
    : `Create a free account to keep track of this booking, message ${escHtml(djName)} directly, and manage any future bookings — all in one place.`;

  const accountBlock = existingUserId
    ? `<p style="color:#666666;margin-bottom:20px;">${accountPitch}</p>${ctaButton(ctaHref, ctaLabel)}`
    : `${ctaButton(ctaHref, 'Create a Free Account')}
         <p style="color:#999999;margin-bottom:20px;font-size:13px;line-height:1.6;text-align:center;">Manage your booking and all the details within the account. The account is optional — details will continue to be emailed to this address with or without an account.</p>`;

  const intro = isResend
    ? `${escHtml(djName)} has updated the details for your upcoming booking. Here's the latest info on file:`
    : `${escHtml(djName)} is your DJ for an upcoming event and wants to share the booking details with you. Here's everything on file:`;

  return `
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">${isResend ? 'Booking Updated' : 'Your Booking Details'}</h2>
        <p style="color:#666666;margin-bottom:20px;">${intro}</p>
        ${bookingInfoBox({
          eventTypeText: djType === 'mobile' ? eventTypeLabel(eventType || undefined) : undefined,
          eventDetails: djType === 'mobile' ? (eventDetails || undefined) : undefined,
          setTypeText: djType === 'club' ? setTypeLabel(setType) : undefined,
          venueTypeText: djType === 'club' ? venueTypeLabel(venueType) : undefined,
          date: eventDate,
          timeRange: fmtTimeRange(startTime, endTime),
          packageTitle: djType === 'mobile' ? (packageTitle || undefined) : undefined,
          packageDetails: djType === 'mobile' ? (packageDetails || undefined) : undefined,
          venueName: venueName || undefined,
          venueAddress: venueAddress || undefined,
          // Cocktail-hour / ceremony start times (weddings) — surfaced in the box.
          isWedding: djType === 'mobile' && eventType === 'weddings',
          ceremonyStart: (djType === 'mobile' && ceremonyNeeded) ? (ceremonyStart || undefined) : undefined,
          cocktailStart: (djType === 'mobile' && cocktailNeeded) ? (cocktailStart || undefined) : undefined,
          // Price moved into its own breakdown block below (rate + tax +
          // payment schedule), so it's not duplicated as a bare "Rate" line here.
        })}
        ${priceBlock}
        ${accountBlock}
        <p style="color:#999999;margin-top:24px;font-size:12px;line-height:1.6;text-align:center;">If you weren't expecting this email, please reply to let us know.</p>
      `;
}

// ── EVENT INVITE FROM HOST ─────────────────────────────────────────────
export function buildEventInviteFromHostBody(opts: {
  hostName: string;
  djFound: boolean;
  djType: string | null | undefined;
  bookingId: string | undefined;
  eventDate: string | null | undefined;
  startTime: string | null | undefined;
  endTime: string | null | undefined;
  eventType: string | undefined;
  venueName: string | null | undefined;
  venueAddress: string | null | undefined;
  rate: number | null | undefined;
  currency: string;
  recipientEmail: string;
}): string {
  const { hostName, djFound, djType, bookingId, eventDate, startTime, endTime, eventType, venueName, venueAddress, rate, currency, recipientEmail } = opts;
  // Type-mismatch note: club/bar event going to a mobile DJ (or vice versa).
  const eventTypeLabelStr = eventType === 'club' ? 'Club / Bar' : eventType === 'mobile' ? 'Mobile / Private' : 'Event';
  const typeMismatch = djFound && djType && eventType && djType !== eventType;
  const mismatchNote = typeMismatch
    ? `<p style="color:#666666;margin-bottom:14px;font-size:13px;line-height:1.5;background:#fff3cd;border-left:3px solid #f0ad4e;padding:10px 12px;border-radius:4px;"><strong>Note:</strong> This is a ${escHtml(eventTypeLabelStr)} event. Your profile is registered as a ${escHtml(djType === 'club' ? 'Club / Bar' : 'Mobile')} DJ. You can still accept the booking — it will appear in your upcoming bookings — but it won't be displayed publicly on your profile event list.</p>`
    : '';

  const rateLine = (rate != null && Number.isFinite(rate) && rate > 0)
    ? `<p style="margin:0 0 8px;color:#1a1a2e;"><strong>Rate:</strong> ${escHtml(currency)} ${rate.toLocaleString()}</p>`
    : '';

  // Compose a one-line "shared event details for {date} at {venue}" summary.
  const fmtDateShort = (d: string | null | undefined): string => {
    if (!d) return '';
    const [y, m, day] = d.split('-').map((s) => parseInt(s, 10));
    const dt = new Date(y, m - 1, day);
    return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };
  const dateStr = fmtDateShort(eventDate);
  const venueStr = (venueName || '').trim() || (venueAddress || '').split(',')[0].trim();
  const detailsLine = [dateStr, venueStr].filter(Boolean).join(' at ');

  const ctaHref = djFound
    ? `${SITE_URL}/claim-booking?id=${encodeURIComponent(bookingId || '')}`
    : `${SITE_URL}/signup?email=${encodeURIComponent(recipientEmail)}${bookingId ? `&claim_booking=${encodeURIComponent(bookingId)}` : ''}`;
  const ctaLabel = djFound ? 'Add Booking to My Account' : 'Create Account';

  const intro = djFound
    ? `${escHtml(hostName)} has shared event details${detailsLine ? ` for ${escHtml(detailsLine)}` : ''}. Log in to see this in your upcoming bookings.`
    : `${escHtml(hostName)} has shared event details${detailsLine ? ` for ${escHtml(detailsLine)}` : ''}. Create a free account to manage it and access future bookings.`;

  return `
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">You've Been Added to an Event</h2>
        <p style="color:#666666;margin-bottom:20px;">${intro}</p>
        ${mismatchNote}
        ${bookingInfoBox({
          date: eventDate,
          timeRange: fmtTimeRange(startTime, endTime),
          venueName: venueName || undefined,
          venueAddress: venueAddress || undefined,
        })}
        ${rateLine ? `<div style="margin:14px 0;">${rateLine}</div>` : ''}
        ${ctaButton(ctaHref, ctaLabel)}
        <p style="color:#999999;margin-top:24px;font-size:12px;line-height:1.6;text-align:center;">If you weren't expecting this email, please reply to let us know.</p>
      `;
}

// ── BOOKING ACTIVITY (note / flyer) ────────────────────────────────────
export function buildBookingActivityBody(opts: {
  h2: string;
  actorName: string;
  actionLabel: string;
  eventDescriptor: string;
  ctaUrl: string;
}): string {
  const { h2, actorName, actionLabel, eventDescriptor, ctaUrl } = opts;
  return `
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">${h2}</h2>
        <p style="color:#666666;margin-bottom:20px;">
          <strong>${escHtml(actorName)}</strong> ${actionLabel} on your booking${eventDescriptor ? ` for ${escHtml(eventDescriptor)}` : ''}.
        </p>
        ${ctaButton(ctaUrl, 'View Booking')}
      `;
}
