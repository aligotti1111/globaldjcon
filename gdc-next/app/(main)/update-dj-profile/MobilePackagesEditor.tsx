'use client';

// MobilePackagesEditor — the per-event-type package editor.
//
// One card per package (flip with the arrows). Inside a card: an event-type
// rail (General + any types pulled out for their own price) plus "Add event
// type". Selecting a rail entry edits that type's package via the existing
// PackageEditor; General is the base and everything inherits from it until
// pulled out. Reads any stored shape via normalizeMobPackages and writes the
// new { general, overrides } shape on Save.
//
// Reuses PackageEditor for the actual fields (title/details/photos/prices/
// overtime/ceremony/cocktail/require-quote) — this component only owns the
// event-type rail, the package flipper, and the new-shape read/write.

import { useMemo, useState } from 'react';
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

// Which PackageEditor "cat" an event type maps to — so weddings/mitzvah still
// get their ceremony/cocktail add-ons; everything else is plain tiers.
function catFor(eventType: string): 'general' | 'wedding' | 'mitzvah' {
  if (eventType === 'general') return 'general';
  if (eventType === 'weddings') return 'wedding';
  if (eventType === 'mitzvah') return 'mitzvah';
  return 'general';
}

function labelFor(eventType: string): string {
  return eventType === 'general' ? 'General' : (MOB_EVENT_LABELS[eventType] || eventType);
}

const NEON = 'var(--neon,#00e0a4)';
const MUTED = 'var(--muted,#8a8aa0)';

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
  const [status, setStatus] = useState<'idle' | 'saved'>('idle');

  const count = mob.general.length;
  const idx = Math.min(pkgIdx, Math.max(0, count - 1));

  // Rail entries for the current package: General first, then each pulled-out type.
  const railTypes = useMemo(() => ['general', ...Object.keys(mob.overrides)], [mob.overrides]);

  // Types the DJ offers that aren't pulled out yet — the "Add event type" menu.
  const addableTypes = useMemo(
    () => selectedEventTypes.filter((t) => t !== 'general' && !mob.overrides[t]),
    [selectedEventTypes, mob.overrides],
  );

  const dirty = JSON.stringify(serializeMobPackages(mob)) !== savedSnapshot;

  function update(next: MobPackagesNew) { setMob(next); setStatus('idle'); }

  // The package currently being edited (General base or a type's override).
  const currentPkg: MobilePackage = (
    selType === 'general'
      ? (mob.general[idx] || {})
      : (mob.overrides[selType]?.[idx] || {})
  ) as MobilePackage;

  // For a wedding/mitzvah type card, expose the General photos for the
  // "copy setup photos" button in PackageEditor.
  const generalPhotos = useMemo(() => {
    const g = (mob.general[idx] || {}) as { photo?: string; photos?: string[] };
    return { photo: g.photo || '', photos: Array.isArray(g.photos) ? g.photos : [] };
  }, [mob.general, idx]);

  function onEditPkg(next: MobilePackage) {
    if (selType === 'general') update(setGeneral(mob, idx, next as Pkg));
    else update(setOverride(mob, selType, idx, next as Pkg));
  }

  function addEventType(type: string) {
    update(pullTypeOut(mob, type));
    setSelType(type);
  }
  function removeEventType(type: string) {
    update(putTypeBack(mob, type));
    if (selType === type) setSelType('general');
  }

  function addPackage() { const n = addPackageSlot(mob); setMob(n); setPkgIdx(n.general.length - 1); setSelType('general'); setStatus('idle'); }
  function removePackage() {
    if (count <= 1) return;
    const n = removePackageSlot(mob, idx);
    setMob(n); setPkgIdx(Math.max(0, idx - 1)); setSelType('general'); setStatus('idle');
  }

  function save() {
    const ser = serializeMobPackages(mob);
    onSave(ser);
    setSavedSnapshot(JSON.stringify(ser));
    setStatus('saved');
  }

  const railBtn = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
    width: '100%', textAlign: 'left', padding: '.5rem .6rem', borderRadius: 8,
    border: 'none', cursor: 'pointer', fontSize: '.9rem',
    background: active ? 'rgba(0,224,164,.12)' : 'transparent',
    color: active ? NEON : 'inherit', fontWeight: active ? 700 : 400,
  });

  if (count === 0) {
    return (
      <div style={{ padding: '1rem', border: `1px dashed ${MUTED}`, borderRadius: 12, textAlign: 'center' }}>
        <div style={{ marginBottom: '.6rem', color: MUTED, fontSize: '.9rem' }}>No packages yet.</div>
        <button type="button" onClick={addPackage} style={{ background: NEON, border: 'none', borderRadius: 8, color: '#06231b', padding: '.55rem 1.1rem', fontWeight: 700, cursor: 'pointer' }}>+ Add a package</button>
      </div>
    );
  }

  return (
    <div>
      {/* Package flipper */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.7rem' }}>
        <button type="button" aria-label="Previous package" disabled={idx === 0}
          onClick={() => { setPkgIdx(Math.max(0, idx - 1)); setSelType('general'); }}
          style={{ background: 'transparent', border: `1px solid ${MUTED}`, borderRadius: 8, color: '#fff', width: 34, height: 34, cursor: idx === 0 ? 'not-allowed' : 'pointer', opacity: idx === 0 ? 0.4 : 1 }}>‹</button>
        <div style={{ fontSize: '.85rem', color: MUTED }}>Package {idx + 1} of {count}</div>
        <button type="button" aria-label="Next package" disabled={idx >= count - 1}
          onClick={() => { setPkgIdx(Math.min(count - 1, idx + 1)); setSelType('general'); }}
          style={{ background: 'transparent', border: `1px solid ${MUTED}`, borderRadius: 8, color: '#fff', width: 34, height: 34, cursor: idx >= count - 1 ? 'not-allowed' : 'pointer', opacity: idx >= count - 1 ? 0.4 : 1 }}>›</button>
      </div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Event-type rail */}
        <div style={{ flex: '0 0 170px', minWidth: 150 }}>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: '.66rem', letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED, margin: '0 0 .4rem .2rem' }}>Event types</div>
          {railTypes.map((t) => (
            <div key={t} style={{ display: 'flex', alignItems: 'center' }}>
              <button type="button" style={railBtn(selType === t)} onClick={() => setSelType(t)}>
                <span>{labelFor(t)}{t === 'general' && <span style={{ color: MUTED, fontSize: '.72rem', fontWeight: 400 }}> · base</span>}</span>
              </button>
              {t !== 'general' && (
                <button type="button" aria-label={`Put ${labelFor(t)} back under General`} title="Back under General"
                  onClick={() => removeEventType(t)}
                  style={{ background: 'none', border: 'none', color: MUTED, cursor: 'pointer', fontSize: '.95rem', padding: '0 .3rem' }}>×</button>
              )}
            </div>
          ))}
          {addableTypes.length > 0 && (
            <div style={{ marginTop: '.3rem' }}>
              <select
                aria-label="Add an event type with its own price"
                value=""
                onChange={(e) => { if (e.target.value) addEventType(e.target.value); }}
                style={{ width: '100%', padding: '.45rem .5rem', borderRadius: 8, background: 'transparent', color: NEON, border: `1px solid ${MUTED}`, fontSize: '.82rem', cursor: 'pointer' }}
              >
                <option value="">+ Add event type…</option>
                {addableTypes.map((t) => <option key={t} value={t}>{labelFor(t)}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* The selected event type's package fields (reused PackageEditor) */}
        <div style={{ flex: '1 1 340px', minWidth: 280, background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: '1rem 1.1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.5rem' }}>
            <div style={{ fontWeight: 700 }}>{labelFor(selType)}</div>
            {selType !== 'general' && <div style={{ fontSize: '.72rem', color: MUTED }}>title, description &amp; photos inherit from General unless changed</div>}
          </div>
          <PackageEditor
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
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', marginTop: '1rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={addPackage} style={{ background: 'transparent', border: `1px solid ${MUTED}`, borderRadius: 8, color: '#fff', padding: '.55rem 1rem', fontWeight: 600, fontSize: '.85rem', cursor: 'pointer' }}>+ Add package</button>
        {count > 1 && (
          <button type="button" onClick={removePackage} style={{ background: 'transparent', border: '1px solid rgba(255,95,95,.5)', borderRadius: 8, color: '#ff8f8f', padding: '.55rem 1rem', fontWeight: 600, fontSize: '.85rem', cursor: 'pointer' }}>Remove this package</button>
        )}
        <span style={{ flex: 1 }} />
        {status === 'saved' && !dirty && <span style={{ color: NEON, fontSize: '.85rem' }}>✓ Saved</span>}
        <button type="button" onClick={save} disabled={!dirty}
          style={{ background: NEON, border: 'none', borderRadius: 8, color: '#06231b', padding: '.6rem 1.3rem', fontWeight: 700, fontSize: '.88rem', cursor: dirty ? 'pointer' : 'not-allowed', opacity: dirty ? 1 : 0.5 }}>
          Save packages
        </button>
      </div>
    </div>
  );
}
