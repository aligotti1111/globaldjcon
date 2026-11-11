// lib/emails/inboundReply.ts
//
// Helpers for the "reply to the inbox email and it posts through the platform"
// feature. A notification email's Reply-To is set to a tokenized address
// (reply+<token>@<inbound-domain>); when the recipient replies, the inbound
// webhook (app/api/webhooks/resend-inbound) parses that token back to the thread
// and the replying user, strips the quoted history, and posts the text as a real
// message.
//
// Turned on by setting INBOUND_EMAIL_DOMAIN (e.g. "reply.globaldjconnect.com")
// AND pointing that domain's MX records at the inbound email provider (Resend
// inbound) with the webhook configured. With the env var unset, everything below
// degrades gracefully: notifications keep their normal Reply-To and there's
// simply no email-to-platform routing.

import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

// The subdomain that receives replies. No default on purpose — inbound only
// works once DNS is set up, so we don't want to advertise a dead address.
export function inboundDomain(): string | null {
  const d = (process.env.INBOUND_EMAIL_DOMAIN || '').trim().toLowerCase();
  return d || null;
}
export function isInboundConfigured(): boolean {
  return !!inboundDomain();
}

// reply+<token>@<domain>
export function replyAddressFor(token: string): string | null {
  const domain = inboundDomain();
  if (!domain) return null;
  return `reply+${token}@${domain}`;
}

// Opaque, URL/email-safe token. 18 bytes → 36 hex chars; keeps the whole local
// part (reply+<token>) comfortably under the 64-char RFC limit.
function newToken(): string {
  return crypto.randomBytes(18).toString('hex');
}

// Find (or create) the reply token for a given thread + replying user. Admin
// client required (RLS-free). Returns null if inbound isn't configured.
export async function getOrCreateReplyToken(
  admin: SupabaseClient,
  parentId: string,
  replierUserId: string,
): Promise<string | null> {
  if (!isInboundConfigured()) return null;
  try {
    const { data: existing } = await admin
      .from('inbox_reply_tokens')
      .select('token')
      .eq('parent_id', parentId)
      .eq('replier_user_id', replierUserId)
      .maybeSingle();
    const found = (existing as { token?: string } | null)?.token;
    if (found) return found;

    const token = newToken();
    const { error } = await admin
      .from('inbox_reply_tokens')
      .insert({ token, parent_id: parentId, replier_user_id: replierUserId } as unknown as never);
    if (error) {
      // Unique-violation race: another request created the pair first — re-read.
      const { data: again } = await admin
        .from('inbox_reply_tokens')
        .select('token')
        .eq('parent_id', parentId)
        .eq('replier_user_id', replierUserId)
        .maybeSingle();
      return (again as { token?: string } | null)?.token || null;
    }
    return token;
  } catch {
    return null;
  }
}

// Resolve a token back to its (thread, replier). Kept here (untyped client) so
// the inbox_reply_tokens table — not in the generated DB types — doesn't trip
// the typed admin client at the call site.
export async function lookupReplyToken(
  admin: SupabaseClient,
  token: string,
): Promise<{ parentId: string; replierUserId: string } | null> {
  try {
    const { data } = await admin
      .from('inbox_reply_tokens')
      .select('parent_id, replier_user_id')
      .eq('token', token)
      .maybeSingle();
    const row = data as { parent_id?: string; replier_user_id?: string } | null;
    if (!row?.parent_id || !row?.replier_user_id) return null;
    return { parentId: row.parent_id, replierUserId: row.replier_user_id };
  } catch {
    return null;
  }
}

// Pull the token out of any of the inbound email's recipient addresses. Accepts
// a raw address, a display-name form ("Foo <reply+abc@d>"), or a comma list, and
// matches the reply+<token>@<our-domain> shape (case-insensitive).
export function parseReplyToken(toField: string | string[] | null | undefined): string | null {
  const domain = inboundDomain();
  if (!domain) return null;
  const candidates = Array.isArray(toField) ? toField : [toField || ''];
  const re = new RegExp(`reply\\+([a-f0-9]{8,})@${domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  for (const c of candidates) {
    const m = (c || '').match(re);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

// Strip the quoted reply history + common signatures so the stored message is
// just what the person actually typed. Heuristic, but covers the usual clients:
//   - "On <date>, <name> wrote:" (Gmail/Apple)
//   - a run of ">" quoted lines
//   - "-----Original Message-----" (Outlook)
//   - "________" divider (Outlook web)
//   - "Sent from my iPhone" style footers
export function stripQuoted(raw: string): string {
  if (!raw) return '';
  // Normalize newlines.
  const text = raw.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const out: string[] = [];
  const onWrote = /^\s*On .+ wrote:\s*$/i;
  const origMsg = /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i;
  const outlookDivider = /^\s*_{5,}\s*$/;
  const fromHeader = /^\s*(From|De|Von):\s.+/i;
  const sentFrom = /^\s*Sent from my \w+/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (onWrote.test(line) || origMsg.test(line) || outlookDivider.test(line) || fromHeader.test(line)) {
      break; // everything from here down is quoted history
    }
    if (sentFrom.test(line)) {
      break; // drop a trailing mobile signature
    }
    // A block of ">"-quoted lines signals the quoted section too — stop at the
    // first one (after trimming trailing blank lines we kept).
    if (/^\s*>/.test(line)) break;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
