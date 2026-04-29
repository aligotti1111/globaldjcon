// /embed-calendar — public iframe-friendly calendar for embedding on third-
// party sites. Reads ?slug=<dj>&theme=dark|light&months=1|3 from the URL.
//
// Faithful port of vanilla embed-calendar.html.
//
// Server component fetches the DJ's row from Supabase (anon read), then
// hands off to the client component which manages theme + month nav +
// the parent-iframe height handshake.
//
// We accept just `slug` here as required. Theme + months are read on the
// client side since they only affect rendering, not data fetching.

import { createClient } from '@/lib/supabase/server';
import EmbedClient from './EmbedClient';
import { parseBookingSettings } from '@/app/(main)/[slug]/bookingSettings';

// Don't statically prerender — there could båe hundreds of DJs and we
// don't know which ones will be embedded. The body is light enough
// (one Supabase read + a small calendar grid) that on-demand SSR is fine.
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string; theme?: string; months?: string }>;
}

export default async function EmbedCalendarPage({ searchParams }: Props) {
  const params = await searchParams;
  const slug = (params.slug || '').trim().toLowerCase();
  const theme: 'light' | 'dark' = params.theme === 'light' ? 'light' : 'dark';
  // Embeds support 1 or 3 months only. The full 12-month view stays
  // available on the main globaldjconnect.com site.
  const monthsParam = parseInt(params.months || '1', 10);
  const months: 1 | 3 = monthsParam === 3 ? 3 : 1;

  if (!slug) {
    return (
      <div data-theme={theme}>
        <ErrorWrap theme={theme}>No DJ specified.</ErrorWrap>
      </div>
    );
  }

  // Anon Supabase read — RLS allows public reads on users table for DJ rows
  const supabase = await createClient();
  const { data: dj } = await supabase
    .from('users')
    .select('slug, name, dj_type, booking_settings')
    .eq('slug', slug)
    .eq('role', 'dj')
    .maybeSingle<{
      slug: string;
      name: string | null;
      dj_type: 'mobile' | 'club' | null;
      booking_settings: string | null;
    }>();

  if (!dj) {
    return (
      <div data-theme={theme}>
        <ErrorWrap theme={theme}>Calendar unavailable.</ErrorWrap>
      </div>
    );
  }

  const bs = parseBookingSettings(dj.booking_settings) || {};
  // Mobile DJs store availability in mob_booking_days; club DJs in
  // booking_days. Pick the right field based on dj_type.
  const bookingDays = (dj.dj_type === 'mobile')
    ? (bs.mob_booking_days || {})
    : (bs.booking_days || bs.mob_booking_days || {});
  // Same for the booking-window cap (how far in advance the DJ accepts)
  const windowMonths = (dj.dj_type === 'mobile')
    ? (bs.mob_booking_window || 12)
    : (bs.booking_window_months || bs.mob_booking_window || 12);

  return (
    <EmbedClient
      djSlug={dj.slug}
      djName={dj.name || ''}
      bookingDays={bookingDays}
      windowMonths={windowMonths}
      theme={theme}
      months={months}
    />
  );
}

// Small helper for the two error states. Kept inside this file since it's
// not reused elsewhere.
function ErrorWrap({ theme, children }: { theme: 'light' | 'dark'; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: theme === 'light' ? '#fff' : 'var(--card)',
        border: theme === 'light' ? '1px solid #d1d5db' : '1px solid var(--border)',
        borderRadius: 8,
        padding: 14,
        textAlign: 'center',
        color: theme === 'light' ? '#1a1a2e' : 'var(--amber)',
        fontFamily: "'Space Mono', monospace",
        fontSize: 12,
      }}
    >
      <div style={{ padding: '30px 20px' }}>{children}</div>
      <div
        style={{
          marginTop: 10,
          fontSize: 9,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          opacity: 0.55,
        }}
      >
        Powered by{' '}
        <a
          href="https://globaldjconnect.com"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: 'inherit',
            textDecoration: 'none',
            borderBottom: '1px dotted currentColor',
          }}
        >
          Global DJ Connect
        </a>
      </div>
    </div>
  );
}
