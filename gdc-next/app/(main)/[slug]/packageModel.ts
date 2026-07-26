// packageModel — the canonical NEW shape of booking_settings.mob_packages and a
// pure reader that lifts EITHER stored shape into it, in memory, without ever
// writing. This is what makes migration lazy: existing data is left untouched;
// the editor reads through normalizeMobPackages() and only the editor's save
// path writes the new shape.
//
//   OLD:  { general: Pkg[], wedding: Pkg[], mitzvah: Pkg[] }
//   NEW:  { general: Pkg[], overrides: { [eventType: string]: Pkg[] } }
//
// A migrated wedding/mitzvah package is kept as a FULL override (a copy of the
// old bucket package). resolvePackage()'s new-shape merge skips blank override
// fields, so a full override resolves BYTE-IDENTICALLY to the old bucket
// lookup — proven by the parity tests. That's the whole point: normalize is a
// re-key, not a re-price.

export type Pkg = Record<string, unknown>;

export interface MobPackagesNew {
  general: Pkg[];
  overrides: Record<string, Pkg[]>;
}

// Old bucket key -> the event_type the new shape keys overrides by.
// (Storage used 'wedding'/'mitzvah'; the app's event_type strings are
// 'weddings'/'mitzvah'. New shape keys by the event_type.)
const OLD_BUCKET_TO_EVENT: Record<string, string> = {
  wedding: 'weddings',
  mitzvah: 'mitzvah',
};

function isNewShape(mob: Record<string, unknown>): boolean {
  return !!mob && typeof mob === 'object' && 'overrides' in mob;
}

/**
 * Lift any stored mob_packages into the canonical new shape, in memory.
 * Never mutates the input; returns a fresh object.
 */
export function normalizeMobPackages(
  stored: Record<string, unknown> | null | undefined,
): MobPackagesNew {
  const mob = (stored || {}) as Record<string, unknown>;
  const general = Array.isArray(mob.general) ? (mob.general as Pkg[]).slice() : [];

  if (isNewShape(mob)) {
    const rawOv = (mob.overrides as Record<string, unknown> | undefined) || {};
    const overrides: Record<string, Pkg[]> = {};
    for (const k of Object.keys(rawOv)) {
      if (Array.isArray(rawOv[k])) overrides[k] = (rawOv[k] as Pkg[]).slice();
    }
    return { general, overrides };
  }

  // OLD shape -> re-key wedding/mitzvah buckets as full overrides.
  const overrides: Record<string, Pkg[]> = {};
  for (const bucket of Object.keys(OLD_BUCKET_TO_EVENT)) {
    const arr = mob[bucket];
    if (Array.isArray(arr) && arr.length) {
      overrides[OLD_BUCKET_TO_EVENT[bucket]] = (arr as Pkg[]).slice();
    }
  }
  return { general, overrides };
}
