'use client';

// NotificationsClient — owns the notification-preferences UI + save.
//
// Layout:
//   1. Text Setup card — phone number + the TCPA consent toggle + legal copy.
//      This is the master gate for the whole Text column: the per-type text
//      checkboxes only become active once a valid phone is on file AND
//      "Send me text notifications" is checked.
//   2. Matrix card — one row per notification type, two checkbox columns
//      (Email / Text). Email is always toggleable; Text is gated by the
//      setup above.
//
// Row visibility: hosts and venues don't receive booking REQUESTS (those only
// flow to DJs), so they only see the booking-status + inbox-message rows.
//
// DJ requirement: a DJ must keep at least ONE channel on for "new booking
// request" — it's the one alert they can't afford to miss. Enforced live
// (unchecking the last active channel is blocked with an inline note) and
// again as a hard guard at save. Turning the master text toggle off while
// email was the only-off channel re-asserts email so the rule always holds.
//
// Dirty reporting: when mounted inside a tab (Account Settings → Notifications)
// the parent wants to show an "unsaved" dot, so we report whether the current
// toggles differ from the last-saved snapshot via onDirtyChange.

import { Fragment, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './notifications.module.css';

type RowKey = 'booking_request' | 'booking_status' | 'inbox_message';

interface PrefsInit {
  role: string;
  sms_phone: string;
  sms_enabled: boolean;
  sms_notify_booking_request: boolean;
  sms_notify_booking_status: boolean;
  sms_notify_inbox_message: boolean;
  email_notify_booking_request: boolean;
  email_notify_booking_status: boolean;
  email_notify_inbox_message: boolean;
}

interface Props {
  userId: string;
  init: PrefsInit;
  // Reports whether there are unsaved edits — drives the parent tab's dot.
  onDirtyChange?: (dirty: boolean) => void;
}

type Alert = { type: 'success' | 'error'; msg: string } | null;

const ROWS: { key: RowKey; label: string; djOnly?: boolean }[] = [
  { key: 'booking_request', label: 'New booking request', djOnly: true },
  { key: 'booking_status', label: 'Booking approved, denied, or countered' },
  { key: 'inbox_message', label: 'New inbox message' },
];

const REQUIRED_NOTE = 'Keep at least one alert on for new booking requests.';

function digitsOf(s: string): number {
  return s.replace(/\D/g, '').length;
}

export default function NotificationsClient({ userId, init, onDirtyChange }: Props) {
  const isDj = init.role === 'dj';
  const isTeammate = init.role === 'teammate';

  // ── Text setup (master gate) ──────────────────────────────────────
  const [smsPhone, setSmsPhone] = useState(init.sms_phone);
  const [smsEnabled, setSmsEnabled] = useState(init.sms_enabled);

  // ── Per-type toggles, keyed by row ────────────────────────────────
  const [email, setEmail] = useState<Record<RowKey, boolean>>({
    booking_request: init.email_notify_booking_request,
    booking_status: init.email_notify_booking_status,
    inbox_message: init.email_notify_inbox_message,
  });
  const [text, setText] = useState<Record<RowKey, boolean>>({
    booking_request: init.sms_notify_booking_request,
    booking_status: init.sms_notify_booking_status,
    inbox_message: init.sms_notify_inbox_message,
  });

  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<Alert>(null);
  const [brNote, setBrNote] = useState<string | null>(null);

  // Last-saved snapshot — starts at the loaded prefs and advances on each
  // successful save. "Dirty" is measured against this, so the unsaved dot
  // clears the moment a save lands.
  const [savedSnap, setSavedSnap] = useState({
    smsPhone: init.sms_phone,
    smsEnabled: init.sms_enabled,
    email: {
      booking_request: init.email_notify_booking_request,
      booking_status: init.email_notify_booking_status,
      inbox_message: init.email_notify_inbox_message,
    } as Record<RowKey, boolean>,
    text: {
      booking_request: init.sms_notify_booking_request,
      booking_status: init.sms_notify_booking_status,
      inbox_message: init.sms_notify_inbox_message,
    } as Record<RowKey, boolean>,
  });

  const dirty =
    smsPhone !== savedSnap.smsPhone ||
    smsEnabled !== savedSnap.smsEnabled ||
    email.booking_request !== savedSnap.email.booking_request ||
    email.booking_status !== savedSnap.email.booking_status ||
    email.inbox_message !== savedSnap.email.inbox_message ||
    text.booking_request !== savedSnap.text.booking_request ||
    text.booking_status !== savedSnap.text.booking_status ||
    text.inbox_message !== savedSnap.text.inbox_message;

  // Report dirty upward without making onDirtyChange a hard dependency.
  const onDirtyRef = useRef(onDirtyChange);
  useEffect(() => { onDirtyRef.current = onDirtyChange; });
  useEffect(() => { onDirtyRef.current?.(dirty); }, [dirty]);
  // Clear the parent's dot on unmount so a hidden tab never keeps it lit.
  useEffect(() => () => onDirtyRef.current?.(false), []);

  // Text column is only usable when there's a valid phone AND consent is on.
  const smsReady = smsEnabled && digitsOf(smsPhone) >= 10;

  const rows = isTeammate
    ? ROWS.filter((r) => r.key === 'inbox_message')
    : (isDj ? ROWS : ROWS.filter((r) => !r.djOnly));

  // "Effective" text coverage for the booking-request row: a stored text
  // toggle only counts if the channel is actually usable.
  const brTextActive = smsReady && text.booking_request;

  function toggleEmail(key: RowKey, next: boolean) {
    // DJ guard: don't let them turn off the last active channel for new
    // booking requests.
    if (isDj && key === 'booking_request' && !next && !brTextActive) {
      setBrNote(REQUIRED_NOTE);
      return;
    }
    setBrNote(null);
    setEmail((p) => ({ ...p, [key]: next }));
  }

  function toggleText(key: RowKey, next: boolean) {
    if (isDj && key === 'booking_request' && !next && !email.booking_request) {
      setBrNote(REQUIRED_NOTE);
      return;
    }
    setBrNote(null);
    setText((p) => ({ ...p, [key]: next }));
  }

  function onMasterToggle(next: boolean) {
    setSmsEnabled(next);
    // Turning text off can strip a DJ's only booking-request channel (if they
    // had email off and were relying on text). Re-assert email to hold the rule.
    if (!next && isDj && !email.booking_request) {
      setEmail((p) => ({ ...p, booking_request: true }));
      setBrNote('Re-enabled email for new booking requests — DJs must keep at least one on.');
    }
  }

  // One save for the whole page — phone + consent AND the per-type matrix.
  async function save() {
    setAlert(null);
    setBrNote(null);
    const trimmedPhone = smsPhone.trim();

    // Phone validation — mirrors the existing SMS save.
    if (smsEnabled && !trimmedPhone) {
      setAlert({ type: 'error', msg: 'Enter a phone number to enable text notifications.' });
      return;
    }
    if (trimmedPhone && digitsOf(trimmedPhone) < 10) {
      setAlert({ type: 'error', msg: 'Please enter a valid phone number.' });
      return;
    }

    // DJ backstop: new booking request must have at least one live channel.
    const textActiveAtSave = smsEnabled && digitsOf(trimmedPhone) >= 10 && text.booking_request;
    if (isDj && !email.booking_request && !textActiveAtSave) {
      setAlert({ type: 'error', msg: 'DJs must keep at least one alert on for new booking requests.' });
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('users')
        .update({
          sms_phone: trimmedPhone || null,
          sms_enabled: smsEnabled,
          sms_notify_booking_request: text.booking_request,
          sms_notify_booking_status: text.booking_status,
          sms_notify_inbox_message: text.inbox_message,
          email_notify_booking_request: email.booking_request,
          email_notify_booking_status: email.booking_status,
          email_notify_inbox_message: email.inbox_message,
        } as unknown as never)
        .eq('id', userId);
      if (error) throw error;
      setAlert({ type: 'success', msg: 'Notification preferences saved.' });
      // Advance the saved snapshot so the unsaved dot clears.
      setSavedSnap({
        smsPhone: trimmedPhone,
        smsEnabled,
        email: { ...email },
        text: { ...text },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setAlert({ type: 'error', msg });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.pageWrap}>
      <div className={styles.pageHeader}>
        <h1>Notifications</h1>
        <p>Choose how you hear about activity on your account.</p>
      </div>

      {/* One card: Text Setup (gate for the Text column) + the notify matrix,
          with a single Save at the bottom. */}
      <div className={styles.card}>
        {/* Teammates don't get SMS/text notifications — only inbox-message email. */}
        {!isTeammate && (
          <>
            <h2>Text Setup</h2>
            <p className={styles.cardHint}>
              By entering your mobile number, checking &ldquo;Send me text
              notifications,&rdquo; and clicking Save, you consent to receive
              recurring SMS booking and account notifications from Global DJ
              Connect. Message frequency varies. Msg &amp; data rates may apply.
              Reply STOP to opt out, HELP for help. This number stays private and is
              separate from your public profile phone.
            </p>

            <div className={styles.masterRow}>
              <label className={styles.masterLabel}>
                <input
                  type="checkbox"
                  checked={smsEnabled}
                  onChange={(e) => onMasterToggle(e.target.checked)}
                  className={styles.masterCheckbox}
                />
                <span>Send me text notifications</span>
              </label>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="sms-phone">Mobile Number (for texts)</label>
              <input
                id="sms-phone"
                type="tel"
                inputMode="tel"
                placeholder="(555) 555-5555"
                value={smsPhone}
                onChange={(e) => setSmsPhone(e.target.value)}
                autoComplete="tel"
              />
            </div>

            <p className={styles.finePrint}>
              Reply <strong>STOP</strong> to any text to unsubscribe. Reply{' '}
              <strong>HELP</strong> for help.
            </p>

            <div style={{ borderTop: '1px solid var(--border, rgba(255,255,255,.12))', margin: '1.4rem 0' }} />
          </>
        )}

        <h2>What to notify me about</h2>

        <div className={styles.matrix} style={isTeammate ? { gridTemplateColumns: '1fr 62px' } : undefined}>
          <div className={`${styles.matrixCorner} ${styles.matrixHeadRow}`} />
          <div className={`${styles.matrixHead} ${styles.matrixHeadRow}`}>Email</div>
          {!isTeammate && <div className={`${styles.matrixHead} ${styles.matrixHeadRow}`}>Text</div>}

          {rows.map((r) => {
            const required = isDj && r.djOnly;
            return (
              <Fragment key={r.key}>
                <div className={styles.matrixLabel}>
                  {r.label}
                  {required && <span className={styles.req} title="Required for DJs"> *</span>}
                </div>
                <div className={styles.matrixCell}>
                  <input
                    type="checkbox"
                    className={styles.cb}
                    checked={email[r.key]}
                    onChange={(e) => toggleEmail(r.key, e.target.checked)}
                    aria-label={`Email — ${r.label}`}
                  />
                </div>
                {!isTeammate && (
                  <div className={styles.matrixCell}>
                    <input
                      type="checkbox"
                      className={styles.cb}
                      checked={text[r.key]}
                      disabled={!smsReady}
                      onChange={(e) => toggleText(r.key, e.target.checked)}
                      aria-label={`Text — ${r.label}`}
                    />
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>

        {!smsReady && !isTeammate && (
          <p className={styles.matrixHelp}>
            Turn on text notifications and add a mobile number above to enable the
            Text column.
          </p>
        )}

        {isDj && (
          <p className={styles.matrixHelp}>
            <span className={styles.req}>*</span> Required — DJs must keep at least
            one alert on for new booking requests.
          </p>
        )}

        {brNote && <p className={styles.reqNote}>{brNote}</p>}

        {alert && (
          <div
            className={`${styles.alert} ${
              alert.type === 'success' ? styles.alertSuccess : styles.alertError
            }`}
          >
            {alert.msg}
          </div>
        )}

        {/* Only illuminated when there's something to save — dim + disabled
            otherwise, matching the per-tab Save buttons elsewhere. */}
        <button
          type="button"
          className={styles.saveBtn}
          disabled={saving || !dirty}
          onClick={save}
          style={!dirty ? { background: 'transparent', color: 'var(--muted,#8a8aa0)', border: '1px solid var(--border,rgba(255,255,255,.18))', boxShadow: 'none', cursor: 'default' } : undefined}
        >
          {saving ? 'Saving…' : dirty ? 'Save Preferences' : '✓ Saved'}
        </button>
      </div>
    </div>
  );
}
