// packageModelIndependent — the "independent packages" model (v2).
//
// Each category owns its OWN list of packages, with its own length. There is
// no index-aligned inheritance across event types anymore:
//
//   { model: 'independent',
//     general:   Pkg[],                        // the default list everyone sees
//     overrides: { [eventType: string]: Pkg[] } // a pulled-out type's OWN list
//   }
//
// Resolution for a booking:
//   - event type is pulled out  -> use overrides[type] wholesale (its own list)
//   - event type NOT pulled out -> use general wholesale
// Each package is fully self-contained (title, details, photos, prices) — no
// field is borrowed from General at read time.
//
// Migration is LAZY and byte-safe: normalizeToIndependent() reads ANY stored
// shape (old buckets, v1 index-aligned/inheriting, or already-v2) and lifts it
// into this model in memory, materializing each pulled-out type's CURRENTLY
// RESOLVED packages into an independent list. Because it reuses the existing
// resolvePackage() to materialize, an existing DJ's page renders identically
// the first time they open it; only a save writes the v2 shape.

import { resolvePackage, type Pkg } from './resolvePackage';

export type { Pkg };

export interface MobPackagesIndependent {
  model: 'independent';
  general: Pkg[];
  overrides: Record<string, Pkg[]>;
}

// A category is either the base 'general' list or a pulled-out event type key.
export type PackageCategory = 'general' | string;

function isIndependent(mob: Record<string, unknown>): boolean {
  return !!mob && typeof mob === 'object' && mob.model === 'independent';
}
function isV1NewShape(mob: Record<string, unknown>): boolean {
  // v1 "new shape": { general, overrides } WITHOUT the independent marker.
  return !!mob && typeof mob === 'object' && 'overrides' in mob && mob.model !== 'independent';
}

// The old bucket keys that carried their own pricing before the overrides model.
const OLD_BUCKET_TO_EVENT: Record<string, string> = {
  wedding: 'weddings',
  mitzvah: 'mitzvah',
};

/**
 * Lift any stored mob_packages into the independent (v2) model, in memory.
 * Never mutates input. Existing pulled-out types are materialized to the exact
 * packages they resolve to today, so migration changes nothing a booker sees.
 */
export function normalizeToIndependent(
  stored: Record<string, unknown> | null | undefined,
): MobPackagesIndependent {
  const mob = (stored || {}) as Record<string, unknown>;

  // Already v2: clone and return.
  if (isIndependent(mob)) {
    const general = Array.isArray(mob.general) ? (mob.general as Pkg[]).map((p) => ({ ...p })) : [];
    const rawOv = (mob.overrides as Record<string, unknown> | undefined) || {};
    const overrides: Record<string, Pkg[]> = {};
    for (const k of Object.keys(rawOv)) {
      if (Array.isArray(rawOv[k])) overrides[k] = (rawOv[k] as Pkg[]).map((p) => ({ ...p }));
    }
    return { model: 'independent', general, overrides };
  }

  // Figure out the General length and which types are pulled out, for BOTH the
  // v1 index-aligned shape and the old bucket shape.
  const generalRaw = Array.isArray(mob.general) ? (mob.general as Pkg[]) : [];
  const pulledTypes = new Set<string>();
  if (isV1NewShape(mob)) {
    const rawOv = (mob.overrides as Record<string, unknown> | undefined) || {};
    for (const k of Object.keys(rawOv)) if (Array.isArray(rawOv[k])) pulledTypes.add(k);
  } else {
    for (const bucket of Object.keys(OLD_BUCKET_TO_EVENT)) {
      if (Array.isArray(mob[bucket]) && (mob[bucket] as unknown[]).length) {
        pulledTypes.add(OLD_BUCKET_TO_EVENT[bucket]);
      }
    }
  }
  // General length must cover every index any pulled-out type uses, matching
  // normalizeMobPackages' padding — otherwise a materialized index would be lost.
  let genLen = generalRaw.length;
  if (isV1NewShape(mob)) {
    const rawOv = (mob.overrides as Record<string, Pkg[]> | undefined) || {};
    for (const k of Object.keys(rawOv)) genLen = Math.max(genLen, rawOv[k].length);
  } else {
    for (const bucket of Object.keys(OLD_BUCKET_TO_EVENT)) {
      if (Array.isArray(mob[bucket])) genLen = Math.max(genLen, (mob[bucket] as unknown[]).length);
    }
  }

  const range = Array.from({ length: genLen }, (_, i) => i);
  // A category's independent list is a DENSE list of the packages it actually
  // offers today: resolve each index, drop the ones with no package (null), and
  // copy the rest in order. An inherited slot (v1 null that falls back to
  // General) resolves to a real package and is kept; a genuinely empty index
  // (beyond this category's packages) resolves to null and is dropped. This is
  // what makes migration byte-safe vs. the old per-index resolution.
  const materialize = (type: string): Pkg[] =>
    range
      .map((i) => resolvePackage(mob, type, i))
      .filter((p): p is Pkg => p != null)
      .map((p) => ({ ...p }));

  const general = materialize('general');
  const overrides: Record<string, Pkg[]> = {};
  for (const type of pulledTypes) overrides[type] = materialize(type);

  return { model: 'independent', general, overrides };
}

/**
 * Resolve the package for `eventType` at `index` under the independent model.
 * Pulled-out types use their own list wholesale; everything else uses General.
 * Returns null when there is no package at that index.
 */
export function resolveIndependent(
  mob: MobPackagesIndependent,
  eventType: string,
  index: number,
): Pkg | null {
  const list = mob.overrides[eventType] ?? mob.general;
  const pkg = list[index];
  return pkg ? { ...pkg } : null;
}

// ── Pure mutation helpers (editor state lives in the v2 shape) ──────────────

function clone(mob: MobPackagesIndependent): MobPackagesIndependent {
  const overrides: Record<string, Pkg[]> = {};
  for (const k of Object.keys(mob.overrides)) overrides[k] = mob.overrides[k].map((p) => ({ ...p }));
  return { model: 'independent', general: mob.general.map((p) => ({ ...p })), overrides };
}

export function blankPackage(): Pkg { return {}; }

/** All categories, General first, then pulled-out types in insertion order. */
export function categories(mob: MobPackagesIndependent): PackageCategory[] {
  return ['general', ...Object.keys(mob.overrides)];
}

/** The package list a category owns (General, or a pulled-out type's own list). */
export function listFor(mob: MobPackagesIndependent, category: PackageCategory): Pkg[] {
  return category === 'general' ? mob.general : (mob.overrides[category] || []);
}

/** Whether a type has been pulled out to own its pricing. */
export function isPulledOut(mob: MobPackagesIndependent, type: string): boolean {
  return type !== 'general' && Array.isArray(mob.overrides[type]);
}

/** Set one package within a category. */
export function setPackageAt(
  mob: MobPackagesIndependent, category: PackageCategory, index: number, pkg: Pkg,
): MobPackagesIndependent {
  const next = clone(mob);
  const arr = category === 'general' ? next.general : (next.overrides[category] = (next.overrides[category] || []).slice());
  while (arr.length <= index) arr.push(blankPackage());
  arr[index] = pkg;
  return next;
}

/** Append a blank package to a category's own list. */
export function addPackage(mob: MobPackagesIndependent, category: PackageCategory): MobPackagesIndependent {
  const next = clone(mob);
  if (category === 'general') next.general.push(blankPackage());
  else next.overrides[category] = [...(next.overrides[category] || []), blankPackage()];
  return next;
}

/** Remove one package from a category's own list. */
export function removePackage(
  mob: MobPackagesIndependent, category: PackageCategory, index: number,
): MobPackagesIndependent {
  const next = clone(mob);
  if (category === 'general') next.general.splice(index, 1);
  else if (next.overrides[category]) {
    const arr = next.overrides[category].slice();
    arr.splice(index, 1);
    next.overrides[category] = arr;
  }
  return next;
}

/** Pull a type out to own its packages — starts BLANK with one empty package. */
export function pullTypeOut(mob: MobPackagesIndependent, type: string): MobPackagesIndependent {
  if (mob.overrides[type]) return mob;
  const next = clone(mob);
  next.overrides[type] = [blankPackage()];
  return next;
}

/** Put a type back under General (drops its own list; it uses General again). */
export function putTypeBack(mob: MobPackagesIndependent, type: string): MobPackagesIndependent {
  if (!mob.overrides[type]) return mob;
  const next = clone(mob);
  delete next.overrides[type];
  return next;
}

/** Serialize for storage — the v2 shape is already the stored shape. */
export function serializeIndependent(mob: MobPackagesIndependent): MobPackagesIndependent {
  return clone(mob);
}
