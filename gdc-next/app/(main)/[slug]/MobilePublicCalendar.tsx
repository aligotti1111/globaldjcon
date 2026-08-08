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
  packageTiers,
} from './bookingSettings';
import { currencySymbol } from '@/lib/constants';
import MobileBookingForm from './MobileBookingFormView';
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
  djCustomEventTypes?: unknown;    // DJ-defined event types [{key,label}]
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

// One package's price picture for the day-editor preview: its duration tiers,
// or a "by request" flag when it has no fixed price. Deduped by title across
// event-type categories so the DJ sees each package once.
type PreviewPkg = { title: string; byRequest: boolean; tiers: { hours: number; price: number }[] };
function buildPreviewPackages(mobPackages: Record<string, unknown[]> | undefined | null): PreviewPkg[] {
  if (!mobPackages) return [];
  const seen = new Set<string>();
  const out: PreviewPkg[] = [];
  for (const cat of Object.keys(mobPackages)) {
    const list = mobPackages[cat];
    if (!Array.isArray(list)) continue;
    for (const pkg of list as Array<{ title?: string; reqAll?: boolean }>) {
      const title = (pkg?.title || '').trim();
      if (!title || seen.has(title.toLowerCase())) continue;
      seen.add(title.toLowerCase());
      const tiers = packageTiers(pkg as never);
      out.push({ title, byRequest: !!pkg?.reqAll || tiers.length === 0, tiers });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────

export default function MobilePublicCalendar({
  djId,
  djName,
  djSlug,
  djEventTypes,
  djCustomEventTypes,
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

  // Package price picture + currency for the owner day-editor's "See new prices"
  // preview. Computed once from the DJ's packages.
  const previewPackages = useMemo(
    () => buildPreviewPackages((bookingSettings as { mob_packages?: Record<string, unknown[]> }).mob_packages),
    [bookingSettings],
  );
  const previewCur = currencySymbol((bookingSettings as { rate_currency?: string }).rate_currency);

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
      const { data: current, error: readErr } = await supabase
        .from('users')
        .select('booking_settings')
        .eq('id', djId)
        .single<{ booking_settings: string | null }>();
      if (readErr) {
        console.error('persistBookingDays read error:', readErr);
        alert('Could not save calendar change: ' + readErr.message);
        return;
      }
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
      const { error: writeErr } = await supabase
        .from('users')
        .update({ booking_settings: JSON.stringify(bs) } as unknown as never)
        .eq('id', djId);
      if (writeErr) {
        console.error('persistBookingDays write error:', writeErr);
        alert('Could not save calendar change: ' + writeErr.message);
      }
    } catch (err) {
      console.error('persistBookingDays error:', err);
      alert('Could not save calendar change. See console for details.');
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
      // Marking available again: drop only the unavailable flag, keep any price
      // nudge / capacity the day carries. Delete the entry only if nothing's left.
      const rest = { ...cur };
      delete rest.unavailable;
      if (Object.keys(rest).length > 0) next[key] = rest;
      else delete next[key];
    } else {
      // MERGE the flag on so an existing price_adjust_pct / bookings_available
      // survives being marked unavailable.
      next[key] = { ...cur, unavailable: true };
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
    // DELIBERATELY NOT CHECKING isLoggedIn. That prop is rendered by the
    // server and is fixed for the life of the page — it says what was true
    // when the HTML was built. Someone who just created an account inside the
    // gate is signed in, but isLoggedIn is still false, so testing it here
    // would put the signup box in front of them a second time and there'd be
    // no way past it. currentUser comes from the auth context, which updates
    // the moment a session appears, so it's the one that can tell the truth
    // about right now.
    if (!currentUser) {
      // Logged-out: open the booking gate. It names the DJ and the date, and
      // creates the account inline — see BookingLoginGate.
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
            mob_custom_event_types: djCustomEventTypes,
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
          // The account now gets made inside the gate, so when it finishes we
          // are already signed in and still on this page. Close it and open
          // the booking form for the date they picked before signing up —
          // otherwise they'd land back on the calendar and have to tap the
          // same date a second time, having just told us which one they want.
          //
          // No email_verified check here, unlike handleBookClick: a code was
          // typed thirty seconds ago on whichever channel they chose, which is
          // the proof that flag exists to represent.
          onAuthed={(key) => {
            setLoginGateForDate(null);
            setSelectedDate(key);
          }}
        />
      )}

      {/* Owner day-edit modal — opens when ownerEditKey is non-null. */}
      {ownerEditKey && (
        <OwnerDayEditModal
          dateKey={ownerEditKey}
          dayData={bookingDays[ownerEditKey] || {}}
          previewPackages={previewPackages}
          cur={previewCur}
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
          {/* Owner-only markers: a manual "booked" block the DJ set themselves
              (no real booking behind it) and a per-date price edit. */}
          {(() => {
            const manualBooked = isBooked && dayData.bookings_available == null && !dayData.eventName;
            const pct = dayData.price_adjust_pct;
            const priceEdited = pct != null && pct !== 0;
            if (!manualBooked && !priceEdited) return null;
            return (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, marginTop: 2, pointerEvents: 'none' }}>
                {manualBooked && (
                  <span style={{ fontSize: 8, lineHeight: 1.2, color: '#fff', fontWeight: 700, background: 'rgba(0,0,0,.45)', padding: '1px 4px', borderRadius: 3, letterSpacing: '.02em', whiteSpace: 'nowrap' }}>Manually booked</span>
                )}
                {priceEdited && (
                  <span style={{ fontSize: 9, lineHeight: 1.15, color: 'var(--neon,#00e0a4)', fontWeight: 700 }}>
                    {pct > 0 ? `+${pct}% increase` : `${pct}% decrease`}
                  </span>
                )}
              </div>
            );
          })()}
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

      const miniManualBooked = isOwnProfile && isBooked && dayData.bookings_available == null && !dayData.eventName;
      cells.push(
        <div
          key={key}
          className={cellClasses.join(' ')}
          onClick={onCellClick}
          title={miniManualBooked ? 'Manually marked booked' : undefined}
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
              {dayData.price_adjust_pct != null && dayData.price_adjust_pct !== 0 && (
                <span style={{ fontSize: 7, lineHeight: 1, color: 'var(--neon,#00e0a4)', fontWeight: 700 }} title="Price edited for this day">
                  {dayData.price_adjust_pct > 0 ? '+' : ''}{dayData.price_adjust_pct}%
                </span>
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
// on a calendar cell. Sets the day's price nudge, or marks it "booked" (closed
// to new bookings). Available/Unavailable are the cell's own ✕/✓ toggle.
// ─────────────────────────────────────────────────────────────────────────

function OwnerDayEditModal({
  dateKey,
  dayData,
  previewPackages,
  cur,
  onClose,
  onSave,
}: {
  dateKey: string;
  dayData: MobileDayData;
  previewPackages: PreviewPkg[];
  cur: string;
  onClose: () => void;
  // Pass null to delete this day's override (default capacity), otherwise
  // the new MobileDayData to write.
  onSave: (update: MobileDayData | null) => void;
}) {
  // Initial status derived from current dayData
  // OPEN (optional price nudge) or BOOKED (closed to new bookings, red).
  // Available/Unavailable are the ✕/✓ toggle on the calendar cell, not here.
  const [booked, setBooked] = useState<boolean>(!!dayData.booked);

  // Signed per-date price nudge (0 = normal price), clamped like the input.
  const [adjustPct, setAdjustPct] = useState<number>(dayData.price_adjust_pct ?? 0);
  const clampPct = (n: number) => Math.max(-100, Math.min(500, n));
  // "See new prices" box is CLOSED until the DJ opens it.
  const [showPrices, setShowPrices] = useState(false);
  // The % control only makes sense when at least one package has a FIXED price.
  // No packages at all (pure-quote DJ) or all "by request" → nothing to adjust.
  const pkgs = previewPackages || [];
  const canAdjust = pkgs.some((p) => !p.byRequest);
  // A day that hit its booking CAPACITY (real approvals filled it) is already
  // closed to new bookings on its own, so the manual "mark booked" toggle would
  // be redundant/confusing — hide it and just say the day is full.
  const naturallyFull = dayData.bookings_available != null && dayData.bookings_available <= 0;

  // Format the date label e.g. "Friday, April 24, 2026"
  const [y, m, d] = dateKey.split('-').map(Number);
  const dateLabel = new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  function handleSave() {
    // MERGE from the existing record — never clobber fields other writers set
    // (approval capacity in bookings_available, an event name written when a
    // request was approved, an unavailable flag from the ✕ toggle). This modal
    // only OWNS `booked` and `price_adjust_pct`.
    const next: MobileDayData = { ...dayData };
    if (booked) {
      // Close to new bookings + red. Existing bookings and pending requests are
      // untouched — the DJ still confirms those from Booking Requests.
      next.booked = true;
      delete next.unavailable; // booked supersedes an unavailable flag
    } else {
      delete next.booked;
      if (adjustPct !== 0) next.price_adjust_pct = clampPct(adjustPct);
      else delete next.price_adjust_pct;
    }
    onSave(Object.keys(next).length > 0 ? next : null);
  }

  return (
    <div className={styles.ownerModalBackdrop} onClick={onClose}>
      <div
        className={styles.ownerModalInner}
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#000', border: '1px solid rgba(255,255,255,.16)' }}
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

        {!booked && canAdjust && (
          <div className={styles.ownerModalField}>
            <label className={styles.ownerModalLabel}>
              Price for this day
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <button
                type="button"
                onClick={() => setAdjustPct((v) => clampPct(v - 5))}
                aria-label="Lower the price for this day"
                style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--deep)', color: 'var(--white)', fontSize: '1.2rem', lineHeight: 1, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
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
                  className={styles.ownerModalNumberInput}
                  style={{ width: 90, textAlign: 'center', paddingRight: '1.4rem' }}
                />
                <span style={{ position: 'absolute', right: '.6rem', color: 'var(--muted)', fontSize: '.85rem', pointerEvents: 'none' }}>%</span>
              </span>
              <button
                type="button"
                onClick={() => setAdjustPct((v) => clampPct(v + 5))}
                aria-label="Raise the price for this day"
                style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--deep)', color: 'var(--white)', fontSize: '1.2rem', lineHeight: 1, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >+</button>
            </div>
            <span className={styles.ownerModalHint}>
              {adjustPct === 0
                ? 'Charge more or less for a booking on this date — 0% is your normal rate. Built straight into the price the client sees, never shown as a discount or surcharge.'
                : `${adjustPct > 0 ? '+' : ''}${adjustPct}% — bookings on this date are quoted ${adjustPct > 0 ? 'higher' : 'lower'} than normal.`}
            </span>

            {pkgs.some((p) => !p.byRequest) && (
              <div style={{ marginTop: '.6rem', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => setShowPrices((s) => !s)}
                  aria-expanded={showPrices}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.5rem .7rem', background: 'rgba(255,255,255,.04)', border: 'none', color: '#c9c9d4', fontSize: '.72rem', letterSpacing: '.04em', cursor: 'pointer' }}
                >
                  <span>See new prices</span>
                  <span style={{ color: 'var(--muted)', fontSize: '.7rem' }}>{showPrices ? '▴' : '▾'}</span>
                </button>
                {showPrices && (
                  <div style={{ padding: '.35rem .7rem .55rem' }}>
                    <div style={{ fontSize: '.64rem', color: 'var(--muted)', padding: '.2rem 0 .3rem', lineHeight: 1.4 }}>
                      Base package prices. Add-ons, deposit, tax and any active sale/promo are applied on top at booking.
                    </div>
                    {pkgs.map((p) => (
                      p.byRequest ? (
                        <div key={p.title} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.78rem', padding: '.3rem 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                          <span style={{ color: '#e6e6ee' }}>{p.title}</span>
                          <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>By request</span>
                        </div>
                      ) : (
                        p.tiers.map((t, ti) => (
                          <div key={`${p.title}-${t.hours}-${ti}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.78rem', padding: '.3rem 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                            <span style={{ color: '#e6e6ee' }}>{p.title} · {t.hours}hr</span>
                            <span>
                              <span style={{ color: 'var(--muted)', textDecoration: adjustPct !== 0 ? 'line-through' : 'none' }}>{cur}{t.price.toLocaleString()}</span>
                              {adjustPct !== 0 && (
                                <span style={{ color: 'var(--neon,#00e0a4)' }}> {cur}{Number((t.price * (1 + adjustPct / 100)).toFixed(2)).toLocaleString()}</span>
                              )}
                            </span>
                          </div>
                        ))
                      )
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!booked && !canAdjust && (
          <div className={styles.ownerModalField}>
            <span className={styles.ownerModalHint}>
              {pkgs.length === 0
                ? 'You don’t have fixed-price packages, so bookings are quote-only — there’s no set price to raise or lower for this date.'
                : 'Your packages are all “by request”, so there’s no set price to raise or lower for this date — clients still send a request and you quote them.'}
            </span>
          </div>
        )}

        {/* A day already at capacity is full on its own — no manual toggle,
            just a status line. */}
        {naturallyFull && (
          <div className={styles.ownerModalField}>
            <span className={styles.ownerModalHint}>
              This date has reached its booking capacity — it’s already full and closed to new requests, so there’s nothing to mark here.
            </span>
          </div>
        )}

        {/* Booked = close the date to NEW bookings. Single toggle, no fields.
            Hidden once the day fills naturally. */}
        {!naturallyFull && (
        <div className={styles.ownerModalField}>
          <button
            type="button"
            onClick={() => setBooked((b) => !b)}
            aria-pressed={booked}
            style={{
              width: '100%',
              padding: '.7rem',
              borderRadius: 8,
              // Booked → the button OPENS the day (green, make-available). Not
              // booked → the button CLOSES it (red, mark-as-booked).
              border: `1px solid ${booked ? 'rgba(0,224,164,.55)' : 'rgba(255,95,95,.5)'}`,
              background: booked ? 'rgba(0,224,164,.12)' : 'rgba(255,95,95,.06)',
              color: booked ? 'var(--neon,#00e0a4)' : '#ff5f5f',
              fontWeight: 600,
              fontSize: '.85rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '.45rem',
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: booked ? 'var(--neon,#00e0a4)' : '#ff5f5f', display: 'inline-block' }} />
            {booked ? 'Make this day available for booking' : 'Mark this day as booked'}
          </button>
          <span className={styles.ownerModalHint}>
            {booked
              ? 'This date is currently BOOKED — closed to new requests and shown red. Tap the button above to reopen it, then Save Day.'
              : 'Closes this date to new booking requests and marks it red. Bookings already on this day stay put, and any pending requests for it can still be confirmed from your Booking Requests at your discretion.'}
          </span>
        </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', margin: '.2rem 0 .9rem', color: 'var(--muted)', fontSize: '.68rem', lineHeight: 1.4 }}>
          <span aria-hidden="true">🔒</span>
          <span>Only visible to account operators (you and your teammates). Clients never see these settings — just the date’s price and availability.</span>
        </div>

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
