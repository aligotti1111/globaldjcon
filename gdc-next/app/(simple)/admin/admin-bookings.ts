'use server';

// Admin "All Bookings" server actions. Every export calls requireAdmin() first,
// then uses the service-role client to read across ALL DJs (bypassing RLS).
//
//   searchAdminBookings(query) — list/search bookings by DJ name/email or host
//     name/email (empty query → most recent bookings).
//   getAdminBookingDetail(id)  — one booking + DJ/host info + a read-only pipeline
//     and the field values the admin edit modal needs.
//   updateWeddingExtras(id, …) — admin-only edit of a wedding's ceremony &
//     cocktail-hour fields. Does NOT touch the locked price/total.
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
  // Club/bar bookings carry a venue_type ('bar' | 'club' | 'other'); used by the
  // admin list's Club/Bar sub-filter. Null/absent on mobile bookings.
  venueType: string | null;
  packageTitle: string | null;
  bookingType: 'club' | 'mobile' | null;
  // True when the DJ added this booking by hand (not a host-submitted request).
  isManual: boolean;
  status: string | null;
  contractStatus: string | null;
  createdAt: string | null;
}

export interface AdminBookingDetail extends AdminBookingRow {
  guestCount: string;
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
    venueType: (b.venue_type as string) ?? null,
    packageTitle: (b.package_title as string) ?? null,
    bookingType: bt,
    isManual: b.is_manual === true,
    status: (b.status as string) ?? null,
    contractStatus: (b.contract_status as string) ?? null,
    createdAt: (b.created_at as string) ?? null,
  };
}

const LIST_COLS =
  'id, dj_id, requester_id, requester_name, host_email, event_type, event_date, start_time, end_time, venue_name, venue_type, package_title, booking_type, is_manual, status, contract_status, created_at';

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
  let bookings = (rows as Record<string, unknown>[] | null) || [];

  // Exclude bookings that were BOOKED BY A DJ (the requester/host is a DJ
  // account) — those are DJs booking each other, which clutter the admin list
  // and made a DJ show up as a "host" under another DJ's type. Keep every
  // booking with no requester (manual) or a non-DJ host.
  {
    const { data: djUsers } = await admin.from('users').select('id').eq('role', 'dj').limit(2000);
    const djIdSet = new Set(((djUsers as { id: string }[] | null) || []).map((u) => u.id));
    if (djIdSet.size) {
      bookings = bookings.filter((b) => {
        const rid = b.requester_id as string | null | undefined;
        return !rid || !djIdSet.has(rid);
      });
    }
  }

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

  // Everything past the core booking row is ENRICHMENT — the DJ profile, the
  // parsed settings, the payment/planner/rider reads. Any one of them failing
  // (a malformed settings blob, a transient read error, an unexpected row shape)
  // must NOT null the whole detail and show "Could not load this booking." Wrap
  // it all and fall back to safe defaults so the booking always opens.
  let dj: Record<string, unknown> | null = null;
  let djType: 'club' | 'mobile' = b.booking_type === 'club' ? 'club' : 'mobile';
  let canPro = false;
  let riderEnabled = false;
  let guestlistEnabled = false;
  let needsContract = (b.requires_contract as boolean | null) ?? false;
  let taxPct = 0;
  let payments: BookingPayment[] = [];
  let planner: BookingPlannerSummary | null = null;
  try {
    dj = b.dj_id
      ? (await admin
          .from('users')
          .select('name, email, slug, dj_type, booking_settings, sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, comp_source')
          .eq('id', b.dj_id)
          .maybeSingle<Record<string, unknown>>()).data
      : null;

    djType = dj?.dj_type === 'club' ? 'club' : 'mobile';
    const settings = (() => {
      try {
        const raw = dj?.booking_settings as unknown;
        if (typeof raw === 'string') return parseBookingSettings(raw);
        return (raw as ReturnType<typeof parseBookingSettings> | null) || null;
      } catch { return null; }
    })();
    const s = (settings || {}) as Record<string, unknown>;
    canPro = dj ? canUsePro(dj as unknown as Parameters<typeof canUsePro>[0]) : false;
    riderEnabled = !!s.rider_enabled;
    guestlistEnabled = !!s.guestlist_enabled;
    needsContract = (b.requires_contract as boolean | null) ?? !!s.require_contract;
    taxPct = (() => { if (!s.tax_enabled) return 0; const t = Number(s.tax_pct); return Number.isFinite(t) && t > 0 ? t : 0; })();

    // Full payment rows — buildBookingSteps needs amount/amount_paid/method/
    // client_intent, not just kind/status, to compute partials and the rails.
    const { data: pays } = await admin
      .from('booking_payments')
      .select('id, booking_id, kind, label, amount, amount_paid, currency, status, method, client_intent, due_date, requested_at, marked_sent_at, confirmed_at')
      .eq('booking_id', bookingId)
      .order('requested_at', { ascending: true });
    payments = (pays as unknown as BookingPayment[] | null) || [];

    // Planner summary (mobile) — same fraction the DJ's row shows. limit(1), not
    // maybeSingle: a booking can have >1 planner row, and maybeSingle THROWS on
    // >1. Take the first row.
    const { data: pls } = await admin
      .from('booking_planners')
      .select('id, status, fields, responses')
      .eq('booking_id', bookingId)
      .limit(1);
    const pl = ((pls as { id: string; status: 'sent' | 'partial' | 'submitted'; fields: unknown; responses: unknown }[] | null) || [])[0];
    if (pl) {
      const { answered, total } = plannerProgress(
        (pl.fields as Parameters<typeof plannerProgress>[0]) || [],
        (pl.responses as Parameters<typeof plannerProgress>[1]) || {},
      );
      planner = { id: pl.id, status: pl.status, answered, total };
    }

    // Club rider "sent" + guest-list confirmation. limit(1) for the same
    // throw-on-duplicate reason as the planner read above.
    if (djType === 'club') {
      const { data: rds } = await admin.from('booking_riders').select('id, confirmed_at').eq('booking_id', bookingId).limit(1);
      (b as Record<string, unknown>).__riderSent = (((rds as unknown[] | null) || []).length > 0);
      const { data: gls } = await admin.from('booking_guestlists').select('confirmed_at').eq('booking_id', bookingId).limit(1);
      const gl = ((gls as { confirmed_at: string | null }[] | null) || [])[0];
      if (gl?.confirmed_at) (b as Record<string, unknown>).guestlist_confirmed_at = gl.confirmed_at;
    }
  } catch {
    // Enrichment failed — the booking still opens with safe defaults above.
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

// What the admin ceremony/cocktail editor sends. All optional — only the fields
// the admin touched. Times are "HH:MM" (or ''), prices numbers (or null).
export interface WeddingExtrasInput {
  ceremony_needed?: boolean;
  ceremony_start_time?: string | null;
  ceremony_same_room?: boolean;
  ceremony_price?: number | null;
  ceremony_included?: boolean;
  cocktail_needed?: boolean;
  cocktail_start_time?: string | null;
  cocktail_same_room?: boolean;
  cocktail_price?: number | null;
  cocktail_included?: boolean;
}

// Admin-only: update a wedding's ceremony + cocktail-hour fields. Does NOT touch
// the locked price/total (ceremony/cocktail prices are stored as the per-item
// snapshot only). Applies immediately, emails NO ONE.
export async function updateWeddingExtras(bookingId: string, input: WeddingExtrasInput): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const admin = createAdminClient() as unknown as SupabaseClient;

  const { data: b } = await admin.from('bookings').select('id, event_type').eq('id', bookingId).maybeSingle<{ id: string; event_type: string | null }>();
  if (!b) return { ok: false, error: 'Booking not found.' };

  // Build the update from only the keys provided. Normalize empty strings to
  // null for the time/price columns so a cleared field clears the column.
  const upd: Record<string, unknown> = {};
  const setBool = (k: keyof WeddingExtrasInput) => { if (input[k] !== undefined) upd[k] = !!input[k]; };
  const setTime = (k: keyof WeddingExtrasInput) => { if (input[k] !== undefined) { const v = String(input[k] ?? '').trim(); upd[k] = v || null; } };
  const setPrice = (k: keyof WeddingExtrasInput) => {
    if (input[k] !== undefined) { const n = Number(input[k]); upd[k] = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; }
  };
  setBool('ceremony_needed'); setTime('ceremony_start_time'); setBool('ceremony_same_room'); setPrice('ceremony_price'); setBool('ceremony_included');
  setBool('cocktail_needed'); setTime('cocktail_start_time'); setBool('cocktail_same_room'); setPrice('cocktail_price'); setBool('cocktail_included');

  if (Object.keys(upd).length === 0) return { ok: true };

  const { error } = await admin.from('bookings').update(upd as never).eq('id', bookingId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
