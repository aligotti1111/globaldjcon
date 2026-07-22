// paymentMethods — the single source of truth for payment rails.
//
// PURE MODULE, no 'use client'. Three places need this and they must never
// disagree:
//   1. PaymentMethodsSection  — the DJ's settings editor (client)
//   2. PaymentOptions         — the host's booking card (client)
//   3. the deposit/invoice email (server)
//
// If the email built its own links, they'd drift from the card's within a
// month — exactly how the club and mobile tax math ended up disagreeing.
//
// WHAT WE CAN AND CANNOT LINK TO (verified, not assumed):
//   Venmo    → https://venmo.com/<user>?txn=pay&amount=600&note=GDC-1487
//              Amount prefills. But Venmo NO LONGER ALLOWS INITIATING A
//              PAYMENT FROM THEIR WEBSITE — the link only completes inside
//              the app on a phone. On desktop it opens a profile the client
//              cannot pay from. Never render this button alone: always show
//              the handle too, and a QR on desktop.
//   Cash App → https://cash.app/$<cashtag>/600 — amount prefills.
//   PayPal   → https://paypal.me/<user>/600 — amount prefills, but ONLY for a
//              PayPal.me link. A bare PayPal email cannot be linked: the old
//              email-based button (PayPal Payments Standard) was deprecated
//              Jan 2026 and stops working entirely Jan 2027.
//   Zelle    → NO LINK EXISTS, at all. Bank-app only. Copy-only, always.
//   Cash/check/other → instructions only.
//   Card     → NO STATIC LINK EITHER, but for the opposite reason: a Stripe
//              Checkout session is minted per-payment, server-side
//              (/api/payments { action: 'checkout' }). Card is also the ONLY
//              rail with no handle — its availability comes from
//              users.stripe_connect_ready (Stripe Connect onboarding), never
//              from a payment_methods row. This module stays pure: it knows
//              card EXISTS and that it can't be linked; the Stripe SDK lives
//              entirely behind the API routes.
//
// The prefilled amount is a SUGGESTION on every rail — the client can edit it
// before sending. That's fine: the DJ confirms what actually arrived, and
// amount_paid (not amount) is what settles the ledger.

export type PaymentMethodType =
  | 'card' | 'zelle' | 'venmo' | 'cashapp' | 'paypal' | 'cash' | 'check' | 'other';

export interface PaymentMethod {
  id: string;
  type: PaymentMethodType;
  handle: string;
  note: string;
  enabled: boolean;
  /**
   * Second field, only some rails have one. Cash uses it for WHO to ask for:
   * "call (555) 123-4567 and ask for Mike".
   *
   * A client holding $600 in an envelope at a venue they've never been to
   * needs a name as much as a number — "call this number" gets them a stranger
   * saying "who?". It's separate from `handle` because both halves are looked
   * up and rendered independently; concatenating them into one string would
   * mean parsing it back out everywhere it's shown.
   *
   * Optional, so every row saved before this field existed still loads.
   */
  contact?: string;
  /**
   * Cash only, both optional: an office or studio the client can drop the money
   * at instead of handing it over at the event, and when someone's there.
   *
   * The hours are the point. An address with no hours is an invitation to drive
   * across town and find a locked door — and a client who does that once pays
   * at the event forever after.
   */
  dropoffAddress?: string;
  dropoffHours?: string;
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const digitsOf = (v: string) => v.replace(/\D/g, '');

export interface TypeConfig {
  label: string;
  /** What the DJ types. Empty = this rail has no handle at all. */
  handleLabel: string;
  placeholder: string;
  /** Shown to the DJ in settings — what the client will actually have to do. */
  hint: string;
  validate: (v: string) => string | null;
  /** Second field's label. Undefined = this rail doesn't have one. */
  contactLabel?: string;
  contactPlaceholder?: string;
  validateContact?: (v: string) => string | null; footnote?: string;
}

export const METHOD_TYPES: Record<PaymentMethodType, TypeConfig> = {
  card: {
    label: 'Card',
    // Deliberately no handle: cards aren't a payment_methods row. The DJ
    // enables them by completing Stripe Connect onboarding, and availability
    // is read from users.stripe_connect_ready.
    handleLabel: '',
    placeholder: '',
    hint: 'Debit or credit card via Stripe. Costs you 2.9% + 30¢ per charge (the client pays face value). Requires Stripe onboarding — they\'ll ask for your SSN and bank details — and your FIRST payout takes 7–14 days (about 2 days after that). The only rail that works identically on desktop and mobile, and the only one that confirms itself.',
    validate: () => null,
  },
  zelle: {
    label: 'Zelle',
    handleLabel: 'Email or phone',
    placeholder: 'you@email.com or (555) 123-4567',
    hint: 'Client sends from their bank app. No link exists for Zelle, so they copy this by hand — double-check it.',
    validate: (v) => {
      const t = v.trim();
      if (!t) return 'Enter the email or phone your Zelle is registered to.';
      if (isEmail(t)) return null;
      if (digitsOf(t).length >= 10) return null;
      return 'Must be a valid email or a 10-digit phone number.';
    },
  },
  venmo: {
    label: 'Venmo',
    handleLabel: 'Username',
    placeholder: 'djnova',
    hint: 'One tap on a phone with the Venmo app — amount filled in for them. Venmo blocks payments from their website, so on a laptop the client copies your handle instead. Unverified accounts also cap around $300/week received.',
    validate: (v) => {
      const t = v.trim().replace(/^@/, '');
      if (!t) return 'Enter your Venmo username.';
      if (!/^[A-Za-z0-9_-]{3,30}$/.test(t)) return 'Usernames are 3–30 letters, numbers, dashes or underscores.';
      return null;
    },
  },
  cashapp: {
    label: 'Cash App',
    handleLabel: 'Cashtag',
    placeholder: 'djnova',
    hint: 'One tap, amount filled in for them. Works best on a phone with the Cash App installed.',
    validate: (v) => {
      const t = v.trim().replace(/^\$/, '');
      if (!t) return 'Enter your $cashtag.';
      if (!/^[A-Za-z0-9_-]{1,20}$/.test(t)) return 'Cashtags are up to 20 letters, numbers, dashes or underscores.';
      return null;
    },
  },
  paypal: {
    label: 'PayPal',
    handleLabel: 'PayPal.me link or email',
    placeholder: 'paypal.me/djnova',
    hint: 'Use your PayPal.me link — the client gets a one-tap button with the amount already filled in. An email works, but they must open PayPal and send it by hand.', footnote: 'PayPal requires a Business account for commercial payments (even unincorporated) and may close a personal account used mainly for business. Business rates run about 2.99% + $0.49.',
    validate: (v) => {
      const t = v.trim();
      if (!t) return 'Enter your PayPal.me link or PayPal email.';
      if (isEmail(t)) return null;
      if (/^(https?:\/\/)?(www\.)?paypal\.me\/[A-Za-z0-9._-]+\/?$/i.test(t)) return null;
      return 'Use a paypal.me/yourname link or your PayPal email.';
    },
  },
  cash: {
    label: 'Cash',
    handleLabel: 'Phone to call',
    placeholder: '(555) 123-4567',
    contactLabel: 'Ask for',
    contactPlaceholder: 'Mike',
    hint: 'In person only. For deposits arranged meeting will be required. Include contact info and or office address below.',
    validate: (v) => {
      const t = v.trim();
      if (!t) return 'Enter a phone number the client can call.';
      if (digitsOf(t).length >= 10) return null;
      return 'Must be a 10-digit phone number.';
    },
    validateContact: (v) => (v.trim() ? null : 'Who should they ask for?'),
  },
  check: {
    label: 'Check',
    handleLabel: 'Payable to',
    placeholder: 'DJ Nova LLC',
    contactLabel: 'Mailing address',
    contactPlaceholder: '123 Main St, Staten Island, NY 10307',
    hint: 'The client will be informed to include event date and venue with check.',
    validate: (v) => (v.trim() ? null : 'Who should the check be made out to?'),
    validateContact: (v) => (v.trim() ? null : 'Where should they mail it?'),
  },
  other: {
    label: 'Other',
    handleLabel: 'Details',
    placeholder: 'Bank transfer — sort code / account no.',
    hint: 'Anything else you accept. The client sees exactly what you type here.',
    validate: (v) => (v.trim() ? null : 'Describe how the client should pay.'),
  },
};

// Display/dropdown order for the MANUAL rails. 'card' is deliberately absent:
// it isn't something a DJ adds as a row in settings (no handle to type), and
// the host-facing card renders it separately, always first.
export const TYPE_ORDER: PaymentMethodType[] =
  ['venmo', 'cashapp', 'paypal', 'zelle', 'cash', 'check', 'other'];

/** Bare handle, prefixes stripped. Stored form. */
export function cleanHandle(m: Pick<PaymentMethod, 'type' | 'handle'>): string {
  const t = (m.handle || '').trim();
  if (m.type === 'venmo') return t.replace(/^@/, '');
  if (m.type === 'cashapp') return t.replace(/^\$/, '');
  return t;
}

/** What the client literally reads: "@djnova", "$djnova", "dj@email.com". */
export function displayHandle(m: Pick<PaymentMethod, 'type' | 'handle'>): string {
  const t = cleanHandle(m);
  switch (m.type) {
    case 'card':    return 'Pay by card';
    case 'venmo':   return `@${t}`;
    case 'cashapp': return `$${t}`;
    case 'paypal':  return t.replace(/^https?:\/\//i, '');
    // Cash now carries a number and a name — "Pay in person" threw both away
    // and told the client nothing they didn't already know.
    case 'cash':    return t ? `Call ${t}` : 'Pay in person';
    default:        return t;
  }
}

/** Amounts in links: 600 not 600.00, but 41.60 stays 41.60. */
function linkAmount(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/**
 * The tappable link that opens the app with amount + recipient loaded.
 * Returns null when the rail genuinely cannot be linked (Zelle always; PayPal
 * when the DJ gave an email rather than a PayPal.me link; cash/check/other).
 * Callers MUST handle null by showing the handle to copy instead.
 */
export function buildPayLink(m: PaymentMethod, amount: number, reference: string): string | null {
  // Card NEVER has a static URL: every payment gets a fresh Stripe Checkout
  // session created server-side (/api/payments { action: 'checkout' }), so
  // there is nothing to build here. Callers render a button that POSTs and
  // redirects to the returned session URL — not a link.
  if (m.type === 'card') return null;
  const h = cleanHandle(m);
  if (!h && m.type !== 'cash') return null;
  const amt = linkAmount(amount);

  switch (m.type) {
    case 'venmo':
      // note= carries the reference so the DJ can match the payment.
      return `https://venmo.com/${encodeURIComponent(h)}?txn=pay&amount=${amt}&note=${encodeURIComponent(reference)}`;
    case 'cashapp':
      return `https://cash.app/$${encodeURIComponent(h)}/${amt}`;
    case 'paypal': {
      const mm = h.match(/paypal\.me\/([A-Za-z0-9._-]+)/i);
      // An email has no link form — deliberately null.
      return mm ? `https://paypal.me/${mm[1]}/${amt}` : null;
    }
    default:
      return null; // zelle, cash, check, other
  }
}

/** Can this method be rendered as a real "tap to pay" button right now? */
export function isLinkable(m: PaymentMethod): boolean {
  // No static link exists for card — checkout is a server round-trip.
  if (m.type === 'card') return false;
  if (m.type === 'venmo' || m.type === 'cashapp') return !!cleanHandle(m);
  if (m.type === 'paypal') return /paypal\.me\//i.test(m.handle || '');
  return false;
}

/**
 * Venmo's link only completes inside the phone app. Everything else that's
 * linkable works on desktop too. Drives the "scan this with your phone" QR.
 */
export function isMobileOnly(m: PaymentMethod): boolean {
  return m.type === 'venmo';
}

/**
 * Cash, as one line for the client: who to call, and who to ask for.
 *
 * Both halves or nothing — a number with no name leaves someone standing in a
 * venue with $600 in an envelope asking strangers. Shared here so the booking
 * card and the email can't word it differently.
 */
export function cashLine(m: Pick<PaymentMethod, 'handle' | 'contact'>): string {
  const phone = (m.handle || '').trim();
  const who = (m.contact || '').trim();
  if (!phone) return 'Pay in person.';
  // An instruction, not a fact. "Call (555) 123-4567" states a number; "reach
  // out to Mike to arrange" tells them the thing they have to DO — cash can't
  // hold a date on its own, someone has to actually meet.
  if (!who) return `Reach out on ${phone} to arrange payment.`;
  return `Reach out to ${who} on ${phone} to arrange payment.`;
}

/**
 * The optional "drop it at my office" half of Cash, as one line — or null when
 * the DJ hasn't offered one.
 *
 * Shared so the booking card and the email can't word it differently.
 */
export function cashDropoff(m: Pick<PaymentMethod, 'dropoffAddress' | 'dropoffHours'>): string | null {
  const addr = (m.dropoffAddress || '').trim();
  if (!addr) return null;
  const hrs = (m.dropoffHours || '').trim();
  // The hours ride WITH the address, never as a separate line that can get
  // separated from it. "Drop it at 123 Main St" on its own is how someone ends
  // up at a locked door on a Sunday.
  return hrs ? `${addr} — open ${hrs}` : addr;
}

/**
 * What the client includes with their check so the DJ can match it.
 *
 * Deliberately NOT "write it on the memo line": a memo line is one short field
 * that a date and a venue name often won't fit, and plenty of people are
 * writing from a book where it's already used. "Include it" leaves them free to
 * put it on a note, the envelope, or the memo if there's room.
 *
 * A check arrives days later in an envelope with nothing on it but an amount.
 * The reference code (GDC-1A2B-D) means nothing to the client and they'll
 * mistype it; the event date and venue are things they already know and can't
 * get wrong. That's what makes an envelope matchable to a booking.
 *
 * Falls back to the reference when we don't have the booking to hand.
 */
export function checkMemo(eventDate?: string | null, venueName?: string | null, reference?: string): string {
  const parts: string[] = [];
  if (eventDate) {
    const d = new Date(eventDate);
    if (!Number.isNaN(d.getTime())) {
      // timeZone:'UTC' is load-bearing. event_date is a plain 'YYYY-MM-DD',
      // which Date parses as UTC midnight — rendered in any US timezone that's
      // the DAY BEFORE. A check memo reading "Jul 23" for a July 24 wedding is
      // worse than no memo: it matches the wrong booking, or none.
      parts.push(d.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      }));
    }
  }
  if (venueName) parts.push(venueName);
  if (parts.length > 0) return parts.join(' \u00b7 ');
  return reference || '';
}

/** One-line instruction for a rail we cannot link. */
export function copyInstruction(m: PaymentMethod): string {
  switch (m.type) {
    case 'zelle':  return 'Open your bank app, choose Zelle, and send to:';
    case 'paypal': return 'Open PayPal, choose Send, and send to:';
    case 'cash':   return 'Pay in person. Call to arrange:';
    case 'check':  return 'Make the check payable to:';
    default:       return 'Send payment to:';
  }
}

/**
 * Reference code for the payment memo. Derived, never stored — stable for a
 * given booking + kind. Without it a DJ with three $600 deposits in a week
 * cannot tell which incoming Zelle belongs to which booking.
 *   GDC-1A2B-D  (deposit)   GDC-1A2B-B  (balance/invoice)
 */
export function referenceCode(bookingId: string, kind: string): string {
  const short = (bookingId || '').replace(/-/g, '').slice(0, 4).toUpperCase();
  const suffix = kind === 'balance' ? 'B' : kind === 'deposit' ? 'D' : 'X';
  return `GDC-${short}-${suffix}`;
}

/** Enabled + valid methods, in display order (linkable rails first). */
export function usableMethods(methods: PaymentMethod[] | null | undefined): PaymentMethod[] {
  const list = Array.isArray(methods) ? methods : [];
  return list
    // 'card' can never be a manual row — if one sneaks into the JSON it must
    // not render as a handle-less rail. Its availability is decided by
    // users.stripe_connect_ready, upstream of this module.
    .filter((m) => m && m.type !== 'card' && m.enabled && !METHOD_TYPES[m.type]?.validate(m.handle || ''))
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
}
