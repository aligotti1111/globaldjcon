// Footer — appears on every page via root layout.
import Link from 'next/link';

export default function Footer() {
  return (
    <footer>
      <div className="footer-inner">
        <p>© {new Date().getFullYear()} Global DJ Connect</p>
        <nav>
          <Link href="/contact">Contact</Link>
          <Link href="/privacy">Privacy</Link>
        </nav>
      </div>
    </footer>
  );
}
