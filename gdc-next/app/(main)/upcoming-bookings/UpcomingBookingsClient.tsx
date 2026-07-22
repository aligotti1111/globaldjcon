'use client';

// UpcomingBookingsClient — DJ's own future schedule view.
//
// Renders the list grouped by month (most recent month first), shows each
// upcoming approved/manual booking as a single row, and provides an
// "+ Add Manual Booking" CTA that opens a modal with the right fields for
// the DJ's type.
//
// Form fields per role:
//   - Club/Bar DJ: date · start · end · venue name · address (Nominatim) ·
//     venue type (bar/club) · set type (opening/headliner/closing/opening+closing)
//   - Mobile DJ:   date · start · end · venue name (optional) · address ·
//     event type
//
// Daily-cap rule applied at form save:
//   - Club: max 1 booking per date (real + manual combined). Soft block.
//   - Mobile: max users.booking_settings.mob_bookings_per_day per date. Soft block.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { type MobilePackage } from '../[slug]/bookingSettings';

import styles from './upcomingBookings.module.css';
import type { UpcomingBooking, BookingPayment, BookingPlannerSummary } from './page';
import { canUsePro, type AccessFields } from '@/lib/access';
import MonthlyStory from './MonthlyStory';
import AddManualBookingModal from './AddManualBookingModal';
import BookingRow, { ColumnHeaders } from './BookingRow';
import { useConfirm } from '@/components/ConfirmModal';

interface Props {
  userId: string;
  djType: 'club' | 'mobile';
  djCountry: string;
  djName: string;
  bookingsPerDay: number;
  initialBookings: UpcomingBooking[];
  // The DJ's saved mobile packages by category ('general' | 'wedding' |
  // 'mitzvah'), used to populate the manual-booking package dropdown.
  mobPackages: Record<string, MobilePackage[]> | null;
  // Archive mode — used by the dedicated /past-bookings page. Renders the same
  // rows read-only-ish (no add / schedule tools), newest-first, "Past Bookings".
  archive?: boolean;
  // booking_payments rows keyed by booking_id, loaded server-side by the page
  // (the generated Supabase types predate the table, so the page casts to an
  // untyped client for that one query). Purely informational — never gates.
  initialPayments?: Record<string, BookingPayment[]>;
  // booking_planners, reduced to a fraction server-side (the answers never come
  // to the browser). Keyed by booking_id; absent = never requested.
  initialPlanners?: Record<string, BookingPlannerSummary>;
}


export default function UpcomingBookingsClient({
  userId, djType, djCountry, djName, bookingsPerDay, initialBookings, mobPackages, archive = false,
  initialPayments, initialPlanners,
}: Props) {
  const [bookings, setBookings] = useState<UpcomingBooking[]>(initialBookings);
  // Payment ledger rows per booking (booking_payments). Owned at the top so a
  // row's expanded panel can update after request/confirm/waive without a
  // refetch, and so collapse/expand doesn't lose the fresh state.
  const [paymentsMap, setPaymentsMap] = useState<Record<string, BookingPayment[]>>(initialPayments || {});
  function handlePaymentsChange(bookingId: string, rows: BookingPayment[]) {
    setPaymentsMap((prev) => ({ ...prev, [bookingId]: rows }));
  }
  // Planner summaries per booking. Owned at the top for the same reason as the
  // payments: after a Request the row must go amber immediately, and collapsing
  // it must not throw that away.
  //
  // Also mirrored onto booking.planner_status below — the row reads BOTH (the
  // column via this map, and `planner_status` elsewhere), and one updating
  // without the other is how a strip starts contradicting itself.
  const [plannerMap, setPlannerMap] = useState<Record<string, BookingPlannerSummary>>(initialPlanners || {});
  function handlePlannerChange(bookingId: string, row: BookingPlannerSummary) {
    setPlannerMap((prev) => ({ ...prev, [bookingId]: row }));
    setBookings((prev) => prev.map((b) => (
      b.id === bookingId ? { ...b, planner_status: row.status } : b
    )));
  }
  // The DJ's standing club deposit % (from booking_settings). Lets club
  // booking cards show the deposit even when it wasn't stored per-booking —
  // matching what the contract applies.
  const [clubDepositPct, setClubDepositPct] = useState<number>(0);
  // Mobile equivalent. Was never read: nothing on this page needed it until
  // the manual-booking form started seeding its deposit toggle from settings.
  const [mobDepositPct, setMobDepositPct] = useState<number>(0);
  // booking_settings.rate_currency. Club already had this; mobile never did,
  // so mobile money has been printed with a hardcoded "$" everywhere.
  const [settingsCurrency, setSettingsCurrency] = useState<string>('USD');
  // The DJ's sales-tax % (only when they've turned tax ON) — shows a Tax line
  // on cards for both DJ types.
  const [taxPct, setTaxPct] = useState<number>(0);
  // Paid-subscriber flag — the Schedule Graphic tool is premium-only. Uses the
  // app's standard access check: sub_status 'active' or 'grace'.
  const [isPaid, setIsPaid] = useState(false);
  /**
   * Pro (tier 2) — the suite lib/access calls "contracts / deposits / event
   * info sheet". The Planner & Playlist IS the event info sheet.
   *
   * Deliberately NOT `isPaid`. isPaid is sub_status active|grace, which a
   * tier-1 DJ satisfies — they're paying, just not for this. Gating the
   * planner on isPaid would offer Request to someone the server is about to
   * refuse, so the button would work exactly until it didn't.
   *
   * This is a courtesy, not the paywall. The paywall is in
   * /api/planner/request, because anyone can POST there directly.
   */
  const [canPro, setCanPro] = useState(false);
  // Whether the DJ requires a signed contract per booking — drives the Contract
  // segment in each row's status strip.
  const [requireContract, setRequireContract] = useState(false);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.from('users').select('booking_settings, sub_status, sub_tier, sub_period_end, comp_tier, comp_expires_at, comp_source').eq('id', userId).maybeSingle();
        const row = data as (AccessFields & { booking_settings?: string | null; sub_status?: string | null }) | null;
        const raw = row?.booking_settings;
        const bs = (typeof raw === 'string' ? JSON.parse(raw) : (raw || {})) as { club_deposit_pct?: number; tax_enabled?: boolean; tax_pct?: number; require_contract?: boolean };
        if (!active) return;
        const ss = row?.sub_status;
        setIsPaid(ss === 'active' || ss === 'grace');
        // Same helper the server gate uses, so the row and /api/planner/request
        // can't come to different conclusions about the same DJ.
        setCanPro(!!row && canUsePro(row));
        setRequireContract(!!bs?.require_contract);
        {
          const c = (bs as { rate_currency?: string })?.rate_currency;
          if (c) setSettingsCurrency(c);
        }
        if (djType === 'club') {
          const v = Number(bs?.club_deposit_pct);
          if (Number.isFinite(v) && v > 0) setClubDepositPct(v);
        } else {
          const v = Number((bs as { mob_deposit_pct?: number })?.mob_deposit_pct);
          if (Number.isFinite(v) && v > 0) setMobDepositPct(v);
        }
        if (bs?.tax_enabled) {
          const t = Number(bs?.tax_pct);
          if (Number.isFinite(t) && t > 0) setTaxPct(t);
        }
      } catch { /* ignore — no deposit/tax shown */ }
    })();
    return () => { active = false; };
  }, [djType, userId]);
  // Sort mode for the list: 'date' (default — soonest event first, grouped by
  // month) or 'recent' (most recently booked first, flat list).
  const [sortMode, setSortMode] = useState<'date' | 'recent'>('date');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showStory, setShowStory] = useState(false);
  // Site-uniform confirm dialog — replaces window.confirm() for delete.
  const { confirm, confirmDialog } = useConfirm();
  // When set, the modal opens in edit mode prefilled with this booking's data.
  // Mutually exclusive with showAddModal — opening one closes the other.
  const [editing, setEditing] = useState<UpcomingBooking | null>(null);
  /**
   * The edit modal was opened by "Add host details…", not by the pencil.
   *
   * Same modal either way, but the intent is different and the modal opens
   * scrolled to the top with Host Details below the fold — so arriving from
   * "Add host details" landed you on a form that looked exactly like the one
   * you'd have got from the pencil, with no sign of the thing you came for.
   *
   * Not derived from "host details are missing": that's true when you click the
   * pencil to fix a typo in the date too, and yanking the scroll position to a
   * block you didn't ask about is its own annoyance. The flag records that you
   * asked.
   */
  const [focusHost, setFocusHost] = useState(false);
  // Optional date to prefill into the add modal when it opens. Set when the
  // page is loaded with `?addManual=YYYY-MM-DD` (used by the public profile
  // calendar's "Add Booking Details" button so the date is already populated).
  const [prefillDate, setPrefillDate] = useState<string>('');
  // When set, after the modal saves successfully we redirect to this URL
  // (typically the profile calendar that opened the modal). Lets the owner
  // edit a booking inline without losing their place on the public profile.
  const [returnToUrl, setReturnToUrl] = useState<string>('');

  // Read URL params on mount: ?addManual=YYYY-MM-DD opens the add modal with
  // that date already populated. If a booking already exists on that date,
  // we open the EDIT modal for it instead so the owner sees their previously
  // entered details. ?returnTo=/path sends them back to that URL after save.
  // Existing mount-only flow: ?addManual=<date> + ?returnTo=. Kept as a
  // one-shot effect because it depends on `initialBookings` snapshot.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const addManual = params.get('addManual');
    const returnTo = params.get('returnTo');
    if (returnTo) setReturnToUrl(returnTo);
    if (addManual) {
      const existing = initialBookings.find(
        (b) => b.event_date === addManual && b.is_manual,
      );
      if (existing) {
        setEditing(existing);
      } else {
        setPrefillDate(addManual);
        setShowAddModal(true);
      }
      const url = new URL(window.location.href);
      url.searchParams.delete('addManual');
      url.searchParams.delete('returnTo');
      window.history.replaceState(null, '', url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ?add=1 — fired from the header DJ-menu's "Add Booking Manually" option.
  // Watches the URL via Next's useSearchParams so it fires on EVERY URL
  // change, including when the user is already on /upcoming-bookings and
  // taps the dropdown again (which doesn't remount the component).
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams?.get('add') === '1') {
      setShowAddModal(true);
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.delete('add');
        window.history.replaceState(null, '', url.toString());
      }
    }
  }, [searchParams]);

  // Group by month (YYYY-MM). Upcoming: soonest month first, ascending dates.
  // Archive (Past): most-recent month first, most-recent date first.
  const grouped = useMemo(() => {
    const map = new Map<string, UpcomingBooking[]>();
    for (const b of bookings) {
      if (!b.event_date) continue;
      const key = b.event_date.slice(0, 7);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    }
    for (const arr of map.values()) arr.sort((a, b) => (a.event_date || '').localeCompare(b.event_date || ''));
    const entries = Array.from(map.entries());
    if (archive) {
      entries.sort((a, b) => b[0].localeCompare(a[0]));
      for (const [, arr] of entries) arr.reverse();
      return entries;
    }
    return entries.sort((a, b) => a[0].localeCompare(b[0]));
  }, [bookings, archive]);

  // Flat list sorted by most recently booked first (created_at desc). Used
  // when the sort toggle is set to "Recently booked".
  const recentList = useMemo(() => {
    return [...bookings]
      .filter((b) => b.event_date)
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }, [bookings]);

  // IDs of bookings whose time range overlaps another booking on the SAME
  // date — CLUB/BAR DJs only (a club DJ can't be in two places at once).
  // Mobile DJs can accept multiple same-day bookings, so this is empty for
  // them. Times are "HH:MM"; an end at/before start wraps past midnight.
  const overlapIds = useMemo(() => {
    if (djType !== 'club') return new Set<string>();
    const toRange = (b: UpcomingBooking): [number, number] | null => {
      if (!b.start_time || !b.end_time) return null;
      const [sh, sm] = b.start_time.split(':').map(Number);
      const [eh, em] = b.end_time.split(':').map(Number);
      if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
      const start = sh * 60 + sm;
      let end = eh * 60 + em;
      if (end <= start) end += 24 * 60; // wraps past midnight
      return [start, end];
    };
    const byDate = new Map<string, UpcomingBooking[]>();
    for (const b of bookings) {
      if (!b.event_date) continue;
      if (!byDate.has(b.event_date)) byDate.set(b.event_date, []);
      byDate.get(b.event_date)!.push(b);
    }
    const ids = new Set<string>();
    for (const sameDay of byDate.values()) {
      if (sameDay.length < 2) continue;
      for (let i = 0; i < sameDay.length; i++) {
        for (let j = i + 1; j < sameDay.length; j++) {
          const r1 = toRange(sameDay[i]);
          const r2 = toRange(sameDay[j]);
          if (!r1 || !r2) continue;
          // Overlap when one starts before the other ends, both ways.
          if (r1[0] < r2[1] && r2[0] < r1[1]) {
            ids.add(sameDay[i].id);
            ids.add(sameDay[j].id);
          }
        }
      }
    }
    return ids;
  }, [bookings, djType]);

  function monthLabel(key: string): string {
    const [y, m] = key.split('-').map((s) => parseInt(s, 10));
    const date = new Date(y, m - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
  }

  async function handleAdded(newBooking: UpcomingBooking) {
    setBookings((prev) => {
      const next = [...prev, newBooking];
      next.sort((a, b) => {
        const da = (a.event_date || '') + ' ' + (a.start_time || '');
        const db = (b.event_date || '') + ' ' + (b.start_time || '');
        return da.localeCompare(db);
      });
      return next;
    });
    setShowAddModal(false);
    // If we were opened via ?returnTo (typically from the public calendar),
    // bounce back so the owner doesn't lose context.
    if (returnToUrl && typeof window !== 'undefined') {
      window.location.href = returnToUrl;
    }
  }

  // Replace an existing booking in local state with the updated row. Re-sorts
  // in case the date/time changed and the row needs to move months.
  async function handleUpdated(updated: UpcomingBooking) {
    setBookings((prev) => {
      const next = prev.map((b) => (b.id === updated.id ? updated : b));
      next.sort((a, b) => {
        const da = (a.event_date || '') + ' ' + (a.start_time || '');
        const db = (b.event_date || '') + ' ' + (b.start_time || '');
        return da.localeCompare(db);
      });
      return next;
    });
    setEditing(null);
    if (returnToUrl && typeof window !== 'undefined') {
      window.location.href = returnToUrl;
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: 'Delete this manual booking?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!ok) return;
    const supabase = createClient();
    const { error } = await supabase.from('bookings').delete().eq('id', id).eq('dj_id', userId);
    if (error) { alert('Delete failed: ' + error.message); return; }
    setBookings((prev) => prev.filter((b) => b.id !== id));
  }

  return (
    <div className={styles.page}>
      {confirmDialog}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{archive ? 'Past Bookings' : 'Upcoming Bookings'}</h1>
          <Link href={archive ? '/upcoming-bookings' : '/booking-requests'} className={styles.backLink}>
            {archive ? '← Back to upcoming bookings' : '← Back to booking requests'}
          </Link>
        </div>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          {!archive && (
            <button type="button" onClick={() => setShowAddModal(true)} className={styles.addBtn}>
              + Add Booking Manually
            </button>
          )}
        </div>
      </div>

      {!archive && bookings.length > 0 && (
        <div className={styles.sortBar} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={styles.sortLabel}>Sort:</span>
          <button
            type="button"
            className={`${styles.sortBtn} ${sortMode === 'date' ? styles.sortBtnActive : ''}`}
            onClick={() => setSortMode('date')}
          >
            By date
          </button>
          <button
            type="button"
            className={`${styles.sortBtn} ${sortMode === 'recent' ? styles.sortBtnActive : ''}`}
            onClick={() => setSortMode('recent')}
          >
            Recently booked
          </button>
          {!archive && djType === 'club' && isPaid && (
            <button
              type="button"
              onClick={() => setShowStory(true)}
              style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--neon,#00e0a4)', fontWeight: 700, fontSize: '.8rem', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3, padding: 0, letterSpacing: '.03em' }}
            >
              📅 Generate graphic of schedule
            </button>
          )}
        </div>
      )}

      {bookings.length === 0 ? (
        <div className={styles.empty}>
          {archive ? (
            <>
              <p>No past bookings yet.</p>
              <p className={styles.emptyHint}>Once an event date passes, the booking moves here so you keep a record of it.</p>
            </>
          ) : (
            <>
              <p>No upcoming bookings yet.</p>
              <p className={styles.emptyHint}>
                Approved booking requests show up here automatically. You can also add bookings
                manually using the button above.
              </p>
            </>
          )}
        </div>
      ) : sortMode === 'recent' ? (
        <div className={`${styles.monthList} ${djType === 'club' ? styles.monthListClub : ''}`}>
          <ColumnHeaders djType={djType} />
          <div className={styles.monthItems}>
            {recentList.map((b) => (
              <BookingRow
                key={b.id}
                booking={b}
                djType={djType}
                userId={userId}
                clubDepositPct={clubDepositPct}
                taxPct={taxPct}
                requireContract={requireContract}
                archive={archive}
                payments={paymentsMap[b.id] || []}
                onPaymentsChange={handlePaymentsChange}
                canPro={canPro}
                planner={plannerMap[b.id]}
                onPlannerChange={handlePlannerChange}
                overlaps={overlapIds.has(b.id)}
                onDelete={b.is_manual ? () => handleDelete(b.id) : undefined}
                onEdit={!archive && b.is_manual ? () => setEditing(b) : undefined}
                onAddHost={!archive && b.is_manual ? () => { setEditing(b); setFocusHost(true); } : undefined}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className={`${styles.monthList} ${djType === 'club' ? styles.monthListClub : ''}`}>
          {grouped.map(([monthKey, items]) => (
            <section key={monthKey} className={styles.month}>
              <h2 className={styles.monthLabel}>{monthLabel(monthKey)}</h2>
              {/* Headers under EVERY month, not once at the top. A month of
                  bookings is taller than a viewport, and a header you've
                  scrolled past isn't labelling anything. Costs one row. */}
              <ColumnHeaders djType={djType} />
              <div className={styles.monthItems}>
                {items.map((b) => (
                  <BookingRow
                    key={b.id}
                    booking={b}
                    djType={djType}
                    userId={userId}
                    clubDepositPct={clubDepositPct}
                    taxPct={taxPct}
                    requireContract={requireContract}
                    archive={archive}
                    payments={paymentsMap[b.id] || []}
                    onPaymentsChange={handlePaymentsChange}
                    canPro={canPro}
                planner={plannerMap[b.id]}
                    onPlannerChange={handlePlannerChange}
                    overlaps={overlapIds.has(b.id)}
                    onDelete={b.is_manual ? () => handleDelete(b.id) : undefined}
                    onEdit={!archive && b.is_manual ? () => setEditing(b) : undefined}
                onAddHost={!archive && b.is_manual ? () => { setEditing(b); setFocusHost(true); } : undefined}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {showStory && isPaid && (
        <MonthlyStory
          bookings={bookings}
          djName={djName}
          userId={userId}
          onClose={() => setShowStory(false)}
        />
      )}

      {(showAddModal || editing) && (
        <AddManualBookingModal
          userId={userId}
          djType={djType}
          djCountry={djCountry}
          djName={djName}
          bookingsPerDay={bookingsPerDay}
          mobPackages={mobPackages}
          existingBookings={bookings}
          existing={editing}
          focusHost={focusHost}
          prefillDate={prefillDate}
          taxEnabledDefault={taxPct > 0}
          taxPctDefault={taxPct}
          depositPctDefault={djType === 'club' ? clubDepositPct : mobDepositPct}
          settingsCurrency={settingsCurrency}
          onClose={() => { setShowAddModal(false); setEditing(null); setPrefillDate(''); setFocusHost(false); }}
          onAdded={handleAdded}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
}
