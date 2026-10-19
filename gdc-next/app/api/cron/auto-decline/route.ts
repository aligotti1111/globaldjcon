// GET /api/cron/auto-decline
//
// Auto-declines booking requests (and unanswered counter-offers) that were
// never answered in time. A request expires at the EARLIER of:
//   1. MAX_RESPONSE_DAYS after the clock started, or
//   2. midnight entering the event day (00:00 on the event date),
// both in the DJ's own timezone (users.timezone, default US Eastern). See
// lib/bookingExpiry — the same math powers the "Expires in N days" countdown
// on the request cards, so the badge and the cron can never disagree.
//
// The clock starts at created_at for a 'pending' request, and at updated_at
// (when the counter was sent) for a 'countered' one.
//
// Expired + still 'pending'/'countered' → set to 'denied' and email the booker
// the normal decline notice (reusing /api/send-email's mob_booking_status /
// booking_status template) with an automatic reason.
//
// Trigger: netlify/functions/auto-decline.mjs pings this EVERY HOUR (no time
// gate — the deadline can fall at any hour, and we want to act promptly once
// it passes). ?force is unnecessary; ?dry=1 reports what WOULD be declined
// without changing anything or sending mail.
//
// Auth: CRON_SECRET, as Authorization: Bearer <secret> or ?key=<secret>.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import { responseDeadlineMs, effectiveTimezone, todayInTz } from '@/lib/bookingExpiry';
import { Resend } from 'resend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SITE_URL = 'https://globaldjconnect.com';
const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const DAY_MS = 86_400_000;
const AUTO_REASON = 'This request wasn’t answered in time, so it was automatically declined. You’re welcome to send a new request.';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return 'your event';
  try { return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}
function shell(content: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background:#000;padding:24px 32px;" align="center"><div style="font-family:Impact,Arial,sans-serif;font-size:28px;letter-spacing:.06em;color:#00f5c4;font-weight:700;">GLOBAL DJ CONNECT</div></td></tr>
<tr><td style="padding:32px;">${content}</td></tr>
<tr><td style="background:#f8f8f8;padding:20px 32px;text-align:center;border-top:1px solid #e0e0e0;"><p style="margin:0;color:#888;font-size:11px;">© ${new Date().getFullYear()} Global DJ Connect · globaldjconnect.com</p></td></tr>
</table></td></tr></table>`;
}

type PendingBooking = {
  id: string;
  dj_id: string | null;
  booking_type: string | null;
  requester_id: string | null;
  requester_name: string | null;
  event_date: string | null;
  venue_name: string | null;
  package_title: string | null;
  host_email: string | null;
  created_at: string | null;
  updated_at: string | null;
  status: string | null;
  expiry_reminder_sent_at: string | null;
};

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const url = new URL(req.url);
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null;
  const provided = bearer || url.searchParams.get('key');
  if (provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dry = url.searchParams.get('dry') === '1';
  const now = Date.now();

  const admin = createAdminClient();
  const db = admin as unknown as SupabaseClient;

  // Every unanswered request in someone's court:
  //   • 'pending'   — waiting on the DJ (a new request, or the booker's
  //                   counter-back). Clock runs from created_at.
  //   • 'countered' — the DJ countered; waiting on the booker. Clock runs from
  //                   updated_at (when the counter was sent).
  // Both get the same MAX_RESPONSE_DAYS window (capped by the event date).
  // Manual bookings never sit in either state, so they're excluded naturally.
  const { data, error } = await db
    .from('bookings')
    .select('id, dj_id, booking_type, requester_id, requester_name, event_date, venue_name, package_title, host_email, created_at, updated_at, status, expiry_reminder_sent_at')
    .in('status', ['pending', 'counter'])
    .is('deleted_at', null)
    .limit(2000);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
  const rows = (data || []) as unknown as PendingBooking[];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, checked: 0, declined: 0 });
  }

  // Each DJ's timezone (for the deadline clock). Cast — timezone isn't in the
  // generated types until the migration's types are regenerated.
  const djIds = Array.from(new Set(rows.map((r) => r.dj_id).filter(Boolean))) as string[];
  const tzById = new Map<string, string>();
  const djNameById = new Map<string, string>();
  if (djIds.length > 0) {
    const { data: djs } = await db
      .from('users')
      .select('id, name, timezone, zip')
      .in('id', djIds);
    for (const u of (djs as unknown as { id: string; name: string | null; timezone: string | null; zip: string | null }[] | null) || []) {
      // Explicit choice wins; otherwise derive from the DJ's ZIP; else Eastern.
      tzById.set(u.id, effectiveTimezone(u.timezone, u.zip));
      if (u.name) djNameById.set(u.id, u.name);
    }
  }

  // Which requests are past their deadline right now. A countered offer's clock
  // starts when the counter was sent (updated_at), not when the request first
  // came in — otherwise a counter on day 4 would expire the next day.
  const deadlineOf = (b: PendingBooking): number | null => {
    const tz = (b.dj_id && tzById.get(b.dj_id)) || effectiveTimezone(null, null);
    const startedAt = b.status === 'counter' ? (b.updated_at || b.created_at) : b.created_at;
    return responseDeadlineMs(startedAt, b.event_date, tz);
  };

  const expired = rows.filter((b) => {
    const deadline = deadlineOf(b);
    return deadline != null && now >= deadline;
  });

  // Expiring within the next 24h, not yet expired, and not already reminded —
  // the "heads up, respond soon" nudge to BOTH parties, sent at most once.
  const expiring = rows.filter((b) => {
    if (b.expiry_reminder_sent_at) return false;
    const deadline = deadlineOf(b);
    return deadline != null && deadline > now && (deadline - now) <= DAY_MS;
  });

  if (dry) {
    return NextResponse.json({
      ok: true, dryRun: true, checked: rows.length,
      declined: expired.length, remindersToSend: expiring.length,
      ids: expired.map((b) => b.id), expiringIds: expiring.map((b) => b.id),
    });
  }

  const nowIso = new Date(now).toISOString();
  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  // Resolve the host's email: the stored host_email wins, else the booker's
  // account email.
  const hostEmailOf = async (b: PendingBooking): Promise<string | null> =>
    b.host_email?.trim() || (b.requester_id ? await resolveUserEmail(b.requester_id) : null);

  // ── 24h-BEFORE-EXPIRY REMINDER → BOTH PARTIES ───────────────────────────
  let reminded = 0;
  for (const b of expiring) {
    // Claim the reminder first (guard on current status + the null stamp) so two
    // overlapping cron runs can't both email.
    const { data: claim } = await db
      .from('bookings')
      .update({ expiry_reminder_sent_at: nowIso } as unknown as never)
      .eq('id', b.id)
      .eq('status', b.status || 'pending')
      .is('expiry_reminder_sent_at' as never, null)
      .select('id');
    if (!claim || (claim as unknown[]).length === 0) continue;
    reminded += 1;
    if (!resend) continue;

    const djName = (b.dj_id && djNameById.get(b.dj_id)) || 'your DJ';
    const hostName = b.requester_name?.trim() || 'there';
    const when = fmtDate(b.event_date);
    const djEmail = b.dj_id ? await resolveUserEmail(b.dj_id) : null;
    const hostEmail = await hostEmailOf(b);
    const cta = `<table cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0;"><tr><td style="background:#000;border-radius:8px;"><a href="${SITE_URL}/booking-requests" style="display:inline-block;padding:13px 26px;color:#00f5c4;font-size:15px;font-weight:700;text-decoration:none;">Open Booking Requests</a></td></tr></table>`;
    const waitingOnDj = (b.status || 'pending') === 'pending';

    // The party who must act gets the action email; the other gets a heads-up.
    const actorEmail = waitingOnDj ? djEmail : hostEmail;
    const actorHi = waitingOnDj ? djName : hostName;
    const actorVerb = waitingOnDj ? 'respond to' : 'approve or decline';
    const actorWhat = waitingOnDj ? `the booking request from ${esc(hostName)}` : `${esc(djName)}'s offer`;
    const otherEmail = waitingOnDj ? hostEmail : djEmail;
    const otherHi = waitingOnDj ? hostName : djName;
    const otherWho = waitingOnDj ? esc(djName) : esc(hostName);

    try {
      if (actorEmail) {
        await resend.emails.send({
          from: FROM, to: actorEmail,
          subject: `Expiring in under 24 hours — ${when}`,
          html: shell(`<h1 style="margin:0 0 12px;font-size:22px;color:#111;">Hi ${esc(actorHi)}, this expires soon</h1>
<p style="margin:0 0 8px;color:#444;font-size:15px;line-height:1.6;">Heads up — ${actorWhat} for <strong>${when}</strong> will expire in <strong>less than 24 hours</strong>.</p>
<p style="margin:0;color:#444;font-size:15px;line-height:1.6;">Please ${actorVerb} it before then, or it will be automatically declined.</p>${cta}`),
        });
      }
      if (otherEmail) {
        await resend.emails.send({
          from: FROM, to: otherEmail,
          subject: `Awaiting a response — ${when}`,
          html: shell(`<h1 style="margin:0 0 12px;font-size:22px;color:#111;">Hi ${esc(otherHi)}, still waiting to hear back</h1>
<p style="margin:0;color:#444;font-size:15px;line-height:1.6;">Your booking for <strong>${when}</strong> is waiting on ${otherWho} and will expire in <strong>less than 24 hours</strong> if it isn't answered. We'll email you the moment there's an update.</p>`),
        });
      }
    } catch { /* best-effort — the reminder is already claimed */ }
  }

  let declined = 0;
  for (const b of expired) {
    // Guard the update on the row's ORIGINAL status so we never clobber a
    // booking that was answered (or countered back) in the same minute the
    // cron ran.
    const { error: upErr, data: upData } = await db
      .from('bookings')
      .update({ status: 'denied', updated_at: nowIso } as unknown as never)
      .eq('id', b.id)
      .eq('status', b.status || 'pending')
      .select('id');
    if (upErr || !upData || (upData as unknown[]).length === 0) continue;
    declined += 1;

    // Reuse the normal decline email so the booker gets the same notice a
    // manual decline would send — just with the automatic reason.
    try {
      await fetch(`${SITE_URL}/api/send-email`, {
        method: 'POST',
        // Server-to-server call (no user cookie) — carry the internal secret so
        // the send-email auth gate accepts it.
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.CRON_SECRET || '' },
        body: JSON.stringify({
          type: b.booking_type === 'club' ? 'booking_status' : 'mob_booking_status',
          bookingId: b.id,
          requesterUserId: b.requester_id,
          requesterName: b.requester_name,
          status: 'denied',
          eventDate: b.event_date,
          venueName: b.venue_name,
          packageTitle: b.package_title,
          declineReason: AUTO_REASON,
        }),
      });
    } catch { /* email is best-effort — the decline itself already stuck */ }

    // Notify the side that was WAITING to respond. The booker always gets the
    // decline notice above, so: a 'counter' that expired was waiting on the
    // booker (already covered); a 'pending' that expired was waiting on the DJ,
    // who otherwise hears nothing — email them it lapsed.
    if ((b.status || 'pending') === 'pending' && resend && b.dj_id) {
      try {
        const djEmail = await resolveUserEmail(b.dj_id);
        if (djEmail) {
          const djName = djNameById.get(b.dj_id) || 'there';
          const hostName = b.requester_name?.trim() || 'a booker';
          const when = fmtDate(b.event_date);
          await resend.emails.send({
            from: FROM, to: djEmail,
            subject: `Booking request expired — ${when}`,
            html: shell(`<h1 style="margin:0 0 12px;font-size:22px;color:#111;">Hi ${esc(djName)}, a request expired</h1>
<p style="margin:0;color:#444;font-size:15px;line-height:1.6;">The booking request from <strong>${esc(hostName)}</strong> for <strong>${when}</strong> wasn't answered in time, so it was automatically declined. If you still want the gig, reach out to ${esc(hostName)} — they can send a new request anytime.</p>`),
          });
        }
      } catch { /* best-effort */ }
    }
  }

  // ── PAST-DATED PENDING CONTRACTS → AUTO-CANCEL ──────────────────────────
  //
  // A contract that's been SENT but never signed turns stale once the event is
  // over: it can't be signed for a gig that already happened, and it has no
  // business still reading "Pending" on the dashboard or counting against the
  // pending meter. So any contract still awaiting a signature (the client's or
  // the DJ's) on a booking whose event date has already passed — in that DJ's
  // own timezone — is voided: contract_status → 'cancelled', stamped with
  // contract_cancelled_at. The pipeline already treats 'cancelled' as a void
  // step, so the stage drops out of "Pending" automatically. No email — this is
  // housekeeping on a gig that's over, not a decision anyone needs to hear about.
  let contractsVoided = 0;
  try {
    const { data: stale } = await db
      .from('bookings')
      .select('id, dj_id, event_date')
      .in('contract_status', ['awaiting_client', 'awaiting_dj'])
      .is('deleted_at', null)
      .limit(2000);
    const staleRows = (stale as unknown as { id: string; dj_id: string | null; event_date: string | null }[] | null) || [];

    // Timezone per DJ (reuse what we already looked up; fetch any we're missing).
    const extraIds = Array.from(new Set(
      staleRows.map((r) => r.dj_id).filter((id): id is string => !!id && !tzById.has(id)),
    ));
    if (extraIds.length > 0) {
      const { data: extraDjs } = await db
        .from('users').select('id, timezone, zip').in('id', extraIds);
      for (const u of (extraDjs as unknown as { id: string; timezone: string | null; zip: string | null }[] | null) || []) {
        tzById.set(u.id, effectiveTimezone(u.timezone, u.zip));
      }
    }

    const past = staleRows.filter((b) => {
      if (!b.event_date) return false;
      const tz = (b.dj_id && tzById.get(b.dj_id)) || effectiveTimezone(null, null);
      // event_date is a plain YYYY-MM-DD; both sides are that same shape, so a
      // lexical compare is a correct date compare. Strictly BEFORE today — a
      // same-day gig stays live until the DJ's local midnight.
      return b.event_date < todayInTz(tz);
    });

    if (!dry) {
      for (const b of past) {
        const { data: upData } = await db
          .from('bookings')
          .update({ contract_status: 'cancelled', contract_cancelled_at: nowIso } as unknown as never)
          .eq('id', b.id)
          .in('contract_status', ['awaiting_client', 'awaiting_dj'])
          .select('id');
        if (upData && (upData as unknown[]).length > 0) contractsVoided += 1;
      }
    } else {
      contractsVoided = past.length;
    }
  } catch { /* non-fatal — the request auto-decline above already ran */ }

  return NextResponse.json({ ok: true, checked: rows.length, declined, reminded, contractsVoided });
}
