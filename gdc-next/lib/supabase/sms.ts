// SMS notification helper.
//
// Looks up the user's SMS preferences, normalizes the phone to E.164, and
// sends via Twilio. Gates: user must have a phone on file, sms_enabled
// must be true, AND the per-event sub-toggle must be true. Any miss
// silently returns — SMS is best-effort, never blocks the email path.
//
// Env vars (set in Netlify): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
// TWILIO_PHONE_NUMBER. If creds are absent (local dev), falls back to
// console.log so dev work isn't blocked.
//
// Called from /api/send-email/route.ts AFTER the email is sent, so each
// event fires both channels in parallel. SMS failures are swallowed —
// the email is the source of truth, SMS is an extra channel.

import { createAdminClient } from './admin';

export type SmsEvent =
  | 'booking_request'    // DJ side — host just submitted a request
  | 'booking_status'     // host side — DJ approved/denied/countered
  | 'inbox_message';     // either side — new inbox message

interface SmsPrefs {
  phone: string | null;
  sms_enabled: boolean;
  sms_notify_booking_request: boolean;
  sms_notify_booking_status: boolean;
  sms_notify_inbox_message: boolean;
}

// Returns the column name on users that toggles a given event.
// Centralized so adding a new event type is one line.
function subToggleCol(event: SmsEvent): keyof SmsPrefs {
  switch (event) {
    case 'booking_request': return 'sms_notify_booking_request';
    case 'booking_status':  return 'sms_notify_booking_status';
    case 'inbox_message':   return 'sms_notify_inbox_message';
  }
}

// Look up the user's SMS prefs. Returns null on any failure — caller
// should treat null as "don't send" without surfacing an error.
async function loadSmsPrefs(userId: string): Promise<SmsPrefs | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('users')
      .select('phone, sms_enabled, sms_notify_booking_request, sms_notify_booking_status, sms_notify_inbox_message')
      .eq('id', userId)
      .maybeSingle<SmsPrefs>();
    if (error || !data) return null;
    return data;
  } catch (e) {
    console.error('[sms] loadSmsPrefs failed:', e);
    return null;
  }
}

// Public API. Call this anywhere an event happens that should optionally
// trigger an SMS. Safe to call regardless of whether the user has opted in
// — gating happens inside.
//
// userId: who to text (the recipient, not the sender)
// event: which sub-toggle to check
// body: the message text (already formatted, including any "Reply STOP")
export async function sendSmsNotification(
  userId: string,
  event: SmsEvent,
  body: string,
): Promise<void> {
  const prefs = await loadSmsPrefs(userId);
  if (!prefs) return;
  if (!prefs.phone) return;
  if (!prefs.sms_enabled) return;
  if (!prefs[subToggleCol(event)]) return;

  // Normalize the phone to E.164 (+15551234567). Twilio rejects anything
  // else with status 21211. Users will enter "(555) 555-5555", "555-555-5555",
  // "+1 555 555 5555", etc. — strip everything non-digit, then prepend +1
  // if it's 10 digits (US default) or + if it's 11+ digits.
  const digits = prefs.phone.replace(/\D/g, '');
  let to: string;
  if (digits.length === 10) {
    to = `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    to = `+${digits}`;
  } else if (digits.length >= 10) {
    // International — preserve as-is with leading +
    to = `+${digits}`;
  } else {
    console.warn('[sms] phone too short to dial, skipping:', prefs.phone);
    return;
  }

  // ── Twilio send ───────────────────────────────────────────────────
  // Env vars set in Netlify: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
  // TWILIO_PHONE_NUMBER. If any are missing (e.g., local dev without a
  // .env), fall back to console.log so dev work isn't blocked.
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    console.log('[sms] Twilio creds missing — would send:', { to, event, body });
    return;
  }
  try {
    const twilioMod = await import('twilio');
    const client = twilioMod.default(accountSid, authToken);
    const msg = await client.messages.create({ to, from: fromNumber, body });
    console.log('[sms] sent:', { to, event, sid: msg.sid });
  } catch (e) {
    // Best-effort — Twilio failures shouldn't break the email/booking flow.
    // Common error codes: 21211 (invalid To), 21408 (geo permission denied),
    // 21610 (unsubscribed via STOP), 30007 (carrier filtered, e.g., no A2P).
    console.error('[sms] Twilio send failed:', e);
  }
}

// Compose the standard "Reply STOP to unsubscribe" footer.
// Append to every outbound SMS. Twilio + Supabase auto-handle STOP/HELP/START
// keywords at the carrier level — this footer is just the disclosure.
export function withSmsFooter(body: string): string {
  return `${body}\n\nReply STOP to unsubscribe.`;
}
