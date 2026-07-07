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

import { useState } from 'react';
import styles from './updateDjProfile.module.css';
import type { PromoCode, Sale } from '@/app/(main)/[slug]/bookingSettings';

interface Props {
  promoCodes: PromoCode[];
  sale: Sale;
  currencySymbol?: string;
  onChange: (patch: { promo_codes?: PromoCode[]; sale?: Sale }) => void;
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

        <div className={styles.settingRow}>
          <div className={styles.settingLabelWrap}>
            <div className={styles.settingLabel}>Run a sale</div>
            <div className={styles.settingHint}>
              A site-wide % off applied automatically to every quote while active. Shows a
              &ldquo;% OFF&rdquo; badge to clients. A sale and a promo code don&apos;t stack — the
              bigger discount wins.
            </div>
          </div>
        </div>

        {/* Percent + end date — set the amount before activating. */}
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', padding: '.25rem 0 .75rem' }}>
          <div style={{ ...fieldWrap, flex: '0 0 140px' }}>
            <label style={labelStyle}>Percent off</label>
            <input
              type="number" min={0} max={100} className={styles.settingNumber}
              style={{ width: '100%', boxSizing: 'border-box', color: 'var(--white,#fff)' }}
              value={sale.percent ? sale.percent : ''}
              placeholder="0"
              onChange={(e) => {
                const v = e.target.value === '' ? 0 : Number(e.target.value);
                updateSale(v > 0 ? { percent: v } : { percent: 0, active: false });
              }}
            />
          </div>
          <div style={{ ...fieldWrap, flex: '0 0 200px' }}>
            <label style={labelStyle}>Ends on (optional)</label>
            <input
              type="date" className={`${styles.settingNumber} gdcDateWhite`}
              style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }} onClick={openPicker}
              value={sale.ends || ''} onChange={(e) => updateSale({ ends: e.target.value || null })}
            />
          </div>
        </div>

        {/* Status pill + Activate/Deactivate — bottom of the sale box, right side. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '.7rem', padding: '0 0 1rem' }}>
          {(() => {
            const pct = sale.percent ?? 0;
            const saleOn = !!sale.active && pct > 0;
            return (
              <>
                <span
                  style={{
                    fontSize: '.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em',
                    padding: '2px 8px', borderRadius: 999,
                    color: saleOn ? '#06231b' : 'var(--muted,#8a8aa0)',
                    background: saleOn ? 'var(--neon,#00e0a4)' : 'rgba(255,255,255,.08)',
                  }}
                >
                  {saleOn ? 'Active' : 'Inactive'}
                </span>
                <button
                  type="button"
                  onClick={() => updateSale({ active: !saleOn })}
                  disabled={!saleOn && !(pct > 0)}
                  style={{
                    ...(saleOn ? btnOutline : btnPrimary),
                    ...(!saleOn && !(pct > 0) ? { opacity: 0.4, cursor: 'not-allowed' } : {}),
                  }}
                >
                  {saleOn ? 'Deactivate' : 'Activate'}
                </button>
              </>
            );
          })()}
        </div>

        {/* ── Promo codes ────────────────────────────────────────── */}
        <div className={styles.settingRow} style={{ borderTop: '1px solid var(--border, rgba(255,255,255,.1))', paddingTop: '1rem' }}>
          <div className={styles.settingLabelWrap}>
            <div className={styles.settingLabel}>Promo codes</div>
            <div className={styles.settingHint}>
              Private codes you hand out (referrals, socials, repeat clients). Build a code, hit
              Activate, and it moves into your list below. Your public price stays the same.
            </div>
          </div>
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
          <button
            type="button"
            onClick={() => { setDraft(emptyDraft()); setError(''); }}
            style={{
              background: 'transparent', border: '1px dashed var(--border, rgba(255,255,255,.25))',
              color: 'var(--white, #fff)', borderRadius: 8, padding: '.6rem 1rem', fontSize: '.85rem',
              cursor: 'pointer', marginBottom: '1rem',
            }}
          >
            + Add promo code
          </button>
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
                <span><span style={metaLabel}>Used</span> {c.uses || 0}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
