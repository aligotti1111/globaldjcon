// GET /api/calendar/[token](.ics)
//
// A read-only iCalendar feed of ONE DJ's bookings, meant to be SUBSCRIBED to
// once from a phone / desktop calendar (webcal://globaldjconnect.com/api/
// calendar/{token}.ics). The calendar app re-pulls it forever, so new, changed,
// and cancelled bookings flow in automatically on every device.
//
// NO SESSION — a calendar app can't log in. The random `calendar_token` on the
// DJ's users row IS the credential (same model as the planner links), so it's
// unguessable and the DJ can reset it from settings if it ever leaks.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildCalendar, icsDateTime, icsEndDateTime, type CalEvent } from '@/lib/ics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface BookingRow {
  id: string;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue_name: string | null;
  venue_address: string | null;
  event_type: string | null;
  booking_type: string | null;
  requester_name: string | null;
  phone: string | null;
  package_title: string | null;
  total_with_tax: number | null;
  counter_rate: number | null;
  quoted_rate: number | null;
  currency: string | null;
  notes: string | null;
  status: string | null;
  cancel_status: string | null;
  updated_at: string | null;
}

function money(n: number | null | undefined, currency: string | null): string | null {
  if (n == null) return null;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(n);
  } catch {
    return `$${Number(n).toFixed(2)}`;
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token: raw } = await ctx.params;
  // Subscribers append ".ics" to make it look like a file; strip it back off.
  const token = (raw || '').replace(/\.ics$/i, '').trim();
  if (!token || token.length < 12) {
    return new Response('Not found', { status: 404 });
  }

  const admin = createAdminClient();
  // calendar_token postdates the generated types, so the typed client rejects a
  // filter on it — one untyped cast, same house pattern as booking_payments.
  const db = admin as unknown as SupabaseClient;

  const { data: djData } = await db
    .from('users')
    .select('id, name')
    .eq('calendar_token', token)
    .maybeSingle();
  const dj = djData as { id: string; name: string | null } | null;
  if (!dj) return new Response('Not found', { status: 404 });

  // Bookings that belong on a calendar: approved, manually added, or cancelled
  // (cancelled ones are emitted as STATUS:CANCELLED so the calendar removes
  // them). Denied requests never make it here. Look back a year so recent
  // history is present without the feed growing without bound.
  const since = new Date();
  since.setFullYear(since.getFullYear() - 1);
  const sinceStr = since.toISOString().slice(0, 10);

  const { data: rows } = await admin
    .from('bookings')
    .select('id, event_date, start_time, end_time, venue_name, venue_address, event_type, booking_type, requester_name, phone, package_title, total_with_tax, counter_rate, quoted_rate, currency, notes, status, cancel_status, updated_at')
    .eq('dj_id', dj.id)
    .is('deleted_at', null)
    .gte('event_date', sinceStr)
    .or('status.eq.approved,status.eq.cancelled,is_manual.eq.true')
    .order('event_date', { ascending: true })
    .limit(1000);

  const bookings = ((rows as unknown) as BookingRow[] | null) || [];

  const events: CalEvent[] = [];
  for (const b of bookings) {
    if (!b.event_date) continue;
    const startTime = b.start_time || '00:00';
    const summary = `${b.event_type || 'DJ Booking'}${b.venue_name ? ` @ ${b.venue_name}` : ''}`;
    const location = [b.venue_name, b.venue_address].filter(Boolean).join(', ') || null;
    const value = money(b.total_with_tax ?? b.counter_rate ?? b.quoted_rate, b.currency);
    const desc = [
      b.requester_name ? `Client: ${b.requester_name}` : null,
      b.phone ? `Phone: ${b.phone}` : null,
      b.package_title ? `Package: ${b.package_title}` : null,
      value ? `Value: ${value}` : null,
      b.notes ? `Notes: ${b.notes}` : null,
      `https://globaldjconnect.com/upcoming-bookings`,
    ].filter(Boolean).join('\n');
    const cancelled = b.status === 'cancelled' || b.cancel_status === 'accepted';
    // SEQUENCE must climb whenever the booking changes; minutes-since-epoch of
    // updated_at is monotonic and comfortably inside a 32-bit int.
    const seq = b.updated_at ? Math.floor(Date.parse(b.updated_at) / 60000) : 0;

    events.push({
      uid: `booking-${b.id}@globaldjconnect.com`,
      start: icsDateTime(b.event_date, startTime),
      end: icsEndDateTime(b.event_date, startTime, b.end_time),
      summary,
      location,
      description: desc,
      cancelled,
      sequence: Number.isFinite(seq) ? seq : 0,
    });
  }

  const calName = `${dj.name ? `${dj.name} — ` : ''}Global DJ Connect`;
  const ics = buildCalendar(calName, events);

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="globaldjconnect.ics"',
      // Let calendar clients / proxies hold it briefly; the app pulls on its own
      // cadence anyway. Short enough that a reset link takes effect quickly.
      'Cache-Control': 'public, max-age=900, s-maxage=900',
    },
  });
}
