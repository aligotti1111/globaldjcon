// Privacy Policy page.
// Content matches vanilla privacy.html exactly. Static — no data fetching,
// no client-side JS. Renders as plain HTML on the server.

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
        <div className={styles.updated}>Last updated: April 8, 2026</div>

        <div className={styles.section}>
          <p>
            Global DJ Connect (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) operates globaldjconnect.com.
            This Privacy Policy explains how we collect, use, and protect your information when you use our platform.
          </p>

          <h2>Information We Collect</h2>
          <p>We collect information you provide directly to us, including:</p>
          <ul>
            <li>Name, email address, and password when you create an account</li>
            <li>Profile information such as location, bio, photos, and social media links</li>
            <li>Booking request details including event date, venue, and contact information</li>
            <li>Messages sent through our platform</li>
            <li>Payment-related information (we do not store full card details)</li>
          </ul>
          <p>
            We also collect certain information automatically, including your IP address, browser type,
            device information, and pages visited.
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

          <h2>Sharing Your Information</h2>
          <p>We do not sell your personal information. We may share your information with:</p>
          <ul>
            <li>Other users as necessary to facilitate bookings (e.g., your name and contact details shared with a DJ you book)</li>
            <li>Service providers who help us operate the platform (e.g., email delivery, hosting)</li>
            <li>Law enforcement or government agencies if required by law</li>
          </ul>

          <h2>Data Storage</h2>
          <p>
            Your data is stored securely using Supabase infrastructure. We retain your data for as long as
            your account is active or as needed to provide services. You may request deletion of your account
            and associated data at any time by contacting us.
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
            <a href="mailto:info@globaldjconnect.com">info@globaldjconnect.com</a>
            <br />
            globaldjconnect.com
          </p>
        </div>
      </div>
    </>
  );
}
