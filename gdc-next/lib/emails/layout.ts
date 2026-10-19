// lib/emails/layout.ts
//
// Shared HTML building blocks for transactional emails: the branded shell,
// buttons, and the reusable booking-info / mobile-request / itemized-bill
// cards. Pure functions — they take already-resolved values and return HTML
// strings. Formatting of individual values lives in ./format.

import { SITE_URL } from './constants';
import { escHtml, fmtDate, fmtTime, fmtTimeRange } from './format';

// Shared HTML wrapper — solid dark header bar + footer. Vanilla parity.
// Header background: solid #000000 to match the logo PNG's own backdrop.
// Logo is wrapped in an inner centering table because some email clients
// (notably Gmail mobile) ignore text-align on the parent <td> for block
// images. The inner table forces horizontal centering reliably.
export function emailTemplate(content: string): string {
  return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background:#000000;padding:24px 32px;" align="center">
<div style="font-family:'Bebas Neue',Impact,Arial,sans-serif;font-size:28px;letter-spacing:.06em;color:#00f5c4;font-weight:700;">GLOBAL DJ CONNECT</div>
</td></tr>
<tr><td style="padding:32px;">${content}</td></tr>
<tr><td style="background:#f8f8f8;padding:20px 32px;text-align:center;border-top:1px solid #e0e0e0;">
<p style="margin:0;color:#888;font-size:11px;line-height:1.6;">© ${new Date().getFullYear()} Global DJ Connect · <a href="${SITE_URL}" style="color:#888;">globaldjconnect.com</a></p>
</td></tr></table>
</td></tr></table>`;
}

export function ctaButton(href: string, label: string): string {
  // Wrapped in a padded div for the same reason offerButtons below does it:
  // the button had `margin:0 auto` and nothing vertical, so it sat flush
  // against whatever box preceded it — in the cancellation email it touched
  // the Package panel with no gap at all. Padding on a wrapper, not margin on
  // the table, because email clients collapse margins unreliably.
  return `<div style="padding-top:20px;padding-bottom:4px;text-align:center;"><table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td style="background:#0a6f61;border-radius:6px;"><a href="${href}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:0.02em;">${label}</a></td></tr></table></div>`;
}

// Three stacked action buttons for the booker's offer email: Approve
// (green), Decline (red), View (outline). Stacked + min-width for reliable,
// uniform rendering across mobile email clients.
export function offerButtons(approveHref: string, declineHref: string, viewHref: string): string {
  const btn = (href: string, label: string, bg: string, color: string, border: string) =>
    `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 10px;"><tr><td style="background:${bg};border:${border};border-radius:6px;"><a href="${href}" style="display:inline-block;padding:12px 28px;color:${color};text-decoration:none;font-weight:600;font-size:14px;letter-spacing:0.02em;min-width:180px;text-align:center;">${label}</a></td></tr></table>`;
  // padding-top (not margin) separates the button group from the info box
  // above — email clients collapse margins unreliably.
  return `<div style="padding-top:20px;text-align:center;">${
    btn(approveHref, 'Approve Offer', '#0a6f61', '#ffffff', 'none')
  }${
    btn(declineHref, 'Decline Offer', '#b3261e', '#ffffff', 'none')
  }${
    btn(viewHref, 'View Offer', '#ffffff', '#0a6f61', '1px solid #0a6f61')
  }</div>`;
}

// Shared booking-info card — same look as the booking_request email.
// Pass any subset of fields; missing ones are skipped. Used by
// quote_sent and booking_counter so they show the same booking
// context the original request email did.
//
// eventTypeText vs setTypeText: pick whichever fits the booking type.
// Mobile DJ bookings use eventTypeText (Wedding / Birthday / Corporate).
// Club/bar bookings use setTypeText (Headliner / Opener / Closing).
// They render with different labels ("Event Type:" vs "Set Type:") so
// the wording matches what the booker/DJ actually picked.
export function bookingInfoBox(opts: {
  eventTypeText?: string;       // mobile only — already-formatted (e.g. "Wedding")
  eventDetails?: string;        // mobile only — sub-line under Event Type
  setTypeText?: string;         // club only — already-formatted (e.g. "Headliner")
  date?: string | null;         // raw event_date YYYY-MM-DD
  timeRange?: string;           // pre-formatted, e.g. "9:00 PM – 1:00 AM"
  packageTitle?: string;
  packageDetails?: string;      // mobile only — package description (HTML)
  venueTypeText?: string;       // pre-formatted, e.g. "Bar"
  venueName?: string;
  venueAddress?: string;
  equipmentText?: string;       // club only — pre-formatted equipment label
  rateLabel?: string;           // e.g. "Quoted Rate" / "Counter Offer"
  rateValue?: string;           // e.g. "$300 USD"
  rateBreakdown?: string;       // optional hourly breakdown, e.g. "$330/hr × 3 hr"
  isWedding?: boolean;          // relabels the Time row as "Reception Time"
  ceremonyStart?: string | null; // weddings — pre-trimmed "HH:MM", shown as a row
  cocktailStart?: string | null; // weddings — pre-trimmed "HH:MM", shown as a row
  message?: string;
}): string {
  const dateStr = opts.date ? fmtDate(opts.date) : '';
  const rows: string[] = [];
  if (dateStr) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Date:</strong> ${dateStr}</p>`);
  // Ceremony → Cocktail hour come BEFORE the main time, in event order.
  {
    const ceStart = fmtTime(opts.ceremonyStart);
    if (ceStart) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Ceremony Start:</strong> ${escHtml(ceStart)}</p>`);
    const ckStart = fmtTime(opts.cocktailStart);
    if (ckStart) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Cocktail Hour Start:</strong> ${escHtml(ckStart)}</p>`);
  }
  // Weddings label the main slot "Reception Time"; everything else is "Time".
  if (opts.timeRange && opts.timeRange !== '—') rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">${opts.isWedding ? 'Reception Time' : 'Time'}:</strong> ${escHtml(opts.timeRange)}</p>`);
  if (opts.packageTitle) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Package:</strong> ${escHtml(opts.packageTitle)}${opts.packageDetails ? `<br><span style="color:#999;font-size:12px;line-height:1.5;">${opts.packageDetails}</span>` : ''}</p>`);
  if (opts.eventTypeText) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Event Type:</strong> ${escHtml(opts.eventTypeText)}${opts.eventDetails ? `<br><span style="color:#999;font-size:12px;">${escHtml(opts.eventDetails)}</span>` : ''}</p>`);
  if (opts.venueName) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Venue:</strong> ${escHtml(opts.venueName)}</p>`);
  if (opts.venueAddress) {
    const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(opts.venueAddress)}`;
    rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Address:</strong> <a href="${mapsHref}" style="color:#0a7d5a;text-decoration:underline;">${escHtml(opts.venueAddress)}</a></p>`);
  }
  if (opts.venueTypeText) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Venue Type:</strong> ${escHtml(opts.venueTypeText)}</p>`);
  if (opts.setTypeText) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Set Type:</strong> ${escHtml(opts.setTypeText)}</p>`);
  if (opts.equipmentText) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Equipment:</strong> ${escHtml(opts.equipmentText)}</p>`);
  if (opts.rateLabel && opts.rateValue) rows.push(`<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">${escHtml(opts.rateLabel)}:</strong> ${escHtml(opts.rateValue)}${opts.rateBreakdown ? ` <span style="color:#999;">(${escHtml(opts.rateBreakdown)})</span>` : ''}</p>`);
  if (opts.message) rows.push(`<p style="margin:8px 0 0;color:#666;font-size:13px;line-height:1.6;white-space:pre-wrap;"><strong style="color:#1a1a2e;">Message:</strong><br>${escHtml(opts.message)}</p>`);
  // Trim the trailing margin on the last row for a tight look
  if (rows.length > 0) rows[rows.length - 1] = rows[rows.length - 1].replace('margin:0 0 8px', 'margin:0');
  return `<div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">${rows.join('')}</div>`;
}

// Mobile booking-request card. Used by booking_request (DJ-facing) and
// booking_request_confirmation (booker-facing) so both parties see an
// identical card. Field order is fixed:
//   Event Type, Date, Time, Venue, Address, Package (+ details), Quoted Rate
//
// Weddings: the time row is labelled "Reception Start Time / Reception End
// Time" and, when cocktail-hour music was requested, two extra rows show
// the cocktail start time and whether it shares the reception room.
//
// packageDetails is trusted HTML from the DJ's profile editor (same source
// the public booking form renders) — rendered inline under the Package row.
export function mobileBookingRequestBox(opts: {
  eventTypeText?: string;
  eventDetails?: string;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  venueName?: string;
  venueAddress?: string;
  packageTitle?: string;
  packageDetails?: string;
  rateLabel?: string;
  rateValue?: string;
  rateBreakdown?: string;
  isWedding?: boolean;
  cocktailNeeded?: boolean | null;
  cocktailStart?: string | null;
  cocktailSameRoom?: boolean | null;
  ceremonyNeeded?: boolean | null;
  ceremonyStart?: string | null;
  ceremonySameRoom?: boolean | null;
  setupHours?: string | null;
}): string {
  const rows: string[] = [];
  const row = (label: string, value: string) =>
    `<p style="margin:0 0 8px;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">${label}:</strong> ${value}</p>`;

  if (opts.eventTypeText) {
    const detail = opts.eventDetails
      ? `<br><span style="color:#999;font-size:12px;">${opts.eventDetails.split(' · ').map((s) => escHtml(s)).join('<br>')}</span>`
      : '';
    rows.push(row('Event Type', escHtml(opts.eventTypeText) + detail));
  }

  const dateStr = opts.date ? fmtDate(opts.date) : '';
  if (dateStr) rows.push(row('Date', dateStr));

  // Wedding bookings call the slot a reception. When both times are
  // present we render two separate labelled rows; otherwise a single
  // range row keeps non-wedding bookings unchanged.
  const startStr = fmtTime(opts.startTime);
  const endStr = fmtTime(opts.endTime);
  if (opts.isWedding) {
    if (startStr) rows.push(row('Reception Start Time', escHtml(startStr)));
    if (endStr) rows.push(row('Reception End Time', escHtml(endStr)));
  } else {
    const range = fmtTimeRange(opts.startTime, opts.endTime);
    if (range !== '—') rows.push(row('Time', escHtml(range)));
  }

  // Ceremony rows (weddings only) — an independent add-on shown ABOVE cocktail
  // hour, in event order. Yes/No always shows for weddings; start + room show
  // only when ceremony music was requested.
  if (opts.isWedding) {
    rows.push(row('Music for Ceremony', opts.ceremonyNeeded ? 'Yes' : 'No'));
  }
  if (opts.ceremonyNeeded) {
    const ceStart = fmtTime(opts.ceremonyStart);
    if (ceStart) rows.push(row('Ceremony Start', escHtml(ceStart)));
    rows.push(row(
      'Ceremony Room',
      opts.ceremonySameRoom ? 'Same room as reception' : 'Separate room from reception',
    ));
  }

  // Cocktail-hour rows. Weddings always show the Yes/No (it's a standard
  // wedding question); other events show cocktail rows only when the booker
  // added cocktail hour. Start time + room rows appear whenever cocktail-hour
  // music was requested, for any event type.
  if (opts.isWedding) {
    rows.push(row(
      'Music for Cocktail Hour',
      opts.cocktailNeeded ? 'Yes' : 'No',
    ));
  }
  if (opts.cocktailNeeded) {
    const ckStart = fmtTime(opts.cocktailStart);
    if (ckStart) rows.push(row('Cocktail Hour Start', escHtml(ckStart)));
    rows.push(row(
      'Cocktail Hour Room',
      opts.cocktailSameRoom
        ? `Same room as ${opts.isWedding ? 'reception' : 'event'}`
        : `Separate room from ${opts.isWedding ? 'reception' : 'event'}`,
    ));
  }

  if (opts.venueName) rows.push(row('Venue', escHtml(opts.venueName)));
  if (opts.venueAddress) {
    const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(opts.venueAddress)}`;
    rows.push(row('Address', `<a href="${mapsHref}" style="color:#0a7d5a;text-decoration:underline;">${escHtml(opts.venueAddress)}</a>`));
  }

  // NOTE: package title + details are NOT pushed here — they render in their
  // own box below the event card (see packageBox at the end).

  // Setup time sits under the package details — it's a property of the
  // selected package's setup requirement.
  if (opts.setupHours) {
    rows.push(row(
      'Setup Time Required',
      `${escHtml(String(opts.setupHours))} hr${opts.setupHours === '1' ? '' : 's'} before start`,
    ));
  }

  if (opts.rateLabel && opts.rateValue) {
    rows.push(row(opts.rateLabel, escHtml(opts.rateValue) + (opts.rateBreakdown ? ` <span style="color:#0a6f61;">(${escHtml(opts.rateBreakdown)})</span>` : '')));
  }

  if (rows.length > 0) {
    rows[rows.length - 1] = rows[rows.length - 1].replace('margin:0 0 8px', 'margin:0');
  }
  const eventBox = `<div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">${rows.join('')}</div>`;

  // The package gets its OWN box under the event card — the title (and the
  // DJ-authored details HTML, when there is any) read as a unit instead of
  // being buried among the event rows.
  const packageBox = opts.packageTitle
    ? `<div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin:0 0 24px;">
         <p style="margin:0;color:#666;font-size:13px;"><strong style="color:#1a1a2e;">Package:</strong> ${escHtml(opts.packageTitle)}</p>
         ${opts.packageDetails && opts.packageDetails.trim()
           ? `<div style="margin:8px 0 0;color:#666;font-size:13px;line-height:1.6;">${opts.packageDetails}</div>`
           : ''}
       </div>`
    : '';

  return `${eventBox}${packageBox}`;
}

// Full itemized bill: base price + wedding add-ons, sales tax, total, the
// deposit to reserve, and the balance due on the event day. Returns '' when
// there is nothing to itemize — no add-ons, no tax, AND no deposit — or no
// price yet, so a flat-price booking (which already shows its price on the
// card) doesn't get a redundant one-line "breakdown".
export function billBreakdownBox(
  b: {
    quotedRate?: number | null;
    cocktailPrice?: number | null;
    ceremonyPrice?: number | null;
    taxPct?: number | null;
    taxAmount?: number | null;
    totalWithTax?: number | null;
    depositPct?: number | null;
    depositAmount?: number | null;
    // The booking has these extras but they carry NO separate charge — they're
    // bundled into the one price. Rendered as a muted "Includes…" note under
    // the price line instead of as add-on rows.
    bundledCocktail?: boolean;
    bundledCeremony?: boolean;
    // Offer discount. quotedRate is ALREADY net of this, so the pre-discount
    // figure is reconstructed as quotedRate + discountAmount.
    discountPct?: number | null;
    discountAmount?: number | null;
  },
  sym: string,
  currency: string,
): string {
  if (b.quotedRate == null) return '';
  const subtotal = Number(b.quotedRate);
  if (!Number.isFinite(subtotal) || subtotal <= 0) return '';
  const cocktailAdd = b.cocktailPrice != null ? Number(b.cocktailPrice) : 0;
  const ceremonyAdd = b.ceremonyPrice != null ? Number(b.ceremonyPrice) : 0;
  const taxAmt = b.taxAmount != null ? Number(b.taxAmount) : 0;
  const depAmt = b.depositAmount != null ? Number(b.depositAmount) : 0;
  // Extras the price already covers (no separate charge) — noted, not itemized.
  const bundled = [
    b.bundledCeremony && ceremonyAdd <= 0 ? 'Music For Ceremony' : null,
    b.bundledCocktail && cocktailAdd <= 0 ? 'Cocktail Hour' : null,
  ].filter(Boolean) as string[];
  const discAmt = b.discountAmount != null ? Number(b.discountAmount) : 0;
  const discPct = b.discountPct != null ? Number(b.discountPct) : 0;
  // Nothing to break down → no box.
  if (cocktailAdd <= 0 && ceremonyAdd <= 0 && taxAmt <= 0 && depAmt <= 0
      && discAmt <= 0 && bundled.length === 0) return '';
  const basePrice = subtotal - cocktailAdd - ceremonyAdd;
  const taxPct = b.taxPct != null ? Number(b.taxPct) : 0;
  const total = b.totalWithTax != null ? Number(b.totalWithTax) : subtotal + taxAmt;
  const depPct = b.depositPct != null ? Number(b.depositPct) : 0;
  const balance = total - depAmt;
  const money = (n: number) =>
    `${sym}${Number(n).toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })} ${currency}`;
  const row = (label: string, val: string, o?: { bold?: boolean; muted?: boolean; top?: boolean }) =>
    `<tr><td style="padding:6px 0;${o?.top ? 'border-top:1px solid #e0e0e0;' : ''}color:${o?.muted ? '#888' : '#1a1a2e'};font-size:14px;${o?.bold ? 'font-weight:700;' : ''}">${label}</td><td style="padding:6px 0;${o?.top ? 'border-top:1px solid #e0e0e0;' : ''}text-align:right;color:${o?.muted ? '#888' : '#1a1a2e'};font-size:14px;${o?.bold ? 'font-weight:700;' : ''}">${val}</td></tr>`;
  const rows: string[] = [];
  if (cocktailAdd > 0 || ceremonyAdd > 0) {
    rows.push(row('Package price', money(basePrice)));
    if (cocktailAdd > 0) rows.push(row('Cocktail Hour', `+${money(cocktailAdd)}`, { muted: true }));
    if (ceremonyAdd > 0) rows.push(row('Music For Ceremony', `+${money(ceremonyAdd)}`, { muted: true }));
  } else if (discAmt > 0) {
    // subtotal is already net of the discount — show what it was before.
    rows.push(row('Total Event Price', money(subtotal + discAmt)));
    rows.push(row(`Discount (${discPct}%)`, `−${money(discAmt)}`, { muted: true }));
    rows.push(row('Discounted price', money(subtotal), { top: true }));
  } else {
    rows.push(row('Total Event Price', money(subtotal)));
  }
  if (bundled.length > 0) {
    const list = bundled.length === 2 ? `${bundled[0]} and ${bundled[1]}` : bundled[0];
    rows.push(
      `<tr><td colspan="2" style="padding:2px 0 8px;color:#888;font-size:13px;font-style:italic;">Includes ${list} — no extra charge.</td></tr>`,
    );
  }
  if (taxAmt > 0) rows.push(row(`Sales tax${taxPct > 0 ? ` (${taxPct}%)` : ''}`, money(taxAmt)));
  rows.push(row('Total', money(total), { bold: true, top: true }));
  if (depAmt > 0) {
    // Visual break so the payment schedule reads as its own section, not
    // as more line items rolling into the Total above it.
    rows.push('<tr><td colspan="2" style="height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr>');
    rows.push('<tr><td colspan="2" style="border-top:1px solid #e0e0e0;padding:12px 0 8px;text-align:center;color:#1a1a2e;font-size:14px;font-weight:700;">Payment Schedule</td></tr>');
    rows.push(row(`Deposit${depPct > 0 ? ` (${depPct}%)` : ''} — to reserve`, money(depAmt)));
    rows.push(row('Balance due day of event', money(balance), { bold: true }));
  }
  return `<div style="background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:8px 20px;margin:-12px 0 24px;"><table style="width:100%;border-collapse:collapse;">${rows.join('')}</table></div>`;
}
