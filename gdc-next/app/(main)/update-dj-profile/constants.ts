// Constants for the Update DJ Profile form. Faithful to vanilla:
//   - Mobile party type list: dj-profile.html lines 108-119
//   - Club genre list: dj-profile.html lines 130-141
//   - Travel distances: dj-profile.html lines 188-213
//   - DJ start years: dj-profile.html lines 220-287

export const MOBILE_EVENT_TYPES: { val: string; label: string }[] = [
  { val: 'weddings', label: 'Weddings' },
  { val: 'corporate', label: 'Corporate Events' },
  { val: 'birthday', label: 'Birthday Parties' },
  { val: 'anniversary', label: 'Anniversaries' },
  { val: 'graduation', label: 'Graduations' },
  { val: 'sweet16', label: 'Sweet 16 / Quinceañera' },
  { val: 'mitzvah', label: 'Bar/Bat Mitzvahs' },
  { val: 'reunion', label: 'Reunions' },
  { val: 'holiday', label: 'Holiday Parties' },
  { val: 'school', label: 'School Events' },
  { val: 'community', label: 'Community Events' },
  { val: 'other', label: 'Other' },
];

export const CLUB_GENRES: { val: string; label: string }[] = [
  { val: 'open-format', label: 'Open Format' },
  { val: 'hip-hop', label: 'Hip Hop' },
  { val: 'edm', label: 'EDM / Electronic' },
  { val: 'house', label: 'House' },
  { val: 'techno', label: 'Techno' },
  { val: 'top40', label: 'Top 40' },
  { val: 'rnb', label: 'R&B' },
  { val: 'latin', label: 'Latin / Reggaeton' },
  { val: 'country', label: 'Country' },
  { val: 'rock', label: 'Rock' },
  { val: 'disco', label: 'Disco / Funk' },
  { val: 'afrobeats', label: 'Afrobeats' },
];

export const COUNTRIES: { val: string; label: string }[] = [
  { val: '', label: 'Select country...' },
  { val: 'United States', label: 'United States' },
  { val: 'United Kingdom', label: 'United Kingdom' },
  { val: 'Canada', label: 'Canada' },
  { val: 'Australia', label: 'Australia' },
  { val: 'Germany', label: 'Germany' },
  { val: 'France', label: 'France' },
  { val: 'Netherlands', label: 'Netherlands' },
  { val: 'Spain', label: 'Spain' },
  { val: 'Italy', label: 'Italy' },
  { val: 'Brazil', label: 'Brazil' },
  { val: 'Mexico', label: 'Mexico' },
  { val: 'Japan', label: 'Japan' },
  { val: 'South Africa', label: 'South Africa' },
  { val: 'New Zealand', label: 'New Zealand' },
  { val: 'Ireland', label: 'Ireland' },
  { val: 'Sweden', label: 'Sweden' },
  { val: 'Norway', label: 'Norway' },
  { val: 'Denmark', label: 'Denmark' },
  { val: 'Belgium', label: 'Belgium' },
  { val: 'Switzerland', label: 'Switzerland' },
  { val: 'Portugal', label: 'Portugal' },
  { val: 'Other', label: 'Other' },
];

export const TRAVEL_DISTANCES: { val: string; label: string }[] = [
  { val: '', label: 'Select distance...' },
  { val: 'worldwide', label: 'Worldwide' },
  ...['10','15','20','25','30','35','40','45','50','55','60','65','70','75','80','85','90','95','100','125','150','175','200']
    .map(v => ({ val: v, label: `${v} miles` })),
];

// Generated descending from current year (2026) down to 1960. Vanilla
// hardcodes the list; we generate from `new Date()` so it stays current
// without manual edits.
export const DJ_START_YEARS: { val: string; label: string }[] = (() => {
  const opts: { val: string; label: string }[] = [{ val: '', label: 'Select year...' }];
  const cur = new Date().getFullYear();
  for (let y = cur; y >= 1960; y--) opts.push({ val: String(y), label: String(y) });
  return opts;
})();

// Categorization of mobile event types into package categories.
// Used by the Booking tab packages section to decide which package
// categories to render. Faithful to udjp-booking-mobile.js lines 49-51.
export const MOB_CAT_GENERAL_TYPES = [
  'birthday','graduation','holiday','community','corporate','anniversary','sweet16','reunion','school','other'
];
export const MOB_CAT_WEDDING_TYPES = ['weddings'];
export const MOB_CAT_MITZVAH_TYPES = ['mitzvah'];

export type PkgCategory = 'general' | 'wedding' | 'mitzvah';

export function getActivePackageCategories(eventTypes: string[]): PkgCategory[] {
  const cats: PkgCategory[] = [];
  if (eventTypes.some(t => MOB_CAT_GENERAL_TYPES.includes(t))) cats.push('general');
  if (eventTypes.some(t => MOB_CAT_WEDDING_TYPES.includes(t))) cats.push('wedding');
  if (eventTypes.some(t => MOB_CAT_MITZVAH_TYPES.includes(t))) cats.push('mitzvah');
  return cats;
}
