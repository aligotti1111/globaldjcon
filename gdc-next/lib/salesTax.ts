// Base US state sales-tax rates — a STARTING SUGGESTION only.
//
// These are state-level base rates. They do NOT include local county/city
// add-ons (e.g. New York State is 4%, but New York City totals ~8.875%), and
// rates change over time. This is a convenience guess the DJ can adjust — it is
// not tax advice, and the DJ is responsible for charging/remitting the correct
// amount. Non-US locations return null (the DJ enters their own rate).

const STATE_BASE_RATE: Record<string, number> = {
  AL: 4, AK: 0, AZ: 5.6, AR: 6.5, CA: 7.25, CO: 2.9, CT: 6.35, DE: 0,
  FL: 6, GA: 4, HI: 4, ID: 6, IL: 6.25, IN: 7, IA: 6, KS: 6.5, KY: 6,
  LA: 4.45, ME: 5.5, MD: 6, MA: 6.25, MI: 6, MN: 6.875, MS: 7, MO: 4.225,
  MT: 0, NE: 5.5, NV: 6.85, NH: 0, NJ: 6.625, NM: 4.875, NY: 4, NC: 4.75,
  ND: 5, OH: 5.75, OK: 4.5, OR: 0, PA: 6, RI: 7, SC: 6, SD: 4.2, TN: 7,
  TX: 6.25, UT: 6.1, VT: 6, VA: 5.3, WA: 6.5, WV: 6, WI: 5, WY: 4, DC: 6,
};

const NAME_TO_ABBR: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC', 'washington dc': 'DC', 'washington d.c.': 'DC',
};

// Guess a base sales-tax % from a US state (2-letter code or full name).
// Returns null for unknown / non-US locations.
export function guessStateTaxRate(state?: string | null): number | null {
  if (!state) return null;
  const s = state.trim();
  if (!s) return null;
  const abbr = s.length === 2 ? s.toUpperCase() : NAME_TO_ABBR[s.toLowerCase()];
  if (!abbr) return null;
  const r = STATE_BASE_RATE[abbr];
  return r != null ? r : null;
}
