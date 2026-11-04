// Press / media mentions for a club-or-bar DJ profile (a subscription-only
// tab). Each item is an article the DJ was mentioned in: the link, a title and
// publication name (auto-scraped from the page's OpenGraph tags when added),
// and a preview image (scraped, or uploaded by the DJ as a fallback). Stored as
// a jsonb array on public.users.press and parsed defensively here so a
// malformed row never crashes the profile.

import { normalizeUrl } from './staff';

export const PRESS_MAX = 24;

export interface PressItem {
  id: string;
  url: string;              // the article link (http/https, normalized)
  title: string;            // headline (scraped og:title, DJ can't blank it)
  publication?: string;     // source name (scraped og:site_name), optional
  image?: string | null;    // preview image URL (scraped or uploaded), optional
  addedAt?: number;         // epoch ms, for stable newest-first ordering
}

function coerceArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function parsePress(raw: unknown): PressItem[] {
  return coerceArray(raw)
    .map((r): PressItem | null => {
      if (!r || typeof r !== 'object') return null;
      const o = r as Record<string, unknown>;
      const url = normalizeUrl(o.url);
      if (!url) return null; // an item with no valid link is meaningless
      const title = typeof o.title === 'string' ? o.title : '';
      return {
        id: typeof o.id === 'string' && o.id ? o.id : newPressId(),
        url,
        title,
        publication: typeof o.publication === 'string' ? o.publication : '',
        image: typeof o.image === 'string' ? o.image : null,
        addedAt: typeof o.addedAt === 'number' && Number.isFinite(o.addedAt) ? o.addedAt : undefined,
      };
    })
    .filter((x): x is PressItem => x !== null)
    .slice(0, PRESS_MAX);
}

export function newPressId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// A readable host label from a URL (e.g. "nytimes.com") — the fallback shown
// when a scrape didn't return a publication name.
export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
