// POST /api/bookings/status-override
//
// Lets the DJ manually mark a readiness step done / not-done on one of their
// bookings (for steps handled outside the app — contract signed on paper, a
// deposit paid in cash, etc.). Stored in bookings.status_overrides (JSONB),
// e.g. { "contract": true }.
//
// Body: { bookingId: string, key: string, done: boolean }
// DJ-only (must own the booking).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import { Resend } from 'resend';
import { bookingProgressBox } from '@/lib/bookingProgressBox';

export const runtime = 'nodejs';
export const maxDuration = 15;

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const SITE_URL = 'https://globaldjconnect.com';

// Only these keys can be overridden — guards against arbitrary JSON writes.
const ALLOWED_KEYS = new Set(['contract', 'deposit', 'deposit_skipped', 'song_list']);

function escHtml(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Minimal branded wrapper — matches the /api/payments + send-email shells.
function shell(content: string): string {
  return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background:#000000;padding:24px 32px;" align="center">
<div style="font-family:'Bebas Neue',Impact,Arial,sans-serif;font-size:28px;letter-spacing:.06em;color:#00f5c4;font-weight:700;">GLOBAL DJ CONNECT</div>
</td></tr>
<tr><td style="padding:32px;">${content}</td></tr>
<tr><td style="background:#f8f8f8;padding:20px 32px;text-align:center;border-top:1px solid #e0e0e0;">
<p style="margin:0;color:#888;font-size:11px;line-height:1.6;">© ${new Date().getFullYear()} Global DJ Connect · <a href="${SITE_URL}" style="color:#888;">globaldjconnect.com</a></p>
</td></tr></table>
</td></tr></table>`;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: { bookingId?: unknown; key?: unknown; done?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const bookingId = typeof body.bookingId === 'string' && body.bookingId ? body.bookingId : null;
  const key = typeof body.key === 'string' ? body.key : null;
  const done = body.done === true;
  if (!bookingId || !key || !ALLOWED_KEYS.has(key)) {
    return NextResponse.json({ error: 'Missing or invalid bookingId/key' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from('bookings')
    .select('status_overrides, dj_id')
    .eq('id', bookingId)
    .maybeSingle();
  const row = data as { status_overrides?: Record<string, boolean> | null; dj_id?: string | null } | null;
  if (!row) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
  if (row.dj_id !== user.id) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });

  const overrides: Record<string, boolean> =
    row.status_overrides && typeof row.status_overrides === 'object' ? { ...row.status_overrides } : {};
  if (done) overrides[key] = true; else delete overrides[key];

  // Manual overrides are discrete actions the booking log should show, so stamp
  // the moment they're toggled. (status_overrides is a boolean map with no
  // history of its own.)
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status_overrides: overrides };
  if (key === 'deposit_skipped') {
    if (done) patch.deposit_skipped_at = now;
    else patch.deposit_skip_undone_at = now;
  } else if (key === 'contract') {
    // "Mark Complete" on a contract handled outside the app (signed on paper,
    // etc.) — distinct from the host signing in-app (contract_signed_at).
    if (done) patch.contract_completed_at = now;
    else patch.contract_completion_undone_at = now;
  } else if (key === 'deposit') {
    // "Mark Complete" on a deposit taken outside the app (cash, a transfer) —
    // distinct from a payment confirmed in the ledger. Stamped so the booking
    // log can show the action, mirroring the contract case above.
    if (done) patch.deposit_completed_at = now;
    else patch.deposit_completion_undone_at = now;
  }

  try {
    await admin.from('bookings').update(patch as unknown as never).eq('id', bookingId);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not save.' }, { status: 502 });
  }

  // When the DJ marks the DEPOSIT complete BY HAND (cash on the night, a bank
  // transfer that never touched the app), send the host a confirmation with the
  // booking-progress box — the manual counterpart to the auto-confirmation the
  // payments route sends when a real payment is confirmed.
  //
  // Only on 'deposit' → done. Skipping a deposit sends NOTHING: neither the
  // manual 'Skip deposit' (key 'deposit_skipped') nor the auto-skip a balance
  // request triggers reaches this branch, and un-marking (done:false) doesn't
  // either. The box in every following email labels a skipped deposit "Skipped".
  if (key === 'deposit' && done && process.env.RESEND_API_KEY) {
    try {
      const { data: bkData } = await admin
        .from('bookings')
        .select('id, host_email, requester_id, requester_name, event_date')
        .eq('id', bookingId)
        .maybeSingle();
      const bk = bkData as { host_email?: string | null; requester_id?: string | null; requester_name?: string | null; event_date?: string | null } | null;
      if (bk) {
        let to = (bk.host_email || '').trim();
        if (!to && bk.requester_id) to = (await resolveUserEmail(bk.requester_id)) || '';
        if (to) {
          const progressBox = await bookingProgressBox(bookingId);
          const name = (bk.requester_name || '').trim() || 'there';
          const dateStr = bk.event_date
            ? new Date(`${bk.event_date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
            : '';
          const content = `<h1 style="margin:0 0 10px;font-size:20px;color:#111;">Deposit received ✅</h1>
<p style="margin:0;color:#333;font-size:15px;line-height:1.6;">Hi ${escHtml(name)}, your deposit is settled${dateStr ? ` for ${escHtml(dateStr)}` : ''}. Thanks!</p>${progressBox ? `<div style="margin-top:24px;">${progressBox}</div>` : ''}`;
          const resend = new Resend(process.env.RESEND_API_KEY);
          await resend.emails.send({
            from: FROM,
            to,
            subject: `Deposit received${dateStr ? ` — ${dateStr}` : ''}`,
            html: shell(content),
          });
        }
      }
    } catch { /* non-fatal — the override already saved */ }
  }

  return NextResponse.json({ ok: true, status_overrides: overrides });
}
