// GET /api/cron/planner-reminders
//
// The Planner & Playlist nudge. Each DJ can set up to two automatic reminders
// (Booking Settings → Planner & Playlist → Automatic reminders), stored on
// users.planner_reminder_days_1 / _2 as "N days before the event". When one of
// those lead times lands on today AND the booking's planner still isn't
// complete (planner_status is 'sent' or 'partial', never 'submitted'), the
// client gets a reminder email with their private planner link.
//
// THE RULE (enforced in the UI and re-checked here): a reminder day can never
// be same-day (0) or sooner than users.planner_lead_days — the submission
// window the DJ asks the planner back by. So a reminder always fires with time
// still on the clock before the deadline.
//
// Trigger: netlify/functions/planner-reminders.mjs pings this once an HOUR. The
// route self-gates to the 9 AM Eastern hour (DST-aware) so a booking gets at
// most one send per reminder-day. ?force=1 bypasses the time gate (still needs
// the secret); ?dry=1 computes + reports without sending.
//
// No double-sends: booking_planners.reminders_sent holds the integer day values
// already fired for that planner (e.g. [30, 21]). A day is only sent if it's not
// already in that list, and the list is stamped on send. Since a submitted
// planner stops qualifying, the list never needs resetting.
//
// Auth: requires CRON_SECRET, as Authorization: Bearer <secret> or ?key=<secret>.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import { canUsePro, type AccessFields } from '@/lib/access';
import { mobEventLabel, parseCustomEventTypes } from '@/lib/constants';
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

function fmtLongDate(d: string): string {
  try {
    return new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
  } catch { return d; }
}

// Hour (0–23) and today's YYYY-MM-DD in US Eastern, DST-aware.
function easternParts(now: Date): { hour: number; ymd: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => fmt.find((p) => p.type === t)?.value || '';
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;
  return { hour, ymd: `${get('year')}-${get('month')}-${get('day')}` };
}

// Whole days from `todayYmd` to `eventYmd` (both YYYY-MM-DD), by UTC midnight.
function daysUntil(eventYmd: string, todayYmd: string): number {
  const a = Date.parse(`${eventYmd.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${todayYmd}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((a - b) / 86400000);
}

interface DjRow extends AccessFields {
  id: string;
  name: string | null;
  planner_lead_days: number | null;
  planner_reminder_days_1: number | null;
  planner_reminder_days_2: number | null;
  mob_custom_event_types: unknown;
}

interface BookingRow {
  id: string;
  event_date: string | null;
  event_type: string | null;
  requester_name: string | null;
  host_email: string | null;
  requester_id: string | null;
  planner_status: 'sent' | 'partial' | 'submitted' | null;
}

interface PlannerRow {
  id: string;
  booking_id: string;
  status: string | null;
  reminders_sent: unknown;
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
  const now = new Date();
  const { hour, ymd: today } = easternParts(now);
  // 9 AM ET hour only — a booking gets at most one send per reminder-day.
  if (!force && hour !== 9) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'not 9am ET', etHour: hour });
  }

  const admin = createAdminClient();
  const db = admin as unknown as SupabaseClient;

  // DJs with at least one reminder slot set. Reminders are a Pro feature, so a
  // lapsed DJ who left one on still sends nothing.
  const { data: djRows, error: djErr } = await db
    .from('users')
    .select('id, role, sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, comp_source, name, planner_lead_days, planner_reminder_days_1, planner_reminder_days_2, mob_custom_event_types')
    .eq('role', 'dj')
    .or('planner_reminder_days_1.not.is.null,planner_reminder_days_2.not.is.null')
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
    const lead = dj.planner_lead_days ?? 14;
    // The reminder days that are actually valid for this DJ right now: set,
    // at least `lead` out, never same-day, de-duplicated.
    const reminderDays = Array.from(new Set(
      [dj.planner_reminder_days_1, dj.planner_reminder_days_2]
        .filter((d): d is number => typeof d === 'number' && d > 0 && d >= lead),
    ));
    if (reminderDays.length === 0) continue;

    // Future bookings whose planner is out but not yet complete.
    const { data: bRows } = await db
      .from('bookings')
      .select('id, event_date, event_type, requester_name, host_email, requester_id, planner_status')
      .eq('dj_id', dj.id)
      .is('deleted_at', null)
      .in('planner_status', ['sent', 'partial'])
      .gte('event_date', today)
      .limit(3000);
    const bookings = (bRows || []) as unknown as BookingRow[];
    if (bookings.length === 0) continue;

    // Only the bookings whose days-until matches one of the reminder days.
    const due = bookings
      .map((b) => ({ b, hit: b.event_date ? reminderDays.find((d) => daysUntil(b.event_date!, today) === d) : undefined }))
      .filter((x): x is { b: BookingRow; hit: number } => typeof x.hit === 'number');
    scanned += 1;
    if (due.length === 0) continue;

    // Pull the planner rows so we can read/stamp reminders_sent and get the link id.
    const ids = due.map((x) => x.b.id);
    const { data: plRows } = await db
      .from('booking_planners')
      .select('id, booking_id, status, reminders_sent')
      .in('booking_id', ids);
    const planners = new Map<string, PlannerRow>();
    for (const p of (plRows || []) as unknown as PlannerRow[]) planners.set(p.booking_id, p);

    const custom = parseCustomEventTypes(dj.mob_custom_event_types);
    const djName = dj.name?.trim() || 'Your DJ';

    for (const { b, hit } of due) {
      const planner = planners.get(b.id);
      if (!planner || planner.status === 'submitted') continue;
      const sentAlready = Array.isArray(planner.reminders_sent)
        ? (planner.reminders_sent as unknown[]).map(Number)
        : [];
      if (sentAlready.includes(hit)) continue;

      const to = b.host_email?.trim() || (b.requester_id ? await resolveUserEmail(b.requester_id) : null);
      if (!to) continue;

      const link = `${SITE_URL}/planner/${planner.id}`;
      const hi = b.requester_name?.trim() ? esc(b.requester_name.trim().split(' ')[0]) : 'there';
      const eventTypeLabel = b.event_type ? mobEventLabel(b.event_type, custom) : 'Event';
      const dueYmd = b.event_date!;
      const dueDate = new Date(`${dueYmd.slice(0, 10)}T12:00:00`);
      dueDate.setDate(dueDate.getDate() - lead);
      const dueLabel = dueDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

      const content = `<h1 style="margin:0 0 12px;font-size:22px;color:#111;">Hi ${hi}, your Planner &amp; Playlist is still open</h1>
<p style="margin:0 0 18px;color:#666;font-size:14px;line-height:1.7;">
Just a reminder from ${esc(djName)} — your ${esc(eventTypeLabel.toLowerCase())} on <strong>${esc(fmtLongDate(dueYmd))}</strong> is coming up and your Planner &amp; Playlist isn&rsquo;t finished yet. Everything you enter auto-saves, so you can add what you know now and come back to the rest.
</p>
<div style="background:#fff8e1;border:1px solid #ffe08a;border-radius:8px;padding:14px 16px;margin:0 0 20px;">
<p style="margin:0;color:#7a5b00;font-size:14px;line-height:1.6;">Please complete it by<br/><strong style="color:#5a4300;font-size:16px;">${esc(dueLabel)}</strong></p>
</div>
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
<tr><td style="background:#000000;border-radius:8px;">
<a href="${link}" style="display:inline-block;padding:14px 28px;color:#00f5c4;font-size:15px;font-weight:700;text-decoration:none;">Finish your Planner &amp; Playlist</a>
</td></tr></table>
<p style="margin:0;color:#999;font-size:12px;line-height:1.6;word-break:break-all;">
Or paste this into your browser:<br/><a href="${link}" style="color:#999;">${link}</a>
</p>`;

      if (dry) { emails += 1; continue; }

      try {
        await resend!.emails.send({
          from: FROM,
          to,
          subject: `Reminder: ${new Date(`${dueYmd}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} ${eventTypeLabel} Planner & Playlist`,
          html: shell(content),
        });
        emails += 1;
        // Stamp the day so a later ping today (or a future run) can't re-send it.
        await db
          .from('booking_planners')
          .update({ reminders_sent: [...sentAlready, hit] } as unknown as never)
          .eq('id', planner.id);
      } catch { /* non-fatal — keep going for the other bookings */ }
    }
  }

  return NextResponse.json({ ok: true, dryRun: dry, today, djsChecked: scanned, emails });
}
