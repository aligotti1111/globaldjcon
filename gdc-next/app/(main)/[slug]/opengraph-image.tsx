// Open Graph preview image for DJ profile pages (/[slug]).
//
// Produces the 1200x630 thumbnail that messaging apps and social networks
// show when a DJ shares their profile link. Two cases:
//   1. The DJ has a banner   → render the banner filling the frame (cover).
//   2. No banner, has avatar → render the avatar centered on a BLACK
//      background, so the letterbox area around the square/circular avatar
//      is solid black rather than a platform-chosen fill.
//   3. Neither               → branded black card with the site name.
//
// Next.js automatically wires the resulting image into the page's
// og:image / twitter:image tags — no manual <meta> needed.

import { ImageResponse } from 'next/og';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const alt = 'Global DJ Connect profile';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const UUID_REGEX = /^[0-9a-f-]{36}$/;

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function OgImage({ params }: Props) {
  const { slug } = await params;
  const supabase = await createClient();

  const isUUID = UUID_REGEX.test(slug);
  const cols = 'name, dj_type, role, avatar_url, banner_url, profile_private';
  const builder = isUUID
    ? supabase.from('users').select(cols).eq('id', slug)
    : supabase.from('users').select(cols).eq('slug', slug);

  const { data } = await builder.maybeSingle<{
    name: string | null;
    dj_type: 'mobile' | 'club' | null;
    role: string | null;
    avatar_url: string | null;
    banner_url: string | null;
    profile_private: boolean | null;
  }>();

  const usable = data && data.role === 'dj' && !data.profile_private;
  const banner = usable ? data!.banner_url : null;
  const avatar = usable ? data!.avatar_url : null;
  const djName = (usable && data!.name) || 'Global DJ Connect';

  // Case 1: banner present → fill the whole 1200x630 frame with it.
  if (banner) {
    return new ImageResponse(
      (
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: '100%',
            backgroundColor: '#000000',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={banner}
            alt=""
            width={1200}
            height={630}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      ),
      { ...size }
    );
  }

  // Case 2: avatar only → centered on a solid black background.
  if (avatar) {
    return new ImageResponse(
      (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            backgroundColor: '#000000',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatar}
            alt=""
            width={520}
            height={520}
            style={{
              width: 520,
              height: 520,
              objectFit: 'cover',
              borderRadius: '50%',
            }}
          />
        </div>
      ),
      { ...size }
    );
  }

  // Case 3: nothing → branded black card with the name/site.
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          backgroundColor: '#000000',
          color: '#00f5c4',
          fontSize: 72,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          textAlign: 'center',
          padding: '0 80px',
        }}
      >
        {djName}
      </div>
    ),
    { ...size }
  );
}
