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
}

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

export default function MobileOwnerCalendar({
  bookingDays, onChange, bookingWindowMonths, defaultBookingsPerDay,
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
  }

  function saveDayEditor(key: string, newData: MobileDayData | null) {
    const next = { ...bookingDays };
    if (newData == null) {
      delete next[key];
    } else {
      next[key] = newData;
    }
    onChange(next);
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
      const isEdited = !isBooked && !isUnavail && bookingDays[key] && Object.keys(bookingDays[key]).length > 0;

      const cellCls = [styles.calCell];
      const numCls = [styles.calCellNum];
      if (isPast || isBeyond) {
        cellCls.push(styles.calCellPast);
        numCls.push(styles.calCellNumPast);
      } else if (isBooked) {
        cellCls.push(styles.calCellBooked);
        numCls.push(styles.calCellNumBooked);
      } else if (isUnavail) {
        cellCls.push(styles.calCellUnavail);
        numCls.push(styles.calCellNumUnavail);
      } else if (isFull) {
        cellCls.push(styles.calCellFull);
        numCls.push(styles.calCellNumFull);
      }

      cells.push(
        <div key={key} className={cellCls.join(' ')}>
          <div className={numCls.join(' ')}>{d}</div>
          {!isPast && !isBeyond && (
            <>
              {!isBooked && (
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
          defaultPerDay={defaultBookingsPerDay}
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
  defaultPerDay,
  onClose,
  onSave,
}: {
  dateKey: string;
  dayData: MobileDayData;
  defaultPerDay: number;
  onClose: () => void;
  onSave: (data: MobileDayData | null) => void;
}) {
  type Mode = 'available' | 'unavailable' | 'booked';
  const initialMode: Mode = dayData.booked ? 'booked' : dayData.unavailable ? 'unavailable' : 'available';

  const [mode, setMode] = useState<Mode>(initialMode);
  const [perDay, setPerDay] = useState<number>(
    dayData.bookings_available != null ? dayData.bookings_available : defaultPerDay
  );
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
      // available
      if (perDay <= 0) {
        onSave({ unavailable: true });
      } else if (perDay !== defaultPerDay) {
        onSave({ bookings_available: perDay });
      } else {
        onSave(null); // delete the entry — back to default
      }
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
              Bookings available this day
            </label>
            <input
              type="number"
              min={0}
              max={99}
              value={perDay}
              onChange={(e) => setPerDay(parseInt(e.target.value, 10) || 0)}
              className={styles.modalNumberInput}
            />
            <span style={{ fontSize: '.75rem', color: 'var(--muted)', marginLeft: '.5rem' }}>
              Set to 0 to mark as unavailable
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
