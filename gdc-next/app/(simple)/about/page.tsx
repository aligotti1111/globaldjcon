// About Us page — public marketing page. Lives in the (simple) route group, so
// it brings its own minimal header (logo → home) like the Terms / Privacy pages.
// Content is drawn from what the platform actually does; company specifics
// (founding year, location) can be edited inline here.

import Link from 'next/link';
import type { Metadata } from 'next';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import MobileMenu from '@/components/MobileMenu';
import styles from './about.module.css';

export const metadata: Metadata = {
  title: 'About Us — Global DJ Connect',
  description:
    'Global DJ Connect is a directory and booking platform that connects party hosts, venues, and event organizers with professional DJs — and gives DJs the tools to run their business.',
};

export default function AboutPage() {
  return (
    <div id="view-public" className="view active">
      <Header />
      <MobileMenu />

      <div className={styles.page}>
        <h1 className={styles.title}>About Us</h1>
        <div className={styles.tagline}>Where hosts and DJs connect.</div>

        <div className={styles.section}>
          <p className={styles.lead}>
            Global DJ Connect is a directory and booking platform that brings party hosts, venues, and event
            organizers together with professional DJs — and gives those DJs everything they need to run the
            business side of their craft in one place.
          </p>

          <h2>What we do</h2>
          <p>
            Booking a DJ has always meant a scramble of phone calls, texts, and half-finished email threads. We
            built Global DJ Connect to replace that with one clear flow: a host finds a DJ, sends a booking
            request with the real details of their event, and the DJ reviews and accepts it. From that first
            request through the final song of the night, both sides see the same information — dates, times,
            venue, package, and payment status — so nothing gets lost in translation.
          </p>

          <h2>For hosts</h2>
          <p>
            Browse DJs, request a date, and lock in your event without the back-and-forth. Share your timeline
            and song requests through the event planner, review and e-sign a contract if your DJ uses one, and
            pay your deposit and balance the way that works for you. There&rsquo;s no cost to hosts for using the
            platform — you deal directly with your DJ, and we keep the details organized.
          </p>

          <h2>For DJs</h2>
          <p>
            Global DJ Connect is your storefront and your back office. Get a public profile in the directory,
            take booking requests online or add the ones you land offline, send contracts for e-signature,
            collect deposits and balances, and keep every event&rsquo;s planner, rider, and payment history in one
            dashboard. You stay the merchant of record on every booking and keep your full fee — we&rsquo;re a
            subscription tool, not a middleman that takes a cut of your gigs.
          </p>

          <h2>How we see our role</h2>
          <p>
            We&rsquo;re the connective tissue, not a party to your agreement. The booking is between the host and the
            DJ; our job is to make that relationship easy to start, clear to manage, and simple to get paid on.
            We take that responsibility seriously — and we&rsquo;re always building toward a smoother experience for
            both sides of every booking.
          </p>

          <h2>Get in touch</h2>
          <p>
            Questions, ideas, or feedback? We&rsquo;d love to hear from you at{' '}
            <a href="mailto:info@globaldjconnect.com">info@globaldjconnect.com</a>. New here? Start with our{' '}
            <Link href="/faq">FAQ</Link> for hosts and DJs.
          </p>
          <p className={styles.fineprint}>
            Global DJ Connect is operated by Source Playlist LLC.
          </p>
        </div>
      </div>

      <Footer />
    </div>
  );
}
