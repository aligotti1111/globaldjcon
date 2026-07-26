'use client';

// MobilePackagesEditor — per-event-type package editor, desktop sidebar layout.
//
// LEFT: event-type rail (General = base, then any types pulled out for their
// own price, then "+ Add event type"). RIGHT: package flipper + the selected
// type's package card (reuses PackageEditor). General is the base; every other
// type inherits its title/description/photos until changed. Reads any stored
// shape via normalizeMobPackages, writes the new { general, overrides } shape.

import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import styles from './updateDjProfile.module.css';
import PackageEditor from './PackageEditor';
import type { MobilePackage } from '@/app/(main)/[slug]/bookingSettings';
import { MOB_EVENT_LABELS } from '@/lib/constants';
import {
  normalizeMobPackages,
  serializeMobPackages,
  setGeneral,
  setOverride,
  addPackageSlot,
  removePackageSlot,
  pullTypeOut,
  putTypeBack,
  type MobPackagesNew,
  type Pkg,
} from '@/app/(main)/[slug]/packageModel';

function catFor(eventType: string): 'general' | 'wedding' | 'mitzvah' {
  if (eventType === 'weddings') return 'wedding';
  if (eventType === 'mitzvah') return 'mitzvah';
  return 'general';
}
function labelFor(eventType: string): string {
  return eventType === 'general' ? 'General' : (MOB_EVENT_LABELS[eventType] || eventType);
}

export default function MobilePackagesEditor({
  mobPackages,
  selectedEventTypes,
  userId,
  currency,
  onSave,
}: {
  mobPackages: Record<string, unknown> | null | undefined;
  selectedEventTypes: string[];
  userId: string;
  currency: string;
  onSave: (next: MobPackagesNew) => void;
}) {
  const initial = useMemo(() => normalizeMobPackages(mobPackages), [mobPackages]);
  const [mob, setMob] = useState<MobPackagesNew>(initial);
  const [pkgIdx, setPkgIdx] = useState(0);
  const [selType, setSelType] = useState<string>('general');
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() => JSON.stringify(serializeMobPackages(initial)));
  const [saved, setSaved] = useState(false);

  const count = mob.general.length;
  const idx = Math.min(pkgIdx, Math.max(0, count - 1));

  const railTypes = useMemo(() => ['general', ...Object.keys(mob.overrides)], [mob.overrides]);
  const addableTypes = useMemo(
    () => selectedEventTypes.filter((t) => t !== 'general' && !mob.overrides[t]),
    [selectedEventTypes, mob.overrides],
  );
  const dirty = JSON.stringify(serializeMobPackages(mob)) !== savedSnapshot;

  function update(next: MobPackagesNew) { setMob(next); setSaved(false); }

  const currentPkg: MobilePackage = (
    selType === 'general' ? (mob.general[idx] || {}) : (mob.overrides[selType]?.[idx] || {})
  ) as MobilePackage;

  const generalPhotos = useMemo(() => {
    const g = (mob.general[idx] || {}) as { photo?: string; photos?: string[] };
    return { photo: g.photo || '', photos: Array.isArray(g.photos) ? g.photos : [] };
  }, [mob.general, idx]);

  function onEditPkg(next: MobilePackage) {
    if (selType === 'general') update(setGeneral(mob, idx, next as Pkg));
    else update(setOverride(mob, selType, idx, next as Pkg));
  }
  function addEventType(type: string) { update(pullTypeOut(mob, type)); setSelType(type); }
  function removeEventType(type: string) { update(putTypeBack(mob, type)); if (selType === type) setSelType('general'); }
  function addPackage() { const n = addPackageSlot(mob); setMob(n); setSaved(false); setPkgIdx(n.general.length - 1); setSelType('general'); }
  function removePackage() {
    if (count <= 1) return;
    const n = removePackageSlot(mob, idx);
    setMob(n); setSaved(false); setPkgIdx(Math.max(0, idx - 1)); setSelType('general');
  }
  function save() { const ser = serializeMobPackages(mob); onSave(ser); setSavedSnapshot(JSON.stringify(ser)); setSaved(true); }

  if (count === 0) {
    return <button type="button" className={styles.addPkgBtn} onClick={addPackage}>+ Add a package</button>;
  }

  const navBtn: CSSProperties = { background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: '#fff', width: 34, height: 34, cursor: 'pointer', fontSize: '1.15rem', lineHeight: 1 };
  const railLabel: CSSProperties = { fontFamily: "'Space Mono', monospace", fontSize: '.6rem', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', margin: '0 0 .5rem .15rem' };
  const sideItem = (active: boolean): CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
    padding: '.5rem .6rem', marginBottom: 5, borderRadius: 6, cursor: 'pointer', textAlign: 'left',
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '1rem', letterSpacing: '.06em', textTransform: 'uppercase',
    background: active ? 'var(--neon-dim)' : 'transparent',
    color: active ? 'var(--neon)' : '#fff',
    border: active ? '1px solid var(--neon)' : '1px solid var(--border)',
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* LEFT — event-type rail */}
        <div style={{ flex: '0 0 190px', minWidth: 168 }}>
          <div style={railLabel}>Event types</div>
          {railTypes.map((t) => {
            const active = selType === t;
            return (
              <button key={t} type="button" onClick={() => setSelType(t)} style={sideItem(active)}>
                <span>
                  {labelFor(t)}
                  {t === 'general' && <span style={{ fontSize: '.65rem', color: 'var(--muted)', marginLeft: '.3rem' }}>· base</span>}
                </span>
                {t !== 'general' && (
                  <span role="button" aria-label={`Put ${labelFor(t)} back under General`} title="Back under General"
                    onClick={(e) => { e.stopPropagation(); removeEventType(t); }}
                    style={{ color: active ? 'var(--neon)' : 'var(--muted)', cursor: 'pointer', fontSize: '.85rem', padding: '0 .1rem' }}>×</span>
                )}
              </button>
            );
          })}
          {addableTypes.length > 0 && (
            <select
              aria-label="Add an event type with its own price"
              value=""
              onChange={(e) => { if (e.target.value) addEventType(e.target.value); }}
              style={{ width: '100%', marginTop: 4, background: 'rgba(10,10,16,.6)', color: 'var(--neon)', border: '1px solid var(--neon)', borderRadius: 6, padding: '.55rem .5rem', fontFamily: "'Space Mono', monospace", fontSize: '.6rem', letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' }}
            >
              <option value="">+ Add event type</option>
              {addableTypes.map((t) => <option key={t} value={t}>{labelFor(t)}</option>)}
            </select>
          )}
        </div>

        {/* RIGHT — flipper + package card */}
        <div style={{ flex: '1 1 340px', minWidth: 280 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.6rem' }}>
            <button type="button" aria-label="Previous package" onClick={() => { setPkgIdx(Math.max(0, idx - 1)); setSelType('general'); }} disabled={idx === 0} style={{ ...navBtn, opacity: idx === 0 ? 0.4 : 1, cursor: idx === 0 ? 'not-allowed' : 'pointer' }}>‹</button>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.7rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>Package {idx + 1} of {count}</div>
            <button type="button" aria-label="Next package" onClick={() => { setPkgIdx(Math.min(count - 1, idx + 1)); setSelType('general'); }} disabled={idx >= count - 1} style={{ ...navBtn, opacity: idx >= count - 1 ? 0.4 : 1, cursor: idx >= count - 1 ? 'not-allowed' : 'pointer' }}>›</button>
          </div>

          <div className={styles.pkgCard}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.6rem', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '.7rem' }}>
              {selType === 'general' ? 'General — the base every event type inherits' : `${labelFor(selType)} — title, description & photos inherit from General unless changed`}
            </div>

            <PackageEditor
              key={`${selType}-${idx}`}
              cat={catFor(selType)}
              idx={idx}
              pkg={currentPkg}
              totalCount={count}
              userId={userId}
              currency={currency}
              onChange={onEditPkg}
              onRemove={() => {}}
              hideOwnHeader
              generalPhotos={generalPhotos}
            />

            <div className={styles.pkgSaveRow}>
              {count > 1 && (
                <button type="button" onClick={removePackage} style={{ background: 'transparent', border: '1px solid rgba(255,95,95,.5)', borderRadius: 6, color: '#ff8f8f', padding: '.5rem 1rem', fontFamily: "'Space Mono', monospace", fontSize: '.62rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' }}>Remove Package</button>
              )}
              <span style={{ flex: 1 }} />
              {saved && !dirty && <span style={{ color: 'var(--neon)', fontFamily: "'Space Mono', monospace", fontSize: '.62rem', letterSpacing: '.06em', textTransform: 'uppercase' }}>✓ Saved</span>}
              <button type="button" className={styles.pkgSaveBtn} onClick={save} disabled={!dirty} style={{ opacity: dirty ? 1 : 0.5, cursor: dirty ? 'pointer' : 'not-allowed' }}>Save Packages</button>
            </div>
          </div>
        </div>
      </div>

      <button type="button" className={styles.addPkgBtn} onClick={addPackage}>+ Add Package</button>
    </div>
  );
}
