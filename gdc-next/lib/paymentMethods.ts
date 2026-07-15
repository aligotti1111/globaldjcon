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
//
// The prefilled amount is a SUGGESTION on every rail — the client can edit it
// before sending. That's fine: the DJ confirms what actually arrived, and
// amount_paid (not amount) is what settles the ledger.

export type PaymentMethodType =
  | 'zelle' | 'venmo' | 'cashapp' | 'paypal' | 'cash' | 'check' | 'other';

export interface PaymentMethod {
  id: string;
  type: PaymentMethodType;
  handle: string;
  note: string;
  enabled: boolean;
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const digitsOf = (v: string) => v.replace(/\D/g, '');

export interface TypeConfig {
  label: string;
  /** What the DJ types. Empty = this rail has no handle (cash). */
  handleLabel: string;
  placeholder: string;
  /** Shown to the DJ in settings — what the client will actually have to do. */
  hint: string;
  validate: (v: string) => string | null;
}

export const METHOD_TYPES: Record<PaymentMethodType, TypeConfig> = {
  zelle: {
    label: 'Zelle',
    handleLabel: 'Email or phone',
    placeholder: 'you@email.com or (555) 123-4567',
    hint: 'Client sends from their bank app. No link exists for Zelle, so they copy this by hand — double-check it. Usually free, but business use needs a business bank account and not every bank offers it.',
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
    hint: 'Use your PayPal.me link — the client gets a one-tap button with the amount already filled in. An email works, but they must open PayPal and send it by hand. Note: PayPal requires a Business account for commercial payments (even unincorporated) and may close a personal account used mainly for business. Business rates run about 2.99% + $0.49.',
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
    handleLabel: '',
    placeholder: '',
    hint: 'In person only. Fine for the balance on the night — but it can\'t hold a date in advance, so it rarely works as a deposit.',
    validate: () => null,
  },
  check: {
    label: 'Check',
    handleLabel: 'Payable to / mailing address',
    placeholder: 'DJ Nova LLC — 123 Main St, Staten Island, NY 10307',
    hint: 'Slowest rail. Client mails it; you confirm when it clears.',
    validate: (v) => (v.trim() ? null : 'Tell the client who to make it out to and where to send it.'),
  },
  other: {
    label: 'Other',
    handleLabel: 'Details',
    placeholder: 'Bank transfer — sort code / account no.',
    hint: 'Anything else you accept. The client sees exactly what you type here.',
    validate: (v) => (v.trim() ? null : 'Describe how the client should pay.'),
  },
};

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
    case 'venmo':   return `@${t}`;
    case 'cashapp': return `$${t}`;
    case 'paypal':  return t.replace(/^https?:\/\//i, '');
    case 'cash':    return 'Pay in person';
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

/** One-line instruction for a rail we cannot link. */
export function copyInstruction(m: PaymentMethod): string {
  switch (m.type) {
    case 'zelle':  return 'Open your bank app, choose Zelle, and send to:';
    case 'paypal': return 'Open PayPal, choose Send, and send to:';
    case 'cash':   return 'Pay the DJ in person.';
    case 'check':  return 'Make the check out to:';
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
    .filter((m) => m && m.enabled && !METHOD_TYPES[m.type]?.validate(m.handle || ''))
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
}
