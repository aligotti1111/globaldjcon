// Pure, top-level helpers/constants/types for app/api/payments/route.ts.
// Extracted verbatim from route.ts — no behavior change. Server-only pure code
// (no 'use client'). The POST/GET handlers import these from './payments.helpers'.
import {
  buildPayLink,
  isLinkable,
  displayHandle,
  copyInstruction,
  METHOD_TYPES,
  type PaymentMethod,
} from '@/lib/paymentMethods';

const SITE_URL = 'https://globaldjconnect.com';

export const FROM = 'Global DJ Connect <info@globaldjconnect.com>';

export const KINDS = new Set(['deposit', 'balance', 'other']);

export interface BookingRow {
  id: string;
  dj_id: string | null;
  requester_id: string | null;
  host_email: string | null;
  requester_name: string | null;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue_name: string | null;
  currency: string | null;
  deposit_amount: number | null;
  total_with_tax: number | null;
  counter_rate: number | null;
  quoted_rate: number | null;
  offer_amount: number | null;
  balance_settled_total?: number | null;
  status_overrides?: Record<string, boolean> | null;
}

export interface PaymentRow {
  id: string;
  booking_id: string;
  kind: string;
  amount: number;
  amount_paid: number;
  currency: string;
  status: string;
  method: string | null;
  due_date: string | null;
  // Set once a Stripe Checkout session settles this row (card rail); null for
  // manual rails. Its presence is the idempotency guard for verify-checkout.
  stripe_session_id: string | null;
}

export function money(n: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export const round2 = (n: number) => Number(n.toFixed(2));

// "HH:MM" (24h stored) -> "7:30 PM". Blank/invalid returns ''.
export function fmtTime(t?: string | null): string {
  if (!t) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return '';
  let h = Number(m[1]); const min = m[2];
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${min} ${ap}`;
}

// Cosmetic wrapper only. (send-email has its own copy of this shell; the
// MONEY logic is shared via lib/paymentMethods so the two can't disagree on
// anything that matters. Worth deduping the shell one day.)
export function shell(content: string): string {
  return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
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

export const BRAND: Record<string, string> = {
  venmo: '#3D95CE', cashapp: '#00D632', paypal: '#003087', zelle: '#6D1ED4',
};

// Branded badge per rail — a brand-coloured rounded tile with the service's
// mark. Real image logos can't be used reliably in email (Gmail strips SVG and
// external images are often blocked), so these pure-HTML badges stand in and
// render identically everywhere.
export const BADGE: Record<string, { bg: string; glyph: string; soft: string; border: string }> = {
  venmo:   { bg: '#3D95CE', glyph: 'V', soft: '#EAF4FB', border: '#BFDCF0' },
  cashapp: { bg: '#00D632', glyph: '$', soft: '#E7FBEE', border: '#BDEFCC' },
  paypal:  { bg: '#003087', glyph: 'P', soft: '#EAEEF7', border: '#C5CFE6' },
  zelle:   { bg: '#6D1ED4', glyph: 'Z', soft: '#F1EAFB', border: '#D8C4F1' },
  cash:    { bg: '#2E7D32', glyph: '$', soft: '#EBF5EC', border: '#C3E1C5' },
  check:   { bg: '#455A64', glyph: '✓', soft: '#EEF1F3', border: '#CBD5DA' },
};

/**
 * The payment options, as email HTML. Buttons for rails we can link (amount +
 * recipient preloaded); copyable text for the ones we can't (Zelle always).
 *
 * Built from the SAME buildPayLink() the booking card uses — the email and the
 * card physically cannot drift.
 *
 * Note the Venmo caveat: its link only completes inside the phone app. An
 * email can't detect the device, so we say so in words here; the booking card
 * (which can detect it) shows a QR instead.
 */
export function optionsHtml(methods: PaymentMethod[], amount: number, currency: string, reference: string, djName: string, paymentId: string, eventDate?: string | null, venueName?: string | null, isBalance = false): string {
  // One consistent card per method: a brand badge on the left, the details on
  // the right. Linkable rails (Venmo/Cash App/PayPal.me) get a pay button;
  // the rest show copyable handles or mailing details.
  //
  // paymentId may be EMPTY for invoices that have no ledger row (overtime): in
  // that case Venmo links straight to the rail (no /pay QR page) and the "let
  // your DJ know" tracking links are omitted. Everything else is identical, so
  // the overtime invoice email matches the deposit/balance ones.
  const hasId = !!paymentId;
  const amountTag = `<div style="text-align:right;margin:10px 0 0;color:#9a9a9a;font-size:11px;font-weight:700;letter-spacing:.02em;">${money(amount, currency)}</div>`;

  // One clean card: a themed accent bar, then a badge + brand name on ONE row,
  // then the action (button or handle) full-width below. Same header on every
  // card keeps them visually consistent and compact.
  const card = (type: string, body: string, showAmount = true): string => {
    const b = BADGE[type] || { bg: '#0a6f61', glyph: '•', soft: '#f4f7f6', border: '#d7e3e0' };
    const mt = (METHOD_TYPES as Record<string, { label?: string }>)[type];
    const label = (mt && mt.label) || type;
    return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;min-width:100%;border:1px solid ${b.border};border-radius:12px;margin:0 0 12px;background:${b.soft};overflow:hidden;">
<tr><td style="height:4px;background:${b.bg};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:14px 16px 16px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr>
<td width="40" valign="middle"><table cellpadding="0" cellspacing="0" border="0"><tr><td width="40" height="40" align="center" valign="middle" style="background:${b.bg};border-radius:10px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:19px;font-weight:700;line-height:40px;">${b.glyph}</td></tr></table></td>
<td valign="middle" style="padding-left:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-weight:700;color:${b.bg};font-size:15px;">${label}</td>
</tr></table>
${body}${showAmount ? amountTag : ''}
</td></tr></table>`;
  };

  const rows = methods.map((m) => {
    const link = buildPayLink(m, amount, reference);
    const tint = BRAND[m.type] || '#0a6f61';

    if (isLinkable(m) && link) {
      // Venmo goes through our /pay page (phone → app, laptop → QR); the rest
      // link straight to the rail with amount + note preloaded.
      const href = m.type === 'venmo' ? (hasId ? `${SITE_URL}/pay/${paymentId}/venmo` : link) : link;
      const btn = `<a href="${href}" style="display:block;margin:12px 0 0;background:${tint};border-radius:8px;padding:14px 22px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;text-align:center;">${m.type === 'cashapp' ? 'Open Cash App' : `Pay ${money(amount, currency)}`} &rarr;</a>`;
      const steps = m.type === 'cashapp' ? `<div style="margin:12px 0 0;padding:12px 14px;background:#ffffff;border:1px solid #BDEFCC;border-radius:8px;"><p style="margin:0 0 6px;color:#111;font-size:12px;font-weight:700;">Cash App won't pre-fill this — here's how to pay:</p><ol style="margin:0;padding-left:18px;color:#444;font-size:12px;line-height:1.7;"><li>Tap <strong>Open Cash App</strong> above.</li><li>Enter <strong>${money(amount, currency)}</strong> and tap Pay.</li><li>Enter recipient <strong>${displayHandle(m)}</strong>.</li><li>Add <strong>${reference}</strong> in the "For" note.</li><li>Confirm and send.</li></ol></div>` : '';
      const body = `${btn}${steps}`;
      return card(m.type, body, false);
    }

    if (m.type === 'cash') {
      const confirmBtn = hasId
        ? `\n<a href="${SITE_URL}/pay/${paymentId}/check-sent?mode=at-event&method=cash" style="display:block;margin:12px 0 0;background:#2E7D32;border-radius:8px;padding:13px 20px;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;text-align:center;">Confirm Cash</a>`
        : '';
      const cashMsg = `Please click confirm below if you plan to ${isBalance ? 'settle the balance' : 'pay the deposit'} in cash, further instruction can be found on the link.`;
      const body = `<p style="margin:10px 0 0;color:#111;font-size:13px;line-height:1.55;">${cashMsg}</p>${confirmBtn}`;
      return card('cash', body);
    }

    if (m.type === 'check') {
      const confirmBtn = hasId
        ? `\n<a href="${SITE_URL}/pay/${paymentId}/check-sent?mode=at-event&method=check" style="display:block;margin:12px 0 0;background:#37474F;border-radius:8px;padding:13px 20px;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;text-align:center;">Confirm Check</a>`
        : '';
      // The DJ's check rules (from their payment settings) decide the wording.
      // The full details — who it's payable to, the mailing address, the memo,
      // and how to hand it off — live on the confirm page, so the email stays a
      // short heads-up that points there.
      const checkMsg = `Please click confirm below if you plan to ${isBalance ? 'settle the balance' : 'pay the deposit'} with a check, further instruction can be found on the link.`;
      const body = `<p style="margin:10px 0 0;color:#666;font-size:13px;line-height:1.55;">${checkMsg}</p>${confirmBtn}`;
      return card('check', body);
    }

    // PayPal via EMAIL (a PayPal.me link is linkable above and renders a button;
    // a bare email can't carry an amount, so give step-by-step directions like
    // Cash App instead of a lone address).
    if (m.type === 'paypal') {
      const btn = `<a href="https://www.paypal.com/myaccount/transfer/homepage/pay" style="display:block;margin:12px 0 0;background:${tint};border-radius:8px;padding:14px 22px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;text-align:center;">Open PayPal &rarr;</a>`;
      const steps = `<div style="margin:12px 0 0;padding:12px 14px;background:#ffffff;border:1px solid #C5CFE6;border-radius:8px;"><p style="margin:0 0 6px;color:#111;font-size:12px;font-weight:700;">How to pay with PayPal:</p><ol style="margin:0;padding-left:18px;color:#444;font-size:12px;line-height:1.7;"><li>Tap <strong>Open PayPal</strong> above.</li><li>Send to <strong>${displayHandle(m)}</strong>.</li><li>Enter <strong>${money(amount, currency)}</strong>.</li><li>Add <strong>${reference}</strong> in the note.</li><li>Send.</li></ol></div>`;
      const body = `${btn}${steps}`;
      return card('paypal', body, false);
    }

    const body = `<p style="margin:10px 0 0;color:#666;font-size:12px;line-height:1.5;">${copyInstruction(m)}</p>
<p style="margin:2px 0 0;font-family:monospace;font-size:15px;color:#111;word-break:break-all;">${displayHandle(m)}</p>
${m.type === 'zelle' ? `<p style="margin:7px 0 0;color:#9a9a9a;font-size:11px;">Double-check before sending — Zelle payments can't be reversed.</p>` : ''}`;
    return card(m.type, body);
  });

  return rows.join('');
}
