// /rider/[id] — the host's read-only view of the DJ's rider.
//
// NO LOGIN. The rider id is an unguessable UUID — a capability URL, exactly
// like the planner link and the DocuSeal signing link we already email. It
// exposes this booking's rider to whoever holds it, which is what the email
// containing it already does. Read with the ADMIN client: there's no session.
//
// The host READS this; they don't edit it (it's the DJ's requirements). The DJ
// logo sits on top so it's clearly the DJ's page — same as the planner.

import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeRiderItems } from '@/lib/rider';
import RiderView from './RiderView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'DJ Rider — Global DJ Connect',
  robots: { index: false, follow: false },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RiderRow {
  id: string; booking_id: string; dj_id: string; items: unknown; logo_hidden: boolean | null;
}

export default async function RiderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const db = createAdminClient();
  const { data: rData } = await db
    .from('booking_riders')
    .select('id, booking_id, dj_id, items, logo_hidden')
    .eq('id', id).maybeSingle();
  const rider = rData as unknown as RiderRow | null;
  if (!rider) notFound();

  const { data: bData } = await db
    .from('bookings')
    .select('event_date, venue_name, venue_address')
    .eq('id', rider.booking_id).maybeSingle();
  const b = bData as unknown as { event_date: string | null; venue_name: string | null; venue_address: string | null } | null;

  const { data: djData } = await db
    .from('users').select('name, contract_logo_url').eq('id', rider.dj_id).maybeSingle();
  const dj = djData as unknown as { name?: string | null; contract_logo_url?: string | null } | null;

  const logo = rider.logo_hidden ? null : (dj?.contract_logo_url || null);

  return (
    <RiderView
      items={normalizeRiderItems(rider.items)}
      djName={dj?.name || 'Your DJ'}
      logoUrl={logo}
      eventDate={b?.event_date || null}
      venueName={b?.venue_name || null}
      venueAddress={b?.venue_address || null}
    />
  );
}
