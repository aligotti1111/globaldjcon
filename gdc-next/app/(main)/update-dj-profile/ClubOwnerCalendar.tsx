'use client';

// ClubOwnerCalendar — owner-side availability calendar for CLUB DJs.
// Shows 3 months at a time (vanilla parity), each cell shows the day
// number + status indicator. Owner can mark a date Available /
// Unavailable / Booked via a small day-editor modal.
//
// This first cut is STATUS-ONLY. The full vanilla day editor includes
// per-day rate overrides (flat/hourly/offers + equipment-conditional
// rates), event name + venue address autocomplete, time pickers, and
// ticket URL. Those are deferred to a follow-up session.
//
// Visual style mirrors the embed calendar (same as MobileOwnerCalendar):
// individual rounded cells with gaps, neon hover, solid red booked,
// striped unavailable.

import { useEffect, useMemo, useState } from 'react';
import styles from './updateDjProfile.module.css';
import type { BookingDays, BookingSettings, DayData } from '@/app/(main)/[slug]/bookingSettings';

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAY_LABELS = ['S','M','T','W','T','F','S'];

interface Props {
  bookingDays: BookingDays;
  onChange: (next: BookingDays) => void;
  bookingWindowMonths: number;
  // Used by the day-edit modal to (a) decide which equipment-specific
  // rate inputs to show (mirror of universal rate panel logic) and
  // (b) format currency.
  bookingSettings: BookingSettings;
  currencySymbol: string;
  // Optional autosave hint props (mirror of MobileOwnerCalendar so the
  // parent's "Saving…/✓ Saved" indicator works the same way).
  lastChangedField?: string | null;
  autosaveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  onMonthChanged?: (monthKey: string) => void;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function dateKey(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}
function monthKeyFromYM(y: number, m: number): string {
  return `cal-club-${y}-${pad2(m + 1)}`;
}
function monthKeyFromDateKey(dKey: string): string {
  return `cal-club-${dKey.slice(0, 7)}`;
}

export default function ClubOwnerCalendar({
  bookingDays, onChange, bookingWindowMonths, bookingSettings, currencySymbol,
  lastChangedField, autosaveStatus, onMonthChanged,
}: Props) {
  const today = useMemo(() => new Date(), []);
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());

  const [editorKey, setEditorKey] = useState<string | null>(null);

  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const maxDate = new Date(today.getFullYear(), today.getMonth() + bookingWindowMonths, today.getDate());

  function nav(dir: 1 | -1) {
    let m = calMonth + dir * 3;
    let y = calYear;
    while (m < 0) { m += 12; y -= 1; }
    while (m > 11) { m -= 12; y += 1; }
    setCalYear(y);
    setCalMonth(m);
  }

  // Quick-mark cell: cycle Available → Unavailable → Available (matches
  // mobile owner calendar). Booked dates aren't togglable from the cell —
  // owner has to open the editor to clear an event.
  function quickToggleUnavail(key: string) {
    const cur = bookingDays[key];
    if (cur && cur.booked) return;
    const next = { ...bookingDays };
    if (cur && cur.unavailable) {
      delete next[key];
    } else {
      next[key] = { unavailable: true };
    }
    onChange(next);
    onMonthChanged?.(monthKeyFromDateKey(key));
  }

  function saveDayEditor(key: string, newData: DayData | null) {
    const next = { ...bookingDays };
    if (newData == null) {
      delete next[key];
    } else {
      next[key] = newData;
    }
    onChange(next);
    onMonthChanged?.(monthKeyFromDateKey(key));
    setEditorKey(null);
  }

  // Render 3 consecutive months
  const months: React.ReactNode[] = [];
  for (let offset = 0; offset < 3; offset++) {
    let y = calYear;
    let m = calMonth + offset;
    while (m > 11) { m -= 12; y += 1; }

    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells: React.ReactNode[] = [];

    for (let i = 0; i < firstDow; i++) {
      cells.push(<div key={`pre-${offset}-${i}`} className={styles.calCellEmpty} />);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const cellDate = new Date(y, m, d);
      const isPast = cellDate < todayMidnight;
      const isBeyond = cellDate > maxDate;
      const key = dateKey(y, m, d);
      const data: DayData = bookingDays[key] || {};
      const isBooked = !!data.booked;
      const isUnavail = !!data.unavailable;

      const cellCls = [styles.calCell];
      if (isPast) cellCls.push(styles.calCellPast);
      else if (isBeyond) cellCls.push(styles.calCellBeyond);
      else if (isBooked) cellCls.push(styles.calCellBooked);
      else if (isUnavail) cellCls.push(styles.calCellUnavail);

      const numCls = [styles.calCellNum];
      if (isPast) numCls.push(styles.calCellNumPast);
      else if (isBooked) numCls.push(styles.calCellNumBooked);
      else if (isUnavail) numCls.push(styles.calCellNumUnavail);

      cells.push(
        <div key={key} className={cellCls.join(' ')}>
          <div className={numCls.join(' ')}>{d}</div>
          {!isPast && !isBeyond && (
            <>
              {!isBooked && (
                <button
                  type="button"
                  onClick={() => quickToggleUnavail(key)}
                  className={`${styles.calCellQuickBtn} ${
                    isUnavail ? styles.calCellQuickBtnCheck : styles.calCellQuickBtnX
                  }`}
                  title={isUnavail ? 'Mark available' : 'Mark unavailable'}
                >
                  {isUnavail ? '✓' : '✕'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditorKey(key)}
                className={styles.calCellEditBtn}
                title="Edit day"
              >
                ✏️
              </button>
            </>
          )}
        </div>
      );
    }

    // Pad trailing
    const totalCells = firstDow + daysInMonth;
    const trailing = (7 - (totalCells % 7)) % 7;
    for (let i = 0; i < trailing; i++) {
      cells.push(<div key={`post-${offset}-${i}`} className={styles.calCellEmpty} />);
    }

    months.push(
      <div key={`m-${offset}`} className={styles.calMonthWrap}>
        <div className={styles.calMonthHeader}>{MONTHS[m]} {y}</div>
        <div className={styles.calLabelRow}>
          {DAY_LABELS.map((d, i) => (
            <div key={i} className={styles.calLabel}>{d}</div>
          ))}
        </div>
        <div className={styles.calGrid}>{cells}</div>
        {/* Save status hint under the month — same pattern as mobile */}
        <div
          style={{
            minHeight: 18,
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            paddingTop: '.5rem',
          }}
        >
          <CalSavedHint
            fieldKey={monthKeyFromYM(y, m)}
            lastChangedField={lastChangedField || null}
            autosaveStatus={autosaveStatus || 'idle'}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.calNav}>
        <button type="button" className={styles.calNavBtn} onClick={() => nav(-1)}>‹ Prev</button>
        <div className={styles.calNavLabel}>Showing 3 months</div>
        <button type="button" className={styles.calNavBtn} onClick={() => nav(1)}>Next ›</button>
      </div>

      <div className={styles.calContainer}>{months}</div>

      {editorKey && (
        <ClubDayEditModal
          dateKey={editorKey}
          dayData={bookingDays[editorKey] || {}}
          bookingSettings={bookingSettings}
          currencySymbol={currencySymbol}
          onClose={() => setEditorKey(null)}
          onSave={(update) => saveDayEditor(editorKey, update)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// CalSavedHint — same as the one in MobileOwnerCalendar (kept inline so
// each calendar can change independently if needed).
// ─────────────────────────────────────────────────────────────────────────
function CalSavedHint({
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
    <span style={{
      fontFamily: "'Space Mono', monospace",
      fontSize: '.6rem',
      letterSpacing: '.05em',
      color,
      whiteSpace: 'nowrap',
    }}>{text}</span>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ClubDayEditModal — minimal day editor.
// First-cut features: status (Available / Unavailable / Booked), and if
// Booked, an event name field. Address autocomplete + time pickers + rate
// overrides come in a follow-up session.
// ─────────────────────────────────────────────────────────────────────────
function ClubDayEditModal({
  dateKey,
  dayData,
  bookingSettings,
  currencySymbol,
  onClose,
  onSave,
}: {
  dateKey: string;
  dayData: DayData;
  bookingSettings: BookingSettings;
  currencySymbol: string;
  onClose: () => void;
  onSave: (update: DayData | null) => void;
}) {
  const [status, setStatus] = useState<'available' | 'unavailable' | 'booked'>(
    dayData.booked ? 'booked' : dayData.unavailable ? 'unavailable' : 'available'
  );
  const [eventName, setEventName] = useState<string>(dayData.eventName || '');

  // ── Per-day rate override state ──────────────────────────────────
  // Initialised from existing day data; falls back to global rate type
  // so the editor opens to the same flat/hourly/offers context the DJ
  // uses universally. Each rate input has its own state so switching
  // rateType doesn't blow away the dormant set.
  const initialRateType: 'flat' | 'hourly' | 'offers' =
    (dayData.rateType as 'flat' | 'hourly' | 'offers' | undefined)
    || (bookingSettings.global_rate_type as 'flat' | 'hourly' | 'offers' | undefined)
    || 'flat';
  const [rateType, setRateType] = useState<'flat' | 'hourly' | 'offers'>(initialRateType);
  // Empty string when unset — same convention as universal rate panel.
  const initStr = (v: number | string | undefined): string =>
    v != null && v !== '' ? String(v) : '';
  const [rateWithSystem, setRateWithSystem] = useState(initStr(dayData.rate_with_system));
  const [rateWithDecks, setRateWithDecks] = useState(initStr(dayData.rate_with_decks));
  const [rateNoEquip, setRateNoEquip] = useState(initStr(dayData.rate_no_equip));
  const [rateHourlyWithSystem, setRateHourlyWithSystem] = useState(initStr(dayData.rate_hourly_with_system));
  const [rateHourlyWithDecks, setRateHourlyWithDecks] = useState(initStr(dayData.rate_hourly_with_decks));
  const [rateHourlyNoEquip, setRateHourlyNoEquip] = useState(initStr(dayData.rate_hourly_no_equip));

  // Equipment flags from the DJ's universal settings — controls which
  // rate inputs render. Higher equipment tier = more inputs (mirrors
  // the universal rate panel: equip_full = 3 inputs, equip_decks = 2,
  // equip_none = 1).
  const equipFull = !!bookingSettings.equip_full;
  const equipDecks = !!bookingSettings.equip_decks;
  const equipNone = !!bookingSettings.equip_none;

  // Format dateKey "2026-05-14" → "Thursday, May 14, 2026"
  const formatted = useMemo(() => {
    const [y, m, d] = dateKey.split('-').map(Number);
    if (!y || !m || !d) return dateKey;
    const dt = new Date(y, m - 1, d, 12, 0, 0);
    return dt.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
  }, [dateKey]);

  // Lock body scroll while modal open
  useEffect(() => {
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = orig; };
  }, []);

  function handleSave() {
    if (status === 'available') {
      // Build a partial DayData carrying only set rate fields. If nothing
      // is set, drop the day entry entirely (back to plain default).
      // Note: we keep BOTH rate sets (flat + hourly) when present, even
      // though only one is "active" via rateType — same behavior as the
      // universal rate panel where dormant values are retained.
      const next: DayData = {};
      const tFlat = (s: string) => s.trim() === '' ? undefined : s.trim();
      const flatSys = tFlat(rateWithSystem);
      const flatDecks = tFlat(rateWithDecks);
      const flatNone = tFlat(rateNoEquip);
      const hrSys = tFlat(rateHourlyWithSystem);
      const hrDecks = tFlat(rateHourlyWithDecks);
      const hrNone = tFlat(rateHourlyNoEquip);
      const anyRateSet = flatSys || flatDecks || flatNone || hrSys || hrDecks || hrNone || rateType !== initialRateType;
      if (!anyRateSet) {
        onSave(null);
        return;
      }
      next.rateType = rateType;
      if (flatSys) next.rate_with_system = flatSys;
      if (flatDecks) next.rate_with_decks = flatDecks;
      if (flatNone) next.rate_no_equip = flatNone;
      if (hrSys) next.rate_hourly_with_system = hrSys;
      if (hrDecks) next.rate_hourly_with_decks = hrDecks;
      if (hrNone) next.rate_hourly_no_equip = hrNone;
      onSave(next);
      return;
    }
    if (status === 'unavailable') {
      onSave({ unavailable: true });
      return;
    }
    // booked
    onSave({
      booked: true,
      eventName: eventName.trim() || undefined,
    });
  }

  return (
    <div className={styles.dayEditorBackdrop} onClick={onClose}>
      <div className={styles.dayEditorBox} onClick={(e) => e.stopPropagation()}>
        <div className={styles.dayEditorHeader}>
          <div className={styles.dayEditorDate}>{formatted}</div>
          <button type="button" onClick={onClose} className={styles.dayEditorClose}>✕</button>
        </div>

        <div className={styles.dayEditorStatusRow}>
          <label className={styles.dayEditorStatusLabel}>
            <input
              type="radio"
              name="day-status"
              checked={status === 'available'}
              onChange={() => setStatus('available')}
              style={{ accentColor: 'var(--neon)' }}
            />
            <span style={{ color: 'var(--white)' }}>Available</span>
          </label>
          <label className={styles.dayEditorStatusLabel}>
            <input
              type="radio"
              name="day-status"
              checked={status === 'unavailable'}
              onChange={() => setStatus('unavailable')}
              style={{ accentColor: 'var(--muted)' }}
            />
            <span style={{ color: 'var(--muted)' }}>Unavailable</span>
          </label>
          <label className={styles.dayEditorStatusLabel}>
            <input
              type="radio"
              name="day-status"
              checked={status === 'booked'}
              onChange={() => setStatus('booked')}
              style={{ accentColor: '#ff5f5f' }}
            />
            <span style={{ color: '#ff5f5f' }}>Booked (has event)</span>
          </label>
        </div>

        {/* ── Per-day rate override (Available status only) ─────────
            Mirror of the universal rate panel: rate-type tabs at top,
            then equipment-specific rate inputs based on what the DJ
            supports. Empty fields fall back to the universal rate;
            non-empty fields win. */}
        {status === 'available' && (
          <div className={styles.dayEditorBookedFields}>
            <div className={styles.dayEditorFieldGroup}>
              <label className={styles.dayEditorFieldLabel}>
                Rate Override (optional — leave blank to use your default rates)
              </label>
              {/* Rate type tabs */}
              <div style={{
                display: 'flex',
                gap: '.4rem',
                marginBottom: '.6rem',
                flexWrap: 'wrap',
              }}>
                {(['flat', 'hourly', 'offers'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setRateType(t)}
                    style={{
                      padding: '.35rem .8rem',
                      fontFamily: "'Space Mono', monospace",
                      fontSize: '.65rem',
                      letterSpacing: '.08em',
                      textTransform: 'uppercase',
                      borderRadius: 4,
                      border: '1px solid ' + (rateType === t ? 'var(--neon)' : 'var(--border)'),
                      background: rateType === t ? 'rgba(0,245,196,0.1)' : 'transparent',
                      color: rateType === t ? 'var(--neon)' : 'var(--muted)',
                      cursor: 'pointer',
                    }}
                  >
                    {t === 'flat' ? 'Flat' : t === 'hourly' ? 'Hourly' : 'Open Offers'}
                  </button>
                ))}
              </div>

              {/* Rate inputs — visible per equipment + rateType. Mirror
                  of universal rate panel: equip_full → 3 inputs,
                  equip_decks → 2, equip_none → 1. Offers mode → none. */}
              {rateType !== 'offers' && (() => {
                const isHourly = rateType === 'hourly';
                const suffix = isHourly ? ' (per hour)' : '';
                // Pick the active state pair for each equipment slot
                const sysVal = isHourly ? rateHourlyWithSystem : rateWithSystem;
                const sysSet = isHourly ? setRateHourlyWithSystem : setRateWithSystem;
                const decksVal = isHourly ? rateHourlyWithDecks : rateWithDecks;
                const decksSet = isHourly ? setRateHourlyWithDecks : setRateWithDecks;
                const noneVal = isHourly ? rateHourlyNoEquip : rateNoEquip;
                const noneSet = isHourly ? setRateHourlyNoEquip : setRateNoEquip;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                    {equipFull && (
                      <>
                        <DayRateInput
                          label={`Sound System & Decks/Controller${suffix}`}
                          symbol={currencySymbol}
                          value={sysVal}
                          onChange={sysSet}
                        />
                        <DayRateInput
                          label={`Decks/Controller only${suffix}`}
                          symbol={currencySymbol}
                          value={decksVal}
                          onChange={decksSet}
                        />
                        <DayRateInput
                          label={`Venue provides all equipment${suffix}`}
                          symbol={currencySymbol}
                          value={noneVal}
                          onChange={noneSet}
                        />
                      </>
                    )}
                    {equipDecks && (
                      <>
                        <DayRateInput
                          label={`Decks/Controller only${suffix}`}
                          symbol={currencySymbol}
                          value={decksVal}
                          onChange={decksSet}
                        />
                        <DayRateInput
                          label={`Venue provides all equipment${suffix}`}
                          symbol={currencySymbol}
                          value={noneVal}
                          onChange={noneSet}
                        />
                      </>
                    )}
                    {equipNone && (
                      <DayRateInput
                        label={`Venue provides all equipment${suffix}`}
                        symbol={currencySymbol}
                        value={noneVal}
                        onChange={noneSet}
                      />
                    )}
                  </div>
                );
              })()}
              {rateType === 'offers' && (
                <p style={{
                  margin: '0',
                  color: 'var(--muted)',
                  fontSize: '.8rem',
                  lineHeight: 1.5,
                }}>
                  This day will accept open offers from bookers — no rate
                  shown publicly. Bookers submit what they want to pay.
                </p>
              )}
            </div>
          </div>
        )}

        {status === 'booked' && (
          <div className={styles.dayEditorBookedFields}>
            <div className={styles.dayEditorFieldGroup}>
              <label className={styles.dayEditorFieldLabel}>Event / Venue Name</label>
              <input
                type="text"
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                placeholder="e.g. Saturday Night Live"
                className={styles.dayEditorInput}
              />
            </div>
            <p className={styles.dayEditorComingSoon}>
              Address, times, ticket URL, and per-day rate overrides
              coming in a future update.
            </p>
          </div>
        )}

        <div className={styles.dayEditorActions}>
          <button type="button" onClick={onClose} className={styles.dayEditorCancelBtn}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} className={styles.dayEditorSaveBtn}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// DayRateInput — small currency-prefixed number input for the per-day
// rate override panel. Mirrors the universal RateInput pattern in
// ClubBookingTab so rates are visually consistent in both places.
// ─────────────────────────────────────────────────────────────────────────
function DayRateInput({
  label, symbol, value, onChange,
}: {
  label: string;
  symbol: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label
        style={{
          display: 'block',
          fontFamily: "'Space Mono', monospace",
          fontSize: '.65rem',
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
          marginBottom: '.25rem',
        }}
      >
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <span style={{
          position: 'absolute',
          left: 10,
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--muted)',
          pointerEvents: 'none',
          fontSize: '.9rem',
        }}>{symbol}</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          placeholder="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={styles.dayEditorInput}
          style={{ paddingLeft: 28 }}
        />
      </div>
    </div>
  );
}
