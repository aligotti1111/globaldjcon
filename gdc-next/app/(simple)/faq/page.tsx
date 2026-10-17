// FAQ page — public marketing page in the (simple) route group (own header,
// no site chrome). Two separate FAQ sets on ONE page — one for Hosts, one for
// DJs — switched with a toggle at the top (FaqContent client component).

import Link from 'next/link';
import type { Metadata } from 'next';
import FaqContent from './FaqContent';
import styles from './faq.module.css';

export const metadata: Metadata = {
  title: 'FAQ — Global DJ Connect',
  description:
    'Frequently asked questions about Global DJ Connect — separate answers for hosts booking a DJ and for DJs running their business on the platform.',
};

export default function FaqPage() {
  return (
    <>
      <header className={styles.header}>
        <Link href="/" className={styles.navLogo}>Global DJ Connect</Link>
        <nav className={styles.nav}>
          <Link href="/about" className={styles.navLink}>About</Link>
          <Link href="/djs" className={styles.navLink}>Find a DJ</Link>
        </nav>
      </header>

      <div className={styles.page}>
        <h1 className={styles.title}>Frequently Asked Questions</h1>
        <div className={styles.tagline}>Answers for hosts and DJs.</div>
        <FaqContent />
      </div>
    </>
  );
}
