// GET /api/cron/auto-decline
//
// Auto-declines incoming booking requests the DJ never answered in time.
// A request expires at the EARLIER of:
//   1. 10 days after it was received, or
//   2. midnight entering the event day (00:00 on the event date),
// both in the DJ's own timezone (users.timezone, default US Eastern). See
// lib/bookingExpiry — the same math powers the "Expires in N days" countdown
// on the request cards, so the badge and the cron can never disagree.
//
// Expired + still 'pending' → set to 'denied' and email the booker the normal
// decline notice (reusing /api/send-email's mob_booking_status / booking_status
// template) with an automatic reason.
//
// Trigger: netlify/functions/auto-decline.mjs pings this EVERY HOUR (no time
// gate — the deadline can fall at any hour, and we want to act promptly once
// it passes). ?force is unnecessary; ?dry=1 reports what WOULD be declined
// without changing anything or sending mail.
//
// Auth: CRON_SECRET, as Authorization: Bearer <secret> or ?key=<secret>.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { responseDeadlineMs, DEFAULT_TZ } from '@/lib/bookingExpiry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SITE_URL = 'https://globaldjconnect.com';
const AUTO_REASON = 'This request wasn’t answered in time, so it was automatically declined. You’re welcome to send a new request.';

type PendingBooking = {
  id: string;
  dj_id: string | null;
  booking_type: string | null;
  requester_id: string | null;
  requester_name: string | null;
  event_date: string | null;
  venue_name: string | null;
  package_title: string | null;
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
  const dry = url.searchParams.get('dry') === '1';
  const now = Date.now();

  const admin = createAdminClient();
  const db = admin as unknown as SupabaseClient;

  // Every unanswered incoming request. 'pending' is the DJ's-court state;
  // manual bookings never sit there, so they're excluded naturally.
  const { data, error } = await db
    .from('bookings')
    .select('id, dj_id, booking_type, requester_id, requester_name, event_date, venue_name, package_title, created_at')
    .eq('status', 'pending')
    .is('deleted_at', null)
    .limit(2000);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
  const rows = (data || []) as unknown as PendingBooking[];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, checked: 0, declined: 0 });
  }

  // Each DJ's timezone (for the deadline clock). Cast — timezone isn't in the
  // generated types until the migration's types are regenerated.
  const djIds = Array.from(new Set(rows.map((r) => r.dj_id).filter(Boolean))) as string[];
  const tzById = new Map<string, string>();
  if (djIds.length > 0) {
    const { data: djs } = await db
      .from('users')
      .select('id, timezone')
      .in('id', djIds);
    for (const u of (djs as unknown as { id: string; timezone: string | null }[] | null) || []) {
      tzById.set(u.id, u.timezone || DEFAULT_TZ);
    }
  }

  // Which requests are past their deadline right now.
  const expired = rows.filter((b) => {
    const tz = (b.dj_id && tzById.get(b.dj_id)) || DEFAULT_TZ;
    const deadline = responseDeadlineMs(b.created_at, b.event_date, tz);
    return deadline != null && now >= deadline;
  });

  if (dry) {
    return NextResponse.json({
      ok: true, dryRun: true, checked: rows.length, declined: expired.length,
      ids: expired.map((b) => b.id),
    });
  }

  const nowIso = new Date(now).toISOString();
  let declined = 0;
  for (const b of expired) {
    // Guard the update on status='pending' so we never clobber a booking the
    // DJ answered in the same minute the cron ran.
    const { error: upErr, data: upData } = await db
      .from('bookings')
      .update({ status: 'denied', updated_at: nowIso } as unknown as never)
      .eq('id', b.id)
      .eq('status', 'pending')
      .select('id');
    if (upErr || !upData || (upData as unknown[]).length === 0) continue;
    declined += 1;

    // Reuse the normal decline email so the booker gets the same notice a
    // manual decline would send — just with the automatic reason.
    try {
      await fetch(`${SITE_URL}/api/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: b.booking_type === 'club' ? 'booking_status' : 'mob_booking_status',
          bookingId: b.id,
          requesterUserId: b.requester_id,
          requesterName: b.requester_name,
          status: 'denied',
          eventDate: b.event_date,
          venueName: b.venue_name,
          packageTitle: b.package_title,
          declineReason: AUTO_REASON,
        }),
      });
    } catch { /* email is best-effort — the decline itself already stuck */ }
  }

  return NextResponse.json({ ok: true, checked: rows.length, declined });
}
