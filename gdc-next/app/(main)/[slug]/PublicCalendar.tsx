'use client';

// PublicCalendar — Availability tab for club DJ profiles with booking enabled.
// Faithful port of vanilla djp-cal-public.js (500 lines).
//
// Two views:
//   1. Month grid (default) — single month with prev/next nav, month/year
//      selectors, and a "Book Now" badge in open cells.
//   2. Rolling 12-month grid — overview of all months in the booking window.
//      Cells are smaller, show only colored squares + day number.
//
// User can toggle between the two via the right-aligned toggle button.
//
// Booking-flow integration is DEFERRED to Session 5:
//   - Clicking "Book Now" in an open cell currently shows an alert.
//     Vanilla calls ib_openForInline() (logged in) or showBookingGate()
//     (logged out). Both depend on the booking-form work.
//   - The selected-date highlight (amber) won't fire because nothing is
//     setting `selectedDate` yet; the prop exists to wire up cleanly later.

import { useEffect, useMemo, useState } from 'react';
import styles from './calendar.module.css';
import {
  type BookingDays,
  type DayData,
  cleanLocation,
  formatTime12,
  windowLabel,
} from './bookingSettings';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_LABEL_LONG = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LABEL_MINI = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface Props {
  bookingDays: BookingDays;
  bookingWindowMonths: number;
  djSlug: string;
  djName: string;
  isLoggedIn: boolean;
  // Currently-selected date (YYYY-MM-DD) — driven by the booking form when
  // it lives next to this calendar. For Session 4 always null; Session 5
  // wires it up.
  selectedDate?: string | null;
  // Called when the user clicks "Book Now" on an open cell. Provider passes
  // the dateKey. For Session 4 we show an alert; Session 5 will replace it.
  onBookDate?: (dateKey: string) => void;
  // Called when a logged-out visitor clicks "Book Now". Session 5 will open
  // the gate modal here.
  onLoggedOutBookAttempt?: () => void;
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers — pure, stateless
// ──────────────────────────────────────────────────────────────────────────

// Pad a number to 2 digits with leading zero
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Build the YYYY-MM-DD key from a (year, monthIndex, day) trio
function dateKey(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

// Latest navigable {year, month} based on today + window
function calcMaxYM(windowMonths: number): { year: number; month: number } {
  const t = new Date();
  const totalMonths = t.getFullYear() * 12 + t.getMonth() + (windowMonths || 12);
  return { year: Math.floor(totalMonths / 12), month: totalMonths % 12 };
}

// Earliest navigable {year, month} — the current month (no past nav)
function calcMinYM(): { year: number; month: number } {
  const t = new Date();
  return { year: t.getFullYear(), month: t.getMonth() };
}

// Is (y, m) within [min, max] inclusive?
function isInRange(y: number, m: number, windowMonths: number): boolean {
  const min = calcMinYM();
  const max = calcMaxYM(windowMonths);
  const v = y * 12 + m;
  return v >= (min.year * 12 + min.month) && v <= (max.year * 12 + max.month);
}

// ──────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────

export default function PublicCalendar({
  bookingDays,
  bookingWindowMonths,
  djName,
  djSlug,
  isLoggedIn,
  selectedDate = null,
  onBookDate,
  onLoggedOutBookAttempt,
}: Props) {
  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-11
  const [rollingActive, setRollingActive] = useState(false);
  const [rangeMsg, setRangeMsg] = useState<string | null>(null);
  // Booked-event popup — clicking a non-private booked cell opens it.
  const [popupEvent, setPopupEvent] = useState<{
    date: string;       // dateKey
    eventName: string;
    startTime?: string;
    endTime?: string;
    location?: string;
  } | null>(null);

  // Auto-dismiss the range message after 4s, matching vanilla.
  useEffect(() => {
    if (!rangeMsg) return;
    const t = setTimeout(() => setRangeMsg(null), 4000);
    return () => clearTimeout(t);
  }, [rangeMsg]);

  // Lock body scroll while popup open (matches vanilla pattern for modals).
  useEffect(() => {
    if (popupEvent) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [popupEvent]);

  // ── Navigation handlers ────────────────────────────────────────────
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
      // Only flash the message when going FORWARD past the window —
      // going past "today" backwards is silent (vanilla parity).
      if (dir > 0) showRangeMsg();
      return;
    }
    setYear(newY);
    setMonth(newM);
  }

  function jumpToMonth(m: number) {
    if (!isInRange(year, m, bookingWindowMonths)) {
      // Snap to nearest in-range month — vanilla pubCalJumpSplit logic
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
        // Session 4 placeholder — Session 5 will replace
        alert('Please log in to book this DJ.');
      }
      return;
    }
    if (onBookDate) {
      onBookDate(key);
    } else {
      // Session 4 placeholder
      alert(`Booking flow coming soon. Selected: ${key}`);
    }
  }

  function handleBookedCellClick(d: DayData, key: string) {
    // Private events don't open the popup (the eventName isn't shown publicly)
    if (!d.eventName || d.location === 'Private') return;
    setPopupEvent({
      date: key,
      eventName: d.eventName,
      startTime: d.startTime,
      endTime: d.endTime,
      location: d.location,
    });
  }

  // ── Bounds for prev/next button enable state ──────────────────────
  const min = calcMinYM();
  const max = calcMaxYM(bookingWindowMonths);
  const cur = year * 12 + month;
  const atMin = cur <= (min.year * 12 + min.month);
  const atMax = cur >= (max.year * 12 + max.month);

  // ── Year options for the dropdown ─────────────────────────────────
  const yearOptions = useMemo(() => {
    const opts: number[] = [];
    for (let y = today.getFullYear(); y <= max.year; y++) opts.push(y);
    return opts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, bookingWindowMonths]);

  // ────────────────────────────────────────────────────────────────────
  return (
    <div>
      {rangeMsg && <div className={styles.rangeMsg}>{rangeMsg}</div>}

      {/* TOP NAV ROW (always visible — toggle hides month/year selectors itself) */}
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
        >
          {rollingActive ? '← Month View' : windowLabel(bookingWindowMonths)}
        </button>
      </div>

      {/* SINGLE-MONTH VIEW */}
      {!rollingActive && (
        <SingleMonthView
          year={year}
          month={month}
          today={today}
          bookingDays={bookingDays}
          selectedDate={selectedDate}
          onBookClick={handleBookClick}
          onBookedCellClick={handleBookedCellClick}
        />
      )}

      {/* ROLLING 12-MONTH VIEW */}
      {rollingActive && (
        <RollingMonthsView
          today={today}
          bookingDays={bookingDays}
          bookingWindowMonths={bookingWindowMonths}
          selectedDate={selectedDate}
          isLoggedIn={isLoggedIn}
          onBookClick={handleBookClick}
        />
      )}

      {/* BOOKED-EVENT POPUP */}
      {popupEvent && (
        <BookedEventPopup
          event={popupEvent}
          onClose={() => setPopupEvent(null)}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// SingleMonthView — the default month grid
// ──────────────────────────────────────────────────────────────────────────

function SingleMonthView({
  year,
  month,
  today,
  bookingDays,
  selectedDate,
  onBookClick,
  onBookedCellClick,
}: {
  year: number;
  month: number;
  today: Date;
  bookingDays: BookingDays;
  selectedDate: string | null;
  onBookClick: (key: string, e: React.MouseEvent) => void;
  onBookedCellClick: (d: DayData, key: string) => void;
}) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // Collect public booked events for the list-below
  const monthEvents: Array<{ day: number; key: string; data: DayData }> = [];
  const cells: React.ReactNode[] = [];

  // Empty pre-cells
  for (let i = 0; i < firstDay; i++) {
    cells.push(<div key={`pre-${i}`} className={styles.emptyCell} />);
  }

  // Real day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const key = dateKey(year, month, d);
    const dayData: DayData = bookingDays[key] || {};
    const cellDate = new Date(year, month, d);
    const isPast = cellDate < todayMidnight;
    const isToday = year === today.getFullYear() && month === today.getMonth() && d === today.getDate();
    const isBooked = !!dayData.booked;
    const isUnavail = !!dayData.unavailable;
    const isPrivate = dayData.location === 'Private';
    const isSelected = selectedDate === key;
    const isLastRow = Math.floor((firstDay + d - 1) / 7) === Math.floor((firstDay + daysInMonth - 1) / 7);
    const isLastCol = (firstDay + d - 1) % 7 === 6;

    // Cell background class — selected wins, then booked, then unavail,
    // then today, then open (future), else nothing (past)
    const cellClasses = [styles.cell];
    if (isLastRow && !isLastCol) cellClasses.push(styles.cellNoBottomBorder);
    if (isSelected) cellClasses.push(styles.cellSelected);
    else if (isBooked) cellClasses.push(styles.cellBooked);
    else if (isUnavail) cellClasses.push(styles.cellUnavail);
    else if (isToday) cellClasses.push(styles.cellToday);
    else if (!isPast) cellClasses.push(styles.cellOpen);

    // Day number color class — same priority order
    const numClasses = [styles.cellNum];
    if (isSelected) numClasses.push(styles.cellNumSelected);
    else if (isPast) numClasses.push(styles.cellNumPast);
    else if (isBooked) numClasses.push(styles.cellNumBooked);
    else if (isUnavail) numClasses.push(styles.cellNumUnavail);
    else if (isToday) numClasses.push(styles.cellNumToday);

    // What goes inside the cell (below the number)?
    let inner: React.ReactNode = null;
    if (!isPast) {
      if (isBooked) {
        // Booked: show event name + time + ticket icon (if public event)
        const eventName = !isPrivate && dayData.eventName ? dayData.eventName : '';
        const ticketUrl = !isPrivate && dayData.ticketUrl ? dayData.ticketUrl : '';
        inner = (
          <>
            {eventName && <div className={styles.eventName}>{eventName}</div>}
            {dayData.startTime && (
              <div className={styles.eventTime}>{formatTime12(dayData.startTime)}</div>
            )}
            {ticketUrl && (
              <a
                href={ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={styles.ticketIcon}
                aria-label="Ticket info"
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
                  <line x1="7" y1="7" x2="7.01" y2="7" />
                </svg>
              </a>
            )}
          </>
        );
      } else if (isUnavail) {
        inner = null; // no badge for unavail
      } else {
        // Open cell — show "Book Now" badge
        inner = (
          <div
            className={styles.bookBadge}
            onClick={(e) => onBookClick(key, e)}
            role="button"
          >
            <span className={styles.bookBadgeText}>Book Now</span>
          </div>
        );
      }
    }

    // Collect public booked events for the list-below — FUTURE events only.
    // (Vanilla shows past events in the list too, but the product decision
    // here is to hide past events to keep the list focused on what's coming up.)
    if (!isPast && isBooked && dayData.eventName && !isPrivate) {
      monthEvents.push({ day: d, key, data: dayData });
    }

    const cellClickHandler = isBooked && !isPrivate && dayData.eventName
      ? () => onBookedCellClick(dayData, key)
      : undefined;

    cells.push(
      <div
        key={key}
        className={cellClasses.join(' ')}
        onClick={cellClickHandler}
      >
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

      <div className={styles.legend}>
        <div className={`${styles.legendItem} ${styles.legendOpen}`}>
          <span className={styles.legendDot} />Open
        </div>
        <div className={`${styles.legendItem} ${styles.legendBooked}`}>
          <span className={styles.legendDot} />Booked
        </div>
        <div className={`${styles.legendItem} ${styles.legendUnavail}`}>
          <span className={styles.legendDot} />Unavailable
        </div>
      </div>

      {/* Events-this-month list */}
      {monthEvents.length > 0 && (
        <div className={styles.eventsList}>
          <div className={styles.eventsListLabel}>Events This Month</div>
          <div className={styles.eventsListBody}>
            {monthEvents.map(({ day: d, key, data }) => {
              const dateLabel = new Date(year, month, d).toLocaleDateString(
                'en-US',
                { weekday: 'short', month: 'short', day: 'numeric' }
              );
              const cleanLoc = cleanLocation(data.location);
              const timeStr = data.startTime ? formatTime12(data.startTime) : '';
              return (
                <div key={key} className={styles.eventItem}>
                  <div className={styles.eventDateCol}>
                    <div>{dateLabel}</div>
                    {timeStr && (
                      <div className={styles.eventDateColTime}>{timeStr}</div>
                    )}
                  </div>
                  <div className={styles.eventCenter}>
                    <div className={styles.eventTitle}>{data.eventName}</div>
                    {cleanLoc && <div className={styles.eventLoc}>{cleanLoc}</div>}
                  </div>
                  {data.ticketUrl && (
                    <a
                      href={data.ticketUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.eventTicketLink}
                    >
                      {data.ticketLabel || 'More Info'}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// RollingMonthsView — 12-month overview
// ──────────────────────────────────────────────────────────────────────────

function RollingMonthsView({
  today,
  bookingDays,
  bookingWindowMonths,
  selectedDate,
  isLoggedIn,
  onBookClick,
}: {
  today: Date;
  bookingDays: BookingDays;
  bookingWindowMonths: number;
  selectedDate: string | null;
  isLoggedIn: boolean;
  onBookClick: (key: string, e: React.MouseEvent) => void;
}) {
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
  // Show min(window, 12) months — the window can be larger but the rolling
  // grid only renders 12 months at a time (matches vanilla).
  const monthsToRender = Math.min(bookingWindowMonths || 12, 12);

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
      const dayData: DayData = bookingDays[key] || {};
      const isPast = key < todayKey;
      const isBooked = !!dayData.booked;
      const isUnavail = !!dayData.unavailable;
      const isToday = key === todayKey;
      const isSelected = selectedDate === key;
      const isOpenFuture = !isPast && !isBooked && !isUnavail && !isToday;

      const cellClasses = [styles.miniCell];
      if (isSelected) cellClasses.push(styles.miniCellSelected);
      else if (isBooked) cellClasses.push(styles.miniCellBooked);
      else if (isUnavail) cellClasses.push(styles.miniCellUnavail);
      else if (isToday) cellClasses.push(styles.miniCellToday);
      else if (!isPast) cellClasses.push(styles.miniCellOpen);
      if (isOpenFuture) cellClasses.push(styles.miniCellPointer);

      const numClasses = [styles.miniNum];
      if (isSelected) numClasses.push(styles.miniNumSelected);
      else if (isPast) numClasses.push(styles.miniNumPast);
      else if (isBooked) numClasses.push(styles.miniNumBooked);
      else if (isUnavail) numClasses.push(styles.miniNumUnavail);
      else if (isToday) numClasses.push(styles.miniNumToday);

      cells.push(
        <div
          key={key}
          className={cellClasses.join(' ')}
          onClick={isOpenFuture ? (e) => onBookClick(key, e) : undefined}
        >
          <div className={numClasses.join(' ')}>{d}</div>
        </div>
      );
    }

    months.push(
      <div key={`m-${i}`} className={styles.monthCard}>
        <div className={styles.monthCardLabel}>
          {MONTH_NAMES[mo]}{' '}
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

  // Suppress isLoggedIn unused-warning — kept for future Session 5 wiring.
  void isLoggedIn;

  return (
    <div>
      <div className={styles.monthsGrid}>{months}</div>
      <div className={styles.windowBanner}>
        📅 This DJ is accepting bookings up to{' '}
        <strong>{windowLabel(bookingWindowMonths || 12)}</strong> in advance.
        Message them for dates beyond this.
      </div>
      <div className={styles.legendCentered}>
        <div className={`${styles.legendItem} ${styles.legendOpen}`}>
          <span className={styles.legendDot} />Open
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

// ──────────────────────────────────────────────────────────────────────────
// BookedEventPopup — modal shown when clicking a public booked cell
// ──────────────────────────────────────────────────────────────────────────

function BookedEventPopup({
  event,
  onClose,
}: {
  event: {
    date: string;
    eventName: string;
    startTime?: string;
    endTime?: string;
    location?: string;
  };
  onClose: () => void;
}) {
  // ESC key closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dateLabel = new Date(event.date + 'T12:00:00').toLocaleDateString(
    'en-US',
    { weekday: 'long', month: 'long', day: 'numeric' }
  );
  const timeStr = event.startTime
    ? formatTime12(event.startTime) +
      (event.endTime ? ' – ' + formatTime12(event.endTime) : '')
    : '';
  const cleanLoc = cleanLocation(event.location);

  return (
    <div
      className={styles.bookedPopupBackdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={styles.bookedPopupInner}>
        <button
          type="button"
          className={styles.bookedPopupClose}
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
        <div className={styles.bookedPopupDate}>{dateLabel}</div>
        <div className={styles.bookedPopupName}>{event.eventName}</div>
        {timeStr && <div className={styles.bookedPopupTime}>{timeStr}</div>}
        {cleanLoc && <div className={styles.bookedPopupLoc}>{cleanLoc}</div>}
      </div>
    </div>
  );
}
