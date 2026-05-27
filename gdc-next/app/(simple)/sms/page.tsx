// Public SMS notifications page.
//
// PURPOSE: This page exists so the A2P 10DLC campaign reviewer (TCR) can
// VERIFY the SMS opt-in / Call-to-Action WITHOUT needing to log in. The
// real opt-in lives on the account settings page, which is behind auth —
// a reviewer can't see it there. This page publicly documents the exact
// opt-in flow, the toggle label, the default-off state, message types,
// frequency, rates, and STOP/HELP handling.
//
// It reuses privacy.module.css for layout — no new stylesheet.

import Link from 'next/link';
import type { Metadata } from 'next';
import styles from '../privacy/privacy.module.css';

export const metadata: Metadata = {
  title: 'SMS Notifications — Global DJ Connect',
  description:
    'How SMS text notifications work on Global DJ Connect: how to opt in, '
    + 'message types, frequency, rates, and how to opt out.',
};

export default function SmsPage() {
  return (
    <>
      <header className={styles.header}>
        <Link href="/" className={styles.navLogo}>Global DJ Connect</Link>
      </header>

      <div className={styles.page}>
        <h1 className={styles.title}>SMS Text Notifications</h1>
        <div className={styles.updated}>Last updated: May 24, 2026</div>

        <div className={styles.section}>
          <p>
            Global DJ Connect (operated by Source Playlist LLC) offers optional
            SMS text notifications so registered users can be alerted about
            activity on their account. This page explains exactly how the
            program works, how to opt in, and how to opt out.
          </p>

          <h2>How to Opt In</h2>
          <p>
            SMS notifications are <strong>off by default</strong>. To receive
            text messages, a registered user must actively opt in. The opt-in
            controls are located on the user&rsquo;s Account Settings page,
            within the &ldquo;Text Notifications&rdquo; section. The steps are:
          </p>
          <ol>
            <li>Create a free account at globaldjconnect.com and sign in.</li>
            <li>
              Open Account Settings and find the &ldquo;Text Notifications&rdquo;
              section.
            </li>
            <li>
              Check the toggle labeled <strong>&ldquo;Send me text
              notifications&rdquo;</strong>. This toggle is unchecked by default.
            </li>
            <li>Enter a valid mobile number in the &ldquo;Mobile Number&rdquo; field.</li>
            <li>
              Optionally choose which events trigger a text (booking updates,
              new inbox messages).
            </li>
            <li>
              Click <strong>Save Preferences</strong> to confirm consent.
            </li>
          </ol>
          <p>
            No text messages are sent unless the user has completed every step
            above. Opting in is entirely the user&rsquo;s choice and is never
            required to use the platform.
          </p>

          {/* Visual reproduction of the opt-in form, so a reviewer can see
              the exact control without an account. */}
          <h2>What the Opt-In Looks Like</h2>
          <p>
            The &ldquo;Text Notifications&rdquo; section on the Account Settings
            page appears as shown below:
          </p>
          <div
            style={{
              border: '1px solid rgba(0,245,196,0.25)',
              borderRadius: 10,
              padding: '1.25rem',
              margin: '1rem 0 1.5rem',
              background: 'rgba(0,245,196,0.04)',
              maxWidth: 460,
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-inter), system-ui, sans-serif',
                fontSize: '.72rem',
                fontWeight: 600,
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                color: '#00f5c4',
                marginBottom: '.6rem',
              }}
            >
              Text Notifications
            </div>
            <p style={{ fontSize: '.85rem', margin: '0 0 .9rem' }}>
              By entering your mobile number, checking &ldquo;Send me text
              notifications,&rdquo; and clicking Save, you consent to receive
              recurring SMS booking and account notifications from Global DJ
              Connect. Message frequency varies. Msg &amp; data rates may
              apply. Reply STOP to opt out, HELP for help. We&rsquo;ll never
              share your number.
            </p>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '.6rem',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 6,
                padding: '.6rem .7rem',
                marginBottom: '.8rem',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 18,
                  height: 18,
                  border: '2px solid rgba(255,255,255,0.4)',
                  borderRadius: 4,
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
              <strong style={{ fontSize: '.9rem' }}>Send me text notifications</strong>
            </div>
            <div
              style={{
                fontSize: '.62rem',
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.55)',
                marginBottom: '.3rem',
              }}
            >
              Mobile Number
            </div>
            <div
              style={{
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 6,
                padding: '.55rem .7rem',
                fontSize: '.85rem',
                color: 'rgba(255,255,255,0.45)',
              }}
            >
              (555) 555-5555
            </div>
          </div>
          <p style={{ fontSize: '.8rem', color: 'rgba(255,255,255,0.6)' }}>
            The checkbox shown above is unchecked by default — this reflects the
            real state for every new account.
          </p>

          <h2>When We Send Texts</h2>
          <p>
            If a user has opted in, Global DJ Connect sends an SMS in these
            situations:
          </p>
          <ul>
            <li>A host submits a booking request to a DJ.</li>
            <li>A DJ approves, declines, or counter-offers a booking request.</li>
            <li>A user receives a new message in their platform inbox.</li>
          </ul>
          <p>
            Users can choose which of these events trigger a text on their
            Account Settings page. Example messages:
          </p>
          <ul>
            <li>
              &ldquo;New booking request from Jane Smith. Friday, June 5 &middot;
              7:00 PM. Venue: The Roxy. View: globaldjconnect.com/booking-requests
              Reply STOP to unsubscribe.&rdquo;
            </li>
            <li>
              &ldquo;Your booking with DJ Mike was approved. Friday, June 5
              &middot; The Roxy. View: globaldjconnect.com/booking-requests Reply
              STOP to unsubscribe.&rdquo;
            </li>
          </ul>

          <h2>Message Frequency</h2>
          <p>
            Message frequency is recurring and varies based on the user&rsquo;s
            own activity on the platform and the event types they opt in to.
            There is no fixed number of messages per month.
          </p>

          <h2>Message &amp; Data Rates</h2>
          <p>
            Message and data rates may apply, depending on the user&rsquo;s
            mobile carrier and plan. Global DJ Connect does not charge a fee for
            receiving these messages.
          </p>

          <h2>How to Opt Out</h2>
          <p>
            Users can stop SMS messages at any time by replying{' '}
            <strong>STOP</strong> to any text message received, or by unchecking
            &ldquo;Send me text notifications&rdquo; on their Account Settings
            page and saving. Reply <strong>HELP</strong> to any message for
            help, or contact us at{' '}
            <a href="mailto:info@globaldjconnect.com">info@globaldjconnect.com</a>.
          </p>

          <h2>Privacy</h2>
          <p>
            We do not share or sell mobile numbers or SMS consent to third
            parties or affiliates for marketing or promotional purposes. SMS
            messages are delivered through Twilio, our communications service
            provider. For full details see our{' '}
            <Link href="/privacy">Privacy Policy</Link> and{' '}
            <Link href="/terms">Terms &amp; Conditions</Link>.
          </p>
        </div>
      </div>
    </>
  );
}
