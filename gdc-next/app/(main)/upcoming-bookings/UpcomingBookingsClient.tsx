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
import type { UpcomingBooking } from './page';
import NotesFeed from '@/components/NotesFeed';
import ContractSendModal from './ContractSendModal';
import ContractPortal from '../update-dj-profile/ContractPortal';
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
  userId, djType, djCountry, djName, bookingsPerDay, initialBookings, mobPackages,
}: Props) {
  const [bookings, setBookings] = useState<UpcomingBooking[]>(initialBookings);
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
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.from('users').select('booking_settings, sub_status').eq('id', userId).maybeSingle();
        const row = data as { booking_settings?: string | null; sub_status?: string | null } | null;
        const raw = row?.booking_settings;
        const bs = (typeof raw === 'string' ? JSON.parse(raw) : (raw || {})) as { club_deposit_pct?: number; tax_enabled?: boolean; tax_pct?: number };
        if (!active) return;
        const ss = row?.sub_status;
        setIsPaid(ss === 'active' || ss === 'grace');
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

  // Group by month (YYYY-MM); keys sorted descending (most recent month first).
  const grouped = useMemo(() => {
    const map = new Map<string, UpcomingBooking[]>();
    for (const b of bookings) {
      if (!b.event_date) continue;
      const key = b.event_date.slice(0, 7);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    }
    // Sort ascending: soonest month first.
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [bookings]);

  // Flat list sorted by most recently booked first (created_at desc). Used
  // when the sort toggle is set to "Recently booked".
  const recentList = useMemo(() => {
    return [...bookings]
      .filter((b) => b.event_date)
      .sort((a, b) => {
        const ca = a.created_at || '';
        const cb = b.created_at || '';
        return cb.localeCompare(ca);
      });
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
          <h1 className={styles.title}>Upcoming Bookings</h1>
          <Link href="/booking-requests" className={styles.backLink}>← Back to booking requests</Link>
        </div>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setShowAddModal(true)} className={styles.addBtn}>
            + Add Booking Manually
          </button>
        </div>
      </div>

      {bookings.length > 0 && (
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
          {djType === 'club' && isPaid && (
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
          <p>No upcoming bookings yet.</p>
          <p className={styles.emptyHint}>
            Approved booking requests show up here automatically. You can also add bookings
            manually using the button above.
          </p>
        </div>
      ) : sortMode === 'recent' ? (
        <div className={styles.monthList}>
          <div className={styles.monthItems}>
            {recentList.map((b) => (
              <BookingRow
                key={b.id}
                booking={b}
                djType={djType}
                userId={userId}
                clubDepositPct={clubDepositPct}
                taxPct={taxPct}
                overlaps={overlapIds.has(b.id)}
                onDelete={b.is_manual ? () => handleDelete(b.id) : undefined}
                onEdit={b.is_manual ? () => setEditing(b) : undefined}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.monthList}>
          {grouped.map(([monthKey, items]) => (
            <section key={monthKey} className={styles.month}>
              <h2 className={styles.monthLabel}>{monthLabel(monthKey)}</h2>
              <div className={styles.monthItems}>
                {items.map((b) => (
                  <BookingRow
                    key={b.id}
                    booking={b}
                    djType={djType}
                    userId={userId}
                    clubDepositPct={clubDepositPct}
                    taxPct={taxPct}
                    overlaps={overlapIds.has(b.id)}
                    onDelete={b.is_manual ? () => handleDelete(b.id) : undefined}
                    onEdit={b.is_manual ? () => setEditing(b) : undefined}
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
          prefillDate={prefillDate}
          onClose={() => { setShowAddModal(false); setEditing(null); setPrefillDate(''); }}
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
  bookingId, userId, flyerUrl, onChange, size = 'row',
}: {
  bookingId: string;
  userId: string;
  flyerUrl: string | null;
  onChange: (url: string | null) => void;
  size?: 'row' | 'card';
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
            {/* Overlaid controls — pencil replaces the flyer, ✕ removes it. */}
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
              <button
                type="button"
                className={styles.flyerLinkMuted}
                onClick={async () => { await handleRemove(); setShowLightbox(false); }}
              >
                Remove
              </button>
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

function BookingRow({
  booking, djType, userId, clubDepositPct, taxPct, overlaps, onDelete, onEdit,
}: {
  booking: UpcomingBooking;
  djType: 'club' | 'mobile';
  userId: string;
  clubDepositPct: number;
  taxPct: number;
  overlaps?: boolean;
  onDelete?: () => void;
  onEdit?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
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
      {/* Whole row is clickable — a click anywhere (date, empty space, time)
          toggles expand. Interactive children (flyer, edit, delete, chevron)
          stopPropagation so they run their own action instead of toggling. */}
      <div className={styles.row} onClick={() => setExpanded((v) => !v)} style={{ cursor: 'pointer' }}>
        {/* Date pill — first on the row. */}
        <div className={styles.rowDate}>
          <div className={styles.dayNum}>{day}</div>
          <div className={styles.dayMeta}>
            <div className={styles.dow}>{dow}</div>
            <div className={styles.mo}>{mo}</div>
          </div>
        </div>
        {/* Event flyer — club/bar bookings only. Sits right of the date.
            Same flyer the host can manage on the Upcoming Events page. */}
        {djType === 'club' && (
          <span style={{ display: 'contents' }} onClick={(e) => e.stopPropagation()}>
            <FlyerSlot
              bookingId={booking.id}
              userId={userId}
              flyerUrl={flyerUrl}
              onChange={setFlyerUrl}
              size="row"
            />
          </span>
        )}
        {/* Time/context area — clicking it toggles too (stops propagation to
            avoid a double-toggle with the row wrapper). */}
        <button
          type="button"
          className={styles.rowToggle}
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          aria-expanded={expanded}
        >
          <div className={styles.rowTimeWrap}>
            {booking.cocktail_needed && (
              <div className={styles.rowCocktailNote}>Includes cocktail hour</div>
            )}
            <div className={styles.rowTime}>{timeRange}</div>
          </div>
          {(context || overlaps) ? (
            <div className={styles.rowContext}>
              {context && <span className={styles.rowContextSep} aria-hidden="true">|</span>}
              {context && <span className={styles.rowEventType}>{context}</span>}
              {overlaps && (
                <span
                  className={styles.overlapPill}
                  title="This booking's time overlaps another booking on the same day"
                >
                  ⚠ Time overlap
                </span>
              )}
            </div>
          ) : (
            <div />
          )}
        </button>
        {booking.is_manual && (
          <span className={styles.manualPill} title="Added manually by you">MANUAL ADD</span>
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
      {expanded && (
        <BookingDetails
          booking={booking}
          djType={djType}
          userId={userId}
          clubDepositPct={clubDepositPct}
          taxPct={taxPct}
          flyerUrl={flyerUrl}
          onFlyerChange={setFlyerUrl}
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
  booking, djType, userId, clubDepositPct, taxPct, flyerUrl, onFlyerChange,
}: {
  booking: UpcomingBooking;
  djType: 'club' | 'mobile';
  userId: string;
  clubDepositPct: number;
  taxPct: number;
  flyerUrl: string | null;
  onFlyerChange: (url: string | null) => void;
}) {
  const [contractOpen, setContractOpen] = useState(false);
  const [sendContractId, setSendContractId] = useState<string | null>(null);
  const [contractSent, setContractSent] = useState(false);
  const [contractCancelled, setContractCancelled] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendDone, setResendDone] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
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
        }
      } catch { /* ignore — leave as awaiting */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch the finished, signed contract PDF + audit log so the DJ can download both.
  async function downloadSigned() {
    setSignedBusy(true);
    try {
      const res = await fetch('/api/contracts/signed-doc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { contract?: string; audit?: string; error?: string };
      if (res.ok && (json.contract || json.audit)) setSignedDocs({ contract: json.contract, audit: json.audit });
      else alert(json.error || 'The signed contract isn’t ready yet.');
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
  // Sales tax (post-discount price) and the tax-inclusive total. The deposit
  // is taken on this total.
  const cardTax = (taxPct > 0 && agreedTotal != null) ? Math.round((Number(agreedTotal) * taxPct) / 100) : 0;
  const cardTotal = agreedTotal != null ? Number(agreedTotal) + cardTax : null;
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
          // Deposit % is taken on the tax-inclusive total (cardTotal).
          // A stored % wins; else the DJ's standing club % as a fallback.
          if (booking.deposit_pct != null) {
            return cardTotal != null
              ? `${money(Math.round((cardTotal * booking.deposit_pct) / 100))} (${booking.deposit_pct}%)`
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
    // Row 8: Tax + Total (only when the DJ has sales tax turned on).
    [
      {
        label: 'Tax',
        value: (taxPct > 0 && cardTax > 0)
          ? `${money(cardTax)} (${taxPct}%)`
          : null,
      },
      {
        label: 'Total (with tax)',
        value: (taxPct > 0 && cardTotal != null && cardTax > 0)
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
      {djType === 'club' && (
        <div className={styles.flyerCardSection}>
          <div className={styles.detailLabel}>Event Flyer</div>
          <FlyerSlot
            bookingId={booking.id}
            userId={userId}
            flyerUrl={flyerUrl}
            onChange={onFlyerChange}
            size="card"
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
              <div style={{ display: 'flex', gap: '.5rem', marginTop: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={resendContract} disabled={resendBusy} style={{ background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', cursor: resendBusy ? 'wait' : 'pointer', fontSize: '.8rem' }}>{resendBusy ? 'Resending…' : resendDone ? 'Resent ✓' : 'Resend to client'}</button>
                <button type="button" onClick={cancelContract} disabled={cancelBusy} style={{ background: 'transparent', border: '1px solid #ff7676', color: '#ff7676', fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', cursor: cancelBusy ? 'wait' : 'pointer', fontSize: '.8rem' }}>{cancelBusy ? 'Cancelling…' : 'Cancel contract'}</button>
              </div>
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
          ) : (
            <div style={{ marginTop: 8 }}>
              {contractCancelled && <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.78rem', marginBottom: 6 }}>Contract cancelled. Review and send a new one below.</div>}
              <button type="button" onClick={() => setContractOpen(true)} style={{ background: 'var(--neon,#00e0a4)', border: 'none', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.55rem 1.2rem', cursor: 'pointer', fontSize: '.82rem' }}>Review &amp; Send Contract</button>
            </div>
          )}
        </div>
      )}
      {(bt === 'club' || bt === 'mobile') && (
        <div className={styles.notesFeedWrap}>
          <NotesFeed bookingId={booking.id} currentUserId={userId} />
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
  existing, prefillDate, onClose, onAdded, onUpdated,
}: {
  userId: string;
  djType: 'club' | 'mobile';
  djCountry: string;
  djName: string;
  bookingsPerDay: number;
  mobPackages: Record<string, MobilePackage[]> | null;
  existingBookings: UpcomingBooking[];
  existing: UpcomingBooking | null;
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
  const [hostEmailSentAt, setHostEmailSentAt] = useState<string | null>(
    existing?.host_email_sent_at || null,
  );
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
      const selectCols = 'id, event_date, start_time, end_time, venue_name, venue_address, venue_lat, venue_lon, venue_type, set_type, event_type, event_details, cocktail_needed, cocktail_start_time, package_title, package_details, package_category, package_index, overtime_rate, booking_type, is_manual, flyer_url, host_email, host_email_sent_at, requester_name, offer_amount, original_rate, discount_code, discount_label, discount_amount, currency';

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
                        <div style={{ textAlign: 'right', marginTop: '.1rem' }}>
                          <button
                            type="button"
                            onClick={() => { setEditedDetails((prev) => prev ?? sel?.details ?? ''); setEditingDetails(true); }}
                            style={{ background: 'none', border: 'none', color: 'var(--neon)', fontSize: '.72rem', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                          >
                            Edit
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
          <div className={styles.hostInviteBlock}>
            <div className={styles.fieldLabel} style={{ textAlign: 'left', opacity: 0.55, marginBottom: '.55rem' }}>Host Details</div>
            <div style={{ display: 'flex', gap: '.6rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <label className={styles.field} style={{ flex: '1 1 130px', minWidth: 0 }}>
                <span className={styles.fieldLabel}>Host Name</span>
                <input
                  type="text"
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  placeholder="e.g. Jordan Smith"
                  className={styles.input}
                  style={{ width: '100%' }}
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
                  style={{ width: '100%' }}
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
                  onChange={(e) => setSendInvite(e.target.checked)}
                  disabled={!hostEmail.trim() || !hostEmail.includes('@')}
                />
                <span>
                  Send booking details to host
                  {(!hostEmail.trim() || !hostEmail.includes('@')) && (
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
