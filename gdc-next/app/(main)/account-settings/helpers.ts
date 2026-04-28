// Helpers for /account-settings — country list, slug normalization, Nominatim
// address autocomplete. All pure / browser-side functions.

export const COUNTRIES = [
  'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany',
  'France', 'Netherlands', 'Spain', 'Italy', 'Brazil', 'Mexico', 'Japan',
  'South Africa', 'New Zealand', 'Ireland', 'Sweden', 'Norway', 'Denmark',
  'Belgium', 'Switzerland', 'Portugal', 'Other',
];

// Country → ISO 3166-1 alpha-2 codes for Nominatim's countrycodes filter.
// Matches vanilla COUNTRY_CODES_ADDR.
export const COUNTRY_CODES_ADDR: Record<string, string> = {
  'United States': 'us', 'United Kingdom': 'gb', 'Canada': 'ca',
  'Australia': 'au', 'Germany': 'de', 'France': 'fr', 'Netherlands': 'nl',
  'Spain': 'es', 'Italy': 'it', 'Brazil': 'br', 'Mexico': 'mx', 'Japan': 'jp',
  'South Africa': 'za', 'New Zealand': 'nz', 'Ireland': 'ie', 'Sweden': 'se',
  'Norway': 'no', 'Denmark': 'dk', 'Belgium': 'be', 'Switzerland': 'ch',
  'Portugal': 'pt',
};

// Normalize a string into a URL slug — lowercase, alphanumeric + hyphens.
// Faithful port of vanilla makeVenueSlug.
export function makeSlug(str: string): string {
  return (str || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Address suggestion shape — same fields as the booking form's helpers.
export interface AddressSuggestion {
  display: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

// Nominatim address search. Pass the user's country to bias results via
// the countrycodes filter when we have an ISO mapping for it.
export async function searchAddresses(
  query: string,
  country: string
): Promise<AddressSuggestion[]> {
  if (query.length < 5) return [];
  const cc = COUNTRY_CODES_ADDR[country] || '';
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}${
    cc ? '&countrycodes=' + cc : ''
  }&format=json&limit=5&addressdetails=1`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((r: { display_name?: string; address?: Record<string, string> }) => {
      const addr = r.address || {};
      const city = addr.suburb || addr.city || addr.town || addr.village || '';
      const state = addr.state || '';
      const zip = addr.postcode || '';
      const street = (addr.house_number ? addr.house_number + ' ' : '') + (addr.road || '');
      return {
        display: r.display_name || '',
        street,
        city,
        state,
        zip,
      };
    });
  } catch {
    return [];
  }
}
