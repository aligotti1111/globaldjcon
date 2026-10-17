// POST /api/bookings/manual   — create a manual booking
// PATCH /api/bookings/manual  — update a manual booking (or patch a field)
//
// Manual bookings used to be written straight from the browser via the
// RLS-bound Supabase client. That works for an owner (dj_id === auth.uid()),
// but a TEAMMATE acting for an owner writes dj_id = owner's id ≠ auth.uid(),
// which the bookings INSERT policy rejects (RLS 42501). Reads already go
// through the admin client + acting context for exactly this reason, so the
// writes now follow the same pattern: authorize via getActingContext, then
// write with the admin client scoped hard to the acting owner's id.

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext, canAcceptBookings } from '@/lib/acting';
import { logActivity } from '@/lib/activityLog';

export const runtime = 'nodejs';
export const maxDuration = 26;

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const CHANGE_LEGAL = 'This change does not legally cancel or modify either party’s existing obligations. Any change must be mutually agreed upon by both parties. Global DJ Connect is not responsible for enforcing this booking or any changes to it.';

function escHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
function fmtDateLong(d: unknown): string {
  const s = String(d ?? '').slice(0, 10);
  if (!s) return '—';
  try { return new Date(`${s}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); } catch { return s; }
}
function fmtTime12(t: unknown): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ''));
  if (!m) return String(t ?? '—') || '—';
  let h = parseInt(m[1], 10); const mm = m[2]; const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12; return `${h}:${mm} ${ap}`;
}

// Human-facing fields a host should be told about when a manual booking changes.
// (Internal / bookkeeping columns like host_email_sent_at are intentionally
// excluded so a silent follow-up write never triggers a notification.)
const NOTIFY_FIELDS: { col: string; label: string; fmt: (v: unknown) => string }[] = [
  { col: 'event_date',     label: 'Event date',     fmt: fmtDateLong },
  { col: 'start_time',     label: 'Start time',     fmt: fmtTime12 },
  { col: 'end_time',       label: 'End time',       fmt: fmtTime12 },
  { col: 'event_type',     label: 'Event type',     fmt: (v) => String(v ?? '—') || '—' },
  { col: 'venue_name',     label: 'Venue',          fmt: (v) => String(v ?? '—') || '—' },
  { col: 'venue_type',     label: 'Venue type',     fmt: (v) => String(v ?? '—') || '—' },
  { col: 'venue_address',  label: 'Venue address',  fmt: (v) => String(v ?? '—') || '—' },
  { col: 'ceremony_start_time', label: 'Ceremony time', fmt: fmtTime12 },
  { col: 'cocktail_start_time', label: 'Cocktail hour', fmt: fmtTime12 },
  { col: 'package_title',  label: 'Package',        fmt: (v) => String(v ?? '—') || '—' },
  { col: 'package_details', label: 'Package details', fmt: (v) => String(v ?? '—').replace(/<[^>]+>/g, ' ').trim() || '—' },
  { col: 'requester_name', label: 'Host name',      fmt: (v) => String(v ?? '—') || '—' },
];

function changeEmailShell(content: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background:#000;padding:24px 32px;" align="center"><div style="font-family:Impact,Arial,sans-serif;font-size:28px;letter-spacing:.06em;color:#00f5c4;font-weight:700;">GLOBAL DJ CONNECT</div></td></tr>
<tr><td style="padding:32px;">${content}</td></tr>
<tr><td style="background:#f8f8f8;padding:20px 32px;text-align:center;border-top:1px solid #e0e0e0;"><p style="margin:0;color:#888;font-size:11px;">© ${new Date().getFullYear()} Global DJ Connect · globaldjconnect.com</p></td></tr>
</table></td></tr></table>`;
}

// FYI-only email: the DJ changed something on a manual booking. The host is told
// what changed — they do NOT approve it (the DJ owns a manual booking).
async function sendManualChangeEmail(opts: {
  to: string;
  djName: string;
  lines: { label: string; old: string; neu: string }[];
  event: { date: unknown; start: unknown; end: unknown; venue: unknown; hostName: unknown };
}): Promise<void> {
  if (!process.env.RESEND_API_KEY || !opts.to || opts.lines.length === 0) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const dj = opts.djName || 'Your DJ';
    const evDate = opts.event.date ? fmtDateLong(opts.event.date) : '';
    const evTime = opts.event.start ? `${fmtTime12(opts.event.start)}${opts.event.end ? ` – ${fmtTime12(opts.event.end)}` : ''}` : '';
    const header = `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;"><tr><td style="background:#f4f4f6;border-radius:8px;padding:12px 16px;">`
      + `<div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">Event details</div>`
      + (evDate ? `<div style="font-size:15px;color:#111;font-weight:700;margin-top:3px;">${escHtml(evDate)}${evTime ? ` <span style="color:#666;font-weight:400;">· ${escHtml(evTime)}</span>` : ''}</div>` : '')
      + (opts.event.venue ? `<div style="font-size:14px;color:#333;margin-top:2px;">${escHtml(opts.event.venue)}</div>` : '')
      + (opts.event.hostName ? `<div style="font-size:13px;color:#888;margin-top:2px;">Host: ${escHtml(opts.event.hostName)}</div>` : '')
      + `</td></tr></table>`;
    const rows = opts.lines.map((l) =>
      `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;color:#111;"><b>${escHtml(l.label)}</b><br>`
      + `<span style="color:#888;font-size:13px;text-decoration:line-through;">${escHtml(l.old)}</span> → <span style="color:#0a6f61;font-weight:700;">${escHtml(l.neu)}</span></td></tr>`).join('');
    const content = `<h1 style="margin:0 0 12px;font-size:20px;color:#111;">${escHtml(dj)} updated your booking details</h1>`
      + header
      + `<p style="margin:0 0 6px;color:#333;font-size:15px;">These details were updated. No action is needed on your part — this is just to keep you in the loop:</p>`
      + `<table width="100%" cellpadding="0" cellspacing="0">${rows}</table>`
      + `<p style="margin:20px 0 0;color:#999;font-size:11px;line-height:1.5;border-top:1px solid #eee;padding-top:12px;">${escHtml(CHANGE_LEGAL)}</p>`;
    await resend.emails.send({ from: FROM, to: opts.to, subject: `${dj} updated your booking details`, html: changeEmailShell(content) });
  } catch (e) { console.error('[bookings/manual] change email failed', e); }
}

const SELECT_COLS = 'id, event_date, start_time, end_time, venue_name, venue_address, venue_lat, venue_lon, venue_type, venue_type_desc, set_type, event_type, event_details, cocktail_needed, cocktail_start_time, ceremony_needed, ceremony_start_time, package_title, package_details, package_category, package_index, overtime_rate, booking_type, is_manual, flyer_url, host_email, host_email_sent_at, requester_name, offer_amount, original_rate, discount_code, discount_label, discount_amount, currency, tax_pct, tax_amount, total_with_tax, deposit_pct, deposit_amount';

// Columns a client is allowed to set on a manual booking. Anything else in the
// payload (id, dj_id, requester_id, status, is_manual…) is ignored — those are
// controlled server-side.
const WRITABLE = new Set([
  'booking_type', 'event_date', 'start_time', 'end_time',
  'venue_name', 'venue_address', 'venue_lat', 'venue_lon', 'venue_type', 'venue_type_desc',
  'set_type', 'equipment', 'event_type', 'event_details', 'cocktail_needed', 'cocktail_start_time',
  'ceremony_needed', 'ceremony_start_time',
  'package_title', 'package_details', 'package_category', 'package_index', 'overtime_rate',
  'host_email', 'host_email_sent_at', 'requester_name', 'offer_amount', 'currency',
  'tax_pct', 'tax_amount', 'total_with_tax', 'deposit_pct', 'deposit_amount',
]);

function clean(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (payload && typeof payload === 'object') {
    for (const [k, v] of Object.entries(payload)) if (WRITABLE.has(k)) out[k] = v;
  }
  return out;
}

async function authorize() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) };
  const acting = await getActingContext(user.id);
  // Adding/editing a manual booking is accepting a booking — manager+ only.
  if (!canAcceptBookings(acting.role)) {
    return { error: NextResponse.json({ error: 'Your role cannot add or edit bookings.' }, { status: 403 }) };
  }
  return { djId: acting.djId, acting, admin: createAdminClient() };
}

export async function POST(req: Request) {
  const auth = await authorize();
  if ('error' in auth) return auth.error;
  const { djId, acting, admin } = auth;

  let body: { payload?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const row = { ...clean(body.payload), dj_id: djId, requester_id: djId, is_manual: true, status: 'approved' };

  const { data, error } = await admin
    .from('bookings')
    .insert(row as unknown as never)
    .select(SELECT_COLS)
    .single();
  if (error) return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: 400 });
  const created = data as { id?: string; event_date?: string | null; requester_name?: string | null } | null;
  await logActivity(acting, {
    action: 'booking.manual_added',
    summary: `Added a manual booking — ${[created?.requester_name, created?.event_date].filter(Boolean).join(' — ') || 'new booking'}`,
    bookingId: created?.id ?? null,
  });
  return NextResponse.json({ ok: true, booking: data });
}

export async function PATCH(req: Request) {
  const auth = await authorize();
  if ('error' in auth) return auth.error;
  const { djId, acting, admin } = auth;

  let body: { id?: string; payload?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const patch = clean(body.payload);

  // Read the current row FIRST so we can tell the host exactly what changed. We
  // also need the host contact + whether the original invite already went out
  // (host_email_sent_at) before applying the update.
  const { data: beforeRaw } = await admin
    .from('bookings')
    .select(SELECT_COLS)
    .eq('id', id)
    .eq('dj_id', djId)
    .maybeSingle();
  const beforeRow = (beforeRaw as unknown as Record<string, unknown> | null) || null;

  const { data, error } = await admin
    .from('bookings')
    .update(patch as unknown as never)
    .eq('id', id)
    .eq('dj_id', djId)
    .select(SELECT_COLS)
    .single();
  if (error) return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: 400 });

  // Don't log the silent host_email_sent_at follow-up write as an "edit".
  const keys = Object.keys(patch);
  const silentSentStamp = keys.length === 1 && keys[0] === 'host_email_sent_at';
  if (!silentSentStamp) {
    const edited = data as { id?: string; event_date?: string | null; requester_name?: string | null } | null;
    await logActivity(acting, {
      action: 'booking.manual_edited',
      summary: `Edited a manual booking — ${[edited?.requester_name, edited?.event_date].filter(Boolean).join(' — ') || 'booking'}`,
      bookingId: edited?.id ?? id,
    });
  }

  // ── Notify the host of the change (FYI, no approval) ──
  // Only once the host already received the original invite (host_email_sent_at
  // set) — a pre-invite edit is folded into the invite the client sends on save,
  // so a separate "we changed something" email would be premature/duplicative.
  const after = (data || {}) as unknown as Record<string, unknown>;
  const before = beforeRow || {};
  const hostTo = String((after.host_email ?? before.host_email) ?? '').trim();
  const alreadyInvited = !!(before.host_email_sent_at || after.host_email_sent_at);
  if (!silentSentStamp && hostTo && alreadyInvited && beforeRow) {
    // Which notify-worthy fields actually changed value (compare as strings so a
    // null→'' or number formatting difference isn't reported as a change).
    const lines = NOTIFY_FIELDS
      .filter((f) => keys.includes(f.col))
      .map((f) => ({ f, oldV: before[f.col], newV: after[f.col] }))
      .filter(({ oldV, newV }) => String(oldV ?? '') !== String(newV ?? ''))
      .map(({ f, oldV, newV }) => ({ label: f.label, old: f.fmt(oldV), neu: f.fmt(newV) }))
      .filter((l) => l.old !== l.neu);
    if (lines.length > 0) {
      const djName = (await admin.from('users').select('name').eq('id', djId).maybeSingle<{ name: string | null }>()).data?.name || 'Your DJ';
      await sendManualChangeEmail({
        to: hostTo,
        djName,
        lines,
        event: { date: after.event_date, start: after.start_time, end: after.end_time, venue: after.venue_name, hostName: after.requester_name },
      });
    }
  }

  return NextResponse.json({ ok: true, booking: data });
}

// DELETE /api/bookings/manual  { id } — remove a manual booking. Same gate as
// create/edit (manager+), scoped to the acting owner so a teammate's delete
// actually lands (a browser DELETE is dropped by RLS with no error, leaving the
// row in place while the UI shows it gone).
export async function DELETE(req: Request) {
  const auth = await authorize();
  if ('error' in auth) return auth.error;
  const { djId, acting, admin } = auth;

  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  // Only manual bookings may be hard-deleted here — a real host request is never
  // erased this way (it is cancelled, keeping the record). is_manual guards that.
  const { data: delRows, error } = await admin
    .from('bookings')
    .delete()
    .eq('id', id)
    .eq('dj_id', djId)
    .eq('is_manual', true)
    .select('id');
  if (error) return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
  // Only log if a row was actually removed (a non-manual / foreign id matches
  // nothing but returns no error — don't write a phantom "deleted" entry).
  if (Array.isArray(delRows) && delRows.length > 0) {
    await logActivity(acting, { action: 'booking.manual_deleted', summary: 'Deleted a manual booking', bookingId: id });
  }
  return NextResponse.json({ ok: true });
}
