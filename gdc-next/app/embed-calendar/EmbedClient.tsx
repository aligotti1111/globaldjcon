'use client';

// EmbedClient — interactive piece of the embed. Handles:
//   - Theme application (data-theme attr on body — CSS picks it up)
//   - Parent-iframe height postMessage handshake
//   - Month nav (next/prev/year picker)
//   - Calendar grid render (read-only — clicks open the host site)
//
// Click behaviour: any non-booked, non-unavailable date → opens
// https://globaldjconnect.com/<slug>?date=<YYYY-MM-DD> in a new tab so
// the host's iframe stays put. Booked / unavailable dates do nothing
// (no popup — embed is intentionally bare).

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './embed.module.css';
import type { MobileBookingDays, MobileDayData } from '@/app/(main)/[slug]/bookingSettings';

interface Props {
  djSlug: string;
  djName: string;
  bookingDays: MobileBookingDays;
  windowMonths: number;
  theme: 'light' | 'dark';
  months: 1 | 3;
  countByDate: Record<string, number>;
  globalCapacity: number;
}

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAY_LABELS = ['S','M','T','W','T','F','S'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function dateKey(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

export default function EmbedClient({
  djSlug, djName, bookingDays, windowMonths, theme, months,
  countByDate, globalCapacity,
}: Props) {
  // Apply theme to <body> via a side effect — data-theme is read by the
  // CSS module to swap colors.
  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    return () => {
      document.body.removeAttribute('data-theme');
    };
  }, [theme]);

  // ── Parent-iframe height handshake ─────────────────────────────────
  // Post our current scrollHeight up to the parent so a host site can
  // auto-resize the iframe and avoid scrollbars. ResizeObserver catches
  // any layout change (month nav, theme switch, etc.).
  useEffect(() => {
    function postHeight() {
      try {
        const h = document.documentElement.scrollHeight;
        window.parent.postMessage(
          { type: 'gdc-embed-height', height: h, slug: djSlug },
          '*'
        );
      } catch {
        // parent unreachable, ignore
      }
    }
    postHeight();
    const ro = new ResizeObserver(() => postHeight());
    ro.observe(document.body);
    window.addEventListener('resize', postHeight);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', postHeight);
    };
  }, [djSlug]);

  // ── Month nav state ────────────────────────────────────────────────
  const today = useMemo(() => new Date(), []);
  const todayMidnight = useMemo(
    () => new Date(today.getFullYear(), today.getMonth(), today.getDate()),
    [today]
  );
  const minYM = today.getFullYear() * 12 + today.getMonth();
  const maxYM = minYM + (windowMonths - 1);

  // Anchor month — start of the visible window. Always within [min, max].
  const [anchorYM, setAnchorYM] = useState(minYM);

  // Three or one month visible — slice from anchor
  const visibleMonths: { y: number; m: number }[] = [];
  for (let i = 0; i < months; i++) {
    const ym = anchorYM + i;
    visibleMonths.push({ y: Math.floor(ym / 12), m: ym % 12 });
  }

  function navPrev() {
    setAnchorYM((prev) => Math.max(minYM, prev - months));
  }
  function navNext() {
    setAnchorYM((prev) => Math.min(maxYM - (months - 1), prev + months));
  }
  const canPrev = anchorYM > minYM;
  const canNext = (anchorYM + (months - 1)) < maxYM;

  // ── Click handler ──────────────────────────────────────────────────
  // Build the list of selectable months for the jump picker. Bounded by
  // [today, today + windowMonths - 1] inclusive.
  const jumpOptions = useMemo(() => {
    const opts: { ym: number; label: string }[] = [];
    for (let ym = minYM; ym <= maxYM; ym++) {
      const y = Math.floor(ym / 12);
      const m = ym % 12;
      opts.push({ ym, label: `${MONTHS[m]} ${y}` });
    }
    return opts;
  }, [minYM, maxYM]);

  // Open the main site in a new tab with the chosen date pre-selected.
  function openDate(dKey: string | null) {
    const url = dKey
      ? `https://globaldjconnect.com/${encodeURIComponent(djSlug)}?date=${encodeURIComponent(dKey)}`
      : `https://globaldjconnect.com/${encodeURIComponent(djSlug)}`;
    window.open(url, '_blank', 'noopener');
  }

  return (
    <div className={`${styles.wrap} ${theme === 'light' ? styles.wrapLight : ''} ${months === 3 ? styles.threeUpWide : ''}`}>
      <div className={styles.headerRow}>
        <div className={styles.djName}>{djName || 'DJ Calendar'}</div>
        <div className={styles.navBtns}>
          <button
            type="button"
            onClick={navPrev}
            disabled={!canPrev}
            className={styles.navBtn}
            aria-label="Previous"
          >
            ‹
          </button>
          {/* Jump-to picker — native <select> for cross-browser
              consistency + accessibility. Lists every selectable month
              within the DJ's booking window. */}
          <select
            value={anchorYM}
            onChange={(e) => setAnchorYM(parseInt(e.target.value, 10))}
            className={styles.jumpSelect}
            aria-label="Jump to month"
          >
            {jumpOptions.map((opt) => (
              <option key={opt.ym} value={opt.ym}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={navNext}
            disabled={!canNext}
            className={styles.navBtn}
            aria-label="Next"
          >
            ›
          </button>
        </div>
      </div>

      <div className={`${styles.monthsGrid} ${months === 3 ? styles.threeUp : ''}`}>
        {visibleMonths.map(({ y, m }) => (
          <MonthGrid
            key={`${y}-${m}`}
            year={y}
            month={m}
            todayMidnight={todayMidnight}
            bookingDays={bookingDays}
            onClickDay={openDate}
            countByDate={countByDate}
            globalCapacity={globalCapacity}
          />
        ))}
      </div>

      {/* Status legend — swatches showing what each color means. */}
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendSwatchAvailable}`} />
          Available
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendSwatchBooked}`} />
          Booked
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendSwatchUnavailable}`} />
          Unavailable
        </span>
        {globalCapacity > 1 && (
          <span className={styles.legendItem}>
            <span className={`${styles.legendSwatch} ${styles.legendSwatchPartial}`} />
            Accepting set times around current booking
          </span>
        )}
      </div>

      <div className={styles.footer}>
        Powered by{' '}
        <a
          href={`https://globaldjconnect.com/${encodeURIComponent(djSlug)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Global DJ Connect
        </a>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// MonthGrid — a single month's grid cells. Pure rendering — all behaviour
// (click open, status colors) flows in via props.
// ─────────────────────────────────────────────────────────────────────────
function MonthGrid({
  year, month, todayMidnight, bookingDays, onClickDay,
  countByDate, globalCapacity,
}: {
  year: number;
  month: number;
  todayMidnight: Date;
  bookingDays: MobileBookingDays;
  onClickDay: (dKey: string | null) => void;
  countByDate: Record<string, number>;
  globalCapacity: number;
}) {
  // Build the 6×7 grid: leading blanks for the weekday offset of day 1,
  // then days 1..N, padded with trailing blanks if needed.
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: React.ReactNode[] = [];

  for (let i = 0; i < firstDow; i++) {
    cells.push(<div key={`b-${i}`} className={styles.cellBlank} />);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const cellDate = new Date(year, month, d);
    const isPast = cellDate < todayMidnight;
    const dKey = dateKey(year, month, d);
    const dayData: MobileDayData | undefined = bookingDays[dKey];
    const isUnavailable = !!dayData?.unavailable;

    // day_capacity exists on club DayData (not MobileDayData); read it
    // defensively since the embed types days as MobileDayData.
    const perDayCap = (dayData as { day_capacity?: number } | undefined)?.day_capacity;

    // Capacity-aware booked state (mirrors the main PublicCalendar):
    //   count >= capacity     → fully booked (red, not clickable)
    //   0 < count < capacity  → partially booked (still clickable)
    // Per-day override wins over the DJ's global capacity; clamp 1–3.
    const dayCap = Math.min(3, Math.max(1,
      perDayCap != null ? perDayCap : globalCapacity));
    const rawCount = countByDate[dKey] || 0;
    const bookedCount = rawCount > 0 ? rawCount : (dayData?.booked ? 1 : 0);
    const isFull = bookedCount > 0 && bookedCount >= dayCap;
    const isPartial = bookedCount > 0 && bookedCount < dayCap;

    // Partial days remain bookable (the public can still request the
    // open set times around the existing booking).
    const isClickable = !isPast && !isFull && !isUnavailable;

    let cls = styles.cell;
    if (isPast) cls += ` ${styles.cellPast}`;
    else if (isFull) cls += ` ${styles.cellBooked}`;
    else if (isUnavailable) cls += ` ${styles.cellUnavailable}`;
    else cls += ` ${styles.cellAvailable}`;
    if (isPartial) cls += ` ${styles.cellPartial}`;

    cells.push(
      <button
        key={`d-${d}`}
        type="button"
        className={cls}
        onClick={isClickable ? () => onClickDay(dKey) : undefined}
        disabled={!isClickable}
      >
        <span className={styles.cellDayNum}>{d}</span>
        {isClickable && <span className={styles.cellBookPill}>Book</span>}
      </button>
    );
  }

  return (
    <div className={styles.monthBox}>
      <div className={styles.monthHeader}>
        {MONTHS[month]} {year}
      </div>
      <div className={styles.dayLabels}>
        {DAY_LABELS.map((lbl, i) => (
          <div key={i} className={styles.dayLabel}>{lbl}</div>
        ))}
      </div>
      <div className={styles.grid}>{cells}</div>
    </div>
  );
}
