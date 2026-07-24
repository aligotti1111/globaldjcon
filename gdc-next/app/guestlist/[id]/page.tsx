// /guestlist/[id] — the host's read-only guest list. No login; UUID capability.
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeGuests } from '@/lib/guestlist';
import GuestlistView from './GuestlistView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Guest List — Global DJ Connect', robots: { index: false, follow: false } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function GuestlistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const db = createAdminClient() as unknown as SupabaseClient;
  const { data: gData } = await db.from('booking_guestlists').select('id, booking_id, dj_id, guests, logo_hidden').eq('id', id).maybeSingle();
  const gl = gData as unknown as { id: string; booking_id: string; dj_id: string; guests: unknown; logo_hidden: boolean | null } | null;
  if (!gl) notFound();
  const { data: bData } = await db.from('bookings').select('event_date, start_time, end_time, venue_name, venue_address, venue_type').eq('id', gl.booking_id).maybeSingle();
  const b = bData as unknown as { event_date: string | null; start_time: string | null; end_time: string | null; venue_name: string | null; venue_address: string | null; venue_type: string | null } | null;
  const { data: djData } = await db.from('users').select('name, contract_logo_url').eq('id', gl.dj_id).maybeSingle();
  const dj = djData as unknown as { name?: string | null; contract_logo_url?: string | null } | null;
  const logo = gl.logo_hidden ? null : (dj?.contract_logo_url || null);
  return (
    <GuestlistView
      guests={normalizeGuests(gl.guests)}
      djName={dj?.name || 'Your DJ'}
      logoUrl={logo}
      eventDate={b?.event_date || null}
      startTime={b?.start_time || null}
      endTime={b?.end_time || null}
      eventType={b?.venue_type || null}
      venueName={b?.venue_name || null}
      venueAddress={b?.venue_address || null}
    />
  );
}
