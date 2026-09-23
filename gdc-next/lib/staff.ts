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
