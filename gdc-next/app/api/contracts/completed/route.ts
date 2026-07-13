// POST /api/contracts/completed
//
// DocuSeal webhook receiver. Fires when a contract submission is completed
// (all parties signed). It:
//   1. Marks the booking's contract_status = 'signed'.
//   2. Emails the DJ their signed copy + audit log (via Resend), since DocuSeal
//      can't email the DJ the final copy without also sending them a confusing
//      "please sign" request at creation.
//
// Point DocuSeal at this URL in Settings → Webhooks:
//   https://globaldjconnect.com/api/contracts/completed
// Optionally set DOCUSEAL_WEBHOOK_SECRET in Netlify and add a matching
// "?secret=..." to the webhook URL (or an X-Webhook-Secret header) to lock it.

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient, resolveUserEmail } from '@/lib/supabase/admin';
import { getDocuseal } from '@/lib/docuseal';

export const runtime = 'nodejs';
export const maxDuration = 26;

const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const REPLY_TO = 'info@globaldjconnect.com';
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

// Minimal branded wrapper — matches the /api/send-email look.
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

// Fetch a PDF URL and return it as a base64 string for a Resend attachment.
async function fetchB64(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.toString('base64');
  } catch { return null; }
}

export async function POST(req: Request) {
  // Optional shared-secret check.
  const secret = process.env.DOCUSEAL_WEBHOOK_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const provided = req.headers.get('x-webhook-secret') || url.searchParams.get('secret');
    if (provided !== secret) return NextResponse.json({ ok: false }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return NextResponse.json({ ok: true }); }

  const eventType = String(payload.event_type || payload.event || '');
  // Only react to completion-type events; ack everything else so DocuSeal
  // doesn't keep retrying.
  if (eventType !== 'submission.completed' && eventType !== 'form.completed') {
    return NextResponse.json({ ok: true, ignored: eventType });
  }

  const data = (payload.data || {}) as Record<string, unknown>;
  const nested = (data.submission || {}) as Record<string, unknown>;
  const submissionId =
    data.submission_id ?? nested.id ?? (eventType === 'submission.completed' ? data.id : undefined);
  if (submissionId == null) return NextResponse.json({ ok: true });

  try {
    const docuseal = getDocuseal();
    const sub = await docuseal.getSubmission(Number(submissionId)) as {
      status?: string;
      audit_log_url?: string | null;
      combined_document_url?: string | null;
      documents?: Array<{ url?: string | null }> | null;
    };
    // Only proceed once EVERY party has signed.
    if (sub.status !== 'completed') return NextResponse.json({ ok: true, pending: true });

    const contractUrl = sub.combined_document_url || sub.documents?.[0]?.url || null;
    const auditUrl = sub.audit_log_url || null;

    const admin = createAdminClient();
    const { data: bookingRow } = await admin
      .from('bookings')
      .select('id, dj_id, contract_status, event_date, venue_name')
      .eq('contract_submission_id', String(submissionId))
      .maybeSingle();
    const booking = bookingRow as {
      id: string; dj_id: string | null; contract_status: string | null;
      event_date: string | null; venue_name: string | null;
    } | null;
    if (!booking) return NextResponse.json({ ok: true, noBooking: true });

    // Idempotency: if we've already marked it signed, we already emailed — stop.
    if (booking.contract_status === 'signed') return NextResponse.json({ ok: true, already: true });

    // Mark signed (powers the "✓ Contract signed" state + in-app download).
    try {
      await admin.from('bookings').update({ contract_status: 'signed' } as unknown as never).eq('id', booking.id);
    } catch { /* non-fatal */ }

    // Email the DJ their signed copy + audit log.
    const djEmail = booking.dj_id ? await resolveUserEmail(booking.dj_id) : null;
    let djName = 'there';
    if (booking.dj_id) {
      const { data: p } = await admin.from('users').select('name').eq('id', booking.dj_id).maybeSingle();
      const n = (p as { name?: string | null } | null)?.name;
      if (n) djName = n;
    }

    if (djEmail && process.env.RESEND_API_KEY) {
      const attachments: { filename: string; content: string }[] = [];
      if (contractUrl) { const b = await fetchB64(contractUrl); if (b) attachments.push({ filename: 'Signed Contract.pdf', content: b }); }
      if (auditUrl) { const b = await fetchB64(auditUrl); if (b) attachments.push({ filename: 'Audit Log.pdf', content: b }); }

      const dateStr = fmtDate(booking.event_date);
      const where = [booking.venue_name, dateStr].filter(Boolean).join(' — ');
      const resend = new Resend(process.env.RESEND_API_KEY);
      try {
        await resend.emails.send({
          from: FROM,
          replyTo: REPLY_TO,
          to: [djEmail],
          subject: `Your signed contract${where ? ` — ${where}` : ''}`,
          html: emailTemplate(`
            <h2 style="font-family:'Bebas Neue',sans-serif;font-size:2rem;color:#1a1a2e;margin-bottom:8px;">Contract Signed ✅</h2>
            <p style="color:#666;margin-bottom:16px;">Hi ${escHtml(djName)}, your contract${where ? ` for <strong>${escHtml(where)}</strong>` : ''} has been signed by all parties. Your signed copy and the audit log are attached to this email.</p>
            <p style="color:#666;margin-bottom:24px;">You can also download them anytime from your Upcoming Bookings.</p>
            ${ctaButton(`${SITE_URL}/upcoming-bookings`, 'View Booking')}
          `),
          attachments: attachments.length ? attachments : undefined,
        } as unknown as Parameters<typeof resend.emails.send>[0]);
      } catch (e) {
        console.error('[contracts/completed] DJ email failed:', e);
      }
    }

    return NextResponse.json({ ok: true, signed: true });
  } catch (e) {
    console.error('[contracts/completed] error:', e);
    // Still 200 so DocuSeal doesn't hammer retries; we log for debugging.
    return NextResponse.json({ ok: true, error: e instanceof Error ? e.message : 'error' });
  }
}
