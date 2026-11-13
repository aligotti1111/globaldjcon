// GET /api/songs/similar?name=John%20Summit&limit=6
//
// Songs by artists who make SIMILAR music to the one the host names — NOT that
// artist's own tracks. So "John Summit" returns a few top tracks from artists
// Deezer considers related to John Summit, letting the planner assistant say
// "if you like John Summit, you'll probably like these."
//
// Three Deezer hops: find the named artist → get their RELATED artists → grab a
// top track from each. Same no-key/no-session proxy and SAME Track shape as the
// other song endpoints, so the song cards render these identically.

import { NextResponse } from 'next/server';
import type { Track } from '@/lib/planner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_NAME = 100;
const MAX_LIMIT = 10;
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

async function dz(url: string): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function toTrack(t: DeezerTrack): Track {
  return {
    title: str(t.title_short) || str(t.title),
    artist: str(t.artist?.name) || undefined,
    source: 'catalogue',
    deezer_id: t.id != null ? String(t.id) : undefined,
    url: https(t.link),
    album_art: https(t.album?.cover_medium) || https(t.album?.cover_small),
    preview: https(t.preview),
  };
}

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const name = (sp.get('name') || '').trim().slice(0, MAX_NAME);
    if (name.length < 2) return NextResponse.json({ tracks: [] });
    const rawLimit = Number(sp.get('limit') || '6');
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 6));

    // 1) Find the named artist.
    const sj = (await dz(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=1`)) as { data?: Array<{ id?: number | string }> } | null;
    const artistId = Array.isArray(sj?.data) && sj!.data.length ? sj!.data[0]?.id : null;
    if (artistId == null) return NextResponse.json({ tracks: [], degraded: true });

    // 2) Artists Deezer considers related (similar music).
    const rj = (await dz(`https://api.deezer.com/artist/${encodeURIComponent(String(artistId))}/related?limit=${limit}`)) as { data?: Array<{ id?: number | string }> } | null;
    const relatedIds = (Array.isArray(rj?.data) ? rj!.data : [])
      .map((a) => (a?.id != null ? String(a.id) : ''))
      .filter(Boolean)
      .slice(0, limit);
    if (relatedIds.length === 0) return NextResponse.json({ tracks: [], degraded: true });

    // 3) One top track from each related artist (in parallel).
    const tops = await Promise.all(
      relatedIds.map(async (id) => {
        const tj = (await dz(`https://api.deezer.com/artist/${encodeURIComponent(id)}/top?limit=1`)) as { data?: DeezerTrack[] } | null;
        const row = Array.isArray(tj?.data) && tj!.data.length ? tj!.data[0] : null;
        return row ? toTrack(row) : null;
      }),
    );

    // Dedupe by title+artist, drop empties.
    const seen = new Set<string>();
    const tracks: Track[] = [];
    for (const t of tops) {
      if (!t || !t.title) continue;
      const key = `${t.title}|${t.artist || ''}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tracks.push(t);
    }

    return NextResponse.json({ tracks });
  } catch {
    return NextResponse.json({ tracks: [], degraded: true });
  }
}
