// Constants ported from vanilla dj-profile.html lines 386-399.
// Maps internal slug values to human-readable labels.

export const EVENT_TYPE_LABELS: Record<string, string> = {
  'weddings': 'Weddings',
  'corporate': 'Corporate Events',
  'birthday': 'Birthday Parties',
  // Split from a single 'sweet16' => 'Sweet 16 / Quinceañera' entry. They are
  // two different parties — a quinceañera is a cultural and religious event
  // with its own running order — and a DJ who does one may not do the other.
  // One combined checkbox forced them to claim both or neither.
  // PLURAL here on purpose: this map labels a DJ's profile hero — what they
  // do, sitting next to 'Weddings' and 'Graduations'. The booking dropdown
  // (lib/constants.ts, [slug]/mobileBookingForm.ts) uses the singular for one
  // specific booking. Both maps exist deliberately; don't merge them.
  'sweet16': 'Sweet 16s',
  'quinceanera': 'Quinceañeras',
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
