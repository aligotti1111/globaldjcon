// /cancel/[token] — answer a cancellation request without logging in.
//
// The host has no account. The token in this URL is the credential, the same
// capability-URL pattern as /planner/[id]. Read with the admin client, because
// there is no session to read with.
//
// Nothing here is destructive on load. Opening the link shows the request and
// two buttons; the booking only changes when one of them is pressed, and
// accepting asks a second time before it does anything. A cancellation is worth
// one more click.

import { notFound } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import CancelResponder from './CancelResponder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A cancellation link should never turn up in a search result.
export const metadata = {
  title: 'Cancellation Request — Global DJ Connect',
  robots: { index: false, follow: false },
};

interface Row {
  id: string;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue_name: string | null;
  event_type: string | null;
  dj_id: string | null;
  requester_name: string | null;
  phone: string | null;
  status: string | null;
  cancel_status: string | null;
  cancel_requested_by: string | null;
  cancel_reason: string | null;
  cancel_token_expires_at: string | null;
  contract_status: string | null;
}

function fmtDate(d: string | null): string {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00`);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtTime(t: string | null): string {
  if (!t) return '';
  const [hRaw, m] = t.split(':');
  const h = Number(hRaw);
  if (!Number.isFinite(h)) return '';
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m || '00'} ${ampm}`;
}

export default async function CancelPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data } = await admin
    .from('bookings')
    .select(
      'id, event_date, start_time, end_time, venue_name, event_type, dj_id, requester_name, phone, status, cancel_status, cancel_requested_by, cancel_reason, cancel_token_expires_at, contract_status',
    )
    .eq('cancel_token', token)
    .maybeSingle<Row>();

  if (!data) notFound();

  const expired =
    !!data.cancel_token_expires_at &&
    new Date(data.cancel_token_expires_at).getTime() < Date.now();

  // Who asked, and therefore who this page is talking to.
  const askedBy: 'dj' | 'host' = data.cancel_requested_by === 'dj' ? 'dj' : 'host';

  // The other party's name + number, for the "talk to them" prompt. Only what
  // exists gets shown — no phone on file means no contact line at all.
  let otherName = askedBy === 'dj' ? 'your DJ' : 'the host';
  let otherPhone: string | null = null;
  if (askedBy === 'dj' && data.dj_id) {
    const { data: dj } = await admin
      .from('users')
      .select('name, phone')
      .eq('id', data.dj_id)
      .maybeSingle<{ name: string | null; phone: string | null }>();
    if (dj?.name) otherName = dj.name;
    if (dj?.phone) otherPhone = dj.phone;
  } else if (askedBy === 'host') {
    if (data.requester_name) otherName = data.requester_name;
    if (data.phone) otherPhone = data.phone;
  }

  // A contract only gets mentioned when one actually exists. 'cancelled' and
  // 'voided' don't count — there is nothing left to not-void.
  const cs = data.contract_status;
  const hasContract = !!cs && cs !== 'cancelled' && cs !== 'voided';

  const timeRange = [fmtTime(data.start_time), fmtTime(data.end_time)]
    .filter(Boolean)
    .join(' – ');

  return (
    <CancelResponder
      token={token}
      alreadyResolved={
        data.status === 'cancelled'
          ? 'cancelled'
          : data.cancel_status !== 'requested'
            ? 'answered'
            : null
      }
      expired={expired}
      askedBy={askedBy}
      reason={data.cancel_reason}
      otherName={otherName}
      otherPhone={otherPhone}
      hasContract={hasContract}
      eventDate={fmtDate(data.event_date)}
      timeRange={timeRange}
      venueName={data.venue_name}
    />
  );
}
