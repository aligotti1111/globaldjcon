// (main) layout — wraps pages with the full site chrome:
// header, mobile menu, footer, and the #view-public class wrapper
// that the vanilla CSS uses for layout/scoping.
//
// Pages in this group: homepage, DJ profile, dashboard, etc.
// Pages NOT in this group (simple pages like privacy/contact) use
// the (simple) layout instead — they get just the global font/CSS
// from the root layout but no site header.

import Header from '@/components/Header';
import Footer from '@/components/Footer';
import MobileMenu from '@/components/MobileMenu';
import VerifyEmailBanner from '@/components/VerifyEmailBanner';
import EmailVerifiedBanner from '@/components/EmailVerifiedBanner';
import BookingClaimedBanner from '@/components/BookingClaimedBanner';
import { UnsavedChangesProvider } from '@/components/UnsavedChangesProvider';

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <UnsavedChangesProvider>
      <div id="view-public" className="view active">
        <EmailVerifiedBanner />
        <BookingClaimedBanner />
        <VerifyEmailBanner />
        <Header />
        <MobileMenu />
        {children}
        <Footer />
      </div>
    </UnsavedChangesProvider>
  );
}
