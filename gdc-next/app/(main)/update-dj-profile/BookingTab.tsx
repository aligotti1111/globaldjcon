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
import {
  type BookingSettings,
  type MobileBookingDays,
  type MobilePackage,
} from '@/app/(main)/[slug]/bookingSettings';
import {
  getActivePackageCategories,
  type PkgCategory,
} from './constants';
import PackageEditor, { newMobPackage } from './PackageEditor';
import MobileOwnerCalendar from './MobileOwnerCalendar';

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
  return titleEmpty && detailsEmpty && priceEmpty;
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
}

export default function BookingTab({
  djType,
  selectedEventTypes,
  bookingSettings,
  onChange,
  userId,
  onGoToGeneral,
  autosaveStatus,
}: Props) {
  const enabled = !!bookingSettings.booking_enabled;
  const window = bookingSettings.mob_booking_window || 24;
  const perDay = bookingSettings.mob_bookings_per_day || 1;
  const deposit = bookingSettings.mob_deposit_pct || 0;
  const packages = bookingSettings.mob_packages || {};
  const bookingDays: MobileBookingDays = bookingSettings.mob_booking_days || {};

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

  function removePackage(idx: number) {
    if (!confirm('Remove this package? Any unsaved changes will be lost.')) return;
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
  // big Save All button at the bottom. Cards listen via useEffect and
  // attempt to save themselves. Tracks saveAttemptId so cards don't
  // re-save unnecessarily on re-render.
  const [masterSaveTrigger, setMasterSaveTrigger] = useState(0);
  function triggerMasterSave() {
    setMasterSaveTrigger((n) => n + 1);
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
  function setPerDay(v: number) { setLastChangedField('settings'); patch({ mob_bookings_per_day: v }); }
  function setDeposit(v: number) { setLastChangedField('settings'); patch({ mob_deposit_pct: v }); }
  function setBookingDays(next: MobileBookingDays) {
    // Don't tag a specific field here — MobileOwnerCalendar will fire
    // onMonthChanged after this with the actual month key, which is more
    // specific (e.g. 'calendar-2026-04' instead of just 'calendar').
    patch({ mob_booking_days: next });
  }

  // Top-level wholesale rewrite of all packages (add/remove a row, or
  // commit a save from a single package card). No SavedHint tagging since
  // packages don't autosave anymore — they have their own save buttons
  // and a master Save All at the bottom.
  function setPackagesAll(next: Record<string, MobilePackage[]>) {
    patch({ mob_packages: next });
  }

  return (
    <div>
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
        <div className={styles.placeholderPane}>
          <div className={styles.placeholderTitle}>Booking is currently disabled</div>
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
                />
              )}
              {/* Master Save All — saves every dirty package card at once.
                  Each card receives the trigger via masterSaveTrigger and
                  attempts its own save (with its own validation). If a
                  card has invalid data, IT shows the error inline. */}
              {activeCats.length > 0 && renderedCount > 0 && (
                <div
                  style={{
                    paddingTop: '1rem',
                    marginTop: '.4rem',
                    borderTop: '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '.75rem',
                    alignItems: 'center',
                  }}
                >
                  <span
                    style={{
                      fontSize: '.7rem',
                      color: 'var(--muted)',
                      fontFamily: "'Space Mono', monospace",
                      letterSpacing: '.05em',
                    }}
                  >
                    Saves every package above
                  </span>
                  <button
                    type="button"
                    onClick={triggerMasterSave}
                    style={{
                      fontFamily: "'Space Mono', monospace",
                      fontSize: '.7rem',
                      letterSpacing: '.07em',
                      textTransform: 'uppercase',
                      padding: '.65rem 1.2rem',
                      borderRadius: '6px',
                      border: '1px solid var(--neon)',
                      background: 'var(--neon-dim)',
                      color: 'var(--neon)',
                      cursor: 'pointer',
                      fontWeight: 700,
                    }}
                  >
                    Save All Packages
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ── Availability Calendar ─────────────────────────── */}
          <div className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>Availability Calendar</div>
            </div>
            <div className={styles.sectionBody}>
              <p className={styles.bodyHint}>
                All days are available by default. Use{' '}
                <strong style={{ color: 'rgba(255,255,255,.4)' }}>✕</strong> to mark unavailable,{' '}
                <strong style={{ color: 'var(--neon)' }}>✓</strong> to restore, or{' '}
                <strong>✏️</strong> to customize a day.
              </p>
              <MobileOwnerCalendar
                bookingDays={bookingDays}
                onChange={setBookingDays}
                bookingWindowMonths={window}
                defaultBookingsPerDay={perDay}
                lastChangedField={lastChangedField}
                autosaveStatus={autosaveStatus}
                onMonthChanged={(monthKey) => setLastChangedField(monthKey)}
              />
            </div>
          </div>
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
}: {
  activeCats: PkgCategory[];
  packages: Record<string, MobilePackage[]>;
  totalCount: number;
  userId: string;
  onSavePackage: (idx: number, drafts: Record<PkgCategory, MobilePackage>) => void;
  onRemove: (idx: number) => void;
  onAdd: () => void;
  masterSaveTrigger: number;
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
}: {
  idx: number;
  activeCats: PkgCategory[];
  packages: Record<string, MobilePackage[]>;
  totalCount: number;
  userId: string;
  onSave: (drafts: Record<PkgCategory, MobilePackage>) => void;
  onRemove: () => void;
  masterSaveTrigger: number;
}) {
  const catLabels: Record<PkgCategory, string> = {
    general: 'General',
    wedding: 'Wedding',
    mitzvah: 'Bar/Bat Mitzvah',
  };

  const [selectedCat, setSelectedCat] = useState<PkgCategory>(activeCats[0]);
  const showInnerTabs = activeCats.length > 1;

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

  // Did anything change since last save? Used for the dirty indicator.
  const isDirty = useMemo(() => {
    return activeCats.some((c) => {
      const saved = packages[c]?.[idx] || newMobPackage();
      const draft = drafts[c] || newMobPackage();
      return JSON.stringify(saved) !== JSON.stringify(draft);
    });
  }, [activeCats, packages, drafts, idx]);

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
    <div className={styles.pkgCard}>
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
        <div className={styles.innerCatTabs}>
          {activeCats.map((c) => {
            const isActive = selectedCat === c;
            const hasError = !!catErrors[c];
            return (
              <button
                key={c}
                type="button"
                onClick={() => setSelectedCat(c)}
                className={`${styles.innerCatTab} ${isActive ? styles.innerCatTabActive : ''}`}
              >
                <span>{catLabels[c]}</span>
                {hasError && <span className={styles.innerCatBadge}>!</span>}
              </button>
            );
          })}
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
            <div key={c} style={{ fontSize: '.78rem', color: 'var(--white)', marginTop: '.25rem' }}>
              <strong>{catLabels[c]}:</strong>{' '}
              <span style={{ color: 'var(--muted)' }}>
                {catErrors[c].errors.map((e) => e.msg).join(', ')}
              </span>
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
          flexWrap: 'wrap',
        }}
      >
        <div style={{
          fontFamily: "'Space Mono', monospace",
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
