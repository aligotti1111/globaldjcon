// Constants ported from vanilla dj-profile.html lines 386-399.
// Maps internal slug values to human-readable labels.

export const EVENT_TYPE_LABELS: Record<string, string> = {
  'weddings': 'Weddings',
  'corporate': 'Corporate Events',
  'birthday': 'Birthday Parties',
  'sweet16': 'Sweet 16 / Quinceañera',
  'mitzvah': 'Bar/Bat Mitzvahs',
  'graduation': 'Graduations',
  'anniversary': 'Anniversaries',
  'holiday': 'Holiday Parties',
  'school': 'School Events',
  'reunion': 'Reunions',
  'community': 'Community Events',
  'clubs': 'Clubs & Bars',
  'festivals': 'Festivals',
  'pool-party': 'Pool Parties',
  'rooftop': 'Rooftop Events',
};

export const GENRE_LABELS: Record<string, string> = {
  'open-format': 'Open Format',
  'hip-hop': 'Hip Hop',
  'edm': 'EDM / Electronic',
  'house': 'House',
  'techno': 'Techno',
  'top40': 'Top 40',
  'rnb': 'R&B',
  'latin': 'Latin / Reggaeton',
  'country': 'Country',
  'rock': 'Rock',
  'disco': 'Disco / Funk',
  'afrobeats': 'Afrobeats',
};

// Initials helper from vanilla — first letter of each space-separated word, max 2 chars.
export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .map(w => w[0] || '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}
