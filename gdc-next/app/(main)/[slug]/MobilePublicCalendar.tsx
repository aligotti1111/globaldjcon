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
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { createClient } from '@/lib/supabase/client';
import styles from './mobileCalendar.module.css';
import {
  type BookingSettings,
  type MobileBookingDays,
  type MobileDayData,
  windowLabel,
} from './bookingSettings';
import MobileBookingForm from './MobileBookingForm';
import BookingLoginGate from './BookingLoginGate';

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
  // Profile data the form needs
  djId: string;
  djName: string;
  djSlug: string;
  djEventTypes: string | null;     // comma-separated, used to filter event-type select
  djZip: string | null;            // DJ's home zip — used for distance check at submit
  djTravelDistance: string | null; // 'worldwide' or numeric miles — distance limit
  // Full booking settings — needed for both the calendar AND the form (packages, deposit, etc.)
  bookingSettings: BookingSettings;
  isLoggedIn: boolean;
  // When true, the viewer is the profile owner. Calendar cells render
  // ✓/✗ quick-mark + ✏️ edit controls, and clicking a date opens the
  // owner day-edit modal instead of the booker form.
  isOwnProfile: boolean;
  // Owner-only: opens the Embed Calendar modal. When set, an "Embed
  // calendar" button is rendered inline in the nav row.
  onEmbedClick?: () => void;
  // Share Calendar — visible to all visitors. When set, a "Share" button
  // is rendered inline in the month header row.
  onShareClick?: () => void;
  // Bump-counter from parent: each increase forces the calendar into
  // 12-month mode. Used by the Book Now banner button.
  force12mo?: number;
  // Dates (YYYY-MM-DD) where the CURRENT logged-in viewer already has a
  // pending request with this DJ. These cells render a non-clickable
  // "Pending" pill instead of "Book" — only this viewer sees it; everyone
  // else still sees "Book", and the date stays open for the DJ. Empty for
  // logged-out viewers and the profile owner.
  pendingDates?: Set<string>;
  // Called after the booker successfully submits a request, so the parent
  // can refetch pendingDates and the just-booked date flips to "Pending".
  onBookingSubmitted?: () => void;
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
  djId,
  djName,
  djSlug,
  djEventTypes,
  djZip,
  djTravelDistance,
  bookingSettings,
  isLoggedIn,
  isOwnProfile,
  onEmbedClick,
  onShareClick,
  force12mo,
  pendingDates,
  onBookingSubmitted,
}: Props) {
  // Pull values out of bookingSettings — same defaults as before
  const bookingWindowMonths = bookingSettings.mob_booking_window || 24;
  const defaultBookingsPerDay = bookingSettings.mob_bookings_per_day || 1;

  // bookingDays is local state so owners can mutate it (quick-mark + edit).
  // For non-owners this never changes — initialized once from props.
  const [bookingDays, setBookingDays] = useState<MobileBookingDays>(
    bookingSettings.mob_booking_days || {}
  );

  // Auth — needed for the form (booker id + email + name)
  const { user: currentUser } = useAuth();

  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  // Month-jump dropdown (the neon "MAY 2026" button between the arrows).
  const [pickerOpen, setPickerOpen] = useState(false);
  // rollingActive can be initialized from a `?view=12mo` URL param so
  // the calendar opens directly in 12-month mode when someone shares
  // that link. Subsequent toggles also update the URL.
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
  // Selected date drives the form below the calendar. null = no form shown.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // Custom login gate modal — shown when a logged-out visitor tries to
  // book. Stores the date they tried so we can pre-select it after they
  // come back from auth.
  const [loginGateForDate, setLoginGateForDate] = useState<string | null>(null);
  // Owner day-edit modal — null when closed; the dateKey when open.
  const [ownerEditKey, setOwnerEditKey] = useState<string | null>(null);

  // ── Auto-open booking flow from ?date= URL param ──────────────────
  // Embed calendars on third-party sites point at /<slug>?date=YYYY-MM-DD
  // when a visitor clicks an open date. We pick that up here and either:
  //   1. Logged in   → auto-select the date so the booking form opens
  //   2. Logged out  → show the BookingLoginGate modal explaining what
  //      they're trying to book + offering Log In / Sign Up
  // Owner viewing their own profile → ignore (they already manage dates
  // through the day-edit modal).
  // Only fire on the initial mount (we don't want to keep re-opening
  // the modal if the user closes it; they'd need a fresh load to
  // re-trigger).
  const searchParams = useSearchParams();
  useEffect(() => {
    if (isOwnProfile) return;
    const dateParam = searchParams.get('date');
    if (!dateParam) return;
    // Validate format YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) return;
    // Make sure the date isn't booked / unavailable / past
    const [y, m, d] = dateParam.split('-').map(Number);
    const cellDate = new Date(y, m - 1, d);
    const todayMid = new Date();
    todayMid.setHours(0, 0, 0, 0);
    if (cellDate < todayMid) return;
    const dayData = bookingDays[dateParam];
    if (dayData?.booked || dayData?.unavailable) return;

    if (isLoggedIn && currentUser) {
      // Unverified users can't book — leave the form closed (the verify
      // banner explains what to do). No alert: this is a mount effect.
      if (!currentUser.email_verified) return;
      // Jump the visible month to that date so the form opens in context
      setYear(y);
      setMonth(m - 1);
      setSelectedDate(dateParam);
    } else {
      setLoginGateForDate(dateParam);
    }
    // Run only once on mount — disabled exhaustive-deps because we don't
    // want the effect re-firing when state changes (e.g. user closes the
    // modal). They'd need a fresh page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Owner: persist booking_days back to users.booking_settings ───
  // Vanilla mobPubOwnerSaveDays — fetches current booking_settings, merges
  // the new mob_booking_days, writes it back. Avoids clobbering other
  // settings the form may have updated since this component mounted.
  async function persistBookingDays(nextDays: MobileBookingDays) {
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
          // Bad JSON in DB — start fresh
          bs = {};
        }
      }
      bs.mob_booking_days = nextDays;
      await supabase
        .from('users')
        .update({ booking_settings: JSON.stringify(bs) } as unknown as never)
        .eq('id', djId);
    } catch (err) {
      console.error('persistBookingDays error:', err);
    }
  }

  // ── Owner: quick-mark a day available <-> unavailable ───────────
  // Vanilla mobPubQuickMark — toggles unavailable flag. If already booked,
  // do nothing (use the edit modal to clear bookings).
  async function quickMark(key: string) {
    const cur = bookingDays[key];
    if (cur && cur.booked) return;
    const next: MobileBookingDays = { ...bookingDays };
    if (cur && cur.unavailable) {
      delete next[key];
    } else {
      next[key] = { unavailable: true };
    }
    setBookingDays(next);
    await persistBookingDays(next);
  }

  // ── Owner: save day-edit modal ──────────────────────────────────
  async function saveOwnerEdit(
    key: string,
    update: MobileDayData | null
  ) {
    const next: MobileBookingDays = { ...bookingDays };
    if (update === null) delete next[key];
    else next[key] = update;
    setBookingDays(next);
    setOwnerEditKey(null);
    await persistBookingDays(next);
  }

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

  function handleBookClick(key: string, e: React.MouseEvent) {
    e.stopPropagation();
    // If the book was triggered from the 12-month rolling view, switch
    // back to single-month and navigate to the booked day's month so
    // the booking form renders in context.
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
    if (!isLoggedIn || !currentUser) {
      // Logged-out: open the custom login gate modal. It explains who
      // they're trying to book + what date, and gives Log In / Sign Up
      // buttons that redirect back here with ?date=key&book=1 so the
      // booking flow continues seamlessly after auth.
      setLoginGateForDate(key);
      return;
    }
    // Logged in but email not verified — block booking and point them at
    // the persistent verify banner (which has a Resend link).
    if (!currentUser.email_verified) {
      alert(
        'Please verify your email to continue. Use the "Resend Email" link in the banner at the top of the page, then click the link we send you.'
      );
      return;
    }
    setSelectedDate(key);
  }

  // ── Bounds for prev/next ─────────────────────────────────────────
  const min = calcMinYM();
  const max = calcMaxYM(bookingWindowMonths);
  const cur = year * 12 + month;
  const atMin = cur <= (min.year * 12 + min.month);
  const atMax = cur >= (max.year * 12 + max.month);

  // ── Every (year, month) inside the booking window — feeds the neon
  //    month-jump dropdown so the user can skip straight to any month. ──
  const monthJumpOptions = useMemo(() => {
    const mn = calcMinYM();
    const mx = calcMaxYM(bookingWindowMonths);
    const minV = mn.year * 12 + mn.month;
    const maxV = mx.year * 12 + mx.month;
    const opts: { y: number; m: number }[] = [];
    for (let v = minV; v <= maxV; v++) opts.push({ y: Math.floor(v / 12), m: v % 12 });
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
          <div className={styles.monthPickerCluster}>
            <button
              type="button"
              className={styles.navBtn}
              onClick={() => nav(-1)}
              disabled={atMin}
              aria-label="Previous month"
            >
              ‹
            </button>
            <div className={styles.monthPickerWrap}>
              <button
                type="button"
                className={styles.monthPickerBtn}
                aria-expanded={pickerOpen}
                aria-haspopup="listbox"
                onClick={() => setPickerOpen((o) => !o)}
              >
                {MONTH_NAMES[month]} {year}
                <span className={styles.monthPickerChev} aria-hidden="true">▾</span>
              </button>
              {pickerOpen && (
                <>
                  <div
                    onClick={() => setPickerOpen(false)}
                    style={{ position: 'fixed', inset: 0, zIndex: 55 }}
                    aria-hidden="true"
                  />
                  <div className={styles.monthPickerMenu} role="listbox">
                    {monthJumpOptions.map(({ y, m }) => {
                      const sel = y === year && m === month;
                      return (
                        <button
                          key={`${y}-${m}`}
                          type="button"
                          role="option"
                          aria-selected={sel}
                          className={`${styles.monthPickerOption} ${sel ? styles.monthPickerOptionSelected : ''}`}
                          onClick={() => {
                            setYear(y);
                            setMonth(m);
                            setPickerOpen(false);
                          }}
                        >
                          {MONTH_NAMES[m]} {y}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              className={styles.navBtn}
              onClick={() => nav(1)}
              disabled={atMax}
              aria-label="Next month"
            >
              ›
            </button>
          </div>
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
          isOwnProfile={isOwnProfile}
          onQuickMark={quickMark}
          onOpenEdit={(key) => setOwnerEditKey(key)}
          onEmbedClick={onEmbedClick}
          onShareClick={onShareClick}
          pendingDates={pendingDates}
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
          isOwnProfile={isOwnProfile}
          onQuickMark={quickMark}
          onOpenEdit={(key) => setOwnerEditKey(key)}
          pendingDates={pendingDates}
        />
      )}

      {/* LEGEND — only shown in single-month view. In 12-month view the
          legend is rendered inline at the end of each year inside the grid. */}
      {!rollingActive && (
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
      )}

      {/* BOOKING FORM — appears below the calendar after a date is selected.
          We use the date-key as a React key so picking a different date
          remounts the form (clearing any in-progress input). */}
      {/* Owner never sees the booker form — they manage dates via the
          ✓/✗ quick-mark and ✏️ edit pencil instead. */}
      {!isOwnProfile && selectedDate && currentUser && currentUser.email_verified && (
        <MobileBookingForm
          key={selectedDate}
          dateKey={selectedDate}
          dj={{
            id: djId,
            name: djName,
            slug: djSlug,
            event_types: djEventTypes,
            zip: djZip,
            travel_distance: djTravelDistance,
          }}
          bookingSettings={bookingSettings}
          currentUser={{
            id: currentUser.id,
            email: currentUser.email,
            name: currentUser.name,
          }}
          onClose={() => setSelectedDate(null)}
          onSubmitted={onBookingSubmitted}
        />
      )}

      {/* Logged-out booking gate modal */}
      {loginGateForDate && (
        <BookingLoginGate
          djName={djName}
          djSlug={djSlug}
          dateKey={loginGateForDate}
          onClose={() => setLoginGateForDate(null)}
        />
      )}

      {/* Owner day-edit modal — opens when ownerEditKey is non-null. */}
      {ownerEditKey && (
        <OwnerDayEditModal
          dateKey={ownerEditKey}
          dayData={bookingDays[ownerEditKey] || {}}
          defaultPerDay={defaultBookingsPerDay}
          onClose={() => setOwnerEditKey(null)}
          onSave={(update) => saveOwnerEdit(ownerEditKey, update)}
        />
      )}
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
  isOwnProfile,
  onQuickMark,
  onOpenEdit,
  onEmbedClick,
  onShareClick,
  pendingDates,
}: {
  year: number;
  month: number;
  today: Date;
  bookingDays: MobileBookingDays;
  bookingWindowMonths: number;
  defaultBookingsPerDay: number;
  selectedDate: string | null;
  onBookClick: (key: string, e: React.MouseEvent) => void;
  isOwnProfile: boolean;
  onQuickMark: (key: string) => void;
  onOpenEdit: (key: string) => void;
  // Owner-only Embed Calendar button — rendered in the month header row.
  onEmbedClick?: () => void;
  // Share Calendar — visible to all visitors, opens share modal.
  onShareClick?: () => void;
  // Dates the current viewer has a pending request on — render "Pending".
  pendingDates?: Set<string>;
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
    // A day that's hit its booking capacity is BOOKED for display purposes
    // (red), not "unavailable" (gray). Unavailable is reserved for days the
    // owner explicitly blocked off. A full day can only be reopened by raising
    // the accepted-bookings count for that day (the edit pencil), never by the
    // quick available/unavailable toggle.
    const showsAsBooked = isBooked || isFull;
    const isSelected = selectedDate === key;
    const isAvail = !isPast && !isBeyond && !isBooked && !isUnavail && !isFull;
    const isLastRow =
      Math.floor((firstDay + d - 1) / 7) ===
      Math.floor((firstDay + daysInMonth - 1) / 7);
    const isLastCol = (firstDay + d - 1) % 7 === 6;

    // Background — selected wins, then booked (incl. capacity-full), then
    // unavailable, then today, then avail
    const cellClasses = [styles.cell];
    if (isLastRow && !isLastCol) cellClasses.push(styles.cellNoBottomBorder);
    if (isSelected) cellClasses.push(styles.cellSelected);
    else if (showsAsBooked) cellClasses.push(styles.cellBooked);
    else if (isUnavail) cellClasses.push(styles.cellUnavail);
    else if (isToday) cellClasses.push(styles.cellToday);
    else if (isAvail) cellClasses.push(styles.cellAvail);

    // Day number color — note isPast/isBeyond muted, vanilla parity
    const numClasses = [styles.cellNum];
    if (isSelected) numClasses.push(styles.cellNumSelected);
    else if (isPast) numClasses.push(styles.cellNumPast);
    else if (isBeyond) numClasses.push(styles.cellNumBeyond);
    else if (showsAsBooked) numClasses.push(styles.cellNumBooked);
    else if (isUnavail) numClasses.push(styles.cellNumFull);
    else if (isToday) numClasses.push(styles.cellNumToday);

    // Inner content
    let inner: React.ReactNode = null;
    if (isOwnProfile && !isPast) {
      // Owner gets ✓/✗ quick-mark + ✏️ edit pencil. Shown for all
      // non-past dates — even booked ones get the pencil so the owner
      // can edit/clear the booking. Quick-mark only shown when not booked.
      inner = (
        <div className={styles.ownerControls}>
          {!showsAsBooked && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onQuickMark(key);
              }}
              className={`${styles.ownerQuickMark} ${
                isUnavail ? styles.ownerQuickMarkActive : ''
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
              onOpenEdit(key);
            }}
            className={styles.ownerEditPencil}
            title="Edit day"
          >
            ✏️
          </button>
        </div>
      );
    } else if (!isOwnProfile && isAvail) {
      // Pending takes precedence over Book — if THIS viewer already has a
      // pending request on this date, show a non-clickable "Pending" pill.
      // The cell stays available for everyone else.
      const isPendingForViewer = !!pendingDates?.has(key);
      inner = isPendingForViewer ? (
        <div
          className={`${styles.bookBadge} ${styles.bookBadgePending}`}
          role="status"
          aria-label="Booking pending"
        >
          Pending
        </div>
      ) : (
        <div
          className={styles.bookBadge}
          onClick={(e) => { e.stopPropagation(); onBookClick(key, e); }}
          role="button"
        >
          Book
        </div>
      );
    } else if (
      !isOwnProfile &&
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

    // Whole-cell click target for public visitors: clicking anywhere on an
    // open available date opens the booking window (not just the Book pill
    // inside). Pending-for-this-viewer cells stay inert to prevent
    // double-booking. Past, fully-booked, unavailable cells: no handler.
    const isPendingForViewerCell = !isOwnProfile && !!pendingDates?.has(key);
    const cellClickHandler =
      !isOwnProfile && isAvail && !isPendingForViewerCell
        ? (e: React.MouseEvent) => onBookClick(key, e)
        : undefined;

    cells.push(
      <div
        key={key}
        className={cellClasses.join(' ')}
        onClick={cellClickHandler}
        style={cellClickHandler ? { cursor: 'pointer' } : undefined}
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
      {onEmbedClick && (
        <div className={styles.monthHeaderRow}>
          <div className={styles.monthHeaderActions}>
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
          </div>
        </div>
      )}

      <div className={styles.dayHeaderRow}>
        {DAY_LABEL_LONG.map((name) => (
          <div key={name} className={styles.dayHeader}>{name}</div>
        ))}
      </div>

      <div className={`${styles.cellsGrid} ${styles.cellsGridCompact}`}>{cells}</div>
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
  isOwnProfile,
  onQuickMark,
  onOpenEdit,
  pendingDates,
}: {
  today: Date;
  bookingDays: MobileBookingDays;
  bookingWindowMonths: number;
  defaultBookingsPerDay: number;
  selectedDate: string | null;
  onBookClick: (key: string, e: React.MouseEvent) => void;
  isOwnProfile: boolean;
  onQuickMark: (key: string) => void;
  onOpenEdit: (key: string) => void;
  // Dates the current viewer has a pending request on — render "Pending".
  pendingDates?: Set<string>;
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
      // Pending request by THIS viewer — non-clickable, shows "Pending"
      // instead of "Book". Cell stays open for everyone else.
      const isPendingForViewer = !isOwnProfile && isAvail && !!pendingDates?.has(key);

      // Owner click → edit modal. Booker click → only if available, opens form.
      // For owner mode we keep cell click for edit (so tapping anywhere on
      // the cell still opens edit), but also render compact ✓/✕ + ✏️ buttons
      // for quick-mark + explicit edit. A viewer's own pending date isn't
      // clickable — no double-booking the same date.
      const onCellClick = isOwnProfile
        ? (!isPast ? (() => onOpenEdit(key)) : undefined)
        : (isAvail && !isPendingForViewer ? (e: React.MouseEvent) => onBookClick(key, e) : undefined);
      const isClickable = !!onCellClick;

      const cellClasses = [styles.miniCell];
      if (isSelected) cellClasses.push(styles.miniCellAvail);
      else if (isBooked) cellClasses.push(styles.miniCellBooked);
      else if (isUnavail || isFull) cellClasses.push(styles.miniCellUnavail);
      else if (isAvail) cellClasses.push(styles.miniCellAvail);
      else if (isPast) cellClasses.push(styles.miniCellPast);
      if (isToday) cellClasses.push(styles.miniCellToday);
      if (isClickable) cellClasses.push(styles.miniCellPointer);

      cells.push(
        <div
          key={key}
          className={cellClasses.join(' ')}
          onClick={onCellClick}
        >
          {d}
          {/* Public visitor: show "Book" label on available days so
              visitors can book directly from the 12-month grid. If this
              viewer already has a pending request, show "Pending" instead. */}
          {!isOwnProfile && isAvail && !isPast && (
            <div
              className={
                isPendingForViewer
                  ? `${styles.miniBookLabel} ${styles.miniBookLabelPending}`
                  : styles.miniBookLabel
              }
            >
              {isPendingForViewer ? 'Pending' : 'Book'}
            </div>
          )}
          {isOwnProfile && !isPast && (
            <div className={styles.miniOwnerControls}>
              {!isBooked && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onQuickMark(key);
                  }}
                  className={`${styles.miniOwnerQuickMark} ${
                    isUnavail ? styles.miniOwnerQuickMarkActive : ''
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
                  onOpenEdit(key);
                }}
                className={styles.miniOwnerEditPencil}
                title="Edit day"
              >
                ✏️
              </button>
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

    // Year-end legend — push after December (end of year) or after the very
    // last month rendered if the booking window doesn't end on December.
    // The legend spans the full grid row so it visually closes out the year.
    const isLastOfYear = mo === 11;
    const isLastOfAll = i === monthsToRender - 1;
    if (isLastOfYear || isLastOfAll) {
      months.push(
        <div key={`legend-${yr}-${mo}`} className={styles.yearLegend}>
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
      );
    }
  }

  return <div className={styles.monthsGrid}>{months}</div>;
}

// ─────────────────────────────────────────────────────────────────────────
// OwnerDayEditModal — opens when the profile owner clicks the ✏️ pencil
// on a calendar cell. Lets them set the day's status (Available / Unavailable /
// Booked) and configure capacity (avail) or event details (booked).
//
// Faithful port of vanilla djp-mob-public.js mobPubOwnerEdit + mobPubOwnerSaveDay.
// ─────────────────────────────────────────────────────────────────────────

type DayStatus = 'available' | 'unavailable' | 'booked';

function OwnerDayEditModal({
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
  // Pass null to delete this day's override (default capacity), otherwise
  // the new MobileDayData to write.
  onSave: (update: MobileDayData | null) => void;
}) {
  // Initial status derived from current dayData
  const initialStatus: DayStatus = dayData.booked
    ? 'booked'
    : dayData.unavailable
    ? 'unavailable'
    : 'available';
  const [status, setStatus] = useState<DayStatus>(initialStatus);

  // Available-day fields
  const [perDay, setPerDay] = useState<number>(
    dayData.bookings_available != null ? dayData.bookings_available : defaultPerDay
  );

  // Booked-day fields
  const [eventName, setEventName] = useState(dayData.eventName || '');
  const [isPrivate, setIsPrivate] = useState(dayData.location === 'Private');
  const [location, setLocation] = useState(
    dayData.location && dayData.location !== 'Private' ? dayData.location : ''
  );
  const [startTime, setStartTime] = useState(dayData.startTime || '');
  const [endTime, setEndTime] = useState(dayData.endTime || '');

  // Format the date label e.g. "Friday, April 24, 2026"
  const [y, m, d] = dateKey.split('-').map(Number);
  const dateLabel = new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  function handleSave() {
    if (status === 'unavailable') {
      onSave({ unavailable: true });
    } else if (status === 'booked') {
      onSave({
        booked: true,
        eventName: eventName.trim(),
        location: isPrivate ? 'Private' : location.trim(),
        startTime,
        endTime,
      });
    } else {
      // Available — only persist a per-day override if it differs from default.
      // Setting per-day to 0 collapses to "unavailable" (vanilla parity).
      if (perDay <= 0) {
        onSave({ unavailable: true });
      } else if (perDay !== defaultPerDay) {
        onSave({ bookings_available: perDay });
      } else {
        onSave(null); // delete override
      }
    }
  }

  return (
    <div className={styles.ownerModalBackdrop} onClick={onClose}>
      <div
        className={styles.ownerModalInner}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.ownerModalHeader}>
          <div className={styles.ownerModalDate}>{dateLabel}</div>
          <button
            type="button"
            onClick={onClose}
            className={styles.ownerModalClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className={styles.ownerModalRadios}>
          <label className={styles.ownerModalRadio}>
            <input
              type="radio"
              name="ownerEditStatus"
              checked={status === 'available'}
              onChange={() => setStatus('available')}
            />
            <span className={styles.ownerModalRadioAvail}>Available</span>
          </label>
          <label className={styles.ownerModalRadio}>
            <input
              type="radio"
              name="ownerEditStatus"
              checked={status === 'unavailable'}
              onChange={() => setStatus('unavailable')}
            />
            <span className={styles.ownerModalRadioUnavail}>Unavailable</span>
          </label>
          <label className={styles.ownerModalRadio}>
            <input
              type="radio"
              name="ownerEditStatus"
              checked={status === 'booked'}
              onChange={() => setStatus('booked')}
            />
            <span className={styles.ownerModalRadioBooked}>Booked</span>
          </label>
        </div>

        {status === 'available' && (
          <div className={styles.ownerModalField}>
            <label className={styles.ownerModalLabel}>
              Bookings available this day
            </label>
            <input
              type="number"
              min={0}
              max={99}
              value={perDay}
              onChange={(e) => setPerDay(parseInt(e.target.value || '0', 10))}
              className={styles.ownerModalNumberInput}
            />
            <span className={styles.ownerModalHint}>Set to 0 to block day</span>
          </div>
        )}

        {status === 'booked' && (
          <>
            <div className={styles.ownerModalField}>
              <label className={styles.ownerModalLabel}>Event Name</label>
              <input
                type="text"
                placeholder="Wedding Reception..."
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                className={styles.ownerModalTextInput}
              />
            </div>
            <div className={styles.ownerModalField}>
              <label className={styles.ownerModalRadio} style={{ marginBottom: '.35rem' }}>
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                />
                <span className={styles.ownerModalLabel} style={{ margin: 0 }}>
                  Private Location
                </span>
              </label>
              <input
                type="text"
                placeholder="Location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                disabled={isPrivate}
                className={styles.ownerModalTextInput}
              />
            </div>
            <div className={styles.ownerModalTimeRow}>
              <div>
                <label className={styles.ownerModalLabel}>Start Time</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className={styles.ownerModalTextInput}
                />
              </div>
              <div>
                <label className={styles.ownerModalLabel}>End Time</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className={styles.ownerModalTextInput}
                />
              </div>
            </div>
          </>
        )}

        <div className={styles.ownerModalBtns}>
          <button
            type="button"
            onClick={onClose}
            className={styles.ownerModalCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className={styles.ownerModalSave}
          >
            Save Day
          </button>
        </div>
      </div>
    </div>
  );
}
