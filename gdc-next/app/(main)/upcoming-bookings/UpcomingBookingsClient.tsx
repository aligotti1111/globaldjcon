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

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { searchAddresses, MOB_EVENT_TYPE_LABELS, EVENT_SUBFIELDS, buildEventDetails, getPackageCategory, hoursBetween, durationLabel } from '../[slug]/mobileBookingForm';
import { type MobilePackage, packageTiers } from '../[slug]/bookingSettings';
import { COUNTRIES, COUNTRY_CODES_ADDR } from '../account-settings/helpers';

// Country flag emojis — matches the homepage country picker so the look
// is consistent across the app. Maps country name → flag emoji; defaults
// to a globe for unknown entries.
const COUNTRY_FLAGS: Record<string, string> = {
  'United States': '🇺🇸', 'United Kingdom': '🇬🇧', 'Canada': '🇨🇦',
  'Australia': '🇦🇺', 'Germany': '🇩🇪', 'France': '🇫🇷', 'Netherlands': '🇳🇱',
  'Spain': '🇪🇸', 'Italy': '🇮🇹', 'Brazil': '🇧🇷', 'Mexico': '🇲🇽',
  'Japan': '🇯🇵', 'South Africa': '🇿🇦', 'New Zealand': '🇳🇿',
  'Ireland': '🇮🇪', 'Sweden': '🇸🇪', 'Norway': '🇳🇴', 'Denmark': '🇩🇰',
  'Belgium': '🇧🇪', 'Switzerland': '🇨🇭', 'Portugal': '🇵🇹', 'Other': '🌍',
};
import styles from './upcomingBookings.module.css';
import type { UpcomingBooking, BookingPayment } from './page';
import NotesFeed from '@/components/NotesFeed';
import ContractSendModal from './ContractSendModal';
import ContractPortal from '../update-dj-profile/ContractPortal';
import PaymentMethodsSection from '../update-dj-profile/PaymentMethodsSection';
import MonthlyStory from './MonthlyStory';
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
}

// Mobile-DJ event types — kept in sync with the public booking form (and
// EVENT_SUBFIELDS) by deriving from the canonical label map, so the same
// options + conditional sub-fields appear here as on the booking page.
const MOBILE_EVENT_TYPES: Array<{ value: string; label: string }> =
  Object.entries(MOB_EVENT_TYPE_LABELS).map(([value, label]) => ({ value, label }));

const CLUB_VENUE_TYPES: Array<{ value: string; label: string }> = [
  { value: 'bar', label: 'Bar' },
  { value: 'club', label: 'Club' },
];

const CLUB_SET_TYPES: Array<{ value: string; label: string }> = [
  { value: 'opening', label: 'Opening' },
  { value: 'headliner', label: 'Headliner' },
  { value: 'closing', label: 'Closing' },
  { value: 'opening_and_closing', label: 'Opening + Closing' },
];

// Build 48 half-hour time options ("12:00 AM" → "11:30 PM"). Each option's
// value is HH:MM (24h, to store cleanly), label is 12h-with-AM/PM for display.
const TIME_OPTIONS: Array<{ value: string; label: string }> = (() => {
  const out: Array<{ value: string; label: string }> = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      const value = `${hh}:${mm}`;
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = ((h % 12) || 12);
      const label = `${h12}:${mm} ${ampm}`;
      out.push({ value, label });
    }
  }
  return out;
})();

export default function UpcomingBookingsClient({
  userId, djType, djCountry, djName, bookingsPerDay, initialBookings, mobPackages, archive = false,
  initialPayments,
}: Props) {
  const [bookings, setBookings] = useState<UpcomingBooking[]>(initialBookings);
  // Payment ledger rows per booking (booking_payments). Owned at the top so a
  // row's expanded panel can update after request/confirm/waive without a
  // refetch, and so collapse/expand doesn't lose the fresh state.
  const [paymentsMap, setPaymentsMap] = useState<Record<string, BookingPayment[]>>(initialPayments || {});
  function handlePaymentsChange(bookingId: string, rows: BookingPayment[]) {
    setPaymentsMap((prev) => ({ ...prev, [bookingId]: rows }));
  }
  // The DJ's standing club deposit % (from booking_settings). Lets club
  // booking cards show the deposit even when it wasn't stored per-booking —
  // matching what the contract applies.
  const [clubDepositPct, setClubDepositPct] = useState<number>(0);
  // The DJ's sales-tax % (only when they've turned tax ON) — shows a Tax line
  // on cards for both DJ types.
  const [taxPct, setTaxPct] = useState<number>(0);
  // Paid-subscriber flag — the Schedule Graphic tool is premium-only. Uses the
  // app's standard access check: sub_status 'active' or 'grace'.
  const [isPaid, setIsPaid] = useState(false);
  // Whether the DJ requires a signed contract per booking — drives the Contract
  // segment in each row's status strip.
  const [requireContract, setRequireContract] = useState(false);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.from('users').select('booking_settings, sub_status').eq('id', userId).maybeSingle();
        const row = data as { booking_settings?: string | null; sub_status?: string | null } | null;
        const raw = row?.booking_settings;
        const bs = (typeof raw === 'string' ? JSON.parse(raw) : (raw || {})) as { club_deposit_pct?: number; tax_enabled?: boolean; tax_pct?: number; require_contract?: boolean };
        if (!active) return;
        const ss = row?.sub_status;
        setIsPaid(ss === 'active' || ss === 'grace');
        setRequireContract(!!bs?.require_contract);
        if (djType === 'club') {
          const v = Number(bs?.club_deposit_pct);
          if (Number.isFinite(v) && v > 0) setClubDepositPct(v);
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
          onClose={() => { setShowAddModal(false); setEditing(null); setPrefillDate(''); setFocusHost(false); }}
          onAdded={handleAdded}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// BookingRow — single-line summary for one booking in the month list.
// ───────────────────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────────────────
// FlyerSlot — add / view / remove / replace / download an event flyer on a
// club booking. Same flyer + storage as the host-side flyer on the
// Upcoming Events page (bookings.flyer_url, 'avatars' bucket). Controlled:
// the parent owns flyerUrl so the row slot and the in-card thumbnail stay
// in sync. `size` switches between the row slot and the smaller in-card one.
// ───────────────────────────────────────────────────────────────────────

function FlyerSlot({
  bookingId, userId, flyerUrl, onChange, size = 'row', readOnly = false,
}: {
  bookingId: string;
  userId: string;
  flyerUrl: string | null;
  onChange: (url: string | null) => void;
  size?: 'row' | 'card';
  // Archive/past view: show an existing flyer (view + download) but no add,
  // replace, or remove controls.
  readOnly?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const boxClass = size === 'card' ? styles.flyerBoxCard : styles.flyerBoxRow;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const supabase = createClient();
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${userId}/flyers/${bookingId}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadErr) throw uploadErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = `${data.publicUrl}?t=${Date.now()}`;
      // DJ-side update — this view belongs to the DJ, so key on dj_id.
      const { error: updErr } = await supabase
        .from('bookings')
        .update({ flyer_url: publicUrl } as unknown as never)
        .eq('id', bookingId)
        .eq('dj_id', userId);
      if (updErr) throw updErr;
      onChange(publicUrl);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleRemove() {
    const ok = await confirm({
      title: 'Remove this flyer?',
      message: 'The flyer will be removed from this booking.',
      confirmLabel: 'Remove',
      cancelLabel: 'Keep',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('bookings')
        .update({ flyer_url: null } as unknown as never)
        .eq('id', bookingId)
        .eq('dj_id', userId);
      if (error) throw error;
      onChange(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Remove failed');
    }
  }

  async function handleDownload() {
    if (!flyerUrl) return;
    try {
      const res = await fetch(flyerUrl);
      const blob = await res.blob();
      const ext = flyerUrl.split('?')[0].split('.').pop() || 'jpg';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flyer-${bookingId}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Fallback — open in a new tab if the blob download fails.
      window.open(flyerUrl, '_blank');
    }
  }

  if (readOnly && !flyerUrl) return null;

  return (
    <div className={styles.flyerInline}>
      {flyerUrl ? (
        <div className={styles.flyerWithActions}>
          <div className={`${styles.flyerThumbWrap} ${boxClass}`}>
            <button
              type="button"
              className={styles.flyerThumbBtn}
              onClick={() => setShowLightbox(true)}
              title="View flyer"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={flyerUrl} alt="Event flyer" className={styles.flyerThumbImg} />
            </button>
            {/* Overlaid controls — pencil replaces the flyer, ✕ removes it.
                Hidden in archive/read-only mode. */}
            {!readOnly && (
              <>
                <button
                  type="button"
                  className={`${styles.flyerOverlayBtn} ${styles.flyerOverlayEdit}`}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title="Replace flyer"
                  aria-label="Replace flyer"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`${styles.flyerOverlayBtn} ${styles.flyerOverlayDelete}`}
                  onClick={handleRemove}
                  title="Remove flyer"
                  aria-label="Remove flyer"
                >
                  ✕
                </button>
              </>
            )}
          </div>
          {/* Download icon — card variant only. */}
          {size === 'card' && (
            <button
              type="button"
              className={styles.flyerDownloadIcon}
              onClick={handleDownload}
              title="Download flyer"
              aria-label="Download flyer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          className={`${styles.flyerAddBtn} ${boxClass}`}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="Upload flyer"
        >
          {uploading ? '…' : '+ Flyer'}
        </button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      {showLightbox && flyerUrl && (
        <div
          className={styles.flyerLightbox}
          onClick={() => setShowLightbox(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className={styles.flyerLightboxInner} onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={flyerUrl} alt="Event flyer" className={styles.flyerLightboxImg} />
            <div className={styles.flyerLightboxActions}>
              <button type="button" className={styles.flyerLink} onClick={handleDownload}>
                Download
              </button>
              {!readOnly && (
                <button
                  type="button"
                  className={styles.flyerLinkMuted}
                  onClick={async () => { await handleRemove(); setShowLightbox(false); }}
                >
                  Remove
                </button>
              )}
              <button
                type="button"
                className={styles.flyerLinkMuted}
                onClick={() => setShowLightbox(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

// Pipeline colours. Named because they carry meaning, and the meaning has to
// stay identical in three places (icon, label, connector).
// What the pipeline can ask BookingDetails to do about a contract. Named so
// the two components can't drift on the strings.
type ContractAction = 'open' | 'download' | 'download-audit' | 'resend' | 'cancel' | 'copy-link';

// Module-level money formatter. BookingDetails and PaymentsBlock each have
// their own local money() — BookingRow had none, so the deposit modal below
// couldn't use either without a ReferenceError at open time.
function fmtMoney(n: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

const NEON = '#00e0a4';   // done
const AMBER = '#f5a623';  // needs the DJ to do something
const MUTED = 'rgba(255,255,255,.32)'; // not reached yet

/**
 * Money for the 9.5px caption under an icon — "$300/$600", not "$300.00/$600.00".
 *
 * fmtMoney always renders 2dp, which is right in the dropdown and in the ledger
 * where the exact figure is the point. Here it isn't: two of them plus a slash
 * is "$544.38/$544.38" — 15 characters in a 96px column, at a size where every
 * character costs. Whole amounts drop the ".00"; anything with real cents keeps
 * them, because $81.66 rounded to $82 in a money column is a lie.
 */
function capMoney(n: number, currency = 'USD'): string {
  const whole = Math.abs(n % 1) < 0.005;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(n);
  } catch {
    return whole ? `$${Math.round(n)}` : `$${n.toFixed(2)}`;
  }
}

/**
 * What a booking is worth, tax included — the number the client actually owes.
 *
 * WHY THIS EXISTS RATHER THAN JUST READING total_with_tax:
 * total_with_tax is a FROZEN SNAPSHOT written when the booking was created. If
 * the price changed afterwards — an accepted counter, an edited manual rate —
 * the snapshot still describes the OLD price and is simply wrong.
 *
 * The expanded details panel already knows this and recomputes when the
 * snapshot has gone stale. The row header did not: it read total_with_tax
 * blindly, so a renegotiated booking would show one total on the row and a
 * different one in the panel that opens directly underneath it. Two numbers,
 * same booking, six pixels apart.
 *
 * This is that same logic, extracted, so the two cannot drift.
 *
 * The freeze rule still holds throughout: a stale snapshot is recomputed using
 * the booking's OWN frozen tax_pct, never the DJ's current tax settings.
 * Changing your tax rate today must never re-price a booking you agreed in
 * March. Only legacy rows with no snapshot at all (tax_pct null) fall back to
 * the live settings pct, with the old whole-dollar rounding they were made with.
 *
 * Returns null when there's no agreed price at all (a manual add with no rate).
 * Null renders as empty — zero is a price, "we never said" isn't.
 */
function bookingTotalWithTax(
  booking: UpcomingBooking,
  liveTaxPct: number,
): number | null {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const agreed = booking.counter_rate ?? booking.quoted_rate ?? booking.offer_amount ?? null;
  if (agreed == null) return null;

  const snapTaxPct = booking.tax_pct != null ? Number(booking.tax_pct) : null;
  const snapTaxAmount = booking.tax_amount != null ? Number(booking.tax_amount) : null;
  const snapTotal = booking.total_with_tax != null ? Number(booking.total_with_tax) : null;

  // The pre-tax base the snapshot was computed on. "Fresh" = it still matches
  // the current agreed price, so the stored amounts are the truth.
  const snapBase = (snapTaxAmount != null && snapTotal != null)
    ? round2(snapTotal - snapTaxAmount)
    : null;
  const snapshotFresh =
    snapBase != null && Math.abs(Number(agreed) - snapBase) < 0.005;
  if (snapshotFresh) return snapTotal;

  const effTaxPct = snapTaxPct ?? liveTaxPct;
  if (!(effTaxPct > 0)) return round2(Number(agreed));
  const tax = snapTaxPct != null
    ? round2((Number(agreed) * effTaxPct) / 100)
    : Math.round((Number(agreed) * effTaxPct) / 100);
  return round2(Number(agreed) + tax);
}

/**
 * The status columns, left to right — the order a booking actually moves
 * through, and the reason every row lines up with the one above it.
 *
 * This is the layout contract: the header cells and the row cells both read
 * it, so a column can't exist in one and not the other. Each key must match a
 * step key exactly; a typo here silently blanks that column for every booking
 * on the page, which reads as "no contracts exist" rather than as a bug.
 *
 * WHY 'accepted' IS GONE: it was the first column and it was green on every
 * single row, because a booking can't be on this page without being booked. A
 * column that never varies isn't information — it was spending a quarter of the
 * width to tell you nothing.
 *
 * WHY 'invoice' IS LAST: it's a receipt. It cannot do anything until money has
 * actually landed, so it can only ever react to the deposit column to its left.
 * Its position is the sequence.
 *
 * 'deposit' (not 'payment') and 'song_list' (not 'playlist') because
 * /api/bookings/status-override whitelists ['contract','deposit','song_list']
 * server-side and rejects anything else. The key is what the server already
 * trusts; the column header is what the DJ reads. They don't have to match.
 */
const PIPE_SLOTS = ['contract', 'deposit', 'song_list', 'invoice'] as const;

/** Column headings, in PIPE_SLOTS order. Rendered by ColumnHeaders. */
const PIPE_HEADS: Record<(typeof PIPE_SLOTS)[number], string> = {
  contract: 'Contract',
  deposit: 'Deposit',
  song_list: 'Playlist',
  invoice: 'Invoice',
};

/**
 * The column headers, repeated under every month heading.
 *
 * Repeated, not rendered once at the top: a month of bookings is taller than a
 * viewport, and headers you've scrolled past are headers that aren't doing
 * their job. Costs one row per month.
 *
 * Shares .row's grid via the --row-cols custom property rather than repeating
 * the track list, because two copies of nine widths drift apart the first time
 * anyone touches one of them.
 */
function ColumnHeaders({ djType }: { djType: 'club' | 'mobile' }) {
  return (
    <div className={styles.colHeads} aria-hidden="true">
      <span>Date</span>
      {djType === 'club' && <span />}
      <span>Time</span>
      <span>Event</span>
      <span className={styles.headRight}>Value</span>
      {PIPE_SLOTS.map((k) => <span key={k}>{PIPE_HEADS[k]}</span>)}
      {/* Two empty cells: the actions track and the chevron track. Unlabelled
          on purpose — "Actions" over a column that's blank on most rows is
          noise — but they MUST be here. The header shares .row's track list,
          so a missing cell doesn't leave a gap at the end, it shifts every
          heading one column left and silently mislabels the whole table. */}
      <span />
      <span />
    </div>
  );
}

function BookingRow({
  booking, djType, userId, clubDepositPct, taxPct, requireContract, archive, payments, onPaymentsChange, overlaps, onDelete, onEdit, onAddHost,
}: {
  booking: UpcomingBooking;
  djType: 'club' | 'mobile';
  userId: string;
  clubDepositPct: number;
  taxPct: number;
  requireContract: boolean;
  archive?: boolean;
  payments: BookingPayment[];
  onPaymentsChange: (bookingId: string, rows: BookingPayment[]) => void;
  overlaps?: boolean;
  onDelete?: () => void;
  onEdit?: () => void;
  /**
   * Opens the SAME modal as onEdit, but scrolled to Host Details with the name
   * field focused and the block called out.
   *
   * A separate prop rather than a flag on onEdit because the two are different
   * intents that happen to share a form: the pencil means "change something",
   * this means "the thing blocking me is in there somewhere".
   */
  onAddHost?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Set true when the details panel's live DocuSeal check confirms the contract
  // is actually signed (covers rows whose stored status is still 'awaiting').
  const [signedOverride, setSignedOverride] = useState(false);
  // Manual step overrides (booking.status_overrides) — DJ can mark a step done
  // when it was handled outside the app. Optimistic UI + persisted via the API.
  const [overrides, setOverrides] = useState<Record<string, boolean>>(() => {
    const o = (booking as { status_overrides?: unknown }).status_overrides;
    return o && typeof o === 'object' ? { ...(o as Record<string, boolean>) } : {};
  });
  // Which step's mark-complete dropdown is open (by key), or null — plus the
  // viewport position to render it at (fixed, so the card's overflow can't clip it).
  const [menuOpenKey, setMenuOpenKey] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  /**
   * The button the open menu belongs to.
   *
   * The menu is position:fixed — i.e. positioned in VIEWPORT coordinates — from
   * a getBoundingClientRect() taken at the moment of the click. That rect is a
   * photograph, not a subscription: scroll one pixel and the row moves while
   * the menu stays exactly where it was, until it's floating in the middle of
   * somebody else's booking with no visible relationship to the icon it
   * belongs to.
   *
   * Fixed IS the right choice here — the menu has to escape .rowWrap's
   * `overflow: hidden` — but it has to re-anchor. Keeping the element lets the
   * effect below recompute against the live rect. Same pattern HeaderDjMenu
   * already uses, and for the same reason.
   */
  const menuBtnRef = useRef<HTMLElement | null>(null);

  // Re-anchor the open menu to its button on scroll and resize.
  // Capture phase (the `true`) matters: a scroll inside any ancestor container
  // doesn't bubble, so a listener on window without it never fires and the menu
  // silently detaches again in exactly the case that's hardest to notice.
  useEffect(() => {
    if (!menuOpenKey) return;
    function compute() {
      const el = menuBtnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    }
    compute();
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [menuOpenKey]);
  // The pipeline's contract actions live here (BookingRow), but the portal and
  // the send/resend/cancel/download handlers are all owned by BookingDetails,
  // which only exists while the row is expanded.
  //
  // Rather than duplicate any of it up here — two copies of ContractPortal, or
  // a second cancelContract(), is two sources of truth and two places to fix a
  // bug — expand the row and hand Details a ONE-SHOT action. Details runs it
  // and clears the flag immediately, so closing the portal doesn't bounce it
  // straight back open.
  const [contractAction, setContractAction] = useState<ContractAction | null>(null);
  function runContract(a: ContractAction) {
    setExpanded(true);
    setContractAction(a);
  }

  // ── Deposit dropdown ──────────────────────────────────────────────────
  // Both modals live here rather than in PaymentsBlock (two components down)
  // because BookingRow already holds userId, payments and onPaymentsChange —
  // everything needed to post the request and fold the new row into state.
  const [reqOpen, setReqOpen] = useState(false);
  const [reqAmount, setReqAmount] = useState('');
  const [reqBusy, setReqBusy] = useState(false);
  const [reqErr, setReqErr] = useState<string | null>(null);
  const [methodsOpen, setMethodsOpen] = useState(false);

  // The booking's OWN frozen deposit — never recomputed from today's settings.
  const suggestedDeposit = booking.deposit_amount != null ? Number(booking.deposit_amount) : null;
  const depositRow = payments.find((p) => p.kind === 'deposit') || null;

  function openRequest() {
    setReqErr(null);
    setReqAmount(suggestedDeposit != null && suggestedDeposit > 0 ? String(suggestedDeposit) : '');
    setReqOpen(true);
  }

  async function submitRequest() {
    const amount = Number(reqAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setReqErr('Enter an amount greater than zero.');
      return;
    }
    setReqBusy(true);
    setReqErr(null);
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'request',
          bookingId: booking.id,
          kind: 'deposit',
          amount: Math.round(amount * 100) / 100,
        }),
      });
      // .text() first: a non-JSON body (a platform error page) would otherwise
      // become {} and surface as a shrug. Same lesson as the Stripe 502.
      const raw = await res.text();
      let json: { payment?: BookingPayment; error?: string } = {};
      try { json = JSON.parse(raw); } catch { /* handled below */ }
      if (!res.ok || !json.payment) {
        throw new Error(json.error || `HTTP ${res.status} — ${raw.slice(0, 120) || 'no response'}`);
      }
      onPaymentsChange(booking.id, [...payments, json.payment]);
      setReqOpen(false);
    } catch (e) {
      setReqErr(e instanceof Error ? e.message : 'Could not request the deposit.');
    } finally {
      setReqBusy(false);
    }
  }
  async function toggleStep(key: string, next: boolean) {
    setMenuOpenKey(null);
    setOverrides((prev) => { const n = { ...prev }; if (next) n[key] = true; else delete n[key]; return n; });
    try {
      await fetch('/api/bookings/status-override', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, key, done: next }),
      });
    } catch { /* keep optimistic UI; will reconcile on next load */ }
  }
  // Flyer URL owned here so the row slot and the in-card thumbnail
  // (both rendered for the same booking) stay in sync.
  const [flyerUrl, setFlyerUrl] = useState<string | null>(booking.flyer_url ?? null);
  const { day, dow, mo } = getDateParts(booking.event_date);
  // Header time range. When the booker added a cocktail hour, the row's
  // start reflects the cocktail-hour start (the DJ is engaged from then),
  // running through the event end. Otherwise it's the plain event window.
  const headerStart =
    booking.cocktail_needed && booking.cocktail_start_time
      ? booking.cocktail_start_time
      : booking.start_time;
  const timeRange = formatTimeRange(headerStart, booking.end_time);

  let context = '';
  if (djType === 'club') {
    // Club DJ rows: venue is shown only in the expanded details panel
    // — the row header stays minimal (date + time). No context line.
    context = '';
  } else {
    // Mobile DJ rows: show the event type only (e.g. "Wedding"). Venue
    // is shown in the expanded details panel.
    const ev = booking.event_type || '';
    const label = MOB_EVENT_TYPE_LABELS[ev] || MOBILE_EVENT_TYPES.find((e) => e.value === ev)?.label;
    context = label || (ev || 'Event');
  }

  // Booking readiness pipeline — compact icon steps driven by the DJ's settings.
  // Accepted always shows; Contract shows when the DJ requires it (or a contract
  // already exists). Deposit / Song-list steps slot in here later. Manual
  // add-ins (no counterparty) only ever show Accepted.
  type StepState = 'done' | 'pending' | 'void' | 'todo';
  const cstatus = (booking.contract_status as string | null | undefined) || null;
  // Use the booking's OWN snapshot of the requirement (frozen at creation) so
  // changing the DJ's setting later never re-shapes existing bookings. Falls
  // back to the live setting only for rows created before the snapshot existed.
  const needsContract = (booking as { requires_contract?: boolean | null }).requires_contract ?? requireContract;
  // Belt-and-braces for the disappearing contract stage. /api/contracts/cancel
  // now records 'cancelled' rather than nulling contract_status, so cstatus
  // stays truthy and the gate below passes on its own — but bookings cancelled
  // BEFORE that fix already have null in the column, and this keeps their stage
  // visible for the session rather than silently swallowing "Send contract".
  const [everHadContract, setEverHadContract] = useState(!!cstatus);
  useEffect(() => {
    if (cstatus) setEverHadContract(true);
  }, [cstatus]);
  // Contract-step completeness — the SAME rule the status strip uses:
  // genuinely signed (stored status or the panel's live DocuSeal check) OR
  // manually overridden via status_overrides (DJs often paper contracts
  // off-platform; never trap them behind a step the system can't observe).
  // Gates the Request Deposit action in the details panel below.
  const contractStepComplete = cstatus === 'signed' || signedOverride || !!overrides.contract;
  /**
   * Does this booking have somebody to send things TO?
   *
   * A booking that came through the app has a requester — an account, an email,
   * a name. A MANUAL booking has whatever the DJ typed, which may be nothing:
   * Host Name and Host Email are marked "(optional)" on the add form, and a DJ
   * adding a gig they already agreed over the phone has no reason to fill them.
   *
   * Both fields, not just the email. The email is who it goes to; the name is
   * who the contract is made out to. `prepare` falls back to the part of the
   * address before the @ when there's no name, so a contract with no host name
   * gets addressed to "jordan91" — which is nobody.
   */
  const hasHostContact =
    !!String((booking as { host_email?: string | null }).host_email || '').trim() &&
    !!String((booking as { requester_name?: string | null }).requester_name || '').trim();

  // Defined once, used by BOTH the pipeline's Request-deposit item and the
  // panel's Request Deposit button — they must never disagree about whether
  // asking for money is allowed yet.
  //
  // `is_manual` used to be the first clause on its own, which meant a manual
  // booking could ALWAYS request a deposit — gated on nothing. Including the
  // ones with no host email, where the request had no recipient and went
  // nowhere. The DJ clicked Request deposit, the UI said it was requested, and
  // nothing was ever sent.
  //
  // Manual bookings now need host contact instead of the contract gate (they
  // have no contract requirement to satisfy). The other two clauses are
  // untouched, so a real booking's path through here is exactly what it was.
  const canRequestDeposit = booking.is_manual
    ? hasHostContact
    : (!needsContract || contractStepComplete);
  // `color` is per-step, not derived from state alone: Contract goes YELLOW
  // when it's waiting on someone (an action the DJ can take), while Deposit
  // stays grey until it lands. Same state, different urgency — one shared
  // stepColor() couldn't say that.
  // `actions` are the dropdown's items for that step, in its current state.
  // `actions` are the dropdown's real options, and they change with the state:
  // an unsent contract offers "Review & send", a sent one offers resend/cancel,
  // a signed one offers download. Offering "Review & send" on a signed contract
  // — as it did — invites a DJ to overwrite an agreement both parties signed.
  const steps: {
    key: string; label: string; state: StepState;
    icon: 'doc' | 'money' | 'music' | 'receipt';
    overridable: boolean; done: boolean; color: string;
    /**
     * The small word under the icon. ONLY for states the icon can't say on its
     * own — a contract that's been sent but not signed is otherwise identical
     * to one that's sitting there unsent, and that difference is the whole
     * question a DJ has when they look at this column.
     *
     * Deliberately absent on 'done' and on 'nothing started': the green check
     * already says done, and a dimmed icon already says untouched. Captioning
     * every state would put a word under all four icons, which is the version
     * that read as a control panel.
     */
    caption?: string;
    /** A read-only line at the top of the dropdown — the amounts, for Deposit. */
    info?: string;
    /**
     * Why an action you'd expect isn't offered.
     *
     * Separate from `info` because it wraps: `info` is a single bold line and
     * the menu is white-space:nowrap, so a sentence in there stretches the
     * dropdown to the width of the sentence.
     *
     * This exists because a menu can silently omit an option — Request deposit
     * vanishes until the contract is signed — and an absent button explains
     * nothing. The DJ sees "Not sent", opens the menu to send it, and finds it
     * isn't there. The gate is right; being invisible is not.
     */
    hint?: string;
    actions?: { label: string; run: () => void; danger?: boolean }[];
  }[] = [];
  /*
    MANUAL BOOKINGS CAN HAVE A CONTRACT — this used to be `!booking.is_manual`,
    full stop, so the step never rendered for one no matter what.

    That wasn't a decision, it was a leftover. The expanded panel has offered
    "Review & Send Contract" on manual bookings this whole time (it gates on
    booking_type, which for a manual booking is the DJ's own type — always
    true). So you could send one; the strip just refused to ever say so. And
    because the exclusion ignored `cstatus` too, a manual booking's Contract
    column stayed a dash after sending, after signing, forever.

    NO hasHostContact GATE HERE, deliberately — I had one and it was wrong for
    the same reason the grayscale icon was wrong. A dash means "this stage does
    not apply to this booking". On a DJ who requires contracts, a contract very
    much applies; it's blocked, which is a different thing. Hiding the icon
    answered a question the DJ wasn't asking ("is there a contract stage?") and
    stayed silent on the one they were ("why can't I send it?").

    The step shows. The recipient gate lives in the caption and the dropdown —
    see `blockedNoHost` below — where it can name the problem and hand over the
    fix instead of just not being there.
  */
  const blockedNoHost = !!booking.is_manual && !hasHostContact;
  if (needsContract || !!cstatus || everHadContract || overrides.contract) {
    const trulySigned = cstatus === 'signed' || signedOverride;
    const isDone = trulySigned || !!overrides.contract;
    const cState: StepState =
      isDone ? 'done'
      : (cstatus === 'cancelled' || cstatus === 'voided') ? 'void'
      : (cstatus === 'awaiting_client' || cstatus === 'awaiting_dj') ? 'pending'
      : 'todo';
    // Contract is the one step the DJ can ACT on, so its label is a verb until
    // it's done. Not a status readout competing with the check — an instruction
    // that disappears once there's nothing left to do:
    //
    //   nothing sent yet / cancelled -> "Send contract"    (yellow, actionable)
    //   sent, waiting on a signature -> "Contract pending" (yellow, in flight)
    //   signed or marked complete    -> "Contract"         (green + check)
    //
    // Cancelled deliberately reads "Send contract" rather than a red dead-end:
    // the next move is to send a new one, which is what the panel below says.
    // 'Pending' means SENT and waiting on the client — awaiting_client only.
    // awaiting_dj is the opposite situation: the contract exists but the DJ
    // hasn't signed it yet, so it has NOT gone out. Lumping the two together
    // put "Contract pending" on bookings where nothing had been sent and the
    // DJ was the one holding it up — telling them to wait for someone else.
    const awaiting = cstatus === 'awaiting_client';
    const cLabel = isDone ? 'Contract' : awaiting ? 'Contract pending' : 'Send contract';
    steps.push({
      key: 'contract',
      label: cLabel,
      state: cState,
      icon: 'doc',
      // Overridable only when it isn't genuinely signed (can't un-sign a real one).
      overridable: !trulySigned,
      done: isDone,
      color: isDone ? NEON : AMBER,
      // ONE vocabulary across all four columns — see PIPE_SLOTS:
      //   not sent -> "Not sent"
      //   sent     -> "Pending"
      //   done     -> no caption; the green check is the word.
      //
      // The captions used to be per-column verbs ("Send", "Request"), which
      // meant each column had its own dialect and you had to learn four. A
      // shared vocabulary means you read the row once and know every column.
      //
      // 'awaiting' is awaiting_client ONLY. awaiting_dj means the contract
      // exists but the DJ hasn't signed it — it has NOT gone out, so it reads
      // "Not sent" and must not claim to be pending on someone else.
      caption: isDone ? undefined : awaiting ? 'Pending' : 'Not sent',
      // The dropdown offers what's actually possible RIGHT NOW:
      //
      //   signed        -> Download contract. Not "Review & send" — that
      //                    invited overwriting an agreement both sides signed.
      //   sent, pending -> Resend (client lost the email) or Cancel (void it
      //                    and start again). Sending a second contract behind
      //                    the first is how a client signs the wrong one.
      //   not sent yet  -> Review & send.
      //
      // Archive is read-only apart from downloading what was signed.
      actions: archive
        ? (trulySigned
            ? [
                { label: '\u2b07 Download contract', run: () => runContract('download') },
                { label: '\u2b07 Download audit log', run: () => runContract('download-audit') },
              ]
            : [])
        : trulySigned
          ? [
              { label: '\u2b07 Download contract', run: () => runContract('download') },
              // The audit log is the proof: who signed, from what IP, when.
              // It's the half of a signed contract that matters if the client
              // ever says "that wasn't me" — and it was buried in the panel.
              { label: '\u2b07 Download audit log', run: () => runContract('download-audit') },
            ]
          // Marked complete by hand: the DJ has said this stage is settled,
          // usually because it happened off-platform. Everything else here
          // contradicts that — cancelling a contract they've called done,
          // or handing out a sign-as-the-client link for an agreement that's
          // already agreed. The only honest option left is "Mark not
          // complete", which the override block below owns.
          : isDone
            ? []
            : awaiting
              ? [
                  { label: 'Resend contract', run: () => runContract('resend') },
                  // The DocuSeal email is the single point of failure in this
                  // whole flow — spam folder, typo'd address, corporate filter
                  // — and the DJ finds out by the contract never coming back.
                  // The link works regardless of whether the email landed.
                  { label: '\u{1F517} Copy link to contract', run: () => runContract('copy-link') },
                  { label: 'Cancel contract', run: () => runContract('cancel'), danger: true },
                ]
              // Nobody to send it to — offer the fix, not the dead end.
              // "Review & send" here walks the DJ through picking a template
              // and signing it, and only then does prepare come back with
              // NO_CLIENT_EMAIL. All that work to be told there's no recipient.
              : blockedNoHost
                ? (onAddHost || onEdit
                    ? [{ label: 'Add host details…', run: (onAddHost || onEdit) as () => void }]
                    : [])
                : [{ label: 'Review & send contract', run: () => runContract('open') }],
      // Named here rather than left to an absent button. The step is visible
      // precisely so it CAN say this.
      hint: blockedNoHost && !archive
        ? 'Add host email and name to send contract.'
        : undefined,
    });
  }
  // Payment step — shown when a deposit is part of THIS booking's pipeline,
  // greyed until it's settled. Two ways in:
  //
  //   1. the booking was created with a deposit (its own frozen snapshot), or
  //   2. money has already been requested on it.
  //
  // A DJ who doesn't take deposits never sees this icon at all — the pipeline
  // only shows the stages that booking actually has. And the gate reads the
  // BOOKING's snapshot, never the live setting: switching deposits on today
  // must not make last month's bookings sprout a step they never had. Same
  // freeze rule as requires_contract and tax_pct.
  //
  // Overridable, like the contract step — for money handled outside the app.
  //
  // The override marks the STAGE done; it never fabricates a payment row or an
  // amount. That distinction matters: the rails cap below a typical deposit
  // (unverified Venmo stops at $299.99/week), so partials are routine, and the
  // ledger below must keep showing what actually arrived — $299.99/$600 — even
  // while the strip says the stage is handled. Confirming an amount still
  // belongs to the details panel; this is only "stop asking me about it".
  /**
   * The Value column — what this booking is worth, tax included.
   *
   * Tax-INCLUSIVE on purpose: Value is what the client owes and what the
   * invoice will say. Bookings with no tax on them show the plain agreed rate,
   * because for those the rate IS the total — that's not an inconsistency in
   * the column, it's an accurate description of two different bookings.
   *
   * This was `booking.total_with_tax ?? counter_rate ?? ...`, which read the
   * frozen snapshot blind. See bookingTotalWithTax: on a renegotiated booking
   * that snapshot is stale, and the row would have quoted a different total
   * from the details panel opening directly beneath it.
   */
  const rowValue: number | null = bookingTotalWithTax(booking, taxPct);

  /*
    A booking that came through the app carries a frozen deposit snapshot
    (deposit_pct / deposit_amount) written at creation from the DJ's settings.
    That snapshot is what makes the Deposit step exist at all.

    A MANUAL booking has neither — the add form doesn't write a single deposit
    field (grep deposit_pct: / deposit_amount: — the insert payload has none).
    So `bookingHasDeposit` was false forever and the Deposit column was a dash
    on every manual booking, with no way to ask for money on a gig you'd typed
    in yourself.

    So: the step exists on every manual booking, host details or not. It was
    gated on hasHostContact and that was the same mistake as hiding the contract
    icon — a dash claims the stage doesn't apply, when really it's blocked. You
    can always ask for money on a gig you typed in yourself; you just need
    somewhere to send the request. That's the caption's job (see the hint and
    the "Add host details…" action below), not the column's.

    There's no snapshot to suggest an amount from — suggestedDeposit is null and
    the request modal opens blank — which is correct: nobody ever agreed a
    deposit percentage on this booking, so the DJ types what they actually want.
  */
  const bookingHasDeposit =
    booking.deposit_pct != null
    || booking.deposit_amount != null
    || !!booking.is_manual;
  // Only the DEPOSIT rows, not every payment on the booking.
  //
  // This step used to read `payments` whole. That was fine while deposit was
  // the only money column — but Invoice is its own column now, and an invoice
  // is a `kind: 'balance'` row sitting in the same array. Left as it was, a
  // sent-but-unpaid invoice would have dragged the DEPOSIT icon back out of
  // green: `payments.every(settled)` would go false because of a row that has
  // nothing to do with the deposit. The two columns have to read their own
  // rows or they lie about each other.
  const depositPays = payments.filter((p) => p.kind === 'deposit');
  if (depositPays.length > 0 || bookingHasDeposit || overrides.deposit) {
    const settled = (p: BookingPayment) => p.status === 'paid' || p.status === 'waived';
    // .every() is true for an empty array — a deposit that exists on the
    // booking but has never been requested would read as PAID. Require a row
    // before anything can be "done".
    const reallySettled = depositPays.length > 0 && depositPays.every(settled);
    // ...or the DJ marked it done by hand, for money that never went through
    // the app: cash on the night, a bank transfer, a client who paid before
    // any of this existed. The override says "this stage is handled" — it does
    // NOT invent a payment row or an amount, so the ledger stays honest about
    // what it actually saw.
    const allDone = reallySettled || !!overrides.deposit;
    // Three states, same shape as Contract: a verb while there's something to
    // do, the stage's name once it's done.
    //
    //   nothing requested -> "Request deposit"   (amber — your move)
    //   requested, unpaid -> "Deposit requested" (amber — it's out there)
    //   settled           -> "Deposit"           (green + check)
    //
    // Note what's NOT here: 'Paid'. It reads as settled-in-full while
    // amount_paid might be $299.99 of $600 — the rails cap below a typical
    // deposit, so partials are routine. The real numbers live in the ledger
    // below, which is the only place with room to be accurate.
    // 'Partially paid' is its own state, not a rounding of 'requested'. The
    // rails force it — unverified Venmo caps at $299.99/week against a typical
    // $600 deposit — so a client sending it in two goes is the normal path, not
    // an edge case. A DJ seeing "Deposit requested" on money that's half in has
    // no idea anything arrived.
    const anyPartial = depositPays.some((p) => Number(p.amount_paid || 0) > 0 && !settled(p));
    const pLabel = allDone
      ? 'Deposit'
      : anyPartial
        ? 'Partially paid'
        : depositRow
          ? 'Deposit requested'
          : 'Request deposit';

    // The numbers, for the dropdown. Deposit rows only — same reason as
    // depositPays above: totalling every payment would have this line report
    // the deposit and the invoice added together as if they were one ask.
    const paidSoFar = depositPays.reduce((sum, p) => sum + Number(p.amount_paid || 0), 0);
    const askedFor = depositPays.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const currency = booking.currency || 'USD';
    steps.push({
      // 'deposit', not 'payment': /api/bookings/status-override whitelists
      // ['contract','deposit','song_list'] and rejects anything else, so the
      // step key has to be the one the server already trusts.
      key: 'deposit',
      label: pLabel,
      state: allDone ? 'done' : 'todo',
      icon: 'money',
      // Same rule as the contract step: you can't un-do something real. If the
      // rows genuinely settled, the dropdown is gone — otherwise a DJ could
      // "mark not complete" on money that actually arrived and the strip would
      // contradict the ledger sitting right beneath it.
      overridable: !reallySettled,
      done: allDone,
      // Amber until settled. It was grey on the theory that an unpaid deposit
      // isn't the DJ's problem — but "Request deposit" plainly is their move,
      // and a request sitting unpaid is one they can chase. Grey said "nothing
      // to see here" about the money the booking exists to collect.
      color: allDone ? NEON : AMBER,
      // Same problem the contract had: "asked for and waiting" looks exactly
      // like "never asked" if all you have is an icon. A partial says so
      // outright, because half the money arriving is the normal path here (an
      // unverified Venmo caps at $299.99/week against a typical deposit) and a
      // DJ reading "Requested" on money that's half in has been misled.
      // Deposit is the one column that shows a NUMBER instead of a word, the
      // moment there is a number to show:
      //
      //   nothing requested        -> "Not sent"      amber
      //   requested, nothing in    -> "Pending"       amber
      //   part of it landed        -> "$300/$600"     amber — not total
      //   all of it landed         -> "$600/$600"     neon  — total
      //
      // This replaces "Part paid", which was true but useless: it told a DJ
      // money had arrived without telling them how much, so they had to open
      // the dropdown to learn the one fact they wanted. The fraction says the
      // same thing and answers the question in the same glance. Partials are
      // routine here — an unverified Venmo caps at $299.99/week against a
      // typical deposit — so this is the normal case, not an edge case.
      //
      // The denominator is what was ASKED for, so "$600/$600" still reads as
      // settled-in-full rather than as an amount floating with no context.
      //
      // allDone IS CHECKED FIRST, and that ordering is the whole point.
      //
      // The bug it fixes: this used to branch on `depositRow` first and reach
      // 'Pending' whenever paidSoFar was 0 — but there are two settled states
      // where no money ever arrives:
      //   • WAIVED. `settled` counts 'waived', so the badge goes green while
      //     amount_paid stays 0.
      //   • marked complete by hand, for money that landed outside the app.
      // Both produced a green check AND the word "Pending" in the same cell.
      // The badge was reading the status, the caption was reading the payments,
      // and nothing was checking they agreed.
      //
      // Done means done. Show the fraction if there are real amounts to show,
      // otherwise say nothing and let the check carry it — "$0/$0" on a waived
      // deposit would be a lie about money that was never owed.
      caption: allDone
        ? (paidSoFar > 0
            ? `${capMoney(paidSoFar, currency)}/${capMoney(askedFor, currency)}`
            : undefined)
        : depositRow
          ? (paidSoFar > 0
              ? `${capMoney(paidSoFar, currency)}/${capMoney(askedFor, currency)}`
              : 'Pending')
          : 'Not sent',
      // Shown at the top of the dropdown, above the actions. Only once money
      // has actually been asked for — before that there's nothing to report.
      info: depositRow
        ? `${fmtMoney(paidSoFar, currency)} of ${fmtMoney(askedFor, currency)} received`
        : undefined,
      // The gate, said out loud — and there are TWO of them now, so it has to
      // say the right one. Telling a DJ to sign a contract on a manual booking
      // that has no contract is worse than saying nothing.
      //
      //   manual, no host contact -> nobody to send it to
      //   real booking, unsigned  -> no agreement yet
      //
      // Either way the menu used to enforce the rule by simply not rendering
      // the item, which tells the DJ nothing. They see "Not sent", open the menu
      // to send it, and find Payment options and Mark complete — no button, no
      // reason, no next step. An invisible rule reads as a broken app.
      // Same terse voice as the contract hint next to it — two blockers in the
      // same row shouldn't sound like they were written by different people.
      hint: (!depositRow && !canRequestDeposit && !archive)
        ? (blockedNoHost
            ? 'Add host email and name to request deposit.'
            : 'Contract must be signed to request deposit.')
        : undefined,
      actions: archive
        ? []
        : [
            // Only until it's been asked for. A second deposit request on the
            // same booking is two rows for one payment, and the ledger would
            // start double-counting what's owed.
            ...(!depositRow && canRequestDeposit
              ? [{ label: 'Request deposit', run: openRequest }]
              : []),
            // The way out of the gate, next to the reason for it.
            //
            // Naming a problem without offering the fix just moves the dead end
            // one click later. This opens the Add/Edit Manual Booking modal —
            // the same thing the row's pencil opens, which already has Host
            // Name, Host Email, and a "Send booking details to host" checkbox
            // wired to the invite email. Nothing new to build and nothing new
            // to learn; it just needs a door from where the DJ actually is.
            //
            // onEdit is only ever passed for manual, non-archive bookings (see
            // where BookingRow is used), so this can't appear anywhere else.
            ...(blockedNoHost && (onAddHost || onEdit)
              ? [{ label: 'Add host details…', run: (onAddHost || onEdit) as () => void }]
              : []),
            // The rails the client will be offered. Reachable from the booking
            // because that's where a DJ realises the client can't pay the way
            // they've set up — not from Booking Settings three pages away.
            { label: 'Payment options', run: () => setMethodsOpen(true) },
          ],
    });
  }

  // ── Playlist ────────────────────────────────────────────────────────────
  //
  // THE FEATURE DOES NOT EXIST YET. There is no playlist table, no request
  // email, no client-facing page, no track count — nothing behind this but the
  // status_overrides column, which already whitelists 'song_list' server-side.
  //
  // The column is here anyway, and deliberately: it was designed in alongside
  // the other three, and adding a fifth column later means re-deriving every
  // track width on the row. Holding the space now costs 100px; retrofitting it
  // later costs the layout.
  //
  // So this renders exactly one honest state — a dimmed icon meaning "nothing
  // has happened" — plus the manual override, which genuinely works today: a
  // DJ who took the song list by text message can mark it done and the row
  // will stop asking. When the real feature lands it replaces this block and
  // nothing around it moves.
  {
    const done = !!overrides.song_list;
    steps.push({
      key: 'song_list',
      label: done ? 'Playlist' : 'Playlist not requested',
      state: done ? 'done' : 'todo',
      icon: 'music',
      overridable: true,
      done,
      color: done ? NEON : MUTED,
      // "Not sent" — the same word as every other column, which is convenient,
      // because it's also the only honest one available: there's nothing to
      // send yet.
      //
      // It stays GREY though (see MUTED above), unlike the amber "Not sent" on
      // contract and deposit. Same word, different colour, and the colour is
      // what says "this isn't waiting on you" — the feature doesn't exist, so
      // an amber caption here would be indistinguishable from the real call to
      // action sitting one column to the left. When the request feature lands,
      // this goes amber and 'Pending' starts appearing, with no wording change.
      caption: done ? undefined : 'Not sent',
      info: done ? undefined : 'Requesting playlists is coming soon.',
      actions: [],
    });
  }

  // ── Invoice ─────────────────────────────────────────────────────────────
  //
  // A RECEIPT, not a demand. It confirms money that has already arrived, which
  // is why it's the last column and why it can't do anything on its own: it
  // reacts to the deposit column to its left.
  //
  // 'balance' is the existing payment kind for it — PaymentsBlock already
  // labels kind:'balance' as "Invoice" and already gates sending one on the
  // deposit being settled (canSendInvoice). This column reads the same rows so
  // the two can't disagree.
  //
  // Five states, and the gate is the interesting one: with no deposit settled
  // there is nothing to write a receipt about, so the cell is a dash rather
  // than a button that would open a menu offering nothing.
  {
    const settledP = (p: BookingPayment) => p.status === 'paid' || p.status === 'waived';
    const balancePays = payments.filter((p) => p.kind === 'balance');
    const depositSettled = !depositRow || settledP(depositRow);
    const balanceRow = balancePays[0] || null;
    const balanceSettled = balancePays.length > 0 && balancePays.every(settledP);
    // Money has landed somewhere — a deposit that settled, or a balance that
    // did. Before that, a receipt has nothing to describe.
    const anyMoneyIn =
      (!!depositRow && settledP(depositRow)) || balanceSettled || !!overrides.invoice;
    const done = balanceSettled || !!overrides.invoice;
    if (anyMoneyIn || balanceRow) {
      const currency = balanceRow ? (booking.currency || 'USD') : (booking.currency || 'USD');
      steps.push({
        key: 'invoice',
        label: done ? 'Invoice' : balanceRow ? 'Invoice sent' : 'Send invoice',
        state: done ? 'done' : 'todo',
        icon: 'receipt',
        overridable: !balanceSettled,
        done,
        color: done ? NEON : AMBER,
        // Same vocabulary as the rest: Not sent / Pending / check.
        //
        // (This is the column that was briefly bare. That was right when the
        // icon greyed out until done — dim carried the state. Once the icon is
        // always full colour, a receipt with no check and no word looks
        // identical whether it's gone out or not, and invoice becomes the one
        // column you can't read.)
        caption: done ? undefined : balanceRow ? 'Pending' : 'Not sent',
        info: balanceRow
          ? `${fmtMoney(Number(balanceRow.amount_paid || 0), currency)} of ${fmtMoney(Number(balanceRow.amount || 0), currency)} received`
          : depositSettled
            ? 'Deposit settled — a receipt can go out.'
            : undefined,
        actions: archive ? [] : [],
      });
    }
  }

  // The type-mismatch info is now shown only in the expanded details
  // panel's callout banner (see BookingDetails below) — keeping the row
  // header clean. The row no longer renders a CLUB/BAR pill.

  // Both edit and delete must stop propagation so they don't also toggle
  // the row's expand/collapse state (the row is itself a <button>).
  function handleEdit(e: React.MouseEvent) {
    e.stopPropagation();
    onEdit && onEdit();
  }
  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    onDelete && onDelete();
  }

  return (
    <div className={`${styles.rowWrap} ${expanded ? styles.rowWrapExpanded : ''}`}>
      {/*
        THE ROW IS A GRID, AND EVERY CHILD MUST OWN A TRACK.
        There are exactly as many direct children here as there are tracks in
        --row-cols. Anything extra doesn't overflow — it gets auto-placed into
        an implicit SECOND row, silently, under the date. That's why the manual
        pill and the edit/delete buttons now live inside the event cell rather
        than floating as siblings the way they did when this was a flex row.

        A click anywhere toggles expand; interactive children stopPropagation so
        they run their own action instead.
      */}
      <div className={styles.row} onClick={() => setExpanded((v) => !v)} style={{ cursor: 'pointer' }}>
        {/* 1 — Date pill. Kept as-is: it's what you look for first. */}
        <div className={styles.rowDate}>
          <div className={styles.dayNum}>{day}</div>
          <div className={styles.dayMeta}>
            <div className={styles.dow}>{dow}</div>
            <div className={styles.mo}>{mo}</div>
          </div>
        </div>
        {/* 2 — Flyer. Club/bar only, which is why --row-cols has a club
            variant with an extra track rather than a 0-width column that would
            still eat a gap. display:contents on the wrapper so FlyerSlot itself
            is the grid item. */}
        {djType === 'club' && (
          <span style={{ display: 'contents' }} onClick={(e) => e.stopPropagation()}>
            <FlyerSlot
              bookingId={booking.id}
              userId={userId}
              flyerUrl={flyerUrl}
              onChange={setFlyerUrl}
              size="row"
              readOnly={archive}
            />
          </span>
        )}
        {/* 3 — Time. Its own track now; it used to be half of a nested grid
            that ate the whole row's spare width. */}
        <button
          type="button"
          className={styles.rowToggle}
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          aria-expanded={expanded}
        >
          {booking.cocktail_needed && (
            <div className={styles.rowCocktailNote}>Includes cocktail hour</div>
          )}
          <div className={styles.rowTime}>{timeRange}</div>
        </button>
        {/* 4 — Event. minmax(0,1fr): takes what's left and ellipsizes, so a
            long name can never push the status columns out of alignment.
            The manual pill and edit/delete USED to ride along in here, which is
            exactly why "Birthday party" was rendering as "Birthday …" — this is
            the only track that flexes, so they ate it. They have their own
            track now. */}
        <div className={styles.rowContext}>
          {context && <span className={styles.rowEventType}>{context}</span>}
          {overlaps && (
            <span
              className={styles.overlapPill}
              title="This booking's time overlaps another booking on the same day"
            >
              ⚠
            </span>
          )}
        </div>
        {/* 5 — Value. The agreed total, right-aligned on tabular figures.
            Same fallback chain the details panel uses, so the row and the panel
            can't quote different numbers. */}
        <div className={styles.rowValue}>
          {rowValue != null ? fmtMoney(rowValue, booking.currency || 'USD') : ''}
        </div>
        {/*
          6–9 — THE STATUS COLUMNS: contract · deposit · playlist · invoice.

          display:contents on this wrapper — it generates no box, so the four
          cells below become direct grid items of .row and land in tracks 6–9.
          On mobile it becomes a real grid and claims a full-width band. One
          element, two layouts, no duplicated markup. See .statusStrip.

          FIXED SLOTS, NOT steps.map. `steps` is variable-length — contract only
          if one is required, deposit only if one exists, invoice only once
          money has landed. Mapping it laid icons out in whatever order they
          happened to exist, so a booking with no contract put its DEPOSIT icon
          exactly where the row above put its CONTRACT icon: same emoji column,
          different meaning. Nothing lined up down the page.

          Now each stage owns a column whether or not this booking has it. A
          missing one leaves a dash. That's information too — "no deposit
          requested" is a real state, and the gap says it.
        */}
        {/*
          NO stopPropagation ON THIS WRAPPER.

          It had one, and `display: contents` is why that was a bug rather than
          a convenience: contents removes the element's BOX, not the element.
          It's still in the DOM and clicks still bubble through it — so the
          handler swallowed every click landing anywhere in the four status
          columns. Roughly 400px of row: the gaps around the icons, the space
          under the captions, and every dash. All of it dead.

          The things that genuinely must not toggle the row — the icon buttons —
          stop their own clicks now, which is where that belongs. Everything
          else in these columns is inert and should toggle like the rest of the
          row does.
        */}
        <div className={styles.statusStrip}>
          {PIPE_SLOTS.map((slotKey) => {
            const st = steps.find((s) => s.key === slotKey);
            // Hold the column open. A dash, not a dimmed icon: dimmed implies a
            // stage that exists and hasn't been done, and there's a real
            // difference between "no contract needed on this booking" and "the
            // contract hasn't gone out".
            if (!st) {
              return (
                <div key={slotKey} className={styles.stCell}>
                  <span className={styles.stDash} aria-hidden="true">—</span>
                </div>
              );
            }
            // `const c = st.color` used to live here, feeding the old text
            // label's colour and the chevron's stroke. Both are gone — the
            // caption uses capColor (below) and the chevron now inherits
            // currentColor — so it sat declared and never read, which fails the
            // build on no-unused-vars. st.color is still the source of truth;
            // it's read directly where it's needed.
            const open = menuOpenKey === st.key;
            // A signed contract ISN'T overridable (you can't un-sign a real
            // one) but it does have Download — so the chevron can't key off
            // `overridable` any more, or that menu would be unreachable.
            // `info` counts: a settled deposit in the archive has no actions
            // and isn't overridable, but it still knows what was paid — and
            // that's exactly what someone opens an old booking to check.
            // `hint` counts. A step whose only content is "here's why you can't
            // do the thing" still needs a chevron and a menu to say it in —
            // otherwise the explanation exists in the code and nowhere a DJ can
            // reach it, which is the same as not existing.
            const hasMenu = (st.actions?.length ?? 0) > 0 || st.overridable || !!st.info || !!st.hint;
            // In flight: it exists and it's out there, but it isn't done. This
            // is the state the dot is for — and the reason the caption exists,
            // because a dot alone can't tell "sent, waiting" from "signed".
            // !st.done leads, same as the caption: the amber "waiting on
            // someone" dot and the green "done" badge are mutually exclusive by
            // construction, not by the states happening not to overlap.
            const waiting = !st.done && (!!st.caption || st.state === 'pending');
            // The caption takes the step's own colour, softened.
            //
            //   done  -> neon   — "$600/$600", the whole ask landed
            //   muted -> grey   — Playlist: real stage, nothing you can do yet.
            //                     An amber "Not sent" there would read exactly
            //                     like the amber "Not sent" on deposit beside it
            //                     and promise an action the app can't perform.
            //   else  -> amber  — your move, or waiting on them
            //
            // st.done drives the neon, NOT st.color: the two agree today, but
            // the caption's job is to say whether the thing is finished, and
            // reading that off a colour is how these two got out of sync in the
            // first place.
            //
            // Both values are dialled back from the icon's NEON/AMBER — at
            // 9.5px the full-strength ones vibrate against the dark row. Same
            // hues, sized for the text they're rendering.
            const capColor = st.done
              ? '#3fd6ab'
              : st.color === MUTED
                ? '#5a5a72'
                : '#c08a3e';
            /*
              INVARIANT: a done step can never say it's waiting.
              A green check next to the word "Pending" is the cell contradicting
              itself, and it shipped — a WAIVED deposit is settled with
              amount_paid still 0, so the badge read the status, the caption read
              the payments, and the two disagreed with nobody checking.
              Each step builds its own caption, so this is the one place that can
              enforce the rule for all four columns at once. Cheap, and it makes
              the next person's mistake here impossible instead of merely
              unlikely.
            */
            const cap = st.done && st.caption === 'Pending' ? undefined : st.caption;
            const inner = (
              <>
                {/*
                  ALWAYS FULL COLOUR. The icon used to be grayscale+28% until
                  the step was DONE, which meant a contract that had been sent
                  and was sitting with the client rendered identically to one
                  nobody had touched — drained and dim — while the caption right
                  under it said "Sent". The icon was contradicting the word.

                  The icon's job is only ever "which stage is this". The badge
                  says done, the caption says the rest. A stage that exists on
                  this booking is a real stage; greying it out was the picture
                  saying it wasn't.
                */}
                <span className={styles.stIcon}>
                  {/* The emoji render in their OWN colours — no ring, no tint.
                      Not reached yet = drained and dimmed, so progress is
                      legible without reading anything.
                      NOTE: emoji render differently on every OS — 🧾 on Windows
                      is not 🧾 on macOS. If these ever matter to the brand, the
                      real fix is a small custom SVG set, not a bigger emoji. */}
                  {st.icon === 'money' ? '\u{1F4B5}'
                    : st.icon === 'music' ? '\u{1F3B5}'
                    : st.icon === 'receipt' ? '\u{1F9FE}'
                    : '\u{1F4DD}'}
                  {/* Done. An SVG stroke rather than a ✓ character: at this size
                      the glyph renders soft, and differently per platform. */}
                  {st.done && (
                    <span className={styles.stBadge}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="#06231b" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    </span>
                  )}
                  {/* Waiting on someone. Never both — done wins. */}
                  {!st.done && waiting && <span className={styles.stDot} />}
                </span>
                {/* The chevron is the affordance: it's what says this icon
                    opens something, standing still, without hovering. */}
                {hasMenu && (
                  <span className={styles.stChev} aria-hidden="true">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                  </span>
                )}
              </>
            );
            /*
              THE CONNECTORS ARE GONE. They existed to make the icons read as a
              sequence rather than a set — the column headers do that job now,
              and better. They also had a bug that only showed once columns were
              reserved: a connector was drawn for any slot > 0, including ones
              whose left-hand neighbour was empty, so a deposit with no contract
              beside it drew a dash hanging off nothing.

              The caption line is rendered even when EMPTY. It has to be: a cell
              with a caption is 10px taller than one without, and left to
              themselves the icons would sit at different heights across the row
              — which is the exact misalignment this page was rebuilt to fix.
            */
            return (
              <div key={st.key} className={styles.stCell}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  {hasMenu ? (
                    <button
                      type="button"
                      className={`${styles.stBtn} ${open ? styles.stBtnOpen : ''}`}
                      title={st.label}
                      aria-haspopup="menu"
                      aria-expanded={open}
                      onClick={(e) => {
                        // This click opens a menu; it must not ALSO expand the
                        // row underneath. It used to rely on the statusStrip
                        // wrapper for this — that wrapper was swallowing clicks
                        // meant for the row, so the stop lives here now, on the
                        // one element that actually needs it.
                        e.stopPropagation();
                        if (open) { setMenuOpenKey(null); return; }
                        // Hand the button to the re-anchor effect. Without this
                        // the menu is positioned once, from a rect that stops
                        // being true the moment anything scrolls.
                        menuBtnRef.current = e.currentTarget as HTMLElement;
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setMenuPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
                        setMenuOpenKey(st.key);
                      }}
                    >
                      <span className={styles.stTop}>{inner}</span>
                      <span className={styles.stCap} style={{ color: capColor }}>{cap || ''}</span>
                    </button>
                  ) : (
                    <div className={styles.stBtn} style={{ cursor: 'default' }} title={st.label}>
                      <span className={styles.stTop}>{inner}</span>
                      <span className={styles.stCap} style={{ color: capColor }}>{cap || ''}</span>
                    </div>
                  )}
                  {open && hasMenu && menuPos && (
                    <>
                      {/*
                        BOTH OF THESE MUST STOP THEIR CLICKS.

                        position:fixed moves them on screen; it does NOT move
                        them in the DOM. They're still children of the row, so
                        every click in the menu — and every click on the
                        dismiss backdrop, which is the whole viewport — bubbles
                        into .row's onClick and toggles it.

                        That's how "Review & send contract" broke: runContract
                        does setExpanded(true), then the same click reached the
                        row and flipped it straight back shut. The portal opened
                        and the row closed on top of it, in one tick.

                        These used to be covered by a blanket stopPropagation on
                        the statusStrip wrapper — which also swallowed every
                        click on the row's dead space, so removing it was right.
                        The stop belongs on the floating elements themselves.
                      */}
                      <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={(e) => { e.stopPropagation(); setMenuOpenKey(null); }} />
                      <div onClick={(e) => e.stopPropagation()} style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 9999, background: 'var(--bg-card,#14141f)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.5)', padding: 4, minWidth: 170, whiteSpace: 'nowrap' }}>
                        {/* The amounts, when there are any. Two words fit on
                            the strip; "$299.99 of $600.00 received" doesn't —
                            and that's the number a DJ actually wants when they
                            tap a half-paid deposit. */}
                        {st.info && (
                          <>
                            <div style={{ color: 'var(--white,#fff)', fontSize: '.78rem', fontWeight: 700, padding: '.45rem .6rem .35rem' }}>
                              {st.info}
                            </div>
                            <div style={{ height: 1, background: 'rgba(255,255,255,.1)', margin: '0 6px 3px' }} />
                          </>
                        )}
                        {/* Why the button you came here for isn't here.
                            whiteSpace:'normal' and an explicit maxWidth because
                            the menu itself is nowrap — a sentence inherits that
                            and stretches the dropdown to the width of the
                            sentence, which is how you get a 600px menu. */}
                        {/*
                          Red, not muted: this is the one line in the menu that
                          says you CAN'T do the thing you opened it for. In grey
                          it read as a footnote and got skipped, which is how you
                          end up hunting for a button that was never going to be
                          there.

                          NO DIVIDER after it, and the bottom padding is gone.
                          A rule between the problem and its fix filed them as
                          two unrelated things — "here's a message" / "here's a
                          menu" — when they're one sentence: what's wrong, and
                          the way out. Dividers separate; these two belong
                          together.
                        */}
                        {st.hint && (
                          <div style={{ color: '#ff8a8a', fontSize: '.7rem', lineHeight: 1.45, padding: '.5rem .6rem .1rem', whiteSpace: 'normal', maxWidth: 190 }}>
                            {st.hint}
                          </div>
                        )}
                        {/* The real options for this step, right now — built
                            in the steps array so the menu can't offer something
                            the state doesn't allow (e.g. re-sending over a
                            signed contract). */}
                        {(st.actions ?? []).map((a) => (
                          <button
                            key={a.label}
                            type="button"
                            onClick={() => { setMenuOpenKey(null); a.run(); }}
                            style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: a.danger ? '#ff7676' : NEON, fontWeight: 700, fontSize: '.78rem', padding: '.5rem .6rem', borderRadius: 6, cursor: 'pointer' }}
                          >
                            {a.label}
                          </button>
                        ))}
                        {/* "Mark complete" is the escape hatch for work handled
                            outside the app — never offered on something real
                            (a genuine signature, money that actually landed),
                            which is what `overridable` guards. */}
                        {st.overridable && (
                          <>
                            {(st.actions ?? []).length > 0 && (
                              <div style={{ height: 1, background: 'rgba(255,255,255,.1)', margin: '3px 6px' }} />
                            )}
                            <button
                              type="button"
                              onClick={() => toggleStep(st.key, !st.done)}
                              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: st.done ? '#ff9a9a' : NEON, fontWeight: 700, fontSize: '.78rem', padding: '.5rem .6rem', borderRadius: 6, cursor: 'pointer' }}
                            >
                              {st.done ? '\u2715 Mark not complete' : '\u2713 Mark complete'}
                            </button>
                            <div style={{ color: 'var(--muted,#7a7a90)', fontSize: '.66rem', padding: '2px 8px 5px' }}>For steps handled outside the app.</div>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {/* 10 — Actions. Right corner, its own track, so nothing it contains
            can squeeze the event name.
            The pill and the buttons occupy the SAME space: pill at rest,
            buttons on hover. You don't need telling it's a manual booking at
            the moment you've reached over to edit it — and showing all three
            at once cost ~106px and gave the event cell nothing back.
            Empty on non-manual rows, which is what keeps every chevron on the
            same x. */}
        {/* No stopPropagation here either — handleEdit and handleDelete already
            stop their own, so this only ever blocked the empty part of the
            cell (and, on a non-manual booking, the entire 84px of it). */}
        <div className={styles.rowActionsCell}>
          {booking.is_manual && (
            <span className={styles.manualPill} title="Added manually by you">MANUAL</span>
          )}
          {onEdit && (
            <span
              onClick={handleEdit}
              className={styles.editBtn}
              role="button"
              aria-label="Edit manual booking"
              title="Edit"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </span>
          )}
          {onDelete && (
            <span
              onClick={handleDelete}
              className={styles.deleteBtn}
              role="button"
              aria-label="Delete manual booking"
              title="Delete"
            >
              ✕
            </span>
          )}
        </div>
        {/* 11 — Chevron. Last track, last thing on the row. */}
        <button
          type="button"
          className={styles.rowChevronBtn}
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          <svg
            className={`${styles.rowChevron} ${expanded ? styles.rowChevronOpen : ''}`}
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
      {/* Request deposit — the amount, before it goes out, in something you can
          read. It replaced a window.prompt(), which showed the number with no
          currency, no context, and no way to see what it was a deposit ON. */}
      {reqOpen && (
        <div
          onClick={() => !reqBusy && setReqOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card,#14141f)', border: '1px solid rgba(255,255,255,.14)',
              borderRadius: 12, padding: '1.1rem 1.2rem', maxWidth: 420, width: '100%',
              boxShadow: '0 12px 40px rgba(0,0,0,.6)',
            }}
          >
            <div style={{ fontWeight: 800, color: 'var(--white,#fff)', fontSize: '.95rem', marginBottom: '.15rem' }}>
              Request deposit
            </div>
            <p style={{ margin: '0 0 .8rem', color: 'var(--muted,#8a8aa0)', fontSize: '.78rem', lineHeight: 1.5 }}>
              {booking.venue_name || booking.event_type || 'This booking'} — we&apos;ll email the
              client their payment options.
            </p>

            <label style={{ display: 'block', fontFamily: "'Space Mono', monospace", fontSize: '.6rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted,#8a8aa0)', marginBottom: '.35rem' }}>
              Amount
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.5rem' }}>
              <span style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.95rem' }}>$</span>
              <input
                autoFocus
                type="number"
                min="0"
                step="0.01"
                value={reqAmount}
                onChange={(e) => { setReqAmount(e.target.value); setReqErr(null); }}
                style={{
                  flex: 1, background: 'var(--deep,#0b0b12)', border: '1px solid rgba(255,255,255,.14)',
                  borderRadius: 6, color: 'var(--white,#fff)', padding: '.55rem .7rem',
                  fontFamily: "'Space Mono', monospace", fontSize: '.9rem',
                }}
              />
            </div>

            {suggestedDeposit != null && suggestedDeposit > 0 && (
              <p style={{ margin: '0 0 .8rem', color: 'var(--muted,#8a8aa0)', fontSize: '.72rem' }}>
                This booking&apos;s agreed deposit: {fmtMoney(suggestedDeposit, booking.currency || 'USD')}
                {booking.deposit_pct != null ? ` (${booking.deposit_pct}%)` : ''}
              </p>
            )}

            {reqErr && (
              <p style={{ margin: '0 0 .7rem', color: '#ff6b6b', fontSize: '.75rem', lineHeight: 1.5, wordBreak: 'break-word' }}>{reqErr}</p>
            )}

            <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={reqBusy}
                onClick={() => setReqOpen(false)}
                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.18)', color: 'var(--muted,#8a8aa0)', fontWeight: 700, borderRadius: 6, padding: '.5rem 1rem', cursor: reqBusy ? 'default' : 'pointer', fontSize: '.8rem' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={reqBusy}
                onClick={() => void submitRequest()}
                style={{ background: NEON, border: 'none', color: '#06231b', fontWeight: 800, borderRadius: 6, padding: '.5rem 1.1rem', cursor: reqBusy ? 'wait' : 'pointer', fontSize: '.8rem', opacity: reqBusy ? .6 : 1 }}
              >
                {reqBusy ? 'Requesting…' : 'Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment options — the real editor, not a copy of it. Same component
          as Booking Settings, so a rail added here is added everywhere and
          there's one place for this logic to be wrong. */}
      {methodsOpen && (
        <div
          onClick={() => setMethodsOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.65)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '2rem 1rem', overflowY: 'auto',
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620, width: '100%' }}>
            <PaymentMethodsSection userId={userId} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '.7rem' }}>
              <button
                type="button"
                onClick={() => setMethodsOpen(false)}
                style={{ background: NEON, border: 'none', color: '#06231b', fontWeight: 800, borderRadius: 6, padding: '.5rem 1.2rem', cursor: 'pointer', fontSize: '.8rem' }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {expanded && (
        <BookingDetails
          booking={booking}
          djType={djType}
          userId={userId}
          clubDepositPct={clubDepositPct}
          taxPct={taxPct}
          flyerUrl={flyerUrl}
          onFlyerChange={setFlyerUrl}
          onContractSigned={() => setSignedOverride(true)}
          archive={archive}
          contractAction={contractAction}
          onContractActionHandled={() => setContractAction(null)}
          payments={payments}
          onPaymentsChange={onPaymentsChange}
          canRequestDeposit={canRequestDeposit}
          hasHostContact={hasHostContact}
          onEdit={onAddHost || onEdit}
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// BookingDetails — full info panel shown when a row is expanded inline.
// Renders every field we have on file for the booking, grouped sensibly.
// Empty/null fields are hidden so the panel stays clean for manual bookings
// (which won't have requester/package/quote info).
// ───────────────────────────────────────────────────────────────────────

function BookingDetails({
  booking, djType, userId, clubDepositPct, taxPct, flyerUrl, onFlyerChange, onContractSigned, archive,
  payments, onPaymentsChange, canRequestDeposit, hasHostContact, onEdit, contractAction, onContractActionHandled,
}: {
  booking: UpcomingBooking;
  djType: 'club' | 'mobile';
  userId: string;
  clubDepositPct: number;
  taxPct: number;
  flyerUrl: string | null;
  onFlyerChange: (url: string | null) => void;
  onContractSigned?: () => void;
  archive?: boolean;
  payments: BookingPayment[];
  onPaymentsChange: (bookingId: string, rows: BookingPayment[]) => void;
  // Contract-step gate for Request Deposit — computed by BookingRow from the
  // same requires_contract / contract_status / status_overrides logic that
  // drives the status strip.
  canRequestDeposit: boolean;
  /**
   * Does this booking have a host name AND email to send to?
   *
   * Passed down rather than recomputed here, for the same reason
   * canRequestDeposit is: the strip and this panel must never disagree about
   * whether there's a recipient. Two copies of that rule is how you get a
   * greyed-out icon sitting above a live "Review & Send Contract" button.
   */
  hasHostContact: boolean;
  /** Opens the Add/Edit Manual Booking modal. Manual, non-archive rows only. */
  onEdit?: () => void;
  // One-shot request from the pipeline's contract dropdown. The portal and the
  // send/resend/cancel/download handlers all live here; the menu that wants
  // them lives a component up, on a row that may not even be expanded yet.
  contractAction?: ContractAction | null;
  onContractActionHandled?: () => void;
}) {
  const [contractOpen, setContractOpen] = useState(false);
  // Run the pipeline's request once, then clear it. Clearing FIRST matters:
  // otherwise the flag is still set on the next render and the portal reopens
  // the moment you close it. (downloadSigned/resendContract/cancelContract are
  // function declarations, so they're hoisted and callable from up here.)
  useEffect(() => {
    if (!contractAction) return;
    onContractActionHandled?.();
    switch (contractAction) {
      case 'open': setContractOpen(true); break;
      case 'download': void openSignedDoc('contract'); break;
      case 'download-audit': void openSignedDoc('audit'); break;
      case 'resend': void resendContract(); break;
      case 'cancel': void cancelContract(); break;
      case 'copy-link': void copyClientLink(); break;
    }
    // The handlers are stable for this booking and re-created every render;
    // listing them would re-fire the effect on every render instead of only
    // when a new action arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractAction]);
  const [sendContractId, setSendContractId] = useState<string | null>(null);
  const [contractSent, setContractSent] = useState(false);
  const [contractCancelled, setContractCancelled] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendDone, setResendDone] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  // The link, held for the explainer box rather than copied silently.
  const [linkBox, setLinkBox] = useState<string | null>(null);

  // Fetch the client's DocuSeal signing link and SHOW it, rather than dropping
  // it on the clipboard and saying "copied ✓".
  //
  // The link is a capability URL: the unguessable slug IS the credential.
  // Whoever opens it can sign as the client — no login, no password. That's
  // inherent to e-signature (the same link is what DocuSeal emails them, and
  // it's how DocuSign et al work), so surfacing it doesn't weaken anything.
  //
  // What it DOES create is a new way to be careless. A silent copy puts a
  // sign-as-the-client key on the clipboard with nothing said about it, and the
  // next paste might be a group chat. So: show the link, say what it is, and
  // let the DJ copy it having read that. One extra click, and the difference
  // between a tool and a trap.
  async function copyClientLink() {
    setCopyBusy(true);
    try {
      const res = await fetch('/api/contracts/client-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && json.url) setLinkBox(json.url);
      else alert(json.error || 'Could not get the client link.');
    } catch { alert('Could not get the link. Try again in a moment.'); }
    finally { setCopyBusy(false); }
  }

  // Copy from inside the box. Falls back to selecting the text when the
  // clipboard API is blocked (non-HTTPS, some mobile browsers) — the link is
  // on screen either way, which is the point of showing it.
  async function copyFromBox() {
    if (!linkBox) return;
    try {
      await navigator.clipboard.writeText(linkBox);
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2500);
    } catch {
      const el = document.getElementById('gdc-link-box') as HTMLInputElement | null;
      el?.select();
    }
  }
  const [signedBusy, setSignedBusy] = useState(false);
  const [signedDocs, setSignedDocs] = useState<{ contract?: string; audit?: string } | null>(null);
  const [locallySigned, setLocallySigned] = useState(false);

  // When a sent contract is opened, verify with DocuSeal whether it's actually
  // completed. The webhook flips the DB to 'signed', but a page loaded before
  // that won't know — so we check live and update the UI to "✓ Signed" without
  // needing a refresh. Runs once when the details panel mounts (on expand).
  useEffect(() => {
    const pending = !contractCancelled
      && (contractSent || booking.contract_status === 'awaiting_client')
      && booking.contract_status !== 'signed';
    if (!pending) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/contracts/signed-doc', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: booking.id }),
        });
        const json = (await res.json().catch(() => ({}))) as { contract?: string; audit?: string };
        if (alive && res.ok && (json.contract || json.audit)) {
          setSignedDocs({ contract: json.contract, audit: json.audit });
          setLocallySigned(true);
          onContractSigned?.(); // bubble up so the row's status strip shows Signed
        }
      } catch { /* ignore — leave as awaiting */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch the finished, signed contract PDF + audit log so the DJ can download both.
  async function downloadSigned() {
    await openSignedDoc('contract');
  }

  /**
   * Open one of the signed documents.
   *
   * The pipeline's dropdown says "Download …", so it has to actually open
   * something — the old behaviour only revealed two buttons further down the
   * expanded panel, which is a link, not a download.
   *
   * If we already have the URLs (the panel fetches them on mount for signed
   * bookings) we open straight away, keeping the user's click — browsers block
   * window.open once a gesture has been through an await. When we have to
   * fetch first that gesture may be gone, so setSignedDocs() still runs and the
   * panel's buttons appear as the fallback. The DJ gets the file either way.
   */
  async function openSignedDoc(which: 'contract' | 'audit') {
    const known = which === 'audit' ? signedDocs?.audit : signedDocs?.contract;
    if (known) { window.open(known, '_blank', 'noopener,noreferrer'); return; }

    setSignedBusy(true);
    try {
      const res = await fetch('/api/contracts/signed-doc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { contract?: string; audit?: string; error?: string };
      if (res.ok && (json.contract || json.audit)) {
        setSignedDocs({ contract: json.contract, audit: json.audit });
        const url = which === 'audit' ? json.audit : json.contract;
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
        else if (which === 'audit') alert('The audit log isn’t available for this contract yet.');
        else alert('The signed contract isn’t ready yet.');
      } else {
        alert(json.error || 'The signed contract isn’t ready yet.');
      }
    } catch { alert('Could not fetch the signed contract. Try again in a moment.'); }
    finally { setSignedBusy(false); }
  }

  // Re-email the client their copy to sign.
  async function resendContract() {
    setResendBusy(true); setResendDone(false);
    try {
      const res = await fetch('/api/contracts/send-client', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      if (!res.ok) throw new Error('resend failed');
      setResendDone(true);
    } catch { alert('Could not resend the contract. Try again in a moment.'); }
    finally { setResendBusy(false); }
  }

  // Void the sent contract and clear it so a new one can be sent.
  async function cancelContract() {
    if (!confirm('Cancel this sent contract? The client’s copy will be voided and you can review and send a new one.')) return;
    setCancelBusy(true);
    try {
      const res = await fetch('/api/contracts/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not cancel.');
      setContractSent(false); setResendDone(false); setContractCancelled(true);
    } catch (e) { alert(e instanceof Error ? e.message : 'Could not cancel the contract.'); }
    finally { setCancelBusy(false); }
  }

  // Pretty-format the helper labels.
  const setTypeLabel = booking.set_type
    ? (booking.set_type
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '))
    : null;

  const eventTypeLabel = booking.event_type
    ? (MOB_EVENT_TYPE_LABELS[booking.event_type]
        || MOBILE_EVENT_TYPES.find((e) => e.value === booking.event_type)?.label
        || booking.event_type)
    : null;

  // Currency-aware money formatting. Default USD if no currency set.
  function money(n: number | null | undefined): string | null {
    if (n == null) return null;
    const cur = booking.currency || 'USD';
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n);
    } catch {
      return `${cur} ${n}`;
    }
  }

  // Linkified address — clicking opens Google Maps directions to that address.
  // If we have lat/lon we use those for a more precise pin; otherwise fall
  // back to URL-encoded address text.
  const addressUrl = booking.venue_address
    ? (booking.venue_lat != null && booking.venue_lon != null
        ? `https://www.google.com/maps/search/?api=1&query=${booking.venue_lat},${booking.venue_lon}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(booking.venue_address)}`)
    : null;

  // Each row in `rows` is one or two label/value pairs. A pair appears
  // side-by-side; a single appears alone. We pre-filter empties so a row
  // collapses to a single column when one of its halves is empty.
  type Cell = { label: string; value: React.ReactNode | string | null | undefined };
  type DetailRow = Cell[];

  // Time-row label prefix: club bookings = "Set", weddings = "Reception",
  // all other mobile event types = "Event".
  const timeLabelPrefix =
    djType === 'club' ? 'Set' : (booking.event_type === 'weddings' ? 'Reception' : 'Event');

  // Agreed-rate breakdown. The stored agreed rate is the cocktail-INCLUSIVE
  // total. When there's a separately-charged cocktail price, show
  // "base + cocktail = total"; otherwise just the total.
  const agreedTotal = booking.counter_rate ?? booking.quoted_rate ?? booking.offer_amount ?? null;
  // Sales tax and the tax-inclusive total. The booking row carries a FROZEN
  // snapshot (tax_pct / tax_amount / total_with_tax) written at creation —
  // the stored snapshot always wins, so a DJ changing their tax settings
  // never re-prices existing bookings. The snapshot amounts were computed
  // on the price at creation: if the agreed price has changed since
  // (accepted counter, edited manual rate), recompute on the new price with
  // the FROZEN tax % — still never the DJ's current settings. Only legacy
  // rows with no snapshot at all (tax_pct null) fall back to the live
  // settings % (taxPct) with the old whole-dollar rounding.
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const snapTaxPct = booking.tax_pct != null ? Number(booking.tax_pct) : null;
  const snapTaxAmount = booking.tax_amount != null ? Number(booking.tax_amount) : null;
  const snapTotal = booking.total_with_tax != null ? Number(booking.total_with_tax) : null;
  // The pre-tax base the snapshot was computed on; "fresh" = it still
  // matches the current agreed price, so the stored amounts are the truth.
  const snapBase = (snapTaxAmount != null && snapTotal != null) ? round2(snapTotal - snapTaxAmount) : null;
  const snapshotFresh =
    snapBase != null && agreedTotal != null && Math.abs(Number(agreedTotal) - snapBase) < 0.005;
  const effTaxPct = snapTaxPct ?? taxPct;
  const cardTax = snapshotFresh
    ? (snapTaxAmount as number)
    : (effTaxPct > 0 && agreedTotal != null)
      ? (snapTaxPct != null
          ? round2((Number(agreedTotal) * effTaxPct) / 100)
          : Math.round((Number(agreedTotal) * effTaxPct) / 100))
      : 0;
  const cardTotal = snapshotFresh
    ? snapTotal
    : (agreedTotal != null ? round2(Number(agreedTotal) + cardTax) : null);
  const cocktailCharge = booking.cocktail_price != null ? Number(booking.cocktail_price) : 0;
  const hasSeparateCocktail = cocktailCharge > 0 && agreedTotal != null;
  const agreedBase = hasSeparateCocktail ? (Number(agreedTotal) - cocktailCharge) : null;
  const agreedRateValue = hasSeparateCocktail ? (
    <span>
      {money(agreedBase)} + <span className={styles.cocktailHighlight}>{money(cocktailCharge)} cocktail</span> = {money(agreedTotal)}
    </span>
  ) : money(agreedTotal);

  // Discount note — shown under the agreed rate when the booking used a
  // sale/promo code (original price + which discount + amount saved).
  const bkDiscountAmt = booking.discount_amount != null ? Number(booking.discount_amount) : 0;
  const agreedRateWithDiscount = bkDiscountAmt > 0 ? (
    <span>
      {agreedRateValue}
      <span style={{ display: 'block', color: 'var(--neon)', fontSize: '.8rem', marginTop: 2 }}>
        {booking.discount_label || 'Discount'} — saved {money(bkDiscountAmt)}
        {booking.original_rate != null ? ` (was ${money(booking.original_rate)})` : ''}
      </span>
    </span>
  ) : agreedRateValue;

  // Build the rows. Null values get filtered out below.
  const rows: DetailRow[] = [
    // Row 1: Event Date + Venue Name (Event Type for mobile)
    [
      { label: 'Event Date', value: booking.event_date ? formatLongDate(booking.event_date) : null },
      djType === 'club'
        ? { label: 'Venue Name', value: booking.venue_name }
        : {
            label: 'Event Type',
            value: (() => {
              const ed = ((booking as { event_details?: string | null }).event_details || '').trim();
              if (!ed) return eventTypeLabel;
              return (
                <span>
                  {eventTypeLabel}
                  {ed.split(' · ').map((line, i) => (
                    <span key={i} style={{ display: 'block', opacity: 0.7, fontSize: '.85em' }}>{line}</span>
                  ))}
                </span>
              );
            })(),
          },
    ],
    // Row 2a: Cocktail Hour time (wedding bookings where the booker opted in),
    // shown above the reception start/end times.
    [
      {
        label: 'Cocktail Hour Time',
        value: booking.cocktail_needed && booking.cocktail_start_time
          ? formatTime12(booking.cocktail_start_time)
          : null,
      },
    ],
    // Row 2: Time labels — clubs use "Set", mobile uses "Event", except
    // weddings which use "Reception" (matches the booking form + emails).
    [
      { label: timeLabelPrefix + ' Start Time', value: booking.start_time ? formatTime12(booking.start_time) : null },
      { label: timeLabelPrefix + ' End Time', value: booking.end_time ? formatTime12(booking.end_time) : null },
    ],
    // Row 3: Venue Type + Venue Address (linkified to Google Maps)
    [
      djType === 'club'
        ? { label: 'Venue Type', value: booking.venue_type ? capitalize(booking.venue_type) : null }
        : { label: 'Venue Name', value: booking.venue_name },
      {
        label: 'Venue Address',
        value: addressUrl ? (
          <a href={addressUrl} target="_blank" rel="noreferrer" className={styles.addressLink}>
            {booking.venue_address}
          </a>
        ) : booking.venue_address,
      },
    ],
    // Row 4: DJ-type-specific extra info
    djType === 'club'
      ? [
          { label: 'Set Type', value: setTypeLabel },
          { label: 'Equipment', value: booking.equipment ? capitalize(booking.equipment.replace(/_/g, ' ')) : null },
        ]
      : [
          { label: 'Guest Count', value: booking.guest_count != null ? String(booking.guest_count) : null },
          { label: 'Room Details', value: booking.room_details },
        ],
    djType === 'club'
      ? []
      : [
          {
            label: 'Setup Time Required',
            value: booking.setup_hours
              ? `${booking.setup_hours} hr${booking.setup_hours === '1' ? '' : 's'} before start`
              : null,
          },
        ],
    // Row 5: Booked By + Contact Phone
    [
      { label: 'Booked By', value: booking.is_manual ? 'You (manual)' : (booking.requester_name || null) },
      { label: 'Contact Phone', value: booking.phone },
    ],
    // Row 6: Agreed Rate + Overtime Rate. (Package name moved to the package
    // details area below.) Mobile always shows an overtime cell with a
    // placeholder when the DJ set none; club hides it when unset.
    [
      { label: 'Agreed Rate', value: agreedRateWithDiscount },
      {
        label: 'Overtime Rate',
        value: booking.overtime_rate != null
          ? `${money(booking.overtime_rate)}/hr`
          : (djType === 'club' ? null : 'DJ has not listed overtime rate'),
      },
    ],
    // Row 7: Deposit
    [
      {
        label: 'Deposit',
        value: (() => {
          // Frozen snapshot first: deposit_amount as stored at creation
          // (computed on the tax-inclusive total — the exact number the
          // client's booking form showed). Trusted only while the agreed
          // price still matches the snapshot's base; after a renegotiation
          // we recompute below (still using the frozen tax %).
          if (snapshotFresh && booking.deposit_amount != null) {
            return booking.deposit_pct != null
              ? `${money(Number(booking.deposit_amount))} (${booking.deposit_pct}%)`
              : money(Number(booking.deposit_amount));
          }
          // Deposit % is taken on the tax-inclusive total (cardTotal).
          // A stored % wins; else the DJ's standing club % as a fallback.
          // Snapshot rows recompute to the cent; legacy rows keep the old
          // whole-dollar rounding.
          if (booking.deposit_pct != null) {
            return cardTotal != null
              ? `${money(snapTaxPct != null
                  ? round2((cardTotal * booking.deposit_pct) / 100)
                  : Math.round((cardTotal * booking.deposit_pct) / 100))} (${booking.deposit_pct}%)`
              : `${booking.deposit_pct}%`;
          }
          if (djType === 'club' && clubDepositPct > 0) {
            return cardTotal != null && cardTotal > 0
              ? `${money(Math.round((cardTotal * clubDepositPct) / 100))} (${clubDepositPct}%)`
              : `${clubDepositPct}%`;
          }
          // Last resort: a stored fixed deposit amount.
          if (booking.deposit_amount != null) {
            return money(booking.deposit_amount);
          }
          return null;
        })(),
      },
    ],
    // Row 8: Tax + Total. Uses the booking's FROZEN tax % (effTaxPct falls
    // back to the DJ's live setting only for legacy rows with no snapshot).
    [
      {
        label: 'Tax',
        value: (effTaxPct > 0 && cardTax > 0)
          ? `${money(cardTax)} (${effTaxPct}%)`
          : null,
      },
      {
        label: 'Total (with tax)',
        value: (effTaxPct > 0 && cardTotal != null && cardTax > 0)
          ? money(cardTotal)
          : null,
      },
    ],
  ];

  // Filter empty cells from each row; drop rows that become entirely empty.
  const visibleRows = rows
    .map((row) => row.filter((c) => c.value != null && c.value !== ''))
    .filter((row) => row.length > 0);

  const hasNotes = booking.notes && booking.notes.trim().length > 0;
  const hasPackageDetails = booking.package_details && booking.package_details.trim().length > 0;

  // Type-mismatch callout — surface a friendly note in the expanded panel
  // when the booking's type differs from the DJ's registered type. This
  // matches the same warning shown to hosts in the invite email.
  const bt = booking.booking_type;
  const typeMismatchNote = (djType === 'mobile' && bt === 'club')
    ? 'This is a Club / Bar booking. Your profile is registered as a Mobile DJ — the booking will still appear here in your upcoming bookings, but it won\u2019t be displayed publicly on your profile event list.'
    : (djType === 'club' && bt === 'mobile')
      ? 'This is a Mobile / Private booking. Your profile is registered as a Club / Bar DJ — the booking will still appear here in your upcoming bookings, but it won\u2019t be displayed publicly on your profile event list.'
      : null;

  return (
    <div className={styles.detailsPanel}>
      {typeMismatchNote && (
        <div className={styles.typeMismatchNote}>
          <strong>Note:</strong> {typeMismatchNote}
        </div>
      )}
      <div className={styles.detailsStack}>
        {visibleRows.map((row, i) => (
          <div key={i} className={styles.detailPairRow}>
            {row.map((cell) => (
              <div key={cell.label} className={styles.detailRow}>
                <div className={styles.detailLabel}>{cell.label}</div>
                <div className={styles.detailValue}>{cell.value}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* Event flyer inside the card — small thumbnail with download icon,
          plus replace/remove overlay controls. Club/bar bookings only. */}
      {djType === 'club' && (!archive || flyerUrl) && (
        <div className={styles.flyerCardSection}>
          <div className={styles.detailLabel}>Event Flyer</div>
          <FlyerSlot
            bookingId={booking.id}
            userId={userId}
            flyerUrl={flyerUrl}
            onChange={onFlyerChange}
            size="card"
            readOnly={archive}
          />
        </div>
      )}
      {(hasPackageDetails || booking.package_title) && (
        <div className={styles.detailLongBlock}>
          <div className={styles.detailLabel}>Package Details</div>
          {booking.package_title && (
            <div className={styles.packageName}>{booking.package_title}</div>
          )}
          {hasPackageDetails && (
            <div
              className={styles.detailLongValue}
              dangerouslySetInnerHTML={{ __html: booking.package_details || '' }}
            />
          )}
        </div>
      )}
      {booking.created_at && (
        <div className={styles.bookedOnFooter}>
          <span className={styles.bookedOnLabel}>Booked On</span>{' '}
          <span className={styles.bookedOnValue}>{formatLongDate(booking.created_at)}</span>
        </div>
      )}
      {hasNotes && (
        <div className={styles.detailLongBlock}>
          <div className={styles.detailLabel}>Notes</div>
          <div className={styles.detailLongValue}>{booking.notes}</div>
        </div>
      )}
      {/* Shared notes feed — both DJ and host can read + post. Shown for
          club/bar AND mobile (private) bookings — any real two-party
          booking. Manual events with no counterparty are excluded. */}
      {(bt === 'club' || bt === 'mobile') && (
        <div className={styles.notesFeedWrap} style={{ marginTop: '1rem' }}>
          <div className={styles.detailLabel}>Contract</div>
          {!contractCancelled && (contractSent || booking.contract_status === 'awaiting_client') && booking.contract_status !== 'signed' && !locallySigned ? (
            <div style={{ marginTop: 8 }}>
              <div style={{ color: '#f0b23e', fontWeight: 600 }}>Sent — awaiting client signature</div>
              <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.78rem', marginTop: 4 }}>You&rsquo;ve signed. The client has been emailed to sign.</div>
              {!archive && (
                <div style={{ display: 'flex', gap: '.5rem', marginTop: 8, flexWrap: 'wrap' }}>
                  <button type="button" onClick={resendContract} disabled={resendBusy} style={{ background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', cursor: resendBusy ? 'wait' : 'pointer', fontSize: '.8rem' }}>{resendBusy ? 'Resending…' : resendDone ? 'Resent ✓' : 'Resend to client'}</button>
                  <button type="button" onClick={copyClientLink} disabled={copyBusy} style={{ background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', cursor: copyBusy ? 'wait' : 'pointer', fontSize: '.8rem' }}>{copyBusy ? 'Getting link…' : copyDone ? 'Link copied ✓' : '🔗 Copy client link'}</button>
                  <button type="button" onClick={cancelContract} disabled={cancelBusy} style={{ background: 'transparent', border: '1px solid #ff7676', color: '#ff7676', fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', cursor: cancelBusy ? 'wait' : 'pointer', fontSize: '.8rem' }}>{cancelBusy ? 'Cancelling…' : 'Cancel contract'}</button>
                </div>
              )}
              {signedDocs ? (
                <div style={{ display: 'flex', gap: '.5rem', marginTop: 8, flexWrap: 'wrap' }}>
                  {signedDocs.contract && <a href={signedDocs.contract} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', background: 'var(--neon,#00e0a4)', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', fontSize: '.8rem', textDecoration: 'none' }}>⬇ Signed contract</a>}
                  {signedDocs.audit && <a href={signedDocs.audit} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', fontSize: '.8rem', textDecoration: 'none' }}>⬇ Audit log</a>}
                </div>
              ) : (
                <button type="button" onClick={downloadSigned} disabled={signedBusy} style={{ background: 'transparent', border: 'none', color: 'var(--muted,#8a8aa0)', fontWeight: 600, cursor: signedBusy ? 'wait' : 'pointer', fontSize: '.76rem', marginTop: 8, textDecoration: 'underline', padding: 0 }}>{signedBusy ? 'Checking…' : 'Download signed copy (once both have signed)'}</button>
              )}
            </div>
          ) : (booking.contract_status === 'signed' || locallySigned) ? (
            <div style={{ marginTop: 8 }}>
              <div style={{ color: '#00e0a4', fontWeight: 700 }}>✓ Contract signed</div>
              {signedDocs ? (
                <div style={{ display: 'flex', gap: '.5rem', marginTop: 8, flexWrap: 'wrap' }}>
                  {signedDocs.contract && <a href={signedDocs.contract} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', background: 'var(--neon,#00e0a4)', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', fontSize: '.8rem', textDecoration: 'none' }}>⬇ Signed contract</a>}
                  {signedDocs.audit && <a href={signedDocs.audit} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', fontSize: '.8rem', textDecoration: 'none' }}>⬇ Audit log</a>}
                </div>
              ) : (
                <button type="button" onClick={downloadSigned} disabled={signedBusy} style={{ background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', cursor: signedBusy ? 'wait' : 'pointer', fontSize: '.8rem', marginTop: 8 }}>{signedBusy ? 'Loading…' : '⬇ Download signed contract'}</button>
              )}
            </div>
          ) : archive ? (
            <div style={{ marginTop: 8, color: 'var(--muted,#8a8aa0)', fontSize: '.82rem' }}>
              {contractCancelled ? 'Contract was cancelled.' : 'No contract on file for this booking.'}
            </div>
          ) : (booking.is_manual && !hasHostContact) ? (
            /*
              A manual booking with nobody to send to.
              This button was live regardless — the section is gated on
              booking_type, which for a manual booking is the DJ's OWN type, so
              it's always true. Clicking it opened the contract portal, made the
              DJ pick a template and sign it, and only then hit NO_CLIENT_EMAIL.
              All that work before finding out there's no recipient.
              Same rule as the deposit, same door out: the modal the row's pencil
              opens, which already has Host Name, Host Email and the "Send
              booking details to host" checkbox.
            */
            <div style={{ marginTop: 8 }}>
              <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.82rem', lineHeight: 1.5, marginBottom: 10 }}>
                Add the host&rsquo;s full name and email to this booking before sending a contract &mdash; there&rsquo;s nobody to send it to yet.
              </div>
              {onEdit && (
                <button type="button" onClick={onEdit} style={{ background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.2rem', cursor: 'pointer', fontSize: '.82rem' }}>Add host details&hellip;</button>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              {contractCancelled && <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.78rem', marginBottom: 6 }}>Contract cancelled. Review and send a new one below.</div>}
              <button type="button" onClick={() => setContractOpen(true)} style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.2rem', cursor: 'pointer', fontSize: '.82rem' }}>Review &amp; Send Contract</button>
            </div>
          )}
        </div>
      )}
      {/* Payments — the manual-payment ledger for this booking. Rendered for
          the same set as the Contract section (real two-party bookings), plus
          any booking that already has payment rows. Purely informational —
          nothing here ever blocks another step. Archive mode still shows
          existing rows (read-only) but skips the section entirely when there
          is nothing to show. */}
      {(bt === 'club' || bt === 'mobile' || payments.length > 0) && (!archive || payments.length > 0) && (
        <div className={styles.notesFeedWrap} style={{ marginTop: '1rem' }}>
          <div className={styles.detailLabel}>Payments</div>
          <PaymentsBlock
            bookingId={booking.id}
            currency={booking.currency || 'USD'}
            payments={payments}
            onChange={(rows) => onPaymentsChange(booking.id, rows)}
            archive={archive}
            canRequestDeposit={canRequestDeposit}
            suggestedDeposit={booking.deposit_amount != null ? Number(booking.deposit_amount) : null}
            agreedTotal={
              booking.total_with_tax ?? booking.counter_rate ?? booking.quoted_rate ?? booking.offer_amount ?? null
            }
          />
        </div>
      )}
      {(bt === 'club' || bt === 'mobile') && (
        <div className={styles.notesFeedWrap}>
          <NotesFeed bookingId={booking.id} currentUserId={userId} />
        </div>
      )}
      {/* The signing-link explainer. A modal, not a toast: the DJ has to read
          past it to get the link, which is the entire safeguard. */}
      {linkBox && (
        <div
          onClick={() => setLinkBox(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card,#14141f)', border: '1px solid rgba(255,255,255,.14)',
              borderRadius: 12, padding: '1.1rem 1.2rem', maxWidth: 460, width: '100%',
              boxShadow: '0 12px 40px rgba(0,0,0,.6)',
            }}
          >
            <div style={{ fontWeight: 800, color: 'var(--white,#fff)', fontSize: '.95rem', marginBottom: '.5rem' }}>
              Client signing link
            </div>
            <p style={{ margin: '0 0 .75rem', color: '#f5a623', fontSize: '.8rem', lineHeight: 1.55 }}>
              <strong>Anyone who opens it can sign as your client.</strong> Contracts
              are not password protected. Send it straight to client/host — not
              into a group chat or anywhere public.
            </p>
            <input
              id="gdc-link-box"
              readOnly
              value={linkBox}
              onFocus={(e) => e.currentTarget.select()}
              style={{
                width: '100%', background: 'var(--deep,#0b0b12)', border: '1px solid rgba(255,255,255,.14)',
                borderRadius: 6, color: 'var(--white,#fff)', padding: '.55rem .7rem',
                fontFamily: "'Space Mono', monospace", fontSize: '.72rem', marginBottom: '.8rem',
              }}
            />
            <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setLinkBox(null)}
                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.18)', color: 'var(--muted,#8a8aa0)', fontWeight: 700, borderRadius: 6, padding: '.5rem 1rem', cursor: 'pointer', fontSize: '.8rem' }}
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void copyFromBox()}
                style={{ background: NEON, border: 'none', color: '#06231b', fontWeight: 800, borderRadius: 6, padding: '.5rem 1.1rem', cursor: 'pointer', fontSize: '.8rem' }}
              >
                {copyDone ? '\u2713 Copied' : 'Copy link'}
              </button>
            </div>
          </div>
        </div>
      )}
      {contractOpen && (
        <ContractPortal
          userId={userId}
          djType={djType}
          controlledOpen
          bookingId={booking.id}
          eventType={booking.event_type}
          onRequestClose={() => setContractOpen(false)}
          onUseContract={(id) => { setContractOpen(false); setSendContractId(id); }}
        />
      )}
      {sendContractId && (
        <ContractSendModal
          bookingId={booking.id}
          userId={userId}
          contractId={sendContractId}
          onClose={() => setSendContractId(null)}
          onSent={() => { setContractSent(true); setSendContractId(null); setContractCancelled(false); setResendDone(false); }}
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// PaymentsBlock — the DJ's ledger view of one booking's booking_payments
// rows, plus the Request Deposit action. (Send Invoice used to live here too —
// it's gone; Invoice is a column on the row now.)
//
// Rules (mirroring /api/payments):
//   • Display is always "received / total due" — never the bare word
//     "partial". The rails force partials (unverified Venmo caps at
//     $299.99/week, Cash App $250 — below a typical deposit), so the
//     fraction is the honest state.
//   • Confirm records an AMOUNT (what actually arrived), not a boolean.
//     amount_paid accumulates server-side; status flips to paid only when
//     it covers the ask.
//   • client_intent = 'pay_at_event' renders distinctly — "cash on the
//     night" means something totally different to a DJ than an ignored
//     invoice, though they look identical in the DB otherwise.
//   • Purely informational — nothing here blocks any other step.
//   • Archive mode still DISPLAYS rows but hides every action.
// ───────────────────────────────────────────────────────────────────────

function PaymentsBlock({
  bookingId, currency, payments, onChange, archive, canRequestDeposit,
  suggestedDeposit, agreedTotal,
}: {
  bookingId: string;
  currency: string;
  payments: BookingPayment[];
  onChange: (rows: BookingPayment[]) => void;
  archive?: boolean;
  canRequestDeposit: boolean;
  /** What the booking already says the deposit is — a SUGGESTION, not a rule.
   *  Null when the DJ had no deposit policy when this booking was made, or on
   *  manual bookings. */
  suggestedDeposit?: number | null;
  /** Agreed total (tax-inclusive snapshot first). Used to suggest the invoice. */
  agreedTotal?: number | null;
}) {
  // Which action is in flight: 'request-deposit' | 'request-balance' | a paymentId.
  const [busy, setBusy] = useState<string | null>(null);

  function money(n: number): string {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(n);
    } catch {
      return `$${Number(n).toFixed(2)}`;
    }
  }

  async function post(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch('/api/payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        alert(typeof json.error === 'string' ? json.error : 'Something went wrong. Try again in a moment.');
        return null;
      }
      return json;
    } catch {
      alert('Something went wrong. Try again in a moment.');
      return null;
    }
  }

  // Request Deposit. (requestPayment still takes 'balance' — the kind is alive
  // in the data and in the Invoice column; only the panel's button is gone.)
  //
  // The DJ names the amount, prefilled with what the booking suggests. That is
  // NOT the same as trusting a client-supplied price: a booker setting their own
  // price is a forgery; a DJ setting their own invoice is just their price. It's
  // their money and their call.
  //
  // It also has to work when nothing is suggested at all — a booking made before
  // the DJ had a deposit policy, or a manual booking, has no stored
  // deposit_amount. Deriving server-side ONLY meant those bookings hit
  // "No amount to request on this booking" with no way forward.
  async function requestPayment(kind: 'deposit' | 'balance') {
    const paidSoFar = payments.reduce((sum, p) => sum + Number(p.amount_paid || 0), 0);
    const suggestion = kind === 'deposit'
      ? (suggestedDeposit != null && suggestedDeposit > 0 ? suggestedDeposit : null)
      : (agreedTotal != null ? Math.round((Number(agreedTotal) - paidSoFar) * 100) / 100 : null);

    const raw = window.prompt(
      kind === 'deposit'
        ? 'How much deposit do you want to request?'
        : 'Invoice amount? (Adjust for overtime or extras if needed.)',
      suggestion != null && suggestion > 0 ? String(suggestion) : '',
    );
    if (raw == null) return; // cancelled
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Enter an amount greater than zero.');
      return;
    }

    setBusy(`request-${kind}`);
    try {
      const json = await post({ action: 'request', bookingId, kind, amount: Math.round(amount * 100) / 100 });
      if (json && json.payment) onChange([...payments, json.payment as BookingPayment]);
    } finally { setBusy(null); }
  }

  // Confirm takes an AMOUNT — prefilled with what's outstanding, editable
  // because a capped rail means the client may only have sent part of it.
  async function confirmReceived(p: BookingPayment) {
    const outstanding = Math.max(0, Math.round((Number(p.amount) - Number(p.amount_paid || 0)) * 100) / 100);
    const raw = window.prompt(
      'How much actually arrived? (Clients often have to split — unverified Venmo caps at $299.99/week.)',
      outstanding > 0 ? String(outstanding) : '',
    );
    if (raw == null) return;
    const received = Number(raw);
    if (!Number.isFinite(received) || received <= 0) {
      alert('Enter the amount you actually received.');
      return;
    }
    setBusy(p.id);
    try {
      const json = await post({ action: 'confirm', paymentId: p.id, amountReceived: received });
      if (json) {
        onChange(payments.map((row) => (row.id === p.id
          ? {
              ...row,
              amount_paid: typeof json.amount_paid === 'number' ? json.amount_paid : Number(row.amount_paid || 0) + received,
              status: typeof json.status === 'string' ? json.status : row.status,
            }
          : row)));
      }
    } finally { setBusy(null); }
  }

  async function waive(p: BookingPayment) {
    if (!confirm(`Waive this ${p.kind === 'balance' ? 'invoice' : 'deposit'}? The client won\u2019t owe it through the app anymore.`)) return;
    setBusy(p.id);
    try {
      const json = await post({ action: 'waive', paymentId: p.id });
      if (json) onChange(payments.map((row) => (row.id === p.id ? { ...row, status: 'waived' } : row)));
    } finally { setBusy(null); }
  }

  const depositRow = payments.find((p) => p.kind === 'deposit');
  // balanceRow and canSendInvoice lived here to drive the Send Invoice button.
  // With the button gone they were declared and never read, which fails the
  // build on no-unused-vars — removing a control means removing what fed it.
  //
  // Both still exist where they're still needed: BookingRow computes its own
  // balancePays/balanceRow and the deposit-settled gate for the Invoice column.
  // kindLabel below still renders 'balance' rows as "Invoice" in the ledger, so
  // an invoice raised before this change still displays correctly.

  const kindLabel = (p: BookingPayment) =>
    p.kind === 'balance' ? 'Invoice' : p.kind === 'deposit' ? 'Deposit' : (p.label || 'Payment');

  const statusChip = (p: BookingPayment): { text: string; color: string } => {
    switch (p.status) {
      case 'paid': return { text: 'Paid', color: '#00e0a4' };
      case 'waived': return { text: 'Waived', color: 'var(--muted,#8a8aa0)' };
      case 'partial': return { text: 'Partially paid', color: '#f0b23e' };
      case 'pending_confirmation':
        return { text: p.method ? `Client says sent via ${p.method}` : 'Client says sent', color: '#f0b23e' };
      default: return { text: 'Requested', color: 'var(--muted,#8a8aa0)' };
    }
  };

  const neonBtn = (disabled: boolean): React.CSSProperties => ({
    background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)',
    fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', fontSize: '.8rem',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
  });
  const redBtn = (disabled: boolean): React.CSSProperties => ({
    background: 'transparent', border: '1px solid #ff7676', color: '#ff7676',
    fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', fontSize: '.8rem',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
  });

  return (
    <div style={{ marginTop: 8 }}>
      {payments.length === 0 && (
        <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.82rem' }}>
          {archive ? 'No payments were recorded for this booking.' : 'No payments requested yet.'}
        </div>
      )}
      {payments.map((p) => {
        const chip = statusChip(p);
        const settled = p.status === 'paid' || p.status === 'waived';
        const rowBusy = busy === p.id;
        return (
          <div key={p.id} style={{ border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, padding: '.6rem .75rem', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '.6rem', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: '#fff', fontSize: '.85rem' }}>{kindLabel(p)}</span>
              {/* Received over total — always the fraction, never just "partial". */}
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '.85rem', color: '#fff' }}>
                {money(Number(p.amount_paid || 0))} / {money(Number(p.amount))}{settled ? '' : ' due'}
              </span>
              <span style={{ color: chip.color, fontWeight: 700, fontSize: '.72rem', letterSpacing: '.03em' }}>{chip.text}</span>
              {p.client_intent === 'pay_at_event' && !settled && (
                <span style={{ border: '1px solid #f0b23e', color: '#f0b23e', borderRadius: 999, padding: '.1rem .5rem', fontSize: '.68rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  Cash at event
                </span>
              )}
            </div>
            {p.client_intent === 'pay_at_event' && !settled && (
              <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.72rem', marginTop: 4 }}>
                The client plans to hand you this in person — expect an envelope, then confirm what you receive.
              </div>
            )}
            {!archive && !settled && (
              <div style={{ display: 'flex', gap: '.5rem', marginTop: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => confirmReceived(p)} disabled={rowBusy} style={neonBtn(rowBusy)}>
                  {rowBusy ? 'Saving…' : 'Confirm received'}
                </button>
                <button type="button" onClick={() => waive(p)} disabled={rowBusy} style={redBtn(rowBusy)}>
                  Waive
                </button>
              </div>
            )}
          </div>
        );
      })}
      {!archive && (
        <div style={{ marginTop: payments.length > 0 ? 4 : 10 }}>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            {!depositRow && (
              <button
                type="button"
                onClick={() => requestPayment('deposit')}
                disabled={!canRequestDeposit || busy === 'request-deposit'}
                title={canRequestDeposit ? 'Email the client a deposit request with your payment options' : 'Complete the contract step first'}
                style={neonBtn(!canRequestDeposit || busy === 'request-deposit')}
              >
                {busy === 'request-deposit' ? 'Requesting…' : 'Request Deposit'}
              </button>
            )}
            {/* Send Invoice removed from the panel — Invoice is a column on the
                row now, and two places to send the same thing is how the row
                and the panel end up disagreeing about whether it went. The
                'balance' payment kind, requestPayment('balance') and the
                canSendInvoice gate are all still here and still used by the
                Invoice column's state; only this button is gone. */}
          </div>
          {!depositRow && !canRequestDeposit && (
            <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.72rem', marginTop: 6 }}>
              Request Deposit unlocks once the contract step is complete — signed, or marked complete in the
              status strip if you handled the contract outside the app.
            </div>
          )}
          {/* The "Send Invoice unlocks once the deposit is paid or waived" note
              went with the button. A hint explaining a control that isn't on
              screen is worse than no hint — it describes something the DJ can't
              find and will go looking for. */}
        </div>
      )}
    </div>
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatLongDate(d: string): string {
  // Accepts YYYY-MM-DD OR an ISO timestamp; handle both.
  const onlyDate = d.length === 10 ? d : d.slice(0, 10);
  const [y, m, day] = onlyDate.split('-').map((s) => parseInt(s, 10));
  if (!y || !m || !day) return d;
  const date = new Date(y, m - 1, day);
  return date.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

// ───────────────────────────────────────────────────────────────────────
// AddManualBookingModal — form to create a manual booking row.
// ───────────────────────────────────────────────────────────────────────

function AddManualBookingModal({
  userId, djType, djCountry, djName, bookingsPerDay, mobPackages, existingBookings,
  existing, focusHost, prefillDate, onClose, onAdded, onUpdated,
}: {
  userId: string;
  djType: 'club' | 'mobile';
  djCountry: string;
  djName: string;
  bookingsPerDay: number;
  mobPackages: Record<string, MobilePackage[]> | null;
  existingBookings: UpcomingBooking[];
  existing: UpcomingBooking | null;
  /**
   * Opened via "Add host details…" rather than the pencil. Scrolls to the Host
   * Details block, focuses Host Name, and calls the block out — the modal opens
   * at the top and that block is below the fold, so without this you arrive at
   * a form that looks identical to a normal edit and shows no sign of the thing
   * you clicked for.
   */
  focusHost?: boolean;
  // Optional initial date for the new-booking flow — used when the modal
  // is opened from the public calendar's "Add Booking Details" button so
  // the date is already populated.
  prefillDate?: string;
  onClose: () => void;
  onAdded: (b: UpcomingBooking) => void;
  onUpdated: (b: UpcomingBooking) => void;
}) {
  const isEdit = existing !== null;

  function trimTime(t: string | null): string {
    if (!t) return '';
    return t.length >= 5 ? t.slice(0, 5) : t;
  }
  // When editing, existing.event_date wins; otherwise use the optional
  // prefillDate (from the public calendar deep-link).
  const [eventDate, setEventDate] = useState(existing?.event_date || prefillDate || '');
  const [startTime, setStartTime] = useState(trimTime(existing?.start_time || null));
  const [endTime, setEndTime] = useState(trimTime(existing?.end_time || null));
  const [venueName, setVenueName] = useState(existing?.venue_name || '');
  const [venueAddress, setVenueAddress] = useState(existing?.venue_address || '');
  const [country, setCountry] = useState<string>(djCountry || 'United States');
  const [venueType, setVenueType] = useState<string>(existing?.venue_type || '');
  const [setType, setSetType] = useState<string>(existing?.set_type || '');
  const [eventType, setEventType] = useState<string>(existing?.event_type || '');
  // Event-type-specific sub-fields, mirrored from the public booking form.
  // Pre-filled from an existing booking's event_details so edits round-trip.
  const initEd = (existing as { event_details?: string | null } | null)?.event_details || '';
  const initBirthday = existing?.event_type === 'birthday';
  const [eventSubType, setEventSubType] = useState<string>(
    initBirthday ? '' : (EVENT_SUBFIELDS[existing?.event_type || ''] ? initEd : '')
  );
  const [birthdayAge, setBirthdayAge] = useState<string>(
    initBirthday ? (initEd.match(/age:\s*([^·]+)/i)?.[1]?.trim() || '') : ''
  );
  const [surprise, setSurprise] = useState<boolean>(
    initBirthday ? /surprise party:\s*yes/i.test(initEd) : false
  );
  const eventTypeMounted = useRef(false);
  // Selected package index (as a string; '' = none) within the category that
  // matches the chosen event type. Pre-fill from an existing booking.
  const [selectedPkgIdx, setSelectedPkgIdx] = useState<string>(
    existing?.package_index != null ? String(existing.package_index) : ''
  );
  // Per-instance edit of the selected package's details. null = use the
  // package's saved details as-is; a string = details edited for THIS booking
  // only (never written back to the DJ's saved package).
  const [editedDetails, setEditedDetails] = useState<string | null>(
    existing?.package_details ? existing.package_details : null
  );
  const [editingDetails, setEditingDetails] = useState(false);
  // Cocktail hour (weddings only) — optional add via a link under the date.
  const [showCocktail, setShowCocktail] = useState<boolean>(
    !!existing?.cocktail_start_time || existing?.cocktail_needed === true
  );
  const [cocktailStart, setCocktailStart] = useState<string>(trimTime(existing?.cocktail_start_time || null));
  // Optional overtime rate (per hour), added via a link under the rate box.
  const [showOvertime, setShowOvertime] = useState<boolean>(existing?.overtime_rate != null);
  const [overtimeRate, setOvertimeRate] = useState<string>(existing?.overtime_rate != null ? String(existing.overtime_rate) : '');
  const detailsEditRef = useRef<HTMLDivElement>(null);
  // Seed the editable area's content when edit mode opens (uncontrolled, so
  // typing doesn't reset the caret).
  useEffect(() => {
    if (editingDetails && detailsEditRef.current) {
      detailsEditRef.current.innerHTML = editedDetails ?? '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingDetails]);
  // Packages for the current event type's category (general/wedding/mitzvah),
  // mirroring how the public booking form filters packages. Empty until an
  // event type is actually selected.
  const eventChosen = eventType !== '';
  const isWedding = eventType === 'weddings';
  const pkgCategory = getPackageCategory(eventType);
  const categoryPkgs: MobilePackage[] = eventChosen ? (mobPackages?.[pkgCategory] || []) : [];
  const generalPkgs: MobilePackage[] = mobPackages?.['general'] || [];
  // Only packages with a usable title are "ready" — matches the public booking
  // form, so empty packages (created but never filled in) are hidden until
  // they have content. Wedding/Mitzvah packages inherit the general-category
  // title at the same index as a fallback. Completeness is per-package: a
  // finished package shows even if others in the group are still empty.
  const usablePkgs = categoryPkgs
    .map((pkg, idx) => {
      const fallback = generalPkgs[idx] || ({} as MobilePackage);
      const title = (pkg?.title?.trim()) || (fallback.title?.trim()) || '';
      const details = (pkg?.details ?? fallback.details) || '';
      const plainDetails = details.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
      const reqAll = pkg?.reqAll ?? fallback.reqAll ?? false;
      // Effective package (pkg overrides, inherits general fallback), then
      // resolve its priced hour tiers (generalized; legacy 4/5/6 supported).
      const eff = { ...fallback, ...(pkg || {}) } as MobilePackage;
      const tiers = packageTiers(eff);
      const price4 = tiers.length ? tiers[0].price : null; // smallest tier = auto-fill base
      // "Price set" = at least one priced tier, OR price-on-request.
      const hasPrice = reqAll || tiers.length > 0;
      // Only fully-ready packages show: title AND description AND price set.
      // Partial/empty packages stay hidden until completed. Completeness is
      // per-package, so a finished one shows even if others are still empty.
      if (!pkg || !title || !plainDetails || !hasPrice) return null;
      return { idx, title, details, price4, reqAll, overtime: (pkg?.overtime ?? fallback.overtime) ?? null };
    })
    .filter((p): p is NonNullable<typeof p> => p != null);
  // Clear sub-fields + package selection when the user switches event type
  // (skip first render so an edit's pre-filled values survive mount).
  useEffect(() => {
    if (!eventTypeMounted.current) { eventTypeMounted.current = true; return; }
    setEventSubType('');
    setBirthdayAge('');
    setSurprise(false);
    setSelectedPkgIdx('');
    setEditedDetails(null);
    setEditingDetails(false);
    setShowCocktail(false);
    setCocktailStart('');
    setShowOvertime(false);
    setOvertimeRate('');
  }, [eventType]);
  // Host invite — only relevant for manual bookings. If editing a row that
  // already has an email saved, prefill it. If the email was already sent
  // (host_email_sent_at populated), the UI shows a "sent" state instead of
  // the checkbox to prevent accidental double-sends.
  const [hostEmail, setHostEmail] = useState<string>(existing?.host_email || '');
  const [hostName, setHostName] = useState<string>(existing?.requester_name || '');
  const [sendInvite, setSendInvite] = useState<boolean>(false);
  const hostEmailAlreadySent = !!existing?.host_email_sent_at;

  /**
   * Tick "Send booking details to host" by itself once a valid email is typed.
   *
   * WHY IT ISN'T JUST `sendInvite = hostEmailValid`:
   *
   * 1. ONLY ON THE TRANSITION invalid -> valid. If it keyed off "the email is
   *    valid" it would arm itself the instant you opened an existing booking
   *    that already has an address — you'd click the pencil to fix a typo in
   *    the end time, hit Save, and a booking-details email would go out that
   *    you never asked for. prevValid starts at the email's validity AT MOUNT,
   *    so a booking that arrives with an address is already "valid" and never
   *    triggers. Only actually typing one does.
   *
   * 2. A MANUAL UNTICK STICKS. Once you've touched the checkbox you've made a
   *    decision; the next keystroke in the email field must not overrule it.
   *    Without this, unticking and then fixing a typo in the address silently
   *    re-arms the send.
   *
   * 3. NOT ONCE IT'S ALREADY SENT — that path renders the "sent on X" banner
   *    with a Resend button instead of a checkbox, and re-arming a control that
   *    isn't on screen is how you double-fire.
   */
  const hostEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hostEmail.trim());
  const inviteTouched = useRef(false);
  const prevEmailValid = useRef(hostEmailValid);
  useEffect(() => {
    const wasValid = prevEmailValid.current;
    prevEmailValid.current = hostEmailValid;
    if (hostEmailAlreadySent) return;
    if (inviteTouched.current) return;
    if (!wasValid && hostEmailValid) setSendInvite(true);
  }, [hostEmailValid, hostEmailAlreadySent]);
  const [hostEmailSentAt, setHostEmailSentAt] = useState<string | null>(
    existing?.host_email_sent_at || null,
  );

  /**
   * Host Details is REQUIRED, not optional, the moment you want a contract or a
   * deposit on this booking — there's nobody to send either one to without it.
   * The block is labelled "(optional)" because for a gig you just want on your
   * calendar, it is. Both are true; which one applies depends on what you're
   * trying to do, and the form can't know that on its own.
   *
   * So: when you arrived here from "Add host details…", say it in red. That's
   * the only moment we know for certain you're blocked.
   */
  const hostBlockRef = useRef<HTMLDivElement | null>(null);
  const hostNameRef = useRef<HTMLInputElement | null>(null);
  const hostMissing = !hostName.trim() || !hostEmail.trim();
  const flagHost = !!focusHost && hostMissing;

  // Scroll the block into view and put the cursor in the first empty field.
  //
  // rAF, not a bare call: the modal is mounting on this same tick and its
  // scroll container has no height yet, so scrollIntoView would measure zero
  // and do nothing. One frame later the layout is real.
  useEffect(() => {
    if (!focusHost) return;
    const id = requestAnimationFrame(() => {
      hostBlockRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      // Focus whichever field is actually empty — jumping the cursor to Host
      // Name when the name is filled and only the email is missing just makes
      // them tab past it.
      if (!hostName.trim()) hostNameRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
    // Mount-only: re-running on every hostName keystroke would drag the scroll
    // position back mid-typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusHost]);
  // Optional flat rate. Stored as offer_amount + currency so it flows
  // through the same fields used by the normal booking flow.
  const [rate, setRate] = useState<string>(
    existing?.offer_amount != null ? String(existing.offer_amount) : '',
  );
  const [rateCurrency, setRateCurrency] = useState<string>(existing?.currency || 'USD');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  const [addrSuggestions, setAddrSuggestions] = useState<Array<{ display: string; lat: number | null; lon: number | null }>>([]);
  const [showAddrSuggestions, setShowAddrSuggestions] = useState(false);
  const addrTimerRef = useRef<NodeJS.Timeout | null>(null);
  const venueCoordsRef = useRef<{ lat: number; lon: number } | null>(
    existing?.venue_lat != null && existing?.venue_lon != null
      ? { lat: existing.venue_lat, lon: existing.venue_lon }
      : null,
  );

  const dateInputRef = useRef<HTMLInputElement>(null);
  const todayStr = new Date().toISOString().slice(0, 10);

  useEffect(() => () => { if (addrTimerRef.current) clearTimeout(addrTimerRef.current); }, []);

  // Derive the mobile-only email extras (event sub-detail, package name +
  // details, rate) from current form state, for the host invite email.
  function emailExtras() {
    const sel = (djType === 'mobile' && selectedPkgIdx !== '')
      ? usablePkgs.find((u) => String(u.idx) === selectedPkgIdx)
      : null;
    const rateNum = rate.trim() !== '' && !isNaN(Number(rate)) ? Number(rate) : null;
    return {
      eventDetails: djType === 'mobile'
        ? (buildEventDetails(eventType, { subType: eventSubType, birthdayAge, surprise }) || '')
        : '',
      packageTitle: sel?.title || '',
      packageDetails: djType === 'mobile' ? ((editedDetails ?? sel?.details) || '') : '',
      rate: rateNum,
      currency: rateCurrency,
    };
  }

  // Hit the email API. Returns ok / error message. Used for both "send"
  // (after save) and explicit "resend" actions.
  async function sendHostInviteEmail(opts: {
    bookingId: string;
    recipientEmail: string;
    isResend: boolean;
    // Snapshot of the current form values so the email reflects what the
    // user just saved, not stale values from the booking row.
    snapshot: {
      eventDate: string;
      startTime: string;
      endTime: string;
      venueName: string;
      venueAddress: string;
      venueType: string;
      setType: string;
      eventType: string;
      eventDetails: string;
      packageTitle: string;
      packageDetails: string;
      rate: number | null;
      currency: string;
    };
  }): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'manual_booking_invite',
          hostEmail: opts.recipientEmail,
          djName,
          djType,
          bookingId: opts.bookingId,
          eventDate: opts.snapshot.eventDate,
          startTime: opts.snapshot.startTime,
          endTime: opts.snapshot.endTime || null,
          venueName: opts.snapshot.venueName || null,
          venueAddress: opts.snapshot.venueAddress || null,
          venueType: opts.snapshot.venueType || null,
          setType: opts.snapshot.setType || null,
          eventType: opts.snapshot.eventType || null,
          eventDetails: opts.snapshot.eventDetails || null,
          packageTitle: opts.snapshot.packageTitle || null,
          packageDetails: opts.snapshot.packageDetails || null,
          rate: opts.snapshot.rate,
          currency: opts.snapshot.currency,
          isResend: opts.isResend,
        }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || 'Email send failed' };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
    }
  }

  // Standalone resend (edit mode, after the email's already been sent once).
  async function handleResend() {
    setResendBusy(true);
    setResendSuccess(false);
    setError(null);
    if (!existing) { setResendBusy(false); return; }
    const recipientEmail = (hostEmail || existing.host_email || '').trim();
    if (!recipientEmail || !recipientEmail.includes('@')) {
      setError('No valid host email on file to resend to.');
      setResendBusy(false);
      return;
    }

    // Same guard as handleSave — never send a host invite to a DJ account.
    try {
      const lookupRes = await fetch(
        `/api/lookup-dj-by-email?email=${encodeURIComponent(recipientEmail)}`,
      );
      if (lookupRes.ok) {
        const lookup = await lookupRes.json() as { found?: boolean; isDj?: boolean };
        if (lookup?.found && lookup.isDj) {
          setError(
            'This email is registered as a DJ account, which can\u2019t be added as the host of a booking. Update the email before resending.',
          );
          setResendBusy(false);
          return;
        }
      }
    } catch (e) {
      console.error('[upcoming-bookings] resend host email lookup failed', e);
    }

    const result = await sendHostInviteEmail({
      bookingId: existing.id,
      recipientEmail,
      isResend: true,
      snapshot: {
        eventDate, startTime, endTime, venueName, venueAddress,
        venueType, setType, eventType,
        ...emailExtras(),
      },
    });
    if (!result.ok) {
      setError(result.error || 'Resend failed.');
      setResendBusy(false);
      return;
    }
    // Update host_email_sent_at server-side too so future opens see fresh date.
    const supabase = createClient();
    const nowIso = new Date().toISOString();
    await supabase
      .from('bookings')
      .update({ host_email: recipientEmail, host_email_sent_at: nowIso } as unknown as never)
      .eq('id', existing.id)
      .eq('dj_id', userId);
    setHostEmailSentAt(nowIso);
    setResendSuccess(true);
    setResendBusy(false);
  }

  function openDatePicker() {
    const el = dateInputRef.current;
    if (!el) return;
    // showPicker is the modern API. Fall back to focus() on older browsers.
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); return; } catch { /* fall through */ }
    }
    el.focus();
  }

  async function handleSave() {
    setError(null);
    if (!eventDate) { setError('Pick a date.'); return; }
    if (!startTime) { setError('Pick a start time.'); return; }
    if (djType === 'mobile' && !endTime) { setError('Pick an end time.'); return; }
    if (djType === 'club' && !venueName.trim()) { setError('Venue name is required.'); return; }

    // Daily-cap check — only fires when adding NEW or moving an existing
    // booking onto a fuller day. Editing an existing booking on its own
    // date is exempt (we'd be counting it against itself).
    const sameDay = existingBookings.filter(
      (b) => b.event_date === eventDate && (!isEdit || b.id !== existing.id),
    ).length;
    const cap = djType === 'club' ? 1 : Math.max(1, bookingsPerDay || 1);
    if (sameDay >= cap) {
      const msg = djType === 'club'
        ? `You already have a booking on ${eventDate}. Club/bar DJs can only have one booking per day. Save anyway?`
        : `You already have ${sameDay} booking(s) on ${eventDate} (your daily cap is ${cap}). Save anyway?`;
      if (!confirm(msg)) return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const coords = venueCoordsRef.current;
      // Shared payload for both insert and update.
      const trimmedEmail = hostEmail.trim();

      // Block: the host_email field is for the booking's HOST (the person
      // who hired the DJ). It must not point to another DJ account — a DJ
      // can't accept their own gig as the host. Look the email up against
      // the user base and reject if it resolves to a DJ. Hosts and venues
      // are both valid as host-side accounts.
      if (trimmedEmail && trimmedEmail.includes('@')) {
        try {
          const lookupRes = await fetch(
            `/api/lookup-dj-by-email?email=${encodeURIComponent(trimmedEmail)}`,
          );
          if (lookupRes.ok) {
            const lookup = await lookupRes.json() as {
              found?: boolean;
              isDj?: boolean;
              name?: string | null;
            };
            if (lookup?.found && lookup.isDj) {
              setError(
                'This email is registered as a DJ account, which can\u2019t be added as the host of a booking. Enter a host or venue email, or leave the field blank.',
              );
              setSaving(false);
              return;
            }
          }
        } catch (e) {
          // Network failure on lookup — don't hard-block, just log. The
          // host-side has the same forgiving behavior.
          console.error('[upcoming-bookings] host email lookup failed', e);
        }
      }

      // Parse rate. Empty → null; invalid → error.
      const rateTrimmed = rate.trim();
      let rateNum: number | null = null;
      if (rateTrimmed) {
        rateNum = Number(rateTrimmed);
        if (!Number.isFinite(rateNum) || rateNum < 0) {
          setError('Rate must be a positive number.');
          setSaving(false);
          return;
        }
      }
      const pkgSelected = djType === 'mobile' && selectedPkgIdx !== '';
      const selectedUsable = pkgSelected ? usablePkgs.find((u) => String(u.idx) === selectedPkgIdx) : null;
      // Instance details: a selected package's (possibly edited) details, OR
      // free-text details typed when no packages exist for this type.
      const instanceDetails = djType === 'mobile'
        ? (((editedDetails ?? selectedUsable?.details) || '').trim() || null)
        : null;
      const payload = {
        booking_type: djType,
        event_date: eventDate,
        start_time: startTime,
        end_time: endTime || null,
        venue_name: venueName.trim() || null,
        venue_address: venueAddress.trim() || null,
        venue_lat: coords?.lat ?? null,
        venue_lon: coords?.lon ?? null,
        venue_type: djType === 'club' ? (venueType || null) : null,
        set_type: djType === 'club' ? (setType || null) : null,
        event_type: djType === 'mobile' ? (eventType || null) : null,
        event_details: djType === 'mobile'
          ? buildEventDetails(eventType, { subType: eventSubType, birthdayAge, surprise })
          : null,
        cocktail_needed: (djType === 'mobile' && isWedding && showCocktail) ? true : null,
        cocktail_start_time: (djType === 'mobile' && isWedding && showCocktail && cocktailStart) ? cocktailStart : null,
        package_title: selectedUsable ? selectedUsable.title : null,
        package_details: instanceDetails,
        package_category: (selectedUsable || instanceDetails) ? pkgCategory : null,
        package_index: selectedUsable ? selectedUsable.idx : null,
        overtime_rate: (djType === 'mobile' && showOvertime && overtimeRate.trim() !== '' && Number(overtimeRate) > 0)
          ? Number(overtimeRate) : null,
        host_email: trimmedEmail || null,
        requester_name: hostName.trim() || null,
        offer_amount: rateNum,
        currency: rateNum != null ? rateCurrency : null,
      };
      const selectCols = 'id, event_date, start_time, end_time, venue_name, venue_address, venue_lat, venue_lon, venue_type, set_type, event_type, event_details, cocktail_needed, cocktail_start_time, package_title, package_details, package_category, package_index, overtime_rate, booking_type, is_manual, flyer_url, host_email, host_email_sent_at, requester_name, offer_amount, original_rate, discount_code, discount_label, discount_amount, currency, tax_pct, tax_amount, total_with_tax';

      // Decide whether to send the invite email after save.
      const shouldSend = sendInvite && !!trimmedEmail && trimmedEmail.includes('@') && !hostEmailAlreadySent;

      if (isEdit) {
        const { data, error: e } = await supabase
          .from('bookings')
          .update(payload as unknown as never)
          .eq('id', existing.id)
          .eq('dj_id', userId)
          .select(selectCols)
          .single();
        if (e) throw e;
        let updated = { ...(data as unknown as UpcomingBooking), is_manual: true };
        // Fire email if requested.
        if (shouldSend) {
          const result = await sendHostInviteEmail({
            bookingId: existing.id,
            recipientEmail: trimmedEmail,
            isResend: false,
            snapshot: {
              eventDate, startTime, endTime, venueName, venueAddress,
              venueType, setType, eventType,
              ...emailExtras(),
            },
          });
          if (result.ok) {
            const nowIso = new Date().toISOString();
            await supabase
              .from('bookings')
              .update({ host_email_sent_at: nowIso } as unknown as never)
              .eq('id', existing.id)
              .eq('dj_id', userId);
            updated = { ...updated, host_email_sent_at: nowIso };
            setHostEmailSentAt(nowIso);
          } else {
            // Save succeeded but email failed — surface the error and bail
            // so the user can decide what to do. Booking is already updated.
            setError('Booking saved, but email failed: ' + (result.error || 'unknown'));
            setSaving(false);
            onUpdated(updated);
            return;
          }
        }
        onUpdated(updated);
      } else {
        const insertRow = {
          ...payload,
          dj_id: userId,
          requester_id: userId,
          is_manual: true,
          status: 'approved',
        };
        const { data, error: e } = await supabase
          .from('bookings')
          .insert(insertRow as unknown as never)
          .select(selectCols)
          .single();
        if (e) throw e;
        let inserted = { ...(data as unknown as UpcomingBooking), is_manual: true };
        if (shouldSend) {
          const result = await sendHostInviteEmail({
            bookingId: inserted.id,
            recipientEmail: trimmedEmail,
            isResend: false,
            snapshot: {
              eventDate, startTime, endTime, venueName, venueAddress,
              venueType, setType, eventType,
              ...emailExtras(),
            },
          });
          if (result.ok) {
            const nowIso = new Date().toISOString();
            await supabase
              .from('bookings')
              .update({ host_email_sent_at: nowIso } as unknown as never)
              .eq('id', inserted.id)
              .eq('dj_id', userId);
            inserted = { ...inserted, host_email_sent_at: nowIso };
          } else {
            setError('Booking saved, but email failed: ' + (result.error || 'unknown'));
            setSaving(false);
            onAdded(inserted);
            return;
          }
        }
        onAdded(inserted);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{isEdit ? 'Edit Manual Booking' : 'Add Booking Manually'}</h2>
          <button type="button" onClick={onClose} className={styles.modalClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.modalBody}>
          {/* Event Type (+ secondary field) at the top, so the rest of the
              form (package/rate, reception labels, cocktail hour) keys off it. */}
          {djType === 'mobile' && (
            <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <label className={styles.field} style={{ flex: '0 0 auto', maxWidth: '100%' }}>
                <span className={styles.fieldLabel} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
                  Event Type
                  {eventChosen && EVENT_SUBFIELDS[eventType] && (
                    <svg width="26" height="10" viewBox="0 0 26 10" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
                      <line x1="1" y1="5" x2="21" y2="5" stroke="var(--neon)" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M17 1.5 L22 5 L17 8.5" stroke="var(--neon)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  className={styles.input}
                  style={{ width: '210px', maxWidth: '100%' }}
                >
                  <option value="">Select event type…</option>
                  {MOBILE_EVENT_TYPES.map((v) => (
                    <option key={v.value} value={v.value}>{v.label}</option>
                  ))}
                </select>
              </label>

              {/* Sub-category, to the right of the event-type box. */}
              {EVENT_SUBFIELDS[eventType]?.textLabel && (
                <label className={styles.field} style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <span className={styles.fieldLabel}>{EVENT_SUBFIELDS[eventType].textLabel}</span>
                  <input
                    type="text"
                    value={eventSubType}
                    onChange={(e) => setEventSubType(e.target.value)}
                    placeholder={EVENT_SUBFIELDS[eventType].textPlaceholder}
                    className={styles.input}
                    autoComplete="off"
                  />
                </label>
              )}
              {EVENT_SUBFIELDS[eventType]?.isBirthday && (
                <div className={styles.field} style={{ flex: '1 1 auto' }}>
                  <span className={styles.fieldLabel}>Guest of Honor Age?</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={birthdayAge}
                    onChange={(e) => setBirthdayAge(e.target.value)}
                    placeholder="30"
                    className={styles.input}
                    style={{ width: '100%' }}
                    autoComplete="off"
                  />
                  {/* Snug under the age box (the .field column gap handles spacing). */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.8rem', whiteSpace: 'nowrap' }}>
                    <input
                      type="checkbox"
                      checked={surprise}
                      onChange={(e) => setSurprise(e.target.checked)}
                      style={{ width: 15, height: 15, flexShrink: 0, accentColor: 'var(--neon)', cursor: 'pointer' }}
                    />
                    Is this a Surprise Party?
                  </label>
                </div>
              )}
            </div>
          )}
          {/* Date + Start Time + End Time on a single row. Clicking
              anywhere on the date field opens the native picker. */}
          <div className={styles.fieldRow3}>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Date</span>
              <div
                className={styles.dateWrap}
                onClick={openDatePicker}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDatePicker(); } }}
              >
                <input
                  ref={dateInputRef}
                  type="date"
                  min={todayStr}
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className={styles.dateInput}
                />
              </div>
            </div>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{isWedding ? 'Reception Start' : 'Start Time'}</span>
              <select value={startTime} onChange={(e) => setStartTime(e.target.value)} className={styles.input}>
                <option value="">Select…</option>
                {TIME_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                {isWedding ? 'Reception End' : <>End Time {djType === 'club' && <span className={styles.optional}>(optional)</span>}</>}
              </span>
              <select value={endTime} onChange={(e) => setEndTime(e.target.value)} className={styles.input}>
                <option value="">Select…</option>
                {TIME_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
          </div>
          {(isWedding || durationLabel(hoursBetween(startTime, endTime))) && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginTop: '-.3rem', marginBottom: '.35rem' }}>
              <div>
                {isWedding && (
                  !showCocktail ? (
                    <button
                      type="button"
                      onClick={() => setShowCocktail(true)}
                      style={{ background: 'none', border: 'none', color: 'var(--neon)', fontSize: '.78rem', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                    >
                      + Add Cocktail Hour
                    </button>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.55rem', flexWrap: 'wrap' }}>
                      <span className={styles.fieldLabel} style={{ margin: 0, color: 'var(--neon)' }}>Cocktail Hour Start</span>
                      <select
                        value={cocktailStart}
                        onChange={(e) => setCocktailStart(e.target.value)}
                        className={styles.input}
                        style={{ width: 'auto' }}
                      >
                        <option value="">Select…</option>
                        {TIME_OPTIONS.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => { setShowCocktail(false); setCocktailStart(''); }}
                        style={{ background: 'none', border: 'none', color: '#ff5f5f', fontSize: '.72rem', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                      >
                        Remove
                      </button>
                    </div>
                  )
                )}
              </div>
              {durationLabel(hoursBetween(startTime, endTime)) && (
                <div style={{ fontSize: '.72rem', color: '#ffd24a', whiteSpace: 'nowrap' }}>
                  Event Duration: {durationLabel(hoursBetween(startTime, endTime))}
                </div>
              )}
            </div>
          )}

          {/* Venue name + Rate on one line. Venue name takes the
              remaining width; the rate box is narrow (~5 chars). */}
          <div className={styles.venueRateRow}>
            <label className={styles.field} style={{ flex: 1, minWidth: 0 }}>
              <span className={styles.fieldLabel}>
                Venue Name {djType === 'mobile' && <span className={styles.optional}>(optional)</span>}
              </span>
              <input
                type="text"
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
                placeholder={djType === 'club' ? 'e.g. Black Velvet Lounge' : 'e.g. Riverside Park Pavilion'}
                className={styles.input}
                style={{ width: '100%' }}
              />
            </label>
            {djType === 'club' && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  Rate <span className={styles.optional}>(optional)</span>
                </span>
                <div className={styles.rateRow}>
                  <div className={styles.rateInputWrap}>
                    <span className={styles.rateSymbol}>
                      {rateCurrency === 'USD' ? '$' : rateCurrency === 'EUR' ? '€' : rateCurrency === 'GBP' ? '£' : rateCurrency === 'CAD' ? '$' : rateCurrency === 'AUD' ? '$' : rateCurrency}
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                      placeholder="0"
                      className={styles.rateInput}
                    />
                  </div>
                  <select
                    value={rateCurrency}
                    onChange={(e) => setRateCurrency(e.target.value)}
                    className={styles.rateCurrencySelect}
                    aria-label="Currency"
                  >
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="CAD">CAD</option>
                    <option value="AUD">AUD</option>
                  </select>
                </div>
              </label>
            )}
          </div>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>Venue Location</span>
            <div className={styles.addrRow}>
              <div className={styles.addrWrap}>
                <input
                  type="text"
                  value={venueAddress}
                  onChange={(e) => {
                    const val = e.target.value;
                    setVenueAddress(val);
                    venueCoordsRef.current = null;
                    if (addrTimerRef.current) clearTimeout(addrTimerRef.current);
                    if (val.trim().length < 3) {
                      setAddrSuggestions([]);
                      setShowAddrSuggestions(false);
                      return;
                    }
                    addrTimerRef.current = setTimeout(async () => {
                      const cc = COUNTRY_CODES_ADDR[country] || null;
                      const results = await searchAddresses(val.trim(), cc);
                      setAddrSuggestions(results);
                      setShowAddrSuggestions(results.length > 0);
                    }, 350);
                  }}
                onBlur={() => setTimeout(() => setShowAddrSuggestions(false), 150)}
                onFocus={() => { if (addrSuggestions.length > 0) setShowAddrSuggestions(true); }}
                placeholder="Start typing address…"
                className={styles.input}
                autoComplete="off"
              />
              {showAddrSuggestions && addrSuggestions.length > 0 && (
                <div className={styles.addrSuggestions}>
                  {addrSuggestions.map((s, i) => (
                    <div
                      key={i}
                      className={styles.addrSuggestion}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setVenueAddress(s.display);
                        if (s.lat != null && s.lon != null) {
                          venueCoordsRef.current = { lat: s.lat, lon: s.lon };
                        } else {
                          venueCoordsRef.current = null;
                        }
                        setShowAddrSuggestions(false);
                      }}
                    >
                      {s.display}
                    </div>
                  ))}
                </div>
              )}
              </div>
              <select
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value);
                  setAddrSuggestions([]);
                  setShowAddrSuggestions(false);
                  venueCoordsRef.current = null;
                }}
                className={styles.countrySelect}
                aria-label="Country for address search"
              >
                {COUNTRIES.filter((c) => c !== 'Other').map((c) => (
                  <option key={c} value={c}>
                    {COUNTRY_FLAGS[c] || '🌍'} {(COUNTRY_CODES_ADDR[c] || '??').toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Package + Rate — after Event Type. Both stay visible but
              disabled (unclickable) until an event type is selected. The
              selected package's saved details show indented below. */}
          {djType === 'mobile' && (
            <>
              <div className={styles.venueRateRow} style={{ opacity: eventChosen ? 1 : 0.5 }}>
                <label className={styles.field} style={{ flex: '1 1 160px', minWidth: 0 }}>
                  <span className={styles.fieldLabel}>Package</span>
                  <select
                    value={selectedPkgIdx}
                    disabled={!eventChosen}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSelectedPkgIdx(v);
                      setEditingDetails(false);
                      const p = v !== '' ? usablePkgs.find((u) => String(u.idx) === v) : null;
                      // New selection starts from the package's saved details.
                      setEditedDetails(p ? (p.details || '') : null);
                      if (p) {
                        // Pre-fill the rate with the package's base (4hr) price;
                        // skip for price-on-request packages. The DJ can still
                        // edit the Rate box afterward.
                        if (!p.reqAll && p.price4 != null && String(p.price4) !== '') {
                          setRate(String(p.price4));
                        }
                        // If the package carries an overtime rate, surface it
                        // (editable); otherwise leave the overtime field as-is.
                        if (p.overtime != null && String(p.overtime).trim() !== '' && Number(p.overtime) > 0) {
                          setOvertimeRate(String(p.overtime));
                          setShowOvertime(true);
                        }
                      }
                    }}
                    className={styles.input}
                  >
                    {!eventChosen ? (
                      <option value="">Select event type first</option>
                    ) : usablePkgs.length === 0 ? (
                      <option value="">No packages for this type</option>
                    ) : (
                      <>
                        <option value="">— None —</option>
                        {usablePkgs.map((u) => (
                          <option key={u.idx} value={u.idx}>{u.title}</option>
                        ))}
                      </>
                    )}
                  </select>
                </label>
                <div className={styles.field} style={{ flex: '0 0 auto' }}>
                  <span className={styles.fieldLabel}>Rate <span className={styles.optional}>(optional)</span></span>
                  <div className={styles.rateRow}>
                    <div className={styles.rateInputWrap}>
                      <span className={styles.rateSymbol}>
                        {rateCurrency === 'USD' ? '$' : rateCurrency === 'EUR' ? '€' : rateCurrency === 'GBP' ? '£' : rateCurrency === 'CAD' ? '$' : rateCurrency === 'AUD' ? '$' : rateCurrency}
                      </span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        value={rate}
                        onChange={(e) => setRate(e.target.value)}
                        placeholder="0"
                        className={styles.rateInput}
                        disabled={!eventChosen}
                      />
                    </div>
                    <select
                      value={rateCurrency}
                      onChange={(e) => setRateCurrency(e.target.value)}
                      className={styles.rateCurrencySelect}
                      aria-label="Currency"
                      disabled={!eventChosen}
                    >
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="GBP">GBP</option>
                      <option value="CAD">CAD</option>
                      <option value="AUD">AUD</option>
                    </select>
                  </div>
                  {/* Optional overtime rate (per hour), shown under the rate box. */}
                  {!showOvertime ? (
                    <button
                      type="button"
                      disabled={!eventChosen}
                      onClick={() => setShowOvertime(true)}
                      style={{ background: 'none', border: 'none', color: 'var(--neon)', fontSize: '.72rem', cursor: eventChosen ? 'pointer' : 'default', padding: 0, marginTop: '.35rem', textDecoration: 'underline', alignSelf: 'flex-start' }}
                    >
                      + Add Overtime Rate
                    </button>
                  ) : (
                    <div style={{ marginTop: '.4rem' }}>
                      <span className={styles.fieldLabel} style={{ display: 'block', marginBottom: '.2rem' }}>Overtime Rate (per hour)</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        <div className={styles.rateInputWrap}>
                          <span className={styles.rateSymbol}>
                            {rateCurrency === 'USD' ? '$' : rateCurrency === 'EUR' ? '€' : rateCurrency === 'GBP' ? '£' : rateCurrency === 'CAD' ? '$' : rateCurrency === 'AUD' ? '$' : rateCurrency}
                          </span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            value={overtimeRate}
                            onChange={(e) => setOvertimeRate(e.target.value)}
                            placeholder="0"
                            className={styles.rateInput}
                            disabled={!eventChosen}
                          />
                        </div>
                        <span style={{ fontSize: '.72rem', opacity: 0.7 }}>/hr</span>
                        <button
                          type="button"
                          onClick={() => { setShowOvertime(false); setOvertimeRate(''); }}
                          style={{ background: 'none', border: 'none', color: '#ff5f5f', fontSize: '.72rem', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {/* Package details — shown indented/smaller, editable for THIS
                  booking only (never saved back to the package). When there are
                  no packages for this type, offer a free-text "Add Package
                  Detail" entry for this booking. */}
              {eventChosen && (() => {
                const sel = selectedPkgIdx !== ''
                  ? usablePkgs.find((u) => String(u.idx) === selectedPkgIdx)
                  : null;
                const noPackages = usablePkgs.length === 0;
                if (!sel && !noPackages) return null;
                const shown = editedDetails ?? (sel?.details || '');
                return (
                  <div style={{ marginLeft: '1rem', marginTop: '.1rem' }}>
                    {editingDetails ? (
                      <>
                        <div
                          ref={detailsEditRef}
                          contentEditable
                          suppressContentEditableWarning
                          onInput={(e) => setEditedDetails(e.currentTarget.innerHTML)}
                          style={{
                            fontSize: '.78rem', lineHeight: 1.5, opacity: 0.9,
                            border: '1px solid var(--neon)', borderRadius: 6,
                            padding: '.4rem .55rem', outline: 'none', minHeight: '2.5rem',
                          }}
                        />
                        <div style={{ textAlign: 'right', marginTop: '.2rem' }}>
                          <button
                            type="button"
                            onClick={() => setEditingDetails(false)}
                            style={{ background: 'none', border: 'none', color: 'var(--neon)', fontSize: '.72rem', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                          >
                            Done
                          </button>
                        </div>
                      </>
                    ) : shown ? (
                      <>
                        <div
                          style={{ fontSize: '.78rem', opacity: 0.7, lineHeight: 1.5 }}
                          dangerouslySetInnerHTML={{ __html: shown }}
                        />
                        {/* Centred under the package text, not tucked in the
                            right margin. "Edit" alone sat below a paragraph of
                            package details, level with nothing, and named no
                            object — at a glance it read as the edit control for
                            whatever field happened to be nearest. */}
                        <div style={{ textAlign: 'center', marginTop: '.5rem' }}>
                          <button
                            type="button"
                            onClick={() => { setEditedDetails((prev) => prev ?? sel?.details ?? ''); setEditingDetails(true); }}
                            style={{ background: 'none', border: 'none', color: 'var(--neon)', fontSize: '.72rem', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                          >
                            Edit package details
                          </button>
                        </div>
                      </>
                    ) : noPackages ? (
                      <button
                        type="button"
                        onClick={() => { setEditedDetails((prev) => prev ?? ''); setEditingDetails(true); }}
                        style={{ background: 'none', border: 'none', color: 'var(--neon)', fontSize: '.78rem', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                      >
                        + Add Package Detail
                      </button>
                    ) : null}
                  </div>
                );
              })()}
            </>
          )}

          {/* ── Host invitation section ─────────────────────────────────
              DJ can email the host with booking details. After the email
              sends once, the checkbox/send-button UI is replaced with a
              "sent on X" banner + a Resend button, so the DJ can't double-
              fire emails by accident. */}
          <div
            ref={hostBlockRef}
            className={styles.hostInviteBlock}
            style={flagHost ? {
              // Only when we KNOW they're blocked (arrived from "Add host
              // details"), never on a routine pencil edit — a red box round a
              // block genuinely marked optional would be crying wolf.
              //
              // Frame only, no fill. The tint sat behind the inputs and pushed
              // every field in the block off the modal's own surface colour —
              // so the whole area read as broken rather than as "these two
              // fields are the point". The border says it once.
              border: '1px solid rgba(255,86,86,.5)',
              borderRadius: 8,
              padding: '.9rem',
            } : undefined}
          >
            <div className={styles.fieldLabel} style={{ textAlign: 'left', opacity: flagHost ? 1 : 0.55, marginBottom: '.55rem' }}>
              Host Details{' '}
              {flagHost
                ? <span style={{ color: '#ff5656', fontWeight: 700 }}>(required)</span>
                : <span className={styles.optional}>(optional)</span>}
            </div>
            {/*
              The block ALWAYS says what it's for — including on a brand-new
              booking, which is the only moment the DJ is actually in a position
              to fill it in without coming back.

              It said "(optional)" and nothing else, which is true and useless:
              optional for WHAT? The DJ finds out days later, when they go to
              send a contract and can't. The consequence belongs next to the
              decision, not at the point it bites.

              Two voices, same fact:
                red   — you clicked "Add host details…", you're blocked NOW
                muted — just so you know, this is what these two fields buy you
            */}
            {flagHost ? (
              // The "tick Send booking details" half is gone and shouldn't come
              // back — the checkbox ticks itself now, so it was telling the DJ
              // to do something the form had already done.
              <div style={{ color: '#ff8a8a', fontSize: '.76rem', lineHeight: 1.5, marginBottom: '.7rem' }}>
                Add the host&rsquo;s full name and email to send a contract or request a deposit.
              </div>
            ) : (
              <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.72rem', lineHeight: 1.5, marginBottom: '.7rem' }}>
                Needed to send a contract or request a deposit. Leave blank if you just want the
                date held.
              </div>
            )}
            <div style={{ display: 'flex', gap: '.6rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <label className={styles.field} style={{ flex: '1 1 130px', minWidth: 0 }}>
                {/* "Full name", not "Name" — this goes on the contract. A DJ
                    typing "Jordan" here is putting "Jordan" on a signed
                    agreement, and the label is the only thing that says
                    otherwise before it's too late. */}
                <span className={styles.fieldLabel}>Host Full Name</span>
                <input
                  ref={hostNameRef}
                  type="text"
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  placeholder="e.g. Jordan Smith"
                  className={styles.input}
                  style={{ width: '100%', ...(flagHost && !hostName.trim() ? { borderColor: 'rgba(255,86,86,.55)' } : {}) }}
                  autoComplete="off"
                />
              </label>
              <label className={styles.field} style={{ flex: '1 1 160px', minWidth: 0 }}>
                <span className={styles.fieldLabel}>Host Email {hostEmailAlreadySent && <span className={styles.optional}>(sent)</span>}</span>
                <input
                  type="email"
                  value={hostEmail}
                  onChange={(e) => setHostEmail(e.target.value)}
                  placeholder="host@example.com"
                  className={styles.input}
                  style={{ width: '100%', ...(flagHost && !hostEmail.trim() ? { borderColor: 'rgba(255,86,86,.55)' } : {}) }}
                  autoComplete="off"
                />
              </label>
            </div>
            {hostEmailAlreadySent ? (
              <div className={styles.sentBanner}>
                <div className={styles.sentBannerText}>
                  Booking details sent {hostEmailSentAt ? `on ${formatSentDate(hostEmailSentAt)}` : ''}.
                </div>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendBusy || saving}
                  className={styles.resendBtn}
                >
                  {resendBusy ? 'Sending…' : (resendSuccess ? 'Sent ✓' : 'Resend Email')}
                </button>
              </div>
            ) : (
              <label className={styles.inviteCheckRow}>
                <input
                  type="checkbox"
                  checked={sendInvite}
                  // inviteTouched, not just setSendInvite: this is the DJ making
                  // a decision, and it has to outrank the auto-tick. Without it,
                  // unticking and then fixing a typo in the address silently
                  // re-arms the send.
                  onChange={(e) => { inviteTouched.current = true; setSendInvite(e.target.checked); }}
                  // The same regex the auto-tick uses. It was `includes('@')`,
                  // which called "a@" valid — so the box could be ticked on an
                  // address that can't receive anything, and the two rules would
                  // have disagreed about what "valid" means.
                  disabled={!hostEmailValid}
                />
                <span>
                  Send booking details to host
                  {!hostEmailValid && (
                    <span className={styles.checkHint}> · enter a valid email first</span>
                  )}
                </span>
              </label>
            )}
          </div>

          {error && <div className={styles.errorBox}>{error}</div>}
        </div>

        <div className={styles.modalFooter}>
          <button type="button" onClick={onClose} className={styles.cancelBtn} disabled={saving}>Cancel</button>
          <button type="button" onClick={handleSave} className={styles.saveBtn} disabled={saving}>
            {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Add Booking')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Display helpers ────────────────────────────────────────────────────

// Stacked-pill date parts used by the row date display: a big day number,
// with a short day-of-week and month stacked beside it. Matches the
// public club/bar profile event list aesthetic.
function getDateParts(d: string | null): { day: string; dow: string; mo: string } {
  if (!d) return { day: '—', dow: '', mo: '' };
  const [y, m, day] = d.split('-').map((s) => parseInt(s, 10));
  const date = new Date(y, m - 1, day);
  return {
    day: String(day),
    dow: date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
    mo: date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
  };
}

function formatTimeRange(s: string | null, e: string | null): string {
  const start = s ? formatTime12(s) : '';
  const end = e ? formatTime12(e) : '';
  if (start && end) return `${start} – ${end}`;
  if (start) return start;
  return '—';
}

function formatTime12(t: string): string {
  const [hStr, mStr] = t.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

// Format an ISO timestamp as a short "Mar 15, 2026" date for the "sent on"
// banner. Used only in the modal's host-invite section.
function formatSentDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}
