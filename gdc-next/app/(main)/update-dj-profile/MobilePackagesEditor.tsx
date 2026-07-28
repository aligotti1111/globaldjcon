'use client';

// MobilePackagesEditor — per-event-type package editor, desktop sidebar layout.
//
// LEFT: event-type rail (General = base, then any types pulled out for their
// own price, then "+ Add event type"). RIGHT: package flipper + the selected
// type's package card (reuses PackageEditor). General is the base; every other
// type inherits its title/description/photos until changed. Reads any stored
// shape via normalizeMobPackages, writes the new { general, overrides } shape.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import styles from './updateDjProfile.module.css';
import PackageEditor from './PackageEditor';
import { useConfirm } from '@/components/ConfirmModal';
import type { MobilePackage } from '@/app/(main)/[slug]/bookingSettings';
import { MOB_EVENT_LABELS, mobEventLabel, makeCustomEventKey, type CustomEventType } from '@/lib/constants';
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
export default function MobilePackagesEditor({
  mobPackages,
  selectedEventTypes,
  customEventTypes = [],
  specialtyTypes = [],
  userId,
  currency,
  onSave,
  onDirtyChange,
  masterSaveTrigger = 0,
  onEventTypesSave,
}: {
  mobPackages: Record<string, unknown> | null | undefined;
  selectedEventTypes: string[];
  customEventTypes?: CustomEventType[];
  specialtyTypes?: string[];
  userId: string;
  currency: string;
  onSave: (next: MobPackagesNew) => void;
  onEventTypesSave?: (selected: string[], custom: CustomEventType[]) => void | Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  masterSaveTrigger?: number;
}) {
  // Prop-aware label resolver (built-in + custom event types).
  const labelFor = (eventType: string): string =>
    eventType === 'general' ? 'General' : mobEventLabel(eventType, customEventTypes);
  const initial = useMemo(() => {
    let m = normalizeMobPackages(mobPackages);
    // Specialty types (set on the profile) auto-appear in "Customize pricing
    // and details" so they get their own price by default.
    for (const t of specialtyTypes) {
      if (t !== 'general' && selectedEventTypes.includes(t) && !m.overrides[t]) {
        m = pullTypeOut(m, t);
      }
    }
    return m;
  }, [mobPackages, specialtyTypes, selectedEventTypes]);
  const [mob, setMob] = useState<MobPackagesNew>(initial);
  const [pkgIdx, setPkgIdx] = useState(0);
  const [selType, setSelType] = useState<string>('general');
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() => JSON.stringify(serializeMobPackages(normalizeMobPackages(mobPackages))));
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [etOpen, setEtOpen] = useState(false);
  const [etSel, setEtSel] = useState<string[]>(selectedEventTypes);
  const [etCustom, setEtCustom] = useState<CustomEventType[]>(customEventTypes);
  const [etNew, setEtNew] = useState('');
  const { confirm, confirmDialog } = useConfirm();
  const cardRef = useRef<HTMLDivElement>(null);
  const genRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!genOpen) return;
    function onDown(e: MouseEvent) {
      if (genRef.current && !genRef.current.contains(e.target as Node)) setGenOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [genOpen]);

  const count = mob.general.length;
  const idx = pkgIdx < 0 ? -1 : Math.min(pkgIdx, Math.max(0, count - 1));

  // The list of customized event types is SHARED across all packages; each
  // package still holds its own prices for them (override array by index).
  const railTypes = Object.keys(mob.overrides).filter((t) => selectedEventTypes.includes(t));
  const typesForPkg = (_i: number) => railTypes;
  const addableForPkg = (_i: number) =>
    selectedEventTypes.filter((t) => t !== 'general' && !mob.overrides[t]);
  const dirty = JSON.stringify(serializeMobPackages(mob)) !== savedSnapshot;

  // Report dirty upward + honor the page-level master Save.
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  useEffect(() => { onDirtyRef.current?.(dirty); }, [dirty]);
  const saveRef = useRef<() => void>(() => {});
  const lastMasterRef = useRef(masterSaveTrigger);
  useEffect(() => {
    if (masterSaveTrigger === lastMasterRef.current) return;
    lastMasterRef.current = masterSaveTrigger;
    if (masterSaveTrigger > 0) saveRef.current();
  }, [masterSaveTrigger]);

  function update(next: MobPackagesNew) { setMob(next); setSaved(false); setErr(null); }

  const currentPkg: MobilePackage = (() => {
    if (selType === 'general') return (mob.general[idx] || {}) as MobilePackage;
    const base = (mob.general[idx] || {}) as Record<string, unknown>;
    const ov = (mob.overrides[selType]?.[idx] || {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...ov };
    // Name + details carry over from General so each event type starts filled
    // in and can be customized from there.
    for (const fld of ['title', 'details'] as const) {
      const v = merged[fld];
      if (v == null || (typeof v === 'string' && v.replace(/<[^>]*>/g, '').trim() === '')) merged[fld] = base[fld];
    }
    return merged as MobilePackage;
  })();

  const generalPhotos = useMemo(() => {
    const g = (mob.general[idx] || {}) as { photo?: string; photos?: string[] };
    return { photo: g.photo || '', photos: Array.isArray(g.photos) ? g.photos : [] };
  }, [mob.general, idx]);

  // Base is "complete" when General has a title + description for this package.
  function txtEmpty(v: unknown): boolean {
    return v == null || String(v).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === '';
  }
  const generalComplete = (() => {
    const g0 = (mob.general[idx] || {}) as { title?: string; details?: string };
    return !txtEmpty(g0.title) && !txtEmpty(g0.details);
  })();
  // An event type still needs a price when it has no tier/legacy price entered
  // and isn't set to require-a-quote.
  function typeNeedsPrice(t: string): boolean {
    const ov = (mob.overrides[t]?.[idx] || {}) as Record<string, unknown>;
    if (ov.reqAll) return false;
    const tiers = Array.isArray(ov.priceTiers) ? (ov.priceTiers as Array<{ price?: unknown }>) : [];
    const hasTier = tiers.some((x) => x && String(x.price ?? '').trim() !== '');
    const hasLegacy = ['price4', 'price5', 'price6'].some((k) => String((ov)[k] ?? '').trim() !== '');
    return !hasTier && !hasLegacy;
  }

  function onEditPkg(next: MobilePackage) {
    if (selType === 'general') { update(setGeneral(mob, idx, next as Pkg)); return; }
    const base = (mob.general[idx] || {}) as Record<string, unknown>;
    const ov = { ...(next as unknown as Record<string, unknown>) };
    for (const fld of ['title', 'details'] as const) {
      if (JSON.stringify(ov[fld] ?? '') === JSON.stringify(base[fld] ?? '')) delete ov[fld];
    }
    update(setOverride(mob, selType, idx, ov as Pkg));
  }
  function addEventType(type: string) { update(pullTypeOut(mob, type)); setSelType(type); }
  async function removeEventType(type: string) {
    const ok = await confirm({
      title: `Put ${labelFor(type)} back under General events?`,
      message: `${labelFor(type)} will be removed from every package's list and use your General events pricing instead.`,
      confirmLabel: 'Put back under General',
      variant: 'danger',
    });
    if (!ok) return;
    update(putTypeBack(mob, type));
    if (selType === type) setSelType('general');
  }
  function addPackage() {
    const n = addPackageSlot(mob);
    setMob(n); setSaved(false); setErr(null); setPkgIdx(n.general.length - 1); setSelType('general');
    requestAnimationFrame(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }
  async function removePackage() {
    if (count <= 1 || idx <= 0) return;
    const ok = await confirm({
      title: `Remove Package ${idx + 1}?`,
      message: 'This deletes the package and all of its pricing for every event type. This cannot be undone.',
      confirmLabel: 'Remove package',
      variant: 'danger',
    });
    if (!ok) return;
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

  saveRef.current = save;

  // ── Event-types editor popup (edits the DJ's offered + custom types) ──
  function openEtEditor() { setEtSel(selectedEventTypes); setEtCustom(customEventTypes); setEtNew(''); setEtOpen(true); }
  function etToggle(key: string, on: boolean) {
    setEtSel((prev) => (on ? Array.from(new Set([...prev, key])) : prev.filter((k) => k !== key)));
  }
  function etAddCustom() {
    const label = etNew.trim(); if (!label) return;
    const key = makeCustomEventKey(label);
    if (!etCustom.some((c) => c.key === key || c.label.toLowerCase() === label.toLowerCase())) {
      setEtCustom((prev) => [...prev, { key, label }]);
      setEtSel((prev) => Array.from(new Set([...prev, key])));
    }
    setEtNew('');
  }
  function etRemoveCustom(key: string) {
    setEtCustom((prev) => prev.filter((c) => c.key !== key));
    setEtSel((prev) => prev.filter((k) => k !== key));
  }
  function etSaveClose() { onEventTypesSave?.(etSel, etCustom); setEtOpen(false); }

  if (count === 0) {
    return <button type="button" className={styles.addPkgBtn} onClick={addPackage}>+ Add a package</button>;
  }

  const railLabel: CSSProperties = { fontFamily: "'Space Mono', monospace", fontSize: '.52rem', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)', margin: '0 0 .5rem .15rem' };
  const sideItem = (active: boolean): CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
    padding: '.34rem .55rem', marginBottom: 4, borderRadius: 6, cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden',
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem', lineHeight: 1.15, letterSpacing: '.06em', textTransform: 'uppercase',
    background: active ? 'var(--neon-dim)' : 'transparent',
    color: active ? 'var(--neon)' : '#fff',
    border: active ? '1px solid var(--neon)' : '1px solid var(--border)',
  });

  const myTypes = typesForPkg(idx);
  const addable = addableForPkg(idx);

  return (
    <div>
      {mob.general.map((_, i) => {
        const open = i === idx;
        // Header name: when open on an event type that gave itself its own title,
        // show that; otherwise fall back to the General (base) title. Collapsed
        // always shows General, since selType resets to 'general' on collapse.
        const strip = (v: unknown) => String(v || '').replace(/<[^>]*>/g, '').trim();
        const baseTitle = strip((mob.general[i] as { title?: string })?.title);
        const ovForHeader = open && selType !== 'general'
          ? (mob.overrides[selType]?.[i] as { title?: string } | null | undefined) : null;
        const rawTitle = strip(ovForHeader?.title) || baseTitle;
        return (
          <div key={i} ref={open ? cardRef : undefined} style={{ marginBottom: 12, scrollMarginTop: 90 }}>
            {/* FOLD HEADER — prominent package number */}
            <button
              type="button"
              onClick={() => { if (i === idx) { setPkgIdx(-1); } else { setPkgIdx(i); setSelType('general'); } }}
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
              <span style={{ flex: 1, minWidth: 0, fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.7rem', letterSpacing: '.05em', textTransform: 'uppercase', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Package {i + 1}</span>
              <span style={{ color: open ? 'var(--neon)' : 'var(--muted)', fontSize: '1.15rem', flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
            </button>

            {open && (
              <div className={styles.pkgCard} style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, marginTop: -1 }}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  {/* LEFT — event-type rail, inside the fold, for THIS package */}
                  <div style={{ flex: '1 1 150px', maxWidth: 220 }}>
                    <div style={{ ...railLabel, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
                      <span>Event types</span>
                      {onEventTypesSave && (
                        <button type="button" onClick={openEtEditor} style={{ background: 'none', border: 'none', color: 'var(--neon)', cursor: 'pointer', fontFamily: "'Space Mono', monospace", fontSize: '.55rem', letterSpacing: '.06em', textTransform: 'uppercase', textDecoration: 'underline', padding: 0 }}>Edit</button>
                      )}
                    </div>
                    <div ref={genRef} style={{ position: 'relative' }}>
                      <button type="button" onClick={() => setSelType('general')} style={sideItem(selType === 'general')}>
                        <span>General events</span>
                        <span
                          role="button"
                          aria-label="Show the events General covers"
                          onClick={(e) => { e.stopPropagation(); setGenOpen((o) => !o); }}
                          style={{ color: selType === 'general' ? 'var(--neon)' : 'var(--muted)', fontSize: '.85rem', cursor: 'pointer', padding: '0 .15rem' }}
                        >{genOpen ? '▾' : '▸'}</span>
                      </button>
                      {genOpen && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 2, background: '#0c0c12', border: '1px solid var(--neon)', borderRadius: 8, padding: '.5rem .65rem', boxShadow: '0 10px 28px rgba(0,0,0,.55)' }}>
                          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.5rem', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)', margin: '0 0 .3rem' }}>Covers</div>
                          {addable.length ? addable.map((t) => (
                            <div key={t} style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.2rem', letterSpacing: '.04em', textTransform: 'uppercase', color: '#fff', padding: '.18rem 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{labelFor(t)}</div>
                          )) : (
                            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.58rem', color: 'var(--muted)', padding: '.15rem 0' }}>No events under General</div>
                          )}
                        </div>
                      )}
                    </div>
                    <div style={{ ...railLabel, marginTop: 12 }}>Customize pricing and details</div>
                    {myTypes.map((t) => {
                      const active = selType === t;
                      return (
                        <button key={t} type="button" onClick={() => { setSelType(t); setGenOpen(false); }} style={sideItem(active)}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', minWidth: 0 }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{labelFor(t)}</span>
                            {generalComplete && typeNeedsPrice(t) && (
                              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '.52rem', letterSpacing: '.06em', textTransform: 'uppercase', color: '#f5c451', whiteSpace: 'nowrap', flexShrink: 0 }}>Add price</span>
                            )}
                          </span>
                          <span
                            role="button"
                            aria-label={`Put ${labelFor(t)} back under General`}
                            title="Back under General"
                            onClick={(e) => { e.stopPropagation(); removeEventType(t); }}
                            style={{ color: active ? 'var(--neon)' : 'var(--muted)', cursor: 'pointer', fontSize: '.85rem', padding: '0 .1rem' }}
                          >&times;</span>
                        </button>
                      );
                    })}
                    {addable.length > 0 && (
                      <select
                        aria-label="Add an event type with its own price"
                        value=""
                        onChange={(e) => { if (e.target.value) addEventType(e.target.value); }}
                        style={{ width: '100%', marginTop: 4, background: 'rgba(10,10,16,.6)', color: 'var(--neon)', border: '1px solid var(--neon)', borderRadius: 6, padding: '.55rem .5rem', fontFamily: "'Space Mono', monospace", fontSize: '.6rem', letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' }}
                      >
                        <option value="">+ Add event type</option>
                        {addable.map((t) => <option key={t} value={t}>{labelFor(t)}</option>)}
                      </select>
                    )}
                    {addable.length > 0 && (
                      <p style={{ fontFamily: "'Space Mono', monospace", fontSize: '.5rem', lineHeight: 1.5, letterSpacing: '.04em', textTransform: 'uppercase', color: '#fff', margin: '.4rem .1rem 0' }}>
                        &ldquo;Add Event Type&rdquo; removes that event from General Events pricing and lets you customize its package name, description, pricing, and photos.
                      </p>
                    )}
                  </div>

                  {/* RIGHT — the selected type's price card */}
                  <div style={{ flex: '1000 1 280px', minWidth: 0 }}>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.55rem', lineHeight: 1.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '.7rem' }}>
                      {selType === 'general' ? 'General events — the base every event type inherits' : `${labelFor(selType)} — title, description & photos inherit from General unless changed`}
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
                      {count > 1 && idx > 0 && (
                        <button type="button" onClick={removePackage} style={{ background: 'transparent', border: '1px solid rgba(255,95,95,.5)', borderRadius: 6, color: '#ff8f8f', padding: '.5rem 1rem', fontFamily: "'Space Mono', monospace", fontSize: '.62rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' }}>Remove Package</button>
                      )}
                      {err && <span style={{ color: '#ff8f8f', fontSize: '.78rem', flex: '1 1 auto' }}>{err}</span>}
                      {!err && <span style={{ flex: 1 }} />}
                      {saved && !dirty && <span style={{ color: 'var(--neon)', fontFamily: "'Space Mono', monospace", fontSize: '.62rem', letterSpacing: '.06em', textTransform: 'uppercase' }}>&#10003; Saved</span>}
                      <button type="button" className={styles.pkgSaveBtn} onClick={save} disabled={!dirty} style={{ opacity: dirty ? 1 : 0.5, cursor: dirty ? 'pointer' : 'not-allowed' }}>Save Packages</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <button type="button" className={styles.addPkgBtn} onClick={addPackage}>+ Add Package</button>
      {etOpen && (
        <div onClick={() => setEtOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, maxHeight: '85vh', overflowY: 'auto', background: '#0c0c12', border: '1px solid var(--neon)', borderRadius: 12, padding: '1.25rem', boxShadow: '0 20px 60px rgba(0,0,0,.6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.3rem' }}>
              <h3 style={{ margin: 0, fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem', letterSpacing: '.04em', color: '#fff' }}>Event types</h3>
              <button type="button" onClick={() => setEtOpen(false)} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: '1.3rem', lineHeight: 1, cursor: 'pointer' }}>&times;</button>
            </div>
            <p style={{ margin: '0 0 .9rem', color: 'var(--muted)', fontSize: '.75rem', lineHeight: 1.5 }}>Check the event types you offer, or add your own. These appear on your public booking form and here for pricing.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', marginBottom: '.9rem' }}>
              {Object.entries(MOB_EVENT_LABELS).filter(([k]) => k !== 'other').map(([key, lbl]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', color: '#fff', fontSize: '.85rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={etSel.includes(key)} onChange={(e) => etToggle(key, e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--neon)', cursor: 'pointer' }} />
                  {lbl}
                </label>
              ))}
              {etCustom.map((c) => (
                <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', color: '#fff', fontSize: '.85rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={etSel.includes(c.key)} onChange={(e) => etToggle(c.key, e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--neon)', cursor: 'pointer' }} />
                  <span style={{ flex: 1 }}>{c.label}</span>
                  <span role="button" aria-label={`Remove ${c.label}`} title="Remove" onClick={(e) => { e.preventDefault(); etRemoveCustom(c.key); }} style={{ color: '#ff8f8f', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>&times;</span>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1rem' }}>
              <input value={etNew} onChange={(e) => setEtNew(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); etAddCustom(); } }} placeholder="Add event type" aria-label="Add event type" style={{ flex: 1, background: 'rgba(10,10,16,.6)', border: '1px solid var(--border)', borderRadius: 6, color: '#fff', padding: '.55rem .6rem', fontSize: '.85rem' }} />
              <button type="button" onClick={etAddCustom} style={{ background: 'var(--neon)', color: '#04121a', border: 'none', borderRadius: 6, padding: '.55rem .9rem', fontFamily: "'Space Mono', monospace", fontSize: '.65rem', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer' }}>Add</button>
            </div>
            <button type="button" onClick={etSaveClose} style={{ width: '100%', background: 'transparent', border: '1px solid var(--neon)', color: 'var(--neon)', borderRadius: 6, padding: '.65rem', fontFamily: "'Space Mono', monospace", fontSize: '.65rem', letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer' }}>Done</button>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
