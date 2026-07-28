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

// ── Editor mutation API ──────────────────────────────────────────────────
// Pure helpers the new package editor calls. Each takes the canonical new
// shape and returns a fresh new-shape object (never mutates). The editor holds
// state in the new shape; only on Save does BookingTab write it to
// booking_settings.mob_packages.

function cloneNew(mob: MobPackagesNew): MobPackagesNew {
  const overrides: Record<string, Pkg[]> = {};
  for (const k of Object.keys(mob.overrides)) overrides[k] = mob.overrides[k].slice();
  return { general: mob.general.slice(), overrides };
}

/** A brand-new blank package/override ( {} = inherits display, blank prices ). */
export function blankPackage(): Pkg { return {}; }

// A slot the resolver treats as "this package inherits General for this type"
// (resolvePackage does `overrides[type]?.[index] || null` -> null = inherit).
// Distinct from blankPackage() {} which means "priced on its own -> quote".
const NULL_PKG = null as unknown as Pkg;

/** Number of package slots (indexes). Driven by the General array length. */
export function packageCount(mob: MobPackagesNew): number { return mob.general.length; }

/** The event types that currently have their own pricing (pulled-out / specialty). */
export function pulledOutTypes(mob: MobPackagesNew): string[] { return Object.keys(mob.overrides); }

/** Set the General (base) package at an index. */
export function setGeneral(mob: MobPackagesNew, index: number, pkg: Pkg): MobPackagesNew {
  const next = cloneNew(mob);
  while (next.general.length <= index) next.general.push(blankPackage());
  next.general[index] = pkg;
  return next;
}

/** Set an event type's override package at an index. */
export function setOverride(mob: MobPackagesNew, type: string, index: number, pkg: Pkg): MobPackagesNew {
  const next = cloneNew(mob);
  const arr = (next.overrides[type] || []).slice();
  while (arr.length <= index) arr.push(NULL_PKG);
  arr[index] = pkg;
  next.overrides[type] = arr;
  return next;
}

/** Add a package slot: push a blank onto General and every override array. */
export function addPackageSlot(mob: MobPackagesNew): MobPackagesNew {
  const next = cloneNew(mob);
  next.general.push(blankPackage());
  for (const k of Object.keys(next.overrides)) next.overrides[k].push(blankPackage());
  return next;
}

/** Remove a package slot at an index from General and every override array. */
export function removePackageSlot(mob: MobPackagesNew, index: number): MobPackagesNew {
  const next = cloneNew(mob);
  next.general.splice(index, 1);
  for (const k of Object.keys(next.overrides)) next.overrides[k].splice(index, 1);
  return next;
}

/**
 * Pull an event type OUT of General pricing: give it its own override array,
 * one blank per package slot. Blank overrides inherit display from General and
 * carry blank prices (-> quote until the DJ enters numbers), per spec.
 * No-op if the type is already pulled out.
 */
export function pullTypeOut(mob: MobPackagesNew, type: string): MobPackagesNew {
  if (mob.overrides[type]) return mob;
  const next = cloneNew(mob);
  next.overrides[type] = next.general.map(() => blankPackage());
  return next;
}

/** Put an event type BACK under General pricing (remove its overrides). */
export function putTypeBack(mob: MobPackagesNew, type: string): MobPackagesNew {
  if (!mob.overrides[type]) return mob;
  const next = cloneNew(mob);
  delete next.overrides[type];
  return next;
}

/**
 * Serialize for storage. Keeps EVERY pulled-out type's override array (its very
 * presence is what marks the type as "priced on its own" — a blank override
 * resolves to a quote, NOT to General's prices, so it must be preserved). Pads
 * each override array to the General length so indexes never drift. To put a
 * type back under General pricing, call putTypeBack() explicitly — serialize
 * never second-guesses that.
 */
export function serializeMobPackages(mob: MobPackagesNew): MobPackagesNew {
  const n = mob.general.length;
  const overrides: Record<string, Pkg[]> = {};
  for (const k of Object.keys(mob.overrides)) {
    const arr = mob.overrides[k].slice(0, n);
    while (arr.length < n) arr.push(blankPackage());
    overrides[k] = arr;
  }
  return { general: mob.general.slice(), overrides };
}

// ── Per-package (per-index) event-type pricing ──────────────────────────────
// Each package independently decides which event types it prices on its own.
// A type's override array is index-aligned with General: a non-null slot at i
// means "package i is priced on its own for this type"; null means "inherit".

/** Event types that package `index` prices on its own (has a non-null slot). */
export function typesForIndex(mob: MobPackagesNew, index: number): string[] {
  return Object.keys(mob.overrides).filter((t) => mob.overrides[t][index] != null);
}

/** Pull a type out of General FOR ONE package: blank price -> quote until set. */
export function pullTypeOutAt(mob: MobPackagesNew, type: string, index: number): MobPackagesNew {
  const next = cloneNew(mob);
  const arr = (next.overrides[type] || next.general.map(() => NULL_PKG)).slice();
  while (arr.length <= index) arr.push(NULL_PKG);
  arr[index] = blankPackage();
  next.overrides[type] = arr;
  return next;
}

/** Put a type BACK under General FOR ONE package (that slot inherits again). */
export function putTypeBackAt(mob: MobPackagesNew, type: string, index: number): MobPackagesNew {
  if (!mob.overrides[type]) return mob;
  const next = cloneNew(mob);
  const arr = next.overrides[type].slice();
  if (index < arr.length) arr[index] = NULL_PKG;
  if (arr.every((x) => x == null)) delete next.overrides[type];
  else next.overrides[type] = arr;
  return next;
}
