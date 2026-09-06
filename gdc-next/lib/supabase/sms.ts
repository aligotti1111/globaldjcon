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
  sms_phone: string | null;
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
      .select('sms_phone, sms_enabled, sms_notify_booking_request, sms_notify_booking_status, sms_notify_inbox_message')
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
  if (!prefs.sms_phone) return;
  if (!prefs.sms_enabled) return;
  if (!prefs[subToggleCol(event)]) return;

  await dispatchSms(prefs.sms_phone, body, event);
}

// Normalize a raw phone to E.164 (+15551234567). Twilio rejects anything else
// with status 21211. Handles "(555) 555-5555", "555-555-5555", "+1 555 …":
// strip non-digits, prepend +1 for 10 digits (US default), + for 11+.
export function toE164(raw: string | null | undefined): string | null {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 10) return `+${digits}`;
  return null;
}

// Low-level Twilio send. Shared by the account-pref path and the per-booking
// path. Env vars set in Netlify: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
// TWILIO_PHONE_NUMBER. If any are missing (local dev), falls back to
// console.log so dev work isn't blocked. Never throws — SMS is best-effort.
async function dispatchSms(rawPhone: string, body: string, tag: string): Promise<void> {
  const to = toE164(rawPhone);
  if (!to) {
    console.warn('[sms] phone too short to dial, skipping:', rawPhone);
    return;
  }
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    console.log('[sms] Twilio creds missing — would send:', { to, tag, body });
    return;
  }
  try {
    const twilioMod = await import('twilio');
    const client = twilioMod.default(accountSid, authToken);
    const msg = await client.messages.create({ to, from: fromNumber, body });
    console.log('[sms] sent:', { to, tag, sid: msg.sid });
  } catch (e) {
    // Common error codes: 21211 (invalid To), 21408 (geo permission denied),
    // 21610 (unsubscribed via STOP), 30007 (carrier filtered, e.g., no A2P).
    console.error('[sms] Twilio send failed:', e);
  }
}

// ── Per-booking SMS ─────────────────────────────────────────────────────────
// A separate path from the account-pref one above: the host who filled out a
// booking request may have no account at all, so opt-in + phone live on the
// BOOKING (bookings.sms_opt_in, bookings.phone). One checkbox on the request
// form turns this on for that single booking. Fired on the four milestones:
// accepted, denied, contract sent, deposit/balance requested.
export type BookingSmsStage = 'accepted' | 'denied' | 'offer' | 'contract' | 'deposit' | 'balance';

// "2026-09-06" → "Sep 6". Noon-anchored so a timezone can't shift the day.
function shortDate(iso: string | null | undefined): string {
  if (!iso) return 'your event';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return 'your event';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Load the booking's opt-in + phone + context, compose the milestone message,
// and text the host. Gated ONLY by the per-booking opt-in + a phone on file —
// no account required. Safe to call unconditionally; misses return silently.
export async function notifyBookingSms(
  bookingId: string | null | undefined,
  stage: BookingSmsStage,
): Promise<void> {
  if (!bookingId) return;
  try {
    const admin = createAdminClient();
    const { data: b } = await admin
      .from('bookings')
      .select('phone, sms_opt_in, event_date, dj_id')
      .eq('id', bookingId)
      .maybeSingle<{ phone: string | null; sms_opt_in: boolean | null; event_date: string | null; dj_id: string | null }>();
    if (!b || !b.sms_opt_in || !b.phone) return;

    let djName = 'Your DJ';
    if (b.dj_id) {
      const { data: dj } = await admin
        .from('users').select('name').eq('id', b.dj_id).maybeSingle<{ name: string | null }>();
      if (dj?.name) djName = dj.name;
    }

    const date = shortDate(b.event_date);
    const lines: Record<BookingSmsStage, string> = {
      accepted: `Good news — ${djName} accepted your booking for ${date}. Details are in your email.`,
      denied:   `Update — ${djName} couldn't take your booking for ${date}. Details are in your email.`,
      offer:    `${djName} sent you an offer for your ${date} booking. Review it in your email.`,
      contract: `${djName} sent a contract to sign for your ${date} booking. Check your email to sign.`,
      deposit:  `${djName} requested a deposit for your ${date} booking. Check your email to pay.`,
      balance:  `${djName} requested the balance for your ${date} booking. Check your email to pay.`,
    };
    await dispatchSms(b.phone, withSmsFooter(lines[stage]), `booking_${stage}`);
  } catch (e) {
    console.error('[sms] notifyBookingSms failed:', e);
  }
}

// Compose the standard "Reply STOP to unsubscribe" footer.
// Append to every outbound SMS. Twilio + Supabase auto-handle STOP/HELP/START
// keywords at the carrier level — this footer is just the disclosure.
export function withSmsFooter(body: string): string {
  return `${body}\n\nReply STOP to unsubscribe.`;
}
