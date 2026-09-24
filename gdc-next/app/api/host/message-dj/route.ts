// POST /api/host/message-dj — send the DJ a message from the host, via the site.
// The host types a note in their event card; we email it to the DJ's address on
// file. reply_to is set to the host so the DJ can reply straight back.
//
// The mirror of /api/dj/message-host. Auth: the caller must be the booking's
// requester (the host who made it).
//
// Deploy to: gdc-next/app/api/host/message-dj/route.ts

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
  if (!d) return 'the event';
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
  requester_name: string | null; event_date: string | null; venue_name: string | null;
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
      .select('id, dj_id, requester_id, requester_name, event_date, venue_name')
      .eq('id', bookingId).maybeSingle();
    const b = bData as unknown as BookingRow | null;
    // Only the host who made this booking can message its DJ.
    if (!b || b.requester_id !== user.id) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    if (!b.dj_id) return NextResponse.json({ error: 'This event has no DJ attached.' }, { status: 400 });

    const to = await resolveUserEmail(b.dj_id);
    if (!to) return NextResponse.json({ error: "This DJ has no email on file — reach them by phone." }, { status: 400 });
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: 'Email is not configured.' }, { status: 500 });

    // DJ + host names, and reply-to so the DJ can respond to the host directly.
    const { data: djData } = await admin.from('users').select('name').eq('id', b.dj_id).maybeSingle();
    const djName = (djData as unknown as { name?: string | null } | null)?.name || 'there';
    const hostName = b.requester_name?.trim()
      || (await admin.from('users').select('name').eq('id', user.id).maybeSingle()
            .then((r) => (r.data as unknown as { name?: string | null } | null)?.name || ''))
      || 'A host';
    const replyTo = await resolveUserEmail(user.id);

    const when = fmtDate(b.event_date);
    const bodyHtml = esc(message).replace(/\n/g, '<br/>');
    const content = `
<h1 style="margin:0 0 6px;font-size:22px;color:#111;">Hi ${esc(djName)} — a message from ${esc(hostName)}</h1>
<p style="margin:0 0 16px;color:#666;font-size:13px;line-height:1.7;">
Regarding the event on ${esc(when)}${b.venue_name ? ` at ${esc(b.venue_name)}` : ''}.
</p>
<div style="margin:0 0 8px;padding:16px 18px;background:#f7f7f9;border-radius:10px;border:1px solid #ececf0;color:#222;font-size:15px;line-height:1.7;">${bodyHtml}</div>
${replyTo ? `<p style="margin:16px 0 0;color:#999;font-size:12px;line-height:1.6;">Reply to this email to reach ${esc(hostName)} directly.</p>` : ''}`;

    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: FROM,
        to,
        subject: `${hostName} — message about the event (${when})`,
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
