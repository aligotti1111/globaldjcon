// POST /api/webhooks/resend-inbound
//
// Inbound-email handler for the "reply to the inbox notification email and it
// posts through the platform" feature. When a DJ (or anyone) replies to one of
// our inbox notification emails, the reply lands at a tokenized address
// (reply+<token>@<INBOUND_EMAIL_DOMAIN>). The email provider (Resend inbound)
// POSTs the parsed message here; we:
//   1. verify the webhook signature (Svix, same scheme as the opens webhook)
//   2. pull the token from the recipient address → (thread, replying user)
//   3. strip the quoted history so only the typed text remains
//   4. insert it as a real message row from that user to the other party
//   5. email the other party a normal "new message" notification
//
// SETUP (one-time, outside the code):
//   - Set INBOUND_EMAIL_DOMAIN to the subdomain that receives replies
//     (e.g. reply.globaldjconnect.com).
//   - Point that subdomain's MX records at Resend's inbound service and add
//     this route as the inbound webhook in the Resend dashboard.
//   - Set RESEND_INBOUND_SECRET (whsec_...) to the inbound webhook's signing
//     secret (falls back to RESEND_WEBHOOK_SECRET if you reuse one).
// Until that's done the route just no-ops (returns 200), so it's safe to deploy.

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseReplyToken, stripQuoted, lookupReplyToken } from '@/lib/emails/inboundReply';
import { SITE_URL } from '@/lib/emails/constants';

export const runtime = 'nodejs';

// Svix signature check — identical scheme to app/api/webhooks/resend (opens).
function verifySignature(secret: string, headers: Headers, body: string): boolean {
  const id = headers.get('svix-id');
  const ts = headers.get('svix-timestamp');
  const sigHeader = headers.get('svix-signature');
  if (!id || !ts || !sigHeader) return false;
  let secretBytes: Buffer;
  try { secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64'); } catch { return false; }
  const signed = `${id}.${ts}.${body}`;
  const expected = crypto.createHmac('sha256', secretBytes).update(signed).digest('base64');
  const expBuf = Buffer.from(expected);
  return sigHeader.split(' ').some((part) => {
    const v = part.split(',')[1];
    if (!v) return false;
    const vBuf = Buffer.from(v);
    return vBuf.length === expBuf.length && crypto.timingSafeEqual(vBuf, expBuf);
  });
}

// A quick browser/health check: is the route deployed and is a secret set?
export async function GET() {
  return NextResponse.json({
    ok: true,
    route: 'resend-inbound',
    hasSecret: !!(process.env.RESEND_INBOUND_SECRET || process.env.RESEND_WEBHOOK_SECRET),
    inboundDomain: process.env.INBOUND_EMAIL_DOMAIN || null,
  });
}

// Resend inbound payloads vary a little by version; pull recipients/body
// defensively from the likeliest fields.
type AnyObj = Record<string, unknown>;
function asStr(v: unknown): string { return typeof v === 'string' ? v : ''; }
function collectRecipients(data: AnyObj): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (!v) return;
    if (typeof v === 'string') { out.push(v); return; }
    if (Array.isArray(v)) { v.forEach(push); return; }
    if (typeof v === 'object') {
      const o = v as AnyObj;
      const addr = asStr(o.address) || asStr(o.email);
      if (addr) out.push(addr);
    }
  };
  push(data.to);
  push((data as AnyObj).to_addresses);
  push((data as AnyObj).recipient);
  push((data as AnyObj).envelope && (data.envelope as AnyObj).to);
  return out;
}
function bodyText(data: AnyObj): string {
  const t = asStr(data.text) || asStr((data as AnyObj).plain) || asStr((data as AnyObj).body);
  if (t) return t;
  // Last resort: crude HTML → text so a reply with no plain part still works.
  const html = asStr(data.html);
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>(?=)/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export async function POST(req: Request) {
  const raw = await req.text();

  // Verify when a secret is configured. Without one we still process (so the
  // feature works the moment DNS + webhook are wired), but you SHOULD set the
  // secret before launch — this route writes messages on users' behalf.
  const secret = process.env.RESEND_INBOUND_SECRET || process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    if (!verifySignature(secret, req.headers, raw)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  } else {
    console.warn('[resend-inbound] no signing secret set — processing unverified. Set RESEND_INBOUND_SECRET before launch.');
  }

  let evt: AnyObj;
  try { evt = JSON.parse(raw) as AnyObj; } catch { return NextResponse.json({ ok: true }); }
  // Payload shape: { type, data: {...} } — fall back to the top level if no data.
  const data: AnyObj = (evt.data && typeof evt.data === 'object' ? evt.data as AnyObj : evt);

  // 1. Token → (thread, replier).
  const recipients = collectRecipients(data);
  const token = parseReplyToken(recipients);
  if (!token) {
    // Not one of our reply addresses (or inbound domain not configured) — ignore.
    return NextResponse.json({ ok: true, ignored: 'no-token' });
  }

  const admin = createAdminClient();
  try {
    const resolved = await lookupReplyToken(admin, token);
    if (!resolved) {
      return NextResponse.json({ ok: true, ignored: 'unknown-token' });
    }
    const { parentId, replierUserId } = resolved;

    // 2. Clean the body.
    const message = stripQuoted(bodyText(data));
    if (!message) {
      return NextResponse.json({ ok: true, ignored: 'empty-body' });
    }

    // 3. Resolve the thread + the OTHER party (who should receive this reply).
    const { data: parent } = await admin
      .from('messages')
      .select('id, from_user_id, to_user_id, subject')
      .eq('id', parentId)
      .maybeSingle();
    const p = parent as { from_user_id?: string; to_user_id?: string; subject?: string } | null;
    if (!p) return NextResponse.json({ ok: true, ignored: 'thread-gone' });

    // The other party is whoever in the thread isn't the replier. Scan the whole
    // thread (parent + replies) so we find them even on multi-party history.
    let otherUserId: string | null = null;
    if (p.from_user_id && p.from_user_id !== replierUserId) {
      otherUserId = p.from_user_id;
    } else if (p.to_user_id && p.to_user_id !== replierUserId) {
      otherUserId = p.to_user_id;
    }
    if (!otherUserId) {
      const { data: thread } = await admin
        .from('messages')
        .select('from_user_id, to_user_id')
        .or(`id.eq.${parentId},parent_id.eq.${parentId}`);
      for (const m of ((thread as { from_user_id?: string; to_user_id?: string }[] | null) || [])) {
        if (m.from_user_id && m.from_user_id !== replierUserId) { otherUserId = m.from_user_id; break; }
        if (m.to_user_id && m.to_user_id !== replierUserId) { otherUserId = m.to_user_id; break; }
      }
    }
    if (!otherUserId) return NextResponse.json({ ok: true, ignored: 'no-recipient' });

    // Replier's display name for the bubble + the outgoing notification.
    const { data: ru } = await admin
      .from('users').select('name').eq('id', replierUserId).maybeSingle();
    const replierName = ((ru as { name?: string | null } | null)?.name) || 'A user';

    const subject = (p.subject || '').startsWith('Re:') ? p.subject : 'Re: ' + (p.subject || '(no subject)');

    // 4. Insert the reply as a real message row.
    const { error: insErr } = await admin
      .from('messages')
      .insert({
        parent_id: parentId,
        to_user_id: otherUserId,
        from_user_id: replierUserId,
        from_name: replierName,
        subject,
        message,
        read: false,
      } as unknown as never);
    if (insErr) throw insErr;

    // 5. Notify the other party (server-to-server; threadId keeps THEIR reply
    // email repliable too). Failures here don't undo the stored message.
    try {
      await fetch(`${SITE_URL}/api/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': process.env.CRON_SECRET || '',
        },
        body: JSON.stringify({
          type: 'inbox_notification',
          recipientUserId: otherUserId,
          senderName: replierName,
          subject,
          message,
          threadId: parentId,
        }),
      });
    } catch (e) {
      console.warn('[resend-inbound] notify failed:', e);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[resend-inbound] error:', e);
    // Return 200 so the provider doesn't retry-storm on a transient error; the
    // failure is logged. (Signature failures already returned 401 above.)
    return NextResponse.json({ ok: true, error: 'handled' });
  }
}
