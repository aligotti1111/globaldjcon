'use client';

// MobilePackagesEditor — per-event-type package editor, desktop sidebar layout.
//
// LEFT: event-type rail (General = base, then any types pulled out for their
// own price, then "+ Add event type"). RIGHT: package flipper + the selected
// type's package card (reuses PackageEditor). General is the base; every other
// type inherits its title/description/photos until changed. Reads any stored
// shape via normalizeMobPackages, writes the new { general, overrides } shape.

import { useMemo, useRef, useState } from 'react';
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
  pullTypeOutAt,
  putTypeBackAt,
  typesForIndex,
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
  const [err, setErr] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const count = mob.general.length;
  const idx = Math.min(pkgIdx, Math.max(0, count - 1));

  // Event types are PER PACKAGE: which types a package prices on its own is
  // independent of every other package.
  const typesForPkg = (i: number) => typesForIndex(mob, i);
  const addableForPkg = (i: number) =>
    selectedEventTypes.filter((t) => t !== 'general' && !typesForPkg(i).includes(t));
  const dirty = JSON.stringify(serializeMobPackages(mob)) !== savedSnapshot;

  function update(next: MobPackagesNew) { setMob(next); setSaved(false); setErr(null); }

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
  function addEventType(type: string) { update(pullTypeOutAt(mob, type, idx)); setSelType(type); }
  function removeEventType(type: string) { update(putTypeBackAt(mob, type, idx)); if (selType === type) setSelType('general'); }
  function addPackage() {
    const n = addPackageSlot(mob);
    setMob(n); setSaved(false); setErr(null); setPkgIdx(n.general.length - 1); setSelType('general');
    requestAnimationFrame(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }
  function removePackage() {
    if (count <= 1) return;
    const n = removePackageSlot(mob, idx);
    setMob(n); setSaved(false); setPkgIdx(Math.max(0, idx - 1)); setSelType('general');
  }
  // Details is rich-text HTML — strip tags to tell "real content" from an
  // empty editor (<br>, <div></div>, whitespace).
  function textEmpty(v: unknown): boolean {
    if (v == null) return true;
    return String(v).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === '';
  }
  function save() {
    for (let i = 0; i < mob.general.length; i++) {
      const g = (mob.general[i] || {}) as { title?: string; details?: string };
      if (textEmpty(g.title) || textEmpty(g.details)) {
        setErr(`Package ${i + 1} needs a title and description before you can save.`);
        setPkgIdx(i); setSelType('general');
        return;
      }
    }
    setErr(null);
    const ser = serializeMobPackages(mob);
    onSave(ser); setSavedSnapshot(JSON.stringify(ser)); setSaved(true);
  }

  if (count === 0) {
    return <button type="button" className={styles.addPkgBtn} onClick={addPackage}>+ Add a package</button>;
  }

  const pill = (active: boolean): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: '.4rem',
    padding: '.4rem .7rem', borderRadius: 999, cursor: 'pointer',
    fontFamily: "'Space Mono', monospace", fontSize: '.62rem', letterSpacing: '.06em', textTransform: 'uppercase',
    background: active ? 'var(--neon)' : 'rgba(10,10,16,.6)',
    color: active ? '#04121a' : '#fff',
    border: active ? '1px solid var(--neon)' : '1px solid var(--border)',
    fontWeight: active ? 700 : 400,
  });

  return (
    <div>
      {mob.general.map((_, i) => {
        const open = i === idx;
        const rawTitle = String((mob.general[i] as { title?: string })?.title || '').replace(/<[^>]*>/g, '').trim();
        const myTypes = typesForPkg(i);
        const addable = addableForPkg(i);
        return (
          <div key={i} ref={open ? cardRef : undefined} style={{ marginBottom: 12, scrollMarginTop: 90 }}>
            {/* FOLD HEADER — prominent package number */}
            <button
              type="button"
              onClick={() => { setPkgIdx(i); setSelType('general'); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '.85rem', width: '100%',
                background: open ? 'rgba(0,240,255,.06)' : 'rgba(10,10,16,.5)',
                border: `1px solid ${open ? 'var(--neon)' : 'var(--border)'}`,
                borderRadius: open ? '10px 10px 0 0' : 10, padding: '.85rem 1rem', cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{
                flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 40, height: 40, padding: '0 .5rem', borderRadius: 9, background: 'var(--neon)', color: '#04121a',
                fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.6rem', lineHeight: 1, letterSpacing: '.02em',
              }}>{i + 1}</span>
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '.56rem', letterSpacing: '.16em', textTransform: 'uppercase', color: open ? 'var(--neon)' : 'var(--muted)' }}>Package {i + 1}</span>
                <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem', letterSpacing: '.04em', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rawTitle || 'Untitled package'}</span>
              </span>
              <span style={{ color: open ? 'var(--neon)' : 'var(--muted)', fontSize: '1.15rem', flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
            </button>

            {open && (
              <div className={styles.pkgCard} style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, marginTop: -1 }}>
                {/* PER-PACKAGE EVENT TYPES — collapse with the package */}
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.55rem', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '.5rem' }}>Price this package for</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.45rem', marginBottom: '1rem' }}>
                  <button type="button" onClick={() => setSelType('general')} style={pill(selType === 'general')}>General &middot; base</button>
                  {myTypes.map((t) => (
                    <span key={t} style={pill(selType === t)}>
                      <span onClick={() => setSelType(t)} style={{ cursor: 'pointer' }}>{labelFor(t)}</span>
                      <span
                        role="button"
                        aria-label={`Put ${labelFor(t)} back under General`}
                        title="Back under General"
                        onClick={(e) => { e.stopPropagation(); removeEventType(t); }}
                        style={{ cursor: 'pointer', opacity: 0.85 }}
                      >&times;</span>
                    </span>
                  ))}
                  {addable.length > 0 && (
                    <select
                      aria-label="Add an event type with its own price"
                      value=""
                      onChange={(e) => { if (e.target.value) addEventType(e.target.value); }}
                      style={{ background: 'rgba(10,10,16,.6)', color: 'var(--neon)', border: '1px solid var(--neon)', borderRadius: 999, padding: '.4rem .6rem', fontFamily: "'Space Mono', monospace", fontSize: '.6rem', letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer' }}
                    >
                      <option value="">+ Add event type</option>
                      {addable.map((t) => <option key={t} value={t}>{labelFor(t)}</option>)}
                    </select>
                  )}
                </div>

                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.6rem', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '.7rem' }}>
                  {selType === 'general' ? 'General — the base every event type inherits' : `${labelFor(selType)} — title, description & photos inherit from General unless changed`}
                </div>

                <PackageEditor
                  key={`${i}-${selType}`}
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
                  {err && <span style={{ color: '#ff8f8f', fontSize: '.78rem', flex: '1 1 auto' }}>{err}</span>}
                  {!err && <span style={{ flex: 1 }} />}
                  {saved && !dirty && <span style={{ color: 'var(--neon)', fontFamily: "'Space Mono', monospace", fontSize: '.62rem', letterSpacing: '.06em', textTransform: 'uppercase' }}>&#10003; Saved</span>}
                  <button type="button" className={styles.pkgSaveBtn} onClick={save} disabled={!dirty} style={{ opacity: dirty ? 1 : 0.5, cursor: dirty ? 'pointer' : 'not-allowed' }}>Save Packages</button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <button type="button" className={styles.addPkgBtn} onClick={addPackage}>+ Add Package</button>
    </div>
  );
}
