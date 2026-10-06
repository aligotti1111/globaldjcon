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
import { canUsePro } from '@/lib/access';
import { parseBookingSettings } from '@/app/(main)/[slug]/bookingSettings';
import { plannerProgress } from '@/lib/planner';
import type { BookingPayment, BookingPlannerSummary } from '@/app/(main)/upcoming-bookings/page';
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
  djType: 'club' | 'mobile';
  // Everything the DJ's own pipeline builder (buildBookingSteps) needs. The
  // steps themselves are built CLIENT-SIDE (they carry action handlers that
  // can't cross the server boundary), so the admin view renders the exact same
  // pipeline the DJ sees — read-only.
  rawBooking: Record<string, unknown>;
  payments: BookingPayment[];
  planner: BookingPlannerSummary | null;
  flags: { canPro: boolean; riderEnabled: boolean; guestlistEnabled: boolean; needsContract: boolean; taxPct: number };
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

  // The FULL booking row — the DJ's own pipeline builder (buildBookingSteps)
  // reads ~40 columns off it (deposit snapshot, contract stamps, overrides,
  // tax snapshot, overtime, cancel state…). Selecting '*' is simpler and
  // safer than trying to enumerate every column the builder might touch.
  const { data: b } = await admin
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .maybeSingle<Record<string, unknown>>();
  if (!b) return null;

  // The DJ owning this booking — name/email/slug for the row header, plus the
  // subscription + settings fields the pipeline needs (canPro, tax, deposit,
  // contract requirement, rider/guestlist enabled). parseBookingSettings reads
  // the same JSON string the DJ's own page does.
  const dj = b.dj_id
    ? (await admin
        .from('users')
        .select('name, email, slug, dj_type, booking_settings, sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, comp_source')
        .eq('id', b.dj_id)
        .maybeSingle<Record<string, unknown>>()).data
    : null;

  const djType: 'club' | 'mobile' = dj?.dj_type === 'club' ? 'club' : 'mobile';
  const settings = (() => {
    const raw = dj?.booking_settings as unknown;
    if (typeof raw === 'string') return parseBookingSettings(raw);
    return (raw as ReturnType<typeof parseBookingSettings> | null) || null;
  })();
  const s = (settings || {}) as Record<string, unknown>;
  const canPro = dj ? canUsePro(dj as unknown as Parameters<typeof canUsePro>[0]) : false;
  const riderEnabled = !!s.rider_enabled;
  const guestlistEnabled = !!s.guestlist_enabled;
  const needsContract = (b.requires_contract as boolean | null) ?? !!s.require_contract;
  const taxPct = (() => { if (!s.tax_enabled) return 0; const t = Number(s.tax_pct); return Number.isFinite(t) && t > 0 ? t : 0; })();

  // Full payment rows — buildBookingSteps needs amount/amount_paid/method/
  // client_intent, not just kind/status, to compute partials and the rails.
  const { data: pays } = await admin
    .from('booking_payments')
    .select('id, booking_id, kind, label, amount, amount_paid, currency, status, method, client_intent, due_date, requested_at, marked_sent_at, confirmed_at')
    .eq('booking_id', bookingId)
    .order('requested_at', { ascending: true });
  const payments = (pays as unknown as BookingPayment[] | null) || [];

  // Planner summary (mobile) — same fraction the DJ's row shows.
  let planner: BookingPlannerSummary | null = null;
  {
    const { data: pl } = await admin
      .from('booking_planners')
      .select('id, status, fields, responses')
      .eq('booking_id', bookingId)
      .maybeSingle<{ id: string; status: 'sent' | 'partial' | 'submitted'; fields: unknown; responses: unknown }>();
    if (pl) {
      const { answered, total } = plannerProgress(
        (pl.fields as Parameters<typeof plannerProgress>[0]) || [],
        (pl.responses as Parameters<typeof plannerProgress>[1]) || {},
      );
      planner = { id: pl.id, status: pl.status, answered, total };
    }
  }

  // Club rider "sent" + guest-list confirmation, read straight from their
  // tables (the DJ's row gets riderSent from send-state it tracks live; here we
  // approximate it from whether a rider row exists, which is read-only-correct).
  if (djType === 'club') {
    const { data: rd } = await admin.from('booking_riders').select('id, confirmed_at').eq('booking_id', bookingId).maybeSingle<{ id: string; confirmed_at: string | null }>();
    // riderSent rides along on rawBooking so the client needn't re-query — the
    // DJ's row gets this from live send-state; here it's whether a rider exists.
    (b as Record<string, unknown>).__riderSent = !!rd;
    const { data: gl } = await admin.from('booking_guestlists').select('confirmed_at').eq('booking_id', bookingId).maybeSingle<{ confirmed_at: string | null }>();
    if (gl?.confirmed_at) (b as Record<string, unknown>).guestlist_confirmed_at = gl.confirmed_at;
  }

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

  const row = toRow(b, dj ? { name: dj.name as string | null, email: dj.email as string | null, slug: dj.slug as string | null } : undefined);
  return {
    ...row,
    guestCount: str(b.guest_count),
    venueType: (b.venue_type as string) ?? null,
    roomDetails: (b.room_details as string) ?? null,
    venueAddress: (b.venue_address as string) ?? null,
    packageDetails: (b.package_details as string) ?? null,
    hasHostAccount: !!b.requester_id,
    djType,
    rawBooking: b,
    payments,
    planner,
    flags: { canPro, riderEnabled, guestlistEnabled, needsContract, taxPct },
    editValues,
  };
}
