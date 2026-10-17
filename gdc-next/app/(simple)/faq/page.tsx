// FAQ page — public marketing page in the (simple) route group (own header,
// no site chrome). Two separate FAQ sets on ONE page — one for Hosts, one for
// DJs — switched with a toggle at the top (FaqContent client component).

import type { Metadata } from 'next';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import MobileMenu from '@/components/MobileMenu';
import DjSearchBar from '@/components/DjSearchBar';
import FaqContent from './FaqContent';
import styles from './faq.module.css';

export const metadata: Metadata = {
  title: 'FAQ — Global DJ Connect',
  description:
    'Frequently asked questions about Global DJ Connect — separate answers for hosts booking a DJ and for DJs running their business on the platform.',
};

export default function FaqPage() {
  return (
    <div id="view-public" className="view active">
      <Header />
      <MobileMenu />
      <DjSearchBar />

      <div className={styles.page}>
        <h1 className={styles.title}>Frequently Asked Questions</h1>
        <div className={styles.tagline}>Answers for hosts and DJs.</div>
        <FaqContent />
      </div>

      <Footer />
    </div>
  );
}
