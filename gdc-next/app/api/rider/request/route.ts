// POST /api/rider/request — deploy a booking's DJ rider to the host.
// Saves the rider (mode + items + pdf url), marks it 'sent', and emails the
// host the on-site rider link WITH THE RIDER AS A PDF ATTACHMENT:
//   · custom mode — a branded PDF is generated from the fields (lib/riderPdf).
//   · upload mode — the DJ's uploaded PDF (rider_pdf_url) is fetched + attached.
// The on-site /rider/[id] link keeps working in both modes.
// Session required; booking must belong to the DJ.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActingContext } from '@/lib/acting';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import {
  normalizeRiderItems, normalizeRiderMode, groupRider, riderLine, RIDER_SECTIONS,
  normalizeNamedRiders, upsertNamedRider, newRiderId, type NamedRider,
} from '@/lib/rider';
import { buildRiderPdf } from '@/lib/riderPdf';

export const runtime = 'nodejs';
export const maxDuration = 20;

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const SITE_URL = 'https://globaldjconnect.com';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fmtDate(d: string | null): string {
  if (!d) return 'your event';
  return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}
function fmtTime(t: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':'); const hn = Number(h);
  if (!Number.isFinite(hn)) return '';
  const ap = hn >= 12 ? 'PM' : 'AM'; const h12 = hn % 12 === 0 ? 12 : hn % 12;
  return `${h12}:${m || '00'} ${ap}`;
}

/** Fetch a logo/PDF URL into bytes. Returns null on any failure. */
async function fetchBytes(url?: string | null): Promise<Uint8Array | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 15_000_000) return null;
    return bytes;
  } catch {
    return null;
  }
}

/** Logo bytes typed for pdf-lib — PNG/JPG only. */
async function fetchLogo(url?: string | null): Promise<{ bytes: Uint8Array; type: 'png' | 'jpg' } | null> {
  if (!url) return null;
  const lower = url.toLowerCase();
  const type: 'png' | 'jpg' | null =
    lower.includes('.png') ? 'png'
    : /\.jpe?g(\?|$)/.test(lower) ? 'jpg'
    : null;
  if (!type) return null;
  const bytes = await fetchBytes(url);
  if (!bytes || bytes.length > 3_000_000) return null;
  return { bytes, type };
}

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

interface BookingRow {
  id: string; dj_id: string | null; requester_id: string | null;
  host_email: string | null; requester_name: string | null;
  event_date: string | null; start_time: string | null; end_time: string | null;
  venue_name: string | null; venue_address: string | null; venue_type: string | null;
}

const EVENT_LABEL: Record<string, string> = {
  weddings: 'Wedding', wedding: 'Wedding', corporate: 'Corporate Event',
  birthday: 'Birthday Party', anniversary: 'Anniversary',
};
function eventLabel(t?: string | null): string {
  if (!t) return '';
  return EVENT_LABEL[t] || t.split(/[_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    const acting = await getActingContext(user.id);

    let body: { bookingId?: unknown; items?: unknown; mode?: unknown; pdfUrl?: unknown; name?: unknown; test?: unknown };
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
    const bookingId = typeof body.bookingId === 'string' ? body.bookingId : '';
    if (!bookingId) return NextResponse.json({ error: 'Missing booking.' }, { status: 400 });

    const mode = normalizeRiderMode(body.mode);
    const items = normalizeRiderItems(body.items);
    const pdfUrl = typeof body.pdfUrl === 'string' && body.pdfUrl ? body.pdfUrl : null;
    const riderName = typeof body.name === 'string' ? body.name.trim() : '';

    if (mode === 'upload') {
      if (!pdfUrl) return NextResponse.json({ error: 'Upload a rider PDF before sending.' }, { status: 400 });
    } else if (items.length === 0) {
      return NextResponse.json({ error: 'Add at least one rider field before sending.' }, { status: 400 });
    }

    const admin = createAdminClient() as unknown as SupabaseClient;
    const { data: bData } = await admin
      .from('bookings')
      .select('id, dj_id, requester_id, host_email, requester_name, event_date, start_time, end_time, venue_name, venue_address, venue_type')
      .eq('id', bookingId).maybeSingle();
    const b = bData as unknown as BookingRow | null;
    if (!b || b.dj_id !== acting.djId) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

    // DJ name + logo for the email and the generated PDF.
    const { data: djData } = await admin.from('users').select('name, contract_logo_url').eq('id', acting.djId).maybeSingle();
    const dj = djData as unknown as { name?: string | null; contract_logo_url?: string | null } | null;
    const djName = dj?.name || 'Your DJ';
    const isTest = body.test === true;

    // Persist. A real send marks the rider 'sent'; a test only needs a valid
    // /rider/[id] link, so it reuses the existing row (or makes a draft) and
    // never flips status or touches the library.
    let id: string;
    if (isTest) {
      const { data: ex } = await admin.from('booking_riders').select('id').eq('booking_id', bookingId).maybeSingle();
      if (ex) {
        id = (ex as unknown as { id: string }).id;
      } else {
        const { data: ins, error: insErr } = await admin
          .from('booking_riders')
          .insert({
            booking_id: bookingId, dj_id: acting.djId, items,
            rider_mode: mode, rider_pdf_url: pdfUrl, rider_name: riderName || null,
            status: 'draft', updated_at: new Date().toISOString(),
          } as unknown as never)
          .select('id')
          .single();
        if (insErr || !ins) return NextResponse.json({ error: 'Could not prepare the test.' }, { status: 500 });
        id = (ins as unknown as { id: string }).id;
      }
    } else {
      const { data: up, error } = await admin
        .from('booking_riders')
        .upsert({
          booking_id: bookingId, dj_id: acting.djId, items,
          rider_mode: mode, rider_pdf_url: pdfUrl, rider_name: riderName || null,
          status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        } as unknown as never, { onConflict: 'booking_id' })
        .select('id')
        .single();
      if (error || !up) return NextResponse.json({ error: 'Could not save the rider.' }, { status: 500 });
      id = (up as unknown as { id: string }).id;
    }
    const url = `${SITE_URL}/rider/${id}`;

    // Sending a NAMED rider also files it in the DJ's reusable library, so it's
    // there for one-click quick-send on the next booking. Never blocks the send.
    if (!isTest && riderName) {
      try {
        const { data: uRow } = await admin.from('users').select('booking_settings').eq('id', acting.djId).maybeSingle();
        const bsRaw = (uRow as unknown as { booking_settings?: unknown } | null)?.booking_settings;
        let settings: Record<string, unknown> = {};
        if (typeof bsRaw === 'string') { try { settings = JSON.parse(bsRaw) as Record<string, unknown>; } catch { settings = {}; } }
        else if (bsRaw && typeof bsRaw === 'object') { settings = bsRaw as Record<string, unknown>; }
        const named: NamedRider = { id: newRiderId(), name: riderName, mode, items, pdfUrl, updatedAt: new Date().toISOString() };
        settings.riders = upsertNamedRider(normalizeNamedRiders(settings.riders), named);
        // booking_settings is STRINGIFIED JSON everywhere else — stringify to
        // avoid corrupting the blob (which wiped equipment/rates).
        await admin.from('users').update({ booking_settings: JSON.stringify(settings) } as unknown as never).eq('id', acting.djId);
      } catch { /* library is a convenience — the send already succeeded */ }
    }

    // ── Build the attachment (never throws — the email still sends without it) ──
    let attachment: { filename: string; content: string } | null = null;
    try {
      if (mode === 'upload') {
        const bytes = await fetchBytes(pdfUrl);
        if (bytes) attachment = { filename: `DJ-Rider-${djName.replace(/[^a-z0-9]+/gi, '-')}.pdf`, content: Buffer.from(bytes).toString('base64') };
      } else {
        const when = fmtDate(b.event_date);
        const timeText = [fmtTime(b.start_time), fmtTime(b.end_time)].filter(Boolean).join(' – ');
        const logo = await fetchLogo(dj?.contract_logo_url);
        const pdfBytes = await buildRiderPdf({
          djName,
          logo,
          eventType: eventLabel(b.venue_type),
          dateText: b.event_date ? when : null,
          timeText: timeText || null,
          venueName: b.venue_name,
          venueAddress: b.venue_address,
          items,
        });
        attachment = { filename: `DJ-Rider-${djName.replace(/[^a-z0-9]+/gi, '-')}.pdf`, content: Buffer.from(pdfBytes).toString('base64') };
      }
    } catch {
      attachment = null;
    }

    // ── Recipient ── a TEST goes to whoever is signed in (so a teammate gets it
    // at THEIR own email), a real send goes to the host.
    const to = isTest
      ? (user.email ?? await resolveUserEmail(user.id))
      : (b.host_email || (b.requester_id ? await resolveUserEmail(b.requester_id) : null));
    if (isTest && !to) return NextResponse.json({ error: 'No email on your account to send the test to.' }, { status: 400 });
    if (to && process.env.RESEND_API_KEY) {
      const hi = b.requester_name?.trim() ? esc(b.requester_name.trim().split(' ')[0]) : 'there';
      const when = fmtDate(b.event_date);

      let bodyBlocks = '';
      if (mode === 'upload') {
        bodyBlocks = `<p style="margin:0 0 16px;color:#444;font-size:14px;line-height:1.7;">${esc(djName)}'s rider is attached to this email as a PDF. Please review it and let them know if anything can't be provided.</p>`;
      } else {
        const g = groupRider(items);
        const list = (arr: typeof items) => arr.map((i) => `<li style="margin:0 0 6px;color:#444;font-size:14px;line-height:1.6;">${esc(riderLine(i))}</li>`).join('');
        const secBlock = (label: string, arr: typeof items) => arr.length
          ? `<p style="margin:16px 0 6px;color:#111;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">${label}</p><ul style="margin:0 0 8px;padding-left:18px;">${list(arr)}</ul>` : '';
        bodyBlocks = RIDER_SECTIONS.map(({ key, label }) => secBlock(label, g[key])).join('');
      }

      const testNote = isTest
        ? `<p style="margin:0 0 16px;padding:10px 14px;background:#fff8e1;border:1px solid #ffe08a;border-radius:8px;color:#7a5b00;font-size:13px;line-height:1.6;">This is a <strong>test copy</strong> — exactly what the host receives. It was <strong>not</strong> sent to the host.</p>`
        : '';
      const content = `${testNote}
<h1 style="margin:0 0 6px;font-size:22px;color:#111;">Hi ${hi} — ${esc(djName)}'s rider</h1>
<p style="margin:0 0 16px;color:#666;font-size:14px;line-height:1.7;">
Here's what ${esc(djName)} needs from the venue for ${esc(when)}${b.venue_name ? ` at ${esc(b.venue_name)}` : ''}.${attachment ? ' The full rider is attached as a PDF.' : ''}
</p>
${bodyBlocks}
<table cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 6px;">
<tr><td style="background:#000000;border-radius:8px;">
<a href="${url}" style="display:inline-block;padding:14px 28px;color:#00f5c4;font-size:15px;font-weight:700;text-decoration:none;">View &amp; Confirm Rider</a>
</td></tr></table>
<p style="margin:14px 0 0;color:#999;font-size:12px;line-height:1.6;word-break:break-all;">Or paste this link:<br/><a href="${url}" style="color:#999;">${url}</a></p>`;
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: FROM, to, subject: `${isTest ? '[TEST] ' : ''}${djName} — DJ rider for ${when}`, html: shell(content),
          attachments: attachment ? [attachment] : undefined,
        });
      } catch {
        if (isTest) return NextResponse.json({ ok: true, test: true, warning: 'Could not send the test email — try again.' });
        return NextResponse.json({ ok: true, id, url, status: 'sent', hostName: b.requester_name || null, warning: 'Rider saved, but the email could not be sent. Copy the link instead.' });
      }
    }

    if (isTest) return NextResponse.json({ ok: true, test: true, emailedTo: to });
    return NextResponse.json({ ok: true, id, url, status: 'sent', hostName: b.requester_name || null, emailed: !!to });
  } catch {
    return NextResponse.json({ error: 'Could not send the rider.' }, { status: 500 });
  }
}
