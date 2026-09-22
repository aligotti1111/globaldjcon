// GET /api/cron/booking-digest
//
// The DJ's upcoming-bookings digest, in two cadences:
//   · WEEKLY  — every Monday, listing the coming week's bookings (Mon–Sun).
//   · MONTHLY — the 1st of each month, listing that whole month's bookings.
// Each is opt-in (users.email_notify_weekly_digest / _monthly_digest) and shows
// the TOTAL count up top, then the bookings in date order.
//
// Trigger: the Netlify scheduled function (netlify/functions/booking-digest.mjs)
// pings this once an HOUR. The route self-gates on the current time in
// America/New_York — it only sends at 8 AM ET, and only the weekly on a Monday /
// the monthly on the 1st. So it lands right year-round without a hardcoded UTC
// offset that daylight saving would break.
//
// Testing: ?force=1 bypasses the day/hour gate; ?type=weekly|monthly picks one;
// ?dry=1 computes who WOULD be emailed but sends nothing.
//
// Auth: CRON_SECRET via  Authorization: Bearer <secret>  or  ?key=<secret>.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import { MOB_EVENT_LABELS } from '@/lib/constants';
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
<tr><td style="background:#f8f8f8;padding:20px 32px;text-align:center;border-top:1px solid #e0e0e0;"><p style="margin:0;color:#888;font-size:11px;">© ${new Date().getFullYear()} Global DJ Connect · globaldjconnect.com · <a href="${SITE_URL}/notifications" style="color:#888;">Manage emails</a></p></td></tr>
</table></td></tr></table>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

// ── Eastern-time helpers (DST-aware) ──────────────────────────────────────────
function easternHour(now: Date): number {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(now);
  const h = parseInt(s, 10);
  return h === 24 ? 0 : h;
}
// { ymd:'2026-09-21', day:21, weekday:'Mon' } in America/New_York.
function easternDate(now: Date): { ymd: string; day: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(now);
  return { ymd: `${y}-${m}-${d}`, day: Number(d), weekday };
}
// Date math on a YYYY-MM-DD string, anchored at noon UTC so it never slips a day.
function addDays(ymd: string, n: number): string {
  const dt = new Date(`${ymd}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function endOfMonth(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last of this
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

function fmtDate(d: string | null): string {
  if (!d) return 'Date TBD';
  try {
    return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return d; }
}
// "19:30:00" → "7:30 PM".
function fmtTime(t: string | null): string {
  if (!t) return '';
  const [hRaw, m] = t.split(':');
  const h = Number(hRaw);
  if (!Number.isFinite(h)) return '';
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m || '00'} ${ampm}`;
}

type Booking = {
  id: string;
  dj_id: string | null;
  requester_name: string | null;
  event_type: string | null;
  venue_type: string | null;
  venue_name: string | null;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  ceremony_needed: boolean | null;
  ceremony_start_time: string | null;
  cocktail_needed: boolean | null;
  cocktail_start_time: string | null;
};

// A booking's time breakdown, tailored to the booking type:
//   · club (no event type) → Set start / Set end
//   · wedding → Ceremony / Cocktail hour / Reception (start–end)
//   · other mobile events → Start / End
function eventTimes(b: Booking): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  const start = fmtTime(b.start_time);
  const end = fmtTime(b.end_time);
  const range = start && end ? `${start} – ${end}` : start || end || '';

  // Club / venue booking — start_time & end_time are the DJ's set times.
  if (!b.event_type) {
    if (start) out.push({ label: 'Set start', value: start });
    if (end) out.push({ label: 'Set end', value: end });
    return out;
  }

  const isWedding = /wedding/i.test(b.event_type);
  if (b.ceremony_needed && b.ceremony_start_time) {
    out.push({ label: 'Ceremony', value: fmtTime(b.ceremony_start_time) });
  }
  if (b.cocktail_needed && b.cocktail_start_time) {
    out.push({ label: 'Cocktail hour', value: fmtTime(b.cocktail_start_time) });
  }
  if (isWedding) {
    if (range) out.push({ label: 'Reception', value: range });
  } else {
    if (start) out.push({ label: 'Start', value: start });
    if (end) out.push({ label: 'End', value: end });
  }
  return out;
}

async function runDigest(
  db: SupabaseClient,
  resend: Resend | null,
  kind: 'weekly' | 'monthly',
  startYmd: string,
  endYmd: string,
  dry: boolean,
): Promise<{ djs: number; emails: number; bookings: number }> {
  // Every confirmed/upcoming booking in the window, platform-wide, in date order.
  // Confirmed = status 'approved' OR a DJ's manual booking.
  const { data } = await db
    .from('bookings')
    .select('id, dj_id, requester_name, event_type, venue_type, venue_name, event_date, start_time, end_time, ceremony_needed, ceremony_start_time, cocktail_needed, cocktail_start_time')
    .is('deleted_at', null)
    .gte('event_date', startYmd)
    .lte('event_date', endYmd)
    .or('status.eq.approved,is_manual.eq.true')
    .order('event_date', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(5000);
  const rows = (data || []) as unknown as Booking[];

  const byDj = new Map<string, Booking[]>();
  for (const b of rows) {
    if (!b.dj_id) continue;
    const list = byDj.get(b.dj_id) || [];
    list.push(b);
    byDj.set(b.dj_id, list);
  }
  if (byDj.size === 0) return { djs: 0, emails: 0, bookings: 0 };

  // Which of those DJs have opted IN to this cadence.
  const prefCol = kind === 'weekly' ? 'email_notify_weekly_digest' : 'email_notify_monthly_digest';
  const djIds = Array.from(byDj.keys());
  const { data: prefs } = await db
    .from('users')
    .select(`id, ${prefCol}`)
    .in('id', djIds);
  const optedIn = new Set<string>();
  for (const u of (prefs as unknown as Array<Record<string, unknown>> | null) || []) {
    if (u[prefCol] === true) optedIn.add(String(u.id));
  }

  const label = kind === 'weekly' ? 'this week' : 'this month';
  let emails = 0;
  let bookingsSent = 0;

  for (const [djId, list] of byDj.entries()) {
    if (!optedIn.has(djId)) continue;
    const email = await resolveUserEmail(djId);
    if (!email) continue;

    const rowsHtml = list.map((b) => {
      const type = esc(b.event_type ? (MOB_EVENT_LABELS[b.event_type] || b.event_type) : (b.venue_type || 'Booking'));
      const who = b.requester_name ? esc(b.requester_name) : '';
      const when = fmtDate(b.event_date);
      const venue = b.venue_name ? esc(b.venue_name) : '';
      const timesHtml = eventTimes(b)
        .map((t) => `<div style="font-size:12px;color:#777;margin-top:3px;"><span style="color:#999;">${esc(t.label)}</span> <span style="color:#444;font-weight:600;">${esc(t.value)}</span></div>`)
        .join('');
      return `<tr>
<td style="padding:12px 12px 12px 0;border-bottom:1px solid #eee;vertical-align:top;white-space:nowrap;">
<div style="font-size:14px;color:#111;font-weight:700;">${when}</div>
${timesHtml}
</td>
<td style="padding:12px 0;border-bottom:1px solid #eee;vertical-align:top;">
<div style="font-size:14px;color:#111;font-weight:600;">${type}${who ? ` · ${who}` : ''}</div>
${venue ? `<div style="font-size:12px;color:#777;margin-top:2px;">${venue}</div>` : ''}
</td>
</tr>`;
    }).join('');

    const n = list.length;
    const heading = `You have ${n} booking${n === 1 ? '' : 's'} ${label}`;
    const content = `<h1 style="margin:0 0 6px;font-size:20px;color:#111;">${heading}</h1>
<p style="margin:0 0 18px;color:#333;font-size:15px;line-height:1.6;">Here's what's on your calendar for ${kind === 'weekly' ? 'the week ahead' : 'the month ahead'}, in order.</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%">${rowsHtml}</table>
<table cellpadding="0" cellspacing="0" border="0" style="margin:24px auto 0;"><tr><td style="background:#0a6f61;border-radius:6px;">
<a href="${SITE_URL}/upcoming-bookings" style="display:inline-block;padding:12px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">Open your bookings</a>
</td></tr></table>`;

    if (dry || !resend) { emails += 1; bookingsSent += n; continue; }
    try {
      await resend.emails.send({ from: FROM, to: email, subject: heading, html: shell(content) });
      emails += 1;
      bookingsSent += n;
    } catch { /* non-fatal — keep going for the other DJs */ }
  }

  return { djs: optedIn.size, emails, bookings: bookingsSent };
}

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
  const only = url.searchParams.get('type'); // 'weekly' | 'monthly' | null

  const now = new Date();
  const { ymd, day, weekday } = easternDate(now);

  // Which digests fire this run? (8 AM ET; weekly on Mon, monthly on the 1st.)
  const isHour = force || easternHour(now) === 8;
  const doWeekly = isHour && only !== 'monthly' && (force ? only !== 'monthly' : weekday === 'Mon');
  const doMonthly = isHour && only !== 'weekly' && (force ? only !== 'weekly' : day === 1);

  if (!doWeekly && !doMonthly) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'nothing due', etHour: easternHour(now), weekday, day });
  }

  const admin = createAdminClient();
  const db = admin as unknown as SupabaseClient;
  const resendKey = process.env.RESEND_API_KEY;
  const resend = resendKey && !dry ? new Resend(resendKey) : null;

  const out: Record<string, unknown> = { ok: true, dryRun: dry };

  if (doWeekly) {
    // Monday through the coming Sunday (today + 6 days).
    out.weekly = await runDigest(db, resend, 'weekly', ymd, addDays(ymd, 6), dry);
  }
  if (doMonthly) {
    // The 1st through the last day of this month.
    out.monthly = await runDigest(db, resend, 'monthly', ymd, endOfMonth(ymd), dry);
  }

  return NextResponse.json(out);
}
