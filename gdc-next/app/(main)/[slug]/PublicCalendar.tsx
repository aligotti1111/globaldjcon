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
import MonthEventsList from './MonthEventsList';
import ManualBookingForm, { type ManualBookingRow } from './ManualBookingForm';
import { createClient } from '@/lib/supabase/client';
import {
  type BookingDays,
  type BookingSettings,
  type DayData,
  cleanLocation,
  formatTime12,
  windowLabel,
} from './bookingSettings';
import { currencySymbol } from '@/lib/constants';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_LABEL_LONG = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LABEL_MINI = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface Props {
  bookingDays: BookingDays;
  bookingWindowMonths: number;
  // Used by the owner edit popup when isOwnProfile=true. The popup
  // mirrors the universal rate panel logic (equipment-aware inputs)
  // for setting per-day rate overrides, so it needs access to the DJ's
  // equipment flags, currency, and global rate type.
  bookingSettings?: BookingSettings;
  djId: string;
  djSlug: string;
  djName: string;
  isLoggedIn: boolean;
  // True when the logged-in user IS this DJ. Swaps the public booking
  // pill for owner controls (✓/✗ quick-mark + ✏️ pencil-edit) and
  // persists changes back to users.booking_settings on save.
  isOwnProfile: boolean;
  // Currently-selected date (YYYY-MM-DD) — driven by the booking form when
  // it lives next to this calendar.
  selectedDate?: string | null;
  // Called when the user clicks "Book Now" on an open cell. Provider
  // passes the dateKey.
  onBookDate?: (dateKey: string) => void;
  // Called when a logged-out visitor clicks "Book Now". Provider gets
  // the dateKey so it can open a login gate that returns the user to
  // this date after auth.
  onLoggedOutBookAttempt?: (dateKey: string) => void;
  // Owner-only: opens the Embed Calendar modal. When set, an "Embed
  // calendar" button is rendered inline in the nav row.
  onEmbedClick?: () => void;
  // Share Calendar — visible to all visitors. When set, a "Share" button
  // is rendered inline in the month header row.
  onShareClick?: () => void;
  // Bump-counter from parent: each increase forces the calendar into
  // 12-month mode. Used by the Book Now banner button.
  force12mo?: number;
  // Dates (YYYY-MM-DD) where the CURRENT logged-in viewer has a pending
  // booking request with this DJ. Only these dates render a "Pending"
  // label (instead of "Book") for the booker. Other viewers see "Book"
  // because their pending set is different. Owners see the day normally.
  pendingDates?: Set<string>;
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
  bookingDays: initialBookingDays,
  bookingWindowMonths,
  bookingSettings,
  djId,
  djName,
  djSlug,
  isLoggedIn,
  isOwnProfile,
  selectedDate = null,
  onBookDate,
  onLoggedOutBookAttempt,
  onEmbedClick,
  onShareClick,
  force12mo,
  pendingDates,
}: Props) {
  const today = useMemo(() => new Date(), []);
  // For owner mode we maintain a local copy of bookingDays so quick-marks
  // and edit-modal saves are reflected immediately while the Supabase
  // write happens in the background. Public visitors get the prop value
  // straight through (no edits possible).
  const [bookingDays, setBookingDays] = useState<BookingDays>(initialBookingDays);
  // Owner edit modal — null when closed; the dateKey when open.
  const [ownerEditKey, setOwnerEditKey] = useState<string | null>(null);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-11
  // rollingActive can be initialized from a `?view=12mo` URL param so
  // the calendar opens directly in 12-month mode when someone shares
  // that link. Subsequent user toggles also update the URL so they can
  // copy the current-view link from the address bar.
  const [rollingActive, setRollingActive] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('view') === '12mo';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (rollingActive) url.searchParams.set('view', '12mo');
    else url.searchParams.delete('view');
    window.history.replaceState(null, '', url.toString());
  }, [rollingActive]);
  // External trigger: parent bumps `force12mo` (e.g. Book Now banner
  // button) to forcibly enter 12-month rolling view.
  useEffect(() => {
    if (force12mo === undefined || force12mo === 0) return;
    setRollingActive(true);
  }, [force12mo]);
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

  // ── Owner mode: persist + quick-toggle + save modal ─────────────
  // When isOwnProfile is true, the cells render owner controls (✓/✗
  // quick-mark + ✏️ pencil edit) instead of the public Book pill.
  // Edits update local state immediately; the Supabase write happens
  // in the background. This mirrors MobilePublicCalendar's pattern.

  // Keep local state in sync if the parent re-renders with new data
  // (e.g. fresh fetch). We only override when the prop reference
  // actually changes — owner edits flow through setBookingDays here
  // and would be clobbered if we mirrored the prop on every render.
  useEffect(() => {
    setBookingDays(initialBookingDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBookingDays]);

  async function persistBookingDays(nextDays: BookingDays) {
    const supabase = createClient();
    try {
      const { data: current } = await supabase
        .from('users')
        .select('booking_settings')
        .eq('id', djId)
        .single<{ booking_settings: string | null }>();
      let bs: BookingSettings = {};
      if (current?.booking_settings) {
        try {
          bs = typeof current.booking_settings === 'string'
            ? JSON.parse(current.booking_settings)
            : current.booking_settings;
        } catch {
          bs = {};
        }
      }
      bs.booking_days = nextDays;
      await supabase
        .from('users')
        .update({ booking_settings: JSON.stringify(bs) } as unknown as never)
        .eq('id', djId);
    } catch (err) {
      console.error('persistBookingDays error:', err);
    }
  }

  // Quick-toggle a date Available <-> Unavailable. Booked days can't be
  // toggled from the cell — owner has to open the editor to clear an
  // event. (Matches MobilePublicCalendar.)
  function quickToggleUnavail(key: string) {
    const cur = bookingDays[key];
    if (cur && cur.booked) return;
    const next: BookingDays = { ...bookingDays };
    if (cur && cur.unavailable) {
      delete next[key];
    } else {
      next[key] = { unavailable: true };
    }
    setBookingDays(next);
    persistBookingDays(next);
  }

  // Save handler from the day-edit modal. update === null means "reset
  // to default" (drop the entry entirely).
  async function saveOwnerEdit(key: string, update: DayData | null) {
    const next: BookingDays = { ...bookingDays };
    if (update === null) delete next[key];
    else next[key] = update;
    setBookingDays(next);
    setOwnerEditKey(null);
    await persistBookingDays(next);
  }

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
    // If the book was triggered from the 12-month rolling view, switch
    // back to single-month view and navigate to the booked day's month
    // so the user can see the booking form in context.
    if (rollingActive) {
      const [yStr, mStr] = key.split('-');
      const y = parseInt(yStr, 10);
      const m = parseInt(mStr, 10) - 1; // dateKey month is 1-based
      if (!Number.isNaN(y) && !Number.isNaN(m)) {
        setYear(y);
        setMonth(m);
      }
      setRollingActive(false);
    }
    if (!isLoggedIn) {
      onLoggedOutBookAttempt?.(key);
      return;
    }
    onBookDate?.(key);
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
          {rollingActive
            ? '← Month View'
            : `${bookingWindowMonths || 12} Month${(bookingWindowMonths || 12) > 1 ? 's' : ''}`}
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
          isOwnProfile={isOwnProfile}
          onOwnerQuickToggle={quickToggleUnavail}
          onOwnerEdit={setOwnerEditKey}
          onEmbedClick={onEmbedClick}
          onShareClick={onShareClick}
          pendingDates={pendingDates}
        />
      )}

      {/* UPCOMING EVENTS LIST — only in single-month view. Anyone can see
          the list; only the profile owner sees the per-event flyer upload
          controls. */}
      {!rollingActive && (
        <MonthEventsList
          djId={djId}
          isOwnProfile={isOwnProfile}
          year={year}
          month={month}
          bookingDays={bookingDays}
          onEditDate={(dateKey) => setOwnerEditKey(dateKey)}
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
          isOwnProfile={isOwnProfile}
          onOwnerEdit={setOwnerEditKey}
          onOwnerQuickToggle={quickToggleUnavail}
          pendingDates={pendingDates}
        />
      )}

      {/* BOOKED-EVENT POPUP */}
      {popupEvent && (
        <BookedEventPopup
          event={popupEvent}
          onClose={() => setPopupEvent(null)}
        />
      )}

      {/* OWNER DAY-EDIT MODAL — opens when ownerEditKey is non-null.
          Reuses ClubDayEditModal? No — that lives in update-dj-profile
          and we don't want to import across feature boundaries. We do
          a lightweight inline version here that supports the same
          status + event name fields. */}
      {isOwnProfile && ownerEditKey && (
        <OwnerDayEditPopup
          dateKey={ownerEditKey}
          djId={djId}
          dayData={bookingDays[ownerEditKey] || {}}
          bookingSettings={bookingSettings}
          onClose={() => setOwnerEditKey(null)}
          onSave={(update) => saveOwnerEdit(ownerEditKey, update)}
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
  isOwnProfile,
  onOwnerQuickToggle,
  onOwnerEdit,
  onEmbedClick,
  onShareClick,
  pendingDates,
}: {
  year: number;
  month: number;
  today: Date;
  bookingDays: BookingDays;
  selectedDate: string | null;
  onBookClick: (key: string, e: React.MouseEvent) => void;
  onBookedCellClick: (d: DayData, key: string) => void;
  // Owner-mode controls — when isOwnProfile is true, cells render
  // ✓/✗ + ✏️ buttons that call these handlers instead of the public
  // Book pill / booked-event popup.
  isOwnProfile: boolean;
  onOwnerQuickToggle: (key: string) => void;
  onOwnerEdit: (key: string) => void;
  // Owner-only Embed Calendar button — rendered in the month header row.
  onEmbedClick?: () => void;
  // Share Calendar button — visible to all visitors, opens share modal.
  onShareClick?: () => void;
  // Viewer's own pending-request dates — render "Pending" pill instead
  // of "Book" on these dates. Empty/undefined for logged-out or owner.
  pendingDates?: Set<string>;
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
    // PUBLIC inner content first — applies to both visitor and owner
    // views so owners see the same booked-event names / book pill /
    // unavailable styling as visitors. Owner controls are an OVERLAY
    // rendered separately below.
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
      } else if (!isOwnProfile) {
        // Open cell — show "Book Now" badge OR "Pending" if the viewer
        // already has a pending request on this date. The Pending pill
        // is non-clickable (no double-booking the same date).
        const isPendingForViewer = !!pendingDates?.has(key);
        if (isPendingForViewer) {
          inner = (
            <div
              className={`${styles.bookBadge} ${styles.bookBadgePending}`}
              role="status"
              aria-label="Booking pending"
            >
              <span className={styles.bookBadgeText}>Pending</span>
            </div>
          );
        } else {
          inner = (
            <div
              className={styles.bookBadge}
              onClick={(e) => onBookClick(key, e)}
              role="button"
            >
              <span className={styles.bookBadgeText}>Book</span>
            </div>
          );
        }
      }
    }

    // Owner control overlay — rendered as absolute-positioned buttons
    // in the corners so they sit on top of the public cell content
    // (event name / Book pill) without replacing it. ✕/✓ goes top-right;
    // ✏️ goes bottom-right.
    const ownerOverlay = isOwnProfile && !isPast ? (
      <>
        {!isBooked && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOwnerQuickToggle(key);
            }}
            className={`${styles.ownerCornerBtn} ${styles.ownerCornerBtnBottomLeft} ${
              isUnavail ? styles.ownerCornerBtnCheck : styles.ownerCornerBtnX
            }`}
            title={isUnavail ? 'Mark available' : 'Mark unavailable'}
          >
            {isUnavail ? '✓' : '✕'}
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOwnerEdit(key);
          }}
          className={`${styles.ownerCornerBtn} ${styles.ownerCornerBtnBottomRight}`}
          title="Edit day"
        >
          ✏️
        </button>
      </>
    ) : null;

    // Collect public booked events for the list-below — FUTURE events only.
    // (Vanilla shows past events in the list too, but the product decision
    // here is to hide past events to keep the list focused on what's coming up.)
    if (!isPast && isBooked && dayData.eventName && !isPrivate) {
      monthEvents.push({ day: d, key, data: dayData });
    }

    // In owner mode the booked-event popup is suppressed — owner uses
    // the pencil edit button to manage the day, not the public popup.
    const cellClickHandler = !isOwnProfile && isBooked && !isPrivate && dayData.eventName
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
        {ownerOverlay}
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
      <div className={styles.monthHeaderRow}>
        {onEmbedClick && <div className={styles.monthHeaderSpacer} />}
        <div className={styles.monthHeader}>
          {MONTH_NAMES[month]}{' '}
          <span className={styles.monthHeaderYear}>{year}</span>
        </div>
        <div className={styles.monthHeaderActions}>
          {/* Share button removed — the share-calendar action now lives
              in the under-banner social row (see UnderBannerSocials). */}
          {onEmbedClick && (
            <button
              type="button"
              className={styles.embedInlineBtn}
              onClick={onEmbedClick}
              title="Embed Calendar"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
              Embed Calendar
            </button>
          )}
        </div>
      </div>

      <div className={styles.dayHeaderRow}>
        {DAY_LABEL_LONG.map((name) => (
          <div key={name} className={styles.dayHeader}>{name}</div>
        ))}
      </div>

      <div className={`${styles.cellsGrid} ${isOwnProfile ? styles.cellsGridCompact : ''}`}>{cells}</div>

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
  isOwnProfile,
  onOwnerEdit,
  onOwnerQuickToggle,
  pendingDates,
}: {
  today: Date;
  bookingDays: BookingDays;
  bookingWindowMonths: number;
  selectedDate: string | null;
  isLoggedIn: boolean;
  onBookClick: (key: string, e: React.MouseEvent) => void;
  isOwnProfile: boolean;
  onOwnerEdit: (key: string) => void;
  onOwnerQuickToggle: (key: string) => void;
  pendingDates?: Set<string>;
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

      const isPendingForViewer = !!pendingDates?.has(key) && isOpenFuture;
      // Owner mode: clicking any non-past day opens the edit modal.
      // Booker mode: clicking an open future day starts a booking,
      // UNLESS they already have a pending request on that date.
      const ownerCanEdit = isOwnProfile && !isPast;
      const onCellClick = ownerCanEdit
        ? () => onOwnerEdit(key)
        : (isOpenFuture && !isPendingForViewer ? (e: React.MouseEvent) => onBookClick(key, e) : undefined);
      const isClickable = !!onCellClick;

      const cellClasses = [styles.miniCell];
      if (isSelected) cellClasses.push(styles.miniCellSelected);
      else if (isBooked) cellClasses.push(styles.miniCellBooked);
      else if (isUnavail) cellClasses.push(styles.miniCellUnavail);
      else if (isToday) cellClasses.push(styles.miniCellToday);
      else if (!isPast) cellClasses.push(styles.miniCellOpen);
      if (isClickable) cellClasses.push(styles.miniCellPointer);

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
          onClick={onCellClick}
        >
          <div className={numClasses.join(' ')}>{d}</div>
          {/* Public visitor only: BOOK pill on available days; PENDING
              pill if this viewer already has a pending request on this
              date. */}
          {!isOwnProfile && isOpenFuture && (
            isPendingForViewer ? (
              <div className={`${styles.miniBookLabel} ${styles.miniBookLabelPending}`}>Pending</div>
            ) : (
              <div className={styles.miniBookLabel}>Book</div>
            )
          )}
          {/* Owner controls — quick-mark unavailable ✕/✓ (toggles) plus
              pencil-edit ✏️ to open the day edit modal. Shown only to
              the profile owner on non-past days. No pencil on booked
              days (booked days have their own edit flow via cell click). */}
          {ownerCanEdit && (
            <div className={styles.miniOwnerControls}>
              {!isBooked && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOwnerQuickToggle(key);
                  }}
                  className={`${styles.miniOwnerQuickMark} ${
                    isUnavail ? styles.miniOwnerQuickMarkActive : ''
                  }`}
                  title={isUnavail ? 'Mark available' : 'Mark unavailable'}
                >
                  {isUnavail ? '✓' : '✕'}
                </button>
              )}
              {!isBooked && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOwnerEdit(key);
                  }}
                  className={styles.miniOwnerEditPencil}
                  title="Edit day"
                >
                  ✏️
                </button>
              )}
            </div>
          )}
        </div>
      );
    }

    // Year divider — before each January (skip the first month so we don't
    // render a divider above the very first card if it happens to be Jan).
    if (i > 0 && mo === 0) {
      months.push(
        <div key={`yr-${yr}`} className={styles.yearDivider}>
          <span className={styles.yearDividerLabel}>{yr}</span>
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

    // Year-end legend — push after December (end of year) or after the very
    // last month rendered if the booking window doesn't end on December.
    // The legend spans the full grid row so it visually closes out the year.
    const isLastOfYear = mo === 11;
    const isLastOfAll = i === monthsToRender - 1;
    if (isLastOfYear || isLastOfAll) {
      months.push(
        <div key={`legend-${yr}-${mo}`} className={styles.yearLegend}>
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
      );
    }
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

// ──────────────────────────────────────────────────────────────────────────
// OwnerDayEditPopup — owner-mode day editor modal (status-only first cut).
// Mirror of ClubDayEditModal in update-dj-profile/, but lives here so the
// public profile doesn't need to import across feature boundaries.
//
// Future: per-day rate overrides + address autocomplete + time pickers
// (deferred to follow-up session — same as the update-dj-profile editor).
// ──────────────────────────────────────────────────────────────────────────

function OwnerDayEditPopup({
  dateKey,
  djId,
  dayData,
  bookingSettings,
  onClose,
  onSave,
}: {
  dateKey: string;
  djId: string;
  dayData: DayData;
  bookingSettings?: BookingSettings;
  onClose: () => void;
  onSave: (update: DayData | null) => void;
}) {
  const [status, setStatus] = useState<'available' | 'unavailable' | 'booked'>(
    dayData.booked ? 'booked' : dayData.unavailable ? 'unavailable' : 'available'
  );
  const [eventName, setEventName] = useState<string>(dayData.eventName || '');

  // Existing manual booking for this date (if any). Populated async after
  // mount; if present, the booking-details form opens prefilled with this
  // row's data. Also fetches the DJ's profile country so the form's
  // address-search country picker defaults sensibly.
  const [existingBooking, setExistingBooking] = useState<ManualBookingRow | null>(null);
  const [djCountry, setDjCountry] = useState<string>('United States');
  // All existing manual bookings — needed by the form's daily-cap check.
  // We only need {id, event_date} but fetch lightly.
  const [allBookings, setAllBookings] = useState<Array<{ id: string; event_date: string | null }>>([]);
  const [bookingDetailsLoading, setBookingDetailsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const supabase = createClient();
      // Fetch booking for this date (manual only).
      const bookingPromise = supabase
        .from('bookings')
        .select('id, event_date, start_time, end_time, venue_name, venue_address, venue_lat, venue_lon, venue_type, set_type, event_type, booking_type, is_manual, host_email, host_email_sent_at')
        .eq('dj_id', djId)
        .eq('event_date', dateKey)
        .eq('is_manual', true)
        .limit(1)
        .maybeSingle<ManualBookingRow>();
      // Fetch profile country for address-search default.
      const profilePromise = supabase
        .from('users')
        .select('country')
        .eq('id', djId)
        .maybeSingle<{ country: string | null }>();
      // Fetch all future bookings (just the dates) for daily-cap check.
      const today = new Date().toISOString().slice(0, 10);
      const allBookingsPromise = supabase
        .from('bookings')
        .select('id, event_date')
        .eq('dj_id', djId)
        .gte('event_date', today);
      const [bookingRes, profileRes, allRes] = await Promise.all([
        bookingPromise, profilePromise, allBookingsPromise,
      ]);
      if (!mounted) return;
      if (bookingRes.data) setExistingBooking(bookingRes.data);
      if (profileRes.data?.country) setDjCountry(profileRes.data.country);
      setAllBookings((allRes.data as Array<{ id: string; event_date: string | null }>) || []);
      setBookingDetailsLoading(false);
    })();
    return () => { mounted = false; };
  }, [djId, dateKey]);

  // ── Per-day rate override state ──────────────────────────────────
  // Mirror of ClubDayEditModal in update-dj-profile/. Initialised from
  // the existing day data; falls back to the global rate type so the
  // editor opens to the same context the DJ uses universally.
  const initialRateType: 'flat' | 'hourly' | 'offers' =
    (dayData.rateType as 'flat' | 'hourly' | 'offers' | undefined)
    || (bookingSettings?.global_rate_type as 'flat' | 'hourly' | 'offers' | undefined)
    || 'flat';
  const [rateType, setRateType] = useState<'flat' | 'hourly' | 'offers'>(initialRateType);
  const initStr = (v: number | string | undefined): string =>
    v != null && v !== '' ? String(v) : '';
  // Pre-fill rule — same as update-dj-profile/ClubOwnerCalendar. Day
  // override wins; falls back to universal so the modal opens with
  // the DJ's default rates as a starting point. handleSave only
  // persists fields that DIFFER from universal.
  const initRate = (
    dayVal: number | string | undefined,
    universalVal: number | string | undefined,
  ): string => initStr(dayVal != null && dayVal !== '' ? dayVal : universalVal);
  const [rateWithSystem, setRateWithSystem] = useState(initRate(dayData.rate_with_system, bookingSettings?.rate_with_system));
  const [rateWithDecks, setRateWithDecks] = useState(initRate(dayData.rate_with_decks, bookingSettings?.rate_with_decks));
  const [rateNoEquip, setRateNoEquip] = useState(initRate(dayData.rate_no_equip, bookingSettings?.rate_no_equip));
  const [rateHourlyWithSystem, setRateHourlyWithSystem] = useState(initRate(dayData.rate_hourly_with_system, bookingSettings?.rate_hourly_with_system));
  const [rateHourlyWithDecks, setRateHourlyWithDecks] = useState(initRate(dayData.rate_hourly_with_decks, bookingSettings?.rate_hourly_with_decks));
  const [rateHourlyNoEquip, setRateHourlyNoEquip] = useState(initRate(dayData.rate_hourly_no_equip, bookingSettings?.rate_hourly_no_equip));

  const equipFull = !!bookingSettings?.equip_full;
  const equipDecks = !!bookingSettings?.equip_decks;
  const equipNone = !!bookingSettings?.equip_none;
  const sym = currencySymbol(bookingSettings?.rate_currency || 'USD');

  // Form-expansion state for the Booked panel.
  //   - Existing booking on file → form open by default (edit mode)
  //   - No existing booking → form closed; user clicks "Add Booking Details"
  // We initialize once when bookingDetailsLoading flips false so re-renders
  // don't reset the user's toggle.
  const [formExpanded, setFormExpanded] = useState(false);
  const [formInitialized, setFormInitialized] = useState(false);
  useEffect(() => {
    if (!bookingDetailsLoading && !formInitialized) {
      setFormExpanded(!!existingBooking);
      setFormInitialized(true);
    }
  }, [bookingDetailsLoading, existingBooking, formInitialized]);

  // Format dateKey "2026-05-14" → "Thursday, May 14, 2026"
  const formatted = useMemo(() => {
    const [y, m, d] = dateKey.split('-').map(Number);
    if (!y || !m || !d) return dateKey;
    const dt = new Date(y, m - 1, d, 12, 0, 0);
    return dt.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
  }, [dateKey]);

  // Lock body scroll
  useEffect(() => {
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = orig; };
  }, []);

  function handleSave() {
    if (status === 'available') {
      // Build a partial DayData carrying only fields that DIFFER from
      // universal rates. Mirror of update-dj-profile/ClubOwnerCalendar.
      const tFlat = (s: string) => s.trim() === '' ? undefined : s.trim();
      const norm = (v: string | number | undefined): number | null => {
        if (v == null || v === '') return null;
        const n = typeof v === 'number' ? v : Number(v);
        return isNaN(n) ? null : n;
      };
      const diffs = (input: string, universal: number | string | undefined): string | undefined => {
        const inputNum = norm(input);
        const univNum = norm(universal);
        if (inputNum === univNum) return undefined;
        return tFlat(input);
      };
      const flatSys = diffs(rateWithSystem, bookingSettings?.rate_with_system);
      const flatDecks = diffs(rateWithDecks, bookingSettings?.rate_with_decks);
      const flatNone = diffs(rateNoEquip, bookingSettings?.rate_no_equip);
      const hrSys = diffs(rateHourlyWithSystem, bookingSettings?.rate_hourly_with_system);
      const hrDecks = diffs(rateHourlyWithDecks, bookingSettings?.rate_hourly_with_decks);
      const hrNone = diffs(rateHourlyNoEquip, bookingSettings?.rate_hourly_no_equip);
      const universalRateType = (bookingSettings?.global_rate_type as 'flat' | 'hourly' | 'offers' | undefined) || 'flat';
      const rateTypeChanged = rateType !== universalRateType;
      const anyOverride = flatSys || flatDecks || flatNone || hrSys || hrDecks || hrNone || rateTypeChanged;
      if (!anyOverride) {
        onSave(null);
        return;
      }
      const next: DayData = {};
      if (rateTypeChanged) next.rateType = rateType;
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
    onSave({
      booked: true,
      eventName: eventName.trim() || undefined,
    });
  }

  return (
    <div className={styles.ownerEditBackdrop} onClick={onClose}>
      <div className={styles.ownerEditBox} onClick={(e) => e.stopPropagation()}>
        <div className={styles.ownerEditHeader}>
          <div className={styles.ownerEditDate}>{formatted}</div>
          <button type="button" onClick={onClose} className={styles.ownerEditClose}>✕</button>
        </div>

        <div className={styles.ownerEditStatusRow}>
          <label className={styles.ownerEditStatusLabel}>
            <input
              type="radio"
              name="day-status"
              checked={status === 'available'}
              onChange={() => setStatus('available')}
              style={{ accentColor: 'var(--neon)' }}
            />
            <span style={{ color: 'var(--white)' }}>Available</span>
          </label>
          <label className={styles.ownerEditStatusLabel}>
            <input
              type="radio"
              name="day-status"
              checked={status === 'unavailable'}
              onChange={() => setStatus('unavailable')}
              style={{ accentColor: 'var(--muted)' }}
            />
            <span style={{ color: 'var(--muted)' }}>Unavailable</span>
          </label>
          <label className={styles.ownerEditStatusLabel}>
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
            Mirror of the universal rate panel + the update-dj-profile
            calendar's day-edit modal. Empty fields fall back to the
            DJ's universal rates; non-empty fields win for that date. */}
        {status === 'available' && bookingSettings && (
          <div className={styles.ownerEditBookedFields}>
            <div className={styles.ownerEditFieldGroup}>
              <label className={styles.ownerEditFieldLabel}>
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

              {rateType !== 'offers' && (() => {
                const isHourly = rateType === 'hourly';
                const suffix = isHourly ? ' (per hour)' : '';
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
                        <PCDayRateInput label={`Sound System & Decks/Controller${suffix}`} symbol={sym} value={sysVal} onChange={sysSet} />
                        <PCDayRateInput label={`Decks/Controller only${suffix}`} symbol={sym} value={decksVal} onChange={decksSet} />
                        <PCDayRateInput label={`Venue provides all equipment${suffix}`} symbol={sym} value={noneVal} onChange={noneSet} />
                      </>
                    )}
                    {equipDecks && (
                      <>
                        <PCDayRateInput label={`Decks/Controller only${suffix}`} symbol={sym} value={decksVal} onChange={decksSet} />
                        <PCDayRateInput label={`Venue provides all equipment${suffix}`} symbol={sym} value={noneVal} onChange={noneSet} />
                      </>
                    )}
                    {equipNone && (
                      <PCDayRateInput label={`Venue provides all equipment${suffix}`} symbol={sym} value={noneVal} onChange={noneSet} />
                    )}
                  </div>
                );
              })()}
              {rateType === 'offers' && (
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: '.8rem', lineHeight: 1.5 }}>
                  This day will accept open offers from bookers — no rate
                  shown publicly. Bookers submit what they want to pay.
                </p>
              )}
            </div>
          </div>
        )}

        {status === 'booked' && (
          <div className={styles.ownerEditBookedFields}>
            {bookingDetailsLoading ? (
              <div className={styles.ownerEditComingSoon}>Loading booking details…</div>
            ) : formExpanded ? (
              <ManualBookingForm
                userId={djId}
                djType="club"
                djCountry={djCountry}
                djName=""
                bookingsPerDay={1}
                existingBookings={allBookings}
                existing={existingBooking}
                prefillDate={dateKey}
                lockDate={true}
                onCancel={onClose}
                onSaved={(row, mode) => {
                  // Persist the booked calendar mark so the day stays red
                  // even if the user closes without re-saving.
                  onSave({ booked: true, eventName: undefined });
                  setExistingBooking(row);
                  if (mode === 'added' || mode === 'updated') onClose();
                }}
              />
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setFormExpanded(true)}
                  className={styles.ownerEditAddDetailsBtn}
                >
                  + Add Booking Details
                </button>
                <p className={styles.ownerEditComingSoon}>
                  You can also save just as Booked (no details) — the date shows publicly as a private event.
                </p>
              </>
            )}
          </div>
        )}

        {/* Outer modal's Save/Cancel row. Hidden when the inline booking
            form is expanded (the form provides its own Add Booking / Save
            Changes button so a separate Save would be redundant). */}
        {!(status === 'booked' && formExpanded) && (
          <div className={styles.ownerEditActions}>
            <button type="button" onClick={onClose} className={styles.ownerEditCancelBtn}>
              Cancel
            </button>
            <button type="button" onClick={handleSave} className={styles.ownerEditSaveBtn}>
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PCDayRateInput — currency-prefixed number input for the owner's per-day
// rate override panel. Mirror of update-dj-profile/ClubOwnerCalendar's
// DayRateInput; lives here so PublicCalendar doesn't import across
// feature boundaries.
// ─────────────────────────────────────────────────────────────────────────
function PCDayRateInput({
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
          className={styles.ownerEditInput}
          style={{ paddingLeft: 28 }}
        />
      </div>
    </div>
  );
}
