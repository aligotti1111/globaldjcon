// sendPaypalPaidEmails — the receipt + DJ notification for a settled PayPal
// payment. Called from BOTH the capture-order route and the webhook, whichever
// actually flips the row to paid (each guards on its idempotency key, so this
// only runs on the write that stuck — the email never doubles).
//
// Mirrors the Stripe done route's two emails exactly, so a PayPal payer gets an
// identical experience: the host gets the same branded receipt PDF + booking
// progress box, and the DJ gets a "you got paid" notice. Everything here is
// best-effort and wrapped so a mail failure never affects the payment itself.

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveUserEmail } from '@/lib/supabase/admin';
import { buildBookingDocAttachment } from '@/lib/receiptDocs';
import { bookingProgressBox } from '@/lib/bookingProgressBox';
import { Resend } from 'resend';

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const SITE_URL = 'https://globaldjconnect.com';

const round2 = (n: number) => Number(n.toFixed(2));
function money(n: number, currency = 'USD'): string {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n); }
  catch { return `$${n.toFixed(2)}`; }
}

// The shared branded shell — identical to the one the Stripe done route and the
// payments route use.
function shell(content: string): string {
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

interface BookingLite {
  dj_id: string | null;
  requester_id: string | null;
  host_email: string | null;
  requester_name: string | null;
  event_date: string | null;
  venue_name: string | null;
}

export interface PaypalPaidArgs {
  bookingId: string;
  kind: string;            // 'deposit' | 'balance' | 'other'
  currency: string;
  receivedNow: number;     // the amount that just came in
  paidToDate: number;      // total paid across the booking after this
  amountTotal: number;     // this payment row's full amount
}

export async function sendPaypalPaidEmails(db: SupabaseClient, args: PaypalPaidArgs): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  const { data: bData } = await db
    .from('bookings')
    .select('dj_id, requester_id, host_email, requester_name, event_date, venue_name')
    .eq('id', args.bookingId)
    .maybeSingle();
  const b = bData as BookingLite | null;
  if (!b) return;

  const cur = args.currency || 'USD';
  const kindNoun = args.kind === 'balance' ? 'balance' : args.kind === 'deposit' ? 'deposit' : 'payment';
  const settled = args.paidToDate >= Number(args.amountTotal) - 0.01;
  const outstanding = round2(Math.max(0, Number(args.amountTotal) - args.paidToDate));
  const resend = new Resend(process.env.RESEND_API_KEY);

  const hostEmail = b.host_email || (b.requester_id ? await resolveUserEmail(b.requester_id) : null);

  // ── Receipt to the host (best-effort) ──
  if (hostEmail) {
    try {
      const receiptAtt = await buildBookingDocAttachment(db, {
        docKind: 'receipt',
        bookingId: args.bookingId,
        djId: b.dj_id || '',
        currency: cur,
        paymentKind: (args.kind as 'deposit' | 'balance' | 'other'),
        receivedNow: args.receivedNow,
        method: 'paypal',
        paidToDate: args.paidToDate,
        clientEmail: hostEmail,
      });
      const content = settled
        ? `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">Payment received — ${money(args.paidToDate, cur)}</h1>
<p style="margin:0;color:#333;font-size:15px;line-height:1.6;">Thanks! Your ${kindNoun} is settled${b.event_date ? ` for ${b.event_date}` : ''}. A receipt is attached.</p>`
        : `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">Partial payment received</h1>
<p style="margin:0;color:#333;font-size:15px;line-height:1.6;">${money(args.paidToDate, cur)} of ${money(Number(args.amountTotal), cur)} received — <strong>${money(outstanding, cur)} still due</strong>. A receipt is attached.</p>`;
      const progressBox = await bookingProgressBox(args.bookingId);
      await resend.emails.send({
        from: FROM,
        to: hostEmail,
        subject: `Receipt — ${money(args.receivedNow, cur)}`,
        html: shell(content + (progressBox ? `<div style="margin-top:24px;">${progressBox}</div>` : '')),
        attachments: receiptAtt ? [receiptAtt] : undefined,
      });
    } catch { /* receipt is best-effort */ }
  }

  // ── Notification to the DJ (best-effort) ──
  if (b.dj_id) {
    try {
      const djEmail = await resolveUserEmail(b.dj_id);
      if (djEmail) {
        const who = b.requester_name || 'Your client';
        const djContent = `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">${who} paid ${money(args.receivedNow, cur)} by PayPal</h1>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="min-width:100%;background:#fafafa;border:1px solid #ededed;border-radius:10px;margin:0 0 16px;">
<tr><td style="padding:14px 18px;font-size:15px;color:#333;line-height:1.6;">
Paid directly into your PayPal account${b.event_date ? ` for <strong>${b.event_date}</strong>` : ''}${b.venue_name ? ` · ${b.venue_name}` : ''}.<br>
${settled ? 'This request is now <strong style="color:#0a8f74;">fully settled</strong>.' : `<strong style="color:#c08a3e;">${money(outstanding, cur)} still due</strong> on this request.`}
</td></tr></table>
<p style="margin:0;color:#999;font-size:12px;line-height:1.6;">Already confirmed — nothing for you to do. Global DJ Connect never touches the money; PayPal's fee comes out on their side.</p>`;
        await resend.emails.send({
          from: FROM,
          to: djEmail,
          subject: `${who} paid ${money(args.receivedNow, cur)} by PayPal`,
          html: shell(djContent),
        });
      }
    } catch { /* notification is best-effort */ }
  }
}
