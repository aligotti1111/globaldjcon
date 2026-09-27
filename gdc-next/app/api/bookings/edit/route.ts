// POST /api/bookings/edit  — the DJ (OWNER ONLY) edits a booking's details from
// the upcoming-bookings card.
//
// Two tiers (see lib/bookingEditFields.ts):
//   • notify  — applied immediately; bookings.field_edits stamps an "Edited"
//               badge; the host gets an FYI email.
//   • approve — NOT applied. A booking_change_requests row is created with an
//               unguessable token; the host gets an approve/decline link; the
//               card shows "Pending change" until they respond.
//
// Legal: this never dismisses either party's obligations — both must mutually
// agree and Global DJ Connect is not responsible for enforcement. That copy is
// shown in the UI and repeated in the host email.
//
// Body: { bookingId: string, changes: Record<fieldKey, string> }
// Returns: { ok, applied: string[], pending: {field,label}[], field_edits }

import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import { getActingContext, canBilling } from '@/lib/acting';
import { EDIT_FIELD_BY_KEY } from '@/lib/bookingEditFields';
import { Resend } from 'resend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const SITE_URL = 'https://globaldjconnect.com';

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
function shell(content: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background:#000;padding:24px 32px;" align="center"><div style="font-family:Impact,Arial,sans-serif;font-size:28px;letter-spacing:.06em;color:#00f5c4;font-weight:700;">GLOBAL DJ CONNECT</div></td></tr>
<tr><td style="padding:32px;">${content}</td></tr>
<tr><td style="background:#f8f8f8;padding:20px 32px;text-align:center;border-top:1px solid #e0e0e0;"><p style="margin:0;color:#888;font-size:11px;">© ${new Date().getFullYear()} Global DJ Connect · globaldjconnect.com</p></td></tr>
</table></td></tr></table>`;
}
const LEGAL = 'This change does not legally cancel or modify either party’s existing obligations. Any change must be mutually agreed upon by both parties. Global DJ Connect is not responsible for enforcing this booking or any changes to it.';

function fmtDate(d: string | null): string {
  if (!d) return '—';
  try { return new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); } catch { return String(d); }
}
function fmtTime(t: string | null): string {
  if (!t) return '—';
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t));
  if (!m) return String(t);
  let h = parseInt(m[1], 10); const mm = m[2]; const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12; return `${h}:${mm} ${ap}`;
}

interface BookingRow {
  id: string; dj_id: string | null; requester_id: string | null; requester_name: string | null;
  host_email: string | null; phone: string | null;
  event_type: string | null; guest_count: number | null; event_date: string | null;
  start_time: string | null; end_time: string | null;
  venue_name: string | null; venue_type: string | null; room_details: string | null; venue_address: string | null;
  package_title: string | null; package_details: string | null;
  counter_rate: number | null; quoted_rate: number | null; offer_amount: number | null; currency: string | null;
  contract_status: string | null; field_edits: Record<string, string> | null;
}

// Display value for a field's CURRENT stored value (for the "was → now" line).
function displayOld(f: string, b: BookingRow): string {
  switch (f) {
    case 'event_date': return fmtDate(b.event_date);
    case 'start_time': return fmtTime(b.start_time);
    case 'end_time': return fmtTime(b.end_time);
    case 'price': { const p = b.counter_rate ?? b.quoted_rate ?? b.offer_amount; return p != null ? `${b.currency || 'USD'} ${p}` : '—'; }
    case 'guest_count': return b.guest_count != null ? String(b.guest_count) : '—';
    case 'venue_name': return b.venue_name || '—';
    case 'venue_type': return b.venue_type || '—';
    case 'room_details': return b.room_details || '—';
    case 'venue_address': return b.venue_address || '—';
    case 'requester_name': return b.requester_name || '—';
    case 'phone': return b.phone || '—';
    case 'package_title': return b.package_title || '—';
    case 'package_details': return (b.package_details || '—').replace(/<[^>]+>/g, ' ').trim() || '—';
    case 'event_type': return b.event_type || '—';
    default: return '—';
  }
}
function displayNew(f: string, raw: string, cur: string | null): string {
  switch (f) {
    case 'event_date': return fmtDate(raw);
    case 'start_time': case 'end_time': return fmtTime(raw);
    case 'price': return `${cur || 'USD'} ${raw}`;
    default: return raw || '—';
  }
}

// GET /api/bookings/edit?bookingId=… — the card's badge state: which fields
// carry an "Edited" mark (field_edits) and which have a pending approval.
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const acting = await getActingContext(user.id);
  if (!canBilling(acting.role)) return NextResponse.json({ ok: true, field_edits: {}, pending: [] });
  const bookingId = new URL(req.url).searchParams.get('bookingId');
  if (!bookingId) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: b } = await admin.from('bookings').select('dj_id, field_edits').eq('id', bookingId).maybeSingle<{ dj_id: string | null; field_edits: Record<string, string> | null }>();
  if (!b || b.dj_id !== acting.djId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { data: pend } = await admin.from('booking_change_requests').select('target_col, field, new_value').eq('booking_id', bookingId).eq('status', 'pending');
  // Full per-field history (newest first) — drives the change-history dropdown
  // when a field has been changed more than once.
  const { data: hist } = await admin
    .from('booking_change_requests')
    .select('target_col, field, old_value, new_value, status, created_at, responded_at')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false });
  return NextResponse.json({
    ok: true,
    field_edits: b.field_edits || {},
    pending: (pend || []) as { target_col: string; field: string; new_value: string }[],
    history: (hist || []) as { target_col: string; field: string; old_value: string | null; new_value: string | null; status: string; created_at: string; responded_at: string | null }[],
  });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  // OWNER ONLY.
  const acting = await getActingContext(user.id);
  if (!canBilling(acting.role)) return NextResponse.json({ error: 'Only the account owner can edit booking details.' }, { status: 403 });
  const djId = acting.djId;

  const body = (await req.json().catch(() => ({}))) as { bookingId?: string; changes?: Record<string, string> };
  const bookingId = body.bookingId;
  const changes = body.changes || {};
  if (!bookingId || typeof changes !== 'object') return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: bData } = await admin
    .from('bookings')
    .select('id, dj_id, requester_id, requester_name, host_email, phone, event_type, guest_count, event_date, start_time, end_time, venue_name, venue_type, room_details, venue_address, package_title, package_details, counter_rate, quoted_rate, offer_amount, currency, contract_status, field_edits')
    .eq('id', bookingId)
    .maybeSingle<BookingRow>();
  if (!bData || bData.dj_id !== djId) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  const booking = bData;

  const applyObj: Record<string, unknown> = {};
  const editStamp: Record<string, string> = { ...(booking.field_edits || {}) };
  const nowISO = new Date().toISOString();
  const appliedLines: { label: string; old: string; neu: string; col: string }[] = [];
  const pendingRows: { booking_id: string; dj_id: string; field: string; old_value: string; new_value: string; target_col: string; target_raw: string; token: string }[] = [];
  const pendingReturn: { field: string; label: string }[] = [];

  for (const [key, rawVal] of Object.entries(changes)) {
    const def = EDIT_FIELD_BY_KEY[key];
    if (!def) continue;
    const val = typeof rawVal === 'string' ? rawVal.trim() : String(rawVal ?? '');
    const oldDisp = displayOld(key, booking);
    const newDisp = displayNew(key, val, booking.currency);
    if (oldDisp === newDisp) continue; // no real change

    if (def.tier === 'notify') {
      // guest_count is numeric; everything else stores as text/null.
      applyObj[def.col] = def.kind === 'number' ? (val === '' ? null : Number(val)) : (val === '' ? null : val);
      editStamp[def.col] = nowISO;
      appliedLines.push({ label: def.label, old: oldDisp, neu: newDisp, col: def.col });
    } else {
      pendingRows.push({
        booking_id: booking.id, dj_id: djId, field: def.label,
        old_value: oldDisp, new_value: newDisp,
        target_col: def.col, target_raw: val,
        token: randomBytes(24).toString('base64url'),
      });
      pendingReturn.push({ field: key, label: def.label });
    }
  }

  if (appliedLines.length === 0 && pendingRows.length === 0) {
    return NextResponse.json({ ok: true, applied: [], pending: [], field_edits: booking.field_edits || {} });
  }

  // Apply the notify-only tier immediately.
  if (appliedLines.length > 0) {
    applyObj.field_edits = editStamp;
    const { error } = await admin.from('bookings').update(applyObj as unknown as never).eq('id', booking.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
    // Record each applied change as history too (status 'applied'), so a field
    // changed more than once shows a full dropdown of its changes.
    const appliedRows = appliedLines.map((l) => ({
      booking_id: booking.id, dj_id: djId, field: l.label,
      old_value: l.old, new_value: l.neu, target_col: l.col, target_raw: null,
      status: 'applied', token: randomBytes(24).toString('base64url'),
    }));
    await admin.from('booking_change_requests').insert(appliedRows as unknown as never);
  }
  // Supersede any earlier still-pending request for the same field, then insert.
  if (pendingRows.length > 0) {
    for (const r of pendingRows) {
      await admin.from('booking_change_requests').update({ status: 'superseded', responded_at: nowISO } as unknown as never)
        .eq('booking_id', booking.id).eq('target_col', r.target_col).eq('status', 'pending');
    }
    const { error } = await admin.from('booking_change_requests').insert(pendingRows as unknown as never);
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  }

  // ── Email the host ──
  const hostEmail = booking.requester_id ? await resolveUserEmail(booking.requester_id) : (booking.host_email || null);
  if (hostEmail && process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const djName = (async () => (await admin.from('users').select('name').eq('id', djId).maybeSingle<{ name: string | null }>()).data?.name || 'Your DJ');
      const dj = await djName();
      const line = (l: { label: string; old: string; neu: string }) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;color:#111;"><b>${esc(l.label)}</b><br><span style="color:#888;font-size:13px;">${esc(l.old)}</span> → <span style="color:#0a6f61;font-weight:700;">${esc(l.neu)}</span></td></tr>`;
      let content = `<h1 style="margin:0 0 12px;font-size:20px;color:#111;">${esc(dj)} updated your booking</h1>`;
      if (appliedLines.length) {
        content += `<p style="margin:0 0 6px;color:#333;font-size:15px;">These details were updated:</p><table width="100%" cellpadding="0" cellspacing="0">${appliedLines.map(line).join('')}</table>`;
      }
      if (pendingRows.length) {
        const plines = pendingRows.map((r) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;color:#111;"><b>${esc(r.field)}</b><br><span style="color:#888;font-size:13px;">${esc(r.old_value)}</span> → <span style="color:#b0791f;font-weight:700;">${esc(r.new_value)}</span></td></tr>`).join('');
        const link = `${SITE_URL}/change/${pendingRows[0].token}`;
        content += `<p style="margin:18px 0 6px;color:#333;font-size:15px;"><b>These changes need your approval</b> before they take effect:</p><table width="100%" cellpadding="0" cellspacing="0">${plines}</table>
<table cellpadding="0" cellspacing="0" border="0" style="margin:20px auto 4px;"><tr><td style="background:#0a6f61;border-radius:6px;"><a href="${link}" style="display:inline-block;padding:12px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">Review &amp; respond</a></td></tr></table>`;
      }
      content += `<p style="margin:20px 0 0;color:#999;font-size:11px;line-height:1.5;border-top:1px solid #eee;padding-top:12px;">${esc(LEGAL)}</p>`;
      await resend.emails.send({ from: FROM, to: hostEmail, subject: `${dj} updated your booking`, html: shell(content) });
    } catch { /* non-fatal — the change already landed */ }
  }

  return NextResponse.json({
    ok: true,
    applied: appliedLines.map((l) => l.label),
    pending: pendingReturn,
    field_edits: editStamp,
    hostEmailed: !!hostEmail,
  });
}
