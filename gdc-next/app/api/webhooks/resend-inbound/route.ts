// POST /api/webhooks/resend-inbound
//
// Inbound-email handler for the "reply to the inbox notification email and it
// posts through the platform" feature. When someone replies to one of our inbox
// notification emails, the reply lands at a tokenized address
// (reply+<token>@<INBOUND_EMAIL_DOMAIN>). Resend's inbound service POSTs an
// `email.received` event here; we:
//   1. verify the webhook signature (Svix, same scheme as the opens webhook)
//   2. pull the token from the recipient address → (thread, replying user)
//   3. FETCH the email body from Resend (the webhook is metadata-only — the body,
//      headers and attachments are NOT in the payload; you retrieve them by id)
//   4. skip auto-replies / bounces so two auto-responders can't ping-pong
//   5. strip the quoted history so only the typed text remains
//   6. verify the replier actually belongs to the thread, and isn't blocked
//   7. insert it as a real message row from that user to the other party
//   8. email the other party a normal "new message" notification
//
// SETUP (one-time, outside the code):
//   - INBOUND_EMAIL_DOMAIN = the subdomain that receives replies
//     (e.g. reply.globaldjconnect.com), with its MX records pointed at Resend
//     inbound and this route set as the inbound webhook.
//   - RESEND_INBOUND_SECRET (whsec_...) = that webhook's signing secret.
//   - RESEND_API_KEY = already set (used to fetch the email body).
//   - CRON_SECRET = already set (used to call /api/send-email internally).
// Until INBOUND_EMAIL_DOMAIN is set the route no-ops (returns 200), so it's safe
// to deploy ahead of the DNS setup.

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseReplyToken, stripQuoted, lookupReplyToken } from '@/lib/emails/inboundReply';
import { SITE_URL } from '@/lib/emails/constants';

export const runtime = 'nodejs';

// Svix signature check — identical scheme to app/api/webhooks/resend (opens).
// Also rejects stale timestamps (replay guard): the signed timestamp must be
// within 5 minutes of now.
function verifySignature(secret: string, headers: Headers, body: string): boolean {
  const id = headers.get('svix-id');
  const ts = headers.get('svix-timestamp');
  const sigHeader = headers.get('svix-signature');
  if (!id || !ts || !sigHeader) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) return false;
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

// A quick browser/health check. Intentionally minimal — doesn't leak config.
export async function GET() {
  return NextResponse.json({ ok: true, route: 'resend-inbound' });
}

type AnyObj = Record<string, unknown>;
function asStr(v: unknown): string { return typeof v === 'string' ? v : ''; }

// The webhook payload's recipient list (data.to is an array of bare addresses).
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
  push(data.received_for);
  push(data.recipient);
  return out;
}

// Crude HTML → text for emails that only have an html part.
function htmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#3[49];/g, "'");
}

// Retrieve the full received email (body + headers) by id. The webhook payload
// is metadata-only, so this is REQUIRED to get the reply text.
async function fetchReceivedEmail(emailId: string): Promise<{ text: string; headers: AnyObj } | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !emailId) return null;
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    const email = (await res.json()) as AnyObj;
    const text = asStr(email.text) || htmlToText(asStr(email.html));
    const headers = (email.headers && typeof email.headers === 'object' ? email.headers as AnyObj : {});
    return { text, headers };
  } catch {
    return null;
  }
}

// Drop auto-replies, out-of-office, bounces, list mail — so a tokenized Reply-To
// can't start an auto-responder ping-pong or post a vacation notice as a message.
function isAutomated(headers: AnyObj, from: string): boolean {
  const h = (k: string) => asStr(headers[k] ?? headers[k.toLowerCase()]).toLowerCase();
  const autoSubmitted = h('auto-submitted');
  if (autoSubmitted && autoSubmitted !== 'no') return true;
  const precedence = h('precedence');
  if (['bulk', 'auto_reply', 'junk', 'list'].includes(precedence)) return true;
  if (h('x-autoreply') || h('x-autorespond') || h('x-auto-response-suppress')) return true;
  const f = (from || '').toLowerCase();
  if (/(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/.test(f)) return true;
  return false;
}

export async function POST(req: Request) {
  const raw = await req.text();

  const secret = process.env.RESEND_INBOUND_SECRET;
  if (secret) {
    if (!verifySignature(secret, req.headers, raw)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  } else {
    console.warn('[resend-inbound] RESEND_INBOUND_SECRET not set — processing unverified. Set it before launch.');
  }

  let evt: AnyObj;
  try { evt = JSON.parse(raw) as AnyObj; } catch { return NextResponse.json({ ok: true }); }
  if (asStr(evt.type) && evt.type !== 'email.received') {
    return NextResponse.json({ ok: true, ignored: 'wrong-type' });
  }
  const data: AnyObj = (evt.data && typeof evt.data === 'object' ? evt.data as AnyObj : evt);

  // 1. Token → (thread, replier).
  const token = parseReplyToken(collectRecipients(data));
  if (!token) return NextResponse.json({ ok: true, ignored: 'no-token' });

  const admin = createAdminClient();
  try {
    const resolved = await lookupReplyToken(admin, token);
    if (!resolved) return NextResponse.json({ ok: true, ignored: 'unknown-token' });
    const { parentId, replierUserId } = resolved;

    // 2. Fetch the real body (webhook is metadata-only) + drop automated mail.
    const emailId = asStr(data.email_id) || asStr(data.id);
    const fetched = await fetchReceivedEmail(emailId);
    if (!fetched) return NextResponse.json({ ok: true, ignored: 'no-body' });
    if (isAutomated(fetched.headers, asStr(data.from))) {
      return NextResponse.json({ ok: true, ignored: 'automated' });
    }

    const message = stripQuoted(fetched.text).slice(0, 5000);
    if (!message) return NextResponse.json({ ok: true, ignored: 'empty-body' });

    // 3. Load the thread. The replier MUST be a participant (parent or a reply),
    // and we resolve the OTHER party as the recipient.
    const { data: thread } = await admin
      .from('messages')
      .select('id, from_user_id, to_user_id, subject, parent_id')
      .or(`id.eq.${parentId},parent_id.eq.${parentId}`);
    const rows = (thread as { id: string; from_user_id?: string; to_user_id?: string; subject?: string; parent_id?: string | null }[] | null) || [];
    const parent = rows.find((r) => r.id === parentId) || null;
    if (!parent) return NextResponse.json({ ok: true, ignored: 'thread-gone' });

    const participants = new Set<string>();
    for (const r of rows) {
      if (r.from_user_id) participants.add(r.from_user_id);
      if (r.to_user_id) participants.add(r.to_user_id);
    }
    if (!participants.has(replierUserId)) {
      // The token's user isn't actually in this thread — refuse (defends against
      // a token minted for a thread the user was never part of).
      return NextResponse.json({ ok: true, ignored: 'not-participant' });
    }
    let otherUserId: string | null = null;
    for (const id of participants) { if (id !== replierUserId) { otherUserId = id; break; } }
    if (!otherUserId) return NextResponse.json({ ok: true, ignored: 'no-recipient' });

    // 4. Block check — if the recipient has blocked the replier, drop it. (The
    // messages insert trigger also enforces this, but short-circuit to avoid a
    // noisy exception + to skip the notification.)
    try {
      const { data: ru } = await admin.from('users').select('blocked_users').eq('id', otherUserId).maybeSingle();
      const blocked = (ru as { blocked_users?: string[] | null } | null)?.blocked_users || [];
      if (blocked.includes(replierUserId)) {
        return NextResponse.json({ ok: true, ignored: 'blocked' });
      }
    } catch { /* fall through — the trigger is the backstop */ }

    const { data: ruName } = await admin.from('users').select('name').eq('id', replierUserId).maybeSingle();
    const replierName = ((ruName as { name?: string | null } | null)?.name) || 'A user';
    const subject = (parent.subject || '').startsWith('Re:') ? parent.subject : 'Re: ' + (parent.subject || '(no subject)');

    // 5. Insert the reply. (A DB trigger rejects it if the recipient blocked the
    // sender — caught below and treated as ignored.)
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
    if (insErr) {
      if (/blocked/i.test(insErr.message || '')) return NextResponse.json({ ok: true, ignored: 'blocked' });
      throw insErr;
    }

    // 6. Notify the other party (server-to-server; threadId keeps THEIR reply
    // email repliable too). Failures here don't undo the stored message.
    try {
      const r = await fetch(`${SITE_URL}/api/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.CRON_SECRET || '' },
        body: JSON.stringify({
          type: 'inbox_notification',
          recipientUserId: otherUserId,
          senderName: replierName,
          subject,
          message,
          threadId: parentId,
        }),
      });
      if (!r.ok) console.warn('[resend-inbound] notify non-OK:', r.status);
    } catch (e) {
      console.warn('[resend-inbound] notify failed:', e);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[resend-inbound] error:', e);
    return NextResponse.json({ ok: true, error: 'handled' });
  }
}
