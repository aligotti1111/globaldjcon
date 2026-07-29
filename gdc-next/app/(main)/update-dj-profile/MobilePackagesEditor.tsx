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
import { type MobilePackage, packageTiers } from '@/app/(main)/[slug]/bookingSettings';
import { resolvePackage, calcPrice, MOB_TIME_OPTIONS, MOB_END_TIME_OPTIONS, hoursBetween } from '@/app/(main)/[slug]/mobileBookingForm';
import bookingStyles from '@/app/(main)/[slug]/mobileBookingForm.module.css';
import { MOB_EVENT_LABELS, mobEventLabel, makeCustomEventKey, currencySymbol, type CustomEventType } from '@/lib/constants';
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
  depositPct = 0,
  taxEnabled = false,
  taxPct = 0,
}: {
  mobPackages: Record<string, unknown> | null | undefined;
  selectedEventTypes: string[];
  customEventTypes?: CustomEventType[];
  specialtyTypes?: string[];
  userId: string;
  currency: string;
  onSave: (next: MobPackagesNew) => void;
  onEventTypesSave?: (selected: string[], custom: CustomEventType[], specialty: string[]) => void | Promise<void>;
  depositPct?: number;
  taxEnabled?: boolean;
  taxPct?: number;
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
  // Baseline = the normalized+auto-pulled shape the editor actually starts in,
  // so a clean load is NOT dirty (specialty types are pulled in by `initial`).
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() => JSON.stringify(serializeMobPackages(initial)));
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [etOpen, setEtOpen] = useState(false);
  const [etSel, setEtSel] = useState<string[]>(selectedEventTypes);
  const [etCustom, setEtCustom] = useState<CustomEventType[]>(customEventTypes);
  const [etSpec, setEtSpec] = useState<string[]>(specialtyTypes);
  const [etNewGen, setEtNewGen] = useState('');
  const [etNewSpec, setEtNewSpec] = useState('');
  const [etErr, setEtErr] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewEvent, setPreviewEvent] = useState('');
  const [previewSel, setPreviewSel] = useState(0);
  const hasAnyPrice = (() => {
    const has = (arr?: Pkg[]) => Array.isArray(arr) && arr.some((pk) => packageTiers(pk as unknown as MobilePackage).length > 0);
    if (has(mob.general)) return true;
    return Object.keys(mob.overrides).some((k) => has(mob.overrides[k]));
  })();
  const [pvPhotos, setPvPhotos] = useState<string[] | null>(null);
  const [previewStart, setPreviewStart] = useState('18:00');
  const [previewEnd, setPreviewEnd] = useState('23:00');
  function openPreview() { setPreviewEvent(selectedEventTypes[0] || 'general'); setPreviewSel(0); setPreviewStart('18:00'); setPreviewEnd('23:00'); setPreviewOpen(true); }
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
  // When specialty types change (e.g. added from the Edit Event Types popup),
  // pull any newly-added ones into the live overrides so they show in the
  // "Customize pricing and details" rail immediately — no page refresh needed.
  useEffect(() => {
    setMob((prev) => {
      let m = prev;
      for (const t of specialtyTypes) {
        if (t !== 'general' && selectedEventTypes.includes(t) && !m.overrides[t]) {
          m = pullTypeOut(m, t);
        }
      }
      return m;
    });
  }, [specialtyTypes, selectedEventTypes]);

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
    // Name, details, and photos carry over from General so each event type
    // starts filled in and can be customized from there.
    for (const fld of ['title', 'details', 'photo'] as const) {
      const v = merged[fld];
      if (v == null || (typeof v === 'string' && v.replace(/<[^>]*>/g, '').trim() === '')) merged[fld] = base[fld];
    }
    if (!Array.isArray(merged.photos) || (merged.photos as unknown[]).length === 0) merged.photos = base.photos;
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
    for (const fld of ['title', 'details', 'photo', 'photos'] as const) {
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
  function openEtEditor() { setEtSel(selectedEventTypes); setEtCustom(customEventTypes); setEtSpec(Array.from(new Set([...specialtyTypes, ...railTypes]))); setEtNewGen(''); setEtNewSpec(''); setEtErr(null); setEtOpen(true); }
  function etToggle(key: string, on: boolean) {
    setEtSel((prev) => (on ? Array.from(new Set([...prev, key])) : prev.filter((k) => k !== key)));
  }
  function etAddCustom(label: string, toSpecialty: boolean) {
    const trimmed = label.trim(); if (!trimmed) return;
    const lc = trimmed.toLowerCase();
    const existingNames = [
      ...Object.values(MOB_EVENT_LABELS).map((v) => v.toLowerCase()),
      ...etCustom.map((c) => c.label.toLowerCase()),
    ];
    if (existingNames.includes(lc)) {
      setEtErr(`“${trimmed}” already exists.`);
      return;
    }
    const key = makeCustomEventKey(trimmed);
    setEtCustom((prev) => [...prev, { key, label: trimmed }]);
    setEtSel((prev) => Array.from(new Set([...prev, key])));
    if (toSpecialty) setEtSpec((prev) => Array.from(new Set([...prev, key])));
    setEtErr(null);
    if (toSpecialty) setEtNewSpec(''); else setEtNewGen('');
  }
  function etRemoveCustom(key: string) {
    setEtCustom((prev) => prev.filter((c) => c.key !== key));
    setEtSel((prev) => prev.filter((k) => k !== key));
    setEtSpec((prev) => prev.filter((k) => k !== key));
  }
  function etSaveClose() { onEventTypesSave?.(etSel, etCustom, etSpec); setEtOpen(false); }
  async function closeEtEditor() {
    const baseSpec = Array.from(new Set([...specialtyTypes, ...railTypes])).sort();
    const dirty = JSON.stringify([[...etSel].sort(), etCustom, [...etSpec].sort()])
      !== JSON.stringify([[...selectedEventTypes].sort(), customEventTypes, baseSpec]);
    if (dirty) {
      const ok = await confirm({
        title: 'Discard event type changes?',
        message: 'You changed your event types but didn\'t save. Discard these changes?',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        variant: 'danger',
      });
      if (!ok) return;
    }
    setEtErr(null);
    setEtOpen(false);
  }

  if (count === 0) {
    return <button type="button" className={styles.addPkgBtn} onClick={addPackage}>+ Add a package</button>;
  }

  const railLabel: CSSProperties = { fontFamily: "'Space Mono', monospace", fontSize: '.52rem', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)', margin: '0 0 .5rem .15rem' };
  const sideItem = (active: boolean): CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
    padding: '.34rem .55rem', marginBottom: 4, borderRadius: 6, cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden',
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.02rem', lineHeight: 1.1, letterSpacing: '.05em', textTransform: 'uppercase',
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
                        <button
                          key={t}
                          type="button"
                          onClick={() => { setSelType(t); setGenOpen(false); }}
                          style={{ ...sideItem(active), display: 'block', position: 'relative', overflow: 'visible', minHeight: 0, paddingTop: '.3rem', paddingBottom: '.85rem', paddingRight: '1.2rem' }}
                        >
                          <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelFor(t)}</span>
                          <span
                            role="button"
                            aria-label={`Put ${labelFor(t)} back under General`}
                            title="Back under General"
                            onClick={(e) => { e.stopPropagation(); removeEventType(t); }}
                            style={{ position: 'absolute', top: 2, right: 4, color: active ? 'var(--neon)' : 'var(--muted)', cursor: 'pointer', fontSize: '.85rem', lineHeight: 1, padding: '0 .1rem' }}
                          >&times;</span>
                          {generalComplete && typeNeedsPrice(t) && (
                            <span style={{ position: 'absolute', bottom: 2, right: 5, fontFamily: "'Space Mono', monospace", fontSize: '.5rem', letterSpacing: '.05em', textTransform: 'uppercase', color: '#f5c451', whiteSpace: 'nowrap' }}>Add price</span>
                          )}
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
                      <button
                        type="button"
                        onClick={openPreview}
                        disabled={!hasAnyPrice}
                        title={hasAnyPrice ? 'See how a host sees your packages' : 'Add a price to a package first'}
                        style={{ background: 'none', border: 'none', padding: '0 .4rem', color: hasAnyPrice ? 'var(--neon)' : 'var(--muted)', fontFamily: "'Space Mono', monospace", fontSize: '.6rem', letterSpacing: '.05em', textTransform: 'uppercase', textDecoration: 'underline', cursor: hasAnyPrice ? 'pointer' : 'not-allowed', opacity: hasAnyPrice ? 1 : 0.55, whiteSpace: 'nowrap' }}
                      >Preview how a host sees this</button>
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

      {etOpen && (() => {
        const builtIns = Object.entries(MOB_EVENT_LABELS).filter(([k]) => k !== 'other').map(([key, label]) => ({ key, label }));
        const allOpts = [...builtIns, ...etCustom.map((c) => ({ key: c.key, label: c.label }))];
        const genOpts = allOpts.filter((o) => !etSpec.includes(o.key));
        const specOpts = allOpts.filter((o) => etSpec.includes(o.key));
        const isCustom = (k: string) => etCustom.some((c) => c.key === k);
        const cbRow = (o: { key: string; label: string }) => (
          <label key={o.key} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', color: '#fff', fontSize: '.85rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={etSel.includes(o.key)} onChange={(e) => etToggle(o.key, e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--neon)', cursor: 'pointer' }} />
            <span style={{ flex: 1 }}>{o.label}</span>
            {isCustom(o.key) && (
              <span role="button" aria-label={`Remove ${o.label}`} title="Remove" onClick={(e) => { e.preventDefault(); etRemoveCustom(o.key); }} style={{ color: '#ff8f8f', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>&times;</span>
            )}
          </label>
        );
        const groupLabel: CSSProperties = { fontFamily: "'Space Mono', monospace", fontSize: '.55rem', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--neon)', margin: '0 0 .5rem' };
        const addRow = (val: string, setVal: (v: string) => void, toSpec: boolean) => (
          <div style={{ display: 'flex', gap: '.5rem', marginTop: '.6rem' }}>
            <input value={val} onChange={(e) => { setVal(e.target.value); setEtErr(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); etAddCustom(val, toSpec); } }} placeholder="Add event type" aria-label="Add event type" style={{ flex: 1, background: 'rgba(10,10,16,.6)', border: '1px solid var(--border)', borderRadius: 6, color: '#fff', padding: '.5rem .6rem', fontSize: '.82rem' }} />
            <button type="button" onClick={() => etAddCustom(val, toSpec)} style={{ background: 'var(--neon)', color: '#04121a', border: 'none', borderRadius: 6, padding: '.5rem .85rem', fontFamily: "'Space Mono', monospace", fontSize: '.62rem', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer' }}>Add</button>
          </div>
        );
        return (
          <div onClick={() => closeEtEditor()} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, maxHeight: '85vh', overflowY: 'auto', background: '#0c0c12', border: '1px solid var(--neon)', borderRadius: 12, padding: '1.25rem', boxShadow: '0 20px 60px rgba(0,0,0,.6)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.3rem' }}>
                <h3 style={{ margin: 0, fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem', letterSpacing: '.04em', color: '#fff' }}>Event types</h3>
                <button type="button" onClick={() => closeEtEditor()} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: '1.3rem', lineHeight: 1, cursor: 'pointer' }}>&times;</button>
              </div>
              <p style={{ margin: '0 0 1rem', color: 'var(--muted)', fontSize: '.75rem', lineHeight: 1.5 }}>Check the event types you offer, or add your own. These appear on your public booking form and here for pricing.</p>

              <div style={groupLabel}>General events</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>{genOpts.map(cbRow)}</div>
              {addRow(etNewGen, setEtNewGen, false)}

              <div style={{ ...groupLabel, marginTop: '1.25rem' }}>Specialty / Custom</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                {specOpts.length > 0 ? specOpts.map(cbRow) : <span style={{ color: 'var(--muted)', fontSize: '.75rem' }}>None yet.</span>}
              </div>
              {addRow(etNewSpec, setEtNewSpec, true)}

              {etErr && <p style={{ color: '#ff8f8f', fontSize: '.75rem', margin: '1rem 0 0' }}>{etErr}</p>}
              <button type="button" onClick={etSaveClose} style={{ width: '100%', marginTop: etErr ? '.5rem' : '1.25rem', background: 'var(--neon)', border: '1px solid var(--neon)', color: '#04121a', borderRadius: 6, padding: '.7rem', fontFamily: "'Space Mono', monospace", fontSize: '.68rem', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer' }}>Save event types</button>
            </div>
          </div>
        );
      })()}
      {previewOpen && (() => {
        const cur = currencySymbol(currency);
        const fmt = (n: number) => `${cur}${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
        const ser = serializeMobPackages(mob);
        const hrs = hoursBetween(previewStart, previewEnd);
        type Card = { i: number; pkg: MobilePackage; title: string; details: string; photo: string; photos: string[]; reqAll: boolean; tiers: { hours: number; price: number }[] };
        const cards: Card[] = [];
        mob.general.forEach((_, i) => {
          const rp = resolvePackage(ser as unknown as Record<string, unknown>, previewEvent || 'general', i) as unknown as MobilePackage | null;
          if (!rp) return;
          const title = String((rp as { title?: string }).title || '').trim();
          if (!title) return;
          const mainPhoto = String((rp as { photo?: string }).photo || '');
          const extra = Array.isArray((rp as { photos?: string[] }).photos) ? ((rp as { photos?: string[] }).photos as string[]) : [];
          cards.push({ i, pkg: rp, title, details: String((rp as { details?: string }).details || ''), photo: mainPhoto, photos: [mainPhoto, ...extra].filter(Boolean), reqAll: !!(rp as { reqAll?: boolean }).reqAll, tiers: packageTiers(rp) });
        });
        const sel = cards.find((c) => c.i === previewSel) || cards[0];
        let summary: { quote: boolean; rate: number; tax: number; deposit: number; total: number } | null = null;
        if (sel) {
          const res = calcPrice(sel.pkg, previewStart, previewEnd, depositPct, false, '', false);
          if (res.isQuote || res.price == null) summary = { quote: true, rate: 0, tax: 0, deposit: 0, total: 0 };
          else {
            const rate = res.price;
            const tax = taxEnabled ? Number(((rate * taxPct) / 100).toFixed(2)) : 0;
            const total = Number((rate + tax).toFixed(2));
            const deposit = depositPct > 0 ? Number(((total * depositPct) / 100).toFixed(2)) : 0;
            summary = { quote: false, rate, tax, deposit, total };
          }
        }
        const lockField = (label: string, value: string) => (
          <div style={{ marginBottom: '.55rem' }}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.5rem', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '.2rem' }}>{label}</div>
            <div style={{ background: 'rgba(20,20,28,.5)', border: '1px dashed var(--border)', borderRadius: 7, padding: '.5rem .6rem', color: 'var(--muted)', fontSize: '.82rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', pointerEvents: 'none', userSelect: 'none' }}>
              <span>{value}</span>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '.5rem', letterSpacing: '.1em', color: 'var(--neon)', fontWeight: 700 }}>SAMPLE</span>
            </div>
          </div>
        );
        const selStyle: CSSProperties = { width: '100%', background: 'rgba(10,10,16,.9)', color: '#fff', border: '1px solid var(--neon)', borderRadius: 7, padding: '.55rem .6rem', fontSize: '.85rem', cursor: 'pointer' };
        const editLabel: CSSProperties = { fontFamily: "'Space Mono', monospace", fontSize: '.5rem', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--neon)', marginBottom: '.2rem' };
        return (
          <div onClick={() => setPreviewOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '2rem 1rem', overflowY: 'auto' }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, background: '#000', border: '1px solid rgba(255,255,255,.6)', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,.7)', overflow: 'hidden' }}>
              <div style={{ background: 'var(--neon)', color: '#04121a', padding: '.5rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '.62rem', fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase' }}>Sample preview &middot; nothing is sent</span>
                <button type="button" onClick={() => setPreviewOpen(false)} aria-label="Close" style={{ background: 'none', border: 'none', color: '#04121a', fontSize: '1.2rem', lineHeight: 1, cursor: 'pointer' }}>&times;</button>
              </div>
              <div style={{ padding: '1.1rem 1.25rem 1.25rem' }}>
                <h3 style={{ margin: '0 0 .2rem', fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.5rem', letterSpacing: '.04em', color: '#fff' }}>How a host books you</h3>
                <p style={{ margin: '0 0 1rem', color: 'var(--muted)', fontSize: '.72rem', lineHeight: 1.5 }}>Change the <span style={{ color: 'var(--neon)' }}>event type</span> and <span style={{ color: 'var(--neon)' }}>times</span> below to see how your price moves. The greyed-out fields are just sample data.</p>

                <div style={{ marginBottom: '.55rem' }}>
                  <div style={editLabel}>Type of event</div>
                  <select value={previewEvent} onChange={(e) => { setPreviewEvent(e.target.value); setPreviewSel(0); }} style={selStyle}>
                    {selectedEventTypes.map((k) => <option key={k} value={k} style={{ background: '#0c0c12' }}>{labelFor(k)}</option>)}
                  </select>
                </div>

                <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.55rem' }}>
                  <div style={{ flex: 1 }}>
                    <div style={editLabel}>Start time</div>
                    <select value={previewStart} onChange={(e) => setPreviewStart(e.target.value)} style={selStyle}>
                      {MOB_TIME_OPTIONS.map((o) => <option key={o.val} value={o.val} style={{ background: '#0c0c12' }}>{o.label}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={editLabel}>End time</div>
                    <select value={previewEnd} onChange={(e) => setPreviewEnd(e.target.value)} style={selStyle}>
                      {MOB_END_TIME_OPTIONS.map((o) => <option key={o.val} value={o.val} style={{ background: '#0c0c12' }}>{o.label}</option>)}
                    </select>
                  </div>
                </div>

                {lockField('Date', 'Saturday, August 15, 2026')}
                {lockField('Venue', '123 Celebration Ave, Your City')}
                {lockField('Your name', 'Jane Doe')}
                {lockField('Email', 'jane@example.com')}
                {lockField('Phone', '(555) 123-4567')}

                {cards.length > 0 && (
                  <div style={{ marginTop: '.8rem' }}>
                    <div className={bookingStyles.packagesLabel}>Select a Package</div>
                    <div className={bookingStyles.packagesGrid}>
                      {cards.map((c) => {
                        const isSel = previewSel === c.i;
                        const hasBody = !!(c.details || c.photo);
                        let priceEl: React.ReactNode = null;
                        if (c.reqAll) {
                          priceEl = <div className={bookingStyles.packagePriceQuote}>Price on request</div>;
                        } else {
                          const cp = calcPrice(c.pkg, previewStart, previewEnd, depositPct, false, '', false);
                          if (cp.isQuote || cp.price == null) {
                            if (c.tiers.length > 0) priceEl = <div className={bookingStyles.packagePriceQuote}>Price on request</div>;
                          } else {
                            priceEl = <div className={bookingStyles.packagePrice}>{cur}{cp.price.toLocaleString()}</div>;
                          }
                        }
                        return (
                          <div key={c.i} className={`${bookingStyles.packageCard} ${isSel ? bookingStyles.packageCardSelected : ''}`} onClick={() => setPreviewSel(c.i)} role="button">
                            {isSel && <div className={bookingStyles.packageCheck}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#050507" strokeWidth="3.5"><polyline points="20 6 9 17 4 12" /></svg></div>}
                            <div className={`${bookingStyles.packageHead} ${hasBody ? bookingStyles.packageHeadHasBody : ''}`}>
                              <div className={bookingStyles.packageTitle}>{c.title}</div>
                              {priceEl && <div className={bookingStyles.packagePriceWrap}>{priceEl}</div>}
                            </div>
                            {hasBody && (
                              <div className={`${bookingStyles.packageBody} ${isSel ? bookingStyles.packageBodySelected : ''}`}>
                                <div className={bookingStyles.packageDetails}>
                                  {c.details ? <div dangerouslySetInnerHTML={{ __html: c.details }} /> : <div className={bookingStyles.packageDetailsEmpty}>Details available on request</div>}
                                </div>
                                {c.photo && (
                                  <div className={bookingStyles.packageThumb} style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); if (c.photos.length) setPvPhotos(c.photos); }}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={c.photo} alt="" />
                                    <div className={bookingStyles.packageThumbOverlay} />
                                    <div className={bookingStyles.packageThumbLabel}>{c.photos.length > 1 ? `${c.photos.length} photos` : 'Sample'}</div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {summary && (
                  <div className={bookingStyles.priceDisplay}>
                    <div className={bookingStyles.priceLabel}>Estimated Price</div>
                    <div className={summary.quote ? `${bookingStyles.priceValue} ${bookingStyles.priceValueQuote}` : bookingStyles.priceValue}>
                      {summary.quote ? 'Price on Request' : `${cur}${summary.rate.toLocaleString()}`}
                    </div>
                    {!summary.quote && (taxEnabled || depositPct > 0) && (
                      <div style={{ maxWidth: 260, margin: '12px auto 0', textAlign: 'left' }}>
                        {taxEnabled && (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', color: 'var(--white,#fff)', padding: '3px 0' }}>
                              <span>Subtotal</span><span>{cur}{summary.rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', color: 'var(--white,#fff)', padding: '3px 0' }}>
                              <span>Tax ({taxPct}%)</span><span>{cur}{summary.tax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                          </>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '1.2rem', fontWeight: 800, color: 'var(--neon,#00e0a4)', borderTop: '1px solid var(--border,rgba(255,255,255,.2))', paddingTop: 8, marginTop: 6, paddingBottom: 10, borderBottom: '1px solid var(--border,rgba(255,255,255,.2))', marginBottom: 10 }}>
                          <span>Total</span><span>{cur}{summary.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        {depositPct > 0 && (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', color: 'var(--white,#fff)', padding: '3px 0' }}>
                              <span>Deposit ({depositPct}%)</span><span>{cur}{summary.deposit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', color: 'var(--white,#fff)', padding: '3px 0' }}>
                              <span>Balance due day of event</span><span>{cur}{(summary.total - summary.deposit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {!summary.quote && depositPct === 0 && !taxEnabled && <div className={bookingStyles.depositText}>No deposit required</div>}
                  </div>
                )}

                <button type="button" onClick={() => setPreviewOpen(false)} style={{ width: '100%', marginTop: '1.25rem', background: 'transparent', border: '1px solid var(--neon)', color: 'var(--neon)', borderRadius: 6, padding: '.7rem', fontFamily: "'Space Mono', monospace", fontSize: '.65rem', letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer' }}>Close preview</button>
              </div>
            </div>
          </div>
        );
      })()}
      {pvPhotos && (
        <div onClick={() => setPvPhotos(null)} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,.9)', display: 'flex', flexDirection: 'column', alignItems: 'center', overflowY: 'auto', padding: '2.5rem 1rem' }}>
          <button type="button" onClick={() => setPvPhotos(null)} aria-label="Close" style={{ position: 'fixed', top: 12, right: 16, background: 'none', border: 'none', color: '#fff', fontSize: '2rem', lineHeight: 1, cursor: 'pointer' }}>&times;</button>
          {pvPhotos.map((u, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={u} alt="" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain', borderRadius: 8, marginBottom: 12 }} />
          ))}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
