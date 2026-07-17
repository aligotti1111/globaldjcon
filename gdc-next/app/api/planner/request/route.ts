// POST /api/planner/request
//
// The DJ's half of the Playlist & Planner. Creates the planner for a booking
// and emails the client the link. This is the route the "Request planner"
// action on the Upcoming Bookings row calls.
//
// PATH NOTE: this sits next to /api/planner/[id]. Next resolves STATIC segments
// before dynamic ones, so /api/planner/request always lands here and never in
// [id] — and [id] rejects anything that isn't a uuid anyway, so even if that
// order ever changed the failure would be a 404, not a wrong write.
//
// THE TWO SIDES ARE DIFFERENT AND THAT'S THE POINT:
//   /api/planner/[id]      — no session. The client. The uuid is the credential.
//   /api/planner/request   — session required. The DJ. Ownership is checked.
//
// CLOUDFLARE EATS 502s — an origin 502 has its body replaced with Cloudflare's
// HTML and the caller's .json() throws on it. 500 passes through. Never 502.
// (/api/payments still returns 502 on insert failure. It's wrong there too.)

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import { Resend } from 'resend';
import { canUsePro, type AccessFields } from '@/lib/access';
import type { UpcomingBooking } from '@/app/(main)/upcoming-bookings/page';
import {
  pickTemplate,
  composeFields,
  applyPrefill,
  visibleFields,
  type PlannerTemplate,
  type PlannerField,
  type PlannerResponses,
} from '@/lib/planner';

export const runtime = 'nodejs';
export const maxDuration = 20;

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const SITE_URL = 'https://globaldjconnect.com';

interface BookingRow {
  id: string;
  dj_id: string | null;
  requester_id: string | null;
  host_email: string | null;
  requester_name: string | null;
  is_manual: boolean | null;
  booking_type: string | null;
  event_type: string | null;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue_name: string | null;
  venue_address: string | null;
  guest_count: number | null;
  cocktail_needed: boolean | null;
  cocktail_start_time: string | null;
  package_title: string | null;
}

interface PlannerRow {
  id: string;
  fields: PlannerField[];
  responses: PlannerResponses;
  status: string;
}

const BOOKING_COLS =
  'id, dj_id, requester_id, host_email, requester_name, is_manual, booking_type, ' +
  'event_type, event_date, start_time, end_time, venue_name, venue_address, ' +
  'guest_count, cocktail_needed, cocktail_start_time, package_title';

async function clientEmailFor(b: BookingRow): Promise<string | null> {
  if (b.host_email) return b.host_email;
  if (b.requester_id) return await resolveUserEmail(b.requester_id);
  return null;
}

function fmtDate(d: string | null): string {
  if (!d) return 'your event';
  // T12:00:00 — `new Date('2026-07-25')` is UTC midnight and renders as the
  // 24th in every US timezone.
  return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

/** Cosmetic shell — same one /api/payments uses. */
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

/** Minimal escape — a venue called "Smith & Sons <Hall>" must not break the HTML. */
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }
    const bookingId = typeof body.bookingId === 'string' ? body.bookingId : '';
    if (!bookingId) return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });

    const admin = createAdminClient();
    // booking_planners / planners postdate the generated types/supabase.ts, so
    // the typed client rejects .from() on them outright. One cast for the new
    // tables — same house pattern as /api/payments and /pay/[id].
    const db = admin as unknown as SupabaseClient;

    const { data: bData } = await admin
      .from('bookings')
      .select(BOOKING_COLS)
      .eq('id', bookingId)
      .maybeSingle();
    const b = bData as unknown as BookingRow | null;
    if (!b) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
    if (b.dj_id !== user.id) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });

    // Mobile only, on purpose. A club booking has no first dance, no bridal
    // party and no run of show — sending one a wedding planner is worse than
    // sending nothing. Club gets its own system (spec, §1).
    if (b.booking_type === 'club') {
      return NextResponse.json(
        { error: 'Planners are for mobile bookings.' }, { status: 400 },
      );
    }

    // The host gate. Mirrors the deposit exactly: a manual booking the DJ typed
    // in themselves may have no client attached at all, and there is nobody to
    // send this to. The NAME matters as much as the address — the email opens
    // "Hi {name}", and with no name the client gets "Hi jordan91".
    //
    // The UI shows the icon and explains this in the dropdown rather than
    // hiding the action; this check is what makes that explanation true, and
    // what stops a direct POST from bypassing it.
    if (b.is_manual && (!b.host_email?.trim() || !b.requester_name?.trim())) {
      return NextResponse.json(
        { error: 'Add the host\'s full name and email to send a planner.' },
        { status: 400 },
      );
    }

    const to = await clientEmailFor(b);
    if (!to) {
      return NextResponse.json(
        { error: 'No client email on this booking.' }, { status: 400 },
      );
    }

    // `name`, NOT `dj_name`. There is no users.dj_name — dj_name is a column on
    // BOOKINGS (denormalised) and a placeholder in the contract template, and
    // selecting it here made PostgREST reject the whole query. That returned
    // null, which fell through to the !djRow branch below and told every DJ
    // alive they weren't Pro. A wrong column name in a select doesn't throw;
    // it just quietly hands you nothing.
    const { data: djData, error: djErr } = await admin
      .from('users')
      .select('name, sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, comp_source')
      .eq('id', user.id)
      .maybeSingle();
    const djRow = djData as unknown as (AccessFields & { name?: string | null }) | null;
    // A failed QUERY and a genuinely un-subscribed DJ are different problems and
    // must not share an answer. That conflation is exactly what hid this bug.
    if (djErr) {
      return NextResponse.json({ error: 'Could not read your account.' }, { status: 500 });
    }
    const djName = djRow?.name || 'your DJ';

    // Tier gate, SERVER-side. The planner is part of the Pro suite that
    // lib/access already describes as "contracts / deposits / event info
    // sheet" — this is the event info sheet.
    //
    // The row hides the action too, but that is not a paywall: anyone can POST
    // here directly. This is the paywall.
    //
    // The CLIENT is never gated and never will be. They have no account, they
    // pay nobody, and charging the person filling in the form would be
    // charging the wrong end of the transaction.
    //
    // NOTE: lib/access says an existing booking should be judged by
    // bookingAllows(tier_stamp) — but tier_stamp is still never written
    // anywhere, so it would deny everyone. Current standing is the only honest
    // signal that exists today. (Same compromise as /api/payments.)
    if (!djRow || !canUsePro(djRow)) {
      return NextResponse.json(
        { error: 'Planners are a Pro feature.' }, { status: 403 },
      );
    }

    // ── The planner row ───────────────────────────────────────────────────
    //
    // Already exists? Then this is a resend, and we DO NOT rebuild it.
    //
    // `fields` is a snapshot and `responses` is keyed to it. Recomposing the
    // template on a resend would silently orphan every answer already given
    // against any id that moved or changed — and a resend is most likely
    // precisely when a client is halfway through. The one thing this feature
    // cannot do is lose a form somebody spent a week filling in.
    const { data: existingData } = await db
      .from('booking_planners')
      .select('id, fields, responses, status')
      .eq('booking_id', bookingId)
      .maybeSingle();
    let planner = existingData as unknown as PlannerRow | null;
    const isResend = !!planner;

    if (!planner) {
      // is_standard rows have dj_id null; the DJ's own customisations are
      // theirs. Both, one query, resolved in code by pickTemplate.
      const { data: tData } = await db
        .from('planners')
        .select('id, dj_id, name, event_type, is_standard, fields')
        .or(`is_standard.eq.true,dj_id.eq.${user.id}`);
      const templates = (tData as unknown as PlannerTemplate[] | null) || [];

      // "Use a different planner" — the modal's escape hatch for when the
      // event type guessed wrong (a Reunion that's really a wedding reception,
      // say). Optional: with no plannerId this resolves exactly as before, so
      // the one-click path is untouched.
      const forcedId = typeof body.plannerId === 'string' ? body.plannerId : '';
      if (forcedId) {
        // Must be a template this DJ can actually use: stock, or their own.
        // Without this check a plannerId is a read of any DJ's private
        // template by anyone who can guess a uuid.
        const forced = templates.find((t) => t.id === forcedId);
        if (!forced) {
          return NextResponse.json({ error: 'Planner not found.' }, { status: 404 });
        }
      }

      const { base, override } = pickTemplate(templates, user.id, b.event_type);
      if (!base) {
        // The stock base is seeded. Missing means the seed never ran — a
        // deployment problem, not something the DJ did.
        return NextResponse.json(
          { error: 'No planner template available.' }, { status: 500 },
        );
      }

      // A forced pick REPLACES the override, not the base. The base carries
      // Do NOT play and Notes and the shared spine every event needs; the
      // override is the event-specific half. "Send the wedding one instead"
      // means swap that half — not throw away the questions every planner has.
      const forcedTpl = forcedId ? templates.find((t) => t.id === forcedId) : undefined;
      const overrideFields = forcedTpl
        ? (forcedTpl.id === base.id ? [] : forcedTpl.fields || [])
        : (override?.fields || []);
      const fields = composeFields(base.fields || [], overrideFields);
      // Prefill runs ONCE, here, and is stored. Not recomputed per page load:
      // if the DJ edits the booking tomorrow the client's form must not shift
      // under them mid-answer.
      //
      // The cast: BookingRow is this route's own select, not the page's
      // UpcomingBooking, and an interface gets no implicit index signature — so
      // TS won't hand it to a `& Record<string, unknown>` parameter even though
      // every key the helper reads is right there. One cast, one call site.
      const responses = applyPrefill(
        fields,
        b as unknown as Partial<UpcomingBooking> & Record<string, unknown>,
        djName,
        {},
      );

      const { data: created, error: insErr } = await db
        .from('booking_planners')
        .insert({
          booking_id: bookingId,
          dj_id: user.id,
          planner_id: (forcedTpl?.id || override?.id || base.id) ?? null,
          fields,
          responses,
          status: 'sent',
        } as unknown as never)
        .select('id, fields, responses, status')
        .single();
      // 500, never 502 — Cloudflare would eat the body. See the header.
      if (insErr || !created) {
        return NextResponse.json({ error: 'Could not create the planner.' }, { status: 500 });
      }
      planner = created as unknown as PlannerRow;
    }

    // planner_status on the booking is NOT written here. trg_sync_planner_status
    // owns it — one writer, so the strip can't go stale (schema, §4).

    const url = `${SITE_URL}/planner/${planner.id}`;

    // ── The email ─────────────────────────────────────────────────────────
    if (process.env.RESEND_API_KEY) {
      const hi = b.requester_name?.trim() ? esc(b.requester_name.trim().split(' ')[0]) : 'there';
      const when = fmtDate(b.event_date);
      const count = visibleFields(planner.fields || []).length;

      const recap = `<div style="background:#f8f8f8;border-radius:8px;padding:14px 16px;margin:0 0 20px;">
<p style="margin:0;color:#666;font-size:13px;line-height:1.7;">
<strong style="color:#111;">${esc(djName)}</strong><br/>${esc(when)}${b.venue_name ? ` · ${esc(b.venue_name)}` : ''}
</p></div>`;

      const content = `
<h1 style="margin:0 0 6px;font-size:22px;color:#111;">${isResend ? 'Your planner is still open' : `Hi ${hi} — let's plan your music`}</h1>
<p style="margin:0 0 18px;color:#666;font-size:14px;line-height:1.7;">
${isResend
  ? `Picking up where you left off — nothing has been lost.`
  : `${esc(djName)} needs a few details to run your night: the songs that matter, the names to get right, and anything that should never be played.`}
</p>
${recap}
<p style="margin:0 0 22px;color:#666;font-size:14px;line-height:1.7;">
There are ${count} questions and <strong style="color:#111;">none of them are required</strong>. It saves as you go, so fill in what you know now and come back for the rest. No account, no password — the link is yours.
</p>
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
<tr><td style="background:#000000;border-radius:8px;">
<a href="${url}" style="display:inline-block;padding:14px 28px;color:#00f5c4;font-size:15px;font-weight:700;text-decoration:none;">Open your planner</a>
</td></tr></table>
<p style="margin:0;color:#999;font-size:12px;line-height:1.6;word-break:break-all;">
Or paste this into your browser:<br/><a href="${url}" style="color:#999;">${url}</a>
</p>
<p style="margin:18px 0 0;color:#bbb;font-size:11px;line-height:1.6;">
This link is private to your booking — anyone with it can see and edit your planner, so keep it to the people helping you plan.
</p>`;

      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: FROM,
          to,
          subject: isResend
            ? `Reminder: your planner for ${when}`
            : `${djName} — plan the music for ${when}`,
          html: shell(content),
        });
      } catch {
        // The row exists and the link works. A dead Resend key must not make
        // the DJ think the planner wasn't created — they can copy the link.
        return NextResponse.json({
          id: planner.id, url, status: planner.status, resent: isResend,
          warning: 'Planner created, but the email could not be sent. Copy the link instead.',
        });
      }
    }

    return NextResponse.json({ id: planner.id, url, status: planner.status, resent: isResend });
  } catch {
    // 500, never 502 — see the header.
    return NextResponse.json({ error: 'Could not send the planner.' }, { status: 500 });
  }
}
