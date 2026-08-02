// POST /api/guestlist/confirm  { guestlistId }
//
// Public (no login). The host opened the DJ's guest list (an unguessable UUID
// capability URL, exactly like the guest list VIEW page and the emailed link)
// and taps "Confirm guest list". We stamp booking_guestlists.confirmed_at — the
// host activity signal the Upcoming Bookings "New activity" sort reads — and
// notify the DJ so they know the names were acknowledged.
//
// It is idempotent: confirming twice keeps the FIRST confirmation time.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import { Resend } from 'resend';

export const runtime = 'nodejs';

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const SITE_URL = 'https://globaldjconnect.com';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shell(content: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background:#000;padding:24px 32px;" align="center"><div style="font-family:Impact,Arial,sans-serif;font-size:28px;letter-spacing:.06em;color:#00f5c4;font-weight:700;">GLOBAL DJ CONNECT</div></td></tr>
<tr><td style="padding:32px;">${content}</td></tr>
<tr><td style="background:#f8f8f8;padding:20px 32px;text-align:center;border-top:1px solid #e0e0e0;"><p style="margin:0;color:#888;font-size:11px;">© ${new Date().getFullYear()} Global DJ Connect · globaldjconnect.com</p></td></tr>
</table></td></tr></table>`;
}

export async function POST(req: Request) {
  let body: { guestlistId?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const guestlistId = typeof body.guestlistId === 'string' && UUID_RE.test(body.guestlistId) ? body.guestlistId : null;
  if (!guestlistId) return NextResponse.json({ error: 'Missing guest list id' }, { status: 400 });

  const admin = createAdminClient();
  const db = admin as unknown as SupabaseClient;

  const { data: gData } = await db
    .from('booking_guestlists')
    .select('id, booking_id, dj_id, confirmed_at')
    .eq('id', guestlistId)
    .maybeSingle();
  const g = gData as unknown as { id: string; booking_id: string; dj_id: string | null; confirmed_at: string | null } | null;
  if (!g) return NextResponse.json({ error: 'Guest list not found.' }, { status: 404 });

  // Already confirmed — keep the first time, report success.
  if (g.confirmed_at) return NextResponse.json({ ok: true, confirmed_at: g.confirmed_at });

  const nowIso = new Date().toISOString();
  const { error: upErr } = await db
    .from('booking_guestlists')
    .update({ confirmed_at: nowIso } as unknown as never)
    .eq('id', guestlistId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 502 });

  // Tell the DJ the guest list was confirmed.
  if (g.dj_id && process.env.RESEND_API_KEY) {
    const { data: bData } = await admin
      .from('bookings')
      .select('requester_name, event_date, venue_name')
      .eq('id', g.booking_id)
      .maybeSingle();
    const b = bData as { requester_name: string | null; event_date: string | null; venue_name: string | null } | null;
    const djEmail = await resolveUserEmail(g.dj_id);
    if (djEmail) {
      const who = b?.requester_name || 'Your client';
      const forWhen = b?.event_date ? ` for the ${b.event_date} event` : '';
      const atVenue = b?.venue_name ? ` at ${b.venue_name}` : '';
      const content = `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">${who} confirmed the guest list</h1>
<p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.6;">${who} has confirmed the guest list${forWhen}${atVenue}.</p>
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td style="background:#0a6f61;border-radius:6px;">
<a href="${SITE_URL}/upcoming-bookings" style="display:inline-block;padding:12px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">Review booking</a>
</td></tr></table>`;
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({ from: FROM, to: djEmail, subject: `${who} confirmed the guest list`, html: shell(content) });
      } catch { /* non-fatal */ }
    }
  }

  return NextResponse.json({ ok: true, confirmed_at: nowIso });
}
