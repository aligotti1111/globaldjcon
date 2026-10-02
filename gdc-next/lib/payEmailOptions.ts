// Shared payment-options email block — the same per-method cards the deposit /
// balance REQUEST email shows (Card, PayPal, Venmo, Cash App, Zelle, Cash,
// Check). Reused by the automatic payment-reminder cron so a reminder offers
// every way to pay, not just a single "Pay your balance" button.

import {
  buildPayLink,
  isLinkable,
  displayHandle,
  copyInstruction,
  METHOD_TYPES,
  type PaymentMethod,
} from '@/lib/paymentMethods';

const SITE_URL = 'https://globaldjconnect.com';

const BADGE: Record<string, { bg: string; glyph: string; soft: string; border: string }> = {
  venmo:   { bg: '#3D95CE', glyph: 'V', soft: '#EAF4FB', border: '#BFDCF0' },
  cashapp: { bg: '#00D632', glyph: '$', soft: '#E7FBEE', border: '#BDEFCC' },
  paypal:  { bg: '#003087', glyph: 'P', soft: '#EAEEF7', border: '#C5CFE6' },
  zelle:   { bg: '#6D1ED4', glyph: 'Z', soft: '#F1EAFB', border: '#D8C4F1' },
  cash:    { bg: '#2E7D32', glyph: '$', soft: '#EBF5EC', border: '#C3E1C5' },
  check:   { bg: '#455A64', glyph: '✓', soft: '#EEF1F3', border: '#CBD5DA' },
};
const BRAND: Record<string, string> = {
  venmo: '#3D95CE', cashapp: '#00D632', paypal: '#003087', zelle: '#6D1ED4',
};

function money(n: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  } catch { return `$${n.toFixed(2)}`; }
}

// The per-method cards (no Stripe card / PayPal-Connect — those are separate
// blocks added by buildPayEmailBlocks).
export function optionsHtml(methods: PaymentMethod[], amount: number, currency: string, reference: string, _djName: string, paymentId: string, _eventDate?: string | null, _venueName?: string | null, isBalance = false): string {
  const hasId = !!paymentId;
  const amountTag = `<div style="text-align:right;margin:10px 0 0;color:#9a9a9a;font-size:11px;font-weight:700;letter-spacing:.02em;">${money(amount, currency)}</div>`;

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
      const href = m.type === 'venmo' ? (hasId ? `${SITE_URL}/pay/${paymentId}/venmo` : link) : link;
      const btn = `<a href="${href}" style="display:block;margin:12px 0 0;background:${tint};border-radius:8px;padding:14px 22px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;text-align:center;">${m.type === 'cashapp' ? 'Open Cash App' : `Pay ${money(amount, currency)}`} &rarr;</a>`;
      const steps = m.type === 'cashapp' ? `<div style="margin:12px 0 0;padding:12px 14px;background:#ffffff;border:1px solid #BDEFCC;border-radius:8px;"><p style="margin:0 0 6px;color:#111;font-size:12px;font-weight:700;">Cash App won't pre-fill this — here's how to pay:</p><ol style="margin:0;padding-left:18px;color:#444;font-size:12px;line-height:1.7;"><li>Tap <strong>Open Cash App</strong> above.</li><li>Enter <strong>${money(amount, currency)}</strong> and tap Pay.</li><li>Enter recipient <strong>${displayHandle(m)}</strong>.</li><li>Add <strong>${reference}</strong> in the "For" note.</li><li>Confirm and send.</li></ol></div>` : '';
      return card(m.type, `${btn}${steps}`, false);
    }

    if (m.type === 'cash') {
      const confirmBtn = hasId ? `\n<a href="${SITE_URL}/pay/${paymentId}/check-sent?mode=at-event&method=cash" style="display:block;margin:12px 0 0;background:#2E7D32;border-radius:8px;padding:13px 20px;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;text-align:center;">Confirm Cash</a>` : '';
      const cashMsg = `Please click confirm below if you plan to ${isBalance ? 'settle the balance' : 'pay the deposit'} in cash, further instruction can be found on the link.`;
      return card('cash', `<p style="margin:10px 0 0;color:#111;font-size:13px;line-height:1.55;">${cashMsg}</p>${confirmBtn}`);
    }

    if (m.type === 'check') {
      const confirmBtn = hasId ? `\n<a href="${SITE_URL}/pay/${paymentId}/check-sent?mode=at-event&method=check" style="display:block;margin:12px 0 0;background:#37474F;border-radius:8px;padding:13px 20px;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;text-align:center;">Confirm Check</a>` : '';
      const checkMsg = `Please click confirm below if you plan to ${isBalance ? 'settle the balance' : 'pay the deposit'} with a check, further instruction can be found on the link.`;
      return card('check', `<p style="margin:10px 0 0;color:#666;font-size:13px;line-height:1.55;">${checkMsg}</p>${confirmBtn}`);
    }

    if (m.type === 'paypal') {
      const btn = `<a href="https://www.paypal.com/myaccount/transfer/homepage/pay" style="display:block;margin:12px 0 0;background:${tint};border-radius:8px;padding:14px 22px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;text-align:center;">Open PayPal &rarr;</a>`;
      const steps = `<div style="margin:12px 0 0;padding:12px 14px;background:#ffffff;border:1px solid #C5CFE6;border-radius:8px;"><p style="margin:0 0 6px;color:#111;font-size:12px;font-weight:700;">How to pay with PayPal:</p><ol style="margin:0;padding-left:18px;color:#444;font-size:12px;line-height:1.7;"><li>Tap <strong>Open PayPal</strong> above.</li><li>Send to <strong>${displayHandle(m)}</strong>.</li><li>Enter <strong>${money(amount, currency)}</strong>.</li><li>Add <strong>${reference}</strong> in the note.</li><li>Send.</li></ol></div>`;
      return card('paypal', `${btn}${steps}`, false);
    }

    const body = `<p style="margin:10px 0 0;color:#666;font-size:12px;line-height:1.5;">${copyInstruction(m)}</p>
<p style="margin:2px 0 0;font-family:monospace;font-size:15px;color:#111;word-break:break-all;">${displayHandle(m)}</p>
${m.type === 'zelle' ? `<p style="margin:7px 0 0;color:#9a9a9a;font-size:11px;">Double-check before sending — Zelle payments can't be reversed.</p>` : ''}`;
    return card(m.type, body);
  });

  return rows.join('');
}

interface PayBlocksArgs {
  methods: PaymentMethod[];
  amount: number;
  currency: string;
  reference: string;
  djName: string;
  paymentId: string;
  eventDate?: string | null;
  venueName?: string | null;
  isBalance?: boolean;
  stripeReady?: boolean;
  paypalReady?: boolean;
}

// The full set of pay cards, exactly like the request email: Stripe Card (if
// connected), PayPal & Venmo Connect (if connected), then every manual rail.
export function buildPayEmailBlocks(a: PayBlocksArgs): string {
  const { methods, amount, currency, reference, djName, paymentId, eventDate, venueName, isBalance = false, stripeReady = false, paypalReady = false } = a;
  const cardBlock = stripeReady
    ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;min-width:100%;border:1px solid #D3CFFF;border-radius:12px;margin:0 0 12px;background:#F2F1FF;overflow:hidden;">
<tr><td style="height:4px;background:#635BFF;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:14px 16px 16px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr>
<td width="40" valign="middle"><table cellpadding="0" cellspacing="0" border="0"><tr><td width="40" height="40" align="center" valign="middle" style="background:#635BFF;border-radius:10px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:19px;font-weight:700;line-height:40px;">&#128179;</td></tr></table></td>
<td valign="middle" style="padding-left:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-weight:700;color:#635BFF;font-size:15px;">Card</td>
</tr></table>
<div style="margin:10px 0 0;text-align:center;font-size:0;line-height:0;">
<img src="${SITE_URL}/card-logos/visa.png" width="40" height="25" alt="Visa" style="display:inline-block;margin:0 4px;vertical-align:middle;border:0;outline:none;text-decoration:none;"><img src="${SITE_URL}/card-logos/mastercard.png" width="40" height="25" alt="Mastercard" style="display:inline-block;margin:0 4px;vertical-align:middle;border:0;outline:none;text-decoration:none;"><img src="${SITE_URL}/card-logos/amex.png" width="40" height="25" alt="Amex" style="display:inline-block;margin:0 4px;vertical-align:middle;border:0;outline:none;text-decoration:none;"><img src="${SITE_URL}/card-logos/discover.png" width="40" height="25" alt="Discover" style="display:inline-block;margin:0 4px;vertical-align:middle;border:0;outline:none;text-decoration:none;">
<a href="${SITE_URL}/pay/${paymentId}/card" style="display:block;margin:11px 0 0;background:#635BFF;border-radius:8px;padding:14px 22px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;text-align:center;">Pay ${money(amount, currency)} with card &rarr;</a>
<p style="margin:8px 0 0;color:#7a7a90;font-size:12px;text-align:center;line-height:1.5;">Secure checkout by Stripe — no account or sign-in needed.</p>
</td></tr></table>`
    : '';
  const paypalBlock = paypalReady
    ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;min-width:100%;border:1px solid #C5CFE6;border-radius:12px;margin:0 0 12px;background:#EAEEF7;overflow:hidden;">
<tr><td style="height:4px;background:#003087;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:14px 16px 16px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr>
<td width="40" valign="middle"><table cellpadding="0" cellspacing="0" border="0"><tr><td width="40" height="40" align="center" valign="middle" style="background:#003087;border-radius:10px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:19px;font-weight:700;line-height:40px;">P</td></tr></table></td>
<td valign="middle" style="padding-left:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-weight:700;color:#003087;font-size:15px;">PayPal &amp; Venmo</td>
</tr></table>
<a href="${SITE_URL}/pay/${paymentId}/paypal" style="display:block;margin:11px 0 0;background:#0070ba;border-radius:8px;padding:14px 22px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;text-align:center;">Pay ${money(amount, currency)} with PayPal &rarr;</a>
<p style="margin:8px 0 0;color:#7a7a90;font-size:12px;text-align:center;line-height:1.5;">Pay with PayPal or Venmo — no account or sign-in needed.</p>
</td></tr></table>`
    : '';
  // One PayPal option, not two: drop the manual PayPal.me card when Connect is on.
  const emailMethods = paypalReady ? methods.filter((m) => m.type !== 'paypal') : methods;
  return `${cardBlock}${paypalBlock}${optionsHtml(emailMethods, amount, currency, reference, djName, paymentId, eventDate, venueName, isBalance)}`;
}
