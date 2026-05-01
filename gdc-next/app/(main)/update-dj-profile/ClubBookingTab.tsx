'use client';

// ClubBookingTab — the Booking tab content shown when DJ type is 'club'.
// Mirror of BookingTab.tsx (which is mobile-only) but tailored to the
// club-DJ flow.
//
// Sections (vanilla parity):
//   1. Equipment       — autosaves on change. Three mutually-exclusive
//                        options + free-text detail fields for two of them.
//   2. Rates           — manual save. Global rate type (flat/hourly/offers)
//                        + currency + per-equipment pricing.
//   3. Availability    — autosaves on change. 3-month calendar with the
//                        same look as the embed; click a cell to edit.
//
// Master Save All is rendered by the parent (UpdateDjProfileClient) at
// the bottom of the page; this tab reports its dirty state up via
// onDirtyChange so the master button knows when to enable.

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './updateDjProfile.module.css';
import {
  type BookingSettings,
  type BookingDays,
} from '@/app/(main)/[slug]/bookingSettings';
import ClubOwnerCalendar from './ClubOwnerCalendar';
import EmbedCodeSection from './EmbedCodeSection';

// Currency options matching vanilla's <select> dropdown
const CURRENCIES: { code: string; symbol: string; label: string }[] = [
  { code: 'USD', symbol: '$', label: 'USD ($)' },
  { code: 'EUR', symbol: '€', label: 'EUR (€)' },
  { code: 'GBP', symbol: '£', label: 'GBP (£)' },
  { code: 'CAD', symbol: '$', label: 'CAD ($)' },
  { code: 'AUD', symbol: '$', label: 'AUD ($)' },
  { code: 'JPY', symbol: '¥', label: 'JPY (¥)' },
  { code: 'KRW', symbol: '₩', label: 'KRW (₩)' },
  { code: 'CNY', symbol: '¥', label: 'CNY (¥)' },
  { code: 'INR', symbol: '₹', label: 'INR (₹)' },
  { code: 'BRL', symbol: 'R$', label: 'BRL (R$)' },
  { code: 'MXN', symbol: '$', label: 'MXN ($)' },
];

interface Props {
  bookingSettings: BookingSettings;
  onChange: (next: BookingSettings) => void;
  autosaveStatus: 'idle' | 'saving' | 'saved' | 'error';
  // DJ's URL slug — needed for the EmbedCodeSection so the iframe URL
  // points at this profile. Read live from general.slug in the parent
  // so the embed snippet updates as the user edits the slug.
  djSlug: string;
  // Aggregate dirty signal — true whenever the manual-save Rates section
  // has unsaved drafts. Bubbles up to UpdateDjProfileClient which combines
  // it with general-fields-dirty + mobile-package-drafts-dirty for the
  // page-leave warning.
  onDirtyChange?: (dirty: boolean) => void;
  // Trigger from the master Save All button — bumps when user clicks it.
  // The Rates section listens via useEffect and saves itself if dirty.
  masterSaveTrigger: number;
}

export default function ClubBookingTab({
  bookingSettings, onChange, autosaveStatus, djSlug, onDirtyChange, masterSaveTrigger,
}: Props) {
  // Patch helper — preserves other fields in booking_settings
  function patch(p: Partial<BookingSettings>) {
    onChange({ ...bookingSettings, ...p });
  }

  // ── Per-section last-changed tracking (for inline saved hints) ──
  const [lastChangedField, setLastChangedField] = useState<string | null>(null);

  // ── Equipment section (autosave) ──────────────────────────────────
  const equipFull = !!bookingSettings.equip_full;
  const equipFullDetail = bookingSettings.equip_full_detail || '';
  const equipDecks = !!bookingSettings.equip_decks;
  const equipDecksDetail = bookingSettings.equip_decks_detail || '';
  const equipNone = !!bookingSettings.equip_none;
  const hasEquipSelected = equipFull || equipDecks || equipNone;

  // Mutually-exclusive selection — pick one, clear the others.
  function selectEquip(which: 'full' | 'decks' | 'none') {
    setLastChangedField('equipment');
    patch({
      equip_full: which === 'full',
      equip_decks: which === 'decks',
      equip_none: which === 'none',
      // Clear stale detail when switching away
      equip_full_detail: which === 'full' ? equipFullDetail : '',
      equip_decks_detail: which === 'decks' ? equipDecksDetail : '',
    });
  }
  function setEquipFullDetail(v: string) {
    setLastChangedField('equipment');
    patch({ equip_full_detail: v });
  }
  function setEquipDecksDetail(v: string) {
    setLastChangedField('equipment');
    patch({ equip_decks_detail: v });
  }

  // ── Rates section (MANUAL save) ────────────────────────────────────
  // Local draft state keyed off the saved values. Edits update drafts
  // only; nothing flows back to bookingSettings until Save is clicked.
  // Dirty = drafts !== saved.
  type RatesDraft = {
    global_rate_type: 'flat' | 'hourly' | 'offers';
    rate_currency: string;
    base_rate: string;
    rate_with_system: string;
    rate_with_decks: string;
    rate_no_equip: string;
  };

  function snapshotRates(bs: BookingSettings): RatesDraft {
    const t = bs.global_rate_type;
    const rateType: 'flat' | 'hourly' | 'offers' =
      t === 'hourly' ? 'hourly' : t === 'offers' ? 'offers' : 'flat';
    return {
      global_rate_type: rateType,
      rate_currency: bs.rate_currency || 'USD',
      base_rate: bs.base_rate != null ? String(bs.base_rate) : '',
      rate_with_system: bs.rate_with_system != null ? String(bs.rate_with_system) : '',
      rate_with_decks: bs.rate_with_decks != null ? String(bs.rate_with_decks) : '',
      rate_no_equip: bs.rate_no_equip != null ? String(bs.rate_no_equip) : '',
    };
  }

  const [ratesDraft, setRatesDraft] = useState<RatesDraft>(() => snapshotRates(bookingSettings));
  const [ratesSaveStatus, setRatesSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  const ratesDirty = useMemo(() => {
    const saved = snapshotRates(bookingSettings);
    return JSON.stringify(saved) !== JSON.stringify(ratesDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ratesDraft,
    // Spell out the saved dependencies so this recalcs when the parent
    // updates booking_settings (e.g. after a save commit)
    bookingSettings.global_rate_type,
    bookingSettings.rate_currency,
    bookingSettings.base_rate,
    bookingSettings.rate_with_system,
    bookingSettings.rate_with_decks,
    bookingSettings.rate_no_equip,
  ]);

  // Bubble dirty state up to parent (powers the page-leave warning AND
  // the master Save All button's enable state).
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  useEffect(() => {
    onDirtyChangeRef.current?.(ratesDirty);
  }, [ratesDirty]);

  function commitRates() {
    setLastChangedField('rates');
    patch({
      global_rate_type: ratesDraft.global_rate_type,
      allow_offers: ratesDraft.global_rate_type === 'offers',
      rate_currency: ratesDraft.rate_currency,
      base_rate: ratesDraft.base_rate,
      rate_with_system: ratesDraft.rate_with_system,
      rate_with_decks: ratesDraft.rate_with_decks,
      rate_no_equip: ratesDraft.rate_no_equip,
    });
    setRatesSaveStatus('saved');
    setTimeout(() => {
      setRatesSaveStatus((cur) => (cur === 'saved' ? 'idle' : cur));
    }, 5000);
  }

  // Master save trigger — when bumped, attempt a rates save if dirty.
  // We don't need to save anything else here (equipment + calendar
  // already autosave; clicking Save All is just a no-op for them, which
  // is fine).
  const lastTriggerRef = useRef(masterSaveTrigger);
  useEffect(() => {
    if (masterSaveTrigger === 0) return;
    if (masterSaveTrigger === lastTriggerRef.current) return;
    lastTriggerRef.current = masterSaveTrigger;
    if (ratesDirty) commitRates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterSaveTrigger]);

  function setRateField(field: keyof RatesDraft, value: string) {
    setRatesDraft((prev) => ({ ...prev, [field]: value }));
    if (ratesSaveStatus !== 'idle') setRatesSaveStatus('idle');
  }

  // ── Calendar section (autosave) ───────────────────────────────────
  const bookingDays = bookingSettings.booking_days || {};
  const bookingWindow = bookingSettings.booking_window_months || 12;
  function setBookingDays(next: BookingDays) {
    // Don't tag a section here; ClubOwnerCalendar fires onMonthChanged
    // with a more specific month-level key.
    patch({ booking_days: next });
  }
  function setBookingWindow(v: number) {
    setLastChangedField('window');
    patch({ booking_window_months: v });
  }

  // Currency symbol helper (used for the rate field prefix)
  const currentCurrency = useMemo(() => {
    return CURRENCIES.find((c) => c.code === ratesDraft.rate_currency) || CURRENCIES[0];
  }, [ratesDraft.rate_currency]);

  return (
    <div>
      {/* ── Equipment section ─────────────────────────────────────── */}
      <div className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Equipment</div>
        </div>
        <div className={styles.sectionBody}>
          <p className={styles.bodyHint}>
            What equipment do you bring to gigs? Pick one — your rates
            below are tied to this selection.
          </p>

          <div className={styles.equipOptions}>
            <label className={styles.equipOption}>
              <input
                type="radio"
                name="club-equip"
                checked={equipFull}
                onChange={() => selectEquip('full')}
              />
              <div className={styles.equipOptionBody}>
                <div className={styles.equipOptionTitle}>
                  I provide Sound System &amp; Decks/Controller
                </div>
                {equipFull && (
                  <input
                    type="text"
                    value={equipFullDetail}
                    onChange={(e) => setEquipFullDetail(e.target.value)}
                    placeholder="List your system (e.g. QSC K12.2, Pioneer CDJ-3000)"
                    className={styles.equipDetailInput}
                  />
                )}
              </div>
            </label>

            <label className={styles.equipOption}>
              <input
                type="radio"
                name="club-equip"
                checked={equipDecks}
                onChange={() => selectEquip('decks')}
              />
              <div className={styles.equipOptionBody}>
                <div className={styles.equipOptionTitle}>
                  I provide Decks/Controller only
                </div>
                {equipDecks && (
                  <input
                    type="text"
                    value={equipDecksDetail}
                    onChange={(e) => setEquipDecksDetail(e.target.value)}
                    placeholder="List your decks (e.g. Pioneer DDJ-1000)"
                    className={styles.equipDetailInput}
                  />
                )}
              </div>
            </label>

            <label className={styles.equipOption}>
              <input
                type="radio"
                name="club-equip"
                checked={equipNone}
                onChange={() => selectEquip('none')}
              />
              <div className={styles.equipOptionBody}>
                <div className={styles.equipOptionTitle}>
                  I require all equipment provided by venue
                </div>
              </div>
            </label>
          </div>

          <SectionHint
            fieldKey="equipment"
            lastChangedField={lastChangedField}
            autosaveStatus={autosaveStatus}
          />
        </div>
      </div>

      {/* ── Rates section (MANUAL save) ───────────────────────────── */}
      <div className={styles.sectionCard}>
        <div className={styles.sectionHeader} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem' }}>
          <div className={styles.sectionTitle}>Rates</div>
          {/* Currency picker — top-right of section header. Hidden for
              the Offers rate type since offers don't have a fixed price.
              Hidden until equipment is selected (rates are gated on it). */}
          {hasEquipSelected && ratesDraft.global_rate_type !== 'offers' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem' }}>
              <label
                style={{
                  fontFamily: "'Space Mono', monospace",
                  fontSize: '.6rem',
                  letterSpacing: '.07em',
                  textTransform: 'uppercase',
                  color: 'var(--muted)',
                }}
              >
                Currency
              </label>
              <select
                value={ratesDraft.rate_currency}
                onChange={(e) => setRateField('rate_currency', e.target.value)}
                className={styles.rateSelect}
                style={{ width: 'auto', minWidth: 110 }}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className={styles.sectionBody}>
          {!hasEquipSelected ? (
            <p className={styles.bodyHint}>
              Pick your equipment selection above before setting rates.
            </p>
          ) : (
            <>
              <p className={styles.bodyHint}>
                These are your default rates. You can override on a
                per-day basis from the calendar.
              </p>

              {/* Rate type pill toggle */}
              <div className={styles.rateTypeRow}>
                <div className={styles.rateTypeLabel}>Rate Type</div>
                <div className={styles.rateTypePillGroup}>
                  {(['flat', 'hourly', 'offers'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setRateField('global_rate_type', t)}
                      className={`${styles.rateTypePill} ${
                        ratesDraft.global_rate_type === t ? styles.rateTypePillActive : ''
                      }`}
                    >
                      {t === 'flat' ? 'Flat Rate' : t === 'hourly' ? 'Hourly' : 'Offers'}
                    </button>
                  ))}
                </div>
              </div>

              {ratesDraft.global_rate_type === 'offers' && (
                <p className={styles.rateOffersHint}>
                  Offers can be countered and negotiated through the platform.
                </p>
              )}

              {/* Per-equipment rate fields. Which fields show depends on
                  the equipment selection above:
                  - equip_full → can charge "with system" OR "with decks"
                  - equip_decks → can charge "with decks" only
                  - equip_none → only the "no-equip" rate (DJ shows up
                                 with nothing). */}
              {ratesDraft.global_rate_type !== 'offers' && equipFull && (
                <>
                  <RateInput
                    label={`Rate with Sound System & Decks/Controller${ratesDraft.global_rate_type === 'hourly' ? ' (per hour)' : ''}`}
                    symbol={currentCurrency.symbol}
                    value={ratesDraft.rate_with_system}
                    onChange={(v) => setRateField('rate_with_system', v)}
                  />
                  <RateInput
                    label={`Rate with Decks/Controller only${ratesDraft.global_rate_type === 'hourly' ? ' (per hour)' : ''}`}
                    symbol={currentCurrency.symbol}
                    value={ratesDraft.rate_with_decks}
                    onChange={(v) => setRateField('rate_with_decks', v)}
                  />
                </>
              )}
              {ratesDraft.global_rate_type !== 'offers' && equipDecks && (
                <RateInput
                  label={`Rate${ratesDraft.global_rate_type === 'hourly' ? ' (per hour)' : ''}`}
                  symbol={currentCurrency.symbol}
                  value={ratesDraft.rate_with_decks}
                  onChange={(v) => setRateField('rate_with_decks', v)}
                />
              )}
              {ratesDraft.global_rate_type !== 'offers' && equipNone && (
                <RateInput
                  label={`Rate${ratesDraft.global_rate_type === 'hourly' ? ' (per hour)' : ''}`}
                  symbol={currentCurrency.symbol}
                  value={ratesDraft.rate_no_equip}
                  onChange={(v) => setRateField('rate_no_equip', v)}
                />
              )}

              {/* Save row — manual save button + status. Disabled when
                  nothing's dirty so the user knows they're up to date. */}
              <div className={styles.rateSaveRow}>
                <div className={styles.rateSaveStatus}>
                  {ratesSaveStatus === 'saved' ? (
                    <span style={{ color: 'var(--neon)' }}>✓ Saved</span>
                  ) : ratesDirty ? (
                    <span style={{ color: 'var(--amber)' }}>● Unsaved changes</span>
                  ) : (
                    <span style={{ color: 'var(--muted)' }}>✓ All saved</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={commitRates}
                  disabled={!ratesDirty}
                  className={`${styles.rateSaveBtn} ${ratesDirty ? styles.rateSaveBtnEnabled : ''}`}
                >
                  Save Rates
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Availability calendar (autosave) ──────────────────────── */}
      <div className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Availability Calendar</div>
        </div>
        <div className={styles.sectionBody}>
          {/* Booking window selector */}
          <div className={styles.settingRow}>
            <div className={styles.settingLabelWrap}>
              <div className={styles.settingLabel}>How far in advance can someone book?</div>
            </div>
            <select
              value={bookingWindow}
              onChange={(e) => setBookingWindow(parseInt(e.target.value, 10))}
              className={styles.settingSelect}
            >
              {[3, 6, 9, 12, 18, 24, 36].map((m) => (
                <option key={m} value={m}>{m} months</option>
              ))}
            </select>
          </div>

          <p className={styles.bodyHint}>
            All days are available by default. Use{' '}
            <strong style={{ color: 'rgba(255,255,255,.4)' }}>✕</strong> to mark unavailable,{' '}
            <strong style={{ color: 'var(--neon)' }}>✓</strong> to restore, or{' '}
            <strong>✏️</strong> to add an event / customize.
          </p>

          <ClubOwnerCalendar
            bookingDays={bookingDays}
            onChange={setBookingDays}
            bookingWindowMonths={bookingWindow}
            lastChangedField={lastChangedField}
            autosaveStatus={autosaveStatus}
            onMonthChanged={(monthKey) => setLastChangedField(monthKey)}
          />
        </div>
      </div>

      {/* ── Embed Code ──────────────────────────────────────── */}
      <EmbedCodeSection slug={djSlug} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SectionHint — same inline indicator pattern used elsewhere on this tab.
// ─────────────────────────────────────────────────────────────────────────
function SectionHint({
  fieldKey, lastChangedField, autosaveStatus,
}: {
  fieldKey: string;
  lastChangedField: string | null;
  autosaveStatus: 'idle' | 'saving' | 'saved' | 'error';
}) {
  if (lastChangedField !== fieldKey) return null;
  if (autosaveStatus === 'idle') return null;

  const text = autosaveStatus === 'saving' ? 'Saving…'
    : autosaveStatus === 'saved' ? '✓ Saved'
    : '✗ Failed';
  const color = autosaveStatus === 'saving' ? 'var(--muted)'
    : autosaveStatus === 'saved' ? 'var(--neon)'
    : '#ff5f5f';

  return (
    <div style={{
      minHeight: 18,
      display: 'flex',
      justifyContent: 'flex-end',
      alignItems: 'center',
      paddingTop: '.6rem',
      marginTop: '.4rem',
      borderTop: '1px solid var(--border)',
    }}>
      <span style={{
        fontFamily: "'Space Mono', monospace",
        fontSize: '.6rem',
        letterSpacing: '.05em',
        color,
        whiteSpace: 'nowrap',
      }}>{text}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// RateInput — labelled currency-symbol-prefixed numeric input for a rate.
// ─────────────────────────────────────────────────────────────────────────
function RateInput({
  label, symbol, value, onChange,
}: {
  label: string;
  symbol: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className={styles.rateFieldGroup}>
      <label className={styles.rateFieldLabel}>{label}</label>
      <div className={styles.rateInputWrap}>
        <span className={styles.rateSymbol}>{symbol}</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          className={styles.rateInput}
        />
      </div>
    </div>
  );
}
