// Staff members and recommended affiliates for a DJ profile (mobile DJs only).
// Both are stored as jsonb arrays on public.users (staff / affiliates) and
// parsed defensively here so a malformed row never crashes the profile.

export const STAFF_MAX = 20;
export const AFFILIATES_MAX = 20;

export interface StaffMember {
  id: string;
  name: string;
  position: string;
  photo?: string | null;   // uploaded image URL; optional (initials fallback)
}

export interface Affiliate {
  id: string;
  name: string;
  companyType: string;     // "type of company"
  description?: string;    // optional blurb
  image?: string | null;   // logo/representative image; optional
  url?: string;            // optional website; photo + name link to it
  bgColor?: string | null; // optional card background color (hex); null = default
}

/** A hex color like #0a0a0f or #abc, else null. Guards stored/entered values. */
export function safeHexColor(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s : null;
}

/** True when a hex color is light enough that dark text reads better on it.
 *  Uses perceived luminance (sRGB). Falls back to false (dark) on bad input. */
export function isLightHex(hex: string | null | undefined): boolean {
  const c = safeHexColor(hex);
  if (!c) return false;
  let h = c.slice(1);
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // Rec. 601 luma, 0–255. > ~150 reads as "light".
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150;
}

// Normalize a user-entered website into a safe http(s) URL, or '' if invalid.
// Bare domains (e.g. "bloomco.com") get https:// prepended. Only http/https
// are allowed — anything else (javascript:, mailto:, etc.) is rejected.
export function normalizeUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const t = raw.trim();
  if (!t) return '';
  const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href;
  } catch {
    return '';
  }
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

export function parseStaff(raw: unknown): StaffMember[] {
  return coerceArray(raw)
    .map((r): StaffMember | null => {
      if (!r || typeof r !== 'object') return null;
      const o = r as Record<string, unknown>;
      const name = typeof o.name === 'string' ? o.name : '';
      const position = typeof o.position === 'string' ? o.position : '';
      if (!name && !position && !o.photo) return null;
      return {
        id: typeof o.id === 'string' && o.id ? o.id : newEntryId(),
        name,
        position,
        photo: typeof o.photo === 'string' ? o.photo : null,
      };
    })
    .filter((x): x is StaffMember => x !== null)
    .slice(0, STAFF_MAX);
}

export function parseAffiliates(raw: unknown): Affiliate[] {
  return coerceArray(raw)
    .map((r): Affiliate | null => {
      if (!r || typeof r !== 'object') return null;
      const o = r as Record<string, unknown>;
      const name = typeof o.name === 'string' ? o.name : '';
      const companyType = typeof o.companyType === 'string' ? o.companyType : '';
      if (!name && !companyType && !o.image) return null;
      return {
        id: typeof o.id === 'string' && o.id ? o.id : newEntryId(),
        name,
        companyType,
        description: typeof o.description === 'string' ? o.description : '',
        image: typeof o.image === 'string' ? o.image : null,
        url: normalizeUrl(o.url),
        bgColor: safeHexColor(o.bgColor),
      };
    })
    .filter((x): x is Affiliate => x !== null)
    .slice(0, AFFILIATES_MAX);
}

export function newEntryId(): string {
  return `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Initials for the placeholder tile when no image is uploaded.
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
