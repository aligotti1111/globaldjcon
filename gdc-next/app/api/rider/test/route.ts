// POST /api/rider/test — email the signed-in DJ a TEST copy of their DEFAULT
// rider, so they can see exactly what a host receives when the rider is sent
// through the site. No booking is involved: it renders from the rider the DJ is
// editing in Booking Settings (mode + items + pdf url + name), writes nothing to
// the database, and always goes to the DJ's own email address.
//
//   · custom mode — a branded PDF is generated from the fields (lib/riderPdf) and
//                   the same field list is shown in the email body.
//   · upload  mode — the DJ's uploaded PDF is fetched and attached as-is.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActingContext } from '@/lib/acting';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import {
  normalizeRiderItems, normalizeRiderMode, groupRiderBoxes, riderLine, riderHasFields,
  sectionAllowsAttachment, RIDER_ATTACHMENT_MAX_BYTES,
} from '@/lib/rider';
import { buildRiderPdf } from '@/lib/riderPdf';

export const runtime = 'nodejs';
export const maxDuration = 20;

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const SITE_URL = 'https://globaldjconnect.com';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    const acting = await getActingContext(user.id);

    let body: { items?: unknown; mode?: unknown; pdfUrl?: unknown; name?: unknown };
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

    const mode = normalizeRiderMode(body.mode);
    const items = normalizeRiderItems(body.items);
    const pdfUrl = typeof body.pdfUrl === 'string' && body.pdfUrl ? body.pdfUrl : null;
    const riderName = typeof body.name === 'string' ? body.name.trim() : '';

    if (mode === 'upload') {
      if (!pdfUrl) return NextResponse.json({ error: 'Upload a rider PDF before sending a test.' }, { status: 400 });
    } else if (!riderHasFields(items)) {
      return NextResponse.json({ error: 'Add at least one rider field before sending a test.' }, { status: 400 });
    }

    const admin = createAdminClient() as unknown as SupabaseClient;
    const { data: djData } = await admin.from('users').select('name, contract_logo_url').eq('id', acting.djId).maybeSingle();
    const dj = djData as unknown as { name?: string | null; contract_logo_url?: string | null } | null;
    const djName = dj?.name || 'Your DJ';

    const to = user.email ?? await resolveUserEmail(user.id);
    if (!to) return NextResponse.json({ error: 'No email on your account to send the test to.' }, { status: 400 });
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: 'Email is not configured.' }, { status: 500 });

    // ── Attachments — mirror a real send (rider PDF + any box attachments). ──
    const attachments: { filename: string; content: string }[] = [];
    try {
      if (mode === 'upload') {
        const bytes = await fetchBytes(pdfUrl);
        if (bytes) attachments.push({ filename: `DJ-Rider-${djName.replace(/[^a-z0-9]+/gi, '-')}.pdf`, content: Buffer.from(bytes).toString('base64') });
      } else {
        const logo = await fetchLogo(dj?.contract_logo_url);
        const pdfBytes = await buildRiderPdf({
          djName, logo, eventType: '', dateText: null, timeText: null,
          venueName: null, venueAddress: null, items,
        });
        attachments.push({ filename: `DJ-Rider-${djName.replace(/[^a-z0-9]+/gi, '-')}.pdf`, content: Buffer.from(pdfBytes).toString('base64') });
      }
    } catch { /* the email still sends without the PDF */ }

    const usedNames = new Set(attachments.map((a) => a.filename.toLowerCase()));
    try {
      const attBoxes = groupRiderBoxes(items).filter(
        (bx) => !bx.disabled && bx.attachmentUrl && sectionAllowsAttachment(bx.section),
      );
      for (const bx of attBoxes) {
        const bytes = await fetchBytes(bx.attachmentUrl);
        if (!bytes || bytes.length > RIDER_ATTACHMENT_MAX_BYTES) continue;
        let filename = (bx.attachmentName || `${bx.section}-attachment`).replace(/[\\/:*?"<>|]+/g, '-');
        if (usedNames.has(filename.toLowerCase())) filename = `${bx.section}-${filename}`;
        usedNames.add(filename.toLowerCase());
        attachments.push({ filename, content: Buffer.from(bytes).toString('base64') });
      }
    } catch { /* box attachments are best-effort */ }

    // ── Body — same layout as a real send, with placeholder host/event context. ──
    let bodyBlocks = '';
    if (mode === 'upload') {
      bodyBlocks = `<p style="margin:0 0 16px;color:#444;font-size:14px;line-height:1.7;">${esc(djName)}'s rider is attached to this email as a PDF. The host reviews it and lets you know if anything can't be provided.</p>`;
    } else {
      const boxes = groupRiderBoxes(items).filter((box) => !box.disabled && box.items.length);
      const list = (arr: typeof items) => arr.map((i) => `<li style="margin:0 0 6px;color:#444;font-size:14px;line-height:1.6;">${esc(riderLine(i))}</li>`).join('');
      const secBlock = (label: string, arr: typeof items) => arr.length
        ? `<p style="margin:16px 0 6px;color:#111;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">${esc(label)}</p><ul style="margin:0 0 8px;padding-left:18px;">${list(arr)}</ul>` : '';
      bodyBlocks = boxes.map((box) => secBlock(box.title, box.items)).join('');
    }

    const testNote = `<p style="margin:0 0 16px;padding:10px 14px;background:#fff8e1;border:1px solid #ffe08a;border-radius:8px;color:#7a5b00;font-size:13px;line-height:1.6;">This is a <strong>test copy</strong> — exactly what a host receives when you send this rider. It was <strong>not</strong> sent to anyone else.</p>`;
    const heading = riderName ? `${esc(djName)} — ${esc(riderName)}` : `${esc(djName)}'s rider`;
    const attachNote = attachments.length
      ? (attachments.length > 1 ? ' The full rider and its attachments are attached to this email.' : ' The full rider is attached as a PDF.')
      : '';
    const content = `${testNote}
<h1 style="margin:0 0 6px;font-size:22px;color:#111;">Hi there — ${heading}</h1>
<p style="margin:0 0 16px;color:#666;font-size:14px;line-height:1.7;">
Here's what ${esc(djName)} needs from the venue for your event.${attachNote}
</p>
${bodyBlocks}
<table cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 6px;">
<tr><td style="background:#000000;border-radius:8px;">
<a href="${SITE_URL}" style="display:inline-block;padding:14px 28px;color:#00f5c4;font-size:15px;font-weight:700;text-decoration:none;">View &amp; Confirm Rider</a>
</td></tr></table>
<p style="margin:14px 0 0;color:#999;font-size:12px;line-height:1.6;">In a real send this button opens the host's rider page. In this test it links to the site.</p>`;

    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const subject = `[TEST] ${djName} — ${riderName ? `${riderName} (DJ rider)` : 'DJ rider'}`;
      await resend.emails.send({
        from: FROM, to, subject, html: shell(content),
        attachments: attachments.length ? attachments : undefined,
      });
    } catch {
      return NextResponse.json({ error: 'Could not send the test email — try again.' }, { status: 502 });
    }

    return NextResponse.json({ ok: true, emailedTo: to });
  } catch {
    return NextResponse.json({ error: 'Could not send the test email.' }, { status: 500 });
  }
}
