// resolvePackage — single source of truth for turning the DJ's saved packages
// into the ONE package that applies to a given event type + package index.
//
// It understands BOTH shapes of booking_settings.mob_packages:
//
//   OLD (today):   { general: Pkg[], wedding: Pkg[], mitzvah: Pkg[] }
//                  Price comes from the event's bucket (wedding/mitzvah/general);
//                  title/details/photo(s) inherit from general[index] when blank.
//
//   NEW (spec):    { general: Pkg[], overrides: { [eventType]: Partial<Pkg>[] } }
//                  Price + everything inherit from general[index]; the override
//                  for that event type wins for whatever fields it sets.
//
// It is a PURE reader — no writes, no side effects — so it can be dropped in
// front of the current bucket lookup without changing any stored data, and its
// old-shape output is byte-identical to what the app resolves today.

export type Pkg = Record<string, unknown>;

// Same mapping the app uses today (mobileBookingForm.getPackageCategory).
function oldBucket(eventType: string): 'wedding' | 'mitzvah' | 'general' {
  if (eventType === 'weddings') return 'wedding';
  if (eventType === 'mitzvah') return 'mitzvah';
  return 'general';
}

// "Blank" = the app's notion of an unset field: undefined/null, empty string,
// or an empty array. Matches the inherit-from-general-when-blank behavior.
function isBlank(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

// Fields that inherit their DISPLAY value from the General package at the same
// index when the event-specific package leaves them blank. (Prices are NOT in
// this list — a bucket's price is used as-is, exactly as today.)
const INHERITED_DISPLAY_FIELDS = ['title', 'details', 'photo', 'photos'] as const;

function isNewShape(mob: Record<string, unknown>): boolean {
  return !!mob && typeof mob === 'object' && 'overrides' in mob;
}

/**
 * Resolve the package that applies to `eventType` at `index`.
 * Returns null when there is no package at that index (matches today's
 * `categoryPkgs[index] ?? null`).
 */
export function resolvePackage(
  mobPackages: Record<string, unknown> | null | undefined,
  eventType: string,
  index: number,
): Pkg | null {
  const mob = (mobPackages || {}) as Record<string, unknown>;
  const general = (mob.general as Pkg[] | undefined) || [];
  const base = general[index] || null;

  if (isNewShape(mob)) {
    const overrides = (mob.overrides as Record<string, Pkg[]> | undefined) || {};
    const ov = overrides[eventType]?.[index] || null;
    // No override for this type -> inherit the General package entirely.
    if (!ov) return base ? { ...base } : null;
    // Override present -> it carries the COMPLETE package for this type (prices
    // included, as-is). Only DISPLAY fields inherit from General when blank.
    // Price fields are NEVER borrowed from General: a blank price means "no
    // price -> request a quote", exactly as the old bucket model behaved.
    const merged: Pkg = { ...ov };
    if (base && base !== ov) {
      for (const fld of INHERITED_DISPLAY_FIELDS) {
        if (isBlank(merged[fld]) && !isBlank(base[fld])) merged[fld] = base[fld];
      }
    }
    return merged;
  }

  // ── OLD shape ──
  const bucket = oldBucket(eventType);
  const cur = ((mob[bucket] as Pkg[] | undefined) || [])[index] || null;
  if (!cur) return null;

  // Start from the event's own package (its prices win, as-is), then fill only
  // the blank DISPLAY fields from General at the same index.
  const merged: Pkg = { ...cur };
  if (base && base !== cur) {
    for (const f of INHERITED_DISPLAY_FIELDS) {
      if (isBlank(merged[f]) && !isBlank(base[f])) merged[f] = base[f];
    }
  }
  return merged;
}
