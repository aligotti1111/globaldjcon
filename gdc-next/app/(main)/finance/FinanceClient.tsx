'use client';

// FinanceClient — owner Finance report UI. All money math lives in lib/finance;
// this file is presentation + interaction only: period selector, net/gross
// toggle, include-expected toggle, KPI strip, hand-rolled SVG charts (no chart
// library dependency), a per-payment table, and CSV export.

import { useMemo, useState } from 'react';
import styles from './finance.module.css';
import {
  inRange,
  summarize,
  groupByMonth,
  groupByField,
  type ReceivedEvent,
  type ExpectedItem,
  type Totals,
} from '@/lib/finance';

interface StripeSnapshot {
  connected: boolean;
  ready: boolean;
  available: number | null;
  pending: number | null;
  paidOutRecent: number | null;
  currency: string;
  error?: string;
}

interface BookingMeta { eventDate: string | null; startTime: string | null; endTime: string | null }

interface Props {
  events: ReceivedEvent[];
  eventItems: { date: string; paid: boolean }[]; // every booked event: date + fully-paid flag
  expectedItems: ExpectedItem[];
  bookingMeta: Record<string, BookingMeta>; // id → event date + time (for the pop-up)
  stripe: StripeSnapshot;
  primaryCurrency: string;
  djName: string;
  today: string; // YYYY-MM-DD
}

type Preset = 'this_month' | 'last_30' | 'last_90' | 'ytd' | 'next_year' | 'last_year' | 'all' | 'custom';

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_30', label: 'Last 30 days' },
  { key: 'ytd', label: 'This year' },
  { key: 'next_year', label: 'Next year' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom' },
];

// Palette for event-type slices (methods have their own fixed colours). 20
// visually distinct hues so up to 20 event types each get their own colour
// without the ring/legend repeating and becoming ambiguous.
const TYPE_COLORS = [
  '#00f5c4', '#635BFF', '#e6b455', '#ef6f9c', '#4cc2ff',
  '#9b8cff', '#5fd08a', '#c98bff', '#ff9f6b', '#f45b69',
  '#3ec6c0', '#b0c94a', '#ff8ac4', '#7aa5ff', '#d99a2b',
  '#8ce06a', '#ff6f61', '#5bd1e6', '#a56bff', '#e0d24a',
];

const pad = (n: number) => String(n).padStart(2, '0');
const addDays = (iso: string, days: number) => {
  // All-UTC so a positive-offset timezone (Sydney, London in summer) can't
  // shift the day and collapse the daily chart to one duplicated bar.
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

function rangeFor(preset: Preset, today: string): { start: string; end: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  switch (preset) {
    case 'this_month': return { start: `${y}-${pad(m)}-01`, end: today };
    case 'last_30': return { start: addDays(today, -29), end: today };
    case 'last_90': return { start: addDays(today, -89), end: today };
    case 'ytd': return { start: `${y}-01-01`, end: today };
    case 'next_year': return { start: `${y + 1}-01-01`, end: `${y + 1}-12-31` };
    case 'last_year': return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
    case 'all': default: return { start: '1970-01-01', end: today };
  }
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "2026-03" → { m: 'Mar', yr: "'26" }
function monthParts(ym: string): { m: string; yr: string } {
  return { m: MONTHS_SHORT[Number(ym.slice(5, 7)) - 1], yr: `'${ym.slice(2, 4)}` };
}

function nextMonth(ym: string): string {
  let [yy, mm] = ym.split('-').map(Number);
  mm += 1;
  if (mm > 12) { mm = 1; yy += 1; }
  return `${yy}-${pad(mm)}`;
}

export default function FinanceClient({ events, eventItems, expectedItems, bookingMeta, primaryCurrency, djName, today }: Props) {
  const [preset, setPreset] = useState<Preset>('ytd');
  const [basis, setBasis] = useState<'net' | 'gross'>('net');
  // Custom range (used only when preset === 'custom'). Defaults to this year.
  const [customStart, setCustomStart] = useState<string>(`${today.slice(0, 4)}-01-01`);
  const [customEnd, setCustomEnd] = useState<string>(today);
  // Independent quick-filter for the payments table only (leaves the charts on
  // the main period above). 'period' = whatever the charts show.
  const [tableRange, setTableRange] = useState<'period' | 'last_30' | 'last_90' | 'last_year'>('period');
  // Booking whose detail card is open (null = none). Clicking a payments row
  // opens an in-page pop-up rather than navigating away from Finance.
  const [openBooking, setOpenBooking] = useState<string | null>(null);

  const money0 = useMemo(
    () => new Intl.NumberFormat(undefined, { style: 'currency', currency: primaryCurrency, maximumFractionDigits: 0 }),
    [primaryCurrency],
  );
  const money2 = useMemo(
    () => new Intl.NumberFormat(undefined, { style: 'currency', currency: primaryCurrency, minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [primaryCurrency],
  );

  // Custom preset reads the two date inputs; everything else uses a fixed rule.
  // Guard against a start after end by swapping so the range is always valid.
  const { start, end } = preset === 'custom'
    ? (customStart <= customEnd ? { start: customStart, end: customEnd } : { start: customEnd, end: customStart })
    : rangeFor(preset, today);
  const filtered = useMemo(() => inRange(events, start, end), [events, start, end]);
  const totals = useMemo(() => summarize(filtered), [filtered]);
  const monthly = useMemo(() => groupByMonth(filtered), [filtered]);
  const byType = useMemo(() => groupByField(filtered, 'eventType'), [filtered]);

  // Where the received money came from: deposits vs the balance (final payment).
  // Overtime and any other inflow fold into Balance so it's a clean two-way split.
  const bySource = useMemo(() => {
    let deposit = 0, balance = 0;
    for (const e of filtered) {
      const v = basis === 'net' ? e.net : e.gross;
      if ((e.kind || '').toLowerCase() === 'deposit') deposit += v; else balance += v;
    }
    const r2 = (n: number) => Number(n.toFixed(2));
    return [
      { key: 'deposit', label: 'Deposit', value: r2(deposit), color: '#00f5c4' },
      { key: 'balance', label: 'Balance', value: r2(balance), color: '#8AA0FF' },
    ];
  }, [filtered, basis]);

  const pick = (t: { net: number; gross: number }) => (basis === 'net' ? t.net : t.gross);

  const earned = pick(totals);

  // Total events booked (accepted) whose date falls in the selected period. The
  // window is the FULL period the chart shows (This Year = Jan–Dec, not just up
  // to today), so upcoming events in the period are counted too.
  // The full calendar window the selected period covers (This Year = Jan–Dec,
  // This Month = the whole month, etc.). Shared by the event tally and the
  // Expected total so both match the chart.
  const periodBounds = useMemo(() => {
    let cStart = start, cEnd = end;
    if (preset === 'this_month') {
      const y = Number(start.slice(0, 4)), mo = Number(start.slice(5, 7));
      cEnd = `${start.slice(0, 7)}-${pad(new Date(y, mo, 0).getDate())}`;
    } else if (preset === 'ytd') {
      cEnd = `${start.slice(0, 4)}-12-31`;
    } else if (preset === 'all') {
      cStart = '0000-01-01'; cEnd = '9999-12-31';
    }
    return { cStart, cEnd };
  }, [start, end, preset]);

  const eventCounts = useMemo(() => {
    const { cStart, cEnd } = periodBounds;
    const inRangeItems = eventItems.filter((e) => e.date >= cStart && e.date <= cEnd);
    const paid = inRangeItems.filter((e) => e.paid).length;
    // Split the unpaid (not fully settled, incl. deposit-only) into events that
    // have already happened (money you should chase) vs upcoming ones (expected).
    const unpaidItems = inRangeItems.filter((e) => !e.paid);
    const pastUnpaid = unpaidItems.filter((e) => e.date < today).length;
    const expectedUnpaid = unpaidItems.length - pastUnpaid;
    return { total: inRangeItems.length, paid, pastUnpaid, expectedUnpaid };
  }, [eventItems, periodBounds, today]);

  // Expected money still owed on upcoming bookings in the period — net AND gross,
  // so the KPI can show gross alongside the net figure like Revenue does.
  const expectedTotals = useMemo(() => {
    const { cStart, cEnd } = periodBounds;
    let net = 0, gross = 0;
    for (const x of expectedItems) {
      if (x.date >= cStart && x.date <= cEnd) { net += x.net; gross += x.gross; }
    }
    return { net: Number(net.toFixed(2)), gross: Number(gross.toFixed(2)) };
  }, [expectedItems, periodBounds]);
  const totalEvents = eventCounts.total;

  // Payments table has its own quick range, independent of the chart period.
  // 'period' tracks the charts; the others are rolling windows off today across
  // ALL events (so the table can look wider than the chart when you want).
  const tableEvents = useMemo(() => {
    if (tableRange === 'period') return filtered;
    const start = tableRange === 'last_30' ? addDays(today, -29)
      : tableRange === 'last_90' ? addDays(today, -89)
      : addDays(today, -364);
    return inRange(events, start, today);
  }, [tableRange, filtered, events, today]);
  const tableTotals = useMemo(() => summarize(tableEvents), [tableEvents]);

  // Detail for the open pop-up: every payment ever received on that booking
  // (across ALL time, not just the current range) plus any still-expected money.
  const bookingDetail = useMemo(() => {
    if (!openBooking) return null;
    const pays = events.filter((e) => e.bookingId === openBooking);
    if (pays.length === 0) return null;
    const first = pays[0];
    const receivedNet = pays.reduce((s, e) => s + e.net, 0);
    const receivedGross = pays.reduce((s, e) => s + e.gross, 0);
    const receivedTax = pays.reduce((s, e) => s + e.tax, 0);
    const exp = expectedItems.filter((x) => x.bookingId === openBooking);
    const expectedNet = exp.reduce((s, x) => s + x.net, 0);
    const expectedGross = exp.reduce((s, x) => s + x.gross, 0);
    const meta = bookingMeta[openBooking];
    return {
      bookingId: openBooking,
      eventType: first.eventType,
      venue: first.venue,
      currency: first.currency,
      eventDate: meta?.eventDate ?? null,
      startTime: meta?.startTime ?? null,
      endTime: meta?.endTime ?? null,
      pays: [...pays].sort((a, z) => a.paidDate.localeCompare(z.paidDate)),
      receivedNet, receivedGross, receivedTax,
      expectedNet, expectedGross,
    };
  }, [openBooking, events, expectedItems, bookingMeta]);

  // Short windows (this month / last 30 days) break down by DAY; everything else
  // by MONTH. Every bucket in the SELECTED PERIOD is shown, empty ones at $0 —
  // so the chart is a full timeline, not a lonely bar or two. 'All time' spans
  // the data itself (no 1970 explosion). Bars auto-scale to the tallest value
  // below, so peaks recalibrate on their own as revenue grows.
  // Expected (unpaid, upcoming) is plotted in the day/month of the EVENT beside
  // received, but ONLY on the two windows that look forward — this month (the
  // received/expected crossroads) and next year. Every other window shows
  // received only (see projectFuture below).
  const isDaily = preset === 'this_month' || preset === 'last_30';
  // A window longer than 12 months is too wide to read month-by-month, so
  // aggregate it by YEAR instead. Span is inclusive month count between the two
  // endpoints (Jan 2027 → Jul 2028 = 19 months ⇒ yearly).
  const monthSpan = (a: string, b: string) =>
    (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7))) + 1;
  // Earliest → latest date across all received + expected money. "All time" uses
  // this real span (not its 1970→today bounds) to decide month vs year.
  const dataBounds = useMemo(() => {
    let min = '', max = '';
    for (const e of events) { if (e.date && (!min || e.date < min)) min = e.date; if (e.date && (!max || e.date > max)) max = e.date; }
    for (const x of expectedItems) { if (x.date && (!min || x.date < min)) min = x.date; if (x.date && (!max || x.date > max)) max = x.date; }
    return { min, max };
  }, [events, expectedItems]);
  const isYearly =
    (preset === 'custom' && monthSpan(start, end) > 12) ||
    (preset === 'all' && !!dataBounds.min && monthSpan(dataBounds.min, dataBounds.max) > 12);
  // Single-year views (this/next/last year) hide the per-bar year on mobile —
  // it's redundant with the period label and crowds the axis.
  const singleYear = preset === 'ytd' || preset === 'next_year' || preset === 'last_year';
  type Bar = { key: string; label: string; sub?: string; value: number; expected: number };
  const bars = useMemo<Bar[]>(() => {
    const rv = (e: ReceivedEvent) => (basis === 'net' ? e.net : e.gross);
    const ev = (x: ExpectedItem) => (basis === 'net' ? x.net : x.gross);
    // Received = money already collected (past dates); expected = still to come
    // (future dates). They only meet at ONE crossroads: the current month, which
    // holds both received-so-far and what's still owed this month. So expected
    // only projects on:
    //   • this_month — the crossroads (received past days + expected remaining days)
    //   • next_year  — entirely future, so it's all expected
    // Every other window is received-only: last 30 / last 90 / last year / all
    // time (all past), and "this year" (received across its past + current months,
    // no forward projection).
    // Expected (unpaid, upcoming) money is always dated to a FUTURE event, so
    // plotting it in every window only ever lands it on the current + future
    // buckets that fall inside the selected range — a past-only window (Last 30)
    // simply has none in range. This is what makes the purple bars show up on
    // "This year" (current + remaining months) and "All time" too, not just the
    // two forward-looking presets.
    const projectFuture = true;

    if (isDaily) {
      const recMap = new Map<string, number>();
      for (const e of filtered) recMap.set(e.date, (recMap.get(e.date) || 0) + rv(e));
      // This month = the FULL calendar month (every day, future days at $0). Last
      // 30 = the rolling window ending today. Neither spills into other months —
      // expected events in later months belong to the year/next-year views.
      let endDay = end;
      if (preset === 'this_month') {
        const y = Number(start.slice(0, 4));
        const m = Number(start.slice(5, 7));
        endDay = `${start.slice(0, 7)}-${pad(new Date(y, m, 0).getDate())}`;
      }
      const expMap = new Map<string, number>();
      if (projectFuture) for (const x of expectedItems) {
        if (x.date >= start && x.date <= endDay) expMap.set(x.date, (expMap.get(x.date) || 0) + ev(x));
      }
      const out: Bar[] = [];
      let cur = start;
      for (let i = 0; i < 62 && cur <= endDay; i++) {
        out.push({ key: cur, label: String(Number(cur.slice(8, 10))), value: recMap.get(cur) || 0, expected: expMap.get(cur) || 0 });
        cur = addDays(cur, 1);
      }
      return out;
    }

    // Window wider than a year (custom range, or all-time spanning 12+ months):
    // one bar per YEAR (labelled "2027") so it stays readable instead of cramming
    // in 20+ month bars. "All time" spans the actual data; custom spans its dates.
    if (isYearly) {
      const recY = new Map<string, number>();
      for (const e of filtered) { const y = e.date.slice(0, 4); recY.set(y, (recY.get(y) || 0) + rv(e)); }
      const expY = new Map<string, number>();
      if (projectFuture) for (const x of expectedItems) {
        // All-time counts every expected month; custom clamps to its range.
        if (preset === 'all' || (x.date >= start && x.date <= end)) {
          const y = x.date.slice(0, 4); expY.set(y, (expY.get(y) || 0) + ev(x));
        }
      }
      const firstY = Number((preset === 'all' ? dataBounds.min : start).slice(0, 4));
      const lastY = Number((preset === 'all' ? dataBounds.max : end).slice(0, 4));
      const out: Bar[] = [];
      for (let y = firstY; y <= lastY && out.length < 60; y++) {
        const key = String(y);
        out.push({ key, label: key, value: recY.get(key) || 0, expected: expY.get(key) || 0 });
      }
      return out;
    }

    const recMap = new Map(monthly.map((b) => [b.month, basis === 'net' ? b.net : b.gross]));
    const expMap = new Map<string, number>();
    if (projectFuture) for (const x of expectedItems) { const m = x.date.slice(0, 7); expMap.set(m, (expMap.get(m) || 0) + ev(x)); }
    let firstYM: string;
    let lastYM: string;
    if (preset === 'all') {
      const keys = [...recMap.keys(), ...expMap.keys()].sort();
      if (keys.length === 0) return [];
      // Start at January of the earliest year so empty months in between still
      // show at $0 (a continuous timeline, not just the months with money).
      firstYM = `${keys[0].slice(0, 4)}-01`;
      lastYM = keys[keys.length - 1];
    } else {
      firstYM = start.slice(0, 7);
      lastYM = end.slice(0, 7);
      // Fixed calendar-year windows ("This year", "Next year") stay Jan–Dec of
      // that year — never extend past December to chase an expected booking that
      // lands in a later year. Other windows extend to cover expected months.
      const fixedYear = preset === 'ytd' || preset === 'next_year';
      if (!fixedYear) for (const m of expMap.keys()) if (m > lastYM) lastYM = m;
      if (fixedYear) {
        const yr = start.slice(0, 4);
        firstYM = `${yr}-01`;
        lastYM = `${yr}-12`;
      }
    }
    const out: Bar[] = [];
    let cur = firstYM;
    for (let i = 0; i < 120 && cur <= lastYM; i++) {
      const mp = monthParts(cur);
      out.push({ key: cur, label: mp.m, sub: mp.yr, value: recMap.get(cur) || 0, expected: expMap.get(cur) || 0 });
      cur = nextMonth(cur);
    }
    return out;
  }, [filtered, monthly, basis, preset, start, end, isDaily, isYearly, expectedItems]);
  const barMax = Math.max(1, ...bars.map((b) => Math.max(b.value, b.expected)));
  // Always label the bars with their amount — every window, not just the ones
  // with few bars. (Empty $0 bars have no label because there's no bar to sit on.)
  const showBarVals = true;
  // The current month is the crossroads: some money already received, some still
  // expected. Surface a single combined figure (received + expected) so "total
  // showing both" is spelled out, not just implied by the two bar colours. Only
  // meaningful for this_month — every other window is one-sided.
  const monthReceived = preset === 'this_month' ? bars.reduce((s, b) => s + b.value, 0) : 0;
  const monthExpected = preset === 'this_month' ? bars.reduce((s, b) => s + b.expected, 0) : 0;
  const showMonthTotal = preset === 'this_month' && monthExpected > 0;
  // Month/year context for the chart header, derived from the first/last bucket.
  const periodLabel = useMemo(() => {
    if (bars.length === 0) return '';
    const mn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    // Yearly buckets have bare-year keys ("2027"); month buckets are "YYYY-MM".
    const fmt = (k: string) => { const p = k.split('-'); return p.length < 2 ? p[0] : `${mn[Number(p[1]) - 1]} ${p[0]}`; };
    const a = fmt(bars[0].key);
    const b = fmt(bars[bars.length - 1].key);
    return a === b ? a : `${a} – ${b}`;
  }, [bars]);

  // Concise period label for the donut card headers (top-right). Custom shows
  // the exact date span; every preset shows its name ("This year", etc.).
  const periodTag = preset === 'custom' ? `${start} – ${end}` : rangeLabel(preset);

  function exportCsv() {
    const header = ['Date paid', 'Event Type', 'Venue', 'Kind', 'Gross', 'Tax', 'Net', 'Currency'];
    const cell = (v: string | number) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = tableEvents.map((e) => [
      e.paidDate, e.eventType, e.venue || '',
      e.kind, e.gross.toFixed(2), e.tax.toFixed(2), e.net.toFixed(2), e.currency,
    ]);
    const csv = [header, ...rows].map((r) => r.map(cell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finance-${preset}-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>Finance</h1>
        <p className={styles.subtitle}>
          {djName === 'Your' ? 'Your earnings' : `${djName}'s earnings`}, payouts and outstanding balances — owner-only.
        </p>
      </div>

      <div className={styles.controls}>
        {/* Desktop: pill tabs. Mobile: a dropdown — 7 pills wrap into a mess. */}
        <div className={`${styles.seg} ${styles.segDesktop}`} role="tablist" aria-label="Time period">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`${styles.segBtn} ${preset === p.key ? styles.segBtnActive : ''}`}
              onClick={() => setPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <select
          className={styles.periodSelect}
          aria-label="Time period"
          value={preset}
          onChange={(e) => setPreset(e.target.value as Preset)}
        >
          {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        {preset === 'custom' && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="date"
              aria-label="Start date"
              value={customStart}
              max={customEnd}
              onChange={(e) => setCustomStart(e.target.value)}
              style={{ colorScheme: 'dark', background: 'rgba(255,255,255,.05)', color: '#fff', border: '1px solid rgba(255,255,255,.18)', borderRadius: 8, padding: '.4rem .6rem', fontSize: '.82rem' }}
            />
            <span style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.8rem' }}>to</span>
            <input
              type="date"
              aria-label="End date"
              value={customEnd}
              min={customStart}
              onChange={(e) => setCustomEnd(e.target.value)}
              style={{ colorScheme: 'dark', background: 'rgba(255,255,255,.05)', color: '#fff', border: '1px solid rgba(255,255,255,.18)', borderRadius: 8, padding: '.4rem .6rem', fontSize: '.82rem' }}
            />
          </div>
        )}
        <div className={styles.spacer} />
        <div className={styles.seg} aria-label="Amount basis">
          <button type="button" className={`${styles.segBtn} ${basis === 'net' ? styles.segBtnActive : ''}`} onClick={() => setBasis('net')}>Net (after tax)</button>
          <button type="button" className={`${styles.segBtn} ${basis === 'gross' ? styles.segBtnActive : ''}`} onClick={() => setBasis('gross')}>Gross</button>
        </div>
      </div>

      {/* Revenue over time — the primary chart, full width. Day granularity for
          short windows, month otherwise; every bucket in the period is shown. */}
      <div className={styles.card} style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <div className={styles.cardTitle} style={{ margin: 0 }}>Revenue by {isDaily ? 'day' : isYearly ? 'year' : 'month'}</div>
          {periodLabel && <div style={{ fontSize: '.8rem', fontWeight: 600, color: 'var(--text, #ffffff)' }}>{periodLabel}</div>}
        </div>
        {showMonthTotal && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px', margin: '-4px 0 14px' }}>
            <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text, #ffffff)' }}>
              {money2.format(monthReceived + monthExpected)}
            </span>
            <span style={{ fontSize: '.78rem', color: 'var(--muted, #8a8aa0)' }}>
              total expected this month · <span style={{ color: '#00f5c4' }}>{money0.format(monthReceived)} received</span> + <span style={{ color: '#8aa0ff' }}>{money0.format(monthExpected)} expected</span>
            </span>
          </div>
        )}
        {bars.length === 0 ? (
          <div className={styles.empty}>No revenue in this period.</div>
        ) : (
          <div className={`${styles.bars} ${singleYear ? styles.hideYrMobile : ''}`}>
            {bars.map((b) => (
              <div key={b.key} className={styles.barCol} title={`${b.label}${b.sub ? ' ' + b.sub : ''} · received ${money2.format(b.value)}${b.expected > 0 ? ` · expected ${money2.format(b.expected)}` : ''}`}>
                <div className={styles.barTrack}>
                  <div className={styles.barGroup}>
                    {b.value > 0 && (
                      <div className={styles.barItem}>
                        {showBarVals && <span className={styles.barVal} style={{ color: '#00F5C4' }}>{money0.format(b.value)}</span>}
                        <div className={styles.barRec} style={{ height: `${(b.value / barMax) * 100}%` }} />
                      </div>
                    )}
                    {b.expected > 0 && (
                      <div className={styles.barItem}>
                        {showBarVals && <span className={styles.barVal} style={{ color: '#8AA0FF' }}>{money0.format(b.expected)}</span>}
                        <div className={styles.barExp2} style={{ height: `${(b.expected / barMax) * 100}%` }} />
                      </div>
                    )}
                  </div>
                </div>
                <div className={styles.barLabel}>{b.label}{b.sub ? <span className={styles.barYr}> {b.sub}</span> : null}</div>
              </div>
            ))}
          </div>
        )}
        {/* Legend always shows so the two colours are explained even when the
            current range happens to have no expected (unpaid) bookings. */}
        <div className={styles.chartLegend}>
          <span className={styles.legendRow}><span className={styles.swatch} style={{ background: '#00f5c4' }} />Received</span>
          <span className={styles.legendRow}><span className={styles.swatch} style={{ background: '#8AA0FF' }} />Expected — confirmed bookings with unpaid deposit/balance</span>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: '.72rem', color: 'var(--muted, #8a8aa0)', lineHeight: 1.5 }}>
          Deposits count in the month they’re paid; the balance and everything else count in the month of the event.
        </p>
      </div>

      {/* KPI strip */}
      <div className={styles.kpis}>
        <div className={`${styles.kpi} ${styles.kpiHero}`}>
          <div className={styles.kpiLabel}>Revenue ({basis}) · {rangeLabel(preset)}</div>
          <div className={`${styles.kpiValue} ${styles.pos}`}>{money0.format(earned)}</div>
          <div className={styles.kpiSub}>
            {basis === 'net' ? `Gross ${money0.format(totals.gross)}` : `Net ${money0.format(totals.net)}`}
          </div>
        </div>

        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Tax collected · {rangeLabel(preset)}</div>
          <div className={styles.kpiValue}>{money0.format(totals.tax)}</div>
        </div>

        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Expected ({basis}) · {rangeLabel(preset)}</div>
          <div className={styles.kpiValue} style={{ color: '#8AA0FF' }}>{money0.format(basis === 'net' ? expectedTotals.net : expectedTotals.gross)}</div>
          <div className={styles.kpiSub}>
            {basis === 'net' ? `Gross ${money0.format(expectedTotals.gross)}` : `Net ${money0.format(expectedTotals.net)}`} · unpaid on upcoming
          </div>
        </div>

        <div className={styles.kpi}>
          <div className={styles.kpiLabel} style={{ marginBottom: 10 }}>Events · {rangeLabel(preset)}</div>
          <div style={{ display: 'flex', alignItems: 'stretch' }}>
            {[
              { value: totalEvents, label: 'Total', color: '#ffffff' },
              { value: eventCounts.paid, label: 'Paid', color: '#00f5c4' },
              { value: eventCounts.pastUnpaid, label: 'Past unpaid', color: '#ff6b6b' },
              { value: eventCounts.expectedUnpaid, label: 'Expected unpaid', color: '#8AA0FF' },
            ].map((c, i) => (
              <div
                key={c.label}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '2px 6px',
                  borderLeft: i === 0 ? 'none' : '1px solid rgba(255,255,255,.08)',
                }}
              >
                <div style={{ fontSize: '1.5rem', fontWeight: 800, lineHeight: 1.1, color: c.color }}>{c.value}</div>
                <div style={{ fontSize: '.62rem', textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted,#8a8aa0)', marginTop: 4 }}>{c.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Breakdown donuts */}
      <div className={styles.pieRow}>
        <div className={styles.card}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
            <div className={styles.cardTitle} style={{ margin: 0 }}>Deposit vs balance</div>
            <div style={{ fontSize: '.78rem', fontWeight: 600, color: 'var(--muted, #8a8aa0)', whiteSpace: 'nowrap', flexShrink: 0 }}>{periodTag}</div>
          </div>
          <Donut
            slices={bySource}
            fmt={(n) => money0.format(n)}
          />
        </div>
        <div className={styles.card}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
            <div className={styles.cardTitle} style={{ margin: 0 }}>By event type</div>
            <div style={{ fontSize: '.78rem', fontWeight: 600, color: 'var(--muted, #8a8aa0)', whiteSpace: 'nowrap', flexShrink: 0 }}>{periodTag}</div>
          </div>
          <Donut
            slices={byType.map((s, i) => ({ label: s.label, value: pick(s), color: TYPE_COLORS[i % TYPE_COLORS.length] }))}
            fmt={(n) => money0.format(n)}
          />
        </div>
      </div>

      {/* Job table */}
      <div className={styles.tableCard}>
        <div className={styles.tableHead}>
          <div className={styles.cardTitle} style={{ margin: 0 }}>Payments received · {tableEvents.length}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select
              className={styles.rangeSelect}
              aria-label="Payments range"
              value={tableRange}
              onChange={(e) => setTableRange(e.target.value as typeof tableRange)}
            >
              <option value="period">Selected period</option>
              <option value="last_30">Last 30 days</option>
              <option value="last_90">Last 90 days</option>
              <option value="last_year">Past year</option>
            </select>
            <button type="button" className={styles.exportBtn} onClick={exportCsv} disabled={tableEvents.length === 0}>
              Export CSV
            </button>
          </div>
        </div>
        {tableEvents.length === 0 ? (
          <div className={styles.empty}>No payments received in this range.</div>
        ) : (
          <div className={styles.tScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date paid</th>
                  <th>Event</th>
                  <th>Venue</th>
                  <th>Kind</th>
                  <th className={styles.num}>Gross</th>
                  <th className={styles.num}>Tax</th>
                  <th className={styles.num}>Net</th>
                </tr>
              </thead>
              <tbody>
                {[...tableEvents].reverse().map((e, i) => (
                  <tr
                    key={`${e.bookingId}-${e.paidDate}-${i}`}
                    onClick={() => setOpenBooking(e.bookingId)}
                    style={{ cursor: 'pointer' }}
                    title="View booking details"
                  >
                    <td>{e.paidDate}</td>
                    <td style={{ color: '#8AA0FF', textDecoration: 'underline', textUnderlineOffset: 2 }}>{e.eventType}</td>
                    <td>{e.venue || '—'}</td>
                    <td>{e.kind}</td>
                    <td className={styles.num}>{money2.format(e.gross)}</td>
                    <td className={styles.num}>{money2.format(e.tax)}</td>
                    <td className={styles.num}>{money2.format(e.net)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={styles.totalRow}>
                  <td colSpan={4}>Total · {tableEvents.length} payment{tableEvents.length === 1 ? '' : 's'}</td>
                  <td className={styles.num}>{money2.format(tableTotals.gross)}</td>
                  <td className={styles.num}>{money2.format(tableTotals.tax)}</td>
                  <td className={styles.num}>{money2.format(tableTotals.net)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <p className={styles.note}>
        &ldquo;Earned&rdquo; is money you actually collected across every rail (card, Venmo, Cash App, PayPal, Zelle,
        cash, check) plus paid overtime. Net excludes sales tax, which you hold for the state.
      </p>

      {bookingDetail && (
        <BookingDetailCard
          detail={bookingDetail}
          money={money2}
          onClose={() => setOpenBooking(null)}
        />
      )}
    </div>
  );
}

// ── BookingDetailCard: in-page pop-up summarising one booking's money ─────────
// Opened by clicking a payments-received row. Stays on the Finance page (no
// navigation). Shows every payment received on the booking, the totals, and any
// money still expected, with a link to open the full booking in a new tab.
function BookingDetailCard({
  detail,
  money,
  onClose,
}: {
  detail: {
    bookingId: string;
    eventType: string;
    venue: string | null;
    currency: string;
    eventDate: string | null;
    startTime: string | null;
    endTime: string | null;
    pays: ReceivedEvent[];
    receivedNet: number;
    receivedGross: number;
    receivedTax: number;
    expectedNet: number;
    expectedGross: number;
  };
  money: Intl.NumberFormat;
  onClose: () => void;
}) {
  const label = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);
  // "2026-09-04" → "Thu, Sep 4, 2026" (parsed as a plain date, no TZ shift).
  const fmtDate = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso.slice(0, 10) + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };
  // "18:00" / "18:00:00" → "6:00 PM".
  const fmtTime = (t: string | null) => {
    if (!t) return null;
    const m = /^(\d{1,2}):(\d{2})/.exec(t);
    if (!m) return t;
    let h = Number(m[1]);
    const min = m[2];
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return `${h}:${min} ${ap}`;
  };
  const dateStr = fmtDate(detail.eventDate);
  const startStr = fmtTime(detail.startTime);
  const endStr = fmtTime(detail.endTime);
  const timeStr = startStr ? (endStr ? `${startStr} – ${endStr}` : startStr) : null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Booking details"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(460px, 100%)', maxHeight: '85vh', overflowY: 'auto',
          background: '#15151f', border: '1px solid rgba(255,255,255,.14)',
          borderRadius: 16, padding: '20px 22px', boxShadow: '0 24px 60px rgba(0,0,0,.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff' }}>{detail.eventType}</div>
            {detail.venue && <div style={{ fontSize: '.85rem', color: 'var(--muted,#8a8aa0)', marginTop: 2 }}>{detail.venue}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', color: 'var(--muted,#8a8aa0)', fontSize: '1.5rem', lineHeight: 1, cursor: 'pointer', padding: 0 }}
          >
            ×
          </button>
        </div>

        {(dateStr || timeStr) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px', marginTop: 12, fontSize: '.86rem' }}>
            {dateStr && (
              <span style={{ color: '#fff' }}>
                <span style={{ color: 'var(--muted,#8a8aa0)' }}>Event date: </span>{dateStr}
              </span>
            )}
            {timeStr && (
              <span style={{ color: '#fff' }}>
                <span style={{ color: 'var(--muted,#8a8aa0)' }}>Time: </span>{timeStr}
              </span>
            )}
          </div>
        )}

        <div style={{ fontSize: '.68rem', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted,#8a8aa0)', margin: '16px 0 8px' }}>
          Payments received
        </div>
        {detail.pays.length === 0 ? (
          <div style={{ fontSize: '.85rem', color: 'var(--muted,#8a8aa0)' }}>No payments recorded yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {detail.pays.map((p, i) => (
              <div key={`${p.paidDate}-${i}`} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, fontSize: '.86rem' }}>
                <span style={{ color: '#fff' }}>{label(p.kind)}</span>
                <span style={{ color: 'var(--muted,#8a8aa0)', flex: 1, textAlign: 'left', marginLeft: 10 }}>{p.paidDate}</span>
                <span style={{ color: '#fff', fontWeight: 600 }}>{money.format(p.gross)}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ borderTop: '1px solid rgba(255,255,255,.1)', margin: '14px 0 0', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6, fontSize: '.86rem' }}>
          <Row k="Received (gross)" v={money.format(detail.receivedGross)} />
          <Row k="Tax collected" v={money.format(detail.receivedTax)} muted />
          <Row k="Received (net)" v={money.format(detail.receivedNet)} strong color="#00f5c4" />
          {detail.expectedGross > 0 && (
            <Row k="Balance (expected)" v={money.format(detail.expectedGross)} strong color="#8AA0FF" />
          )}
        </div>

        <a
          href={`/upcoming-bookings?open=${detail.bookingId}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block', textAlign: 'center', marginTop: 18,
            padding: '.6rem .8rem', borderRadius: 10,
            border: '1px solid rgba(255,255,255,.18)', color: '#fff',
            fontSize: '.85rem', fontWeight: 600, textDecoration: 'none',
          }}
        >
          Open full booking details ↗
        </a>
      </div>
    </div>
  );
}

function Row({ k, v, muted, strong, color }: { k: string; v: string; muted?: boolean; strong?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
      <span style={{ color: muted ? 'var(--muted,#8a8aa0)' : '#fff' }}>{k}</span>
      <span style={{ color: color || (muted ? 'var(--muted,#8a8aa0)' : '#fff'), fontWeight: strong ? 800 : 600 }}>{v}</span>
    </div>
  );
}

function rangeLabel(p: Preset): string {
  return PRESETS.find((x) => x.key === p)?.label || '';
}

// ── Donut: dependency-free 3D (tilted + extruded) conic ring with a legend ───
// A conic-gradient disc, masked to a ring, tilted on X and extruded by stacking
// darkened copies along the ring's own Z axis (true perpendicular thickness,
// thanks to preserve-3d on the tilted parent). Zero-value slices are dropped
// from the ring but still listed — greyed — in the legend, so "By payment
// method" shows every rail even when one has never been used.
function Donut({ slices, fmt }: { slices: { key?: string; label: string; value: number; color: string }[]; fmt: (n: number) => string }) {
  const data = slices.filter((s) => s.value > 0);
  const total = data.reduce((s, x) => s + x.value, 0);

  // Build the conic gradient stops from the active (non-zero) slices.
  let acc = 0;
  const stops: string[] = [];
  for (const s of data) {
    const from = (acc / total) * 100;
    acc += s.value;
    const to = (acc / total) * 100;
    stops.push(`${s.color} ${from}% ${to}%`);
  }
  const grad = total > 0 ? `conic-gradient(from 0deg, ${stops.join(', ')})` : 'conic-gradient(#2a2a38, #2a2a38)';
  const DEPTH = 14; // px of extruded thickness

  return (
    <div className={styles.pieWrap}>
      <div className={styles.disc3dScene}>
        <div className={styles.disc3d}>
          {/* Extruded side wall: darkened copies stacked under the top face. */}
          {Array.from({ length: DEPTH }).map((_, i) => (
            <div
              key={i}
              className={styles.disc3dFace}
              style={{ background: `linear-gradient(rgba(0,0,0,.55), rgba(0,0,0,.55)), ${grad}`, transform: `translateZ(-${i + 1}px)` }}
            />
          ))}
          {/* Top face: full-colour ring. */}
          <div className={styles.disc3dFace} style={{ background: grad, transform: 'translateZ(0.5px)' }} />
        </div>
      </div>
      <div className={styles.legendCol}>
        <div className={styles.legend}>
          {slices.map((s, i) => {
            const zero = !(s.value > 0);
            return (
              <div key={s.key ?? i} className={styles.legendRow} style={zero ? { opacity: 0.45 } : undefined}>
                <span className={styles.swatch} style={{ background: zero ? '#4a4a58' : s.color }} />
                <span className={styles.legendLabel}>{s.label}</span>
                <span className={styles.legendVal}>
                  {zero ? `${fmt(0)} · 0%` : `${fmt(s.value)} · ${Math.round((s.value / total) * 100)}%`}
                </span>
              </div>
            );
          })}
        </div>
        {/* Total stays pinned below the (scrolling) slice list. */}
        <div className={styles.legendRow} style={{ borderTop: '1px solid rgba(255,255,255,.1)', marginTop: 6, paddingTop: 6, fontWeight: 700 }}>
          <span className={styles.swatch} style={{ background: 'transparent' }} />
          <span className={styles.legendLabel}>Total</span>
          <span className={styles.legendVal} style={{ color: '#fff' }}>{fmt(total)}</span>
        </div>
      </div>
    </div>
  );
}
