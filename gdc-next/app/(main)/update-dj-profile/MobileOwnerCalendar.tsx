'use client';

// MobileOwnerCalendar — the owner's editable availability calendar for
// mobile DJs. Shows 3 months at a time (vanilla parity) with quick
// mark/unmark via the ✕/✓ buttons and a day editor modal via ✏️.
//
// Faithful port of udjp-booking-mobile.js renderMobCal + mobOpenDayEditor
// + mobSaveDayEditor + mobQuickMark.
//
// Calls onChange whenever bookingDays mutates so the parent component
// can persist (autosave).

import { useState } from 'react';
import styles from './updateDjProfile.module.css';
import type { MobileBookingDays, MobileDayData } from '@/app/(main)/[slug]/bookingSettings';

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAY_LABELS = ['S','M','T','W','T','F','S'];

interface Props {
  bookingDays: MobileBookingDays;
  onChange: (next: MobileBookingDays) => void;
  bookingWindowMonths: number;
  defaultBookingsPerDay: number;
  // Optional autosave hint props. When provided, renders a small "Saving…/
  // ✓ Saved" indicator under whichever month was most recently edited.
  // The parent tags lastChangedField with `calendar-YYYY-MM` whenever a
  // day is changed (we tell the parent which month via onMonthChanged).
  lastChangedField?: string | null;
  autosaveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  onMonthChanged?: (monthKey: string) => void;
}

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

// Format a month key (YYYY-MM) — used as the SavedHint fieldKey
function monthKeyFromYM(y: number, m: number): string {
  return `calendar-${y}-${String(m+1).padStart(2,'0')}`;
}

// Extract YYYY-MM-DD → calendar-YYYY-MM
function monthKeyFromDateKey(dKey: string): string {
  return `calendar-${dKey.slice(0, 7)}`;
}

export default function MobileOwnerCalendar({
  bookingDays, onChange, bookingWindowMonths, defaultBookingsPerDay,
  lastChangedField, autosaveStatus, onMonthChanged,
}: Props) {
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [editorKey, setEditorKey] = useState<string | null>(null);

  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const maxDate = new Date(today.getFullYear(), today.getMonth() + bookingWindowMonths, today.getDate());

  function nav(dir: number) {
    let m = calMonth + dir * 3;
    let y = calYear;
    while (m < 0) { m += 12; y--; }
    while (m > 11) { m -= 12; y++; }
    setCalMonth(m);
    setCalYear(y);
  }

  function quickMark(key: string) {
    const cur = bookingDays[key];
    if (cur && cur.booked) return; // can't toggle a booked day from the cell
    const next = { ...bookingDays };
    if (cur && cur.unavailable) {
      delete next[key];
    } else {
      next[key] = { unavailable: true };
    }
    onChange(next);
    onMonthChanged?.(monthKeyFromDateKey(key));
  }

  function saveDayEditor(key: string, newData: MobileDayData | null) {
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
    while (m > 11) { m -= 12; y++; }

    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    const cells: React.ReactNode[] = [];
    for (let i = 0; i < firstDay; i++) {
      cells.push(<div key={`pre-${offset}-${i}`} className={styles.calCellEmpty} />);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const key = dateKey(y, m, d);
      const dayData: MobileDayData = bookingDays[key] || {};
      const dateObj = new Date(y, m, d);
      const isPast = dateObj < todayMidnight;
      const isBeyond = dateObj > maxDate;
      const isBooked = !!dayData.booked;
      const isUnavail = !!dayData.unavailable;
      const bookingsLeft = dayData.bookings_available != null ? dayData.bookings_available : defaultBookingsPerDay;
      const isFull = !isBooked && !isUnavail && bookingsLeft <= 0;
      // A capacity-full day is shown as BOOKED (red), same as an explicitly
      // booked day. It can only be reopened by raising the accepted-bookings
      // count via the edit pencil — not the quick available/unavailable toggle.
      const showsAsBooked = isBooked || isFull;
      const isEdited = !isBooked && !isUnavail && bookingDays[key] && Object.keys(bookingDays[key]).length > 0;

      const cellCls = [styles.calCell];
      const numCls = [styles.calCellNum];
      if (isPast || isBeyond) {
        cellCls.push(styles.calCellPast);
        numCls.push(styles.calCellNumPast);
      } else if (showsAsBooked) {
        cellCls.push(styles.calCellBooked);
        numCls.push(styles.calCellNumBooked);
      } else if (isUnavail) {
        cellCls.push(styles.calCellUnavail);
        numCls.push(styles.calCellNumUnavail);
      }

      cells.push(
        <div key={key} className={cellCls.join(' ')}>
          <div className={numCls.join(' ')}>{d}</div>
          {!isPast && !isBeyond && (
            <>
              {!showsAsBooked && (
                <button
                  type="button"
                  onClick={() => quickMark(key)}
                  title={isUnavail ? 'Mark available' : 'Mark unavailable'}
                  className={`${styles.calCellQuickBtn} ${
                    isUnavail ? styles.calCellQuickBtnCheck : styles.calCellQuickBtnX
                  }`}
                >
                  {isUnavail ? '✓' : '✕'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditorKey(key)}
                title="Edit day"
                className={styles.calCellEditBtn}
              >
                ✏️
              </button>
              {isEdited && <span className={styles.calEditedDot}>edited</span>}
            </>
          )}
        </div>
      );
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
        {/* Save status hint under the month. Reserves a small fixed
            height so the layout doesn't jump as the hint comes/goes. */}
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
    <>
      <div className={styles.calNav}>
        <button type="button" className={styles.calNavBtn} onClick={() => nav(-1)}>‹ Prev</button>
        <div className={styles.calNavLabel}>Showing 3 months</div>
        <button type="button" className={styles.calNavBtn} onClick={() => nav(1)}>Next ›</button>
      </div>
      <div className={styles.calContainer}>{months}</div>
      <div className={styles.calLegendRow}>
        <div className={styles.calLegendItem}>
          <span style={{ color: 'rgba(255,255,255,.3)', fontWeight: 700 }}>✕</span> Mark unavailable
        </div>
        <div className={styles.calLegendItem}>
          <span style={{ color: 'var(--neon)', fontWeight: 700 }}>✓</span> Mark available
        </div>
        <div className={styles.calLegendItem}>
          <span>✏️</span> Edit day
        </div>
        <div className={styles.calLegendItem}>
          <span style={{
            background: 'rgba(255,95,95,.15)',
            border: '1px solid rgba(255,95,95,.3)',
            borderRadius: '3px',
            padding: '1px 4px',
            color: '#ff5f5f',
          }}>Booked</span> Booked
        </div>
      </div>

      {editorKey && (
        <DayEditorModal
          dateKey={editorKey}
          dayData={bookingDays[editorKey] || {}}
          onClose={() => setEditorKey(null)}
          onSave={(data) => saveDayEditor(editorKey, data)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// DayEditorModal — replaces the inline-rendered modal in vanilla.
// Mode radio (Available / Unavailable / Booked) reveals the right fields.
// ─────────────────────────────────────────────────────────────────────────

function DayEditorModal({
  dateKey,
  dayData,
  onClose,
  onSave,
}: {
  dateKey: string;
  dayData: MobileDayData;
  onClose: () => void;
  onSave: (data: MobileDayData | null) => void;
}) {
  type Mode = 'available' | 'unavailable' | 'booked';
  const initialMode: Mode = dayData.booked ? 'booked' : dayData.unavailable ? 'unavailable' : 'available';

  const [mode, setMode] = useState<Mode>(initialMode);
  // Signed % this date's price is nudged by (0 = normal price). Bounded to
  // -100 (free) … +500 so a fat-fingered value can't blow up the quote.
  const [adjustPct, setAdjustPct] = useState<number>(dayData.price_adjust_pct ?? 0);
  const clampPct = (n: number) => Math.max(-100, Math.min(500, n));
  const [eventName, setEventName] = useState(dayData.eventName || '');
  const [isPrivate, setIsPrivate] = useState(dayData.location === 'Private');
  const [location, setLocation] = useState(dayData.location !== 'Private' ? (dayData.location || '') : '');
  const [startTime, setStartTime] = useState(dayData.startTime || '');
  const [endTime, setEndTime] = useState(dayData.endTime || '');

  const [y, m, d] = dateKey.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const formattedDate = dateObj.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  // The − / + steppers next to the % input.
  const stepBtnStyle: React.CSSProperties = {
    width: 36, height: 36, flexShrink: 0,
    borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--deep)', color: 'var(--white)',
    fontSize: '1.2rem', lineHeight: 1, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  };

  function handleSave() {
    if (mode === 'unavailable') {
      onSave({ unavailable: true });
    } else if (mode === 'booked') {
      onSave({
        booked: true,
        eventName: eventName.trim(),
        location: isPrivate ? 'Private' : location.trim(),
        startTime,
        endTime,
      });
    } else {
      // available — MERGE, don't replace. This date may already carry a
      // bookings_available count that real approvals have decremented; editing
      // the price nudge here must not wipe it. Keep that field, set/clear the
      // %, and drop the whole entry only when nothing is left to store.
      const next: MobileDayData = {};
      if (dayData.bookings_available != null) next.bookings_available = dayData.bookings_available;
      if (adjustPct !== 0) next.price_adjust_pct = clampPct(adjustPct);
      onSave(Object.keys(next).length > 0 ? next : null);
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalInner} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>{formattedDate}</div>
          <button type="button" onClick={onClose} className={styles.modalCloseBtn}>✕</button>
        </div>

        <div className={styles.modalRadioGroup}>
          <label className={styles.modalRadioLabel}>
            <input
              type="radio"
              name="day-mode"
              checked={mode === 'available'}
              onChange={() => setMode('available')}
              style={{ accentColor: 'var(--neon)' }}
            />
            <span style={{ fontSize: '.85rem', color: 'var(--white)' }}>Available</span>
          </label>
          <label className={styles.modalRadioLabel}>
            <input
              type="radio"
              name="day-mode"
              checked={mode === 'unavailable'}
              onChange={() => setMode('unavailable')}
              style={{ accentColor: 'var(--muted)' }}
            />
            <span style={{ fontSize: '.85rem', color: 'var(--muted)' }}>Unavailable</span>
          </label>
          <label className={styles.modalRadioLabel}>
            <input
              type="radio"
              name="day-mode"
              checked={mode === 'booked'}
              onChange={() => setMode('booked')}
              style={{ accentColor: '#ff5f5f' }}
            />
            <span style={{ fontSize: '.85rem', color: '#ff5f5f' }}>Booked</span>
          </label>
        </div>

        {mode === 'available' && (
          <div className={styles.modalField}>
            <label className={`${styles.modalLabel} ${styles.modalLabelNeon}`}>
              Price for this day
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <button
                type="button"
                onClick={() => setAdjustPct((v) => clampPct(v - 5))}
                aria-label="Lower the price for this day"
                style={stepBtnStyle}
              >−</button>
              <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <input
                  type="number"
                  min={-100}
                  max={500}
                  step={5}
                  value={adjustPct}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setAdjustPct(Number.isFinite(n) ? clampPct(n) : 0);
                  }}
                  className={styles.modalNumberInput}
                  style={{ width: 90, textAlign: 'center', paddingRight: '1.4rem' }}
                />
                <span style={{ position: 'absolute', right: '.6rem', color: 'var(--muted)', fontSize: '.85rem', pointerEvents: 'none' }}>%</span>
              </span>
              <button
                type="button"
                onClick={() => setAdjustPct((v) => clampPct(v + 5))}
                aria-label="Raise the price for this day"
                style={stepBtnStyle}
              >+</button>
            </div>
            <span style={{ display: 'block', marginTop: '.45rem', fontSize: '.72rem', color: 'var(--muted)', lineHeight: 1.45 }}>
              {adjustPct === 0
                ? 'Charge more or less for a booking on this date. It’s folded silently into the price — the client never sees it as a discount or surcharge.'
                : `${adjustPct > 0 ? '+' : ''}${adjustPct}% — bookings on this date are quoted ${adjustPct > 0 ? 'higher' : 'lower'} than normal. The client just sees the adjusted price.`}
            </span>
          </div>
        )}

        {mode === 'booked' && (
          <>
            <div className={styles.modalField}>
              <label className={styles.modalLabel}>Event Name</label>
              <input
                type="text"
                placeholder="Wedding Reception, Birthday Party..."
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                className={styles.modalInput}
              />
            </div>
            <div className={styles.modalField}>
              <label
                className={styles.modalRadioLabel}
                style={{ marginBottom: '.35rem' }}
              >
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                  style={{ accentColor: 'var(--neon)' }}
                />
                <span
                  style={{
                    fontFamily: "'Space Mono', monospace",
                    fontSize: '.6rem',
                    letterSpacing: '.06em',
                    textTransform: 'uppercase',
                    color: 'var(--white)',
                  }}
                >
                  Private Location
                </span>
              </label>
              <input
                type="text"
                placeholder="Location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                disabled={isPrivate}
                className={styles.modalInput}
                style={isPrivate ? { opacity: 0.4 } : undefined}
              />
            </div>
            <div className={`${styles.modalField} ${styles.modalTimeRow}`}>
              <div>
                <label className={styles.modalLabel}>Start Time</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className={styles.modalInput}
                />
              </div>
              <div>
                <label className={styles.modalLabel}>End Time</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className={styles.modalInput}
                />
              </div>
            </div>
          </>
        )}

        <div className={styles.modalActions}>
          <button type="button" onClick={onClose} className={styles.modalCancelBtn}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} className={styles.modalSaveBtn}>
            Save Day
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// CalSavedHint — small inline indicator showing autosave state for a
// specific month. Renders nothing unless the parent's lastChangedField
// matches our fieldKey AND the autosave is in flight or recently
// finished. Mirrors the SavedHint component in BookingTab so each month
// gets its own contextual hint.
// ─────────────────────────────────────────────────────────────────────────
function CalSavedHint({
  fieldKey,
  lastChangedField,
  autosaveStatus,
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
    <span
      style={{
        fontFamily: "'Space Mono', monospace",
        fontSize: '.6rem',
        letterSpacing: '.05em',
        color,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );
}
