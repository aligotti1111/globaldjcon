'use server';

// Admin "All Bookings" server actions. Every export calls requireAdmin() first,
// then uses the service-role client to read across ALL DJs (bypassing RLS).
//
//   searchAdminBookings(query) — list/search bookings by DJ name/email or host
//     name/email (empty query → most recent bookings).
//   getAdminBookingDetail(id)  — one booking + DJ/host info + a read-only pipeline
//     and the field values the admin edit modal needs.
//
// Editing itself is NOT done here — the admin UI posts to /api/bookings/edit with
// { admin:true }, which applies changes immediately and emails NO ONE.

import { requireAdmin } from '@/lib/supabase/admin-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildHostPipeline, type HostStep } from '@/lib/hostPipeline';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AdminBookingRow {
  id: string;
  djId: string | null;
  djName: string;
  djEmail: string;
  djSlug: string | null;
  hostName: string;
  hostEmail: string;
  eventType: string | null;
  eventDate: string | null;
  startTime: string | null;
  endTime: string | null;
  venueName: string | null;
  packageTitle: string | null;
  bookingType: 'club' | 'mobile' | null;
  status: string | null;
  contractStatus: string | null;
  createdAt: string | null;
}

export interface AdminBookingDetail extends AdminBookingRow {
  guestCount: string;
  venueType: string | null;
  roomDetails: string | null;
  venueAddress: string | null;
  packageDetails: string | null;
  hasHostAccount: boolean; // requester_id present → host email is their login
  pipeline: HostStep[];
  pipelineDjType: 'club' | 'mobile';
  // Field values keyed exactly as the edit modal expects (EDIT_FIELDS keys + __id).
  editValues: Record<string, string>;
}

// Build a PostgREST ilike value: a double-quoted string (so commas/parens in a
// name don't split the .or() filter list) with the SQL LIKE wildcards escaped.
function likeValue(q: string): string {
  const sql = q.replace(/[\\%_]/g, (c) => `\\${c}`); // escape LIKE wildcards
  return `"%${sql.replace(/[\\"]/g, (c) => `\\${c}`)}%"`; // quote + escape quotes
}

function toRow(
  b: Record<string, unknown>,
  dj: { name: string | null; email: string | null; slug: string | null } | undefined,
): AdminBookingRow {
  const bt = b.booking_type === 'club' ? 'club' : b.booking_type === 'mobile' ? 'mobile' : null;
  return {
    id: String(b.id),
    djId: (b.dj_id as string) ?? null,
    djName: dj?.name || '—',
    djEmail: dj?.email || '—',
    djSlug: dj?.slug ?? null,
    hostName: (b.requester_name as string) || '—',
    hostEmail: (b.host_email as string) || '—',
    eventType: (b.event_type as string) ?? null,
    eventDate: (b.event_date as string) ?? null,
    startTime: (b.start_time as string) ?? null,
    endTime: (b.end_time as string) ?? null,
    venueName: (b.venue_name as string) ?? null,
    packageTitle: (b.package_title as string) ?? null,
    bookingType: bt,
    status: (b.status as string) ?? null,
    contractStatus: (b.contract_status as string) ?? null,
    createdAt: (b.created_at as string) ?? null,
  };
}

const LIST_COLS =
  'id, dj_id, requester_name, host_email, event_type, event_date, start_time, end_time, venue_name, package_title, booking_type, status, contract_status, created_at';

export async function searchAdminBookings(query: string): Promise<AdminBookingRow[]> {
  await requireAdmin();
  const admin = createAdminClient() as unknown as SupabaseClient;
  const q = (query || '').trim();

  // Users whose name/email matches the term — these can be the booking's DJ
  // (dj_id) OR an account host (requester_id). Capped so the id list stays a
  // sane URL length.
  let matchedUserIds: string[] = [];
  if (q) {
    const term = likeValue(q);
    const { data: us } = await admin
      .from('users')
      .select('id')
      .or(`name.ilike.${term},email.ilike.${term},contact_email.ilike.${term}`)
      .limit(120);
    matchedUserIds = ((us as { id: string }[] | null) || []).map((u) => u.id);
  }

  let qb = admin.from('bookings').select(LIST_COLS).order('created_at', { ascending: false }).limit(150);
  if (q) {
    const term = likeValue(q);
    const ors = [`requester_name.ilike.${term}`, `host_email.ilike.${term}`];
    if (matchedUserIds.length) {
      ors.push(`dj_id.in.(${matchedUserIds.join(',')})`); // DJ name/email match
      ors.push(`requester_id.in.(${matchedUserIds.join(',')})`); // account-host match
    }
    qb = qb.or(ors.join(','));
  }
  const { data: rows } = await qb;
  const bookings = (rows as Record<string, unknown>[] | null) || [];

  // Fetch the DJ user rows for the bookings in one query, then map.
  const ids = Array.from(new Set(bookings.map((b) => b.dj_id).filter(Boolean))) as string[];
  const djMap = new Map<string, { name: string | null; email: string | null; slug: string | null }>();
  if (ids.length) {
    const { data: djUsers } = await admin.from('users').select('id, name, email, slug').in('id', ids);
    for (const u of (djUsers as { id: string; name: string | null; email: string | null; slug: string | null }[] | null) || []) {
      djMap.set(u.id, { name: u.name, email: u.email, slug: u.slug });
    }
  }
  return bookings.map((b) => toRow(b, djMap.get(String(b.dj_id))));
}

export async function getAdminBookingDetail(bookingId: string): Promise<AdminBookingDetail | null> {
  await requireAdmin();
  const admin = createAdminClient() as unknown as SupabaseClient;

  const { data: b } = await admin
    .from('bookings')
    .select(
      'id, dj_id, requester_id, requester_name, host_email, event_type, guest_count, event_date, start_time, end_time, venue_name, venue_type, room_details, venue_address, package_title, package_details, booking_type, status, contract_status, deposit_pct, deposit_amount, planner_status, status_overrides, created_at',
    )
    .eq('id', bookingId)
    .maybeSingle<Record<string, unknown>>();
  if (!b) return null;

  const dj = b.dj_id
    ? (await admin.from('users').select('name, email, slug').eq('id', b.dj_id).maybeSingle<{ name: string | null; email: string | null; slug: string | null }>()).data
    : null;

  // ── Pipeline signals (read-only) ──
  const { data: pays } = await admin.from('booking_payments').select('kind, status').eq('booking_id', bookingId);
  const payments = (pays as { kind: string; status: string }[] | null) || [];
  const settled = (s: string) => s === 'paid' || s === 'waived' || s === 'confirmed';
  const deposits = payments.filter((p) => p.kind === 'deposit');
  const balances = payments.filter((p) => p.kind === 'balance');
  const overrides = (b.status_overrides as Record<string, boolean> | null) || {};
  const bt = b.booking_type === 'club' ? 'club' : b.booking_type === 'mobile' ? 'mobile' : null;

  let riderConfirmed = false;
  let guestlistConfirmed = false;
  if (bt === 'club') {
    const { data: rd } = await admin.from('booking_riders').select('confirmed_at').eq('booking_id', bookingId).maybeSingle<{ confirmed_at: string | null }>();
    riderConfirmed = !!rd?.confirmed_at;
    const { data: gl } = await admin.from('booking_guestlists').select('confirmed_at').eq('booking_id', bookingId).maybeSingle<{ confirmed_at: string | null }>();
    guestlistConfirmed = !!gl?.confirmed_at;
  }

  const pipeline = buildHostPipeline({
    bookingType: bt,
    contractStatus: overrides.contract ? 'signed' : ((b.contract_status as string) ?? null),
    hasDeposit: b.deposit_pct != null || b.deposit_amount != null || deposits.length > 0 || !!overrides.deposit,
    depositPaid: (deposits.length > 0 && deposits.every((p) => settled(p.status))) || !!overrides.deposit,
    plannerStatus: (b.planner_status as 'sent' | 'partial' | 'submitted' | null) ?? null,
    riderConfirmed,
    guestlistConfirmed,
    hasBalance: balances.length > 0 || !!overrides.invoice,
    balancePaid: (balances.length > 0 && balances.every((p) => settled(p.status))) || !!overrides.invoice,
  });

  const str = (v: unknown) => (v == null ? '' : String(v));
  const editValues: Record<string, string> = {
    __id: String(b.id),
    event_type: str(b.event_type),
    guest_count: str(b.guest_count),
    event_date: str(b.event_date).slice(0, 10),
    start_time: str(b.start_time),
    end_time: str(b.end_time),
    venue_name: str(b.venue_name),
    venue_type: str(b.venue_type),
    room_details: str(b.room_details),
    venue_address: str(b.venue_address),
    requester_name: str(b.requester_name),
    host_email: str(b.host_email),
    package_title: str(b.package_title),
    package_details: str(b.package_details),
  };

  const row = toRow(b, dj || undefined);
  return {
    ...row,
    guestCount: str(b.guest_count),
    venueType: (b.venue_type as string) ?? null,
    roomDetails: (b.room_details as string) ?? null,
    venueAddress: (b.venue_address as string) ?? null,
    packageDetails: (b.package_details as string) ?? null,
    hasHostAccount: !!b.requester_id,
    pipeline,
    pipelineDjType: bt === 'club' ? 'club' : 'mobile',
    editValues,
  };
}
