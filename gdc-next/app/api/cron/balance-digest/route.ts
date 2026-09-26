// GET /api/cron/balance-digest
//
// The Monday morning "money you're still owed" email. Once a week, every DJ who
// turned the digest ON (Notifications tab → email_notify_balance_digest) gets a
// single email listing their PAST events that still carry an outstanding
// balance — the agreed total minus everything collected (real payments + off-app
// "mark paid"). If a DJ has nothing outstanding, they get no email at all.
//
// Trigger: the Netlify scheduled function (netlify/functions/balance-digest.mjs)
// pings this route once an HOUR. The route self-gates so the send only happens
// when it's the 8 AM hour on MONDAY in America/New_York — 8 AM ET year-round
// without a hardcoded UTC offset that breaks across daylight saving. Pass
// ?force=1 (with the secret) to bypass the time gate for testing, ?dry=1 to
// compute + report without sending.
//
// Once-a-week guard: after a DJ is emailed we stamp users.balance_digest_week
// with the current ISO week ("2026-W39"). The route skips any DJ already stamped
// with this week, so even if the scheduled function fires twice in the 8 AM hour
// nobody gets a duplicate. Each new Monday is a new week key, so the list is
// freshly recomputed and sent again.
//
// Auth: requires CRON_SECRET, as Authorization: Bearer <secret> or ?key=<secret>.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import { canBook, type AccessFields } from '@/lib/access';
import { MOB_EVENT_LABELS } from '@/lib/constants';
import {
  agreedTotal,
  receivedByBooking,
  isAccepted,
  type FinanceBookingInput,
  type FinancePaymentInput,
} from '@/lib/finance';
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

// Weekday (0=Sun … 6=Sat) and hour (0–23) in US Eastern, DST-aware.
function easternParts(now: Date): { weekday: number; hour: number; ymd: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: 'numeric', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => fmt.find((p) => p.type === t)?.value || '';
  const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;
  const ymd = `${get('year')}-${get('month')}-${get('day')}`;
  return { weekday: WD[get('weekday')] ?? -1, hour, ymd };
}

// ISO week key ("2026-W39") for a YYYY-MM-DD date — the dedupe stamp.
function isoWeek(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7; // Mon=1 … Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - day); // nearest Thursday
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function fmtDate(d: string | null): string {
  if (!d) return 'Date TBD';
  try {
    return new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

const CUR: Record<string, string> = { USD: '$', CAD: '$', AUD: '$', GBP: '£', EUR: '€' };
function money(amount: number, currency: string | null): string {
  const code = (currency || 'USD').toUpperCase();
  const sym = CUR[code];
  const n = Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return sym ? `${sym}${n}` : `${code} ${n}`;
}

// The report math only needs FinanceBookingInput; the email adds the client's
// name, so carry it as a local extension.
type BookingRow = FinanceBookingInput & { requester_name: string | null };

const BOOKING_COLS =
  'id, event_date, start_time, end_time, status, accepted_at, event_type, venue_name, booking_type, tax_amount, total_with_tax, counter_rate, quoted_rate, offer_amount, currency, overtime_amount, overtime_tax, overtime_paid_at, deposit_amount, deposit_pct, deposit_completed_at, balance_completed_at, status_overrides, is_manual, requester_name';

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
  const now = new Date();
  const { weekday, hour, ymd } = easternParts(now);
  // Monday (1) at the 8 AM ET hour only.
  if (!force && !(weekday === 1 && hour === 8)) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'not Mon 8am ET', weekday, etHour: hour });
  }
  const weekKey = isoWeek(ymd);
  const todayISO = ymd; // "past event" cutoff, ET-local

  const admin = createAdminClient();
  const db = admin as unknown as SupabaseClient;

  // DJs who switched the digest ON. Pull the access fields too — the balance
  // report is a paid feature, so a lapsed DJ who left the toggle on still gets
  // nothing. Skip anyone already stamped with THIS week (dedupe).
  const { data: djRows, error: djErr } = await db
    .from('users')
    .select('id, role, sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, balance_digest_week')
    .eq('email_notify_balance_digest', true)
    .eq('role', 'dj')
    .limit(5000);
  if (djErr) return NextResponse.json({ error: djErr.message }, { status: 502 });

  type DjRow = AccessFields & { id: string; role: string; balance_digest_week: string | null };
  const djs = ((djRows || []) as unknown as DjRow[])
    .filter((u) => canBook(u as AccessFields))
    .filter((u) => force || u.balance_digest_week !== weekKey);

  if (djs.length === 0) {
    return NextResponse.json({ ok: true, djs: 0, emails: 0 });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey && !dry) return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
  const resend = resendKey ? new Resend(resendKey) : null;

  let emails = 0;
  let scanned = 0;

  for (const dj of djs) {
    // This DJ's bookings + ledger.
    const { data: bRows } = await db
      .from('bookings')
      .select(BOOKING_COLS)
      .eq('dj_id', dj.id)
      .is('deleted_at', null)
      .limit(3000);
    const bookings = (bRows || []) as unknown as BookingRow[];
    if (bookings.length === 0) continue;

    const ids = bookings.map((b) => b.id);
    let payments: FinancePaymentInput[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      if (chunk.length === 0) break;
      const { data: pRows } = await db
        .from('booking_payments')
        .select('id, booking_id, kind, amount, amount_paid, status, method, currency, confirmed_at, requested_at, marked_sent_at, due_date')
        .in('booking_id', chunk);
      payments = payments.concat((pRows || []) as unknown as FinancePaymentInput[]);
    }
    const received = receivedByBooking(bookings, payments);

    // PAST + accepted + still owed. Outstanding = agreed − collected.
    const owing = bookings
      .filter((b) => isAccepted(b))
      .filter((b) => !!b.event_date && (b.event_date || '').slice(0, 10) < todayISO)
      .map((b) => {
        const agreed = agreedTotal(b);
        const got = received.get(b.id) || 0;
        const outstanding = Math.round((agreed - got) * 100) / 100;
        return { b, agreed, got, outstanding };
      })
      .filter((x) => x.outstanding > 0.01);

    scanned += 1;
    if (owing.length === 0) continue; // nothing unpaid → no email, no stamp

    // Most overdue (oldest event) first.
    owing.sort((a, z) => (a.b.event_date || '').localeCompare(z.b.event_date || ''));

    const email = await resolveUserEmail(dj.id);
    if (!email) continue;

    let total = 0;
    const rowsHtml = owing.map(({ b, outstanding }) => {
      total += outstanding;
      const label = esc(b.event_type ? (MOB_EVENT_LABELS[b.event_type] || b.event_type) : (b.venue_name || 'Booking'));
      const who = b.requester_name ? ` · ${esc(b.requester_name)}` : '';
      return `<tr>
<td style="padding:14px 0;border-bottom:1px solid #eee;vertical-align:top;">
<div style="font-size:15px;color:#111;font-weight:700;">${label}${who}</div>
<div style="font-size:13px;color:#555;margin-top:3px;">${fmtDate(b.event_date)}${b.venue_name ? ` · ${esc(b.venue_name)}` : ''}</div>
</td>
<td style="padding:14px 0;border-bottom:1px solid #eee;vertical-align:top;text-align:right;white-space:nowrap;">
<div style="font-size:16px;color:#c0392b;font-weight:700;">${money(outstanding, b.currency)}</div>
<div style="font-size:11px;color:#999;">outstanding</div>
</td>
</tr>`;
    }).join('');

    const cur = owing[0].b.currency;
    const n = owing.length;
    const heading = n === 1 ? '1 past event still has an unpaid balance' : `${n} past events still have an unpaid balance`;
    const content = `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">${heading}</h1>
<p style="margin:0 0 6px;color:#333;font-size:15px;line-height:1.6;">These events have already happened but still carry a balance owed to you. Send a reminder or record a payment from your dashboard.</p>
<p style="margin:0 0 18px;color:#111;font-size:15px;"><strong>Total outstanding: ${money(Math.round(total * 100) / 100, cur)}</strong></p>
<table cellpadding="0" cellspacing="0" border="0" width="100%">${rowsHtml}</table>
<table cellpadding="0" cellspacing="0" border="0" style="margin:24px auto 0;"><tr><td style="background:#0a6f61;border-radius:6px;">
<a href="${SITE_URL}/upcoming-bookings" style="display:inline-block;padding:12px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">Open dashboard</a>
</td></tr></table>
<p style="margin:22px 0 0;color:#aaa;font-size:11px;text-align:center;">You’re getting this because the weekly unpaid-balance email is on. Turn it off any time under Notifications.</p>`;

    if (dry) { emails += 1; continue; }

    try {
      await resend!.emails.send({ from: FROM, to: email, subject: heading, html: shell(content) });
      emails += 1;
      // Stamp the week so a second ping today can't re-send.
      await db.from('users').update({ balance_digest_week: weekKey } as unknown as never).eq('id', dj.id);
    } catch { /* non-fatal — keep going for the other DJs */ }
  }

  return NextResponse.json({ ok: true, dryRun: dry, week: weekKey, djsChecked: scanned, emails });
}
