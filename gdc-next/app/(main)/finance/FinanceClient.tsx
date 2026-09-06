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
  METHOD_COLORS,
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

interface Props {
  events: ReceivedEvent[];
  outstanding: Totals;
  expectedItems: ExpectedItem[];
  stripe: StripeSnapshot;
  primaryCurrency: string;
  djName: string;
  today: string; // YYYY-MM-DD
}

type Preset = 'this_month' | 'last_30' | 'last_90' | 'ytd' | 'next_year' | 'last_year' | 'all';

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_30', label: 'Last 30 days' },
  { key: 'last_90', label: 'Last 90 days' },
  { key: 'ytd', label: 'This year' },
  { key: 'next_year', label: 'Next year' },
  { key: 'last_year', label: 'Last year' },
  { key: 'all', label: 'All time' },
];

// Palette for event-type slices (methods have their own fixed colours).
const TYPE_COLORS = ['#00f5c4', '#635BFF', '#e6b455', '#ef6f9c', '#4cc2ff', '#9b8cff', '#5fd08a', '#c98bff', '#ff9f6b'];

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

export default function FinanceClient({ events, outstanding, expectedItems, stripe, primaryCurrency, djName, today }: Props) {
  const [preset, setPreset] = useState<Preset>('ytd');
  const [basis, setBasis] = useState<'net' | 'gross'>('net');

  const money0 = useMemo(
    () => new Intl.NumberFormat(undefined, { style: 'currency', currency: primaryCurrency, maximumFractionDigits: 0 }),
    [primaryCurrency],
  );
  const money2 = useMemo(
    () => new Intl.NumberFormat(undefined, { style: 'currency', currency: primaryCurrency, minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [primaryCurrency],
  );

  const { start, end } = rangeFor(preset, today);
  const filtered = useMemo(() => inRange(events, start, end), [events, start, end]);
  const totals = useMemo(() => summarize(filtered), [filtered]);
  const monthly = useMemo(() => groupByMonth(filtered), [filtered]);
  const byMethod = useMemo(() => groupByField(filtered, 'method'), [filtered]);
  const byType = useMemo(() => groupByField(filtered, 'eventType'), [filtered]);

  const pick = (t: { net: number; gross: number }) => (basis === 'net' ? t.net : t.gross);

  const gigs = useMemo(() => new Set(filtered.map((e) => e.bookingId)).size, [filtered]);
  const earned = pick(totals);
  const avgPerGig = gigs > 0 ? earned / gigs : 0;

  // Short windows (this month / last 30 days) break down by DAY; everything else
  // by MONTH. Every bucket in the SELECTED PERIOD is shown, empty ones at $0 —
  // so the chart is a full timeline, not a lonely bar or two. 'All time' spans
  // the data itself (no 1970 explosion). Bars auto-scale to the tallest value
  // below, so peaks recalibrate on their own as revenue grows.
  // Expected (unpaid, upcoming) is plotted in the month/day of the EVENT, stacked
  // on top of received. Past views ('last year') never project. The axis extends
  // to the latest expected event so those future bars are visible.
  const isDaily = preset === 'this_month' || preset === 'last_30';
  // Single-year views (this/next/last year) hide the per-bar year on mobile —
  // it's redundant with the period label and crowds the axis.
  const singleYear = preset === 'ytd' || preset === 'next_year' || preset === 'last_year';
  type Bar = { key: string; label: string; sub?: string; value: number; expected: number };
  const bars = useMemo<Bar[]>(() => {
    const rv = (e: ReceivedEvent) => (basis === 'net' ? e.net : e.gross);
    const ev = (x: ExpectedItem) => (basis === 'net' ? x.net : x.gross);
    // Expected is money still to come, so only project it on forward-looking
    // windows. Backward windows (last 30 / last 90 / last year) show received only.
    const projectFuture = preset === 'this_month' || preset === 'ytd' || preset === 'next_year';

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
      for (const m of expMap.keys()) if (m > lastYM) lastYM = m;
      // "This year" is always the full calendar year (Jan–Dec) — never spill
      // into next year even when an expected event sits there.
      if (preset === 'ytd') {
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
  }, [filtered, monthly, basis, preset, start, end, isDaily, expectedItems]);
  const barMax = Math.max(1, ...bars.map((b) => Math.max(b.value, b.expected)));
  const showBarVals = bars.length <= 14;
  const hasExpected = bars.some((b) => b.expected > 0);
  // Month/year context for the chart header, derived from the first/last bucket.
  const periodLabel = useMemo(() => {
    if (bars.length === 0) return '';
    const mn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fmt = (k: string) => { const p = k.split('-'); return `${mn[Number(p[1]) - 1]} ${p[0]}`; };
    const a = fmt(bars[0].key);
    const b = fmt(bars[bars.length - 1].key);
    return a === b ? a : `${a} – ${b}`;
  }, [bars]);

  const inStripe = stripe.connected && (stripe.available != null || stripe.pending != null)
    ? (stripe.available || 0) + (stripe.pending || 0)
    : null;

  function exportCsv() {
    const header = ['Date', 'Event Type', 'Venue', 'Method', 'Kind', 'Gross', 'Tax', 'Net', 'Currency'];
    const cell = (v: string | number) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = filtered.map((e) => [
      e.date, e.eventType, e.venue || '', (e.method[0].toUpperCase() + e.method.slice(1)),
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
          <div className={styles.cardTitle} style={{ margin: 0 }}>Revenue by {isDaily ? 'day' : 'month'}</div>
          {periodLabel && <div style={{ fontSize: '.8rem', fontWeight: 600, color: 'var(--text, #ffffff)' }}>{periodLabel}</div>}
        </div>
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
        {hasExpected && (
          <div className={styles.chartLegend}>
            <span className={styles.legendRow}><span className={styles.swatch} style={{ background: '#00f5c4' }} />Received</span>
            <span className={styles.legendRow}><span className={styles.swatch} style={{ background: '#8AA0FF' }} />Expected — confirmed bookings with unpaid deposit/balance</span>
          </div>
        )}
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
          <div className={styles.kpiLabel}>Tax collected</div>
          <div className={styles.kpiValue}>{money0.format(totals.tax)}</div>
          <div className={styles.kpiSub}>Held for the state — not income</div>
        </div>

        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Gigs paid</div>
          <div className={styles.kpiValue}>{gigs}</div>
          <div className={styles.kpiSub}>Avg {money0.format(avgPerGig)} / gig</div>
        </div>

        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Outstanding</div>
          <div className={`${styles.kpiValue} ${styles.warn}`}>{money0.format(pick(outstanding))}</div>
          <div className={styles.kpiSub}>Invoiced, not yet confirmed</div>
        </div>

        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>In Stripe now</div>
          <div className={styles.kpiValue}>{inStripe == null ? '—' : money0.format(inStripe)}</div>
          <div className={styles.kpiSub}>
            {!stripe.connected ? 'Card not connected' : `Card only · ${money0.format(stripe.available || 0)} available`}
          </div>
        </div>
      </div>

      {/* Breakdown donuts */}
      <div className={styles.pieRow}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>By payment method</div>
          <Donut
            slices={byMethod.map((s) => ({ label: s.label, value: pick(s), color: METHOD_COLORS[s.key] || '#8A8AA0' }))}
            fmt={(n) => money0.format(n)}
          />
        </div>
        <div className={styles.card}>
          <div className={styles.cardTitle}>By event type</div>
          <Donut
            slices={byType.map((s, i) => ({ label: s.label, value: pick(s), color: TYPE_COLORS[i % TYPE_COLORS.length] }))}
            fmt={(n) => money0.format(n)}
          />
        </div>
      </div>

      {/* Job table */}
      <div className={styles.tableCard}>
        <div className={styles.tableHead}>
          <div className={styles.cardTitle} style={{ margin: 0 }}>Payments received · {filtered.length}</div>
          <button type="button" className={styles.exportBtn} onClick={exportCsv} disabled={filtered.length === 0}>
            Export CSV
          </button>
        </div>
        {filtered.length === 0 ? (
          <div className={styles.empty}>No payments received in this period.</div>
        ) : (
          <div className={styles.tScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Event</th>
                  <th>Venue</th>
                  <th>Method</th>
                  <th>Kind</th>
                  <th className={styles.num}>Gross</th>
                  <th className={styles.num}>Tax</th>
                  <th className={styles.num}>Net</th>
                </tr>
              </thead>
              <tbody>
                {[...filtered].reverse().map((e, i) => (
                  <tr key={`${e.bookingId}-${e.date}-${i}`}>
                    <td>{e.date}</td>
                    <td>{e.eventType}</td>
                    <td>{e.venue || '—'}</td>
                    <td>
                      <span className={styles.chip} style={{ background: (METHOD_COLORS[e.method] || '#8A8AA0') + '22', color: METHOD_COLORS[e.method] || '#b8b8c8' }}>
                        {e.method[0].toUpperCase() + e.method.slice(1)}
                      </span>
                    </td>
                    <td>{e.kind}</td>
                    <td className={styles.num}>{money2.format(e.gross)}</td>
                    <td className={styles.num}>{money2.format(e.tax)}</td>
                    <td className={styles.num}>{money2.format(e.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className={styles.note}>
        &ldquo;Earned&rdquo; is money you actually collected across every rail (card, Venmo, Cash App, PayPal, Zelle,
        cash, check) plus paid overtime. &ldquo;In Stripe now&rdquo; is card payments only — the rest never touches
        Stripe. Net excludes sales tax, which you hold for the state.
        {stripe.error ? ` (Stripe balance unavailable: ${stripe.error})` : ''}
      </p>
    </div>
  );
}

function rangeLabel(p: Preset): string {
  return PRESETS.find((x) => x.key === p)?.label || '';
}

// ── Donut: dependency-free SVG pie with a legend ─────────────────────────────
function Donut({ slices, fmt }: { slices: { label: string; value: number; color: string }[]; fmt: (n: number) => string }) {
  const data = slices.filter((s) => s.value > 0);
  const total = data.reduce((s, x) => s + x.value, 0);
  const size = 140;
  const stroke = 24;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;

  if (total <= 0) {
    return <div className={styles.empty} style={{ padding: '24px 8px' }}>No data.</div>;
  }

  let offset = 0;
  return (
    <div className={styles.pieWrap}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flex: 'none' }}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#26263380" strokeWidth={stroke} />
          {data.map((s, i) => {
            const len = (s.value / total) * circ;
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={stroke}
                strokeDasharray={`${len} ${circ - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
        </g>
      </svg>
      <div className={styles.legend}>
        {data.map((s, i) => (
          <div key={i} className={styles.legendRow}>
            <span className={styles.swatch} style={{ background: s.color }} />
            <span className={styles.legendLabel}>{s.label}</span>
            <span className={styles.legendVal}>{fmt(s.value)} · {Math.round((s.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
