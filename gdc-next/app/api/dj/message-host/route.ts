// POST /api/dj/message-host — send a host a message from the DJ, via the site.
// The DJ types a note in the booking panel; we email it to the host's address
// on file (host_email, falling back to their account email). reply_to is set to
// the DJ so the host can reply straight back to them.
//
// Deploy to: gdc-next/app/api/dj/message-host/route.ts

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

interface BookingRow {
  id: string; dj_id: string | null; requester_id: string | null;
  host_email: string | null; requester_name: string | null;
  event_date: string | null; venue_name: string | null;
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    let body: { bookingId?: unknown; message?: unknown };
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
    const bookingId = typeof body.bookingId === 'string' ? body.bookingId : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!bookingId) return NextResponse.json({ error: 'Missing booking.' }, { status: 400 });
    if (!message) return NextResponse.json({ error: 'Type a message first.' }, { status: 400 });
    if (message.length > 4000) return NextResponse.json({ error: 'Message is too long.' }, { status: 400 });

    const admin = createAdminClient() as unknown as SupabaseClient;
    const { data: bData } = await admin
      .from('bookings')
      .select('id, dj_id, requester_id, host_email, requester_name, event_date, venue_name')
      .eq('id', bookingId).maybeSingle();
    const b = bData as unknown as BookingRow | null;
    if (!b || b.dj_id !== user.id) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

    // Recipient: the host's delivery address, then their account email.
    const to = b.host_email || (b.requester_id ? await resolveUserEmail(b.requester_id) : null);
    if (!to) return NextResponse.json({ error: "This host has no email on file — reach them by phone." }, { status: 400 });
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: 'Email is not configured.' }, { status: 500 });

    // DJ name + reply-to, so the host can respond directly to the DJ.
    const { data: djData } = await admin.from('users').select('name').eq('id', user.id).maybeSingle();
    const djName = (djData as unknown as { name?: string | null } | null)?.name || 'Your DJ';
    const replyTo = await resolveUserEmail(user.id);

    const hi = b.requester_name?.trim() ? esc(b.requester_name.trim().split(' ')[0]) : 'there';
    const when = fmtDate(b.event_date);
    const bodyHtml = esc(message).replace(/\n/g, '<br/>');
    const content = `
<h1 style="margin:0 0 6px;font-size:22px;color:#111;">Hi ${hi} — a message from ${esc(djName)}</h1>
<p style="margin:0 0 16px;color:#666;font-size:13px;line-height:1.7;">
Regarding your event on ${esc(when)}${b.venue_name ? ` at ${esc(b.venue_name)}` : ''}.
</p>
<div style="margin:0 0 8px;padding:16px 18px;background:#f7f7f9;border-radius:10px;border:1px solid #ececf0;color:#222;font-size:15px;line-height:1.7;">${bodyHtml}</div>
${replyTo ? `<p style="margin:16px 0 0;color:#999;font-size:12px;line-height:1.6;">Reply to this email to reach ${esc(djName)} directly.</p>` : ''}`;

    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: FROM,
        to,
        subject: `${djName} — message about your event (${when})`,
        html: shell(content),
        ...(replyTo ? { replyTo } : {}),
      });
    } catch {
      return NextResponse.json({ error: 'Could not send the message. Try again.' }, { status: 502 });
    }

    return NextResponse.json({ ok: true, emailed: true });
  } catch {
    return NextResponse.json({ error: 'Could not send the message.' }, { status: 500 });
  }
}
