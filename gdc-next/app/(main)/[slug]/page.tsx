// DJ Profile page at /[slug]
//
// SERVER COMPONENT: fetches profile data on the server, then hands off to
// ProfileView (Client Component) for interactive parts (tabs, lightbox).
//
// Vanilla parity:
//   - Slug match → render DJ
//   - UUID slug → look up by id (legacy /uuid links still work)
//   - Venue role → "Venue profiles coming soon" placeholder
//   - Host role → 404 (hosts don't have public profiles)
//   - Private profile + not the owner → "Private Profile" block
//   - Anything else → "DJ Not Found" page with link back to directory
//
// What this DOES NOT include yet (deferred to later sessions):
//   - Booking calendar (Session 4)
//   - Booking request form / Message Me modal (Session 5)
//   - Owner-mode editing (Session 6)
//   - Mobile DJ vs Club DJ specialized layouts (Session 2)
//   - SEO metadata via generateMetadata (Session 6)
// Everything that IS here matches vanilla 1:1 in markup, styling, and behavior.

import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import ProfileView, { type DjProfileData } from './ProfileView';
import styles from './profile.module.css';

interface PageProps {
  params: Promise<{ slug: string }>;
}

// Vanilla regex for "is this a UUID slug" — used for legacy direct-id links
const UUID_REGEX = /^[0-9a-f-]{36}$/;

// Vanilla effective-slug fallback: if a row's slug column is null, derive one
// from the name (lowercase, alpha-numeric + dashes). Matches dj-profile.html
// line 429 verbatim.
function deriveSlugFromName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export default async function DjProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const supabase = await createClient();

  // ── Step 1: try slug → users.slug match for a DJ ─────────────────────
  // The vanilla code does a venue-check first then queries .role='dj'. We
  // do a single lookup by slug WITHOUT the role filter so we can branch on
  // role afterward (one query instead of two for the common case).
  const isUUID = UUID_REGEX.test(slug);
  const builder = isUUID
    ? supabase.from('users').select('*').eq('id', slug)
    : supabase.from('users').select('*').eq('slug', slug);

  const { data: profile, error } = await builder.maybeSingle<DjProfileData>();

  if (error) {
    // Real query error — log it but show the same not-found UX
    console.error('[dj-profile] Supabase query error:', error);
  }

  // ── Step 2: not found at all → vanilla "DJ Not Found" page ──────────
  if (!profile) {
    return (
      <div className={styles.statusWrap}>
        <div className={styles.statusBox}>
          <h2>DJ Not Found</h2>
          <p>This profile doesn&apos;t exist or has been removed.</p>
          <Link
            href="/"
            style={{
              display: 'inline-block',
              marginTop: '1.5rem',
              color: 'var(--neon)',
              fontFamily: "'Space Mono',monospace",
              fontSize: '.72rem',
              letterSpacing: '.08em',
              textTransform: 'uppercase',
            }}
          >
            ← Back to Directory
          </Link>
        </div>
      </div>
    );
  }

  // ── Step 3: role-based routing ──────────────────────────────────────
  // Venue → placeholder until we port the venue-profile page
  if (profile.role === 'venue') {
    return (
      <div className={styles.statusWrap}>
        <div className={styles.statusBox}>
          <h2>{profile.name || 'Venue'}</h2>
          <p>Venue profile pages are coming soon.</p>
          <Link
            href="/"
            style={{
              display: 'inline-block',
              marginTop: '1.5rem',
              color: 'var(--neon)',
              fontFamily: "'Space Mono',monospace",
              fontSize: '.72rem',
              letterSpacing: '.08em',
              textTransform: 'uppercase',
            }}
          >
            ← Back to Directory
          </Link>
        </div>
      </div>
    );
  }

  // Host → no public profile, real 404
  if (profile.role !== 'dj') {
    notFound();
  }

  // ── Step 4: privacy check ───────────────────────────────────────────
  // Determine if the viewer IS the profile owner. Only the owner can view
  // a private profile; everyone else gets a block message.
  const { data: { user: authUser } } = await supabase.auth.getUser();
  const isOwnProfile = !!authUser && authUser.id === profile.id;
  const isLoggedIn = !!authUser;

  if (profile.profile_private && !isOwnProfile) {
    return (
      <div className={styles.statusWrap}>
        <div className={styles.statusBox}>
          <h2>Private Profile</h2>
          <p>This DJ has chosen to keep their profile private.</p>
          <Link
            href="/"
            style={{
              display: 'inline-block',
              marginTop: '1.5rem',
              color: 'var(--neon)',
              fontFamily: "'Space Mono',monospace",
              fontSize: '.72rem',
              letterSpacing: '.08em',
              textTransform: 'uppercase',
            }}
          >
            ← Back to Directory
          </Link>
        </div>
      </div>
    );
  }

  // ── Step 5: render the profile ──────────────────────────────────────
  // Effective slug = the column value if set, otherwise derived from name.
  // Used by claim links + share-URL copy.
  const effectiveSlug = profile.slug || deriveSlugFromName(profile.name);

  return (
    <ProfileView
      data={profile}
      effectiveSlug={effectiveSlug}
      isLoggedIn={isLoggedIn}
    />
  );
}
