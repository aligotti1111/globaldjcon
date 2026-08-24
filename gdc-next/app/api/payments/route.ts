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
import { getActingContext, canMoney, canRequestDeposit, canInvoice } from '@/lib/acting';
import { getStripe } from '@/lib/stripe/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { canUsePro, type AccessFields } from '@/lib/access';
import { bookingProgressBox } from '@/lib/bookingProgressBox';
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
  start_time: string | null;
  end_time: string | null;
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
  // Set once a Stripe Checkout session settles this row (card rail); null for
  // manual rails. Its presence is the idempotency guard for verify-checkout.
  stripe_session_id: string | null;
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

// "HH:MM" (24h stored) -> "7:30 PM". Blank/invalid returns ''.
function fmtTime(t?: string | null): string {
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

// Branded badge per rail — a brand-coloured rounded tile with the service's
// mark. Real image logos can't be used reliably in email (Gmail strips SVG and
// external images are often blocked), so these pure-HTML badges stand in and
// render identically everywhere.
const BADGE: Record<string, { bg: string; glyph: string; soft: string; border: string }> = {
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
function optionsHtml(methods: PaymentMethod[], amount: number, currency: string, reference: string, djName: string, paymentId: string, eventDate?: string | null, venueName?: string | null, isBalance = false): string {
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
      const steps = m.type === 'cashapp' ? `<div style="margin:12px 0 0;padding:12px 14px;background:#ffffff;border:1px solid #BDEFCC;border-radius:8px;"><p style="margin:0 0 6px;color:#111;font-size:12px;font-weight:700;">Cash App won't pre-fill this — here's how to pay:</p><ol style="margin:0;padding-left:18px;color:#444;font-size:12px;line-height:1.7;"><li>Tap <strong>Open Cash App</strong> above, or open Cash App and search <strong>${displayHandle(m)}</strong>.</li><li>Enter <strong>${money(amount, currency)}</strong> and tap Pay.</li><li>Add <strong>${reference}</strong> in the "For" note.</li><li>Confirm and send.</li></ol></div>` : '';
      const body = `${btn}${steps}`;
      return card(m.type, body, false);
    }

    if (m.type === 'cash') {
      const eventWhen = eventDate ? ` on ${eventDate}` : ' the day of your event';
      const cashNote = hasId
        ? `\n<p style="margin:8px 0 0;font-size:13px;"><a href="${SITE_URL}/pay/${paymentId}/check-sent?mode=at-event" style="color:#2E7D32;font-weight:700;text-decoration:underline;">Let your DJ know you'll pay at the event &rarr;</a></p>`
        : '';
      const body = isBalance
        ? `<p style="margin:10px 0 0;color:#666;font-size:13px;line-height:1.5;">Pay in cash at the event${eventWhen}. ${cashLine(m)}</p>${cashNote}`
        : `<p style="margin:10px 0 0;color:#666;font-size:13px;line-height:1.5;">${cashLine(m)}</p>`;
      return card('cash', body);
    }

    if (m.type === 'check') {
      const memo = checkMemo(eventDate, venueName, reference);
      const eventWhen = eventDate ? ` on ${eventDate}` : ' the day of your event';
      const body = isBalance
        ? `<p style="margin:10px 0 0;color:#666;font-size:12px;line-height:1.5;">Bring your check to the event${eventWhen}, made payable to:</p>
<p style="margin:2px 0 0;font-size:15px;color:#111;">${m.handle}</p>
${memo ? `<p style="margin:8px 0 0;color:#666;font-size:12px;">Include with your check:</p>
<p style="margin:1px 0 0;font-family:monospace;font-size:14px;color:#111;">${memo}</p>` : ''}${hasId ? `\n<p style="margin:8px 0 0;font-size:13px;"><a href="${SITE_URL}/pay/${paymentId}/check-sent?mode=at-event" style="color:#455A64;font-weight:700;text-decoration:underline;">Let your DJ know you'll pay at the event &rarr;</a></p>` : ''}`
        : `<p style="margin:10px 0 0;color:#666;font-size:12px;">Make it payable to:</p>
<p style="margin:1px 0 0;font-size:15px;color:#111;">${m.handle}</p>
${m.contact ? `<p style="margin:7px 0 0;color:#666;font-size:12px;">Mail to:</p>
<p style="margin:1px 0 0;font-size:14px;color:#111;white-space:pre-line;">${m.contact}</p>` : ''}
${memo ? `<p style="margin:8px 0 0;color:#666;font-size:12px;">Include with your check:</p>
<p style="margin:1px 0 0;font-family:monospace;font-size:14px;color:#111;">${memo}</p>` : ''}${hasId ? `\n<p style="margin:8px 0 0;font-size:13px;"><a href="${SITE_URL}/pay/${paymentId}/check-sent" style="color:#455A64;font-weight:700;text-decoration:underline;">Mailed it? Let your DJ know your check is on the way &rarr;</a></p>` : ''}`;
      return card('check', body);
    }

    const body = `<p style="margin:10px 0 0;color:#666;font-size:12px;line-height:1.5;">${copyInstruction(m)}</p>
<p style="margin:2px 0 0;font-family:monospace;font-size:15px;color:#111;word-break:break-all;">${displayHandle(m)}</p>
${m.type === 'zelle' ? `<p style="margin:7px 0 0;color:#9a9a9a;font-size:11px;">Double-check before sending — Zelle payments can't be reversed.</p>` : ''}`;
    return card(m.type, body);
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
  const acting = await getActingContext(user.id);

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
      .select('id, dj_id, requester_id, host_email, requester_name, event_date, start_time, end_time, venue_name, currency, deposit_amount, total_with_tax, counter_rate, quoted_rate, offer_amount')
      .eq('id', bookingId)
      .maybeSingle();
    const b = bData as BookingRow | null;
    if (!b) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
    if (b.dj_id !== acting.djId) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
    // Requesting a payment (deposit OR balance) is a money action — manager+.
    // Assistants can only RESEND the invoice/receipt (the send-receipt action).
    if (!canRequestDeposit(acting.role)) {
      return NextResponse.json({ error: 'Your role cannot request payments.' }, { status: 403 });
    }

    // Tier gate, server-side. Deposits/invoices are Pro. Hiding the button in
    // the UI is not a paywall — anyone can POST here directly.
    // NOTE: lib/access says existing bookings should use bookingAllows(tier_stamp),
    // but tier_stamp is never written anywhere yet, so it would deny everyone.
    // Current standing is the only honest signal available today.
    const { data: djData } = await admin
      .from('users')
      .select('sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, comp_source, name, payment_methods')
      .eq('id', acting.djId)
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

    // The balance is the WHOLE remaining amount. An unpaid deposit request is
    // NOT netted out — requesting the balance overrides it (see the auto-skip
    // below). Only money that actually arrived (alreadyPaid) reduces it.
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

    // Requesting the BALANCE auto-skips the deposit stage — the DJ has chosen
    // to collect in one payment. Only when no deposit was actually collected
    // (a real/settled deposit outranks a skip). Durable here so it holds no
    // matter where the balance request came from.
    if (kind === 'balance') {
      try {
        const { data: depRowsData } = await db
          .from('booking_payments')
          .select('amount_paid, status')
          .eq('booking_id', bookingId)
          .eq('kind', 'deposit');
        const depRows = (depRowsData as { amount_paid?: number; status?: string }[] | null) || [];
        // Billing the whole balance overrides the deposit — skip it whenever
        // nothing was actually collected, even if a request went out unpaid.
        // (A paid or part-paid deposit is left alone; the balance nets it out.)
        const depSettled = depRows.some((r) => r.status === 'paid' || r.status === 'waived')
          || depRows.reduce((sum, r) => sum + Number(r.amount_paid || 0), 0) > 0;
        if (!depSettled) {
          const { data: bkRow } = await admin.from('bookings').select('status_overrides').eq('id', bookingId).maybeSingle();
          const curOv = ((bkRow as { status_overrides?: Record<string, boolean> } | null)?.status_overrides) || {};
          if (!curOv.deposit_skipped) {
            await admin.from('bookings')
              .update({ status_overrides: { ...curOv, deposit_skipped: true } } as unknown as never)
              .eq('id', bookingId);
          }
        }
      } catch { /* non-fatal — the balance request itself already succeeded */ }
    }

    // Email the client.
    const to = await clientEmailFor(b);
    if (to && process.env.RESEND_API_KEY) {
      const djName = dj.name || 'your DJ';
      const reference = referenceCode(bookingId, kind);
      const noun = kind === 'balance' ? 'balance' : 'deposit';
      const when = b.event_date
        ? new Date(`${b.event_date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        : 'your event';
      const cur = b.currency || 'USD';
      // Short date + venue for the subject line the client sees in their inbox.
      const shortDate = b.event_date
        ? new Date(`${b.event_date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'your event';
      const venuePart = b.venue_name ? ` | ${b.venue_name}` : '';
      const subjectLine = noun === 'balance'
        ? `Balance Request ${shortDate}${venuePart}`
        : `Deposit Request for ${shortDate}${venuePart}`;
      // Small context line: a deposit email shows what's left after; a balance
      // email shows what was already put down.
      const totalDue = agreed != null ? round2(Number(agreed)) : null;
      const remainingAfter = totalDue != null ? Math.max(0, round2(totalDue - amount - alreadyPaid)) : null;
      const summary = noun === 'deposit'
        ? (remainingAfter != null ? `Remaining balance after this deposit: <strong style="color:#111;">${money(remainingAfter, cur)}</strong>` : '')
        : (alreadyPaid > 0 ? `Deposit already paid: <strong style="color:#111;">${money(alreadyPaid, cur)}</strong>` : '');
      const timeRange = [fmtTime(b.start_time), fmtTime(b.end_time)].filter(Boolean).join(' – ');
      const detailRow = (label: string, value: string) =>
        `<tr><td style="padding:5px 0;color:#8a8a8a;font-size:11px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;width:74px;vertical-align:top;">${label}</td><td style="padding:5px 0;color:#111;font-size:14px;">${value}</td></tr>`;
      const recap = `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="min-width:100%;background:#fafafa;border:1px solid #ededed;border-radius:10px;margin:0 0 22px;">
<tr><td style="padding:14px 18px;">
<div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#0a8f74;font-weight:700;margin:0 0 8px;">Event details</div>
<table width="100%" cellpadding="0" cellspacing="0" border="0">
${detailRow('DJ', djName)}
${detailRow('Date', when)}
${timeRange ? detailRow('Time', timeRange) : ''}
${b.venue_name ? detailRow('Venue', b.venue_name) : ''}
</table>
</td></tr></table>`;

      const content = `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="min-width:100%;margin:0 0 20px;border:1px solid #b8f5e4;border-radius:14px;background:#effcf7;">
<tr><td style="padding:22px 24px;" align="center">
<div style="text-align:center;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#0a8f74;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">${noun === 'balance' ? 'Balance Due' : 'Deposit Required'}</div>
<div style="text-align:center;font-size:34px;line-height:1.15;font-weight:800;color:#0b1f1a;margin:8px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;letter-spacing:-.01em;">${money(amount, cur)}</div>
${summary ? `<div style="text-align:center;margin:10px 0 0;color:#4a6b62;font-size:13px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">${summary}</div>` : ''}
</td></tr></table>
${recap}
<p style="margin:0 0 18px;color:#333;font-size:15px;line-height:1.6;">
Please choose a payment option below to complete the ${noun} required to reserve your date.
</p>
${optionsHtml(methods, amount, cur, reference, djName, payment.id, b.event_date, b.venue_name, noun === 'balance')}
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
        djId: acting.djId,
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
          subject: subjectLine,
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
      .select('id, dj_id, requester_id, host_email, requester_name, event_date, start_time, end_time, venue_name, currency, deposit_amount, total_with_tax, counter_rate, quoted_rate, offer_amount')
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
      .select('id, dj_id, requester_id, host_email, requester_name, event_date, start_time, end_time, venue_name, currency, deposit_amount, total_with_tax, counter_rate, quoted_rate, offer_amount')
      .eq('id', p.booking_id)
      .maybeSingle();
    const b = bData as BookingRow | null;
    if (!b) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
    if (b.dj_id !== acting.djId) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
    if (!canMoney(acting.role)) return NextResponse.json({ error: 'Your role cannot take payments.' }, { status: 403 });

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
        djId: acting.djId,
        currency: cur,
        paymentKind: (KINDS.has(p.kind) ? p.kind : 'other') as 'deposit' | 'balance' | 'other',
        receivedNow: received,
        method: p.method,
        paidToDate: nextPaid,
        clientEmail: to,
      });

      // Booking progress tracker at the bottom of the confirmation. The ledger
      // update above has already committed, so the box reflects this payment —
      // the deposit (or balance) now shows Paid ✓ with the next step flagged.
      // Same shared box the contract email uses; '' for club bookings.
      const progressBox = await bookingProgressBox(p.booking_id);

      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: FROM,
          to,
          subject: status === 'paid' ? `Payment received — ${money(nextPaid, cur)}` : `Partial payment received — ${money(outstanding, cur)} still due`,
          html: shell(content + (progressBox ? `<div style="margin-top:24px;">${progressBox}</div>` : '')),
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
      .select('id, dj_id, requester_id, host_email, requester_name, event_date, start_time, end_time, venue_name, currency, deposit_amount, total_with_tax, counter_rate, quoted_rate, offer_amount')
      .eq('id', bookingId)
      .maybeSingle();
    const b = bData as BookingRow | null;
    if (!b) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
    if (b.dj_id !== acting.djId) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
    if (!canInvoice(acting.role)) return NextResponse.json({ error: 'Your role cannot send invoices.' }, { status: 403 });

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
      djId: acting.djId,
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

  // ───────────────── download-receipt (DJ only) ─────────────────
  // Same receipt PDF as send-receipt, but returned for download instead of
  // emailed — so the DJ can keep a copy or hand it over themselves. No client
  // email required (nothing is sent).
  if (action === 'download-receipt') {
    const bookingId = typeof body.bookingId === 'string' ? body.bookingId : '';
    const kind = typeof body.kind === 'string' && KINDS.has(body.kind) ? body.kind : 'balance';
    if (!bookingId) return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });

    const { data: bData } = await admin
      .from('bookings')
      .select('id, dj_id, requester_id, host_email, requester_name, event_date, start_time, end_time, venue_name, currency, deposit_amount, total_with_tax, counter_rate, quoted_rate, offer_amount')
      .eq('id', bookingId)
      .maybeSingle();
    const b = bData as BookingRow | null;
    if (!b) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
    if (b.dj_id !== acting.djId) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
    if (!canInvoice(acting.role)) return NextResponse.json({ error: 'Your role cannot send invoices.' }, { status: 403 });

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

    const receiptAtt = await buildBookingDocAttachment(db, {
      docKind: 'receipt',
      bookingId,
      djId: acting.djId,
      currency: cur,
      paymentKind: kind as 'deposit' | 'balance' | 'other',
      receivedNow: received,
      method: null,
      paidToDate,
      clientEmail: await clientEmailFor(b),
    });
    if (!receiptAtt) return NextResponse.json({ error: 'Could not build the receipt.' }, { status: 500 });

    const pdf = Buffer.from(receiptAtt.content, 'base64');
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${receiptAtt.filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // ───────────────── overtime (mobile DJ only) ─────────────────
  // Last-minute extra hours added on the day. Stored on the booking's OWN
  // columns, independent of the deposit/balance ledger, so it can never move the
  // event balance. Two terminal actions: send an OVERTIME invoice (the extra
  // hours billed alone — what's owed right now), or mark it paid and send a
  // combined RECEIPT (event total + overtime, one grand total). Plus a download
  // of that receipt, and a clear. Mobile bookings only.
  if (
    action === 'overtime-invoice' ||
    action === 'overtime-receipt' ||
    action === 'overtime-download-receipt' ||
    action === 'overtime-clear'
  ) {
    const bookingId = typeof body.bookingId === 'string' ? body.bookingId : '';
    if (!bookingId) return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });

    const { data: bData } = await admin
      .from('bookings')
      .select('id, dj_id, booking_type, requester_id, host_email, requester_name, event_date, venue_name, currency, overtime_invoiced_at')
      .eq('id', bookingId)
      .maybeSingle();
    const b = bData as (BookingRow & { booking_type: string | null; overtime_invoiced_at: string | null }) | null;
    if (!b) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
    if (b.dj_id !== acting.djId) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
    if (!canInvoice(acting.role)) return NextResponse.json({ error: 'Your role cannot send invoices.' }, { status: 403 });
    if ((b.booking_type || '') === 'club') return NextResponse.json({ error: 'Overtime applies to mobile bookings only.' }, { status: 400 });

    const cur = b.currency || 'USD';

    // Remove the overtime entirely — back to no overtime on the booking.
    if (action === 'overtime-clear') {
      await admin.from('bookings').update({
        overtime_hours: null, overtime_charge_rate: null, overtime_tax: null,
        overtime_amount: null, overtime_invoiced_at: null, overtime_paid_at: null,
        // Only a cancellation worth logging if an invoice had actually gone
        // out. Clearing an un-invoiced draft is just tidying up — nothing to log.
        overtime_cancelled_at: b.overtime_invoiced_at ? new Date().toISOString() : null,
      } as unknown as never).eq('id', bookingId);
      return NextResponse.json({ ok: true });
    }

    // Overtime numbers come from the DJ (their hours, their rate). Validated as
    // sane positives; tax is whatever the DJ set (0 when removed).
    const hours = round2(Number(body.hours));
    const rate = round2(Number(body.rate));
    if (!(hours > 0) || !(rate > 0)) {
      return NextResponse.json({ error: 'Enter hours and a rate greater than zero.' }, { status: 400 });
    }
    const sub = round2(hours * rate);
    const tax = round2(Math.max(0, Number(body.tax || 0)));
    const amount = round2(sub + tax);
    const overtime = { hours, rate, tax, amount };

    // Download: build the combined receipt PDF and return it — no email, no
    // persistence (it's a copy of what's already there).
    if (action === 'overtime-download-receipt') {
      const att = await buildBookingDocAttachment(db, {
        docKind: 'receipt', bookingId, djId: acting.djId, currency: cur,
        paymentKind: 'other', clientEmail: await clientEmailFor(b), overtime,
      });
      if (!att) return NextResponse.json({ error: 'Could not build the receipt.' }, { status: 500 });
      const pdf = Buffer.from(att.content, 'base64');
      return new NextResponse(pdf, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${att.filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    // Persist onto the booking so it survives reload and drives the card.
    const nowIso = new Date().toISOString();
    const isInv = action === 'overtime-invoice';
    const patch: Record<string, unknown> = {
      overtime_hours: hours, overtime_charge_rate: rate, overtime_tax: tax, overtime_amount: amount,
    };
    if (isInv) patch.overtime_invoiced_at = nowIso;
    else patch.overtime_paid_at = nowIso;
    await admin.from('bookings').update(patch as unknown as never).eq('id', bookingId);

    const to = await clientEmailFor(b);
    if (!to) return NextResponse.json({ error: 'No client email on this booking.' }, { status: 400 });
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: 'Email is not configured.' }, { status: 500 });

    const att = await buildBookingDocAttachment(db, {
      docKind: isInv ? 'invoice' : 'receipt', bookingId, djId: acting.djId, currency: cur,
      paymentKind: 'other', clientEmail: to, overtime,
    });

    const hrLabel = `${hours} hr${hours === 1 ? '' : 's'}`;
    // Overtime invoice carries the DJ's payment options (pay links + handles),
    // just like a balance invoice — so the host can pay it directly, not only
    // "on the night."
    let optionsBlock = '';
    if (isInv) {
      const { data: djData } = await admin
        .from('users')
        .select('name, payment_methods')
        .eq('id', acting.djId)
        .maybeSingle();
      const djRow = djData as { name?: string | null; payment_methods?: unknown } | null;
      const methods = usableMethods((Array.isArray(djRow?.payment_methods) ? djRow.payment_methods : []) as PaymentMethod[]);
      const reference = referenceCode(bookingId, 'overtime');
      // Same layout as the deposit/balance invoice emails — the shared
      // optionsHtml, with an empty paymentId (overtime has no ledger row) so it
      // links Venmo directly and drops the "let your DJ know" tracking links.
      const cards = optionsHtml(methods, amount, cur, reference, djRow?.name || 'Your DJ', '', b.event_date, b.venue_name, true);
      optionsBlock = cards
        ? `${cards}
<div style="background:#f8f8f8;border-radius:6px;padding:12px 14px;margin:16px 0 0;"><p style="margin:0;color:#666;font-size:12px;">Reference — please include in the payment note:</p><p style="margin:3px 0 0;font-family:monospace;font-size:16px;color:#111;font-weight:700;">${reference}</p></div>`
        : '';
    }
    const content = isInv
      ? `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">Overtime — ${money(amount, cur)}</h1>
<p style="margin:0 0 18px;color:#333;font-size:15px;line-height:1.6;">An invoice for ${hrLabel} of overtime${b.event_date ? ` on ${b.event_date}` : ''} is attached. Pay it below, or on the night by any method your DJ accepts.</p>
${optionsBlock}`
      : `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">Receipt — paid in full</h1>
<p style="margin:0;color:#333;font-size:15px;line-height:1.6;">Thanks! Your receipt including ${hrLabel} of overtime${b.event_date ? ` on ${b.event_date}` : ''} is attached.</p>`;

    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: FROM,
        to,
        subject: isInv ? `Overtime Invoice — ${money(amount, cur)}` : 'Receipt — paid in full',
        html: shell(content),
        attachments: att ? [att] : undefined,
      });
    } catch {
      return NextResponse.json({ error: isInv ? 'Could not send the invoice email.' : 'Could not send the receipt email.' }, { status: 502 });
    }

    return NextResponse.json({ ok: true, overtime });
  }

  // ───────────────── cancel-request (DJ only) ─────────────────
  // Withdraw a deposit/balance request that was never paid. Deletes the row so
  // the column returns to "Not sent" and the DJ can request again cleanly.
  //
  // HARD GATE: refuses the moment any money is attached (amount_paid > 0, or a
  // paid/waived status). You can't un-request money that arrived — that would
  // erase a real payment from the ledger. Only an untouched ask can be pulled.
  if (action === 'cancel-request') {
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
      .select('id, dj_id')
      .eq('id', p.booking_id)
      .maybeSingle();
    const b = bData as { id: string; dj_id: string | null } | null;
    if (!b) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
    if (b.dj_id !== acting.djId) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
    if (!canMoney(acting.role)) return NextResponse.json({ error: 'Your role cannot take payments.' }, { status: 403 });

    if (Number(p.amount_paid || 0) > 0 || p.status === 'paid' || p.status === 'waived') {
      return NextResponse.json({ error: 'This request already has a payment and can’t be cancelled.' }, { status: 400 });
    }

    const { error } = await db
      .from('booking_payments')
      .delete()
      .eq('id', paymentId);
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });

    return NextResponse.json({ ok: true });
  }

  // ───────────────── checkout / verify-checkout (host) ─────────────────
  // The card rail. DIRECT charge on the DJ's Standard connected account:
  // the DJ is merchant of record, pays Stripe's fee, owns disputes. NO
  // application_fee — the platform's zero-cut rule survives the processor.
  //
  // Verification happens on the RETURN redirect, not a webhook: Stripe sends
  // the host back with ?session_id={CHECKOUT_SESSION_ID}, we retrieve the
  // session server-side and settle. If the host closes the tab first, nothing
  // is recorded — and the DJ's manual "Confirm received" still works, so the
  // failure mode of the missing webhook is a stale strip, never lost money.
  if (action === 'checkout' || action === 'verify-checkout') {
    const paymentId = typeof body.paymentId === 'string' ? body.paymentId : '';
    if (!paymentId) return NextResponse.json({ error: 'Missing paymentId' }, { status: 400 });

    const { data: pData } = await db
      .from('booking_payments')
      .select('id, booking_id, kind, amount, amount_paid, currency, status, method, due_date, stripe_session_id')
      .eq('id', paymentId)
      .maybeSingle();
    const p = pData as PaymentRow | null;
    if (!p) return NextResponse.json({ error: 'Payment not found.' }, { status: 404 });

    const { data: bData } = await admin
      .from('bookings')
      .select('id, dj_id, requester_id, host_email, requester_name, event_date, start_time, end_time, venue_name, currency, deposit_amount, total_with_tax, counter_rate, quoted_rate, offer_amount')
      .eq('id', p.booking_id)
      .maybeSingle();
    const b = bData as BookingRow | null;
    if (!b) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
    // Host-only, both actions: it's their card and their return redirect.
    if (b.requester_id !== user.id) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });

    // The DJ's connected account. Columns are newer than the generated
    // types, so the result is cast — same pattern as stripe_customer_id.
    const { data: djData } = b.dj_id
      ? await admin
          .from('users')
          .select('stripe_connect_id, stripe_connect_ready, name')
          .eq('id', b.dj_id)
          .maybeSingle()
      : { data: null };
    const dj = djData as unknown as {
      stripe_connect_id: string | null;
      stripe_connect_ready: boolean | null;
      name: string | null;
    } | null;
    const djName = dj?.name || 'the DJ';

    // ────────────────────────────── checkout ──────────────────────────────
    if (action === 'checkout') {
      if (p.status === 'paid' || p.status === 'waived') {
        return NextResponse.json({ error: 'This payment is already settled.' }, { status: 400 });
      }
      if (p.stripe_session_id) {
        // One card payment per row — a second would stack onto amount_paid.
        return NextResponse.json({ error: 'A card payment was already recorded for this request.' }, { status: 409 });
      }
      // Not ready = onboarding unfinished = the account CANNOT take charges.
      // A card button that fails at the till is worse than no button.
      if (!dj?.stripe_connect_id || !dj.stripe_connect_ready) {
        return NextResponse.json({ error: `${djName} isn't set up for card payments.` }, { status: 400 });
      }

      // OUTSTANDING, recomputed here. NEVER from the body — a client-supplied
      // amount is exactly the thing this route exists to not trust.
      const outstanding = round2(Math.max(0, Number(p.amount) - Number(p.amount_paid || 0)));
      if (!(outstanding > 0)) {
        return NextResponse.json({ error: 'Nothing left to pay on this request.' }, { status: 400 });
      }
      if (outstanding < 0.5) {
        // Stripe's minimum charge is $0.50 (USD).
        return NextResponse.json({ error: 'The remaining amount is below the card minimum. Settle it with the DJ directly.' }, { status: 400 });
      }

      const reference = referenceCode(p.booking_id, p.kind);
      const noun = p.kind === 'balance' ? 'Balance' : p.kind === 'deposit' ? 'Deposit' : 'Payment';
      const origin = req.headers.get('origin') || SITE_URL;

      try {
        const stripe = getStripe();
        const session = await stripe.checkout.sessions.create(
          {
            mode: 'payment',
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: (p.currency || 'USD').toLowerCase(),
                  // DB stores DOLLARS; Stripe wants integer CENTS. Math.round,
                  // not a cast — 599.99 * 100 is 59998.999… in floats.
                  unit_amount: Math.round(outstanding * 100),
                  product_data: {
                    name: `${noun} — ${djName}${b.event_date ? ` · ${b.event_date}` : ''}`,
                    description: `Ref ${reference}${b.venue_name ? ` · ${b.venue_name}` : ''}`,
                  },
                },
              },
            ],
            // The verify leg matches on this — it's what stops a session from
            // one payment being replayed against another.
            metadata: { payment_id: p.id, booking_id: p.booking_id, reference },
            // Mirrored onto the PaymentIntent so the DJ sees the reference in
            // THEIR Stripe dashboard, next to the charge.
            payment_intent_data: {
              metadata: { payment_id: p.id, booking_id: p.booking_id, reference },
            },
            customer_email: (await clientEmailFor(b)) || undefined,
            // {CHECKOUT_SESSION_ID} is a literal — Stripe substitutes it on
            // redirect. BookingRequestsClient picks both params up on mount.
            success_url: `${origin}/booking-requests?paid=${p.id}&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${origin}/booking-requests`,
          },
          // DIRECT charge: the session lives ON the DJ's account.
          { stripeAccount: dj.stripe_connect_id },
        );
        return NextResponse.json({ url: session.url });
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : 'Could not start card checkout.' },
          { status: 500 },
        );
      }
    }

    // ─────────────────────────── verify-checkout ──────────────────────────
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    if (!sessionId || !sessionId.startsWith('cs_')) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    // IDEMPOTENCY, part 1: the host lands on the return URL twice (refresh,
    // back button) and this re-posts. amount_paid ACCUMULATES, so a double
    // apply would silently inflate what the DJ thinks they received. Same
    // session already recorded → report current state, change NOTHING.
    if (p.stripe_session_id === sessionId) {
      return NextResponse.json({ ok: true, applied: false, amount_paid: p.amount_paid, status: p.status });
    }
    if (p.stripe_session_id) {
      // A DIFFERENT session already settled this row — never stack a second.
      return NextResponse.json({ error: 'A card payment was already recorded for this request.' }, { status: 409 });
    }
    if (!dj?.stripe_connect_id) {
      return NextResponse.json({ error: `${djName} has no connected Stripe account.` }, { status: 409 });
    }

    let session;
    try {
      const stripe = getStripe();
      // Retrieved ON the connected account — that's where the session lives.
      session = await stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount: dj.stripe_connect_id });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Could not verify the card payment.' },
        { status: 500 },
      );
    }

    // The session must be OURS, for THIS payment. Without this check any paid
    // session on the same connected account could be replayed here and
    // credited to a different payment row.
    if (session.metadata?.payment_id !== p.id) {
      return NextResponse.json({ error: 'That checkout session does not belong to this payment.' }, { status: 400 });
    }
    if (session.payment_status !== 'paid') {
      // Cards settle synchronously, so in practice this is an abandoned or
      // still-open session. Record nothing; the row stays as it was.
      return NextResponse.json({ ok: true, applied: false, amount_paid: p.amount_paid, status: p.status });
    }

    // CENTS → dollars. amount_total is what the card was actually charged.
    const received = round2((session.amount_total ?? 0) / 100);
    if (!(received > 0)) {
      return NextResponse.json({ error: 'Stripe reported a paid session with no amount.' }, { status: 500 });
    }
    const nextPaid = round2(Number(p.amount_paid || 0) + received);
    const status = nextPaid >= Number(p.amount) ? 'paid' : 'partial';

    // IDEMPOTENCY, part 2: `.is('stripe_session_id', null)` makes concurrent
    // verifies (double-click, two tabs) race safely — exactly one UPDATE
    // matches; the loser applies nothing and reports the winner's state. The
    // partial unique index on stripe_session_id backstops it across rows.
    const { data: updRows, error: upErr } = await db
      .from('booking_payments')
      .update({
        amount_paid: nextPaid,
        status,
        method: 'card',
        client_intent: 'pay_now',
        stripe_session_id: sessionId,
        confirmed_at: new Date().toISOString(),
      } as unknown as never)
      .eq('id', paymentId)
      .is('stripe_session_id', null)
      .select('id');
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    if (!updRows || (updRows as unknown[]).length === 0) {
      const { data: curData } = await db
        .from('booking_payments')
        .select('amount_paid, status')
        .eq('id', paymentId)
        .maybeSingle();
      const cur = curData as { amount_paid: number; status: string } | null;
      return NextResponse.json({
        ok: true,
        applied: false,
        amount_paid: cur?.amount_paid ?? p.amount_paid,
        status: cur?.status ?? p.status,
      });
    }

    // Tell the DJ. Cards auto-confirm, so unlike the manual rails there is no
    // "confirm received" moment where they'd naturally find out.
    if (b.dj_id && process.env.RESEND_API_KEY) {
      const djEmail = await resolveUserEmail(b.dj_id);
      if (djEmail) {
        const cur = p.currency || 'USD';
        const who = b.requester_name || 'Your client';
        const outstandingLeft = round2(Math.max(0, Number(p.amount) - nextPaid));
        const content = `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">${who} paid ${money(received, cur)} by card</h1>
<p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.6;">
Paid through your Stripe account${b.event_date ? ` for ${b.event_date}` : ''}${b.venue_name ? ` · ${b.venue_name}` : ''} — already confirmed, nothing to do.
${status === 'paid' ? 'This request is now fully settled.' : `<strong>${money(outstandingLeft, cur)} still due</strong> on this request.`}
Stripe's fee (2.9% + 30¢) comes out before payout; your first payout can take 7–14 days.
</p>
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td style="background:#0a6f61;border-radius:6px;">
<a href="${SITE_URL}/upcoming-bookings" style="display:inline-block;padding:12px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">View booking</a>
</td></tr></table>`;
        try {
          const resend = new Resend(process.env.RESEND_API_KEY);
          await resend.emails.send({
            from: FROM,
            to: djEmail,
            subject: `${who} paid ${money(received, cur)} by card`,
            html: shell(content),
          });
        } catch { /* non-fatal — the ledger is already settled */ }
      }
    }

    return NextResponse.json({ ok: true, applied: true, amount_paid: nextPaid, status });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
