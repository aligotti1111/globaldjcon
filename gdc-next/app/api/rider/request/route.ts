// POST /api/rider/request — deploy a booking's DJ rider to the host.
// Saves the items, marks the rider 'sent', and emails the host the link to the
// read-only rider page. Session required; booking must belong to the DJ.
// Static segment: resolves here, never into [bookingId].

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import { Resend } from 'resend';
import { normalizeRiderItems, groupRider } from '@/lib/rider';

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

    let body: { bookingId?: unknown; items?: unknown };
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
    const bookingId = typeof body.bookingId === 'string' ? body.bookingId : '';
    if (!bookingId) return NextResponse.json({ error: 'Missing booking.' }, { status: 400 });
    const items = normalizeRiderItems(body.items);
    if (items.length === 0) return NextResponse.json({ error: 'Add at least one rider item before sending.' }, { status: 400 });

    const admin = createAdminClient();
    const { data: bData } = await admin
      .from('bookings')
      .select('id, dj_id, requester_id, host_email, requester_name, event_date, venue_name')
      .eq('id', bookingId).maybeSingle();
    const b = bData as unknown as BookingRow | null;
    if (!b || b.dj_id !== user.id) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

    // DJ name for the email.
    const { data: djData } = await admin.from('users').select('name').eq('id', user.id).maybeSingle();
    const djName = (djData as unknown as { name?: string | null } | null)?.name || 'Your DJ';

    // Persist + mark sent.
    const { data: up, error } = await admin
      .from('booking_riders')
      .upsert({
        booking_id: bookingId, dj_id: user.id, items,
        status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      } as unknown as never, { onConflict: 'booking_id' })
      .select('id')
      .single();
    if (error || !up) return NextResponse.json({ error: 'Could not save the rider.' }, { status: 500 });
    const id = (up as unknown as { id: string }).id;
    const url = `${SITE_URL}/rider/${id}`;

    // Host email.
    const to = b.host_email || (b.requester_id ? await resolveUserEmail(b.requester_id) : null);
    if (to && process.env.RESEND_API_KEY) {
      const hi = b.requester_name?.trim() ? esc(b.requester_name.trim().split(' ')[0]) : 'there';
      const when = fmtDate(b.event_date);
      const g = groupRider(items);
      const list = (arr: typeof items) => arr.map((i) => `<li style="margin:0 0 6px;color:#444;font-size:14px;line-height:1.6;">${esc(i.text)}</li>`).join('');
      const secBlock = (label: string, arr: typeof items) => arr.length
        ? `<p style="margin:16px 0 6px;color:#111;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">${label}</p><ul style="margin:0 0 8px;padding-left:18px;">${list(arr)}</ul>` : '';
      const content = `
<h1 style="margin:0 0 6px;font-size:22px;color:#111;">Hi ${hi} — ${esc(djName)}'s rider</h1>
<p style="margin:0 0 16px;color:#666;font-size:14px;line-height:1.7;">
Here's what ${esc(djName)} needs from the venue for ${esc(when)}${b.venue_name ? ` at ${esc(b.venue_name)}` : ''}. Please review and let them know if anything can't be provided.
</p>
${secBlock('Technical', g.technical)}
${secBlock('Hospitality', g.hospitality)}
<table cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 6px;">
<tr><td style="background:#000000;border-radius:8px;">
<a href="${url}" style="display:inline-block;padding:14px 28px;color:#00f5c4;font-size:15px;font-weight:700;text-decoration:none;">View the full rider</a>
</td></tr></table>
<p style="margin:14px 0 0;color:#999;font-size:12px;line-height:1.6;word-break:break-all;">Or paste this link:<br/><a href="${url}" style="color:#999;">${url}</a></p>`;
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({ from: FROM, to, subject: `${djName} — DJ rider for ${when}`, html: shell(content) });
      } catch {
        return NextResponse.json({ ok: true, id, url, status: 'sent', warning: 'Rider saved, but the email could not be sent. Copy the link instead.' });
      }
    }

    return NextResponse.json({ ok: true, id, url, status: 'sent', emailed: !!to });
  } catch {
    return NextResponse.json({ error: 'Could not send the rider.' }, { status: 500 });
  }
}
