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

import { useMemo, useState } from 'react';
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

interface Props {
  djType: 'club' | 'mobile' | null;
  selectedEventTypes: string[];   // from General tab — which event types are checked
  bookingSettings: BookingSettings;
  onChange: (next: BookingSettings) => void;
  userId: string;
  // Switch to General tab, used by the "Go Select Party Types" button when
  // the DJ has no event types selected yet.
  onGoToGeneral: () => void;
  // Autosave indicator state from parent. Passed in so we can render a
  // visible "Saving… / ✓ Saved" badge inside this tab — the parent's
  // indicator is at the very top of the page and easy to miss when
  // editing packages further down.
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

  function updatePackage(c: PkgCategory, idx: number, p: MobilePackage) {
    const next = { ...packages };
    const arr = [...(next[c] || [])];
    while (arr.length <= idx) arr.push(newMobPackage());
    arr[idx] = p;
    next[c] = arr;
    setPackagesForIdx(idx, next);
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
    setLastChangedField('calendar');
    patch({ mob_booking_days: next });
  }

  // Package mutations: each tags itself with a per-package key like
  // "package-2" so the hint appears next to that specific card.
  function setPackagesForIdx(idx: number, next: Record<string, MobilePackage[]>) {
    setLastChangedField(`package-${idx}`);
    patch({ mob_packages: next });
  }
  // Top-level wholesale rewrite (add/remove a row across all cats).
  // Doesn't try to pin to a specific card — uses 'packages-list' instead.
  function setPackagesAll(next: Record<string, MobilePackage[]>) {
    setLastChangedField('packages-list');
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
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                <div className={styles.sectionTitle}>Booking Settings</div>
                <SavedHint
                  fieldKey="settings"
                  lastChangedField={lastChangedField}
                  autosaveStatus={autosaveStatus}
                />
              </div>
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
            </div>
          </div>

          {/* ── Packages ──────────────────────────────────────── */}
          <div className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                <div className={styles.sectionTitle}>Add Packages</div>
                <SavedHint
                  fieldKey="packages-list"
                  lastChangedField={lastChangedField}
                  autosaveStatus={autosaveStatus}
                />
              </div>
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
                  onUpdate={updatePackage}
                  onRemove={removePackage}
                  onAdd={addPackage}
                  lastChangedField={lastChangedField}
                  autosaveStatus={autosaveStatus}
                />
              )}
            </div>
          </div>

          {/* ── Availability Calendar ─────────────────────────── */}
          <div className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                <div className={styles.sectionTitle}>Availability Calendar</div>
                <SavedHint
                  fieldKey="calendar"
                  lastChangedField={lastChangedField}
                  autosaveStatus={autosaveStatus}
                />
              </div>
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
  onUpdate,
  onRemove,
  onAdd,
  lastChangedField,
  autosaveStatus,
}: {
  activeCats: PkgCategory[];
  packages: Record<string, MobilePackage[]>;
  totalCount: number;
  userId: string;
  onUpdate: (c: PkgCategory, idx: number, p: MobilePackage) => void;
  onRemove: (idx: number) => void;
  onAdd: () => void;
  lastChangedField: string | null;
  autosaveStatus: 'idle' | 'saving' | 'saved' | 'error';
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
        onUpdate={onUpdate}
        onRemove={() => onRemove(idx)}
        lastChangedField={lastChangedField}
        autosaveStatus={autosaveStatus}
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
// We pass `hideOwnHeader` to PackageEditor so we can render our own
// header above the cat tabs, instead of having two stacked headers.
function PackageCardWithCatTabs({
  idx,
  activeCats,
  packages,
  totalCount,
  userId,
  onUpdate,
  onRemove,
  lastChangedField,
  autosaveStatus,
}: {
  idx: number;
  activeCats: PkgCategory[];
  packages: Record<string, MobilePackage[]>;
  totalCount: number;
  userId: string;
  onUpdate: (c: PkgCategory, idx: number, p: MobilePackage) => void;
  onRemove: () => void;
  lastChangedField: string | null;
  autosaveStatus: 'idle' | 'saving' | 'saved' | 'error';
}) {
  const catLabels: Record<PkgCategory, string> = {
    general: 'General',
    wedding: 'Wedding',
    mitzvah: 'Bar/Bat Mitzvah',
  };

  const [selectedCat, setSelectedCat] = useState<PkgCategory>(activeCats[0]);

  const showInnerTabs = activeCats.length > 1;
  const currentPkg = packages[selectedCat]?.[idx] || newMobPackage();

  return (
    <div className={styles.pkgCard}>
      <div className={styles.pkgHeader}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className={styles.pkgHeaderTitle}>Package {idx + 1}</div>
          <SavedHint
            fieldKey={`package-${idx}`}
            lastChangedField={lastChangedField}
            autosaveStatus={autosaveStatus}
          />
        </div>
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
            const catPkgs = (packages[c] || []).filter((p) => p && p.title && p.title.trim());
            const needsAttention = (c === 'wedding' || c === 'mitzvah') && catPkgs.length === 0;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setSelectedCat(c)}
                className={`${styles.innerCatTab} ${isActive ? styles.innerCatTabActive : ''}`}
              >
                <span>{catLabels[c]}</span>
                {needsAttention && <span className={styles.innerCatBadge}>!</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* PackageEditor with hideOwnHeader — we already rendered the header
          + remove button above, plus optional cat tabs. */}
      <PackageEditor
        // Re-mount when the selected cat changes so the rich-text editor
        // resets its initial HTML to the new category's package details.
        key={selectedCat}
        cat={selectedCat}
        idx={idx}
        pkg={currentPkg}
        totalCount={totalCount}
        userId={userId}
        onChange={(p) => onUpdate(selectedCat, idx, p)}
        onRemove={onRemove}
        hideOwnHeader
      />
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
