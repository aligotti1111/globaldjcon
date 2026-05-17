// SMS notification helper.
//
// Looks up the user's SMS preferences and (eventually) sends a Twilio
// text. Until Twilio is configured, this is a no-op that console.logs
// what WOULD have been sent — lets us ship the UI + DB changes safely
// and bolt on Twilio later without touching any callers.
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
//
// Future: when Twilio is wired, replace the console.log block with a
// real send. No caller changes required.
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

  // ── Twilio send goes here ─────────────────────────────────────────
  // For now: log what we WOULD have sent. Replace with Twilio call when
  // ready. Keep the gating above intact — that's the user-facing
  // contract.
  console.log('[sms] (stub — Twilio not yet configured) would send:', {
    to: prefs.phone,
    event,
    body,
  });
  // ──────────────────────────────────────────────────────────────────

  // Example shape when Twilio is added:
  //
  // const accountSid = process.env.TWILIO_ACCOUNT_SID;
  // const authToken  = process.env.TWILIO_AUTH_TOKEN;
  // const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  // if (!accountSid || !authToken || !fromNumber) return;
  // try {
  //   const twilio = (await import('twilio')).default(accountSid, authToken);
  //   await twilio.messages.create({
  //     to: prefs.phone,
  //     from: fromNumber,
  //     body,
  //   });
  // } catch (e) {
  //   console.error('[sms] Twilio send failed:', e);
  // }
}

// Compose the standard "Reply STOP to unsubscribe" footer.
// Append to every outbound SMS. Twilio + Supabase auto-handle STOP/HELP/START
// keywords at the carrier level — this footer is just the disclosure.
export function withSmsFooter(body: string): string {
  return `${body}\n\nReply STOP to unsubscribe.`;
}
