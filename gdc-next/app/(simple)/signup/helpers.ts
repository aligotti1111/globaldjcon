// Shared constants and helpers for the signup flow.
// Kept separate from page.tsx so the page file stays readable.

export type AccountType = 'dj' | 'host' | 'venue';
export type DjType = 'mobile' | 'club';

// Country list — same options as vanilla signup.html.
// `code` is the ISO country code used by Nominatim for ZIP lookups (Session 3).
export interface Country {
  name: string;
  code: string;
}

export const COUNTRIES: Country[] = [
  { name: 'United States', code: 'us' },
  { name: 'United Kingdom', code: 'gb' },
  { name: 'Canada', code: 'ca' },
  { name: 'Australia', code: 'au' },
  { name: 'Germany', code: 'de' },
  { name: 'France', code: 'fr' },
  { name: 'Netherlands', code: 'nl' },
  { name: 'Spain', code: 'es' },
  { name: 'Italy', code: 'it' },
  { name: 'Brazil', code: 'br' },
  { name: 'Mexico', code: 'mx' },
  { name: 'Japan', code: 'jp' },
  { name: 'South Africa', code: 'za' },
  { name: 'New Zealand', code: 'nz' },
  { name: 'Ireland', code: 'ie' },
  { name: 'Sweden', code: 'se' },
  { name: 'Norway', code: 'no' },
  { name: 'Denmark', code: 'dk' },
  { name: 'Belgium', code: 'be' },
  { name: 'Switzerland', code: 'ch' },
  { name: 'Portugal', code: 'pt' },
  { name: 'Other', code: '' },
];

// Distance options for DJ travel range (vanilla parity)
export const TRAVEL_DISTANCES: { value: string; label: string }[] = [
  { value: 'worldwide', label: 'Worldwide' },
  ...[10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 125, 150, 175, 200].map(n => ({
    value: String(n),
    label: `${n} miles`,
  })),
];

// Convert a name (or any text) to a URL-safe slug.
// Matches the makeSlug() function from vanilla sgn-core.js.
export function makeSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Generate alternative slugs when the user's first choice is taken.
// Mirrors vanilla generateAlternatives() in sgn-slug-dj.js.
export function generateDjAlternatives(slug: string): string[] {
  if (!slug) return [];
  const parts = slug.split('-');
  const candidates = [
    parts.join('_'),
    parts.join(''),
    parts.join('.'),
    slug.startsWith('dj-') ? slug : 'dj-' + slug,
    slug + '-official',
    slug + '-music',
    slug + '-mixes',
  ];
  return [...new Set(candidates)].filter(s => s !== slug && s.length > 0).slice(0, 6);
}

// Mirrors vanilla generateVenueAlternatives() in sgn-slug-venue.js.
export function generateVenueAlternatives(slug: string): string[] {
  if (!slug) return [];
  const candidates = [
    slug + '-venue',
    slug + '-events',
    slug + '-official',
    slug + '-nyc',
    slug + '-' + new Date().getFullYear(),
    slug + '-club',
  ];
  return [...new Set(candidates)].filter(s => s !== slug && s.length > 0).slice(0, 6);
}
