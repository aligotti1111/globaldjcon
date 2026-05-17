// Terms & Conditions page.
// Ported from vanilla terms.html with sections added for SMS notifications,
// subscriptions (Source Playlist LLC charges DJs $19.99/mo), and Source
// Playlist LLC identification.

import Link from 'next/link';
import type { Metadata } from 'next';
import styles from './terms.module.css';

export const metadata: Metadata = {
  title: 'Terms & Conditions — Global DJ Connect',
  description: 'Terms and conditions for using Global DJ Connect.',
};

export default function TermsPage() {
  return (
    <>
      <header className={styles.header}>
        <Link href="/" className={styles.navLogo}>Global DJ Connect</Link>
      </header>

      <div className={styles.page}>
        <h1 className={styles.title}>Terms &amp; Conditions</h1>
        <div className={styles.updated}>Last updated: May 17, 2026</div>

        <p>
          These Terms and Conditions govern your use of Global DJ Connect (&ldquo;the Platform&rdquo;), operated by
          Source Playlist LLC, the legal entity that owns and operates Global DJ Connect (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;).
          By creating an account or using the Platform, you agree to these terms.
        </p>

        <h2>1. Platform Role</h2>
        <p>
          Global DJ Connect is a directory and booking facilitation platform. We connect party hosts, venues, and event
          organizers (&ldquo;Clients&rdquo;) with DJs (&ldquo;DJs&rdquo;). We are not a party to any booking agreement made between a
          Client and a DJ. We do not employ DJs, guarantee their availability, or guarantee the quality of their services.
        </p>

        <h2>2. Bookings</h2>
        <p>
          All bookings are agreements made directly between the Client and the DJ. By submitting a booking request, the
          Client agrees to the terms proposed by the DJ including the agreed rate and event details. A booking is only
          confirmed when both parties have agreed and the DJ has accepted the request through the Platform.
        </p>
        <p>Global DJ Connect is not responsible for:</p>
        <ul>
          <li>A DJ failing to appear at a booked event</li>
          <li>A DJ cancelling a confirmed booking</li>
          <li>Disputes over payment between a Client and a DJ</li>
          <li>The quality or suitability of a DJ&apos;s performance</li>
          <li>Any damages, losses, or costs arising from a cancelled or unfulfilled booking</li>
        </ul>

        <h2>3. No-Shows &amp; Cancellations</h2>
        <p>
          If a DJ fails to appear at a confirmed booking (&ldquo;no-show&rdquo;), the Client&apos;s sole recourse is directly
          against the DJ. Global DJ Connect will not be held liable for any losses, damages, or costs incurred as a result
          of a no-show or last-minute cancellation by a DJ or Client.
        </p>
        <p>
          We encourage all parties to communicate clearly through the Platform and to establish cancellation terms before
          confirming a booking.
        </p>

        <h2>4. Booking Payments Between Users</h2>
        <p>
          Global DJ Connect does not process booking payments between Clients and DJs. All payment arrangements for event
          bookings are made directly between the parties. We are not responsible for payment disputes, non-payment, or
          chargebacks arising from a booking.
        </p>

        <h2>5. DJ Subscription Plans</h2>
        <p>
          DJs may subscribe to a paid plan to access enhanced features on the Platform. The standard DJ subscription is
          <strong> $19.99 per month</strong>, billed in advance on a recurring monthly basis to the payment method on file.
          Subscription fees are payable to Source Playlist LLC.
        </p>
        <p>
          By subscribing, you authorize us to automatically charge your payment method on each renewal date until you cancel.
          You may cancel your subscription at any time from your account settings or by contacting us at{' '}
          <a href="mailto:info@globaldjconnect.com">info@globaldjconnect.com</a>. Cancellation takes effect at the end of
          your current billing cycle &mdash; you will retain access to subscriber features until that date.
        </p>
        <p>
          Subscription fees are non-refundable except as required by law. If we materially change the subscription price,
          we will notify you in advance and you may cancel before the new price takes effect.
        </p>
        <p>
          We reserve the right to suspend or terminate subscriber access for non-payment, chargebacks, or violation of
          these Terms.
        </p>

        <h2>6. User Conduct</h2>
        <p>All users agree to:</p>
        <ul>
          <li>Provide accurate and truthful information in their profiles and booking requests</li>
          <li>Communicate respectfully with other users through the Platform</li>
          <li>Not use the Platform for any unlawful purpose</li>
          <li>Not misrepresent their identity, credentials, or services</li>
          <li>Honor confirmed bookings or provide reasonable notice of cancellation</li>
        </ul>
        <p>We reserve the right to suspend or terminate any account that violates these terms.</p>

        <h2>7. DJ Profiles</h2>
        <p>
          DJs are solely responsible for the accuracy of their profile information, including rates, availability,
          equipment, and experience. Global DJ Connect does not verify DJ credentials, reviews, or qualifications.
        </p>

        <h2>8. SMS Text Message Program</h2>
        <p>
          By opting in to SMS notifications in your account settings and providing a mobile number, you agree to receive
          automated text messages from Global DJ Connect (operated by Source Playlist LLC) at that number. This is an
          optional feature that is disabled by default.
        </p>
        <p>
          <strong>Program description:</strong> Global DJ Connect SMS notifications. Texts are sent when (1) a host
          submits a booking request to a DJ, (2) a booking is approved, denied, or counter-offered, or (3) a user
          receives a new inbox message on the Platform.
        </p>
        <p>
          <strong>Message frequency:</strong> Message frequency varies based on your activity on the Platform and the
          event types you opt in to. There is no fixed number of messages per month.
        </p>
        <p>
          <strong>Message and data rates:</strong> Standard message and data rates may apply, depending on your carrier
          and mobile plan. We do not charge a fee for receiving these messages.
        </p>
        <p>
          <strong>How to opt out:</strong> Reply <strong>STOP</strong> to any message to immediately unsubscribe. You can
          also disable notifications at any time from your account settings page.
        </p>
        <p>
          <strong>How to get help:</strong> Reply <strong>HELP</strong> to any message for support, or contact us at{' '}
          <a href="mailto:info@globaldjconnect.com">info@globaldjconnect.com</a>.
        </p>
        <p>
          <strong>Supported carriers:</strong> Messages are delivered through Twilio via major US carriers including
          AT&amp;T, Verizon, T-Mobile, and Sprint. Carriers are not liable for delayed or undelivered messages.
        </p>
        <p>
          We do not share your mobile number with third parties or affiliates for marketing or promotional purposes.
          Further details are in our <Link href="/privacy">Privacy Policy</Link>.
        </p>

        <h2>9. Limitation of Liability</h2>
        <p>
          To the fullest extent permitted by law, Source Playlist LLC (operating as Global DJ Connect) shall not be
          liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the
          Platform, including but not limited to lost revenue, lost profits, or damages resulting from a booking that
          does not proceed as expected.
        </p>
        <p>
          Our total liability to you for any claim arising from your use of the Platform shall not exceed the greater
          of (a) the amount paid by you to Source Playlist LLC in the twelve months prior to the claim, or (b) $100.
        </p>

        <h2>10. Indemnification</h2>
        <p>
          You agree to indemnify and hold harmless Source Playlist LLC, its owners, employees, and agents from any
          claims, damages, losses, or expenses (including legal fees) arising from your use of the Platform, your
          violation of these Terms, or your interactions with other users.
        </p>

        <h2>11. Intellectual Property</h2>
        <p>
          All content on the Platform, including design, code, logos, and text, is owned by Source Playlist LLC. DJs
          retain ownership of their own content (photos, mixes, bios) but grant Source Playlist LLC a non-exclusive
          license to display that content on the Platform.
        </p>

        <h2>12. Termination</h2>
        <p>
          We may suspend or terminate your access to the Platform at any time, with or without cause. You may delete
          your account at any time by contacting us at{' '}
          <a href="mailto:info@globaldjconnect.com">info@globaldjconnect.com</a>. Termination of a paid subscription is
          governed by Section 5.
        </p>

        <h2>13. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time. Continued use of the Platform after changes constitutes
          acceptance of the updated Terms. We will notify users of significant changes by posting a notice on the site
          or via email.
        </p>

        <h2>14. Governing Law</h2>
        <p>
          These Terms shall be governed by the laws of the State of New York, United States, without regard to conflict
          of law principles.
        </p>

        <h2>15. Contact</h2>
        <p>
          For questions about these Terms, contact us at:
          <br />
          Source Playlist LLC (d/b/a Global DJ Connect)
          <br />
          <a href="mailto:info@globaldjconnect.com">info@globaldjconnect.com</a>
          <br />
          globaldjconnect.com
        </p>
      </div>
    </>
  );
}
