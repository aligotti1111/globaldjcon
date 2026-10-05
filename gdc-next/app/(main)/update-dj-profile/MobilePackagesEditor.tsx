'use client';

// MobilePackagesEditor — INDEPENDENT packages, sidebar-tree layout.
//
// LEFT (sidebar, desktop): a tree of categories. General first with its own
// packages + "Add Package"; then each pulled-out event type below with its own
// packages + "Add Package"; then "+ Add Event Type" / "Edit event types".
// RIGHT: the one selected package's editor (reuses PackageEditor).
//
// Each category owns a fully INDEPENDENT list of packages (title, description,
// photos, prices) — nothing is shared or copied across event types. A booker
// sees a pulled-out type's own packages; every other type uses General.
//
// Reads any stored shape via normalizeToIndependent (old buckets / v1 /
// already-v2) and writes the v2 `{ model:'independent', general, overrides }`
// shape on save. Migration is byte-safe: an existing DJ's page is identical.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import styles from './updateDjProfile.module.css';
import PackageEditor from './PackageEditor';
import { useConfirm } from '@/components/ConfirmModal';
import { type MobilePackage, packageTiers } from '@/app/(main)/[slug]/bookingSettings';
import { calcPrice, MOB_TIME_OPTIONS, MOB_END_TIME_OPTIONS, hoursBetween } from '@/app/(main)/[slug]/mobileBookingForm';
import bookingStyles from '@/app/(main)/[slug]/mobileBookingForm.module.css';
import { MOB_EVENT_LABELS, mobEventLabel, makeCustomEventKey, currencySymbol, type CustomEventType } from '@/lib/constants';
import {
  normalizeToIndependent,
  serializeIndependent,
  resolveIndependent,
  listFor,
  addPackage as addPkg,
  removePackage as removePkg,
  setPackageAt,
  pullTypeOut,
  putTypeBack,
  type MobPackagesIndependent,
  type Pkg,
} from '@/app/(main)/[slug]/packageModelIndependent';

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
  onSave: (next: MobPackagesIndependent) => void;
  onEventTypesSave?: (selected: string[], custom: CustomEventType[], specialty: string[]) => void | Promise<void>;
  depositPct?: number;
  taxEnabled?: boolean;
  taxPct?: number;
  onDirtyChange?: (dirty: boolean) => void;
  masterSaveTrigger?: number;
}) {
  const labelFor = (eventType: string): string =>
    eventType === 'general' ? 'General events' : mobEventLabel(eventType, customEventTypes);

  // ── Initial model: migrate to independent, auto-pull specialty types ──
  const initial = useMemo(() => {
    let m = normalizeToIndependent(mobPackages);
    for (const t of specialtyTypes) {
      if (t !== 'general' && selectedEventTypes.includes(t) && !m.overrides[t]) m = pullTypeOut(m, t);
    }
    return m;
  }, [mobPackages, specialtyTypes, selectedEventTypes]);
  // Always land on at least one General package ready to fill.
  const startMob = initial.general.length === 0 ? addPkg(initial, 'general') : initial;

  const [mob, setMob] = useState<MobPackagesIndependent>(startMob);
  const [selCat, setSelCat] = useState<string>('general');
  const [selIdx, setSelIdx] = useState(0);
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() => JSON.stringify(serializeIndependent(startMob)));
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errCat, setErrCat] = useState<string | null>(null);
  const [errIdx, setErrIdx] = useState<number | null>(null);
  const [errFields, setErrFields] = useState<string[]>([]);

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
  const [previewStart, setPreviewStart] = useState('18:00');
  const [previewEnd, setPreviewEnd] = useState('23:00');
  const [pvLb, setPvLb] = useState<{ photos: string[]; details: string; active: number } | null>(null);
  function openPreview() { setPreviewEvent(selectedEventTypes[0] || 'general'); setPreviewSel(0); setPreviewStart('18:00'); setPreviewEnd('23:00'); setPreviewOpen(true); }

  const { confirm, confirmDialog } = useConfirm();
  const cardRef = useRef<HTMLDivElement>(null);

  // On a narrow screen the sidebar + side editor becomes an accordion: tapping
  // a package opens its editor inline, right under that package in the tree.
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 760px)');
    const apply = () => setIsNarrow(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Pulled-out types that are still offered (shown as their own rail branch).
  const railTypes = Object.keys(mob.overrides).filter((t) => selectedEventTypes.includes(t));
  // Types that could be pulled out (offered, not already pulled, not General).
  const addableTypes = selectedEventTypes.filter((t) => t !== 'general' && !mob.overrides[t]);

  const hasAnyPrice = (() => {
    const has = (arr?: Pkg[]) => Array.isArray(arr) && arr.some((pk) => packageTiers(pk as unknown as MobilePackage).length > 0);
    if (has(mob.general)) return true;
    return Object.keys(mob.overrides).some((k) => has(mob.overrides[k]));
  })();

  // Keep newly-added specialty types pulled out live (no refresh needed).
  useEffect(() => {
    setMob((prev) => {
      let m = prev;
      for (const t of specialtyTypes) {
        if (t !== 'general' && selectedEventTypes.includes(t) && !m.overrides[t]) m = pullTypeOut(m, t);
      }
      return m;
    });
  }, [specialtyTypes, selectedEventTypes]);

  const curSer = useMemo(() => serializeIndependent(mob), [mob]);
  const dirty = JSON.stringify(curSer) !== savedSnapshot;
  const savedParsed = useMemo(() => {
    try { return JSON.parse(savedSnapshot) as MobPackagesIndependent; } catch { return null; }
  }, [savedSnapshot]);
  const pkgDirty = (cat: string, i: number) => {
    const cur = cat === 'general' ? curSer.general[i] : curSer.overrides[cat]?.[i];
    const sav = cat === 'general' ? savedParsed?.general?.[i] : savedParsed?.overrides?.[cat]?.[i];
    return JSON.stringify(cur ?? null) !== JSON.stringify(sav ?? null);
  };

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

  function update(next: MobPackagesIndependent) { setMob(next); setSaved(false); setErr(null); setErrCat(null); setErrIdx(null); setErrFields([]); }

  // Clamp the selected pointer if the list it points at shrank.
  const selList = listFor(mob, selCat);
  const safeIdx = Math.min(selIdx, Math.max(0, selList.length - 1));
  const currentPkg = (selList[safeIdx] || {}) as MobilePackage;
  // One-time copy source for the "use General's photos" helper in PackageEditor.
  const generalPhotos = useMemo(() => {
    const g = (mob.general[safeIdx] || {}) as { photo?: string; photos?: string[] };
    return { photo: g.photo || '', photos: Array.isArray(g.photos) ? g.photos : [] };
  }, [mob.general, safeIdx]);

  function onEditPkg(next: MobilePackage) { update(setPackageAt(mob, selCat, safeIdx, next as Pkg)); }

  function selectPkg(cat: string, i: number) { setSelCat(cat); setSelIdx(i); setErr(null); }

  function addPackageTo(cat: string) {
    const n = addPkg(mob, cat);
    setMob(n); setSaved(false); setErr(null);
    const list = listFor(n, cat);
    setSelCat(cat); setSelIdx(list.length - 1);
    requestAnimationFrame(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }

  async function removePackage() {
    const list = listFor(mob, selCat);
    // Keep at least one General package. A pulled-out type must keep one too;
    // to drop a type entirely, use the × (put back under General).
    if (list.length <= 1) return;
    const ok = await confirm({
      title: `Remove Package ${safeIdx + 1}?`,
      message: `This deletes this package and its pricing for ${labelFor(selCat)}. This cannot be undone.`,
      confirmLabel: 'Remove package', variant: 'danger',
    });
    if (!ok) return;
    const n = removePkg(mob, selCat, safeIdx);
    setMob(n); setSaved(false); setSelIdx(Math.max(0, safeIdx - 1));
  }

  function addEventType(type: string) { update(pullTypeOut(mob, type)); setSelCat(type); setSelIdx(0); }
  async function removeEventType(type: string) {
    const ok = await confirm({
      title: `Put ${labelFor(type)} back under General events?`,
      message: `${labelFor(type)} will lose its own packages and use your General events pricing instead.`,
      confirmLabel: 'Put back under General', variant: 'danger',
    });
    if (!ok) return;
    update(putTypeBack(mob, type));
    if (selCat === type) { setSelCat('general'); setSelIdx(0); }
  }

  function textEmpty(v: unknown): boolean {
    if (v == null) return true;
    return String(v).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === '';
  }
  function priceMissing(pkg: Record<string, unknown>): boolean {
    if (pkg.reqAll) return false;
    const tiers = Array.isArray(pkg.priceTiers) ? (pkg.priceTiers as Array<{ price?: unknown }>) : [];
    const hasTier = tiers.some((x) => x && Number(String(x.price ?? '').trim()) > 0);
    const hasLegacy = ['price4', 'price5', 'price6'].some((k) => Number(String((pkg)[k] ?? '').trim()) > 0);
    return !hasTier && !hasLegacy;
  }

  function save() {
    // Every package in every category is self-contained — each needs its own
    // title, description and at least one price (unless set to request a quote).
    const cats = ['general', ...Object.keys(mob.overrides)];
    for (const cat of cats) {
      const list = listFor(mob, cat);
      for (let i = 0; i < list.length; i++) {
        const p = (list[i] || {}) as { title?: string; details?: string };
        const missing: string[] = []; const labels: string[] = [];
        if (textEmpty(p.title)) { missing.push('title'); labels.push('a title'); }
        if (textEmpty(p.details)) { missing.push('details'); labels.push('a description'); }
        if (priceMissing(p as unknown as Record<string, unknown>)) { missing.push('priceTiers'); labels.push('at least one price'); }
        if (missing.length) {
          setErr(`${labelFor(cat)} — Package ${i + 1} needs ${labels.join(' and ')} before you can save.`);
          setErrFields(missing); setErrCat(cat); setErrIdx(i); setSelCat(cat); setSelIdx(i);
          setTimeout(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
          return;
        }
      }
    }
    setErr(null); setErrCat(null); setErrIdx(null); setErrFields([]);
    const ser = serializeIndependent(mob);
    onSave(ser); setSavedSnapshot(JSON.stringify(ser)); setSaved(true);
  }
  saveRef.current = save;

  // ── Event-types editor popup ──
  function openEtEditor() { setEtSel(selectedEventTypes); setEtCustom(customEventTypes); setEtSpec(Array.from(new Set([...specialtyTypes, ...railTypes]))); setEtNewGen(''); setEtNewSpec(''); setEtErr(null); setEtOpen(true); }
  function etToggle(key: string, on: boolean) { setEtSel((prev) => (on ? Array.from(new Set([...prev, key])) : prev.filter((k) => k !== key))); }
  function etAddCustom(label: string, toSpecialty: boolean) {
    const trimmed = label.trim(); if (!trimmed) return;
    const lc = trimmed.toLowerCase();
    const existingNames = [...Object.values(MOB_EVENT_LABELS).map((v) => v.toLowerCase()), ...etCustom.map((c) => c.label.toLowerCase())];
    if (existingNames.includes(lc)) { setEtErr(`“${trimmed}” already exists.`); return; }
    const key = makeCustomEventKey(trimmed);
    setEtCustom((prev) => [...prev, { key, label: trimmed }]);
    setEtSel((prev) => Array.from(new Set([...prev, key])));
    if (toSpecialty) setEtSpec((prev) => Array.from(new Set([...prev, key])));
    setEtErr(null);
    if (toSpecialty) setEtNewSpec(''); else setEtNewGen('');
  }
  async function etRemoveCustom(key: string) {
    const label = etCustom.find((c) => c.key === key)?.label || 'this event type';
    const ok = await confirm({ title: `Delete ${label}?`, message: `${label} will be removed from your event types, along with any pricing you set for it. This can't be undone.`, confirmLabel: 'Delete', variant: 'danger' });
    if (!ok) return;
    setEtCustom((prev) => prev.filter((c) => c.key !== key));
    setEtSel((prev) => prev.filter((k) => k !== key));
    setEtSpec((prev) => prev.filter((k) => k !== key));
  }
  function etSaveClose() { onEventTypesSave?.(etSel, etCustom, etSpec); setEtOpen(false); }
  async function closeEtEditor() {
    const baseSpec = Array.from(new Set([...specialtyTypes, ...railTypes])).sort();
    const etDirty = JSON.stringify([[...etSel].sort(), etCustom, [...etSpec].sort()]) !== JSON.stringify([[...selectedEventTypes].sort(), customEventTypes, baseSpec]);
    if (etDirty) {
      const ok = await confirm({ title: 'Discard event type changes?', message: 'You changed your event types but didn\'t save. Discard these changes?', confirmLabel: 'Discard', cancelLabel: 'Keep editing', variant: 'danger' });
      if (!ok) return;
    }
    setEtErr(null); setEtOpen(false);
  }

  // ── Sidebar styling ──
  const catLabel: CSSProperties = { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.5rem', lineHeight: 1, letterSpacing: '.05em', textTransform: 'uppercase', color: '#04241b', background: 'linear-gradient(100deg,#22e3ad,#31d0ff)', padding: '.3rem .65rem', borderRadius: 6, margin: '0 0 .6rem 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' };
  const pkgItem = (active: boolean, isDirty: boolean): CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem', width: '100%',
    padding: active ? '.5rem .7rem' : '.38rem .6rem', marginBottom: 5, borderRadius: 8, cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden',
    fontFamily: "'Bebas Neue', sans-serif", fontSize: active ? '1.3rem' : '1.05rem', lineHeight: 1, letterSpacing: '.04em', textTransform: 'uppercase',
    // The package being edited is spotlighted: brighter gradient fill, a thick
    // neon left bar, and a glow so it clearly reads as "this is open".
    background: 'transparent',
    color: active ? 'var(--neon)' : (isDirty ? '#ffd60a' : '#fff'),
    // Open package: a full neon frame only (no fill). Resting packages have a
    // transparent border so spacing stays even and no stray bracket shows.
    border: active ? '1px solid var(--neon)' : '1px solid transparent',
    transition: 'border-color .12s',
  });
  // Plain, centered "add" link — no frame, no underline.
  const addPkgBtn: CSSProperties = { width: '100%', background: 'none', border: 'none', color: 'var(--neon)', padding: '.3rem .1rem .5rem', marginBottom: 2, fontFamily: "'Space Mono', monospace", fontSize: '.58rem', letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer', textAlign: 'center', display: 'block' };

  const renderCategory = (cat: string) => {
    const list = listFor(mob, cat);
    return (
      <div key={cat} style={{ marginBottom: 16 }}>
        <div style={catLabel}>
          <span>{labelFor(cat)}</span>
          {cat !== 'general' && (
            <span role="button" title="Back under General" aria-label={`Put ${labelFor(cat)} back under General`} onClick={() => removeEventType(cat)} style={{ color: '#04241b', cursor: 'pointer', fontSize: '1.25rem', lineHeight: 1, flexShrink: 0, opacity: 0.7 }}>&times;</span>
          )}
        </div>
        {list.map((_, i) => {
          const active = selCat === cat && safeIdx === i;
          return (
            <button key={i} type="button" onClick={() => selectPkg(cat, i)} style={pkgItem(active, pkgDirty(cat, i))}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Package {i + 1}</span>
              {active ? (
                <span style={{ flexShrink: 0, fontFamily: "'Space Mono', monospace", fontSize: '.52rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#04241b', background: 'var(--neon)', borderRadius: 4, padding: '.12rem .4rem' }}>Editing</span>
              ) : pkgDirty(cat, i) ? (
                <span style={{ flexShrink: 0, fontFamily: "'Space Mono', monospace", fontSize: '.5rem', fontWeight: 700, letterSpacing: '.1em', color: '#ffd60a' }}>•</span>
              ) : null}
            </button>
          );
        })}
        {/* On mobile, the selected package's editor opens inline here. */}
        {isNarrow && selCat === cat && list.length > 0 && (
          <div ref={cardRef} style={{ margin: '2px 0 12px', scrollMarginTop: 80 }}>{renderEditor()}</div>
        )}
        <button type="button" style={addPkgBtn} onClick={() => addPackageTo(cat)}>+ Add Package</button>
      </div>
    );
  };

  const renderEditor = () => (
    <>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.5rem', letterSpacing: '.05em', textTransform: 'uppercase', color: '#fff', marginBottom: '.6rem' }}>
        {labelFor(selCat)} &mdash; Package {safeIdx + 1}
      </div>
      {err && errCat === selCat && errIdx === safeIdx && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: '.5rem', background: 'rgba(255,95,95,.12)', border: '1px solid rgba(255,95,95,.55)', borderRadius: 8, padding: '.6rem .8rem', marginBottom: 14, color: '#ffb3b3', fontFamily: "'Space Mono', monospace", fontSize: '.68rem', letterSpacing: '.03em', lineHeight: 1.5 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ff8f8f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          <span>{err}</span>
        </div>
      )}
      <div className={styles.pkgCard}>
        <PackageEditor
          key={`${selCat}-${safeIdx}`}
          cat={catFor(selCat)}
          idx={safeIdx}
          pkg={currentPkg}
          totalCount={selList.length}
          userId={userId}
          currency={currency}
          onChange={onEditPkg}
          onRemove={() => {}}
          hideOwnHeader
          generalPhotos={selCat === 'general' ? undefined : generalPhotos}
          errorFields={errCat === selCat && errIdx === safeIdx ? errFields : undefined}
        />
        <div className={styles.pkgSaveRow}>
          {selList.length > 1 && (
            <button type="button" onClick={removePackage} style={{ background: 'transparent', border: '1px solid rgba(255,95,95,.5)', borderRadius: 6, color: '#ff8f8f', padding: '.5rem 1rem', fontFamily: "'Space Mono', monospace", fontSize: '.62rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' }}>Remove Package</button>
          )}
          <span style={{ flex: 1 }} />
          {saved && !dirty && <span style={{ color: 'var(--neon)', fontFamily: "'Space Mono', monospace", fontSize: '.62rem', letterSpacing: '.06em', textTransform: 'uppercase' }}>&#10003; Saved</span>}
          <button type="button" onClick={openPreview} disabled={!hasAnyPrice} title={hasAnyPrice ? 'See how a host sees your packages' : 'Add a price to a package first'} style={{ background: 'none', border: 'none', padding: '0 .4rem', color: hasAnyPrice ? 'var(--neon)' : 'var(--muted)', fontFamily: "'Space Mono', monospace", fontSize: '.6rem', letterSpacing: '.05em', textTransform: 'uppercase', textDecoration: 'underline', cursor: hasAnyPrice ? 'pointer' : 'not-allowed', opacity: hasAnyPrice ? 1 : 0.55, whiteSpace: 'nowrap' }}>Preview how a host sees this</button>
          <button type="button" className={styles.pkgSaveBtn} onClick={save} disabled={!dirty} style={{ opacity: dirty ? 1 : 0.5, cursor: dirty ? 'pointer' : 'not-allowed' }}>Save Packages</button>
        </div>
      </div>
    </>
  );

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {/* ── SIDEBAR (full-width accordion on mobile) ── */}
      <aside style={isNarrow ? { flex: '1 1 100%', width: '100%' } : { flex: '1 1 230px', maxWidth: 300, minWidth: 220 }}>
        {renderCategory('general')}
        {railTypes.map((t) => renderCategory(t))}
        {addableTypes.length > 0 && (
          <select
            aria-label="Add an event type with its own packages"
            value=""
            onChange={(e) => { if (e.target.value) addEventType(e.target.value); }}
            style={{ width: '100%', marginTop: 2, background: 'rgba(10,10,16,.6)', color: 'var(--neon)', border: '1px solid var(--neon)', borderRadius: 7, padding: '.55rem .5rem', fontFamily: "'Space Mono', monospace", fontSize: '.6rem', letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' }}
          >
            <option value="">+ Add Event Type</option>
            {addableTypes.map((t) => <option key={t} value={t}>{labelFor(t)}</option>)}
          </select>
        )}
        {onEventTypesSave && (
          <button type="button" onClick={openEtEditor} style={{ width: '100%', marginTop: 8, background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 7, padding: '.5rem', fontFamily: "'Space Mono', monospace", fontSize: '.55rem', letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' }}>Edit event types</button>
        )}
        {addableTypes.length > 0 && (
          <p style={{ fontFamily: "'Space Mono', monospace", fontSize: '.5rem', lineHeight: 1.5, letterSpacing: '.04em', textTransform: 'uppercase', color: '#9a9ab0', margin: '.5rem .1rem 0' }}>
            &ldquo;Add Event Type&rdquo; gives that event its own packages, pricing &amp; photos, separate from General.
          </p>
        )}
      </aside>

      {/* ── EDITOR (right pane on desktop; inline in the tree on mobile) ── */}
      {!isNarrow && (
        <main ref={cardRef} style={{ flex: '1000 1 300px', minWidth: 0, scrollMarginTop: 90 }}>
          {renderEditor()}
        </main>
      )}

      {/* ── Event types popup ── */}
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
            {isCustom(o.key) && (<span role="button" aria-label={`Remove ${o.label}`} title="Remove" onClick={(e) => { e.preventDefault(); void etRemoveCustom(o.key); }} style={{ color: '#ff8f8f', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>&times;</span>)}
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>{specOpts.length > 0 ? specOpts.map(cbRow) : <span style={{ color: 'var(--muted)', fontSize: '.75rem' }}>None yet.</span>}</div>
              {addRow(etNewSpec, setEtNewSpec, true)}
              {etErr && <p style={{ color: '#ff8f8f', fontSize: '.75rem', margin: '1rem 0 0' }}>{etErr}</p>}
              <button type="button" onClick={etSaveClose} style={{ width: '100%', marginTop: etErr ? '.5rem' : '1.25rem', background: 'var(--neon)', border: '1px solid var(--neon)', color: '#04121a', borderRadius: 6, padding: '.7rem', fontFamily: "'Space Mono', monospace", fontSize: '.68rem', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer' }}>Save event types</button>
            </div>
          </div>
        );
      })()}

      {/* ── Host preview ── */}
      {previewOpen && (() => {
        const cur = currencySymbol(currency);
        const ser = serializeIndependent(mob);
        type Card = { i: number; pkg: MobilePackage; title: string; details: string; photo: string; photos: string[]; reqAll: boolean; tiers: { hours: number; price: number }[] };
        const list = resolveListFor(ser, previewEvent || 'general');
        const cards: Card[] = [];
        list.forEach((_, i) => {
          const rp = resolveIndependent(ser, previewEvent || 'general', i) as unknown as MobilePackage | null;
          if (!rp) return;
          const title = String((rp as { title?: string }).title || '').trim();
          if (!title) return;
          const mainPhoto = String((rp as { photo?: string }).photo || '');
          const extra = Array.isArray((rp as { photos?: string[] }).photos) ? ((rp as { photos?: string[] }).photos as string[]) : [];
          cards.push({ i, pkg: rp, title, details: String((rp as { details?: string }).details || ''), photo: mainPhoto, photos: Array.from(new Set([mainPhoto, ...extra].filter(Boolean))), reqAll: !!(rp as { reqAll?: boolean }).reqAll, tiers: packageTiers(rp) });
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
                    <select value={previewStart} onChange={(e) => setPreviewStart(e.target.value)} style={selStyle}>{MOB_TIME_OPTIONS.map((o) => <option key={o.val} value={o.val} style={{ background: '#0c0c12' }}>{o.label}</option>)}</select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={editLabel}>End time</div>
                    <select value={previewEnd} onChange={(e) => setPreviewEnd(e.target.value)} style={selStyle}>{MOB_END_TIME_OPTIONS.map((o) => <option key={o.val} value={o.val} style={{ background: '#0c0c12' }}>{o.label}</option>)}</select>
                  </div>
                </div>
                {lockField('Date', 'Saturday, August 15, 2026')}
                {lockField('Venue', '123 Celebration Ave, Your City')}
                {lockField('Your name', 'Jane Doe')}
                {cards.length > 0 && (
                  <div style={{ marginTop: '.8rem' }}>
                    <div className={bookingStyles.packagesLabel}>Select a Package</div>
                    <div className={bookingStyles.packagesGrid}>
                      {cards.map((c) => {
                        const isSel = previewSel === c.i;
                        const hasBody = !!(c.details || c.photos.length);
                        let priceEl: React.ReactNode = null;
                        if (c.reqAll) priceEl = <div className={bookingStyles.packagePriceQuote}>Price on request</div>;
                        else {
                          const cp = calcPrice(c.pkg, previewStart, previewEnd, depositPct, false, '', false);
                          if (cp.isQuote || cp.price == null) { if (c.tiers.length > 0) priceEl = <div className={bookingStyles.packagePriceQuote}>Price on request</div>; }
                          else priceEl = <div className={bookingStyles.packagePrice}>{cur}{cp.price.toLocaleString()}</div>;
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
                                <div className={bookingStyles.packageDetails}>{c.details ? <div dangerouslySetInnerHTML={{ __html: c.details }} /> : <div className={bookingStyles.packageDetailsEmpty}>Details available on request</div>}</div>
                                {c.photos.length > 0 && (
                                  <div className={bookingStyles.packageThumb} style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setPvLb({ photos: c.photos, details: c.details || '', active: 0 }); }}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={c.photos[0]} alt="" />
                                    <div className={bookingStyles.packageThumbOverlay} />
                                    <div className={bookingStyles.packageThumbLabel}>{c.photos.length > 1 ? `${c.photos.length} photos` : 'Setup'}</div>
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
                    <div className={summary.quote ? `${bookingStyles.priceValue} ${bookingStyles.priceValueQuote}` : bookingStyles.priceValue}>{summary.quote ? 'Price on Request' : `${cur}${summary.rate.toLocaleString()}`}</div>
                    {!summary.quote && (taxEnabled || depositPct > 0) && (
                      <div style={{ maxWidth: 260, margin: '12px auto 0', textAlign: 'left' }}>
                        {taxEnabled && (<>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', color: 'var(--white,#fff)', padding: '3px 0' }}><span>Subtotal</span><span>{cur}{summary.rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', color: 'var(--white,#fff)', padding: '3px 0' }}><span>Tax ({taxPct}%)</span><span>{cur}{summary.tax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                        </>)}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '1.2rem', fontWeight: 800, color: 'var(--neon,#00e0a4)', borderTop: '1px solid var(--border,rgba(255,255,255,.2))', paddingTop: 8, marginTop: 6, paddingBottom: 10, borderBottom: '1px solid var(--border,rgba(255,255,255,.2))', marginBottom: 10 }}><span>Total</span><span>{cur}{summary.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                        {depositPct > 0 && (<>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', color: 'var(--white,#fff)', padding: '3px 0' }}><span>Deposit ({depositPct}%)</span><span>{cur}{summary.deposit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', color: 'var(--white,#fff)', padding: '3px 0' }}><span>Balance due day of event</span><span>{cur}{(summary.total - summary.deposit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                        </>)}
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

      {pvLb && (
        <div className={bookingStyles.photoLightbox} onClick={() => setPvLb(null)}>
          <div className={bookingStyles.photoLightboxInner} onClick={(e) => e.stopPropagation()}>
            <div className={bookingStyles.photoLightboxStage}>
              <div className={bookingStyles.photoLightboxMain}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pvLb.photos[pvLb.active]} alt="Package preview" className={bookingStyles.photoLightboxImg} />
              </div>
              {pvLb.photos.length > 1 && (
                <div className={bookingStyles.photoLightboxThumbs}>
                  {pvLb.photos.map((u, i) => (
                    <button key={i} type="button" className={`${bookingStyles.photoLightboxThumb} ${i === pvLb.active ? bookingStyles.photoLightboxThumbActive : ''}`} onClick={() => setPvLb((c) => c ? { ...c, active: i } : c)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt={`Photo ${i + 1}`} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            {pvLb.details && (<div className={bookingStyles.photoLightboxDetails} dangerouslySetInnerHTML={{ __html: pvLb.details }} />)}
            <button type="button" onClick={() => setPvLb(null)} className={bookingStyles.photoLightboxClose} aria-label="Close">&times;</button>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

// The package list a type offers in the resolved (serialized) model — a
// pulled-out type's own list, else General.
function resolveListFor(ser: MobPackagesIndependent, eventType: string): Pkg[] {
  return ser.overrides[eventType] ?? ser.general;
}
