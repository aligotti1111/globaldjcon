// POST /api/contracts/send-client
//
// Called after the DJ has reviewed and signed their contract. Emails the client
// their signing link — FROM Global DJ Connect (via Resend), not from DocuSeal.
//
// Why not let DocuSeal email them? Flipping the client submitter's send_email
// to true makes DocuSeal send BOTH the signing request AND, at completion, the
// signed-document copy — from DocuSeal's address. We want every client email to
// come from Global DJ Connect, so we keep DocuSeal silent for the client and
// send the request ourselves here. The signed copy is emailed by the completion
// webhook (/api/contracts/completed), also from Global DJ Connect.

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import { getDocuseal } from '@/lib/docuseal';

export const runtime = 'nodejs';
export const maxDuration = 26;

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const SITE_URL = 'https://globaldjconnect.com';

function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  const dt = new Date(d + 'T12:00:00');
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function escHtml(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function emailTemplate(content: string): string {
  return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
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

function ctaButton(href: string, label: string): string {
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td style="background:#0a6f61;border-radius:6px;"><a href="${href}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">${label}</a></td></tr></table>`;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: { bookingId?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const bookingId = typeof body.bookingId === 'string' && body.bookingId ? body.bookingId : null;
  if (!bookingId) return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });

  const admin = createAdminClient();

  // Find the submission + booking context (DJ must own it).
  let submissionId: string | null = null;
  let booking: {
    dj_id: string | null; host_email: string | null; requester_name: string | null;
    venue_name: string | null; event_date: string | null;
  } | null = null;
  try {
    const { data } = await admin
      .from('bookings')
      .select('contract_submission_id, dj_id, host_email, requester_name, venue_name, event_date')
      .eq('id', bookingId)
      .eq('dj_id', user.id)
      .maybeSingle();
    const row = data as {
      contract_submission_id?: string | null;
      dj_id: string | null; host_email: string | null; requester_name: string | null;
      venue_name: string | null; event_date: string | null;
    } | null;
    submissionId = row?.contract_submission_id || null;
    booking = row ? {
      dj_id: row.dj_id, host_email: row.host_email, requester_name: row.requester_name,
      venue_name: row.venue_name, event_date: row.event_date,
    } : null;
  } catch { submissionId = null; }
  if (!submissionId) return NextResponse.json({ error: 'No contract found for this booking.' }, { status: 404 });

  // Look up the client submitter → its signing link + email.
  let signUrl = '';
  let clientEmail = (booking?.host_email || '').trim();
  try {
    const docuseal = getDocuseal();
    const submission = await docuseal.getSubmission(Number(submissionId));
    type Submitter = { id?: number | string; role?: string; slug?: string; email?: string };
    const submitters = ((submission as { submitters?: Submitter[] })?.submitters) || [];
    const client = submitters.find((s) => s.role === 'Client');
    if (!client?.slug) throw new Error('Client signer not found on the contract.');
    signUrl = `https://docuseal.com/s/${client.slug}`;
    if (!clientEmail) clientEmail = (client.email || '').trim();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not prepare the client email.' },
      { status: 502 },
    );
  }

  if (!clientEmail) return NextResponse.json({ error: 'No client email on file for this booking.' }, { status: 400 });
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: 'Email is not configured.' }, { status: 500 });

  // Reply-To the DJ so the client can reach them directly.
  const djEmail = booking?.dj_id ? await resolveUserEmail(booking.dj_id) : null;
  let djName = 'your DJ';
  if (booking?.dj_id) {
    const { data: p } = await admin.from('users').select('name, company').eq('id', booking.dj_id).maybeSingle();
    const row = p as { name?: string | null; company?: string | null } | null;
    djName = (row?.company || row?.name || '').trim() || 'your DJ';
  }

  const greetingName = (booking?.requester_name || '').trim() || 'there';
  const dateStr = fmtDate(booking?.event_date);
  const where = [booking?.venue_name, dateStr].filter(Boolean).join(' — ');

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      replyTo: djEmail || 'info@globaldjconnect.com',
      to: [clientEmail],
      subject: `Review & sign your contract${where ? ` — ${where}` : ''}`,
      html: emailTemplate(`
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Your contract is ready to sign</h2>
        <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(greetingName)}, ${escHtml(djName)} has prepared your contract${where ? ` for <strong>${escHtml(where)}</strong>` : ''} and signed their part. Please review and add your signature below.</p>
        <div style="margin:24px 0;">${ctaButton(signUrl, 'Review & Sign')}</div>
        <p style="color:#999;font-size:12px;line-height:1.6;">If the button doesn't work, copy and paste this link:<br><a href="${signUrl}" style="color:#0a6f61;">${signUrl}</a></p>
      `),
    } as unknown as Parameters<typeof resend.emails.send>[0]);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not email the client.' }, { status: 502 });
  }

  try {
    await admin
      .from('bookings')
      .update({ contract_status: 'awaiting_client' } as unknown as never)
      .eq('id', bookingId)
      .eq('dj_id', user.id);
  } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true });
}
