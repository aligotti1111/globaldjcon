'use client';

// BookingTab — controls for booking_settings on the DJ's profile.
// This session: mobile DJ subsection only. Club DJ subsection (equipment,
// rates, club calendar) is deferred.
//
// Sections in this tab:
//   1. Enable Booking toggle
//   2. Booking Settings (window, bookings/day, deposit %)
//   3. Add Packages — array of package cards by category
//   4. Availability Calendar — 3-month editable grid + day editor modal
//
// Settings autosave silently when changed (matches vanilla mobAutoSave +
// mobAutoSaveCalendar). The bottom "Save Changes" button on the page
// overall ALSO writes booking_settings, so users have both autosave and
// manual save paths.

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './updateDjProfile.module.css';
import { createClient } from '@/lib/supabase/client';
import { useConfirm } from '@/components/ConfirmModal';
import {
  type BookingSettings,
  type MobileBookingDays,
  type MobilePackage,
} from '@/app/(main)/[slug]/bookingSettings';
import {
  getActivePackageCategories,
  MOBILE_EVENT_TYPES,
  MOB_CAT_GENERAL_TYPES,
  type PkgCategory,
} from './constants';
import PackageEditor, { newMobPackage } from './PackageEditor';
import EmbedCodeSection from './EmbedCodeSection';

// ─────────────────────────────────────────────────────────────────────────
// Package validation
// ─────────────────────────────────────────────────────────────────────────
// A package category is "empty" if title, details, AND all prices are blank.
// Empty categories are skipped on save (don't write a row for them) and don't
// block validation.
//
// A category is "valid" if title, details, AND pricing pass:
//   - reqAll=true  → no price fields needed (request-quote mode)
//   - reqAll=false → price4 + price5 + price6 + overtime all > 0
//
// A category is "partial" if some fields are filled but it doesn't meet
// either bar — that blocks save until the user either completes it or
// clears all of its fields.

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

function isPkgEmpty(p: MobilePackage | undefined): boolean {
  if (!p) return true;
  const titleEmpty = !((p.title || '').trim());
  const detailsEmpty = !stripHtml(p.details || '');
  const priceEmpty = !p.price4 && !p.price5 && !p.price6 && !p.overtime;
  // Photos count as content: a package with photos but no title/price is
  // treated as PARTIAL (not empty), so it surfaces the "fix or clear" errors
  // rather than being silently saved as a blank.
  const photosEmpty = !(p.photo || '').trim()
    && !(Array.isArray((p as { photos?: string[] }).photos) && (p as { photos?: string[] }).photos!.some((u) => !!u));
  return titleEmpty && detailsEmpty && priceEmpty && photosEmpty;
}

interface PkgValidationResult {
  ok: boolean;
  // List of per-field error messages keyed by field name
  errors: { field: string; msg: string }[];
}

function validatePkg(p: MobilePackage | undefined): PkgValidationResult {
  const errors: { field: string; msg: string }[] = [];
  if (!p) return { ok: false, errors: [{ field: 'title', msg: 'Empty package' }] };
  if (!(p.title || '').trim()) {
    errors.push({ field: 'title', msg: 'Title is required' });
  }
  if (!stripHtml(p.details || '')) {
    errors.push({ field: 'details', msg: 'Details are required' });
  }
  // Pricing rules differ by reqAll
  if (!p.reqAll) {
    if (!p.price4 || Number(p.price4) <= 0) errors.push({ field: 'price4', msg: '4hr price required' });
    if (!p.price5 || Number(p.price5) <= 0) errors.push({ field: 'price5', msg: '5hr price required' });
    if (!p.price6 || Number(p.price6) <= 0) errors.push({ field: 'price6', msg: '6hr price required' });
    if (!p.overtime || Number(p.overtime) <= 0) errors.push({ field: 'overtime', msg: 'Overtime rate required' });
  }
  return { ok: errors.length === 0, errors };
}

interface Props {
  djType: 'club' | 'mobile' | null;
  // DJ's URL slug — needed for the Embed Code section so the iframe URL
  // points at this profile. We take it as a separate prop rather than
  // pulling from the user record so the embed snippet updates live as
  // the user edits their slug on the General tab.
  djSlug: string;
  selectedEventTypes: string[];   // from General tab — which event types are checked
  bookingSettings: BookingSettings;
  onChange: (next: BookingSettings) => void;
  userId: string;
  // Switch to General tab, used by the "Go Select Party Types" button when
  // the DJ has no event types selected yet.
  onGoToGeneral: () => void;
  // Autosave indicator state from parent. Used for the section-level hints
  // (booking settings + calendar). Packages have their own per-card save
  // button instead of autosave so a typo can't push live before the user
  // is ready.
  autosaveStatus: 'idle' | 'saving' | 'saved' | 'error';
  // Callback fired whenever ANY package card has unsaved drafts changes.
  // Parent uses this to power the unsaved-changes warning on tab close.
  onDirtyChange?: (dirty: boolean) => void;
  // External master-save trigger from the page-level Save All button.
  // When this counter bumps, all dirty package cards attempt a save —
  // same flow as the internal "Save All Packages" button at the bottom
  // of the packages section.
  externalMasterSaveTrigger?: number;
}

export default function BookingTab({
  djType,
  djSlug,
  selectedEventTypes,
  bookingSettings,
  onChange,
  userId,
  onGoToGeneral,
  autosaveStatus,
  onDirtyChange,
  externalMasterSaveTrigger = 0,
}: Props) {
  const enabled = !!bookingSettings.booking_enabled;
  const window = bookingSettings.mob_booking_window || 24;
  const { confirm, confirmDialog } = useConfirm();
  const perDay = bookingSettings.mob_bookings_per_day || 1;
  const deposit = bookingSettings.mob_deposit_pct || 0;
  const packages = bookingSettings.mob_packages || {};

  const activeCats = useMemo(
    () => getActivePackageCategories(selectedEventTypes),
    [selectedEventTypes]
  );

  // Patch booking_settings without losing other fields
  function patch(p: Partial<BookingSettings>) {
    onChange({ ...bookingSettings, ...p });
  }

  // Note: actual setters (setEnabled, setWindow etc.) live below in the
  // "Inline saved hint tracking" block — they each tag lastChangedField
  // before patching so the hint shows next to the right field.

  // ── Package mutation helpers ─────────────────────────────────────
  //
  // Packages no longer autosave. Each PackageCardWithCatTabs holds local
  // draft state and only writes back to bookingSettings.mob_packages when
  // the user clicks Save on that card (or hits the master Save All).
  //
  // addPackage / removePackage are STRUCTURAL changes (add/remove a row
  // across all active cats) — those still write immediately because the
  // user explicitly clicked + and there's nothing to validate.
  //
  // Vanilla keeps all active categories at the same package count by
  // padding shorter ones when adding/removing. We do the same.
  function addPackage() {
    const next = { ...packages };
    activeCats.forEach((c) => {
      const arr = [...(next[c] || [])];
      while (arr.length < (next[activeCats[0]]?.length || 0)) arr.push(newMobPackage());
      arr.push(newMobPackage());
      next[c] = arr;
    });
    setPackagesAll(next);
  }

  async function removePackage(idx: number) {
    const ok = await confirm({
      title: 'Remove this package?',
      message: 'Any unsaved changes will be lost.',
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    const next = { ...packages };
    activeCats.forEach((c) => {
      if (next[c] && next[c].length > idx) {
        const arr = [...next[c]];
        arr.splice(idx, 1);
        next[c] = arr;
      }
    });
    setPackagesAll(next);
  }

  // savePackage — committed write from a single card. The card hands us
  // its `drafts` keyed by category. We splice each category's array at
  // index `idx`. Empty categories (where the user cleared everything) get
  // their slot replaced with a blank package so the row position stays
  // stable across all cats.
  function savePackage(idx: number, drafts: Record<PkgCategory, MobilePackage>) {
    const next = { ...packages };
    activeCats.forEach((c) => {
      const arr = [...(next[c] || [])];
      while (arr.length <= idx) arr.push(newMobPackage());
      arr[idx] = drafts[c] || newMobPackage();
      next[c] = arr;
    });
    setPackagesAll(next);
  }

  // Master save trigger — a counter that bumps when the user clicks the
  // big Save All button at the bottom of the packages section, OR when
  // the page-level Save All button at the bottom of the page is clicked
  // (passed in as externalMasterSaveTrigger). We unify both into one
  // internal counter so package cards only need to listen to one signal.
  const [masterSaveTrigger, setMasterSaveTrigger] = useState(0);
  function triggerMasterSave() {
    setMasterSaveTrigger((n) => n + 1);
  }

  // Bridge: when the page-level trigger bumps, also bump our internal
  // trigger so package cards see it.
  const lastExternalRef = useRef(externalMasterSaveTrigger);
  useEffect(() => {
    if (externalMasterSaveTrigger === 0) return;
    if (externalMasterSaveTrigger === lastExternalRef.current) return;
    lastExternalRef.current = externalMasterSaveTrigger;
    triggerMasterSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalMasterSaveTrigger]);

  // Dirty aggregation: each PackageCardWithCatTabs reports its own dirty
  // state via cardDirtyMap[idx] = boolean. We sum to a single boolean and
  // hand that up to the parent via onDirtyChange.
  const [cardDirtyMap, setCardDirtyMap] = useState<Record<number, boolean>>({});
  const anyCardDirty = useMemo(
    () => Object.values(cardDirtyMap).some(Boolean),
    [cardDirtyMap]
  );

  // Stable callback ref so useEffect dep is stable
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  useEffect(() => {
    onDirtyChangeRef.current?.(anyCardDirty);
  }, [anyCardDirty]);

  // Per-card dirty reporter — passed down to each PackageCardWithCatTabs.
  // Cards call this whenever their isDirty boolean flips.
  function reportCardDirty(idx: number, dirty: boolean) {
    setCardDirtyMap((prev) => {
      if (!!prev[idx] === dirty) return prev; // no change
      const next = { ...prev };
      if (dirty) next[idx] = true;
      else delete next[idx];
      return next;
    });
  }

  // Render only when DJ type is mobile. Club section deferred.
  if (djType !== 'mobile') {
    return (
      <div className={styles.placeholderPane}>
        <div className={styles.placeholderTitle}>Club DJ booking section coming soon</div>
        Equipment, rates, and the club availability calendar are part of a later session.
      </div>
    );
  }

  // Determine the rendered count — vanilla pads all active cats to match the
  // longest. We use the general cat (always populated when active) as anchor.
  const generalPkgs = packages.general || [];
  const renderedCount = generalPkgs.length || 1;

  // ── Inline saved hint tracking ───────────────────────────────────
  // We track the LAST field that changed so we can show a small "Saving…"
  // / "✓ Saved" hint inline next to that specific field instead of a
  // big sticky banner. Cleaner UX — the user gets contextual feedback
  // right where they edited.
  const [lastChangedField, setLastChangedField] = useState<string | null>(null);

  // Wrap all setters: each call updates lastChangedField first so the
  // SavedHint component can show its status next to the right field.
  function setEnabled(v: boolean) { setLastChangedField('settings'); patch({ booking_enabled: v }); }
  function setWindow(v: number) { setLastChangedField('settings'); patch({ mob_booking_window: v }); }
  // Changing the per-day limit: save the NUMBER immediately (synchronous,
  // never races), then debounce the calendar recompute so rapid keystrokes
  // ("1" then "10") only trigger ONE recompute with the final value. The
  // recompute counts the DJ's ACTUAL approved bookings per date from the
  // bookings table (the stored bookings_available numbers are unreliable)
  // and rebuilds mob_booking_days from that. Manual `unavailable` blocks
  // are preserved.
  const perDayRecomputeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function setPerDay(v: number) {
    setLastChangedField('settings');
    const newLimit = Math.max(1, v);
    // 1. Persist the number right away — synchronous, no async race.
    patch({ mob_bookings_per_day: newLimit });
    // 2. Debounce the day recompute. Cancels any pending recompute so a
    //    stale earlier value can't land after a newer one.
    if (perDayRecomputeTimer.current) clearTimeout(perDayRecomputeTimer.current);
    perDayRecomputeTimer.current = setTimeout(() => {
      void recomputeBookingDays(newLimit);
    }, 500);
  }

  // Recompute mob_booking_days against `limit` from real booking counts.
  // Uses the functional onChange form so it merges against the freshest
  // settings state (the number patch above may not have flushed yet).
  async function recomputeBookingDays(limit: number) {
    try {
      const supabase = createClient();
      const { data: rows, error } = await supabase
        .from('bookings')
        .select('event_date')
        .eq('dj_id', userId)
        .eq('status', 'approved');
      if (error) throw error;

      const countByDate: Record<string, number> = {};
      for (const r of (rows || []) as { event_date: string | null }[]) {
        if (!r.event_date) continue;
        countByDate[r.event_date] = (countByDate[r.event_date] || 0) + 1;
      }

      // Merge against the latest settings so we don't clobber concurrent
      // edits and so we read the current day map fresh.
      (onChange as unknown as (fn: (prev: BookingSettings) => BookingSettings) => void)(
        (prev) => {
          const prevDays = (prev.mob_booking_days || {}) as MobileBookingDays;
          const recomputed: MobileBookingDays = {};
          // Preserve manual unavailable blocks and owner-marked events
          // (eventName set, no real bookings on that date).
          for (const [date, day] of Object.entries(prevDays) as [string, MobileBookingDays[string]][]) {
            if (day.unavailable) { recomputed[date] = day; continue; }
            if (day.eventName && !countByDate[date]) { recomputed[date] = day; continue; }
            // else: dropped; re-added below if it has real bookings.
          }
          // Apply real per-date counts against the limit.
          for (const [date, count] of Object.entries(countByDate)) {
            const existing = recomputed[date] || prevDays[date] || {};
            if (existing.unavailable) continue;
            const remaining = Math.max(0, limit - count);
            recomputed[date] = {
              ...existing,
              bookings_available: remaining,
              booked: remaining <= 0,
            };
          }
          return { ...prev, mob_booking_days: recomputed };
        },
      );
    } catch {
      // Recompute failed — the number was already saved above, so the
      // setting isn't lost; the calendar just isn't rebuilt this time.
    }
  }
  function setDeposit(v: number) { setLastChangedField('settings'); patch({ mob_deposit_pct: v }); }
  // Top-level wholesale rewrite of all packages (add/remove a row, or
  // commit a save from a single package card). No SavedHint tagging since
  // packages don't autosave anymore — they have their own save buttons
  // and a master Save All at the bottom.
  function setPackagesAll(next: Record<string, MobilePackage[]>) {
    patch({ mob_packages: next });
  }

  return (
    <div>
      {confirmDialog}
      {/* Enable Booking toggle */}
      <div className={styles.bookingEnabledRow}>
        <div>
          <div className={styles.bookingEnabledLabel}>Enable Booking</div>
          <div className={styles.bookingEnabledHint}>
            Allow guests and venues to request bookings directly from your profile.
          </div>
        </div>
        <label className={styles.toggleSwitch}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span className={styles.toggleTrack} />
          <span className={styles.toggleThumb} />
        </label>
      </div>

      {!enabled && (
        <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--muted)', fontSize: '.85rem', lineHeight: 1.6 }}>
          <div style={{ color: 'var(--white)', fontSize: '.95rem', marginBottom: '.5rem' }}>
            Booking is currently disabled
          </div>
          Enable it above to configure booking settings, packages, and your availability calendar.
        </div>
      )}

      {enabled && (
        <>
          {/* ── Booking Settings ────────────────────────────────── */}
          <div className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>Booking Settings</div>
            </div>
            <div className={`${styles.sectionBody} ${styles.settingsBody}`}>
              {/* Window */}
              <div className={styles.settingRow}>
                <div className={styles.settingLabelWrap}>
                  <div className={styles.settingLabel}>How far in advance can someone book?</div>
                </div>
                <select
                  value={window}
                  onChange={(e) => setWindow(parseInt(e.target.value, 10))}
                  className={styles.settingSelect}
                >
                  <option value={3}>3 Months</option>
                  <option value={6}>6 Months</option>
                  <option value={12}>1 Year</option>
                  <option value={24}>2 Years</option>
                  <option value={36}>3 Years</option>
                  <option value={48}>4 Years</option>
                  <option value={60}>5 Years</option>
                </select>
              </div>

              {/* Per day */}
              <div className={styles.settingRow}>
                <div className={styles.settingLabelWrap}>
                  <div className={styles.settingLabel}>
                    Max number of bookings your company can accept per day
                  </div>
                  <div className={styles.settingHint}>
                    Once the number is reached, the day will be marked as booked.
                  </div>
                </div>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={perDay}
                  onChange={(e) => setPerDay(parseInt(e.target.value, 10) || 1)}
                  className={styles.settingNumber}
                />
              </div>

              {/* Deposit */}
              <div className={styles.settingRow}>
                <div className={styles.settingLabelWrap}>
                  <div className={styles.settingLabel}>Require deposit?</div>
                  <div className={styles.settingHint}>Percentage of total booking price.</div>
                </div>
                <select
                  value={deposit}
                  onChange={(e) => setDeposit(parseInt(e.target.value, 10) || 0)}
                  className={styles.settingSelect}
                >
                  <option value={0}>No Deposit</option>
                  {[5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95].map((p) => (
                    <option key={p} value={p}>{p}%</option>
                  ))}
                </select>
              </div>
              {/* Save status hint at the bottom of the section box.
                  Reserves a small fixed height so the layout doesn't
                  jump when the hint appears/disappears. */}
              <div
                style={{
                  minHeight: 18,
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  paddingTop: '.6rem',
                  marginTop: '.4rem',
                  borderTop: '1px solid var(--border)',
                }}
              >
                <SavedHint
                  fieldKey="settings"
                  lastChangedField={lastChangedField}
                  autosaveStatus={autosaveStatus}
                />
              </div>
            </div>
          </div>

          {/* ── Packages ──────────────────────────────────────── */}
          <div className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>Add Packages</div>
            </div>
            <div className={styles.sectionBody}>
              <p className={styles.bodyHint}>
                Create packages for the event types you service. Categories shown are based on your selected Mobile Party Types.
              </p>

              {activeCats.length === 0 && (
                <div className={styles.noTypesNotice}>
                  <div className={styles.noTypesNoticeText}>
                    You haven&apos;t selected any Mobile Party Types yet.
                  </div>
                  <button type="button" onClick={onGoToGeneral} className={styles.noTypesGoBtn}>
                    Go Select Party Types
                  </button>
                </div>
              )}

              {activeCats.length > 0 && (
                <PackageList
                  activeCats={activeCats}
                  packages={packages}
                  totalCount={renderedCount}
                  userId={userId}
                  onSavePackage={savePackage}
                  onRemove={removePackage}
                  onAdd={addPackage}
                  masterSaveTrigger={masterSaveTrigger}
                  reportCardDirty={reportCardDirty}
                  selectedEventTypes={selectedEventTypes}
                />
              )}
              {/* The internal "Save All Packages" button was removed —
                  individual package cards each have their own Save button,
                  and the top-level page Save still triggers the master
                  save via externalMasterSaveTrigger. */}
            </div>
          </div>

          {/* ── Embed Code ──────────────────────────────────────── */}
          <EmbedCodeSection slug={djSlug} />
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PackageList — handles category tabs (when DJ has multiple active cats)
// and the package cards themselves. One card per row; Add button at bottom.
// ─────────────────────────────────────────────────────────────────────────

function PackageList({
  activeCats,
  packages,
  totalCount,
  userId,
  onSavePackage,
  onRemove,
  onAdd,
  masterSaveTrigger,
  reportCardDirty,
  selectedEventTypes,
}: {
  activeCats: PkgCategory[];
  packages: Record<string, MobilePackage[]>;
  totalCount: number;
  userId: string;
  onSavePackage: (idx: number, drafts: Record<PkgCategory, MobilePackage>) => void;
  onRemove: (idx: number) => void;
  onAdd: () => void;
  masterSaveTrigger: number;
  reportCardDirty: (idx: number, dirty: boolean) => void;
  selectedEventTypes: string[];
}) {
  const cards: React.ReactNode[] = [];
  const count = Math.max(totalCount, 1);
  for (let idx = 0; idx < count; idx++) {
    cards.push(
      <PackageCardWithCatTabs
        key={`pkg-${idx}`}
        idx={idx}
        activeCats={activeCats}
        packages={packages}
        totalCount={count}
        userId={userId}
        onSave={(drafts) => onSavePackage(idx, drafts)}
        onRemove={() => onRemove(idx)}
        masterSaveTrigger={masterSaveTrigger}
        reportDirty={(dirty) => reportCardDirty(idx, dirty)}
        selectedEventTypes={selectedEventTypes}
      />
    );
  }
  return (
    <>
      {cards}
      {count < 10 && (
        <button type="button" onClick={onAdd} className={styles.addPkgBtn}>
          + Add Another Package
        </button>
      )}
    </>
  );
}

// PackageCardWithCatTabs — a single package index, shown across the active
// categories. When multiple cats are active, internal tabs let the user
// edit the same package index for each category.
//
// MANUAL SAVE MODEL:
// This card holds local draft state for all active categories at this
// idx. Editing fields ONLY updates the local draft — nothing writes
// back to bookingSettings until the user clicks Save here, OR the
// master Save All trigger fires (via masterSaveTrigger prop bump).
//
// Validation: each non-empty category must have title + details +
// pricing fully filled (or be entirely cleared). If any cat is in a
// partial/invalid state, save is blocked and we show which cat(s)
// failed and why.
//
// We pass `hideOwnHeader` to PackageEditor so we can render our own
// header above the cat tabs, instead of having two stacked headers.
function PackageCardWithCatTabs({
  idx,
  activeCats,
  packages,
  totalCount,
  userId,
  onSave,
  onRemove,
  masterSaveTrigger,
  reportDirty,
  selectedEventTypes,
}: {
  idx: number;
  activeCats: PkgCategory[];
  packages: Record<string, MobilePackage[]>;
  totalCount: number;
  userId: string;
  onSave: (drafts: Record<PkgCategory, MobilePackage>) => void;
  onRemove: () => void;
  masterSaveTrigger: number;
  reportDirty: (dirty: boolean) => void;
  selectedEventTypes: string[];
}) {
  const catLabels: Record<PkgCategory, string> = {
    general: 'General',
    wedding: 'Wedding',
    mitzvah: 'Bar/Bat Mitzvah',
  };

  const [selectedCat, setSelectedCat] = useState<PkgCategory>(activeCats[0]);
  const showInnerTabs = activeCats.length > 1;
  // General-tab expand: shows which selected mobile party types this General
  // package's pricing covers (everything except Wedding + Mitzvah).
  const [showGeneralCoverage, setShowGeneralCoverage] = useState(false);
  const generalCoverageLabels = useMemo(() => {
    return MOBILE_EVENT_TYPES
      .filter((t) => MOB_CAT_GENERAL_TYPES.includes(t.val) && selectedEventTypes.includes(t.val))
      .map((t) => t.label);
  }, [selectedEventTypes]);

  // Local draft state — one MobilePackage per active category. Initialized
  // from the saved values in `packages`. Edits go here, not back up to
  // bookingSettings, until the user clicks Save.
  //
  // We DON'T resync drafts when `packages` changes from outside (e.g. a
  // sibling card's save) because that would clobber the user's in-flight
  // typing. The drafts only resync on initial mount + when this idx's
  // length changes (e.g. row was removed).
  const [drafts, setDrafts] = useState<Record<PkgCategory, MobilePackage>>(() => {
    const init: Record<PkgCategory, MobilePackage> = {} as Record<PkgCategory, MobilePackage>;
    activeCats.forEach((c) => {
      init[c] = packages[c]?.[idx] || newMobPackage();
    });
    return init;
  });

  // Track save status for the visual indicator
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  // Per-category validation errors after the most recent save attempt.
  // Cleared when the user makes another edit.
  const [catErrors, setCatErrors] = useState<Record<PkgCategory, PkgValidationResult>>(
    () => ({} as Record<PkgCategory, PkgValidationResult>)
  );

  // Per-category saved/unsaved state. A category is "dirty" (unsaved) when its
  // draft differs from what's saved. Both sides are normalized first so
  // cosmetic shape differences (undefined vs '' vs absent, empty arrays, key
  // order) don't falsely register as "unsaved" — only real value changes count.
  // Used to color each category's tab AND the card box independently, so
  // switching tabs still shows every category's own state.
  const dirtyByCat = useMemo(() => {
    const norm = (p: MobilePackage | undefined): string => {
      const o = (p || {}) as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      Object.keys(o).sort().forEach((k) => {
        const v = o[k];
        if (v === undefined || v === null || v === '') return;          // drop empty
        if (Array.isArray(v) && v.length === 0) return;                  // drop []
        if (Array.isArray(v)) { out[k] = v.filter((x) => x !== '' && x != null); return; }
        out[k] = v;
      });
      return JSON.stringify(out);
    };
    const map = {} as Record<PkgCategory, boolean>;
    activeCats.forEach((c) => {
      const saved = packages[c]?.[idx] || newMobPackage();
      const draft = drafts[c] || newMobPackage();
      map[c] = norm(saved) !== norm(draft);
    });
    return map;
  }, [activeCats, packages, drafts, idx]);

  // Any category unsaved? (used for the Save button enabled/disabled state)
  const isDirty = useMemo(
    () => activeCats.some((c) => dirtyByCat[c]),
    [activeCats, dirtyByCat]
  );

  // A category's status border only shows once it has actual content (title,
  // details, price, or photos). A brand-new / empty package stays neutral —
  // no green or yellow until the DJ starts filling it in.
  function catHasContent(c: PkgCategory): boolean {
    const d = drafts[c];
    if (!d) return false;
    const hasPhotos = (d.photo || '').trim()
      || (Array.isArray((d as { photos?: string[] }).photos) && (d as { photos?: string[] }).photos!.some((u) => !!u));
    // The "require price on request" toggle is meaningful content too — when
    // it's on, the package is being configured even if no price is entered.
    const hasReqAll = !!(d as { reqAll?: boolean }).reqAll;
    return !isPkgEmpty(d) || !!hasPhotos || hasReqAll;
  }
  // Border color for a category: neutral if empty, yellow if unsaved, green if
  // saved.
  function catBorderColor(c: PkgCategory): string {
    if (!catHasContent(c)) return 'var(--border)';
    return dirtyByCat[c] ? 'var(--amber)' : 'var(--neon)';
  }

  // Report dirty state to parent (BookingTab aggregates across all cards
  // and bubbles to UpdateDjProfileClient which powers the page-leave
  // warning). Stable callback via ref so this effect doesn't loop.
  const reportDirtyRef = useRef(reportDirty);
  reportDirtyRef.current = reportDirty;
  useEffect(() => {
    reportDirtyRef.current(isDirty);
    // On unmount (e.g. package removed), tell parent we're no longer dirty
    return () => { reportDirtyRef.current(false); };
  }, [isDirty]);

  // Update one field in one category's draft
  function updateDraftField(cat: PkgCategory, p: MobilePackage) {
    setDrafts((prev) => ({ ...prev, [cat]: p }));
    // Clear any previous save state — user is editing again
    if (saveStatus === 'saved' || saveStatus === 'error') setSaveStatus('idle');
    if (catErrors[cat]) {
      setCatErrors((prev) => {
        const next = { ...prev };
        delete next[cat];
        return next;
      });
    }
  }

  // Try to save. Each category is evaluated independently:
  //   - empty   → silently skipped (slot reset to blank, no flag)
  //   - valid   → saved
  //   - partial → SKIPPED (kept at its currently-saved value, with red flag explaining what's missing)
  //
  // Save proceeds as long as AT LEAST ONE category was actually saved
  // (valid or empty-clear). Returns true if anything wrote, false if
  // every active cat was partial/no-op.
  //
  // Wrapped in useCallback-like ref so the master-save effect can call
  // an always-fresh version without re-subscribing.
  const trySaveRef = useRef<() => boolean>(() => false);
  trySaveRef.current = function trySave(): boolean {
    const errors: Record<PkgCategory, PkgValidationResult> = {} as Record<PkgCategory, PkgValidationResult>;
    const payload: Record<PkgCategory, MobilePackage> = {} as Record<PkgCategory, MobilePackage>;
    let anySaved = false;

    activeCats.forEach((c) => {
      const d = drafts[c];
      if (isPkgEmpty(d)) {
        // Empty → save as blank (clears the slot if it had old data).
        // Counts as "saved" since the user intentionally cleared it.
        payload[c] = newMobPackage();
        anySaved = true;
        return;
      }
      const v = validatePkg(d);
      // Duplicate-title check inside the same category. Two packages
      // in "general" both called "Silver Package" would confuse the
      // booker on the public profile, so block the save with a clear
      // error pointing at the title field. Comparison is
      // case-insensitive and ignores leading/trailing whitespace.
      if (v.ok) {
        const myTitleNorm = (d.title || '').trim().toLowerCase();
        if (myTitleNorm) {
          const catList = packages[c] || [];
          const dupe = catList.some((other, otherIdx) => {
            if (otherIdx === idx) return false; // skip own slot
            const otherTitle = (other.title || '').trim().toLowerCase();
            return otherTitle && otherTitle === myTitleNorm;
          });
          if (dupe) {
            v.ok = false;
            v.errors.push({
              field: 'title',
              msg: `A package called "${(d.title || '').trim()}" already exists in ${c}. Pick a different title.`,
            });
          }
        }
      }
      if (v.ok) {
        // Valid → save it
        payload[c] = d;
        anySaved = true;
      } else {
        // Partial → keep whatever was last saved for this cat (don't
        // overwrite, don't clear). Flag the problem in the UI.
        payload[c] = packages[c]?.[idx] || newMobPackage();
        errors[c] = v;
      }
    });

    setCatErrors(errors);

    if (!anySaved) {
      // Nothing valid + nothing intentionally cleared → don't write
      setSaveStatus('error');
      return false;
    }

    onSave(payload);
    // saveStatus = 'saved' if everything was clean; 'error' if some cats
    // had partial issues but at least one saved (mixed result).
    const hadErrors = Object.keys(errors).length > 0;
    setSaveStatus(hadErrors ? 'error' : 'saved');
    setTimeout(() => {
      setSaveStatus((cur) => (cur === 'saved' ? 'idle' : cur));
    }, 5000);
    return true;
  };

  // Subscribe to master Save All trigger — bumps on every click of the
  // big bottom button. Skip the very first render (trigger value 0).
  const lastTriggerRef = useRef(masterSaveTrigger);
  useEffect(() => {
    if (masterSaveTrigger === 0) return;
    if (masterSaveTrigger === lastTriggerRef.current) return;
    lastTriggerRef.current = masterSaveTrigger;
    // Only attempt to save if there are unsaved changes — no-op for clean cards
    if (isDirty) trySaveRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterSaveTrigger]);

  const currentDraft = drafts[selectedCat] || newMobPackage();
  const errorCats = activeCats.filter((c) => catErrors[c]);

  return (
    <div
      className={styles.pkgCard}
      style={{ border: `2px solid ${catBorderColor(selectedCat)}` }}
    >
      <div className={styles.pkgHeader}>
        <div className={styles.pkgHeaderTitle}>Package {idx + 1}</div>
        {totalCount > 1 && (
          <button
            type="button"
            onClick={onRemove}
            className={styles.pkgRemoveBtn}
            title="Remove package"
          >
            ✕
          </button>
        )}
      </div>

      {showInnerTabs && (
        <>
          {/* Checkmark stepper — sits ABOVE the tab boxes. Each check is
              transparent until that category's package is complete, then
              turns green; the connecting line fills as steps complete. */}
          <div className={styles.catCheckRow}>
            {activeCats.map((c, i) => {
              const isComplete = validatePkg(drafts[c]).ok;
              // The line after this step leads to the NEXT category. It's
              // solid green only when that next check is complete; otherwise
              // it's dashed/jagged.
              const next = activeCats[i + 1];
              const nextComplete = next ? validatePkg(drafts[next]).ok : false;
              return (
                <div key={c} className={styles.catCheckStep}>
                  <span
                    className={`${styles.catCheck} ${isComplete ? styles.catCheckDone : ''}`}
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                  {i < activeCats.length - 1 && (
                    <span
                      className={`${styles.catStepLine} ${
                        isComplete && nextComplete
                          ? styles.catStepLineDone
                          : (isComplete || nextComplete)
                            ? styles.catStepLineFromDone
                            : ''
                      }`}
                      aria-hidden="true"
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Tab boxes. */}
          <div className={styles.innerCatTabs}>
            {activeCats.map((c) => {
              const isActive = selectedCat === c;
              const hasError = !!catErrors[c];
              const stateColor = catBorderColor(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setSelectedCat(c)}
                  className={`${styles.innerCatTab} ${isActive ? styles.innerCatTabActive : ''}`}
                  style={{ borderColor: stateColor, boxShadow: `inset 0 0 0 1px ${stateColor}` }}
                >
                  <span>{catLabels[c]}</span>
                  {hasError && <span className={styles.innerCatBadge}>!</span>}
                  {c === 'general' && generalCoverageLabels.length > 0 && (
                    <span
                      role="button"
                      tabIndex={0}
                      className={`${styles.generalCoverageArrow} ${showGeneralCoverage ? styles.generalCoverageArrowOpen : ''}`}
                      title="Event types this package covers"
                      onClick={(e) => { e.stopPropagation(); setShowGeneralCoverage((v) => !v); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setShowGeneralCoverage((v) => !v); } }}
                    >
                      ▾
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* General tab: dropdown list of which selected party types this
          package's pricing covers — toggled by the arrow in the General box. */}
      {selectedCat === 'general' && showGeneralCoverage && generalCoverageLabels.length > 0 && (
        <div className={styles.generalCoverageList}>
          {generalCoverageLabels.map((label) => (
            <span key={label} className={styles.generalCoverageChip}>{label}</span>
          ))}
        </div>
      )}

      {/* PackageEditor with hideOwnHeader. onChange writes to LOCAL draft
          (no autosave to DB). Re-mount on cat switch so the rich-text
          editor resets to that cat's initial HTML. */}
      <PackageEditor
        key={selectedCat}
        cat={selectedCat}
        idx={idx}
        pkg={currentDraft}
        totalCount={totalCount}
        userId={userId}
        onChange={(p) => updateDraftField(selectedCat, p)}
        onRemove={onRemove}
        hideOwnHeader
        generalPhotos={{
          photo: drafts.general?.photo || '',
          photos: Array.isArray((drafts.general as { photos?: string[] } | undefined)?.photos)
            ? ((drafts.general as { photos?: string[] }).photos as string[])
            : [],
        }}
      />

      {/* Validation errors: list each invalid cat and what's missing */}
      {errorCats.length > 0 && (
        <div
          style={{
            marginTop: '.85rem',
            padding: '.75rem .9rem',
            background: 'transparent',
            border: '1px solid rgba(255,95,95,.5)',
            borderRadius: '6px',
          }}
        >
          <div
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '.65rem',
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              color: '#ff5f5f',
              marginBottom: '.4rem',
            }}
          >
            Not saved — fix or clear to save these:
          </div>
          {errorCats.map((c) => (
            <div key={c} style={{ marginTop: '.6rem' }}>
              <div style={{
                fontSize: '.82rem',
                color: 'var(--white)',
                fontWeight: 600,
                marginBottom: '.2rem',
              }}>
                {catLabels[c]} Package
              </div>
              <ul style={{
                margin: 0,
                paddingLeft: '1.2rem',
                fontSize: '.78rem',
                color: 'var(--muted)',
                lineHeight: 1.55,
                listStyle: 'disc',
              }}>
                {catErrors[c].errors.map((e, i) => (
                  <li key={i}>{e.msg}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Save row: status indicator on the left, Save button on the right */}
      <div
        style={{
          marginTop: '.85rem',
          paddingTop: '.85rem',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '.75rem',
          flexWrap: 'nowrap',
        }}
      >
        <div style={{
          fontFamily: "'Space Mono', monospace",
          flex: '1 1 auto',
          minWidth: 0,
          fontSize: '.68rem',
          letterSpacing: '.05em',
        }}>
          {saveStatus === 'saved' ? (
            <span style={{ color: 'var(--neon)' }}>✓ Saved</span>
          ) : isDirty ? (
            <span style={{ color: 'var(--amber)' }}>● Unsaved changes</span>
          ) : (
            <span style={{ color: 'var(--muted)' }}>✓ All saved</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => trySaveRef.current()}
          disabled={!isDirty}
          style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: '.68rem',
            letterSpacing: '.07em',
            textTransform: 'uppercase',
            padding: '.55rem 1.1rem',
            borderRadius: '6px',
            border: '1px solid',
            borderColor: isDirty ? 'var(--neon)' : 'var(--border)',
            background: isDirty ? 'var(--neon-dim)' : 'transparent',
            color: isDirty ? 'var(--neon)' : 'var(--muted)',
            cursor: isDirty ? 'pointer' : 'not-allowed',
            opacity: isDirty ? 1 : 0.6,
            fontWeight: 700,
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {showInnerTabs ? 'Save Package' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SavedHint — small inline indicator showing autosave state for ONE
// specific field (or section). Renders nothing unless the parent's
// `lastChangedField` matches our `fieldKey` AND the autosave is in
// progress or recently completed for that change.
//
// Usage:
//   <SavedHint
//     fieldKey="package-2"
//     lastChangedField={lastChangedField}
//     autosaveStatus={autosaveStatus}
//   />
//
// Renders next to whatever you put it after — typically a section header
// or the title of a package card.
// ─────────────────────────────────────────────────────────────────────────
function SavedHint({
  fieldKey,
  lastChangedField,
  autosaveStatus,
}: {
  fieldKey: string;
  lastChangedField: string | null;
  autosaveStatus: 'idle' | 'saving' | 'saved' | 'error';
}) {
  // Only show the hint if THIS field was the last one edited.
  if (lastChangedField !== fieldKey) return null;
  // Don't show anything when idle (after the 2s "✓ Saved" auto-clears
  // back to idle in the parent).
  if (autosaveStatus === 'idle') return null;

  const text = autosaveStatus === 'saving' ? 'Saving…'
    : autosaveStatus === 'saved' ? '✓ Saved'
    : '✗ Failed';
  const color = autosaveStatus === 'saving' ? 'var(--muted)'
    : autosaveStatus === 'saved' ? 'var(--neon)'
    : '#ff5f5f';

  return (
    <span
      style={{
        marginLeft: '.6rem',
        fontFamily: "'Space Mono', monospace",
        fontSize: '.6rem',
        letterSpacing: '.05em',
        color,
        opacity: autosaveStatus === 'saved' ? 1 : 0.85,
        transition: 'opacity .2s',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );
}

