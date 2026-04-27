// Footer — matches vanilla site structure for consistent styling.
import Link from 'next/link';

export default function Footer() {
  return (
    <footer>
      <div className="footer-logo">Global DJ Connect</div>
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <Link
          href="/contact"
          className="footer-note"
          style={{ color: 'var(--muted)', textDecoration: 'none', transition: 'color .2s' }}
        >
          Contact Us
        </Link>
        <Link
          href="/privacy"
          className="footer-note"
          style={{ color: 'var(--muted)', textDecoration: 'none', transition: 'color .2s' }}
        >
          Privacy Policy
        </Link>
      </div>
    </footer>
  );
}
