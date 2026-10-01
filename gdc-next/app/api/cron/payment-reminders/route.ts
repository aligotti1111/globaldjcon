// GET /api/cron/payment-reminders
//
// The unpaid-payment nudge to the HOST. Each DJ can turn on two reminders
// (Booking Settings → Payments → Payment Reminder):
//   users.payment_reminder_deposit_days — N days AFTER the deposit request was
//                                         sent, if the deposit still isn't paid.
//   users.payment_reminder_balance_days — same, for the balance request.
// NULL = off for that kind. If a kind is on, the host can get up to two nudges
// for that request, each sent once:
//   1. days-after-sent lands on today  → stamps payment_reminder_sent_at
//   2. the event is PRE_EVENT_DAYS away → stamps payment_reminder_pre_sent_at
// Either only fires while the payment is still unpaid, and the host can stop all
// reminders for a single request via the email link (payment_reminders_stopped).
//
// Trigger: netlify/functions/payment-reminders.mjs pings this once an HOUR. The
// route self-gates to the 9 AM Eastern hour (DST-aware) so a request gets at
// most one send per day. ?force=1 bypasses the time gate (still needs the
// secret); ?dry=1 computes + reports without sending.
//
// No double-sends: the matching stamp column is set on send, and a stamped row
// is never picked up again for that nudge.
//
// Auth: requires CRON_SECRET, as Authorization: Bearer <secret> or ?key=<secret>.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import { canUsePro, type AccessFields } from '@/lib/access';
import { Resend } from 'resend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const SITE_URL = 'https://globaldjconnect.com';

function shell(content: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background:#000;padding:24px 32px;" align="center"><div style="font-family:Impact,Arial,sans-serif;font-size:28px;letter-spacing:.06em;color:#00f5c4;font-weight:700;">GLOBAL DJ CONNECT</div></td></tr>
<tr><td style="padding:32px;">${content}</td></tr>
<tr><td style="background:#f8f8f8;padding:20px 32px;text-align:center;border-top:1px solid #e0e0e0;"><p style="margin:0;color:#888;font-size:11px;">© ${new Date().getFullYear()} Global DJ Connect · globaldjconnect.com</p></td></tr>
</table></td></tr></table>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

const CUR: Record<string, string> = { USD: '$', CAD: '$', AUD: '$', GBP: '£', EUR: '€' };
function money(amount: number, currency: string | null): string {
  const code = (currency || 'USD').toUpperCase();
  const sym = CUR[code];
  const n = Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return sym ? `${sym}${n}` : `${code} ${n}`;
}

// Hour (0–23) and today's YYYY-MM-DD in US Eastern, DST-aware.
function easternParts(now: Date): { hour: number; ymd: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => fmt.find((p) => p.type === t)?.value || '';
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;
  return { hour, ymd: `${get('year')}-${get('month')}-${get('day')}` };
}

// Whole days from `fromYmd` up to `todayYmd` (both YYYY-MM-DD), by UTC midnight.
function daysSince(fromYmd: string, todayYmd: string): number {
  const a = Date.parse(`${todayYmd}T00:00:00Z`);
  const b = Date.parse(`${fromYmd.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((a - b) / 86400000);
}

// Whole days from `todayYmd` up to `eventYmd` (both YYYY-MM-DD).
function daysUntil(eventYmd: string, todayYmd: string): number {
  return -daysSince(eventYmd, todayYmd);
}

// How many days before the event the "last call" reminder fires.
const PRE_EVENT_DAYS = 3;

interface DjRow extends AccessFields {
  id: string;
  name: string | null;
  payment_reminder_deposit_days: number | null;
  payment_reminder_balance_days: number | null;
}

interface BookingRow {
  id: string;
  event_date: string | null;
  venue_name: string | null;
  requester_name: string | null;
  host_email: string | null;
  requester_id: string | null;
}

interface PaymentRow {
  id: string;
  booking_id: string;
  kind: string | null;
  status: string | null;
  amount: number | null;
  currency: string | null;
  confirmed_at: string | null;
  requested_at: string | null;
  payment_reminder_sent_at: string | null;
  payment_reminder_pre_sent_at: string | null;
  payment_reminders_stopped: boolean | null;
}

const PAID = new Set(['paid', 'waived', 'refunded']);

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });

  const url = new URL(req.url);
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null;
  const provided = bearer || url.searchParams.get('key');
  if (provided !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const force = url.searchParams.get('force') === '1';
  const dry = url.searchParams.get('dry') === '1';
  const { hour, ymd: today } = easternParts(new Date());
  if (!force && hour !== 9) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'not 9am ET', etHour: hour });
  }

  const admin = createAdminClient();
  const db = admin as unknown as SupabaseClient;

  // DJs with at least one reminder set. Pro feature — a lapsed DJ sends nothing.
  const { data: djRows, error: djErr } = await db
    .from('users')
    .select('id, role, sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, comp_source, name, payment_reminder_deposit_days, payment_reminder_balance_days')
    .eq('role', 'dj')
    .or('payment_reminder_deposit_days.not.is.null,payment_reminder_balance_days.not.is.null')
    .limit(5000);
  if (djErr) return NextResponse.json({ error: djErr.message }, { status: 502 });

  const djs = ((djRows || []) as unknown as DjRow[]).filter((u) => canUsePro(u as AccessFields));
  if (djs.length === 0) return NextResponse.json({ ok: true, djs: 0, emails: 0 });

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey && !dry) return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
  const resend = resendKey ? new Resend(resendKey) : null;

  let emails = 0;
  let scanned = 0;

  for (const dj of djs) {
    const dayFor = (kind: string | null): number | null =>
      kind === 'deposit' ? dj.payment_reminder_deposit_days
        : kind === 'balance' ? dj.payment_reminder_balance_days
        : null;

    // This DJ's bookings (for host contact), then their payment requests.
    const { data: bRows } = await db
      .from('bookings')
      .select('id, event_date, venue_name, requester_name, host_email, requester_id')
      .eq('dj_id', dj.id)
      .is('deleted_at', null)
      .limit(3000);
    const bookings = new Map<string, BookingRow>();
    for (const b of (bRows || []) as unknown as BookingRow[]) bookings.set(b.id, b);
    if (bookings.size === 0) continue;

    const ids = Array.from(bookings.keys());
    let payments: PaymentRow[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data: pRows } = await db
        .from('booking_payments')
        .select('id, booking_id, kind, status, amount, currency, confirmed_at, requested_at, payment_reminder_sent_at, payment_reminder_pre_sent_at, payment_reminders_stopped')
        .in('booking_id', chunk);
      payments = payments.concat((pRows || []) as unknown as PaymentRow[]);
    }
    scanned += 1;

    const djName = dj.name?.trim() || 'Your DJ';

    for (const p of payments) {
      const day = dayFor(p.kind);
      if (!day) continue;                                                        // reminders off for this kind
      if (p.payment_reminders_stopped) continue;                                 // host asked us to stop
      if (p.confirmed_at || PAID.has((p.status || '').toLowerCase())) continue;  // already paid
      const b = bookings.get(p.booking_id);
      if (!b) continue;

      // Which reminder, if any, is due today — and the column we stamp so it only
      // fires once. The "N days after the request" nudge and the fixed "3 days
      // before the event" last call are independent.
      let stampField: 'payment_reminder_sent_at' | 'payment_reminder_pre_sent_at' | null = null;
      if (!p.payment_reminder_sent_at && p.requested_at && daysSince(p.requested_at, today) === day) {
        stampField = 'payment_reminder_sent_at';
      } else if (!p.payment_reminder_pre_sent_at && b.event_date && daysUntil(b.event_date, today) === PRE_EVENT_DAYS) {
        stampField = 'payment_reminder_pre_sent_at';
      }
      if (!stampField) continue;

      const to = b.host_email?.trim() || (b.requester_id ? await resolveUserEmail(b.requester_id) : null);
      if (!to) continue;

      const kindLabel = p.kind === 'deposit' ? 'deposit' : 'balance';
      const lastCall = stampField === 'payment_reminder_pre_sent_at';
      const hi = b.requester_name?.trim() ? esc(b.requester_name.trim().split(' ')[0]) : 'there';
      const amt = typeof p.amount === 'number' ? money(p.amount, p.currency) : '';
      const link = `${SITE_URL}/pay/${p.id}`;
      const stopLink = `${SITE_URL}/api/pay/${p.id}/stop-reminders`;
      const venue = b.venue_name?.trim() ? ` for your event at ${esc(b.venue_name.trim())}` : '';
      const lead = lastCall
        ? `Your event is in ${PRE_EVENT_DAYS} days and your ${kindLabel}${amt ? ` of <strong>${amt}</strong>` : ''}${venue} still hasn&rsquo;t been paid.`
        : `Just a reminder from ${esc(djName)} — your ${kindLabel}${amt ? ` of <strong>${amt}</strong>` : ''}${venue} hasn&rsquo;t been paid yet.`;

      const content = `<h1 style="margin:0 0 12px;font-size:22px;color:#111;">Hi ${hi}, ${lastCall ? 'last call on your ' + kindLabel : 'a friendly payment reminder'}</h1>
<p style="margin:0 0 18px;color:#666;font-size:14px;line-height:1.7;">${lead} You can take care of it with the button below.</p>
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
<tr><td style="background:#000000;border-radius:8px;">
<a href="${link}" style="display:inline-block;padding:14px 28px;color:#00f5c4;font-size:15px;font-weight:700;text-decoration:none;">Pay your ${kindLabel}</a>
</td></tr></table>
<p style="margin:0 0 14px;color:#999;font-size:12px;line-height:1.6;word-break:break-all;">
Or paste this into your browser:<br/><a href="${link}" style="color:#999;">${link}</a>
</p>
<p style="margin:0;padding-top:14px;border-top:1px solid #eee;color:#999;font-size:12px;line-height:1.6;">
Already paid this ${kindLabel}? <a href="${stopLink}" style="color:#666;">Stop reminders for this ${kindLabel}</a> — it won&rsquo;t affect any other payment.
</p>`;

      if (dry) { emails += 1; continue; }

      try {
        await resend!.emails.send({
          from: FROM,
          to,
          subject: lastCall
            ? `Last call: your ${kindLabel}${amt ? ` of ${amt}` : ''} is due before your event`
            : `Reminder: your ${kindLabel}${amt ? ` of ${amt}` : ''} is still due`,
          html: shell(content),
        });
        emails += 1;
        await db
          .from('booking_payments')
          .update({ [stampField]: new Date().toISOString() } as unknown as never)
          .eq('id', p.id);
      } catch { /* non-fatal — keep going */ }
    }
  }

  return NextResponse.json({ ok: true, dryRun: dry, today, djsChecked: scanned, emails });
}
