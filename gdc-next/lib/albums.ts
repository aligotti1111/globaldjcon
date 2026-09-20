// lib/albums.ts — photo-album model for the DJ profile gallery.
//
// Albums are a light grouping OVER the existing gallery: the gallery of record
// is users.gallery_photos (string[] of URLs, newest appended last). An album
// just references a subset of those same URLs. This module owns the shape,
// parsing (jsonb is untyped at the client), ordering, and the per-tier limits.

export interface Album {
  id: string;
  name: string;
  cover: string | null; // a URL that also lives in `photos`
  photos: string[]; // member URLs, newest last (mirrors gallery order)
}

// Which paid tiers may CREATE albums, and how many they get. Everyone can view
// albums a DJ made; only Premium Pro (3) and Enterprise (4) can create them.
// (Tiers: 1 Starter, 2 Pro, 3 Premium Pro, 4 Enterprise — see lib/access.ts.)
export const ALBUM_TIER_MIN = 3;

export function albumLimitForTier(tier: number): number {
  if (tier >= 4) return Infinity; // Enterprise — unlimited
  if (tier === 3) return 10; // Premium Pro
  return 0; // everyone else — cannot create albums
}

export function canCreateAlbums(tier: number): boolean {
  return tier >= ALBUM_TIER_MIN;
}

// A short, url-safe random id for a new album.
export function newAlbumId(): string {
  const r =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  return r.replace(/[^a-z0-9]/gi, '').slice(0, 12);
}

// Parse whatever came back from jsonb into a clean Album[]. Tolerates the
// legacy/empty cases and drops anything malformed rather than throwing.
export function parseAlbums(raw: unknown): Album[] {
  if (!Array.isArray(raw)) return [];
  const out: Album[] = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue;
    const o = a as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    const name = typeof o.name === 'string' ? o.name : '';
    if (!id || !name) continue;
    const photos = Array.isArray(o.photos)
      ? (o.photos.filter((p) => typeof p === 'string') as string[])
      : [];
    const cover =
      typeof o.cover === 'string' && o.cover ? o.cover : photos[photos.length - 1] || null;
    out.push({ id, name, cover, photos });
  }
  return out;
}

// gallery_photos is stored append-order (oldest first). The gallery shows
// newest first, so reverse a shallow copy for display.
export function newestFirst(photos: string[]): string[] {
  return [...photos].reverse();
}

// Keep album membership honest: an album can only contain URLs that still
// exist in the gallery. Call after a photo is removed from gallery_photos.
export function pruneAlbums(albums: Album[], galleryPhotos: string[]): Album[] {
  const live = new Set(galleryPhotos);
  return albums.map((a) => {
    const photos = a.photos.filter((u) => live.has(u));
    const cover = a.cover && live.has(a.cover) ? a.cover : photos[photos.length - 1] || null;
    return { ...a, photos, cover };
  });
}

// Count of photos in an album (for the card subtitle).
export function albumCount(a: Album): number {
  return a.photos.length;
}
