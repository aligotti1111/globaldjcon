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

import { useEffect, useRef, useState } from 'react';
import { useConfirm } from '@/components/ConfirmModal';
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
// Full-width header band for each stacked section card — mirrors the Payments
// Accepted page's section headers: a tinted top strip with a centred icon chip
// + title that spans the card edge-to-edge.
function SecHeader({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <div
      className={styles.sectionHeader}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}
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
      <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: '.04em', textTransform: 'uppercase', color: '#fff' }}>{label}</span>
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
  // Match the date fields' height (34) so the number sits on the same line as
  // the values beside it — the row aligns on flex-end, so a taller cell here
  // floated the "0" above the dates and the status pill.
  height: 34, display: 'inline-flex', alignItems: 'center', gap: 4,
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

function emptyDraft(): PromoCode {
  return { code: '', type: 'percent', value: 0, active: true, expires: null, maxUses: null, uses: 0 };
}

// One box style for every field in the code form so Code Name, Type, Percent/
// Amount and Expires all render at the same height (selects and inputs would
// otherwise size differently).
const fieldBox: React.CSSProperties = { height: 38, boxSizing: 'border-box', fontSize: '.78rem' };

// Stable, cross-browser date field. We render our OWN box (a calendar icon plus
// either the chosen date or a placeholder) and keep the real <input type="date">
// invisible — used only to hold the value and open the system picker. This dodges
// every native-rendering quirk (e.g. Safari showing today's date as a greyed
// "placeholder" on an empty field).
function DateField({
  value, onChange, min, placeholder = 'Select', height = 38, fontSize = '.78rem',
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  min?: string;
  placeholder?: string;
  height?: number;
  fontSize?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const openPickerNow = () => {
    const el = ref.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!el) return;
    try { el.showPicker?.(); } catch { el.focus(); }
  };
  const label = value ? new Date(`${value}T00:00:00`).toLocaleDateString() : placeholder;
  return (
    <div
      style={{
        position: 'relative', width: '100%', height, boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px',
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6,
        cursor: 'pointer', fontSize, fontFamily: "'Space Mono', monospace",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8a8aa0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true">
        <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
      </svg>
      <span style={{ color: value ? 'var(--white,#fff)' : 'var(--muted,#8a8aa0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {/* The REAL control: a transparent date input covering the whole box. It's
          the actual thing clicked and picked, so the browser commits the choice
          normally; our icon + label show through beneath it. */}
      <input
        ref={ref}
        type="date"
        min={min}
        value={value || ''}
        onClick={openPickerNow}
        onChange={(e) => { onChange(e.target.value || null); e.currentTarget.blur(); }}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 0, padding: 0, margin: 0, colorScheme: 'dark' }}
      />
    </div>
  );
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
      <div style={{ ...fieldWrap, flex: '0 0 150px' }}>
        <label style={labelStyle}>Code Name</label>
        <input
          type="text"
          className={styles.settingNumber}
          value={value.code}
          onChange={(e) => onField({ code: e.target.value.toUpperCase() })}
          style={{ ...fieldBox, textTransform: 'uppercase', color: 'var(--white,#fff)' }}
        />
      </div>
      <div style={{ ...fieldWrap, flex: '0 0 120px' }}>
        <label style={{ ...labelStyle, whiteSpace: 'nowrap' }}>Type of discount</label>
        <select
          className={styles.settingSelect}
          style={{ ...fieldBox, width: '100%', minWidth: 0, color: 'var(--white,#fff)' }}
          value={value.type}
          onChange={(e) => onField({ type: e.target.value as 'percent' | 'flat' })}
        >
          <option value="percent">% OFF</option>
          <option value="flat">{currencySymbol} OFF</option>
        </select>
      </div>
      <div style={{ ...fieldWrap, flex: '0 0 110px' }}>
        <label style={labelStyle}>{value.type === 'percent' ? 'Percent' : 'Amount'}</label>
        {value.type === 'percent' ? (
          <select
            className={styles.settingSelect}
            style={{ ...fieldBox, width: '100%', minWidth: 0, color: 'var(--white,#fff)' }}
            value={value.value || ''}
            onChange={(e) => onField({ value: Number(e.target.value) })}
          >
            <option value="">%</option>
            {Array.from({ length: 99 }, (_, i) => i + 1).map((n) => (
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
              style={{ ...fieldBox, width: '100%', textAlign: 'left', paddingLeft: 22, color: 'var(--white,#fff)' }}
              value={value.value ? value.value : ''}
              placeholder="0"
              onChange={(e) => onField({ value: e.target.value === '' ? 0 : Number(e.target.value) })}
            />
          </div>
        )}
      </div>
      <div style={{ ...fieldWrap, flex: '0 0 128px' }}>
        <label style={{ ...labelStyle, whiteSpace: 'nowrap' }}>Expires (optional)</label>
        <DateField value={value.expires || null} onChange={(v) => onField({ expires: v })} />
      </div>
      <div style={{ ...fieldWrap, flex: '0 0 112px' }}>
        <label style={{ ...labelStyle, whiteSpace: 'nowrap' }}>Max uses</label>
        <input
          type="number"
          onWheel={(e) => e.currentTarget.blur()}
          min={1}
          step={1}
          className={`${styles.settingNumber} gdcNoSpin`}
          style={{ ...fieldBox, width: '100%', color: 'var(--white,#fff)' }}
          value={value.maxUses != null ? value.maxUses : ''}
          placeholder="Unlimited"
          onChange={(e) => {
            // Blank = no cap. Otherwise a whole number ≥ 1.
            const raw = e.target.value;
            if (raw === '') { onField({ maxUses: null }); return; }
            const n = Math.floor(Number(raw));
            onField({ maxUses: Number.isFinite(n) && n >= 1 ? n : null });
          }}
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
  // The date + which discounts to block, for the "add exclusion" row.
  const [newExclDate, setNewExclDate] = useState('');
  const [newExclSale, setNewExclSale] = useState(true);
  const [newExclCodes, setNewExclCodes] = useState(true);
  // Site-uniform yes/no popup (used for the "remove excluded date" confirm).
  const { confirm, confirmDialog } = useConfirm();
  // Inline message for the add-exclusion row (e.g. duplicate date).
  const [exclErr, setExclErr] = useState('');
  // Which of the three options is open. Mirrors the Payments Accepted page: a
  // stacked list of tabs on the left, the open one's panel on the right.
  const [activeDisc, setActiveDisc] = useState<'sale' | 'promo' | 'exclusions'>('sale');

  // On narrow screens the sale row's flex-wrap fields land in a cramped,
  // uneven arrangement; below this breakpoint we lay them out as a clean grid.
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const onChangeMq = () => setIsNarrow(mq.matches);
    onChangeMq();
    mq.addEventListener('change', onChangeMq);
    return () => mq.removeEventListener('change', onChangeMq);
  }, []);

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

  // A sale is only worth saving once it has BOTH a percent and a start date.
  // Until then it's a draft: shown in the form for the session, but never
  // written to booking_settings — so leaving and coming back doesn't resurrect
  // a half-set "3%" that was never actually turned into a sale.
  const [saleDraft, setSaleDraft] = useState<Sale | null>(null);
  const saleView: Sale = saleDraft ?? sale;

  // On mount, migrate any previously-persisted incomplete sale (percent but no
  // start date, from before this rule) into a local draft and clear it from
  // saved settings, so it stops persisting.
  useEffect(() => {
    if ((sale.percent ?? 0) > 0 && !sale.starts) {
      setSaleDraft({ ...sale });
      onChange({ sale: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateSale(p: Partial<Sale>) {
    const next: Sale = { ...saleView, ...p };
    const hasAnything = (next.percent ?? 0) > 0 || !!next.starts || !!next.ends;
    if (!hasAnything) {
      // Nothing set at all — drop the draft AND any saved sale.
      setSaleDraft(null);
      if ((sale.percent ?? 0) > 0 || sale.starts) onChange({ sale: {} });
      return;
    }
    // Any partial edit (a percent OR a date on its own) stays staged in the
    // form. Nothing is activated or persisted until Confirm (confirmSale), so
    // picking a date never turns the sale on by itself — but it IS remembered.
    setSaleDraft(next);
  }

  // A staged sale is ready to confirm once it has both a percent and a start
  // date, and it actually differs from what's already saved.
  const saleDirty = !!saleDraft && JSON.stringify({ percent: saleDraft.percent ?? 0, starts: saleDraft.starts ?? null, ends: saleDraft.ends ?? null })
    !== JSON.stringify({ percent: sale.percent ?? 0, starts: sale.starts ?? null, ends: sale.ends ?? null });
  const canConfirmSale = saleDirty && (saleDraft!.percent ?? 0) > 0 && !!saleDraft!.starts;

  function confirmSale() {
    if (!saleDraft || !canConfirmSale) return;
    onChange({ sale: { ...saleDraft, active: true, started_at: saleDraft.started_at || new Date().toISOString() } });
    setSaleDraft(null);
  }

  // Advertise-on-profile toggle. It's a display preference, not part of the
  // sale window, so it applies immediately: to the staged draft if one exists,
  // otherwise straight to the saved live sale (no Confirm needed). The sale
  // still applies to quotes either way.
  function setSaleShown(show: boolean) {
    // Keep the staged draft's copy in sync so the checkbox reflects the toggle.
    if (saleDraft) setSaleDraft({ ...saleDraft, show_on_profile: show });
    // Persist to the SAVED live sale immediately whenever one exists. The badge
    // preference isn't part of the sale window, so it must not wait on — or be
    // lost by abandoning — a Confirm that's pending for an unrelated date edit.
    if ((sale.percent ?? 0) > 0) onChange({ sale: { ...sale, show_on_profile: show } });
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
    setSaleDraft(null);
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
    if (exclusions.some((e) => e.date === newExclDate)) {
      // Already on the list — tell the DJ instead of silently doing nothing.
      setExclErr(`${new Date(`${newExclDate}T00:00:00`).toLocaleDateString()} is already excluded — edit it below.`);
      return;
    }
    const next = [...exclusions, { date: newExclDate, sale: newExclSale, codes: newExclCodes }]
      .sort((a, b) => a.date.localeCompare(b.date));
    onChange({ exclusions: next });
    // Clear the date so the picker is ready for the next one; keep the toggles.
    setNewExclDate('');
    setExclErr('');
  }
  function updateExclusion(i: number, patch: Partial<DiscountExclusion>) {
    const next = { ...exclusions[i], ...patch };
    // A row that blocks neither the sale nor codes does nothing — unchecking
    // the last box removes the exclusion instead of leaving dead data behind.
    if (!next.sale && !next.codes) { removeExclusion(i); return; }
    onChange({ exclusions: exclusions.map((e, idx) => (idx === i ? next : e)) });
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
    // A start date is required — a percent with no start date is a draft, not
    // a running sale.
    if (!sale.starts) return false;
    const now = new Date();
    if (new Date(`${sale.starts}T00:00:00`).getTime() > now.getTime()) return false;
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
          /* When the field is empty we overlay a "Select" placeholder, so hide
             the native mm/dd/yyyy text AND its "/" separators (which gdcDateWhite
             would otherwise force white). */
          .gdcDateHidden::-webkit-datetime-edit,
          .gdcDateHidden::-webkit-datetime-edit-fields-wrapper,
          .gdcDateHidden::-webkit-datetime-edit-text,
          .gdcDateHidden::-webkit-datetime-edit-month-field,
          .gdcDateHidden::-webkit-datetime-edit-day-field,
          .gdcDateHidden::-webkit-datetime-edit-year-field { color: transparent !important; }
          @keyframes gdcLiveDot {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: .25; transform: scale(.55); }
          }
          .gdcLiveDot { animation: gdcLiveDot 1.1s ease-in-out infinite; }
          input.gdcNoSpin::-webkit-outer-spin-button,
          input.gdcNoSpin::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
          input.gdcNoSpin { -moz-appearance: textfield; appearance: textfield; }
          @media (max-width: 760px) { .gdcDiscGrid { grid-template-columns: 1fr !important; } }
        `}</style>

        {/* Two-column master/detail, mirroring the Payments Accepted page: a
            stacked list of the three options on the left, the open one's panel
            on the right. */}
        <div
          className="gdcDiscGrid"
          style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '1rem', alignItems: 'start' }}
        >
          {/* LEFT — stacked tab list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
            {([
              { id: 'sale' as const, label: 'Sale', icon: iconSale },
              { id: 'promo' as const, label: 'Promo Codes', icon: iconPromo },
              { id: 'exclusions' as const, label: 'Exclusions', icon: iconExcl },
            ]).map((t) => {
              const open = activeDisc === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveDisc(t.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '.6rem', width: '100%',
                    padding: '.7rem .7rem', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                    border: open ? '1px solid rgba(34,227,173,.4)' : '1px solid rgba(255,255,255,.08)',
                    background: open ? 'rgba(34,227,173,.1)' : 'transparent',
                    transition: 'background .12s ease, border-color .12s ease',
                  }}
                >
                  <span style={{ width: 28, height: 28, borderRadius: 8, background: GRAD, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {t.icon}
                  </span>
                  <span style={{ fontSize: '.85rem', fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: open ? '#fff' : 'rgba(255,255,255,.68)' }}>
                    {t.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* RIGHT — the open option's panel */}
          <div style={{ minWidth: 0 }}>

        {activeDisc === 'sale' && (
        <div className={styles.sectionCard} style={{ marginBottom: 0 }}>
        <SecHeader label="Sale" icon={iconSale} />
        <div className={styles.sectionBody}>
        <div className={styles.settingHint} style={{ marginBottom: '.9rem', color: 'var(--white,#fff)' }}>
          A site-wide % off applied automatically to every quote. Set a window and it switches
          itself on and off — a sale and a promo code don&apos;t stack, the bigger discount wins.
        </div>

        {/* One row: percent · start date · end date · used · status. The sale's
            on/off state is decided by the dates, so Status is a read-out
            (Scheduled → Active → Ended), not a button. */}
        {(() => {
          // Status reflects the SAVED sale, not the staged draft — a sale is only
          // live once the DJ confirms it, so editing fields never flips the pill.
          const pct = sale.percent ?? 0;
          let statLabel = 'Inactive';
          let tone: 'on' | 'sched' | 'off' = 'off';
          if (pct > 0 && sale.starts) {
            const now = new Date();
            const startFuture = new Date(`${sale.starts}T00:00:00`).getTime() > now.getTime();
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
            <div
              style={
                isNarrow
                  ? { display: 'grid', gridTemplateColumns: '62px 100px 100px 1fr', columnGap: '.4rem', rowGap: '.85rem', alignItems: 'end' }
                  : { display: 'flex', flexWrap: 'wrap', rowGap: '.9rem', columnGap: '1.1rem', alignItems: 'flex-end' }
              }
            >
              <div style={{ ...fieldWrap, flex: '0 0 84px', order: isNarrow ? 2 : undefined }}>
                <label style={{ ...labelStyle, ...(isNarrow ? { fontSize: '.58rem', letterSpacing: 0 } : null) }}>Percent off</label>
                <select
                  className={styles.settingSelect}
                  style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', height: 34, fontSize: isNarrow ? '.7rem' : '.78rem', padding: isNarrow ? '0 4px' : '0 8px', color: 'var(--white,#fff)' }}
                  value={saleView.percent || ''}
                  onChange={(e) => {
                    const v = e.target.value === '' ? 0 : Number(e.target.value);
                    // updateSale decides whether this becomes a saved sale (has
                    // a start date) or stays a local-only draft.
                    updateSale({ percent: v });
                  }}
                >
                  <option value="">%</option>
                  {Array.from({ length: 99 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n}%</option>
                  ))}
                </select>
              </div>
              <div style={{ ...fieldWrap, flex: '0 0 124px', order: isNarrow ? 3 : undefined }}>
                <label style={{ ...labelStyle, whiteSpace: 'nowrap', ...(isNarrow ? { fontSize: '.58rem', letterSpacing: 0 } : null) }}>Start date</label>
                <DateField
                  value={saleView.starts || null}
                  min={todayStr}
                  height={34}
                  fontSize={isNarrow ? '.6rem' : '.78rem'}
                  onChange={(v) => {
                    // If the new start is after the current end, that end is no
                    // longer valid — clear it so we never keep end < start.
                    const clearEnd = v && saleView.ends && saleView.ends < v;
                    updateSale(clearEnd ? { starts: v, ends: null } : { starts: v });
                  }}
                />
              </div>
              <div style={{ ...fieldWrap, flex: '0 0 124px', order: isNarrow ? 4 : undefined }}>
                <label style={{ ...labelStyle, whiteSpace: 'nowrap', ...(isNarrow ? { fontSize: '.58rem', letterSpacing: 0 } : null) }}>{isNarrow ? 'End date' : 'End date (optional)'}</label>
                <DateField
                  value={saleView.ends || null}
                  min={saleView.starts || todayStr}
                  height={34}
                  fontSize={isNarrow ? '.6rem' : '.78rem'}
                  onChange={(v) => {
                    if (v && saleView.starts && v < saleView.starts) return; // before start — reject
                    updateSale({ ends: v });
                  }}
                />
              </div>
              <div style={{ ...fieldWrap, flex: '0 0 auto', order: isNarrow ? 5 : undefined, ...(isNarrow ? { alignItems: 'flex-end', textAlign: 'right' } : { alignItems: 'center', textAlign: 'center' }) }}>
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
              <div
                style={
                  isNarrow
                    ? { order: 1, gridColumn: '1 / -1', justifySelf: 'end', display: 'flex', alignItems: 'flex-end', gap: '1rem' }
                    : { flex: '0 0 auto', marginLeft: 'auto', display: 'flex', alignItems: 'flex-end', gap: '1rem' }
                }
              >
                {/* Confirm — shown until the sale is live/scheduled, AND again
                    whenever there are unsaved edits (e.g. a scheduled sale whose
                    date was pulled to today needs re-confirming to go live now).
                    Only clickable once a percent AND start date are staged. */}
                {(saleDirty || (tone !== 'on' && tone !== 'sched')) && (
                  <button
                    type="button"
                    onClick={confirmSale}
                    disabled={!canConfirmSale}
                    style={{
                      ...btnPrimary, height: 30, padding: '0 16px', borderRadius: 999,
                      opacity: canConfirmSale ? 1 : 0.4,
                      cursor: canConfirmSale ? 'pointer' : 'not-allowed',
                    }}
                  >
                    Confirm
                  </button>
                )}
                <div style={{ ...fieldWrap, alignItems: 'center', textAlign: 'center' }}>
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
            </div>
            {/* Advertise-on-profile toggle on its own line. Checked = the "X% off"
                badge shows on the public profile; unchecked = the sale still
                applies to quotes but isn't advertised. */}
            {(saleView.percent ?? 0) > 0 && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: '.7rem', cursor: 'pointer', fontSize: '.8rem', color: 'var(--white,#fff)' }}>
                <input
                  type="checkbox"
                  checked={saleView.show_on_profile !== false}
                  onChange={(e) => setSaleShown(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: 'var(--neon,#00e0a4)', cursor: 'pointer' }}
                />
                Show sale banner on profile
              </label>
            )}
            {/* End-now escape hatch — a sale with no end date (or a future one)
                has no other way to stop, so let the DJ end it on the spot. Only
                shown once the sale is actually running or scheduled; a percent
                with no start date is just a draft, so there's nothing to end. */}
            {(tone === 'on' || tone === 'sched') && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginTop: '.7rem' }}>
                <span style={{ fontSize: '.72rem', color: 'var(--muted,#8a8aa0)' }}>
                  No end date? The sale runs until you end it here.
                </span>
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
            {/* Show ~4 at a glance; when there are more, the list scrolls inside
                a fixed-height window instead of running down the whole page. */}
            <div
              className={saleHistory.length > 4 ? styles.scrollList : undefined}
              style={saleHistory.length > 4
                ? { maxHeight: 304, overflowY: 'scroll', paddingRight: '.3rem' }
                : undefined}
            >
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
                    <span style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: '1rem', color: 'var(--white,#fff)', minWidth: 84, display: 'inline-block' }}>
                      {h.percent ?? 0}% off
                    </span>
                    <span
                      style={{
                        fontSize: '.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em',
                        padding: '2px 9px', borderRadius: 999, color: '#fff', background: '#d64545',
                        flexShrink: 0, minWidth: 58, textAlign: 'center',
                      }}
                    >
                      Ended
                    </span>
                    <span style={{ fontSize: '.82rem', color: 'rgba(255,255,255,.6)' }}>
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
                      {/* Reserve the caret slot even when there's nothing to
                          expand, so the Used numbers line up across every row. */}
                      <span style={{ fontSize: '.7rem', width: 12, display: 'inline-block', textAlign: 'center' }}>{clickable ? (open ? '▲' : '▼') : ''}</span>
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
          </div>
        )}
        </div>
        </div>
        )}{/* end Run a sale block */}

        {/* ── Promo codes ────────────────────────────────────────── */}
        {activeDisc === 'promo' && (
        <div className={styles.sectionCard} style={{ marginBottom: 0 }}>
        <SecHeader label="Promo Codes" icon={iconPromo} />
        <div className={styles.sectionBody}>
        <div className={styles.settingHint} style={{ marginBottom: '.9rem', color: 'var(--white,#fff)' }}>
          Private codes you hand out — referrals, socials, repeat clients. Build one, switch it on,
          and it drops into your list. Your public price stays the same.
        </div>

        {error && <div style={{ color: '#ff6b6b', fontSize: '.8rem', marginBottom: '.6rem' }}>{error}</div>}

        {/* Draft form */}
        {draft && (
          <div style={{ border: '1px solid var(--neon, #00e0a4)', borderRadius: 10, padding: '.85rem', marginBottom: '.9rem' }}>
            <div style={isNarrow
              ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', alignItems: 'flex-end' }
              : { display: 'flex', flexWrap: 'wrap', gap: '.75rem', alignItems: 'flex-end' }}>
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
            <span style={{ fontSize: '1.05rem', fontWeight: 700, lineHeight: 1 }}>+</span> Add Promo Code
          </button>
          </div>
        )}

        {/* Codes list (active + deactivated = history) */}
        {promoCodes.length === 0 && !draft && (
          <div style={{ color: 'var(--muted, #8a8aa0)', fontSize: '.85rem' }}>No promo codes yet.</div>
        )}

        {promoCodes.length > 0 && (() => {
          // Split into Active and Deactivated, each in its own labelled, scrollable
          // group with Active on top. Original index `i` is preserved so edit /
          // delete / (re)activate still target the right code.
          const indexed = promoCodes.map((c, i) => ({ c, i }));
          const activeCodes = indexed.filter(({ c }) => c.active !== false);
          const deactivated = indexed.filter(({ c }) => c.active === false);
          const groupScroll = (n: number): React.CSSProperties | undefined =>
            n > 4 ? { maxHeight: 304, overflowY: 'scroll', paddingRight: '.3rem' } : undefined;

          const renderCode = ({ c, i }: { c: PromoCode; i: number }) => {
          const isEditing = editIndex === i;
          const off = c.active === false;
          // Past its expiry date? An expired code can't apply to a booking even
          // if it's "active", so we surface it distinctly and offer Renew.
          const expired = !!c.expires && new Date(`${c.expires}T23:59:59`).getTime() < Date.now();
          if (isEditing && editBuf) {
            return (
              <div key={i} style={{ border: '1px solid var(--neon, #00e0a4)', borderRadius: 10, padding: '.85rem', marginBottom: '.75rem' }}>
                <div style={isNarrow
                  ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', alignItems: 'flex-end' }
                  : { display: 'flex', flexWrap: 'wrap', gap: '.75rem', alignItems: 'flex-end' }}>
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
                {/* Even columns: Code · Discount · Expires · Used. The Active/
                    Inactive badge is dropped — the group header already says it. */}
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(80px,1.1fr) 1fr 1.4fr 0.8fr', alignItems: 'center', gap: '1rem', flex: 1, minWidth: 0, fontSize: '.82rem', color: 'var(--white,#fff)' }}>
                  <span style={{ fontWeight: 700, letterSpacing: '.04em', fontSize: '1rem', color: 'var(--white,#fff)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(c.code || '').toUpperCase()}
                  </span>
                  <span>{valueLabel(c)}</span>
                  <span style={{ color: expired ? '#ffb020' : undefined }}>{c.expires ? new Date(`${c.expires}T00:00:00`).toLocaleDateString() : 'Never'}{expired ? ' · expired' : ''}</span>
                  {(() => {
                    const key = (c.code || '').trim().toUpperCase();
                    const uses = usageByCode[key] || [];
                    const open = expandedCode === key;
                    // When the DJ set a cap, show "used / max" and flag a code
                    // that's hit its limit (it stops applying at checkout).
                    const cap = c.maxUses != null ? ` / ${c.maxUses}` : '';
                    const maxedOut = c.maxUses != null && uses.length >= c.maxUses;
                    if (uses.length === 0) {
                      return <span>0{cap}</span>;
                    }
                    return (
                      <button
                        type="button"
                        onClick={() => setExpandedCode(open ? null : key)}
                        style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: maxedOut ? '#ffb020' : 'var(--neon,#00e0a4)', fontSize: '.82rem', display: 'inline-flex', alignItems: 'center', gap: 4, justifySelf: 'start' }}
                      >
                        {uses.length}{cap}
                        <span style={{ fontSize: '.7rem' }}>{open ? '▲' : '▼'}</span>
                      </button>
                    );
                  })()}
                </div>
                <div style={{ display: 'flex', gap: '.5rem', flex: '0 0 300px', justifyContent: 'flex-end' }}>
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
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await confirm({
                        title: 'Delete this promo code?',
                        message: `${(c.code || '').toUpperCase()} will be removed for good. This can't be undone.`,
                        confirmLabel: 'Delete',
                        variant: 'danger',
                      });
                      if (ok) removeCode(i);
                    }}
                    style={btnDanger}
                  >
                    Delete
                  </button>
                </div>
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
          };

          // Column headings, aligned to each row's 4-column grid (left of the
          // action buttons), shown once at the top of each group.
          const colHeader = (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0 1rem', marginBottom: '.4rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(80px,1.1fr) 1fr 1.4fr 0.8fr', gap: '1rem', flex: 1, minWidth: 0 }}>
                <span style={metaLabel}>Code</span>
                <span style={metaLabel}>Discount</span>
                <span style={metaLabel}>Expires</span>
                <span style={metaLabel}>Used</span>
              </div>
              {/* Spacer matching the row's fixed action-button column, so the
                  headings line up with the values below. */}
              <div style={{ flex: '0 0 300px' }} />
            </div>
          );

          return (
            <>
              {activeCodes.length > 0 && (
                <>
                  <div style={{ ...labelStyle, marginBottom: '.5rem', color: 'var(--white,#fff)' }}>Active Promo Codes</div>
                  {colHeader}
                  <div className={activeCodes.length > 4 ? styles.scrollList : undefined} style={groupScroll(activeCodes.length)}>
                    {activeCodes.map(renderCode)}
                  </div>
                </>
              )}
              {deactivated.length > 0 && (
                <>
                  <div style={{ ...labelStyle, marginBottom: '.5rem', marginTop: activeCodes.length > 0 ? '2rem' : 0, color: 'var(--white,#fff)' }}>Deactivated Promo Codes</div>
                  {colHeader}
                  <div className={deactivated.length > 4 ? styles.scrollList : undefined} style={groupScroll(deactivated.length)}>
                    {deactivated.map(renderCode)}
                  </div>
                </>
              )}
            </>
          );
        })()}
        </div>
        </div>
        )}{/* end Promo codes block */}

        {/* ── Exclusions ─────────────────────────────────────────── */}
        {activeDisc === 'exclusions' && (
        <div className={styles.sectionCard} style={{ marginBottom: 0 }}>
        <SecHeader label="Exclusions" icon={iconExcl} />
        <div className={styles.sectionBody}>
        <div className={styles.settingHint} style={{ marginBottom: '.9rem', color: 'var(--white,#fff)' }}>
          Block discounts on specific dates. Pick a date, then choose whether to turn off the
          site sale, promo codes, or both for that day — bookings on excluded dates pay full price.
        </div>

        {/* Add row: pick a date, choose what to block, hit Confirm. The date box
            clears on confirm so it's ready for the next date. */}
        <div style={{ display: 'flex', gap: '1.2rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1.1rem' }}>
          <div style={{ ...fieldWrap, flex: '0 0 158px' }}>
            <label style={labelStyle}>Add a date</label>
            <DateField
              value={newExclDate || null}
              min={todayStr}
              onChange={(v) => { setNewExclDate(v || ''); setExclErr(''); }}
            />
          </div>
          {/* Both checkboxes grouped so they always sit on the same line (the
              group wraps as a unit, never splitting one below the other). */}
          <div style={{ display: 'flex', flexWrap: 'nowrap', gap: '1.1rem', alignItems: 'center', height: 38 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '.82rem', color: 'var(--white,#fff)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" style={{ width: 15, height: 15, accentColor: 'var(--neon,#00e0a4)', cursor: 'pointer' }}
                checked={newExclSale} onChange={(e) => setNewExclSale(e.target.checked)} />
              Exclude Site Sale
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '.82rem', color: 'var(--white,#fff)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" style={{ width: 15, height: 15, accentColor: 'var(--neon,#00e0a4)', cursor: 'pointer' }}
                checked={newExclCodes} onChange={(e) => setNewExclCodes(e.target.checked)} />
              Exclude Promo Codes
            </label>
          </div>
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

        {exclErr && <div style={{ color: '#ffb020', fontSize: '.8rem', marginTop: '-.5rem', marginBottom: '.8rem' }}>{exclErr}</div>}

        {exclusions.length === 0 ? (
          <div style={{ color: 'var(--muted,#8a8aa0)', fontSize: '.85rem' }}>No excluded dates.</div>
        ) : (() => {
          // Split into upcoming (today or later) and past, keeping each row's
          // ORIGINAL index so edit/remove still target the right exclusion.
          const todayStr = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD
          const indexed = exclusions.map((ex, i) => ({ ex, i }));
          const upcoming = indexed.filter(({ ex }) => (ex.date || '') >= todayStr);
          const past = indexed.filter(({ ex }) => (ex.date || '') < todayStr);

          const renderRow = ({ ex, i }: { ex: DiscountExclusion; i: number }) => (
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
              <div style={{ display: 'flex', flexWrap: 'nowrap', gap: '1.1rem', alignItems: 'center' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '.82rem', color: 'var(--white,#fff)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" style={{ width: 15, height: 15, accentColor: 'var(--neon,#00e0a4)', cursor: 'pointer' }}
                    checked={!!ex.sale} onChange={(e) => updateExclusion(i, { sale: e.target.checked })} />
                  Exclude Site Sale
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '.82rem', color: 'var(--white,#fff)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" style={{ width: 15, height: 15, accentColor: 'var(--neon,#00e0a4)', cursor: 'pointer' }}
                    checked={!!ex.codes} onChange={(e) => updateExclusion(i, { codes: e.target.checked })} />
                  Exclude Promo Codes
                </label>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Remove this excluded date?',
                    message: `${new Date(`${ex.date}T00:00:00`).toLocaleDateString()} will no longer block discounts.`,
                    confirmLabel: 'Remove',
                    variant: 'danger',
                  });
                  if (ok) removeExclusion(i);
                }}
                aria-label="Remove excluded date"
                style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#ff8f8f', fontSize: '1.1rem', lineHeight: 1, cursor: 'pointer', padding: '0 .2rem' }}
              >
                &times;
              </button>
            </div>
          );

          return (
            <>
              {upcoming.length > 0 && (
                <>
                  <div style={{ ...labelStyle, marginBottom: '.5rem', paddingLeft: '.9rem' }}>Exclusion Date</div>
                  <div
                    className={upcoming.length > 4 ? styles.scrollList : undefined}
                    style={upcoming.length > 4 ? { maxHeight: 272, overflowY: 'scroll', paddingRight: '.3rem' } : undefined}
                  >
                    {upcoming.map(renderRow)}
                  </div>
                </>
              )}
              {past.length > 0 && (
                <>
                  <div style={{ ...labelStyle, marginBottom: '.5rem', marginTop: upcoming.length > 0 ? '1.1rem' : 0, paddingLeft: '.9rem' }}>Past Dates</div>
                  <div
                    className={past.length > 4 ? styles.scrollList : undefined}
                    style={past.length > 4 ? { maxHeight: 272, overflowY: 'scroll', paddingRight: '.3rem', opacity: .75 } : { opacity: .75 }}
                  >
                    {past.map(renderRow)}
                  </div>
                </>
              )}
            </>
          );
        })()}
        </div>
        </div>
        )}{/* end Exclusions block */}
          </div>{/* end right panel */}
        </div>{/* end two-column grid */}
      </div>
      {confirmDialog}
    </div>
  );
}
