'use client';

// DiscountsSection — DJ-facing management for the automatic sale + promo
// codes. Shared by the mobile (BookingTab) and club (ClubBookingTab) settings.
// Presentational: reads current values, reports changes via onChange, which
// the parent folds into booking_settings via patch().
//
// Promo codes: you build a code in the draft form, hit Activate, and it drops
// into a single list. That list holds active AND deactivated codes (it doubles
// as history), each with inline Edit and Deactivate/Reactivate.
//
// Nothing here applies the discount to a quote — that happens in the booking
// form using computeDiscount() from bookingSettings.ts.

import { useEffect, useState } from 'react';
import styles from './updateDjProfile.module.css';
import { createClient } from '@/lib/supabase/client';
import type { PromoCode, Sale, DiscountExclusion } from '@/app/(main)/[slug]/bookingSettings';

interface Props {
  promoCodes: PromoCode[];
  sale: Sale;
  // Past (ended) sales, most recent first. Shown as a read-only history below
  // the Run-a-sale controls.
  saleHistory?: Sale[];
  // Dates where the sale and/or promo codes are blocked.
  exclusions?: DiscountExclusion[];
  currencySymbol?: string;
  onChange: (patch: { promo_codes?: PromoCode[]; sale?: Sale; sale_history?: Sale[]; exclusions?: DiscountExclusion[] }) => void;
}

interface Redemption {
  id: string | null;
  requester_name: string | null;
  event_date: string | null;
  created_at: string | null;
  discount_code: string | null;
  discount_label: string | null;
  discount_amount: number | null;
  original_rate: number | null;
  currency: string | null;
}

function fmtDate(s: string | null): string {
  if (!s) return '';
  const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

const labelStyle: React.CSSProperties = {
  fontSize: '.7rem',
  textTransform: 'uppercase',
  letterSpacing: '.05em',
  color: 'var(--muted, #8a8aa0)',
  marginBottom: '.25rem',
  display: 'block',
};
const fieldWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', minWidth: 0 };
const dateInputStyle: React.CSSProperties = { colorScheme: 'dark', cursor: 'pointer' };
// Small uppercase caption before each meta value in a code row.
const metaLabel: React.CSSProperties = {
  fontSize: '.6rem',
  textTransform: 'uppercase',
  letterSpacing: '.06em',
  color: 'var(--muted, #8a8aa0)',
  marginRight: '.35rem',
};
// Brand gradient used across this section (badge headers, status pill, CTA).
const GRAD = 'linear-gradient(100deg,#22e3ad,#31d0ff)';

// A section block: pure-black card with a bright hairline border. The two
// blocks (Run a sale / Promo codes) sit inside the panel and read as distinct.
const blockStyle: React.CSSProperties = {
  background: '#000',
  border: '1px solid rgba(255,255,255,.16)',
  borderRadius: 16,
  padding: '1.35rem 1.35rem 1.2rem',
  marginBottom: '1.15rem',
};
// Highlighted, gradient-badge header. Renders an icon chip + bold title inside
// a tinted gradient pill so each section clearly stands out from the black card.
function SecHeader({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 12,
        padding: '10px 18px 10px 12px', borderRadius: 14,
        background: 'linear-gradient(100deg,rgba(34,227,173,.18),rgba(49,208,255,.14))',
        border: '1px solid rgba(255,255,255,.26)', marginBottom: 16,
      }}
    >
      <span
        style={{
          width: 30, height: 30, borderRadius: 9, background: GRAD,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          boxShadow: '0 6px 18px -6px rgba(34,227,173,.7)',
        }}
      >
        {icon}
      </span>
      <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: '.01em', color: '#fff' }}>{label}</span>
    </div>
  );
}
const iconSale = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#04241b" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);
const iconPromo = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#04241b" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 12V7H4v5a2 2 0 0 1 0 4v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1a2 2 0 0 1 0-4z" />
    <line x1="12" y1="7" x2="12" y2="19" />
  </svg>
);
const iconExcl = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#04241b" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    <line x1="9" y1="16" x2="15" y2="16" />
  </svg>
);
const usedCellValue: React.CSSProperties = {
  height: 38, display: 'inline-flex', alignItems: 'center', gap: 4,
  color: 'var(--white,#fff)', fontSize: '.88rem', fontWeight: 700,
};

// A small link that jumps to a booking's card via the ?open=<id> deep link
// (expands and scrolls to it). A booking whose event date has passed lives on
// the Past Bookings page, so route there; otherwise Upcoming Bookings. Both
// pages read ?open.
function ViewBookingLink({ id, eventDate }: { id: string | null; eventDate?: string | null }) {
  if (!id) return null;
  const isPast = !!eventDate && new Date(`${eventDate}T23:59:59`).getTime() < Date.now();
  const base = isPast ? '/past-bookings' : '/upcoming-bookings';
  return (
    <a
      href={`${base}?open=${id}`}
      onClick={(e) => e.stopPropagation()}
      style={{ color: 'var(--neon,#00e0a4)', fontSize: '.72rem', fontWeight: 600, textDecoration: 'underline', whiteSpace: 'nowrap' }}
    >
      View booking
    </a>
  );
}

function openPicker(e: React.MouseEvent<HTMLInputElement>) {
  const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
  try { el.showPicker?.(); } catch { /* unsupported */ }
}

function emptyDraft(): PromoCode {
  return { code: '', type: 'percent', value: 0, active: true, expires: null, maxUses: null, uses: 0 };
}

// Fields shared by the draft form and inline edit. `value` is the working copy.
function CodeFields({
  value,
  onField,
  currencySymbol,
}: {
  value: PromoCode;
  onField: (p: Partial<PromoCode>) => void;
  currencySymbol: string;
}) {
  return (
    <>
      <div style={{ ...fieldWrap, flex: '1 1 130px' }}>
        <label style={labelStyle}>Code</label>
        <input
          type="text"
          className={styles.settingNumber}
          value={value.code}
          onChange={(e) => onField({ code: e.target.value.toUpperCase() })}
          placeholder="SPRING10"
          style={{ textTransform: 'uppercase', color: 'var(--white,#fff)' }}
        />
      </div>
      <div style={{ ...fieldWrap, flex: '0 0 104px' }}>
        <label style={labelStyle}>Type</label>
        <select
          className={styles.settingSelect}
          style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', color: 'var(--white,#fff)' }}
          value={value.type}
          onChange={(e) => onField({ type: e.target.value as 'percent' | 'flat' })}
        >
          <option value="percent">% off</option>
          <option value="flat">{currencySymbol} off</option>
        </select>
      </div>
      <div style={{ ...fieldWrap, flex: '0 0 92px' }}>
        <label style={labelStyle}>{value.type === 'percent' ? 'Percent' : 'Amount'}</label>
        {value.type === 'percent' ? (
          <select
            className={styles.settingSelect}
            style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', color: 'var(--white,#fff)' }}
            value={value.value || ''}
            onChange={(e) => onField({ value: Number(e.target.value) })}
          >
            <option value="">%</option>
            {Array.from({ length: 100 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}%</option>
            ))}
          </select>
        ) : (
          <div style={{ position: 'relative', width: '100%' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted,#8a8aa0)', fontSize: '.82rem', pointerEvents: 'none' }}>
              {currencySymbol}
            </span>
            <input
              type="number"
              onWheel={(e) => e.currentTarget.blur()}
              min={1}
              className={`${styles.settingNumber} gdcNoSpin`}
              style={{ width: '100%', boxSizing: 'border-box', textAlign: 'left', paddingLeft: 22, color: 'var(--white,#fff)' }}
              value={value.value ? value.value : ''}
              placeholder="0"
              onChange={(e) => onField({ value: e.target.value === '' ? 0 : Number(e.target.value) })}
            />
          </div>
        )}
      </div>
      <div style={{ ...fieldWrap, flex: '0 0 150px' }}>
        <label style={labelStyle}>Expires (optional)</label>
        <input
          type="date"
          className={`${styles.settingNumber} gdcDateWhite`}
          style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box', height: 38, fontSize: '.78rem' }}
          onClick={openPicker}
          value={value.expires || ''}
          onChange={(e) => onField({ expires: e.target.value || null })}
        />
      </div>
    </>
  );
}

const btnPrimary: React.CSSProperties = {
  background: 'var(--neon, #00e0a4)', color: '#06231b', border: 'none',
  borderRadius: 6, padding: '.5rem .9rem', fontSize: '.8rem', fontWeight: 700, cursor: 'pointer',
};
const btnOutline: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border, rgba(255,255,255,.25))',
  color: 'var(--white, #fff)', borderRadius: 6, padding: '.45rem .8rem', fontSize: '.78rem', cursor: 'pointer',
};
const btnDanger: React.CSSProperties = {
  background: 'transparent', border: '1px solid rgba(255,80,80,.4)',
  color: '#ff6b6b', borderRadius: 6, padding: '.45rem .8rem', fontSize: '.78rem', cursor: 'pointer',
};

export default function DiscountsSection({ promoCodes, sale, saleHistory = [], exclusions = [], currencySymbol = '$', onChange }: Props) {
  const [draft, setDraft] = useState<PromoCode | null>(null);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editBuf, setEditBuf] = useState<PromoCode | null>(null);
  const [error, setError] = useState('');
  // Which code row is expanded to show its usage.
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  // Redemptions grouped by uppercased code, pulled from the DJ's bookings.
  const [usageByCode, setUsageByCode] = useState<Record<string, Redemption[]>>({});
  // Bookings that used the automatic sale (a discount was applied but no code).
  const [saleUsage, setSaleUsage] = useState<Redemption[]>([]);
  const [saleOpen, setSaleOpen] = useState(false);
  // Which past-sale row is expanded to show who used it.
  const [expandedPast, setExpandedPast] = useState<number | null>(null);
  // Which promo code is pending a delete confirmation.
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  // The date + which discounts to block, for the "add exclusion" row.
  const [newExclDate, setNewExclDate] = useState('');
  const [newExclSale, setNewExclSale] = useState(true);
  const [newExclCodes, setNewExclCodes] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('bookings')
        .select('id, requester_name, event_date, created_at, discount_code, discount_label, discount_amount, original_rate, currency')
        .eq('dj_id', user.id)
        .not('discount_amount', 'is', null)
        .order('created_at', { ascending: false });
      if (!mounted) return;
      const map: Record<string, Redemption[]> = {};
      const sales: Redemption[] = [];
      ((data as unknown as Redemption[]) || []).forEach((r) => {
        const key = (r.discount_code || '').trim().toUpperCase();
        if (key) {
          (map[key] = map[key] || []).push(r);
        } else if ((r.discount_amount || 0) > 0) {
          sales.push(r); // sale redemption (no code)
        }
      });
      setUsageByCode(map);
      setSaleUsage(sales);
    })();
    return () => { mounted = false; };
  }, []);

  function updateSale(p: Partial<Sale>) {
    onChange({ sale: { ...sale, ...p } });
  }

  // End the running sale right now. If it had already started, archive it with
  // today as the end date; if it was only scheduled (start still in the future),
  // just clear it — there's nothing to record. Either way the form empties for
  // a fresh sale.
  function endSaleNow() {
    const now = Date.now();
    const started = !sale.starts || new Date(`${sale.starts}T00:00:00`).getTime() <= now;
    if (started) {
      const ended: Sale = { ...sale, ends: todayStr, active: false };
      onChange({ sale: {}, sale_history: [ended, ...saleHistory] });
    } else {
      onChange({ sale: {} });
    }
    setSaleOpen(false);
  }

  // Today as an ISO date (YYYY-MM-DD) — used as the min for a new sale's start
  // date so it can't begin in the past.
  const todayStr = (() => {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  })();

  // Auto-archive: once a sale's end date has passed, move it into sale_history
  // and clear the live sale so the DJ can set up a fresh one. Runs whenever the
  // sale changes; after archiving the live sale is empty so it won't loop.
  useEffect(() => {
    const pct = sale.percent ?? 0;
    if (pct <= 0 || !sale.ends) return;
    const ended = new Date(`${sale.ends}T23:59:59`).getTime() < Date.now();
    if (!ended) return;
    onChange({ sale: {}, sale_history: [{ ...sale }, ...saleHistory] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale.percent, sale.ends, sale.starts]);

  function activateDraft() {
    if (!draft) return;
    const code = (draft.code || '').trim();
    if (!code) { setError('Enter a code.'); return; }
    if (!draft.value || draft.value <= 0) { setError('Enter a discount value.'); return; }
    if (promoCodes.some((c) => (c.code || '').trim().toUpperCase() === code.toUpperCase())) {
      setError('That code already exists.'); return;
    }
    onChange({ promo_codes: [...promoCodes, { ...draft, code: code.toUpperCase(), active: true, uses: draft.uses || 0 }] });
    setDraft(null);
    setError('');
  }

  function saveEdit() {
    if (editIndex == null || !editBuf) return;
    const code = (editBuf.code || '').trim();
    if (!code) { setError('Enter a code.'); return; }
    onChange({ promo_codes: promoCodes.map((c, i) => (i === editIndex ? { ...editBuf, code: code.toUpperCase() } : c)) });
    setEditIndex(null);
    setEditBuf(null);
    setError('');
  }

  // ── Date exclusions ─────────────────────────────────────────────
  function addExclusion() {
    if (!newExclDate) return;
    if (exclusions.some((e) => e.date === newExclDate)) { setNewExclDate(''); return; }
    const next = [...exclusions, { date: newExclDate, sale: newExclSale, codes: newExclCodes }]
      .sort((a, b) => a.date.localeCompare(b.date));
    onChange({ exclusions: next });
    // Clear the date so the picker is ready for the next one; keep the toggles.
    setNewExclDate('');
  }
  function updateExclusion(i: number, patch: Partial<DiscountExclusion>) {
    onChange({ exclusions: exclusions.map((e, idx) => (idx === i ? { ...e, ...patch } : e)) });
  }
  function removeExclusion(i: number) {
    onChange({ exclusions: exclusions.filter((_, idx) => idx !== i) });
  }

  function setActive(i: number, active: boolean) {
    onChange({ promo_codes: promoCodes.map((c, idx) => (idx === i ? { ...c, active } : c)) });
  }
  function removeCode(i: number) {
    onChange({ promo_codes: promoCodes.filter((_, idx) => idx !== i) });
    if (editIndex === i) { setEditIndex(null); setEditBuf(null); }
  }

  function valueLabel(c: PromoCode): string {
    return c.type === 'percent' ? `${c.value}% off` : `${currencySymbol}${c.value} off`;
  }

  // Bookings that used the CURRENT sale — i.e. sale-discounted bookings that
  // landed inside this sale's window. An empty/new sale (no percent) has none,
  // so the "Used" cell reads 0 instead of the all-time total.
  const currentSaleUsage = (() => {
    if ((sale.percent ?? 0) <= 0) return [];
    const startMs = sale.starts ? new Date(`${sale.starts}T00:00:00`).getTime()
      : (sale.started_at ? new Date(sale.started_at).getTime() : null);
    const endMs = sale.ends ? new Date(`${sale.ends}T23:59:59`).getTime() : null;
    return saleUsage.filter((r) => {
      if (!r.created_at) return false;
      const t = new Date(r.created_at).getTime();
      if (startMs != null && t < startMs) return false;
      if (endMs != null && t > endMs) return false;
      return true;
    });
  })();

  // Is a sale actually running right now (percent set + inside its window)? Drives
  // the "Sale live" badge in the banner.
  const saleLiveNow = (() => {
    const pct = sale.percent ?? 0;
    if (pct <= 0) return false;
    const now = new Date();
    if (sale.starts && new Date(`${sale.starts}T00:00:00`).getTime() > now.getTime()) return false;
    if (sale.ends && new Date(`${sale.ends}T23:59:59`).getTime() < now.getTime()) return false;
    return true;
  })();

  return (
    <div className={styles.sectionCard}>
      {/* Banner — gradient top accent, icon chip, title + subtitle, and a live
          badge that only appears while a sale is actually running. */}
      <div
        style={{
          position: 'relative', display: 'flex', alignItems: 'center', gap: 16,
          padding: '20px 26px', borderBottom: '1px solid rgba(255,255,255,.14)',
          background: 'linear-gradient(180deg,rgba(34,227,173,.10),rgba(34,227,173,.02))',
        }}
      >
        <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: GRAD }} />
        <span
          style={{
            width: 44, height: 44, borderRadius: 12, background: GRAD, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 22px -8px rgba(34,227,173,.7)',
          }}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#04241b" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
            <line x1="7" y1="7" x2="7.01" y2="7" />
          </svg>
        </span>
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.55rem', letterSpacing: '.04em', lineHeight: 1, color: '#fff' }}>
            Discounts &amp; Promo Codes
          </div>
          <div style={{ marginTop: 4, fontSize: '.78rem', color: 'var(--muted,#8b8da3)' }}>
            Run sales and hand out private codes to win more bookings.
          </div>
        </div>
        {saleLiveNow && (
          <span
            style={{
              marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7,
              fontSize: '.72rem', fontWeight: 700, color: '#04241b', background: GRAD,
              padding: '7px 14px', borderRadius: 999,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#04241b' }} /> Sale live
          </span>
        )}
      </div>
      <div className={`${styles.sectionBody} ${styles.settingsBody}`}>

        {/* ── Automatic sale ─────────────────────────────────────── */}
        <style>{`
          .gdcDateWhite::-webkit-datetime-edit,
          .gdcDateWhite::-webkit-datetime-edit-text,
          .gdcDateWhite::-webkit-datetime-edit-month-field,
          .gdcDateWhite::-webkit-datetime-edit-day-field,
          .gdcDateWhite::-webkit-datetime-edit-year-field { color: #fff; }
          .gdcDateWhite { color: #fff; }
          @keyframes gdcLiveDot {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: .25; transform: scale(.55); }
          }
          .gdcLiveDot { animation: gdcLiveDot 1.1s ease-in-out infinite; }
          input.gdcNoSpin::-webkit-outer-spin-button,
          input.gdcNoSpin::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
          input.gdcNoSpin { -moz-appearance: textfield; appearance: textfield; }
        `}</style>

        <div style={blockStyle}>
        <SecHeader label="Run a sale" icon={iconSale} />
        <div className={styles.settingHint} style={{ marginBottom: '.9rem' }}>
          A site-wide % off applied automatically to every quote. Set a window and it switches
          itself on and off — a sale and a promo code don&apos;t stack, the bigger discount wins.
        </div>

        {/* One row: percent · start date · end date · used · status. The sale's
            on/off state is decided by the dates, so Status is a read-out
            (Scheduled → Active → Ended), not a button. */}
        {(() => {
          const pct = sale.percent ?? 0;
          let statLabel = 'Inactive';
          let tone: 'on' | 'sched' | 'off' = 'off';
          if (pct > 0) {
            const now = new Date();
            const startFuture = !!sale.starts && new Date(`${sale.starts}T00:00:00`).getTime() > now.getTime();
            const ended = !!sale.ends && new Date(`${sale.ends}T23:59:59`).getTime() < now.getTime();
            if (startFuture) { statLabel = 'Scheduled'; tone = 'sched'; }
            else if (ended) { statLabel = 'Ended'; tone = 'off'; }
            else { statLabel = 'Active'; tone = 'on'; }
          }
          const pillStyle: React.CSSProperties =
            tone === 'on'
              ? { color: '#04241b', background: 'linear-gradient(100deg,#22e3ad,#31d0ff)', boxShadow: '0 6px 20px -6px rgba(34,227,173,.7)' }
              : tone === 'sched'
                ? { color: '#3a2a00', background: '#ffcf6b' }
                : { color: 'var(--muted,#8a8aa0)', background: 'rgba(255,255,255,.07)' };
          const dotColor = tone === 'on' ? '#04241b' : tone === 'sched' ? '#3a2a00' : 'var(--muted,#8a8aa0)';
          return (
            <>
            <div style={{ display: 'flex', flexWrap: 'wrap', rowGap: '.9rem', columnGap: '1.1rem', alignItems: 'flex-end' }}>
              <div style={{ ...fieldWrap, flex: '0 0 96px' }}>
                <label style={labelStyle}>Percent off</label>
                <select
                  className={styles.settingSelect}
                  style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', height: 34, fontSize: '.78rem', padding: '0 8px', color: 'var(--white,#fff)' }}
                  value={sale.percent || ''}
                  onChange={(e) => {
                    const v = e.target.value === '' ? 0 : Number(e.target.value);
                    updateSale(v > 0
                      ? { percent: v, active: true, started_at: sale.started_at || new Date().toISOString() }
                      : { percent: 0, active: false });
                  }}
                >
                  <option value="">%</option>
                  {Array.from({ length: 100 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n}%</option>
                  ))}
                </select>
              </div>
              <div style={{ ...fieldWrap, flex: '0 0 138px' }}>
                <label style={labelStyle}>Start date</label>
                <input
                  type="date" className={`${styles.settingNumber} gdcDateWhite`} min={todayStr}
                  style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box', height: 34, fontSize: '.78rem', padding: '0 8px' }} onClick={openPicker}
                  value={sale.starts || ''} onChange={(e) => updateSale({ starts: e.target.value || null })}
                />
              </div>
              <div style={{ ...fieldWrap, flex: '0 0 138px' }}>
                <label style={labelStyle}>End date</label>
                <input
                  type="date" className={`${styles.settingNumber} gdcDateWhite`}
                  style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box', height: 34, fontSize: '.78rem', padding: '0 8px' }} onClick={openPicker}
                  value={sale.ends || ''} onChange={(e) => updateSale({ ends: e.target.value || null })}
                />
              </div>
              <div style={{ ...fieldWrap, flex: '0 0 auto' }}>
                <label style={labelStyle}>Used</label>
                {currentSaleUsage.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setSaleOpen((o) => !o)}
                    style={{ ...usedCellValue, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--neon,#00e0a4)' }}
                  >
                    {currentSaleUsage.length}
                    <span style={{ fontSize: '.7rem' }}>{saleOpen ? '▲' : '▼'}</span>
                  </button>
                ) : (
                  <span style={usedCellValue}>0</span>
                )}
              </div>
              <div style={{ ...fieldWrap, flex: '0 0 auto', marginLeft: 'auto', alignItems: 'center', textAlign: 'center' }}>
                <label style={labelStyle}>Status</label>
                <span
                  style={{
                    height: 30, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 13px',
                    borderRadius: 999, fontSize: '.68rem', fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase',
                    ...pillStyle,
                  }}
                >
                  <span
                    className={tone === 'on' ? 'gdcLiveDot' : undefined}
                    style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor }}
                  />
                  {statLabel}
                </span>
              </div>
            </div>
            {/* End-now escape hatch — a sale with no end date (or a future one)
                has no other way to stop, so let the DJ end it on the spot. */}
            {pct > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '.7rem' }}>
                <button
                  type="button"
                  onClick={endSaleNow}
                  style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: '#ff8f8f', fontSize: '.76rem', fontWeight: 600, textDecoration: 'underline' }}
                >
                  {tone === 'sched' ? 'Cancel scheduled sale' : 'End sale now'}
                </button>
              </div>
            )}
            </>
          );
        })()}

        {/* Sale usage detail — who booked during the sale window. The count that
            toggles this lives in the "Used" cell of the row above. */}
        {currentSaleUsage.length > 0 && saleOpen && (
          <div style={{ padding: '0 0 1rem' }}>
            <div style={{ marginBottom: '.4rem', fontSize: '.82rem', display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={metaLabel}>Sale window</span>
              <span style={{ color: 'var(--white,#fff)' }}>
                {sale.starts ? fmtDate(sale.starts) : (sale.started_at ? fmtDate(sale.started_at) : '—')}
                {' – '}
                {sale.active
                  ? (sale.ends ? fmtDate(sale.ends) : 'ongoing')
                  : (sale.ends ? fmtDate(sale.ends) : 'ended')}
              </span>
            </div>
            {(
              <div style={{ marginTop: '.6rem', borderTop: '1px solid var(--border, rgba(255,255,255,.1))', paddingTop: '.6rem' }}>
                {currentSaleUsage.map((r, ri) => (
                  <div
                    key={ri}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem', padding: '.4rem 0', fontSize: '.82rem' }}
                  >
                    <span style={{ color: 'var(--white,#fff)' }}>
                      {r.requester_name || 'Someone'}
                      <span style={{ color: 'var(--muted,#8a8aa0)' }}>
                        {' '}· booked {fmtDate(r.created_at)}
                        {r.discount_label ? ` · ${r.discount_label}` : ''}
                      </span>
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ color: 'var(--neon,#00e0a4)' }}>
                        saved {currencySymbol}{Number(r.discount_amount || 0).toLocaleString()}
                      </span>
                      <ViewBookingLink id={r.id} eventDate={r.event_date} />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Past sales — ended sales archived automatically. Read-only history so
            the DJ can see what they ran; the "Used" count is the bookings that
            landed inside each sale's window. */}
        {saleHistory.length > 0 && (
          <div style={{ marginTop: '1.1rem', borderTop: '1px solid var(--border, rgba(255,255,255,.1))', paddingTop: '.9rem' }}>
            <div style={{ ...labelStyle, marginBottom: '.6rem' }}>Past sales</div>
            {saleHistory.map((h, hi) => {
              const startMs = h.starts ? new Date(`${h.starts}T00:00:00`).getTime() : (h.started_at ? new Date(h.started_at).getTime() : null);
              const endMs = h.ends ? new Date(`${h.ends}T23:59:59`).getTime() : null;
              const people = saleUsage.filter((r) => {
                if (!r.created_at) return false;
                const t = new Date(r.created_at).getTime();
                if (startMs != null && t < startMs) return false;
                if (endMs != null && t > endMs) return false;
                return true;
              });
              const open = expandedPast === hi;
              const clickable = people.length > 0;
              return (
                <div
                  key={hi}
                  style={{
                    marginBottom: '.5rem', borderRadius: 10,
                    border: `1px solid ${open ? 'var(--neon, #00e0a4)' : 'var(--border, rgba(255,255,255,.12))'}`,
                    background: 'rgba(255,255,255,.02)', overflow: 'hidden',
                  }}
                >
                  {/* Header row — click to open the panel of people who used it. */}
                  <div
                    role={clickable ? 'button' : undefined}
                    onClick={clickable ? () => setExpandedPast(open ? null : hi) : undefined}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
                      padding: '.7rem .9rem', cursor: clickable ? 'pointer' : 'default',
                    }}
                  >
                    <span style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: '1rem', color: 'var(--white,#fff)' }}>
                      {h.percent ?? 0}% off
                    </span>
                    <span
                      style={{
                        fontSize: '.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em',
                        padding: '2px 9px', borderRadius: 999, color: 'var(--muted,#8a8aa0)', background: 'rgba(255,255,255,.07)',
                      }}
                    >
                      Ended
                    </span>
                    <span style={{ fontSize: '.82rem', color: 'var(--muted,#8a8aa0)' }}>
                      {startMs != null ? fmtDate(h.starts || h.started_at || null) : '—'}
                      {' – '}
                      {h.ends ? fmtDate(h.ends) : '—'}
                    </span>
                    <span
                      style={{
                        marginLeft: 'auto', fontSize: '.82rem',
                        color: clickable ? 'var(--neon,#00e0a4)' : 'var(--white,#fff)',
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                      }}
                    >
                      <span style={metaLabel}>Used</span>{people.length}
                      {clickable && <span style={{ fontSize: '.7rem' }}>{open ? '▲' : '▼'}</span>}
                    </span>
                  </div>

                  {/* Expanded panel — the people who booked during this sale. */}
                  {open && people.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--border, rgba(255,255,255,.12))', padding: '.6rem .9rem .8rem' }}>
                      {people.map((r, ri) => (
                        <div
                          key={ri}
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem', padding: '.4rem 0', fontSize: '.82rem' }}
                        >
                          <span style={{ color: 'var(--white,#fff)' }}>
                            {r.requester_name || 'Someone'}
                            <span style={{ color: 'var(--muted,#8a8aa0)' }}>
                              {' '}· booked {fmtDate(r.created_at)}
                              {r.discount_label ? ` · ${r.discount_label}` : ''}
                            </span>
                          </span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ color: 'var(--neon,#00e0a4)' }}>
                              saved {currencySymbol}{Number(r.discount_amount || 0).toLocaleString()}
                            </span>
                            <ViewBookingLink id={r.id} eventDate={r.event_date} />
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </div>{/* end Run a sale block */}

        {/* ── Promo codes ────────────────────────────────────────── */}
        <div style={blockStyle}>
        <SecHeader label="Promo codes" icon={iconPromo} />
        <div className={styles.settingHint} style={{ marginBottom: '.9rem' }}>
          Private codes you hand out — referrals, socials, repeat clients. Build one, switch it on,
          and it drops into your list. Your public price stays the same.
        </div>

        {error && <div style={{ color: '#ff6b6b', fontSize: '.8rem', marginBottom: '.6rem' }}>{error}</div>}

        {/* Draft form */}
        {draft && (
          <div style={{ border: '1px solid var(--neon, #00e0a4)', borderRadius: 10, padding: '.85rem', marginBottom: '.9rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.75rem', alignItems: 'flex-end' }}>
              <CodeFields value={draft} onField={(p) => setDraft({ ...draft, ...p })} currencySymbol={currencySymbol} />
            </div>
            <div style={{ display: 'flex', gap: '.6rem', marginTop: '.85rem', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { setDraft(null); setError(''); }} style={btnOutline}>Cancel</button>
              <button type="button" onClick={activateDraft} style={btnPrimary}>Activate</button>
            </div>
          </div>
        )}

        {!draft && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
          <button
            type="button"
            onClick={() => { setDraft(emptyDraft()); setError(''); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: GRAD, color: '#04241b', border: 'none',
              borderRadius: 11, padding: '.7rem 1.1rem', fontSize: '.85rem', fontWeight: 700,
              cursor: 'pointer', boxShadow: '0 8px 22px -8px rgba(34,227,173,.7)',
            }}
          >
            <span style={{ fontSize: '1.05rem', fontWeight: 700, lineHeight: 1 }}>+</span> Add promo code
          </button>
          </div>
        )}

        {/* Codes list (active + deactivated = history) */}
        {promoCodes.length === 0 && !draft && (
          <div style={{ color: 'var(--muted, #8a8aa0)', fontSize: '.85rem' }}>No promo codes yet.</div>
        )}

        {promoCodes.map((c, i) => {
          const isEditing = editIndex === i;
          const off = c.active === false;
          // Past its expiry date? An expired code can't apply to a booking even
          // if it's "active", so we surface it distinctly and offer Renew.
          const expired = !!c.expires && new Date(`${c.expires}T23:59:59`).getTime() < Date.now();
          if (isEditing && editBuf) {
            return (
              <div key={i} style={{ border: '1px solid var(--neon, #00e0a4)', borderRadius: 10, padding: '.85rem', marginBottom: '.75rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.75rem', alignItems: 'flex-end' }}>
                  <CodeFields value={editBuf} onField={(p) => setEditBuf({ ...editBuf, ...p })} currencySymbol={currencySymbol} />
                </div>
                <div style={{ display: 'flex', gap: '.6rem', marginTop: '.85rem', justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => { setEditIndex(null); setEditBuf(null); setError(''); }} style={btnOutline}>Cancel</button>
                  <button type="button" onClick={saveEdit} style={btnPrimary}>Save</button>
                </div>
              </div>
            );
          }
          return (
            <div
              key={i}
              style={{
                padding: '.85rem 1rem',
                marginBottom: '.6rem',
                border: '1px solid var(--border, rgba(255,255,255,.14))',
                borderRadius: 10,
                background: 'rgba(255,255,255,.02)',
                opacity: (off || expired) ? 0.6 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.7rem', minWidth: 0, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, letterSpacing: '.04em', fontSize: '1rem', color: 'var(--white,#fff)' }}>
                    {(c.code || '').toUpperCase()}
                  </span>
                  <span
                    style={{
                      fontSize: '.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em',
                      padding: '2px 8px', borderRadius: 999,
                      color: expired ? '#3a2a00' : off ? 'var(--muted,#8a8aa0)' : '#06231b',
                      background: expired ? '#ffcf6b' : off ? 'rgba(255,255,255,.08)' : 'var(--neon,#00e0a4)',
                    }}
                  >
                    {expired ? 'Expired' : off ? 'Inactive' : 'Active'}
                  </span>
                  {/* Meta inline with the code: discount · expires · used. */}
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '1.1rem', flexWrap: 'wrap', marginLeft: '.4rem', fontSize: '.82rem', color: 'var(--white,#fff)' }}>
                    <span><span style={metaLabel}>Discount</span> {valueLabel(c)}</span>
                    <span style={{ color: expired ? '#ffb020' : undefined }}><span style={metaLabel}>Expires</span> {c.expires ? new Date(`${c.expires}T00:00:00`).toLocaleDateString() : 'Never'}{expired ? ' · expired' : ''}</span>
                    {(() => {
                      const key = (c.code || '').trim().toUpperCase();
                      const uses = usageByCode[key] || [];
                      const open = expandedCode === key;
                      if (uses.length === 0) {
                        return <span><span style={metaLabel}>Used</span> 0</span>;
                      }
                      return (
                        <button
                          type="button"
                          onClick={() => setExpandedCode(open ? null : key)}
                          style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--neon,#00e0a4)', fontSize: '.82rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          <span style={metaLabel}>Used</span> {uses.length}
                          <span style={{ fontSize: '.7rem' }}>{open ? '▲' : '▼'}</span>
                        </button>
                      );
                    })()}
                  </span>
                </div>
                {confirmDel === i ? (
                  <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '.8rem', color: 'var(--white,#fff)' }}>Delete this code?</span>
                    <button type="button" onClick={() => { removeCode(i); setConfirmDel(null); }} style={btnDanger}>Delete</button>
                    <button type="button" onClick={() => setConfirmDel(null)} style={btnOutline}>Cancel</button>
                  </div>
                ) : (
                <div style={{ display: 'flex', gap: '.5rem' }}>
                  <button type="button" onClick={() => { setEditIndex(i); setEditBuf({ ...c }); setError(''); }} style={btnOutline}>Edit</button>
                  {expired ? (
                    // Renew: reopen the editor with the stale expiry cleared and the
                    // code re-enabled, so the DJ picks a fresh date (or leaves it
                    // "Never") instead of ending up "active but expired".
                    <button type="button" onClick={() => { setEditIndex(i); setEditBuf({ ...c, active: true, expires: null }); setError(''); }} style={btnOutline}>Renew</button>
                  ) : off ? (
                    <button type="button" onClick={() => setActive(i, true)} style={btnOutline}>Reactivate</button>
                  ) : (
                    <button type="button" onClick={() => setActive(i, false)} style={btnOutline}>Deactivate</button>
                  )}
                  <button type="button" onClick={() => setConfirmDel(i)} style={btnDanger}>Delete</button>
                </div>
                )}
              </div>

              {/* Unfolded usage — who booked with this code and when. */}
              {expandedCode === (c.code || '').trim().toUpperCase() &&
                (usageByCode[(c.code || '').trim().toUpperCase()] || []).length > 0 && (
                <div style={{ marginTop: '.7rem', borderTop: '1px solid var(--border, rgba(255,255,255,.1))', paddingTop: '.7rem' }}>
                  {(usageByCode[(c.code || '').trim().toUpperCase()] || []).map((r, ri) => (
                    <div
                      key={ri}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        flexWrap: 'wrap', gap: '.5rem', padding: '.4rem 0', fontSize: '.82rem',
                      }}
                    >
                      <span style={{ color: 'var(--white,#fff)' }}>
                        {r.requester_name || 'Someone'}
                        <span style={{ color: 'var(--muted,#8a8aa0)' }}> · booked {fmtDate(r.created_at)}</span>
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ color: 'var(--neon,#00e0a4)' }}>
                          saved {currencySymbol}{Number(r.discount_amount || 0).toLocaleString()}
                        </span>
                        <ViewBookingLink id={r.id} eventDate={r.event_date} />
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        </div>{/* end Promo codes block */}

        {/* ── Exclusions ─────────────────────────────────────────── */}
        <div style={blockStyle}>
        <SecHeader label="Exclusions" icon={iconExcl} />
        <div className={styles.settingHint} style={{ marginBottom: '.9rem' }}>
          Block discounts on specific dates. Pick a date, then choose whether to turn off the
          site sale, promo codes, or both for that day — bookings on excluded dates pay full price.
        </div>

        {/* Add row: pick a date, choose what to block, hit Confirm. The date box
            clears on confirm so it's ready for the next date. */}
        <div style={{ display: 'flex', gap: '1.2rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1.1rem' }}>
          <div style={{ ...fieldWrap, flex: '0 0 158px' }}>
            <label style={labelStyle}>Add a date</label>
            <input
              type="date" className={`${styles.settingNumber} gdcDateWhite`} min={todayStr}
              style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box', height: 38, fontSize: '.78rem' }} onClick={openPicker}
              value={newExclDate}
              onChange={(e) => setNewExclDate(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExclusion(); } }}
            />
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 38, fontSize: '.82rem', color: 'var(--white,#fff)', cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 15, height: 15, accentColor: 'var(--neon,#00e0a4)', cursor: 'pointer' }}
              checked={newExclSale} onChange={(e) => setNewExclSale(e.target.checked)} />
            Block site sale
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 38, fontSize: '.82rem', color: 'var(--white,#fff)', cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 15, height: 15, accentColor: 'var(--neon,#00e0a4)', cursor: 'pointer' }}
              checked={newExclCodes} onChange={(e) => setNewExclCodes(e.target.checked)} />
            Block promo codes
          </label>
          <button
            type="button"
            onClick={addExclusion}
            disabled={!newExclDate || (!newExclSale && !newExclCodes)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, height: 38, marginLeft: 'auto',
              background: (newExclDate && (newExclSale || newExclCodes)) ? GRAD : 'rgba(255,255,255,.06)',
              color: (newExclDate && (newExclSale || newExclCodes)) ? '#04241b' : 'var(--muted,#8a8aa0)',
              border: 'none', borderRadius: 10, padding: '0 18px', fontSize: '.82rem', fontWeight: 700,
              cursor: (newExclDate && (newExclSale || newExclCodes)) ? 'pointer' : 'not-allowed',
              boxShadow: (newExclDate && (newExclSale || newExclCodes)) ? '0 8px 22px -8px rgba(34,227,173,.7)' : 'none',
            }}
          >
            Confirm
          </button>
        </div>

        {exclusions.length === 0 ? (
          <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.85rem' }}>No excluded dates.</div>
        ) : (
          exclusions.map((ex, i) => (
            <div
              key={ex.date}
              style={{
                display: 'flex', alignItems: 'center', gap: '1.2rem', flexWrap: 'wrap',
                padding: '.7rem .9rem', marginBottom: '.5rem', borderRadius: 10,
                border: '1px solid var(--border, rgba(255,255,255,.12))', background: 'rgba(255,255,255,.02)',
              }}
            >
              <span style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: '.9rem', color: 'var(--white,#fff)', minWidth: 96 }}>
                {new Date(`${ex.date}T00:00:00`).toLocaleDateString()}
              </span>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '.82rem', color: 'var(--white,#fff)', cursor: 'pointer' }}>
                <input type="checkbox" style={{ width: 15, height: 15, accentColor: 'var(--neon,#00e0a4)', cursor: 'pointer' }}
                  checked={!!ex.sale} onChange={(e) => updateExclusion(i, { sale: e.target.checked })} />
                Block site sale
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '.82rem', color: 'var(--white,#fff)', cursor: 'pointer' }}>
                <input type="checkbox" style={{ width: 15, height: 15, accentColor: 'var(--neon,#00e0a4)', cursor: 'pointer' }}
                  checked={!!ex.codes} onChange={(e) => updateExclusion(i, { codes: e.target.checked })} />
                Block promo codes
              </label>
              <button
                type="button"
                onClick={() => removeExclusion(i)}
                aria-label="Remove excluded date"
                style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#ff8f8f', fontSize: '1.1rem', lineHeight: 1, cursor: 'pointer', padding: '0 .2rem' }}
              >
                &times;
              </button>
            </div>
          ))
        )}
        </div>{/* end Exclusions block */}
      </div>
    </div>
  );
}
