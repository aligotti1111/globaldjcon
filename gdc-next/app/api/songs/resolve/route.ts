// POST /api/songs/resolve   { url: "https://www.deezer.com/track/123" }
//
// Turns the track the CLIENT picked into the link the DJ will actually open.
//
// The client searches our box (Deezer). The DJ plays it in Spotify. Odesli
// (song.link) is the bridge: hand it any music url, get back that same track on
// every other service. Free, no key, ~10 requests a minute.
//
// CALLED ONCE, AT PICK TIME. Not on render. A 30-song wedding resolved on every
// page load would be 30 calls against a 10/min limit for an answer that never
// changes. Resolve when they choose it, store it on the track, done — by the
// night the work is already finished and the DJ's link is exact.
//
// It also costs nothing to get Apple and YouTube in the same response, which
// Spotify's own API could never have given us.
//
// FAILS SOFT, ALWAYS. Rate-limited, down, or the track genuinely isn't on
// Spotify (regional, exclusive) — the picked song still saves, and the DJ's
// panel falls back to a search link. Nobody loses a first dance because a
// third-party lookup had a bad second.
//
// NO SESSION — same as /api/songs/search, and same reason.
// Cloudflare eats 502s. 500 only (and this route never even needs one).

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 6000;

/** Only the shape we read. Odesli returns far more. */
interface OdesliResponse {
  linksByPlatform?: Record<string, { url?: string } | undefined>;
}

const https = (v: unknown): string | undefined =>
  typeof v === 'string' && /^https:\/\//i.test(v) ? v : undefined;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { url?: unknown };
    const url = typeof body.url === 'string' ? body.url : '';

    // Deezer track urls only. This route hands whatever it's given to a third
    // party — without a whitelist it's an open proxy pointed at anything.
    if (!/^https:\/\/(www\.)?deezer\.com\/(\w\w\/)?track\/\d+/i.test(url)) {
      return NextResponse.json({ links: {} });
    }

    const api = `https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(url)}&userCountry=US`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(api, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    } finally {
      clearTimeout(timer);
    }

    // 429 lives here. Empty links, 200 — the caller stores the track regardless.
    if (!res.ok) return NextResponse.json({ links: {}, degraded: true });

    const j = (await res.json().catch(() => null)) as OdesliResponse | null;
    const by = j?.linksByPlatform || {};

    return NextResponse.json({
      links: {
        spotify: https(by.spotify?.url),
        apple: https(by.appleMusic?.url),
        youtube: https(by.youtube?.url) || https(by.youtubeMusic?.url),
      },
    });
  } catch {
    return NextResponse.json({ links: {}, degraded: true });
  }
}
