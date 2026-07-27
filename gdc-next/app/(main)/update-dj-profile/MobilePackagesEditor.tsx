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
  const [err, setErr] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const count = mob.general.length;
  const idx = Math.min(pkgIdx, Math.max(0, count - 1));

  const railTypes = useMemo(() => ['general', ...Object.keys(mob.overrides)], [mob.overrides]);
  const addableTypes = useMemo(
    () => selectedEventTypes.filter((t) => t !== 'general' && !mob.overrides[t]),
    [selectedEventTypes, mob.overrides],
  );
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
  function addEventType(type: string) { update(pullTypeOut(mob, type)); setSelType(type); }
  function removeEventType(type: string) { update(putTypeBack(mob, type)); if (selType === type) setSelType('general'); }
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
        <div style={{ flex: '1 1 168px', maxWidth: 260 }}>
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

        {/* RIGHT — stacked, foldable packages */}
        <div style={{ flex: '1000 1 300px', minWidth: 0 }}>
          {mob.general.map((_, i) => {
            const open = i === idx;
            const rawTitle = String((mob.general[i] as { title?: string })?.title || '').replace(/<[^>]*>/g, '').trim();
            return (
              <div key={i} ref={open ? cardRef : undefined} style={{ marginBottom: 10, scrollMarginTop: 90 }}>
                <button
                  type="button"
                  onClick={() => { setPkgIdx(i); setSelType('general'); }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                    background: open ? 'rgba(0,240,255,.06)' : 'rgba(10,10,16,.5)',
                    border: `1px solid ${open ? 'var(--neon)' : 'var(--border)'}`,
                    borderRadius: open ? '8px 8px 0 0' : 8, padding: '.7rem .9rem', cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '.6rem', minWidth: 0 }}>
                    <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '.62rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--neon)' }}>Package {i + 1}</span>
                    {rawTitle && <span style={{ color: '#fff', fontSize: '.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rawTitle}</span>}
                  </span>
                  <span style={{ color: 'var(--muted)', fontSize: '.9rem', flexShrink: 0, marginLeft: '.6rem' }}>{open ? '▾' : '▸'}</span>
                </button>

                {open && (
                  <div className={styles.pkgCard} style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, marginTop: -1 }}>
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
                      {err && <span style={{ color: '#ff8f8f', fontSize: '.78rem', flex: '1 1 auto' }}>{err}</span>}
                      {!err && <span style={{ flex: 1 }} />}
                      {saved && !dirty && <span style={{ color: 'var(--neon)', fontFamily: "'Space Mono', monospace", fontSize: '.62rem', letterSpacing: '.06em', textTransform: 'uppercase' }}>✓ Saved</span>}
                      <button type="button" className={styles.pkgSaveBtn} onClick={save} disabled={!dirty} style={{ opacity: dirty ? 1 : 0.5, cursor: dirty ? 'pointer' : 'not-allowed' }}>Save Packages</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <button type="button" className={styles.addPkgBtn} onClick={addPackage}>+ Add Package</button>
    </div>
  );
}
