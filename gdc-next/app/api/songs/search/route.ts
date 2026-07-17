// GET /api/songs/search?q=uptown+funk
//
// The song picker's catalogue. Proxies Deezer.
//
// WHY NOT SPOTIFY — this was researched, argued and decided (July 2026):
//   · Spotify's Development Mode now requires Premium, is capped at one Client
//     ID, and is explicitly "for non-commercial use by individual developers…
//     should not be relied on as a foundation for building or scaling a
//     business". GDC is a business.
//   · The way out is Extended Quota, which requires a registered company AND
//     250k monthly active users. You must already be big to qualify — so
//     there's no legitimate path from here to there.
//   · Spotify REMOVED 30-second preview urls for apps registered after
//     November 2024. So the paid, non-compliant option can't let a client hear
//     the song, which is the entire point of a picker.
//   · Deezer's search needs no key, no account, no terms gymnastics, and
//     returns previews.
//
// The DJ still plays it in Spotify — /api/songs/resolve turns the Deezer track
// into the exact Spotify url at pick time. Best of both, and nobody can switch
// it off.
//
// NO SESSION. This is called from /planner/[id], where the client has no
// account and never will. It's a proxy over a public catalogue with no user
// data in it, so there's nothing here to protect — but see the caps.
//
// PROXIED, not called from the browser, for two reasons: Deezer's CORS is not
// something to bet a form on, and it keeps the client's typing out of a third
// party's logs with our users' IPs attached.
//
// Cloudflare eats 502s. 500 only.

import { NextResponse } from 'next/server';
import type { Track } from '@/lib/planner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_Q = 120;
const LIMIT = 8;
// Deezer is a courtesy, not a contract. If it's slow, the client gets to keep
// typing rather than watching a spinner — the free-text field is right there.
const TIMEOUT_MS = 6000;

/** One Deezer search hit. Only the fields we actually read. */
interface DeezerTrack {
  id?: number | string;
  title?: string;
  title_short?: string;
  link?: string;
  preview?: string;
  artist?: { name?: string };
  album?: { title?: string; cover_small?: string; cover_medium?: string };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const https = (v: unknown): string | undefined =>
  typeof v === 'string' && /^https:\/\//i.test(v) ? v : undefined;

export async function GET(req: Request) {
  try {
    const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, MAX_Q);
    // Two characters returns the whole catalogue and helps nobody.
    if (q.length < 2) return NextResponse.json({ tracks: [] });

    const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${LIMIT}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    } finally {
      clearTimeout(timer);
    }

    // Deezer rate-limits (and says so with 4xx). Empty results, not an error:
    // the field still works, it just has nothing to offer this second.
    if (!res.ok) return NextResponse.json({ tracks: [], degraded: true });

    const j = (await res.json().catch(() => null)) as { data?: unknown } | null;
    const rows = Array.isArray(j?.data) ? (j!.data as DeezerTrack[]) : [];

    // REBUILT, not passed through. Same rule as the planner's own sanitiser:
    // never hand the browser a third party's json shape, because then their
    // shape is our contract and their next release is our outage.
    const tracks: Track[] = rows
      .map((t): Track => ({
        title: str(t.title_short) || str(t.title),
        artist: str(t.artist?.name) || undefined,
        source: 'catalogue',
        deezer_id: t.id != null ? String(t.id) : undefined,
        url: https(t.link),
        album_art: https(t.album?.cover_medium) || https(t.album?.cover_small),
        preview: https(t.preview),
      }))
      .filter((t) => !!t.title);

    return NextResponse.json({ tracks });
  } catch {
    // Aborted, DNS, malformed json — all the same to the client: no results.
    // A search box that errors is a search box people stop trusting; one that
    // finds nothing, they just type it themselves. 200 on purpose.
    return NextResponse.json({ tracks: [], degraded: true });
  }
}
