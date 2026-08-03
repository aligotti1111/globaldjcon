// GET /api/cron/booking-reminders
//
// Daily reminder to every DJ who has UNANSWERED booking requests — i.e.
// incoming bookings still in 'pending' status (the DJ hasn't approved, denied
// or countered yet). Each DJ gets ONE email listing all of their own pending
// requests, with a link to /booking-requests.
//
// Trigger: the Netlify scheduled function (netlify/functions/booking-reminders.mjs)
// pings this route once an HOUR. The route itself only does the send when the
// current time in America/New_York is the 8 AM hour — so it lands at 8 AM ET
// year-round without a hardcoded UTC offset that would break across daylight
// saving. Pass ?force=1 (with the secret) to bypass the time gate for testing.
//
// Auth: requires the CRON_SECRET env var, supplied either as
//   Authorization: Bearer <CRON_SECRET>   or   ?key=<CRON_SECRET>
// So the endpoint can't be triggered by the public.

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
<tr><td style="background:#f8f8f8;padding:20px 32px;text-align:center;border-top:1px solid #e0e0e0;"><p style="margin:0;color:#888;font-size:11px;">© ${new Date().getFullYear()} Global DJ Connect · globaldjconnect.com</p></td></tr>
</table></td></tr></table>`;
}

// Current hour (0–23) in US Eastern, DST-aware.
function easternHour(now: Date): number {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false,
  }).format(now);
  const h = parseInt(s, 10);
  return h === 24 ? 0 : h; // some runtimes render midnight as "24"
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function fmtDate(d: string | null): string {
  if (!d) return 'Date TBD';
  try {
    return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

type Booking = {
  id: string;
  dj_id: string | null;
  requester_name: string | null;
  event_type: string | null;
  venue_type: string | null;
  venue_name: string | null;
  event_date: string | null;
  created_at: string | null;
};

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const url = new URL(req.url);
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null;
  const provided = bearer || url.searchParams.get('key');
  if (provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const force = url.searchParams.get('force') === '1';
  // Dry run: compute + report who WOULD be emailed, but send nothing. Handy for
  // testing the wiring without blasting real DJs. Use ?force=1&dry=1.
  const dry = url.searchParams.get('dry') === '1';
  const now = new Date();
  if (!force && easternHour(now) !== 8) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'not 8am ET', etHour: easternHour(now) });
  }

  const admin = createAdminClient();
  const db = admin as unknown as SupabaseClient;

  // All unanswered incoming requests across the platform. 'pending' is the
  // status where the ball is in the DJ's court (they haven't approved/denied/
  // countered). Manual bookings never sit in 'pending', so they're excluded
  // naturally.
  const { data, error } = await db
    .from('bookings')
    .select('id, dj_id, requester_name, event_type, venue_type, venue_name, event_date, created_at')
    .eq('status', 'pending')
    .is('deleted_at', null)
    .limit(2000);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
  const rows = (data || []) as unknown as Booking[];

  // Group by DJ.
  const byDj = new Map<string, Booking[]>();
  for (const b of rows) {
    if (!b.dj_id) continue;
    const list = byDj.get(b.dj_id) || [];
    list.push(b);
    byDj.set(b.dj_id, list);
  }

  if (byDj.size === 0) {
    return NextResponse.json({ ok: true, djs: 0, emails: 0, requests: 0 });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
  }
  const resend = new Resend(resendKey);

  let emails = 0;
  let requests = 0;
  const nowMs = now.getTime();

  for (const [djId, list] of byDj.entries()) {
    const email = await resolveUserEmail(djId);
    if (!email) continue;

    // Newest first, so the freshest request is at the top.
    list.sort((a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''));

    const rowsHtml = list.map((b) => {
      const who = esc(b.requester_name || 'A client');
      const label = esc(b.event_type ? (MOB_EVENT_LABELS[b.event_type] || b.event_type) : (b.venue_type || 'Booking'));
      const venue = b.venue_name ? ` · ${esc(b.venue_name)}` : '';
      const when = fmtDate(b.event_date);
      const days = b.created_at ? Math.max(0, Math.floor((nowMs - Date.parse(b.created_at)) / 86400000)) : null;
      const waited = days === null ? '' : days === 0 ? 'Received today' : days === 1 ? 'Waiting 1 day' : `Waiting ${days} days`;
      return `<tr><td style="padding:14px 0;border-bottom:1px solid #eee;">
<div style="font-size:15px;color:#111;font-weight:700;">${who} — ${label}</div>
<div style="font-size:13px;color:#555;margin-top:3px;">${when}${venue}</div>
${waited ? `<div style="font-size:12px;color:#b0791f;margin-top:3px;font-weight:600;">${waited}</div>` : ''}
</td></tr>`;
    }).join('');

    const n = list.length;
    const heading = n === 1 ? 'You have 1 unanswered booking request' : `You have ${n} unanswered booking requests`;
    const content = `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">${heading}</h1>
<p style="margin:0 0 18px;color:#333;font-size:15px;line-height:1.6;">These requests are still waiting on your response. Approve, counter, or decline them from your dashboard.</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%">${rowsHtml}</table>
<table cellpadding="0" cellspacing="0" border="0" style="margin:24px auto 0;"><tr><td style="background:#0a6f61;border-radius:6px;">
<a href="${SITE_URL}/booking-requests" style="display:inline-block;padding:12px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">Review requests</a>
</td></tr></table>`;

    if (dry) {
      // Report what would be sent, but don't actually send.
      emails += 1;
      requests += n;
      continue;
    }

    try {
      await resend.emails.send({
        from: FROM,
        to: email,
        subject: n === 1 ? 'You have 1 unanswered booking request' : `You have ${n} unanswered booking requests`,
        html: shell(content),
      });
      emails += 1;
      requests += n;
    } catch { /* non-fatal — keep going for the other DJs */ }
  }

  return NextResponse.json({ ok: true, dryRun: dry, djs: byDj.size, emails, requests });
}
