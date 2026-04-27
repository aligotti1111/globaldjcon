// Root layout — wraps every page in the app.
// Replaces the duplicated <header> + ui-chrome.js code that lives in every HTML page.
// One file. Edit once, every page updates.
import type { Metadata } from 'next';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import MobileMenu from '@/components/MobileMenu';
import { AuthProvider } from '@/components/AuthProvider';

// Global stylesheets — same files as the vanilla site, copied into app/styles
import './styles/index.css';

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
      <head>
        {/* Google Fonts — same fonts the vanilla site uses */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* The vanilla CSS targets `#view-public` for the homepage view.
            Wrapping body content in a div with that id keeps existing styles working. */}
        <div id="view-public" className="view active">
          <AuthProvider>
            <Header />
            <MobileMenu />
            {children}
            <Footer />
          </AuthProvider>
        </div>
      </body>
    </html>
  );
}
