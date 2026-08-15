// Privacy Policy page.
// Static — no data fetching, no client-side JS. Renders as plain HTML on the
// server. Covers event-planning data (planner / rider / guest list), open &
// page-view tracking, capability-link sharing, and the current subprocessors
// (Supabase, Resend, Twilio, Netlify, Cloudflare, Stripe, DocuSeal, Deezer,
// Odesli).

import Link from 'next/link';
import type { Metadata } from 'next';
import styles from './privacy.module.css';

export const metadata: Metadata = {
  title: 'Privacy Policy — Global DJ Connect',
  description: 'How Global DJ Connect collects, uses, and protects your information.',
};

export default function PrivacyPage() {
  return (
    <>
      <header className={styles.header}>
        <Link href="/" className={styles.navLogo}>Global DJ Connect</Link>
      </header>

      <div className={styles.page}>
        <h1 className={styles.title}>Privacy Policy</h1>
        <div className={styles.updated}>Last updated: August 15, 2026</div>

        <div className={styles.section}>
          <p>
            Global DJ Connect (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) operates globaldjconnect.com.
            Global DJ Connect is a brand of Source Playlist LLC, the legal entity that owns and operates this platform.
            This Privacy Policy explains how we collect, use, and protect your information when you use our platform.
          </p>

          <h2>Information We Collect</h2>
          <p>We collect information you provide directly to us, including:</p>
          <ul>
            <li>Name, email address, and password when you create an account</li>
            <li>Profile information such as location, bio, photos, and social media links</li>
            <li>Booking request details including event date, venue, and contact information</li>
            <li>Messages sent through our platform</li>
            <li>Mobile phone number, if you choose to opt in to SMS text notifications</li>
            <li>Payment-related information (we do not store full card details)</li>
            <li>
              Event planning information provided through a Planner &amp; Playlist, DJ Rider, or Guest List &mdash; for
              example song requests and &ldquo;do not play&rdquo; lists, first-dance and timeline details, run-of-show
              notes, equipment and hospitality requirements, and guest names and party sizes for an event
            </li>
            <li>
              Information about other people that you or a DJ choose to add, such as guest names on a guest list. If you
              add another person&apos;s information, you confirm you are allowed to share it with us for the purpose of
              planning the event
            </li>
          </ul>
          <p>
            We also collect certain information automatically, including your IP address, browser type,
            device information, and pages visited. When we send an email or share a document link (such as an invoice,
            contract, planner, rider, or guest list), we may record whether and when the email was opened or the linked
            page was viewed, so the sender can see the status of what they sent.
          </p>

          <h2>How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul>
            <li>Create and manage your account</li>
            <li>Facilitate bookings between DJs and clients</li>
            <li>Send booking confirmations, updates, and notifications</li>
            <li>Improve and maintain the platform</li>
            <li>Respond to inquiries and provide customer support</li>
            <li>Comply with legal obligations</li>
          </ul>

          <h2>SMS Text Message Notifications</h2>
          <p>
            If you opt in to SMS notifications in your account settings, we will send you text messages
            about events on the platform you have chosen to be notified about, such as new booking requests,
            booking status changes, and new inbox messages. SMS opt-in is entirely optional and disabled
            by default.
          </p>
          <p>
            By providing your mobile number and enabling SMS notifications, you consent to receive automated
            text messages from us at that number. Message frequency varies based on platform activity.
            Message and data rates may apply. We do not share your mobile number with third parties or
            affiliates for marketing or promotional purposes.
          </p>
          <p>
            <strong>How to opt out:</strong> You can stop SMS messages at any time by replying{' '}
            <strong>STOP</strong> to any text we send, or by turning off text notifications in your account
            settings. Reply <strong>HELP</strong> to any text for help, or contact us at{' '}
            <a href="mailto:info@globaldjconnect.com">info@globaldjconnect.com</a>.
          </p>
          <p>
            SMS messages are delivered through Twilio, our communications service provider. Mobile carriers
            are not liable for delayed or undelivered messages.
          </p>

          <h2>Sharing Your Information</h2>
          <p>We do not sell your personal information. We may share your information with:</p>
          <ul>
            <li>Other users as necessary to facilitate bookings (e.g., your name and contact details shared with a DJ you book)</li>
            <li>Service providers who help us operate the platform, including Supabase (database and authentication), Resend (email delivery), Twilio (SMS delivery), Netlify (hosting), Cloudflare (content delivery and security), Stripe (card payment processing), and DocuSeal (electronic contract signing)</li>
            <li>Deezer and Odesli (song.link), which we use to power song search and to resolve music links &mdash; the words you type into a song search and the track links you select are sent to these services to return results</li>
            <li>Law enforcement or government agencies if required by law</li>
          </ul>
          <p>
            <strong>Payments.</strong> When a Client pays a DJ by card through the Platform, the payment is processed by
            Stripe directly to the DJ&apos;s own connected Stripe account. Stripe collects and processes the Client&apos;s
            payment details under <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer">Stripe&apos;s Privacy Policy</a>; we do not receive or store full card
            numbers. Because the DJ is the merchant of record, the DJ also receives the transaction and payer information
            needed to fulfill and account for the payment.
          </p>
          <p>
            <strong>Calendar sync.</strong> A DJ may subscribe to a private calendar feed or add bookings to their own
            calendar. If a DJ does so, booking details (including the Client&apos;s name, event date, venue, and related
            notes) are sent to the calendar provider the DJ chooses, such as Google Calendar or Apple Calendar. That
            provider&apos;s own privacy policy governs how it handles the data.
          </p>

          <h2>Event Planning Tools and Shared Links</h2>
          <p>
            To help DJs and Clients plan an event, the Platform lets a DJ send a Client a link to a Planner &amp;
            Playlist, a DJ Rider, a Guest List, an invoice, or a contract. These links do not require the recipient to
            create an account. Each link contains a long, unique, unguessable web address that acts as a private key:
            anyone who has the link can open, and in some cases edit, the information behind it. Please treat these links
            as private and share them only with people who are helping plan your event.
          </p>
          <p>
            Information entered through these tools is stored on our infrastructure and is visible to the DJ and Client
            connected to that booking. We use it only to provide the planning features and to operate the booking; we do
            not use it for advertising and we do not sell it.
          </p>

          <h2>Data Storage</h2>
          <p>
            Your data is stored securely using Supabase infrastructure. We retain your data for as long as
            your account is active or as needed to provide services. Information entered into a planner, rider, guest
            list, invoice, or contract is retained as part of the associated booking record for as long as needed to
            provide the service to the DJ and Client, or until the account it belongs to is deleted. You may request
            deletion of your account and associated data at any time by contacting us.
          </p>

          <h2>Cookies</h2>
          <p>
            We use cookies and similar technologies to maintain your session and improve your experience.
            You can disable cookies in your browser settings, though some features may not function properly as a result.
          </p>

          <h2>Your Rights</h2>
          <p>Depending on your location, you may have the right to:</p>
          <ul>
            <li>Access the personal data we hold about you</li>
            <li>Request correction of inaccurate data</li>
            <li>Request deletion of your data</li>
            <li>Opt out of marketing communications</li>
          </ul>
          <p>
            To exercise any of these rights, contact us at{' '}
            <a href="mailto:info@globaldjconnect.com">info@globaldjconnect.com</a>.
          </p>

          <h2>Third-Party Links</h2>
          <p>
            Our platform may contain links to third-party websites. We are not responsible for the privacy
            practices of those sites and encourage you to review their policies.
          </p>

          <h2>Children&apos;s Privacy</h2>
          <p>
            Our platform is not directed to children under 13. We do not knowingly collect personal information
            from children under 13. If you believe we have inadvertently collected such information, please contact
            us immediately.
          </p>

          <h2>Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of significant changes by
            posting a notice on our site or sending an email. Your continued use of the platform after changes
            constitutes acceptance of the updated policy.
          </p>

          <h2>Contact Us</h2>
          <p>
            If you have any questions about this Privacy Policy, please contact us at:
            <br />
            Source Playlist LLC (d/b/a Global DJ Connect)
            <br />
            <a href="mailto:info@globaldjconnect.com">info@globaldjconnect.com</a>
            <br />
            globaldjconnect.com
          </p>
        </div>
      </div>
    </>
  );
}
