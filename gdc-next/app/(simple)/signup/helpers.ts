// Shared constants and helpers for the signup flow.
// Kept separate from page.tsx so the page file stays readable.

export type AccountType = 'dj' | 'host' | 'venue';
export type DjType = 'mobile' | 'club';

// Country list — same options as vanilla signup.html.
// `code` is the ISO country code used by Nominatim for ZIP lookups (Session 3).
export interface Country {
  name: string;
  code: string;
  // Example postal code for this country — shown as the ZIP field
  // placeholder so the format hint matches the selected country.
  zipExample: string;
}

export const COUNTRIES: Country[] = [
  { name: 'United States', code: 'us', zipExample: '10001' },
  { name: 'United Kingdom', code: 'gb', zipExample: 'SW1A 1AA' },
  { name: 'Canada', code: 'ca', zipExample: 'M5V 2T6' },
  { name: 'Australia', code: 'au', zipExample: '2000' },
  { name: 'Germany', code: 'de', zipExample: '10115' },
  { name: 'France', code: 'fr', zipExample: '75001' },
  { name: 'Netherlands', code: 'nl', zipExample: '1011 AB' },
  { name: 'Spain', code: 'es', zipExample: '28001' },
  { name: 'Italy', code: 'it', zipExample: '00184' },
  { name: 'Brazil', code: 'br', zipExample: '01310-100' },
  { name: 'Mexico', code: 'mx', zipExample: '06000' },
  { name: 'Japan', code: 'jp', zipExample: '100-0001' },
  { name: 'South Africa', code: 'za', zipExample: '8001' },
  { name: 'New Zealand', code: 'nz', zipExample: '6011' },
  { name: 'Ireland', code: 'ie', zipExample: 'D02 AF30' },
  { name: 'Sweden', code: 'se', zipExample: '111 29' },
  { name: 'Norway', code: 'no', zipExample: '0150' },
  { name: 'Denmark', code: 'dk', zipExample: '1050' },
  { name: 'Belgium', code: 'be', zipExample: '1000' },
  { name: 'Switzerland', code: 'ch', zipExample: '8001' },
  { name: 'Portugal', code: 'pt', zipExample: '1100-148' },
  { name: 'Other', code: '', zipExample: '' },
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
