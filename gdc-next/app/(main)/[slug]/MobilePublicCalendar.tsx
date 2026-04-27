'use client';

// MobilePublicCalendar — Booking tab for mobile DJ profiles with booking enabled.
// Faithful port of vanilla djp-mob-public.js (calendar parts only — booking
// form is deferred to a later session).
//
// Two views:
//   1. Single-month grid (default) — matches club calendar but with smaller
//      "Book" badge and event-name display in booked cells.
//   2. Rolling N-month grid — shows full booking-window worth of months
//      (mobile DJs can have windows up to 36+ months unlike club's 12).
//
// Key behavioral differences from club calendar (PublicCalendar.tsx):
//   - Uses mob_booking_days (different field), MobileDayData shape (with
//     bookings_available capacity tracking)
//   - "Full" state when remaining capacity hits zero — treated as unavail-ish
//     (gray, no Book button) but a different cause from explicit unavailability
//   - No events-this-month list — mobile DJs don't expose their booking roster
//   - Default booking window 24 months (vs 12 for club)
//   - Tab is labeled "Booking" not "Availability"
//
// Booking form opening is DEFERRED to a later session. Clicking an available
// date currently shows an alert. Same placeholder pattern as Session 4.

import { useEffect, useMemo, useState } from 'react';
import styles from './mobileCalendar.module.css';
import {
  type MobileBookingDays,
  type MobileDayData,
  windowLabel,
} from './bookingSettings';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_NAMES_SHORT = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];
const DAY_LABEL_LONG = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LABEL_MINI = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface Props {
  bookingDays: MobileBookingDays;
  bookingWindowMonths: number;     // default 24 for mobile DJs
  defaultBookingsPerDay: number;   // default 1 — used when a day has no override
  djSlug: string;
  djName: string;
  isLoggedIn: boolean;
  // Currently-selected date (YYYY-MM-DD). Will be driven by the booking
  // form when it lives below this calendar — null for now since the form
  // is deferred.
  selectedDate?: string | null;
  // Called when the user clicks "Book" on an available cell. Currently
  // shows a placeholder alert; later session will open the form.
  onBookDate?: (dateKey: string) => void;
  onLoggedOutBookAttempt?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers — pure, stateless
// ─────────────────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

function calcMaxYM(windowMonths: number): { year: number; month: number } {
  const t = new Date();
  const totalMonths = t.getFullYear() * 12 + t.getMonth() + (windowMonths || 24);
  return { year: Math.floor(totalMonths / 12), month: totalMonths % 12 };
}

function calcMinYM(): { year: number; month: number } {
  const t = new Date();
  return { year: t.getFullYear(), month: t.getMonth() };
}

function isInRange(y: number, m: number, windowMonths: number): boolean {
  const min = calcMinYM();
  const max = calcMaxYM(windowMonths);
  const v = y * 12 + m;
  return v >= (min.year * 12 + min.month) && v <= (max.year * 12 + max.month);
}

// ─────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────

export default function MobilePublicCalendar({
  bookingDays,
  bookingWindowMonths,
  defaultBookingsPerDay,
  djName,
  djSlug,
  isLoggedIn,
  selectedDate = null,
  onBookDate,
  onLoggedOutBookAttempt,
}: Props) {
  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [rollingActive, setRollingActive] = useState(false);
  const [rangeMsg, setRangeMsg] = useState<string | null>(null);

  // Auto-dismiss the range message after 4s, matching club calendar parity.
  useEffect(() => {
    if (!rangeMsg) return;
    const t = setTimeout(() => setRangeMsg(null), 4000);
    return () => clearTimeout(t);
  }, [rangeMsg]);

  // ── Navigation ───────────────────────────────────────────────────
  function showRangeMsg() {
    const who = djName || djSlug || 'This DJ';
    setRangeMsg(
      `${who} only accepts bookings up to ${windowLabel(bookingWindowMonths)} in advance.`
    );
  }

  function nav(dir: 1 | -1) {
    let newM = month + dir;
    let newY = year;
    if (newM > 11) { newM = 0; newY += 1; }
    if (newM < 0)  { newM = 11; newY -= 1; }
    if (!isInRange(newY, newM, bookingWindowMonths)) {
      if (dir > 0) showRangeMsg();
      return;
    }
    setYear(newY);
    setMonth(newM);
  }

  function jumpToMonth(m: number) {
    if (!isInRange(year, m, bookingWindowMonths)) {
      const min = calcMinYM();
      const max = calcMaxYM(bookingWindowMonths);
      const v = year * 12 + m;
      const minV = min.year * 12 + min.month;
      const maxV = max.year * 12 + max.month;
      const clamped = Math.max(minV, Math.min(maxV, v));
      setYear(Math.floor(clamped / 12));
      setMonth(clamped % 12);
      showRangeMsg();
      return;
    }
    setMonth(m);
  }

  function jumpToYear(y: number) {
    if (!isInRange(y, month, bookingWindowMonths)) {
      const min = calcMinYM();
      const max = calcMaxYM(bookingWindowMonths);
      const v = y * 12 + month;
      const minV = min.year * 12 + min.month;
      const maxV = max.year * 12 + max.month;
      const clamped = Math.max(minV, Math.min(maxV, v));
      setYear(Math.floor(clamped / 12));
      setMonth(clamped % 12);
      showRangeMsg();
      return;
    }
    setYear(y);
  }

  function handleBookClick(key: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!isLoggedIn) {
      if (onLoggedOutBookAttempt) {
        onLoggedOutBookAttempt();
      } else {
        // Placeholder — gate modal comes in a later session.
        alert('Please log in to book this DJ.');
      }
      return;
    }
    if (onBookDate) {
      onBookDate(key);
    } else {
      // Placeholder — booking form comes in a later session.
      alert(`Booking form coming soon. Selected: ${key}`);
    }
  }

  // ── Bounds for prev/next ─────────────────────────────────────────
  const min = calcMinYM();
  const max = calcMaxYM(bookingWindowMonths);
  const cur = year * 12 + month;
  const atMin = cur <= (min.year * 12 + min.month);
  const atMax = cur >= (max.year * 12 + max.month);

  // ── Year options for the dropdown ────────────────────────────────
  const yearOptions = useMemo(() => {
    const opts: number[] = [];
    for (let y = today.getFullYear(); y <= max.year; y++) opts.push(y);
    return opts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, bookingWindowMonths]);

  // ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {rangeMsg && <div className={styles.rangeMsg}>{rangeMsg}</div>}

      {/* TOP NAV ROW */}
      <div className={styles.navRow}>
        {!rollingActive && (
          <>
            <button
              type="button"
              className={styles.navBtn}
              onClick={() => nav(-1)}
              disabled={atMin}
              aria-label="Previous month"
            >
              ‹
            </button>
            <select
              className={`${styles.navSelect} ${styles.navSelectMonth}`}
              value={month}
              onChange={(e) => jumpToMonth(parseInt(e.target.value, 10))}
              aria-label="Month"
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={i} value={i}>{name}</option>
              ))}
            </select>
            <select
              className={`${styles.navSelect} ${styles.navSelectYear}`}
              value={year}
              onChange={(e) => jumpToYear(parseInt(e.target.value, 10))}
              aria-label="Year"
            >
              {yearOptions.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <button
              type="button"
              className={styles.navBtn}
              onClick={() => nav(1)}
              disabled={atMax}
              aria-label="Next month"
            >
              ›
            </button>
          </>
        )}
        <button
          type="button"
          className={`${styles.viewToggle} ${rollingActive ? styles.viewToggleActive : ''}`}
          onClick={() => setRollingActive(v => !v)}
          style={{ marginLeft: 'auto' }}
        >
          {rollingActive ? '← Month View' : '12 Months'}
        </button>
      </div>

      {/* SINGLE-MONTH VIEW */}
      {!rollingActive && (
        <SingleMonthView
          year={year}
          month={month}
          today={today}
          bookingDays={bookingDays}
          bookingWindowMonths={bookingWindowMonths}
          defaultBookingsPerDay={defaultBookingsPerDay}
          selectedDate={selectedDate}
          onBookClick={handleBookClick}
        />
      )}

      {/* ROLLING VIEW */}
      {rollingActive && (
        <RollingMonthsView
          today={today}
          bookingDays={bookingDays}
          bookingWindowMonths={bookingWindowMonths}
          defaultBookingsPerDay={defaultBookingsPerDay}
          selectedDate={selectedDate}
          onBookClick={handleBookClick}
        />
      )}

      {/* LEGEND */}
      <div className={styles.legend}>
        <div className={`${styles.legendItem} ${styles.legendAvail}`}>
          <span className={styles.legendDot} />Available
        </div>
        <div className={`${styles.legendItem} ${styles.legendBooked}`}>
          <span className={styles.legendDot} />Booked
        </div>
        <div className={`${styles.legendItem} ${styles.legendUnavail}`}>
          <span className={styles.legendDot} />Unavailable
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SingleMonthView
// ─────────────────────────────────────────────────────────────────────────

function SingleMonthView({
  year,
  month,
  today,
  bookingDays,
  bookingWindowMonths,
  defaultBookingsPerDay,
  selectedDate,
  onBookClick,
}: {
  year: number;
  month: number;
  today: Date;
  bookingDays: MobileBookingDays;
  bookingWindowMonths: number;
  defaultBookingsPerDay: number;
  selectedDate: string | null;
  onBookClick: (key: string, e: React.MouseEvent) => void;
}) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // The maximum date a visitor can book — today + bookingWindowMonths
  const maxDate = new Date(
    today.getFullYear(),
    today.getMonth() + bookingWindowMonths,
    today.getDate()
  );

  const cells: React.ReactNode[] = [];

  // Empty pre-cells
  for (let i = 0; i < firstDay; i++) {
    cells.push(<div key={`pre-${i}`} className={styles.emptyCell} />);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const key = dateKey(year, month, d);
    const dayData: MobileDayData = bookingDays[key] || {};
    const cellDate = new Date(year, month, d);
    const isPast = cellDate < todayMidnight;
    const isBeyond = cellDate > maxDate;
    const isToday =
      year === today.getFullYear() &&
      month === today.getMonth() &&
      d === today.getDate();
    const isBooked = !!dayData.booked;
    const isUnavail = !!dayData.unavailable;
    const bookingsLeft =
      dayData.bookings_available != null
        ? dayData.bookings_available
        : defaultBookingsPerDay;
    const isFull = !isBooked && !isUnavail && bookingsLeft <= 0;
    const isSelected = selectedDate === key;
    const isAvail = !isPast && !isBeyond && !isBooked && !isUnavail && !isFull;
    const isLastRow =
      Math.floor((firstDay + d - 1) / 7) ===
      Math.floor((firstDay + daysInMonth - 1) / 7);
    const isLastCol = (firstDay + d - 1) % 7 === 6;

    // Background — selected wins, then booked, then unavail/full, then today, then avail
    const cellClasses = [styles.cell];
    if (isLastRow && !isLastCol) cellClasses.push(styles.cellNoBottomBorder);
    if (isSelected) cellClasses.push(styles.cellSelected);
    else if (isBooked) cellClasses.push(styles.cellBooked);
    else if (isUnavail || isFull) cellClasses.push(styles.cellUnavail);
    else if (isToday) cellClasses.push(styles.cellToday);
    else if (isAvail) cellClasses.push(styles.cellAvail);

    // Day number color — note isPast/isBeyond muted, vanilla parity
    const numClasses = [styles.cellNum];
    if (isSelected) numClasses.push(styles.cellNumSelected);
    else if (isPast) numClasses.push(styles.cellNumPast);
    else if (isBeyond) numClasses.push(styles.cellNumBeyond);
    else if (isBooked) numClasses.push(styles.cellNumBooked);
    else if (isUnavail || isFull) numClasses.push(styles.cellNumFull);
    else if (isToday) numClasses.push(styles.cellNumToday);

    // Inner content
    let inner: React.ReactNode = null;
    if (isAvail) {
      inner = (
        <div
          className={styles.bookBadge}
          onClick={(e) => onBookClick(key, e)}
          role="button"
        >
          Book
        </div>
      );
    } else if (
      isBooked &&
      dayData.eventName &&
      dayData.location !== 'Private'
    ) {
      // Mobile DJ booked cells show event name (small, red) but NOT time
      // — matches vanilla djp-mob-public.js line 290.
      inner = (
        <div className={styles.bookedEventName}>{dayData.eventName}</div>
      );
    }

    cells.push(
      <div key={key} className={cellClasses.join(' ')}>
        <div className={numClasses.join(' ')}>{d}</div>
        {inner}
      </div>
    );
  }

  // Empty post-cells to fill the last row
  const totalCells = firstDay + daysInMonth;
  const remainder = totalCells % 7;
  if (remainder !== 0) {
    for (let i = remainder; i < 7; i++) {
      cells.push(<div key={`post-${i}`} className={styles.emptyCell} />);
    }
  }

  return (
    <div>
      <div className={styles.monthHeader}>
        {MONTH_NAMES[month]} {year}
      </div>

      <div className={styles.dayHeaderRow}>
        {DAY_LABEL_LONG.map((name) => (
          <div key={name} className={styles.dayHeader}>{name}</div>
        ))}
      </div>

      <div className={styles.cellsGrid}>{cells}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// RollingMonthsView — shows N months (full booking window)
// ─────────────────────────────────────────────────────────────────────────

function RollingMonthsView({
  today,
  bookingDays,
  bookingWindowMonths,
  defaultBookingsPerDay,
  selectedDate,
  onBookClick,
}: {
  today: Date;
  bookingDays: MobileBookingDays;
  bookingWindowMonths: number;
  defaultBookingsPerDay: number;
  selectedDate: string | null;
  onBookClick: (key: string, e: React.MouseEvent) => void;
}) {
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
  // Mobile DJ rolling view shows the FULL booking window (vanilla line 648
  // uses windowMonths directly, not capped at 12 like club). For wide
  // windows this can be a lot of months — that's intended.
  const monthsToRender = bookingWindowMonths || 12;

  const months: React.ReactNode[] = [];
  for (let i = 0; i < monthsToRender; i++) {
    let mo = today.getMonth() + i;
    let yr = today.getFullYear() + Math.floor(mo / 12);
    mo = mo % 12;
    const firstDay = new Date(yr, mo, 1).getDay();
    const daysInMonth = new Date(yr, mo + 1, 0).getDate();

    const cells: React.ReactNode[] = [];
    for (let b = 0; b < firstDay; b++) {
      cells.push(<div key={`pre-${i}-${b}`} />);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const key = dateKey(yr, mo, d);
      const dayData: MobileDayData = bookingDays[key] || {};
      const isPast = key < todayKey;
      const isBooked = !!dayData.booked;
      const isUnavail = !!dayData.unavailable;
      const bookingsLeft =
        dayData.bookings_available != null
          ? dayData.bookings_available
          : defaultBookingsPerDay;
      const isFull = !isBooked && !isUnavail && bookingsLeft <= 0;
      const isToday = key === todayKey;
      const isAvail = !isPast && !isBooked && !isUnavail && !isFull;
      const isSelected = selectedDate === key;

      const cellClasses = [styles.miniCell];
      if (isSelected) cellClasses.push(styles.miniCellAvail); // amber treatment skipped — vanilla doesn't highlight selected in mini
      else if (isBooked) cellClasses.push(styles.miniCellBooked);
      else if (isUnavail || isFull) cellClasses.push(styles.miniCellUnavail);
      else if (isAvail) cellClasses.push(styles.miniCellAvail);
      else if (isPast) cellClasses.push(styles.miniCellPast);
      if (isToday) cellClasses.push(styles.miniCellToday);
      if (isAvail) cellClasses.push(styles.miniCellPointer);

      cells.push(
        <div
          key={key}
          className={cellClasses.join(' ')}
          onClick={isAvail ? (e) => onBookClick(key, e) : undefined}
        >
          {d}
        </div>
      );
    }

    months.push(
      <div key={`m-${i}`} className={styles.monthCard}>
        <div className={styles.monthCardLabel}>
          {MONTH_NAMES_SHORT[mo]}{' '}
          <span className={styles.monthCardLabelYear}>{yr}</span>
        </div>
        <div className={styles.miniDayHeader}>
          {DAY_LABEL_MINI.map((d, idx) => (
            <div key={idx} className={styles.miniDayHeaderCell}>{d}</div>
          ))}
        </div>
        <div className={styles.miniGrid}>{cells}</div>
      </div>
    );
  }

  return <div className={styles.monthsGrid}>{months}</div>;
}
