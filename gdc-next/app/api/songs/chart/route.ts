// GET /api/songs/chart?limit=25
//
// Deezer's LIVE top-tracks chart — real songs that are current right now. The
// planner assistant uses this to answer "give me this year's / the latest
// hits" with actual releases instead of the model guessing (its knowledge
// isn't live, so it can't reliably name current-year songs).
//
// Same no-key, no-session Deezer proxy as /api/songs/search, and the SAME Track
// shape, so the song cards render these identically.
//
// Cloudflare eats 502s. 500 only (here we just return an empty list on any
// failure — a missing chart isn't worth erroring the whole reply over).

import { NextResponse } from 'next/server';
import type { Track } from '@/lib/planner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 50;
const TIMEOUT_MS = 6000;

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
    const raw = Number(new URL(req.url).searchParams.get('limit') || '25');
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(raw) ? raw : 25));

    const url = `https://api.deezer.com/chart/0/tracks?limit=${limit}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return NextResponse.json({ tracks: [], degraded: true });

    const j = (await res.json().catch(() => null)) as { data?: unknown } | null;
    const rows = Array.isArray(j?.data) ? (j!.data as DeezerTrack[]) : [];

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
    return NextResponse.json({ tracks: [], degraded: true });
  }
}
