'use client';

// UpcomingEventsClient — host/venue view of all their booked events,
// nearest first. Mirrors UpcomingBookingsClient (the DJ-side equivalent)
// but stripped down: no rate/package fields, no DJ-specific UI. Manual
// events are events the user added themselves (no DJ may be attached).
//
// Capabilities for any row the user authored (requester_id === userId):
//   - Edit details (manual only)
//   - Add/replace flyer (manual only, since flyer is for promo)
//   - Add/edit external link (any row owned by the user)
//   - Delete (manual only)

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { UpcomingEvent } from './page';
import styles from './upcomingEvents.module.css';
import dj from '../upcoming-bookings/upcomingBookings.module.css';
import EventManualForm from './EventManualForm';
import HostPipelineStrip from './HostPipelineStrip';
import NotesFeed from '@/components/NotesFeed';

interface Props {
  userId: string;
  userCountry: string;
  userName: string;
  initialEvents: UpcomingEvent[];
  /** Header + empty-state copy. Defaults suit the Upcoming Events page; the
      Past Events page passes its own. */
  title?: string;
  subtitle?: string;
  emptyText?: string;
  emptyHint?: string;
  /** Order events newest-first (past events) instead of soonest-first. */
  newestFirst?: boolean;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function UpcomingEventsClient({
  userId, userCountry, userName, initialEvents,
  title = 'Upcoming Events',
  subtitle = 'All your confirmed events, nearest first.',
  emptyText = "You don't have any upcoming events yet.",
  emptyHint = 'Approved booking requests will appear here automatically.',
  newestFirst = false,
}: Props) {
  const [events, setEvents] = useState<UpcomingEvent[]>(initialEvents);
  const [editing, setEditing] = useState<UpcomingEvent | null>(null);

  // Group events by year-month for "Aug 2026" / "Sep 2026" section headers.
  const grouped = groupByMonth(events);

  async function handleUpdated(updated: UpcomingEvent) {
    setEvents((prev) => {
      const next = prev.map((e) => (e.id === updated.id ? updated : e));
      next.sort((a, b) => newestFirst ? sortByDateTimeAsc(b, a) : sortByDateTimeAsc(a, b));
      return next;
    });
    setEditing(null);
  }
  async function handleDeleted(id: string) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
      </div>

      {events.length === 0 ? (
        <div className={styles.empty}>
          <p>{emptyText}</p>
          <p className={styles.emptyHint}>{emptyHint}</p>
        </div>
      ) : (
        grouped.map(({ key, label, items }) => (
          <section key={key} className={styles.monthGroup}>
            <h2 className={styles.monthHeading}>{label}</h2>
            <div className={styles.eventList}>
              {items.map((ev) => (
                <EventRow
                  key={ev.id}
                  event={ev}
                  userId={userId}
                  onEdit={() => setEditing(ev)}
                  onDeleted={() => handleDeleted(ev.id)}
                  onLinkSaved={(url, label) => {
                    setEvents((prev) => prev.map((e) => (
                      e.id === ev.id ? { ...e, link_url: url, link_label: label } : e
                    )));
                  }}
                  onFlyerSaved={(url) => {
                    setEvents((prev) => prev.map((e) => (
                      e.id === ev.id ? { ...e, flyer_url: url } : e
                    )));
                  }}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {editing && (
        <EventManualForm
          userId={userId}
          userCountry={userCountry}
          userName={userName}
          existing={editing}
          existingEvents={events}
          onClose={() => setEditing(null)}
          onAdded={() => { /* unused — Add Event flow removed */ }}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────

function EventRow({
  event, userId, onEdit, onDeleted, onLinkSaved, onFlyerSaved,
}: {
  event: UpcomingEvent;
  userId: string;
  onEdit: () => void;
  onDeleted: () => void;
  onLinkSaved: (url: string | null, label: string | null) => void;
  onFlyerSaved: (url: string | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Lightbox for the flyer image — shown when the user clicks the
  // thumbnail. Provides a Download link inside the overlay.
  const [showLightbox, setShowLightbox] = useState(false);
  // Signed-contract download for the host. Checked when the row is expanded.
  const [contractDocs, setContractDocs] = useState<{ contract?: string; audit?: string } | null>(null);
  const [contractPending, setContractPending] = useState(false);

  // When the host opens an event, check whether a contract exists / is signed.
  //   200 + urls → signed (show download buttons)
  //   409        → contract out for signature (show "awaiting")
  //   404/other  → no contract (show nothing)
  useEffect(() => {
    if (!expanded) return;
    if (event.booking_type !== 'club' && event.booking_type !== 'mobile') return;
    if (contractDocs || contractPending) return; // already resolved
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/contracts/signed-doc', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: event.id }),
        });
        const json = (await res.json().catch(() => ({}))) as { contract?: string; audit?: string };
        if (!alive) return;
        if (res.ok && (json.contract || json.audit)) setContractDocs({ contract: json.contract, audit: json.audit });
        else if (res.status === 409) setContractPending(true);
      } catch { /* ignore — no contract section */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const isManual = event.is_manual;
  // Hosts/venues can upload a flyer to:
  //   - Any manual event they added (no DJ or any DJ)
  //   - Any approved club/bar booking they made
  // Mobile (private-party) bookings don't get flyer slots — those aren't
  // public-facing promotional events.
  const canUploadFlyer = isManual || event.booking_type === 'club';
  // Mobile / private bookings: no external-link feature (those events
  // aren't public-facing), and they get the full booking-detail panel
  // plus the shared notes feed, mirroring the club/bar layout.
  const isMobile = event.booking_type === 'mobile';
  const isWedding = event.event_type === 'weddings';

  const dateParts = parseDateParts(event.event_date);
  const timeRange = formatTimeRange(event.start_time, event.end_time);
  const venueLine = event.venue_name?.trim() || event.venue_address?.split(',')[0] || '—';
  const mapUrl = event.venue_address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.venue_address)}`
    : null;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const supabase = createClient();
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${userId}/flyers/${event.id}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadErr) throw uploadErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = `${data.publicUrl}?t=${Date.now()}`;
      const { error: updErr } = await supabase
        .from('bookings')
        .update({ flyer_url: publicUrl } as unknown as never)
        .eq('id', event.id)
        .eq('requester_id', userId);
      if (updErr) throw updErr;
      onFlyerSaved(publicUrl);
      // Notify the other party (DJ) that a flyer was added. Best-effort —
      // never blocks the upload UI. Only meaningful for club/bar bookings
      // that have a DJ on the other side; the server-side handler will
      // skip silently if either condition isn't met.
      fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'booking_activity',
          bookingId: event.id,
          actorId: userId,
          activity: 'flyer',
        }),
      }).catch((e) => console.warn('[UpcomingEvents] flyer email failed', e));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this event? This cannot be undone.')) return;
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('bookings')
        .delete()
        .eq('id', event.id)
        .eq('requester_id', userId)
        .eq('is_manual', true);
      if (error) throw error;
      onDeleted();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  // Type row. For mobile/private bookings show the actual event type
  // (Wedding, Birthday Party, etc.); club bookings keep the Club / Bar
  // label since they have no mobile event-type.
  const MOB_EVENT_TYPE_LABELS: Record<string, string> = {
    weddings: 'Wedding',
    birthday: 'Birthday Party',
    corporate: 'Corporate Event',
    anniversary: 'Anniversary',
    graduation: 'Graduation',
    sweet16: 'Sweet 16',
    quinceanera: 'Quinceañera',
    mitzvah: 'Bar/Bat Mitzvah',
    reunion: 'Reunion',
    holiday: 'Holiday Party',
    school: 'School Event',
    community: 'Community Event',
    other: 'Other Event',
  };
  const eventTypeLabel = event.booking_type === 'club'
    ? 'Club / Bar'
    : event.booking_type === 'mobile'
      ? (event.event_type
          ? (MOB_EVENT_TYPE_LABELS[event.event_type]
              || event.event_type.charAt(0).toUpperCase() + event.event_type.slice(1))
          : 'Mobile / Private')
      : null;

  // Helper for the rate line (uses non-public offer_amount + currency).
  const rateText = (event as { offer_amount?: number | null; currency?: string | null }).offer_amount != null
      && Number.isFinite((event as { offer_amount?: number | null }).offer_amount as number)
    ? `${(event as { currency?: string | null }).currency || 'USD'} ${
        ((event as { offer_amount?: number | null }).offer_amount as number).toLocaleString()
      }`
    : null;

  // Pricing breakdown rows for the bottom card — the same receipt the DJ sees:
  // Agreed Rate → Tax → Total (with tax), then a separated Payment schedule band
  // with Deposit and Balance due day of event.
  type PriceRow = { label: string; value: string; total?: boolean; schedule?: boolean };
  const pricingRows: PriceRow[] = (() => {
    const raw = event as unknown as {
      counter_rate?: number | null;
      quoted_rate?: number | null;
      total_with_tax?: number | null;
      tax_pct?: number | null;
      tax_amount?: number | null;
      deposit_pct?: number | null;
      deposit_amount?: number | null;
    };
    // Agreed rate: same source order the DJ card uses (offer_amount alone is
    // frequently null; the real number lives in counter_rate / quoted_rate).
    const rate = raw.counter_rate ?? raw.quoted_rate ?? event.offer_amount ?? null;
    const totalWithTax = raw.total_with_tax ?? null;
    // Render whenever there's any price at all — a rate or a tax-inclusive total.
    if ((rate == null || !Number.isFinite(rate)) && (totalWithTax == null || !Number.isFinite(totalWithTax))) return [];
    const cur = event.currency || 'USD';
    let money: (n: number) => string;
    try {
      const nf = new Intl.NumberFormat('en-US', { style: 'currency', currency: cur });
      money = (n: number) => nf.format(n);
    } catch {
      money = (n: number) => `${cur} ${n.toLocaleString()}`;
    }

    const rows: PriceRow[] = [];
    // Agreed rate — shown when we have it (may be absent on legacy rows that
    // only stored a tax-inclusive total).
    const hasRate = rate != null && Number.isFinite(rate);
    if (hasRate) rows.push({ label: 'Agreed Rate', value: money(rate!) });

    // Total (tax-inclusive): the stored snapshot when present, else the rate.
    const total = totalWithTax != null && Number.isFinite(totalWithTax) ? totalWithTax : rate!;

    // Tax — the stored snapshot amount, else the gap between rate and total.
    const taxAmt = raw.tax_amount != null && Number.isFinite(raw.tax_amount)
      ? Math.max(0, raw.tax_amount)
      : (hasRate ? Math.max(0, Math.round((total - rate!) * 100) / 100) : 0);
    if (taxAmt > 0) {
      const pct = raw.tax_pct != null ? ` (${raw.tax_pct}%)` : '';
      rows.push({ label: 'Tax', value: `${money(taxAmt)}${pct}` });
    }

    rows.push({ label: 'Total (with tax)', value: money(total), total: true });

    // Payment schedule — deposit (from a stored amount or the % of the total)
    // and the balance owed on the day of the event.
    const depPct = raw.deposit_pct ?? null;
    const depAmt = raw.deposit_amount != null
      ? raw.deposit_amount
      : (depPct != null ? Math.round((total * depPct) / 100) : null);
    if (depAmt != null && depAmt > 0) {
      const pct = depPct != null ? ` (${depPct}%)` : '';
      rows.push({ label: 'Deposit', value: `${money(depAmt)}${pct}`, schedule: true });
      rows.push({ label: 'Balance due day of event', value: money(Math.max(0, total - depAmt)), schedule: true });
    }

    return rows;
  })();
  const scheduleRows = pricingRows.filter((r) => r.schedule);
  const mainRows = pricingRows.filter((r) => !r.schedule);
  // The tax-inclusive total for the collapsed row's bottom "Total Price" band.
  const totalPriceStr = pricingRows.find((r) => r.total)?.value ?? pricingRows[0]?.value ?? null;
  const hasPipeline = !!event.pipeline && event.pipeline.length > 0;
  const showTotalBar = !expanded && !!totalPriceStr;
  // On mobile the pipeline moves out of the header into a full-width band
  // under the row (like the DJ card). When either the pipeline band or the
  // price band sits below the collapsed row, square off its bottom corners.
  const showMobilePipeline = !expanded && hasPipeline;

  return (
    <div className={`${styles.rowWrap} ${expanded ? styles.rowWrapExpanded : ''} ${showTotalBar ? styles.hasTotalBar : ''} ${showMobilePipeline ? styles.hasMobilePipeline : ''}`}>
      <div className={styles.row}>
        {/* Date pill — first element in the row. Clickable: toggles
            expansion just like the middle area, so the date acts as part
            of the toggle hit-zone visually but lives outside the flyer
            slot so the row order reads date → flyer → middle. */}
        <button
          type="button"
          className={styles.datePillBtn}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse event' : 'Expand event'}
        >
          <div className={styles.datePill}>
            <div className={styles.dayNum}>{dateParts.day}</div>
            <div className={styles.dayMeta}>
              <div className={styles.dow}>{dateParts.dow}</div>
              <div className={styles.mo}>{dateParts.mo}</div>
            </div>
          </div>
        </button>

        {/* Flyer / upload slot. Manual events + approved club/bar bookings
            can have flyers uploaded by the host/venue. Mobile bookings are
            PRIVATE EVENTS (weddings, birthdays, etc.) — they don't have
            flyers, so the entire flyer column is omitted to match how the
            mobile DJ sees the event on their side. */}
        {!isMobile && (
          event.flyer_url ? (
            <button
              type="button"
              className={styles.flyerBtn}
              onClick={(e) => { e.stopPropagation(); setShowLightbox(true); }}
              aria-label="View flyer"
              title="View flyer"
            >
              <img src={event.flyer_url} alt="Event flyer" className={styles.flyer} />
            </button>
          ) : canUploadFlyer ? (
            <button
              type="button"
              className={styles.flyerSlot}
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
              disabled={uploading}
              title="Upload flyer"
            >
              {uploading ? '…' : '+ Flyer'}
            </button>
          ) : (
            <div className={styles.flyerEmpty} />
          )
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFile}
        />

        {/* Clickable middle area — toggles expansion. */}
        <button
          type="button"
          className={styles.rowToggle}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <div className={styles.middle}>
            {isMobile ? (
              <>
                <div className={styles.venue}>{eventTypeLabel || 'Event'}</div>
                {timeRange && <div className={styles.meta}>{timeRange}</div>}
              </>
            ) : (
              <>
                <div className={styles.venue}>{venueLine}</div>
                <div className={styles.meta}>{timeRange}</div>
                {event.venue_address && (
                  <div className={styles.meta}>
                    {event.venue_address}
                  </div>
                )}
                {event.dj_name && (
                  <div className={styles.metaDj}>
                    DJ:{' '}
                    {event.dj_slug ? (
                      <Link
                        href={`/${event.dj_slug}`}
                        className={styles.metaDjLink}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {event.dj_name}
                      </Link>
                    ) : (
                      event.dj_name
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <span className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </button>

        {/* Centered, interactive booking-progress strip — its own element so
            its dropdown buttons aren't nested inside the toggle button. */}
        {event.pipeline && event.pipeline.length > 0 && (
          <div className={styles.hdrPipeline}>
            <HostPipelineStrip steps={event.pipeline} djType={event.pipelineDjType || 'mobile'} />
          </div>
        )}

        <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
          {event.link_url && (
            <a
              href={event.link_url}
              target="_blank"
              rel="noreferrer"
              className={styles.linkCta}
            >
              {event.link_label?.trim() || 'More Info'}
            </a>
          )}
          {/* External-link button — not shown for mobile/private events. */}
          {!isMobile && (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setShowLinkModal(true)}
              title={event.link_url ? 'Edit link' : 'Add link'}
              aria-label={event.link_url ? 'Edit link' : 'Add link'}
            >
              <PaperclipIcon />
            </button>
          )}
          {isManual && (
            <>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={onEdit}
                title="Edit details"
                aria-label="Edit details"
              >
                <PencilIcon />
              </button>
              <button
                type="button"
                className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                onClick={handleDelete}
                title="Delete event"
                aria-label="Delete event"
              >
                <TrashIcon />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Mobile-only pipeline band — the header pipeline moves here on narrow
          screens as a full-width, evenly-spaced icon row (like the DJ card). */}
      {showMobilePipeline && event.pipeline && (
        <div className={styles.pipelineMobile}>
          <HostPipelineStrip steps={event.pipeline} djType={event.pipelineDjType || 'mobile'} spread />
        </div>
      )}

      {/* Full-width "Total Price" band under the collapsed row — mirrors the
          DJ card's Total Value strip. */}
      {showTotalBar && (
        <div className={styles.rowTotalBar}>
          <span className={styles.rowTotalLabel}>Total Price</span>
          <span className={styles.rowTotalValue}>{totalPriceStr}</span>
        </div>
      )}

      {expanded && (
        <div className={styles.detailsPanel}>
          <div className={dj.detailsSections}>
            {/* EVENT */}
            <div className={dj.detailSection}>
              <div className={dj.detailChip}><span>Event</span></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '13px 22px', marginTop: 20, marginBottom: 6 }}>
                {eventTypeLabel && (
                  <div>
                    <div className={dj.detailLabel}>Event Type</div>
                    <div className={dj.detailValue}>{eventTypeLabel}</div>
                  </div>
                )}
                {event.event_date && (
                  <div>
                    <div className={dj.detailLabel}>Event Date</div>
                    <div className={dj.detailValue}>{formatLongDate(event.event_date)}</div>
                  </div>
                )}
                {event.guest_count != null && (
                  <div>
                    <div className={dj.detailLabel}>Guest Count</div>
                    <div className={dj.detailValue}>{String(event.guest_count)}</div>
                  </div>
                )}
              </div>
              {timeRange && (
                <div style={{ marginTop: 24 }}>
                  <div className={dj.detailLabel} style={{ marginBottom: 6, fontSize: 12 }}>Event Time</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#00e3ad' }}>{timeRange}</div>
                </div>
              )}
              {isWedding && event.ceremony_needed && event.ceremony_start_time && (
                <div style={{ marginTop: 14 }}>
                  <div className={dj.detailLabel}>Ceremony</div>
                  <div className={dj.detailValue}>{formatTime12(event.ceremony_start_time)}</div>
                </div>
              )}
              {isWedding && event.cocktail_needed && event.cocktail_start_time && (
                <div style={{ marginTop: 14 }}>
                  <div className={dj.detailLabel}>Cocktail Hour</div>
                  <div className={dj.detailValue}>{formatTime12(event.cocktail_start_time)}</div>
                </div>
              )}
            </div>

            {/* VENUE + DJ side by side (matches the DJ card's Venue / Host row) */}
            {(event.venue_name?.trim() || event.venue_address || event.room_details?.trim()) && (
              <div className={dj.detailSection}>
                <div className={dj.detailChip}><span>Venue</span></div>
                <div className={dj.detailPairRow}>
                  {event.venue_name?.trim() && (
                    <div className={dj.detailRow}>
                      <div className={dj.detailLabel}>Venue Name</div>
                      <div className={dj.detailValue}>{event.venue_name.trim()}</div>
                    </div>
                  )}
                  {event.room_details?.trim() && (
                    <div className={dj.detailRow}>
                      <div className={dj.detailLabel}>Room Details</div>
                      <div className={dj.detailValue}>{event.room_details.trim()}</div>
                    </div>
                  )}
                </div>
                {event.venue_address && (
                  <div className={dj.detailPairRow} style={{ gridTemplateColumns: '1fr' }}>
                    <div className={dj.detailRow}>
                      <div className={dj.detailLabel}>Venue Address</div>
                      <div className={dj.detailValue}>
                        {mapUrl ? (
                          <a href={mapUrl} target="_blank" rel="noreferrer" className={styles.metaLink}>{event.venue_address}</a>
                        ) : event.venue_address}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {event.dj_name && (
              <div className={dj.detailSection}>
                <div className={dj.detailChip}><span>DJ</span></div>
                <div className={dj.detailPairRow}>
                  <div className={dj.detailRow}>
                    <div className={dj.detailLabel}>Booked With</div>
                    <div className={dj.detailValue}>
                      {event.dj_slug ? (
                        <Link href={`/${event.dj_slug}`} className={styles.metaLink} target="_blank" rel="noreferrer">{event.dj_name}</Link>
                      ) : event.dj_name}
                    </div>
                  </div>
                  {event.phone?.trim() && (
                    <div className={dj.detailRow}>
                      <div className={dj.detailLabel}>Contact Phone</div>
                      <div className={dj.detailValue}>{event.phone.trim()}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Package — full-width card (matches the DJ card): title + the
                package description underneath. */}
            {(event.package_title?.trim() || event.package_details?.trim()) && (
              <div className={dj.detailSection} style={{ gridColumn: '1 / -1' }}>
                <div className={dj.detailChip}><span>Package</span></div>
                {event.package_title?.trim() && (
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginTop: 12 }}>
                    {event.package_title.trim()}
                  </div>
                )}
                {event.package_details?.trim() && (
                  <div
                    style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--muted,#8a8aa0)', marginTop: event.package_title?.trim() ? 6 : 12 }}
                    dangerouslySetInnerHTML={{ __html: event.package_details }}
                  />
                )}
              </div>
            )}

            {/* Pricing — the DJ's exact receipt: Agreed Rate → Tax → Total, then
                a separated Payment schedule band (Deposit / Balance). */}
            {mainRows.length > 0 && (
              <div className={`${dj.detailSection} ${dj.detailSectionPricing}`}>
                <div className={dj.detailChip}><span>Pricing</span></div>
                {mainRows.map((r) => (
                  <div key={r.label} className={`${dj.priceRow}${r.total ? ' ' + dj.priceRowTotal : ''}`}>
                    <span className={dj.priceKey}>{r.label}</span>
                    <span className={dj.priceVal}>{r.value}</span>
                  </div>
                ))}
                {scheduleRows.length > 0 && (
                  <div className={dj.paySched}>
                    <div className={dj.schedLbl}>Payment schedule</div>
                    {scheduleRows.map((r) => (
                      <div key={r.label} className={dj.priceRow}>
                        <span className={dj.priceKey}>{r.label}</span>
                        <span className={dj.priceVal}>{r.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {/* Event flyer block — mirrors the DJ-side card. View-only on the
              host side (the DJ uploads/edits flyers, the host downloads).
              Club/bar bookings only; mobile bookings don't have flyers. */}
          {!isMobile && event.flyer_url && (
            <div className={styles.flyerCardSection}>
              <div className={styles.detailLabel}>Event Flyer</div>
              <div className={styles.flyerInline}>
                <div className={styles.flyerWithActions}>
                  <button
                    type="button"
                    className={styles.flyerThumbBtn}
                    onClick={() => setShowLightbox(true)}
                    title="View flyer"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={event.flyer_url} alt="Event flyer" className={styles.flyerThumbImg} />
                  </button>
                  <button
                    type="button"
                    className={styles.flyerDownloadIcon}
                    onClick={() => {
                      const ext = (event.flyer_url || '').split('?')[0].split('.').pop() || 'jpg';
                      downloadFlyer(event.flyer_url!, `flyer-${event.id}.${ext}`);
                    }}
                    title="Download flyer"
                    aria-label="Download flyer"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}
          {/* Contract — the host can download their signed copy + audit log
              once both parties have signed. Same source as the DJ's page. */}
          {(event.booking_type === 'club' || event.booking_type === 'mobile') && (contractDocs || contractPending) && (
            <div className={styles.notesFeedWrap} style={{ marginTop: '1rem' }}>
              <div className={styles.detailLabel}>Contract</div>
              {contractDocs ? (
                <div style={{ marginTop: 8 }}>
                  <div style={{ color: '#00e0a4', fontWeight: 700 }}>✓ Contract signed</div>
                  <div style={{ display: 'flex', gap: '.5rem', marginTop: 8, flexWrap: 'wrap' }}>
                    {contractDocs.contract && <a href={contractDocs.contract} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', background: 'var(--neon,#00e0a4)', color: '#06231b', fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', fontSize: '.8rem', textDecoration: 'none' }}>⬇ Signed contract</a>}
                    {contractDocs.audit && <a href={contractDocs.audit} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', background: 'transparent', border: '1px solid var(--neon,#00e0a4)', color: 'var(--neon,#00e0a4)', fontWeight: 700, borderRadius: 6, padding: '.45rem 1rem', fontSize: '.8rem', textDecoration: 'none' }}>⬇ Audit log</a>}
                  </div>
                </div>
              ) : (
                <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.82rem', marginTop: 6 }}>Awaiting signatures — your signed copy will appear here once everyone has signed.</div>
              )}
            </div>
          )}
          {/* Shared notes feed — both DJ and host can read + post. Shown
              for club/bar AND mobile (private) bookings. */}
          {(event.booking_type === 'club' || event.booking_type === 'mobile') && (
            <div className={styles.notesFeedWrap}>
              <NotesFeed bookingId={event.id} currentUserId={userId} />
            </div>
          )}
        </div>
      )}

      {/* Flyer lightbox with download link */}
      {showLightbox && event.flyer_url && (
        <div
          className={styles.lightboxOverlay}
          onClick={() => setShowLightbox(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className={styles.lightboxInner} onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={event.flyer_url} alt="Event flyer" className={styles.lightboxImg} />
            <div className={styles.lightboxActions}>
              <button
                type="button"
                className={styles.lightboxDownload}
                onClick={() => {
                  const ext = (event.flyer_url || '').split('?')[0].split('.').pop() || 'jpg';
                  downloadFlyer(event.flyer_url!, `flyer-${event.id}.${ext}`);
                }}
              >
                Download
              </button>
              <button type="button" className={styles.lightboxClose} onClick={() => setShowLightbox(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showLinkModal && (
        <LinkModal
          bookingId={event.id}
          requesterId={userId}
          initialUrl={event.link_url || ''}
          initialLabel={event.link_label || ''}
          onClose={() => setShowLinkModal(false)}
          onSaved={(url, label) => {
            onLinkSaved(url, label);
            setShowLinkModal(false);
          }}
        />
      )}
    </div>
  );
}

// ── Link modal ────────────────────────────────────────────────────────

function LinkModal({
  bookingId, requesterId, initialUrl, initialLabel, onClose, onSaved,
}: {
  bookingId: string;
  requesterId: string;
  initialUrl: string;
  initialLabel: string;
  onClose: () => void;
  onSaved: (url: string | null, label: string | null) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [label, setLabel] = useState(initialLabel);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    const trimmedUrl = url.trim();
    const trimmedLabel = label.trim();
    if (trimmedUrl && !/^https?:\/\//i.test(trimmedUrl)) {
      setError('URL must start with http:// or https://');
      return;
    }
    setSaving(true);
    try {
      const supabase = createClient();
      const { error: e } = await supabase
        .from('bookings')
        .update({
          link_url: trimmedUrl || null,
          link_label: trimmedLabel || null,
        } as unknown as never)
        .eq('id', bookingId)
        .eq('requester_id', requesterId);
      if (e) throw e;
      onSaved(trimmedUrl || null, trimmedLabel || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
    }
  }
  async function handleRemove() {
    if (!confirm('Remove this link?')) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const { error: e } = await supabase
        .from('bookings')
        .update({ link_url: null, link_label: null } as unknown as never)
        .eq('id', bookingId)
        .eq('requester_id', requesterId);
      if (e) throw e;
      onSaved(null, null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Remove failed');
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modalSmall} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{initialUrl ? 'Edit Link' : 'Add Link'}</h3>
          <button type="button" className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={styles.modalBody}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>URL</span>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/tickets"
              className={styles.input}
              autoFocus
              autoComplete="off"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Button Label <span className={styles.fieldOptional}>(optional — defaults to &ldquo;More Info&rdquo;, {20 - label.length} left)</span>
            </span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Purchase Tickets"
              className={styles.input}
              maxLength={20}
            />
          </label>
          {error && <div className={styles.error}>{error}</div>}
        </div>
        <div className={styles.modalActions}>
          {initialUrl && (
            <button type="button" className={styles.removeBtn} onClick={handleRemove} disabled={saving}>
              Remove
            </button>
          )}
          <div className={styles.actionsRight}>
            <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="button" className={styles.saveBtn} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function groupByMonth(events: UpcomingEvent[]): Array<{ key: string; label: string; items: UpcomingEvent[] }> {
  const map = new Map<string, { label: string; items: UpcomingEvent[] }>();
  for (const ev of events) {
    if (!ev.event_date) continue;
    const [y, m] = ev.event_date.split('-').map((s) => parseInt(s, 10));
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const label = `${MONTH_NAMES[m - 1]} ${y}`;
    if (!map.has(key)) map.set(key, { label, items: [] });
    map.get(key)!.items.push(ev);
  }
  return Array.from(map.entries()).map(([key, { label, items }]) => ({ key, label, items }));
}

function sortByDateTimeAsc(a: UpcomingEvent, b: UpcomingEvent): number {
  const da = (a.event_date || '') + ' ' + (a.start_time || '');
  const db = (b.event_date || '') + ' ' + (b.start_time || '');
  return da.localeCompare(db);
}

function parseDateParts(d: string | null): { day: string; dow: string; mo: string } {
  if (!d) return { day: '—', dow: '', mo: '' };
  const [y, m, day] = d.split('-').map((s) => parseInt(s, 10));
  const date = new Date(y, m - 1, day);
  return {
    day: String(day),
    dow: date.toLocaleDateString('en-US', { weekday: 'short' }),
    mo: date.toLocaleDateString('en-US', { month: 'short' }),
  };
}

// Long-form date used in the expanded details panel (e.g. "Wednesday,
// May 27, 2026"). The top-left badge keeps the compact day/dow/mo split.
function formatLongDate(d: string): string {
  const [y, m, day] = d.split('-').map((s) => parseInt(s, 10));
  const date = new Date(y, m - 1, day);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTimeRange(s: string | null, e: string | null): string {
  const start = s ? formatTime12(s) : '';
  const end = e ? formatTime12(e) : '';
  if (start && end) return `${start} – ${end}`;
  if (start) return start;
  return '';
}

// Forces a real download of a flyer URL. The native `download` attribute on
// <a> is ignored when the target lives on another origin (Supabase Storage
// in our case). To work around that we fetch the file as a blob and create
// a temporary object URL that the browser treats as same-origin, allowing
// the download attribute to actually save the file instead of navigating.
async function downloadFlyer(url: string, filename: string) {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('Fetch failed: ' + res.status);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (e) {
    console.error('[downloadFlyer] failed', e);
    // Fallback: open in a new tab so the user can right-click → Save As.
    window.open(url, '_blank', 'noopener,noreferrer');
  }
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

// ── Icons ─────────────────────────────────────────────────────────────

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </svg>
  );
}
function PaperclipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
