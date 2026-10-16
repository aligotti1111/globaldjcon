// POST /api/dj/share-card — email the host a link to their read-only booking
// card (and, optionally, their read-only planner). This exists because a plain
// mailto: can't pre-fill a compose window for arbitrary webmail — it just dumps
// the DJ on their provider's homepage. Sending server-side (the same way
// planners, riders and contracts go out) is the only reliable path, and the
// host gets a branded email with a real clickable button.
//
// Deploy to: gdc-next/app/api/dj/share-card/route.ts

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

export const runtime = 'nodejs';
export const maxDuration = 20;

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const SITE_URL = 'https://globaldjconnect.com';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fmtDate(d: string | null): string {
  if (!d) return 'your event';
  return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

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

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#000000;color:#00f5c4;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:9px;">${label}</a>`;
}

interface BookingRow {
  id: string; dj_id: string | null; requester_id: string | null;
  host_email: string | null; requester_name: string | null;
  event_date: string | null; venue_name: string | null;
  share_token: string | null; booking_type: string | null;
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    let body: { bookingId?: unknown; includePlanner?: unknown };
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
    const bookingId = typeof body.bookingId === 'string' ? body.bookingId : '';
    const includePlanner = body.includePlanner === true;
    if (!bookingId) return NextResponse.json({ error: 'Missing booking.' }, { status: 400 });

    const admin = createAdminClient() as unknown as SupabaseClient;
    const { data: bData } = await admin
      .from('bookings')
      .select('id, dj_id, requester_id, host_email, requester_name, event_date, venue_name, share_token, booking_type')
      .eq('id', bookingId).maybeSingle();
    const b = bData as unknown as BookingRow | null;
    if (!b || b.dj_id !== user.id) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    if (!b.share_token) return NextResponse.json({ error: 'This booking has no shareable card yet.' }, { status: 400 });

    const to = b.host_email || (b.requester_id ? await resolveUserEmail(b.requester_id) : null);
    if (!to) return NextResponse.json({ error: "This host has no email on file — share by text or copy the link instead." }, { status: 400 });
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: 'Email is not configured.' }, { status: 500 });

    // The read-only card link. Planner link only for a mobile DJ booking that
    // actually has a planner, and only when the DJ asked to include it.
    const cardUrl = `${SITE_URL}/card/${b.share_token}`;
    let plannerUrl: string | null = null;
    if (includePlanner && b.booking_type !== 'club') {
      const { data: pData } = await admin
        .from('booking_planners').select('id').eq('booking_id', bookingId).maybeSingle();
      const plannerId = (pData as unknown as { id?: string } | null)?.id;
      if (plannerId) plannerUrl = `${SITE_URL}/planner/${plannerId}/print`;
    }

    const { data: djData } = await admin.from('users').select('name, company').eq('id', user.id).maybeSingle();
    const dj = djData as unknown as { name?: string | null; company?: string | null } | null;
    const djName = dj?.company || dj?.name || 'Your DJ';
    const replyTo = await resolveUserEmail(user.id);

    const hi = b.requester_name?.trim() ? esc(b.requester_name.trim().split(' ')[0]) : 'there';
    const when = fmtDate(b.event_date);
    const content = `
<h1 style="margin:0 0 6px;font-size:22px;color:#111;">Hi ${hi} — your event details</h1>
<p style="margin:0 0 20px;color:#666;font-size:14px;line-height:1.7;">
${esc(djName)} shared your booking card for your event on ${esc(when)}${b.venue_name ? ` at ${esc(b.venue_name)}` : ''}. It's view-only — no login needed.
</p>
<div style="margin:0 0 ${plannerUrl ? '14px' : '0'};">${button(cardUrl, 'View your booking card')}</div>
${plannerUrl ? `<p style="margin:0 0 8px;color:#666;font-size:14px;line-height:1.7;">And your event planner:</p><div>${button(plannerUrl, 'View your planner')}</div>` : ''}
${replyTo ? `<p style="margin:22px 0 0;color:#999;font-size:12px;line-height:1.6;">Reply to this email to reach ${esc(djName)} directly.</p>` : ''}`;

    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: FROM,
        to,
        subject: `Your event details — ${when}`,
        html: shell(content),
        ...(replyTo ? { replyTo } : {}),
      });
    } catch {
      return NextResponse.json({ error: 'Could not send the email. Try again.' }, { status: 502 });
    }

    return NextResponse.json({ ok: true, emailed: true, to });
  } catch {
    return NextResponse.json({ error: 'Could not send the email.' }, { status: 500 });
  }
}
