// POST /api/payments
//
// One route, five actions — the whole manual payment lifecycle. Kept together
// because they share the same auth/ownership plumbing and the same rule:
//
//   THE CLIENT CAN ONLY EVER CLAIM. ONLY THE DJ CONFIRMS.
//   'mark-sent' tops out at pending_confirmation. Only a DJ-authed action
//   reaches partial/paid. If a client's word could flip the ledger, the status
//   strip would lie to the DJ — worse than having no feature.
//
// Actions:
//   request   (DJ)   → create a deposit/invoice row + email the client
//   mark-sent (host) → "I've sent it" — a claim, notifies the DJ
//   intent    (host) → "I'll pay at the event" — not a payment
//   confirm   (DJ)   → record what ACTUALLY arrived (an amount, not a boolean)
//   waive     (DJ)   → let it go
//
// The platform never touches money. This is a messenger and a ledger.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { canUsePro, type AccessFields } from '@/lib/access';
import {
  usableMethods,
  buildPayLink,
  isLinkable,
  displayHandle,
  copyInstruction,
  referenceCode,
  cashLine,
  checkMemo,
  METHOD_TYPES,
  type PaymentMethod,
} from '@/lib/paymentMethods';
// The invoice ("amount due") and receipt ("payment received") PDFs. The helper
// does its own fetching from the ids we pass and NEVER throws — a missing logo
// or a flaky fetch returns null, so the email that carries the live pay buttons
// always goes out regardless.
import { buildBookingDocAttachment } from '@/lib/receiptDocs';

export const runtime = 'nodejs';
export const maxDuration = 20;

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const SITE_URL = 'https://globaldjconnect.com';

const KINDS = new Set(['deposit', 'balance', 'other']);

interface BookingRow {
  id: string;
  dj_id: string | null;
  requester_id: string | null;
  host_email: string | null;
  requester_name: string | null;
  event_date: string | null;
  venue_name: string | null;
  currency: string | null;
  deposit_amount: number | null;
  total_with_tax: number | null;
  counter_rate: number | null;
  quoted_rate: number | null;
  offer_amount: number | null;
}

interface PaymentRow {
  id: string;
  booking_id: string;
  kind: string;
  amount: number;
  amount_paid: number;
  currency: string;
  status: string;
  method: string | null;
  due_date: string | null;
}

function money(n: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

const round2 = (n: number) => Number(n.toFixed(2));

// Cosmetic wrapper only. (send-email has its own copy of this shell; the
// MONEY logic is shared via lib/paymentMethods so the two can't disagree on
// anything that matters. Worth deduping the shell one day.)
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

const BRAND: Record<string, string> = {
  venmo: '#3D95CE', cashapp: '#00D632', paypal: '#003087', zelle: '#6D1ED4',
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
function optionsHtml(methods: PaymentMethod[], amount: number, currency: string, reference: string, djName: string, paymentId: string, eventDate?: string | null, venueName?: string | null): string {
  const rows = methods.map((m) => {
    const cfg = METHOD_TYPES[m.type];
    const link = buildPayLink(m, amount, reference);
    const tint = BRAND[m.type] || '#0a6f61';

    if (isLinkable(m) && link) {
      // VENMO GOES THROUGH OUR PAGE, not straight to venmo.com.
      //
      // Venmo blocks payments initiated from their website: on a phone the link
      // opens the app with the amount loaded; on a laptop it opens a profile the
      // client cannot pay from. An email cannot tell which device is reading it,
      // so this button was right for half the recipients and a silent dead end
      // for the other half — and the DJ's only clue was the money never showing
      // up.
      //
      // /pay/<id>/venmo can tell: phone → into the app, laptop → a QR of the
      // very same link to scan. One href, correct on both.
      const href = m.type === 'venmo'
        ? `${SITE_URL}/pay/${paymentId}/venmo`
        : link;
      const caveat = m.type === 'venmo'
        ? `<p style="margin:4px 0 0;color:#999;font-size:11px;">On a computer? We'll show a QR to scan — Venmo only takes payments in the app.</p>`
        : '';
      return `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 10px;width:100%;"><tr><td style="background:${tint};border-radius:6px;" align="center">
<a href="${href}" style="display:block;padding:14px 24px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Pay with ${cfg.label} — ${money(amount, currency)} →</a>
</td></tr></table>${caveat}`;
    }

    if (m.type === 'cash') {
      // "Pay in person" told the client nothing. Cash now carries a number and
      // a name, so say them: someone about to hand over $600 at a venue they've
      // never been to needs to know who to ask for.
      return `<div style="border:1px solid #e0e0e0;border-left:3px solid ${tint};border-radius:6px;padding:12px 14px;margin:0 0 10px;">
<p style="margin:0;font-weight:600;color:#111;font-size:14px;">Cash</p>
<p style="margin:4px 0 0;color:#666;font-size:13px;">${cashLine(m)}</p></div>`;
    }

    // Check has two halves plus what to include — an envelope arrives days later
    // nothing on it but an amount, and the event date + venue are the only
    // things the client already knows and can't mistype.
    if (m.type === 'check') {
      const memo = checkMemo(eventDate, venueName, reference);
      return `<div style="border:1px solid #e0e0e0;border-left:3px solid ${tint};border-radius:6px;padding:12px 14px;margin:0 0 10px;">
<p style="margin:0;font-weight:600;color:#111;font-size:14px;">Check</p>
<p style="margin:4px 0 0;color:#666;font-size:12px;">Make it payable to:</p>
<p style="margin:2px 0 0;font-size:15px;color:#111;">${m.handle}</p>
${m.contact ? `<p style="margin:6px 0 0;color:#666;font-size:12px;">Mail to:</p>
<p style="margin:2px 0 0;font-size:14px;color:#111;white-space:pre-line;">${m.contact}</p>` : ''}
${memo ? `<p style="margin:8px 0 0;color:#666;font-size:12px;">Please include this with your check:</p>
<p style="margin:2px 0 0;font-family:monospace;font-size:14px;color:#111;">${memo}</p>` : ''}
</div>`;
    }

    return `<div style="border:1px solid #e0e0e0;border-left:3px solid ${tint};border-radius:6px;padding:12px 14px;margin:0 0 10px;">
<p style="margin:0;font-weight:600;color:#111;font-size:14px;">${cfg.label}</p>
<p style="margin:4px 0 0;color:#666;font-size:12px;">${copyInstruction(m)}</p>
<p style="margin:2px 0 0;font-family:monospace;font-size:15px;color:#111;word-break:break-all;">${displayHandle(m)}</p>
${m.type === 'zelle' ? `<p style="margin:6px 0 0;color:#999;font-size:11px;">Double-check before sending — Zelle payments can't be reversed.</p>` : ''}
</div>`;
  });

  return rows.join('');
}

async function clientEmailFor(b: BookingRow): Promise<string | null> {
  if (b.host_email) return b.host_email;
  if (b.requester_id) return await resolveUserEmail(b.requester_id);
  return null;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  const action = typeof body.action === 'string' ? body.action : '';
  const admin = createAdminClient();
  // types/supabase.ts is generated and predates booking_payments, so the typed
  // client rejects .from('booking_payments') outright ("not assignable to
  // 'booking_drafts' | 'bookings' | ..."). Same family as the `as unknown as
  // never` casts used for newer COLUMNS, but this is a whole TABLE.
  // One cast to an untyped client for the new table beats scattering casts at
  // every call site. Regenerating types/supabase.ts would remove the need.
  const db = admin as unknown as SupabaseClient;

  // ───────────────────────────── request (DJ) ─────────────────────────────
  if (action === 'request') {
    const bookingId = typeof body.bookingId === 'string' ? body.bookingId : '';
    const kind = typeof body.kind === 'string' && KINDS.has(body.kind) ? body.kind : 'deposit';
    if (!bookingId) return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });

    const { data: bData } = await admin
      .from('bookings')
      .select('id, dj_id, requester_id, host_email, requester_name, event_date, venue_name, currency, deposit_amount, total_with_tax, counter_rate, quoted_rate, offer_amount')
      .eq('id', bookingId)
      .maybeSingle();
    const b = bData as BookingRow | null;
    if (!b) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
    if (b.dj_id !== user.id) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });

    // Tier gate, server-side. Deposits/invoices are Pro. Hiding the button in
    // the UI is not a paywall — anyone can POST here directly.
    // NOTE: lib/access says existing bookings should use bookingAllows(tier_stamp),
    // but tier_stamp is never written anywhere yet, so it would deny everyone.
    // Current standing is the only honest signal available today.
    const { data: djData } = await admin
      .from('users')
      .select('sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, comp_source, name, payment_methods')
      .eq('id', user.id)
      .maybeSingle();
    const dj = djData as (AccessFields & { name?: string | null; payment_methods?: unknown }) | null;
    if (!dj || !canUsePro(dj)) {
      return NextResponse.json({ error: 'Payments are a Pro feature.' }, { status: 403 });
    }

    const methods = usableMethods((Array.isArray(dj.payment_methods) ? dj.payment_methods : []) as PaymentMethod[]);
    if (methods.length === 0) {
      return NextResponse.json({ error: 'Add a payment method in Booking Settings first.' }, { status: 400 });
    }

    // Amount: derived server-side by default. The DJ may override — it's their
    // invoice and their money (unlike a client-supplied price, which we never
    // trust). Still validated as a sane positive number.
    const agreed = b.total_with_tax ?? b.counter_rate ?? b.quoted_rate ?? b.offer_amount ?? null;
    const { data: paidData } = await db
      .from('booking_payments')
      .select('amount_paid')
      .eq('booking_id', bookingId);
    const alreadyPaid = ((paidData as { amount_paid?: number }[] | null) || [])
      .reduce((s, r) => s + Number(r.amount_paid || 0), 0);

    let amount: number | null =
      kind === 'deposit'
        ? (b.deposit_amount != null ? Number(b.deposit_amount) : null)
        : (agreed != null ? round2(Number(agreed) - alreadyPaid) : null);

    if (body.amount != null) {
      const override = Number(body.amount);
      if (!Number.isFinite(override) || override <= 0 || override > 1_000_000) {
        return NextResponse.json({ error: 'Invalid amount.' }, { status: 400 });
      }
      amount = round2(override);
    }
    if (amount == null || !(amount > 0)) {
      return NextResponse.json({ error: 'No amount to request on this booking.' }, { status: 400 });
    }

    const dueDate = typeof body.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)
      ? body.dueDate : null;

    const insertPayload = {
      booking_id: bookingId,
      kind,
      amount,
      currency: b.currency || 'USD',
      status: 'requested',
      due_date: dueDate,
    };
    const { data: created, error: insErr } = await db
      .from('booking_payments')
      .insert(insertPayload as unknown as never)
      .select('id, booking_id, kind, amount, amount_paid, currency, status, method, due_date')
      .single();
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 502 });
    const payment = created as unknown as PaymentRow;

    // Email the client.
    const to = await clientEmailFor(b);
    if (to && process.env.RESEND_API_KEY) {
      const djName = dj.name || 'your DJ';
      const reference = referenceCode(bookingId, kind);
      const noun = kind === 'balance' ? 'balance' : 'deposit';
      const when = b.event_date
        ? new Date(`${b.event_date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        : 'your event';
      const recap = `<div style="background:#f8f8f8;border-radius:8px;padding:14px 16px;margin:0 0 20px;">
<p style="margin:0;color:#666;font-size:13px;line-height:1.7;">
<strong style="color:#111;">${djName}</strong><br/>${when}${b.venue_name ? ` · ${b.venue_name}` : ''}
</p></div>`;

      const content = `
<h1 style="margin:0 0 6px;font-size:22px;color:#111;">${noun === 'balance' ? 'Balance due' : 'Deposit required'} — ${money(amount, b.currency || 'USD')}</h1>
${recap}
<p style="margin:0 0 18px;color:#333;font-size:15px;line-height:1.6;">
Please choose a payment option below to complete the ${noun} required to reserve your date.
</p>
${optionsHtml(methods, amount, b.currency || 'USD', reference, djName, payment.id, b.event_date, b.venue_name)}
<div style="background:#f8f8f8;border-radius:6px;padding:12px 14px;margin:16px 0 0;">
<p style="margin:0;color:#666;font-size:12px;">Reference — please include in the payment note:</p>
<p style="margin:3px 0 0;font-family:monospace;font-size:16px;color:#111;font-weight:700;">${reference}</p>
</div>
<p style="margin:18px 0 0;color:#999;font-size:12px;line-height:1.6;">
Payment goes directly to ${djName}. ${djName} will confirm once it lands. A copy of your invoice is attached.
</p>`;

      // A branded INVOICE PDF rides along — the paper trail. The buttons above
      // stay the way to actually pay (a PDF can't hold a live card link); the
      // attachment is the itemised record. null on any hiccup, and the email
      // still sends.
      const invoiceAtt = await buildBookingDocAttachment(db, {
        docKind: 'invoice',
        bookingId,
        djId: user.id,
        currency: b.currency || 'USD',
        paymentKind: kind as 'deposit' | 'balance' | 'other',
        amountDue: amount,
        paidToDate: alreadyPaid,
        clientEmail: to,
      });

      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: FROM,
          to,
          subject: `${noun === 'balance' ? 'Balance due' : 'Deposit required'} — ${money(amount, b.currency || 'USD')} · ${djName}`,
          html: shell(content),
          attachments: invoiceAtt ? [invoiceAtt] : undefined,
        });
      } catch {
        // The row exists and the card shows the options — an email failure
        // must not undo a successful request.
      }
    }

    return NextResponse.json({ ok: true, payment });
  }

  // ───────────────────── mark-sent / intent (host) ─────────────────────
  if (action === 'mark-sent' || action === 'intent') {
    const paymentId = typeof body.paymentId === 'string' ? body.paymentId : '';
    if (!paymentId) return NextResponse.json({ error: 'Missing paymentId' }, { status: 400 });

    const { data: pData } = await db
      .from('booking_payments')
      .select('id, booking_id, kind, amount, amount_paid, currency, status, method, due_date')
      .eq('id', paymentId)
      .maybeSingle();
    const p = pData as PaymentRow | null;
    if (!p) return NextResponse.json({ error: 'Payment not found.' }, { status: 404 });

    const { data: bData } = await admin
      .from('bookings')
      .select('id, dj_id, requester_id, host_email, requester_name, event_date, venue_name, currency, deposit_amount, total_with_tax, counter_rate, quoted_rate, offer_amount')
      .eq('id', p.booking_id)
      .maybeSingle();
    const b = bData as BookingRow | null;
    if (!b) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
    // Only the host on this booking. (The DJ has their own confirm action.)
    if (b.requester_id !== user.id) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
    if (p.status === 'paid' || p.status === 'waived') {
      return NextResponse.json({ ok: true, payment: p });
    }

    const patch: Record<string, unknown> = action === 'intent'
      ? { client_intent: 'pay_at_event' }
      // A CLAIM. Never 'paid' — that's the DJ's call alone.
      : { status: 'pending_confirmation', marked_sent_at: new Date().toISOString(),
          method: typeof body.method === 'string' ? body.method : null,
          client_intent: 'pay_now' };

    const { error: upErr } = await db
      .from('booking_payments')
      .update(patch as unknown as never)
      .eq('id', paymentId);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 502 });

    // Tell the DJ. "Client says they sent it" vs "client will pay at the
    // event" mean completely different things on a Friday night.
    if (b.dj_id && process.env.RESEND_API_KEY) {
      const djEmail = await resolveUserEmail(b.dj_id);
      if (djEmail) {
        const who = b.requester_name || 'Your client';
        const amt = money(Number(p.amount), p.currency || 'USD');
        const content = action === 'intent'
          ? `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">${who} will pay at the event</h1>
<p style="margin:0;color:#333;font-size:15px;line-height:1.6;">They plan to hand you <strong>${amt}</strong> in person${b.event_date ? ` on ${b.event_date}` : ''}. Nothing to do — bring a receipt book.</p>`
          : `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">${who} says they've sent ${amt}</h1>
<p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.6;">Check your account, then confirm what actually arrived. It isn't marked paid until you do.</p>
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td style="background:#0a6f61;border-radius:6px;">
<a href="${SITE_URL}/upcoming-bookings" style="display:inline-block;padding:12px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">Review booking</a>
</td></tr></table>`;
        try {
          const resend = new Resend(process.env.RESEND_API_KEY);
          await resend.emails.send({ from: FROM, to: djEmail, subject: action === 'intent' ? `${who} will pay at the event` : `${who} says they've sent ${amt}`, html: shell(content) });
        } catch { /* non-fatal */ }
      }
    }

    return NextResponse.json({ ok: true });
  }

  // ─────────────────── confirm / waive (DJ only) ───────────────────
  if (action === 'confirm' || action === 'waive') {
    const paymentId = typeof body.paymentId === 'string' ? body.paymentId : '';
    if (!paymentId) return NextResponse.json({ error: 'Missing paymentId' }, { status: 400 });

    const { data: pData } = await db
      .from('booking_payments')
      .select('id, booking_id, kind, amount, amount_paid, currency, status, method, due_date')
      .eq('id', paymentId)
      .maybeSingle();
    const p = pData as PaymentRow | null;
    if (!p) return NextResponse.json({ error: 'Payment not found.' }, { status: 404 });

    const { data: bData } = await admin
      .from('bookings')
      .select('id, dj_id, requester_id, host_email, requester_name, event_date, venue_name, currency, deposit_amount, total_with_tax, counter_rate, quoted_rate, offer_amount')
      .eq('id', p.booking_id)
      .maybeSingle();
    const b = bData as BookingRow | null;
    if (!b) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
    if (b.dj_id !== user.id) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });

    if (action === 'waive') {
      const { error } = await db
        .from('booking_payments')
        .update({ status: 'waived', confirmed_at: new Date().toISOString() } as unknown as never)
        .eq('id', paymentId);
      if (error) return NextResponse.json({ error: error.message }, { status: 502 });
      return NextResponse.json({ ok: true });
    }

    // Confirm takes an AMOUNT, not a boolean.
    //
    // The rails force this: unverified Venmo caps at $299.99/week, Cash App at
    // $250 — both below a typical $450-900 deposit. A client physically cannot
    // send $600 in one go. With a boolean the DJ's only options would be "paid"
    // (false) or "unpaid" (also false) — the system would force them to lie.
    const received = Number(body.amountReceived);
    if (!Number.isFinite(received) || received <= 0 || received > 1_000_000) {
      return NextResponse.json({ error: 'Enter the amount you actually received.' }, { status: 400 });
    }
    const nextPaid = round2(Number(p.amount_paid || 0) + received);
    // Overpayment (a tip) still settles — surface it, don't swallow it.
    const status = nextPaid >= Number(p.amount) ? 'paid' : 'partial';

    const { error } = await db
      .from('booking_payments')
      .update({ amount_paid: nextPaid, status, confirmed_at: new Date().toISOString() } as unknown as never)
      .eq('id', paymentId);
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });

    // Receipt to the client.
    const to = await clientEmailFor(b);
    if (to && process.env.RESEND_API_KEY) {
      const cur = p.currency || 'USD';
      const outstanding = round2(Math.max(0, Number(p.amount) - nextPaid));
      const content = status === 'paid'
        ? `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">Payment received — ${money(nextPaid, cur)}</h1>
<p style="margin:0;color:#333;font-size:15px;line-height:1.6;">Thanks! Your ${p.kind === 'balance' ? 'balance' : 'deposit'} is settled${b.event_date ? ` for ${b.event_date}` : ''}. A receipt is attached.</p>`
        : `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">Partial payment received</h1>
<p style="margin:0;color:#333;font-size:15px;line-height:1.6;">
${money(nextPaid, cur)} of ${money(Number(p.amount), cur)} received — <strong>${money(outstanding, cur)} still due</strong>. A receipt is attached.
</p>`;

      // A branded RECEIPT PDF for what actually arrived. Amounts here come from
      // the ledger (received now + paid-to-date), not the invoice. null-safe.
      const receiptAtt = await buildBookingDocAttachment(db, {
        docKind: 'receipt',
        bookingId: p.booking_id,
        djId: user.id,
        currency: cur,
        paymentKind: (KINDS.has(p.kind) ? p.kind : 'other') as 'deposit' | 'balance' | 'other',
        receivedNow: received,
        method: p.method,
        paidToDate: nextPaid,
        clientEmail: to,
      });

      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: FROM,
          to,
          subject: status === 'paid' ? `Payment received — ${money(nextPaid, cur)}` : `Partial payment received — ${money(outstanding, cur)} still due`,
          html: shell(content),
          attachments: receiptAtt ? [receiptAtt] : undefined,
        });
      } catch { /* non-fatal */ }
    }

    return NextResponse.json({ ok: true, amount_paid: nextPaid, status });
  }

  // ───────────────── send-receipt (DJ only) ─────────────────
  // A RECEIPT with no new payment behind it — the manual counterpart to the
  // auto-receipt that 'confirm' sends. When a DJ marks a deposit/balance
  // "complete" by hand (cash on the night, a bank transfer, money that never
  // touched the app), no receipt ever went out. This lets them send one.
  //
  // The amount is DERIVED, because a hand-marked stage records no figure:
  //   deposit → the booking's deposit amount
  //   balance → whatever's left after everything already paid (paid in full)
  if (action === 'send-receipt') {
    const bookingId = typeof body.bookingId === 'string' ? body.bookingId : '';
    const kind = typeof body.kind === 'string' && KINDS.has(body.kind) ? body.kind : 'balance';
    if (!bookingId) return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });

    const { data: bData } = await admin
      .from('bookings')
      .select('id, dj_id, requester_id, host_email, requester_name, event_date, venue_name, currency, deposit_amount, total_with_tax, counter_rate, quoted_rate, offer_amount')
      .eq('id', bookingId)
      .maybeSingle();
    const b = bData as BookingRow | null;
    if (!b) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
    if (b.dj_id !== user.id) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });

    const cur = b.currency || 'USD';
    const agreed = Number(b.total_with_tax ?? b.counter_rate ?? b.quoted_rate ?? b.offer_amount ?? 0);
    const { data: paidData } = await db
      .from('booking_payments')
      .select('amount_paid')
      .eq('booking_id', bookingId);
    const paidSoFar = ((paidData as { amount_paid?: number }[] | null) || [])
      .reduce((s, r) => s + Number(r.amount_paid || 0), 0);

    let received: number;
    let paidToDate: number;
    if (kind === 'deposit') {
      received = b.deposit_amount != null ? Number(b.deposit_amount) : round2(agreed);
      paidToDate = round2(paidSoFar > 0 ? paidSoFar : received);
    } else {
      received = round2(Math.max(0, agreed - paidSoFar));
      paidToDate = round2(agreed);
    }
    if (!(received > 0)) {
      return NextResponse.json({ error: 'Nothing to receipt on this booking.' }, { status: 400 });
    }

    const to = await clientEmailFor(b);
    if (!to) return NextResponse.json({ error: 'No client email on this booking.' }, { status: 400 });
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: 'Email is not configured.' }, { status: 500 });

    const receiptAtt = await buildBookingDocAttachment(db, {
      docKind: 'receipt',
      bookingId,
      djId: user.id,
      currency: cur,
      paymentKind: kind as 'deposit' | 'balance' | 'other',
      receivedNow: received,
      method: null,
      paidToDate,
      clientEmail: to,
    });

    const content = `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">Receipt — ${money(received, cur)}</h1>
<p style="margin:0;color:#333;font-size:15px;line-height:1.6;">Thanks! A receipt for your ${kind === 'deposit' ? 'deposit' : 'payment'} is attached${b.event_date ? ` for ${b.event_date}` : ''}.</p>`;
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: FROM,
        to,
        subject: `Receipt — ${money(received, cur)}`,
        html: shell(content),
        attachments: receiptAtt ? [receiptAtt] : undefined,
      });
    } catch {
      return NextResponse.json({ error: 'Could not send the receipt email.' }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
