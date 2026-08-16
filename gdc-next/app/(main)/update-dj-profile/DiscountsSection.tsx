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
import type { PromoCode, Sale } from '@/app/(main)/[slug]/bookingSettings';

interface Props {
  promoCodes: PromoCode[];
  sale: Sale;
  currencySymbol?: string;
  onChange: (patch: { promo_codes?: PromoCode[]; sale?: Sale }) => void;
}

interface Redemption {
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
const usedCellValue: React.CSSProperties = {
  height: 44, display: 'inline-flex', alignItems: 'center', gap: 4,
  color: 'var(--white,#fff)', fontSize: '.9rem', fontWeight: 700,
};

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
      <div style={{ ...fieldWrap, flex: '0 0 95px' }}>
        <label style={labelStyle}>Type</label>
        <select
          className={styles.settingSelect}
          style={{ color: 'var(--white,#fff)' }}
          value={value.type}
          onChange={(e) => onField({ type: e.target.value as 'percent' | 'flat' })}
        >
          <option value="percent">% off</option>
          <option value="flat">{currencySymbol} off</option>
        </select>
      </div>
      <div style={{ ...fieldWrap, flex: '0 0 90px' }}>
        <label style={labelStyle}>{value.type === 'percent' ? 'Percent' : 'Amount'}</label>
        {value.type === 'percent' ? (
          <select
            className={styles.settingSelect}
            style={{ width: '100%', boxSizing: 'border-box', color: 'var(--white,#fff)' }}
            value={value.value || ''}
            onChange={(e) => onField({ value: Number(e.target.value) })}
          >
            <option value="">%</option>
            {Array.from({ length: 100 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}%</option>
            ))}
          </select>
        ) : (
          <input
            type="number"
            onWheel={(e) => e.currentTarget.blur()}
            min={1}
            className={styles.settingNumber}
            style={{ width: '100%', boxSizing: 'border-box', color: 'var(--white,#fff)' }}
            value={value.value ? value.value : ''}
            placeholder="0"
            onChange={(e) => onField({ value: e.target.value === '' ? 0 : Number(e.target.value) })}
          />
        )}
      </div>
      <div style={{ ...fieldWrap, flex: '1 1 150px' }}>
        <label style={labelStyle}>Expires (optional)</label>
        <input
          type="date"
          className={`${styles.settingNumber} gdcDateWhite`}
          style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }}
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

export default function DiscountsSection({ promoCodes, sale, currencySymbol = '$', onChange }: Props) {
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

  useEffect(() => {
    let mounted = true;
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('bookings')
        .select('requester_name, event_date, created_at, discount_code, discount_label, discount_amount, original_rate, currency')
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

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>Discounts &amp; Promo Codes</div>
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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
              <div style={{ ...fieldWrap, flex: '0 0 110px' }}>
                <label style={labelStyle}>Percent off</label>
                <select
                  className={styles.settingSelect}
                  style={{ width: '100%', boxSizing: 'border-box', height: 44, color: 'var(--white,#fff)' }}
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
              <div style={{ ...fieldWrap, flex: '1 1 150px' }}>
                <label style={labelStyle}>Start date</label>
                <input
                  type="date" className={`${styles.settingNumber} gdcDateWhite`}
                  style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box', height: 44 }} onClick={openPicker}
                  value={sale.starts || ''} onChange={(e) => updateSale({ starts: e.target.value || null })}
                />
              </div>
              <div style={{ ...fieldWrap, flex: '1 1 150px' }}>
                <label style={labelStyle}>End date (optional)</label>
                <input
                  type="date" className={`${styles.settingNumber} gdcDateWhite`}
                  style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box', height: 44 }} onClick={openPicker}
                  value={sale.ends || ''} onChange={(e) => updateSale({ ends: e.target.value || null })}
                />
              </div>
              <div style={{ ...fieldWrap, flex: '0 0 auto' }}>
                <label style={labelStyle}>Used</label>
                {saleUsage.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setSaleOpen((o) => !o)}
                    style={{ ...usedCellValue, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--neon,#00e0a4)' }}
                  >
                    {saleUsage.length}
                    <span style={{ fontSize: '.7rem' }}>{saleOpen ? '▲' : '▼'}</span>
                  </button>
                ) : (
                  <span style={usedCellValue}>0</span>
                )}
              </div>
              <div style={{ ...fieldWrap, flex: '0 0 auto', marginLeft: 'auto' }}>
                <label style={labelStyle}>Status</label>
                <span
                  style={{
                    height: 34, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 15px',
                    borderRadius: 999, fontSize: '.72rem', fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase',
                    ...pillStyle,
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor }} />
                  {statLabel}
                </span>
              </div>
            </div>
          );
        })()}

        {/* Sale usage detail — who booked during the sale window. The count that
            toggles this lives in the "Used" cell of the row above. */}
        {saleUsage.length > 0 && saleOpen && (
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
                {saleUsage.map((r, ri) => (
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
                    <span style={{ color: 'var(--neon,#00e0a4)' }}>
                      saved {currencySymbol}{Number(r.discount_amount || 0).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
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
          if (isEditing && editBuf) {
            return (
              <div key={i} style={{ border: '1px solid var(--neon, #00e0a4)', borderRadius: 10, padding: '.85rem', marginBottom: '.75rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.75rem', alignItems: 'flex-end' }}>
                  <CodeFields value={editBuf} onField={(p) => setEditBuf({ ...editBuf, ...p })} currencySymbol={currencySymbol} />
                </div>
                <div style={{ display: 'flex', gap: '.6rem', marginTop: '.85rem' }}>
                  <button type="button" onClick={saveEdit} style={btnPrimary}>Save</button>
                  <button type="button" onClick={() => { setEditIndex(null); setEditBuf(null); setError(''); }} style={btnOutline}>Cancel</button>
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
                opacity: off ? 0.55 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.7rem', minWidth: 0 }}>
                  <span style={{ fontWeight: 700, letterSpacing: '.04em', fontSize: '1rem', color: 'var(--white,#fff)' }}>
                    {(c.code || '').toUpperCase()}
                  </span>
                  <span
                    style={{
                      fontSize: '.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em',
                      padding: '2px 8px', borderRadius: 999,
                      color: off ? 'var(--muted,#8a8aa0)' : '#06231b',
                      background: off ? 'rgba(255,255,255,.08)' : 'var(--neon,#00e0a4)',
                    }}
                  >
                    {off ? 'Inactive' : 'Active'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '.5rem' }}>
                  <button type="button" onClick={() => { setEditIndex(i); setEditBuf({ ...c }); setError(''); }} style={btnOutline}>Edit</button>
                  {off ? (
                    <button type="button" onClick={() => setActive(i, true)} style={btnOutline}>Reactivate</button>
                  ) : (
                    <button type="button" onClick={() => setActive(i, false)} style={btnOutline}>Deactivate</button>
                  )}
                  <button type="button" onClick={() => removeCode(i)} style={btnDanger}>Delete</button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '.6rem', fontSize: '.82rem', color: 'var(--white,#fff)' }}>
                <span><span style={metaLabel}>Discount</span> {valueLabel(c)}</span>
                <span><span style={metaLabel}>Expires</span> {c.expires ? new Date(`${c.expires}T00:00:00`).toLocaleDateString() : 'Never'}</span>
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
                      style={{
                        background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                        color: 'var(--neon,#00e0a4)', fontSize: '.82rem', display: 'inline-flex',
                        alignItems: 'center', gap: 4,
                      }}
                    >
                      <span style={metaLabel}>Used</span> {uses.length}
                      <span style={{ fontSize: '.7rem' }}>{open ? '▲' : '▼'}</span>
                    </button>
                  );
                })()}
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
                      <span style={{ color: 'var(--neon,#00e0a4)' }}>
                        saved {currencySymbol}{Number(r.discount_amount || 0).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        </div>{/* end Promo codes block */}
      </div>
    </div>
  );
}
