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
import type { BookingDays, DayData } from '@/app/(main)/[slug]/bookingSettings';

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAY_LABELS = ['S','M','T','W','T','F','S'];

interface Props {
  bookingDays: BookingDays;
  onChange: (next: BookingDays) => void;
  bookingWindowMonths: number;
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
  bookingDays, onChange, bookingWindowMonths,
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
  onClose,
  onSave,
}: {
  dateKey: string;
  dayData: DayData;
  onClose: () => void;
  onSave: (update: DayData | null) => void;
}) {
  const [status, setStatus] = useState<'available' | 'unavailable' | 'booked'>(
    dayData.booked ? 'booked' : dayData.unavailable ? 'unavailable' : 'available'
  );
  const [eventName, setEventName] = useState<string>(dayData.eventName || '');

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
      // Reset day to default → drop the entry entirely
      onSave(null);
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
