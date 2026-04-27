// Root layout — wraps every page in the app.
// Replaces the duplicated <header> + ui-chrome.js code that lives in every HTML page.
// One file. Edit once, every page updates.
import type { Metadata } from 'next';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import MobileMenu from '@/components/MobileMenu';
import { AuthProvider } from '@/components/AuthProvider';

// Global stylesheets (copied from the old project)
import '@/public/css/index.css';

export const metadata: Metadata = {
  title: 'Global DJ Connect',
  description: 'Find and book DJs worldwide.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <Header />
          <MobileMenu />
          <main>{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
