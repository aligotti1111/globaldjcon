'use client';

// DiscountsSection — DJ-facing management for the automatic sale + promo
// codes. Shared by the mobile (BookingTab) and club (ClubBookingTab) settings.
// It's presentational: it reads the current values and reports changes back
// via onChange, which the parent folds into booking_settings via its patch().
//
// Nothing here applies the discount to a quote — that happens in the booking
// form / quote engine using computeDiscount() from bookingSettings.ts.

import styles from './updateDjProfile.module.css';
import type { PromoCode, Sale } from '@/app/(main)/[slug]/bookingSettings';

interface Props {
  promoCodes: PromoCode[];
  sale: Sale;
  currencySymbol?: string;
  onChange: (patch: { promo_codes?: PromoCode[]; sale?: Sale }) => void;
}

export default function DiscountsSection({ promoCodes, sale, currencySymbol = '$', onChange }: Props) {
  function updateSale(p: Partial<Sale>) {
    onChange({ sale: { ...sale, ...p } });
  }
  function updateCode(i: number, p: Partial<PromoCode>) {
    onChange({ promo_codes: promoCodes.map((c, idx) => (idx === i ? { ...c, ...p } : c)) });
  }
  function addCode() {
    onChange({
      promo_codes: [
        ...promoCodes,
        { code: '', type: 'percent', value: 10, active: true, expires: null, maxUses: null, uses: 0 },
      ],
    });
  }
  function removeCode(i: number) {
    onChange({ promo_codes: promoCodes.filter((_, idx) => idx !== i) });
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

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>Discounts &amp; Promo Codes</div>
      </div>
      <div className={`${styles.sectionBody} ${styles.settingsBody}`}>

        {/* ── Automatic sale ─────────────────────────────────────── */}
        <div className={styles.settingRow}>
          <div className={styles.settingLabelWrap}>
            <div className={styles.settingLabel}>Run a sale</div>
            <div className={styles.settingHint}>
              A site-wide % off applied automatically to every quote while active. Shows a
              &ldquo;% OFF&rdquo; badge to clients. A sale and a promo code don&apos;t stack — the
              bigger discount wins.
            </div>
          </div>
          <label className={styles.toggleSwitch}>
            <input
              type="checkbox"
              checked={!!sale.active}
              onChange={(e) => updateSale({ active: e.target.checked })}
            />
            <span className={styles.toggleTrack} />
            <span className={styles.toggleThumb} />
          </label>
        </div>

        {sale.active && (
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', padding: '0 0 1rem' }}>
            <div style={{ ...fieldWrap, maxWidth: 140 }}>
              <label style={labelStyle}>Percent off</label>
              <input
                type="number"
                min={1}
                max={100}
                className={styles.settingNumber}
                value={sale.percent ?? ''}
                onChange={(e) => updateSale({ percent: Number(e.target.value) })}
                placeholder="15"
              />
            </div>
            <div style={{ ...fieldWrap, maxWidth: 200 }}>
              <label style={labelStyle}>Ends on (optional)</label>
              <input
                type="date"
                className={styles.settingNumber}
                value={sale.ends || ''}
                onChange={(e) => updateSale({ ends: e.target.value || null })}
              />
            </div>
          </div>
        )}

        {/* ── Promo codes ────────────────────────────────────────── */}
        <div className={styles.settingRow} style={{ borderTop: '1px solid var(--border, rgba(255,255,255,.1))', paddingTop: '1rem' }}>
          <div className={styles.settingLabelWrap}>
            <div className={styles.settingLabel}>Promo codes</div>
            <div className={styles.settingHint}>
              Private codes you hand out (referrals, socials, repeat clients). Clients enter one
              at booking to get the discount — your public price stays the same.
            </div>
          </div>
        </div>

        {promoCodes.length === 0 && (
          <div style={{ color: 'var(--muted, #8a8aa0)', fontSize: '.85rem', padding: '0 0 .75rem' }}>
            No promo codes yet.
          </div>
        )}

        {promoCodes.map((c, i) => (
          <div
            key={i}
            style={{
              border: '1px solid var(--border, rgba(255,255,255,.12))',
              borderRadius: 10,
              padding: '.85rem',
              marginBottom: '.75rem',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '.75rem',
              alignItems: 'flex-end',
            }}
          >
            <div style={{ ...fieldWrap, flex: '1 1 130px' }}>
              <label style={labelStyle}>Code</label>
              <input
                type="text"
                className={styles.settingNumber}
                value={c.code}
                onChange={(e) => updateCode(i, { code: e.target.value.toUpperCase() })}
                placeholder="SPRING10"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div style={{ ...fieldWrap, flex: '0 0 120px' }}>
              <label style={labelStyle}>Type</label>
              <select
                className={styles.settingSelect}
                value={c.type}
                onChange={(e) => updateCode(i, { type: e.target.value as 'percent' | 'flat' })}
              >
                <option value="percent">% off</option>
                <option value="flat">{currencySymbol} off</option>
              </select>
            </div>
            <div style={{ ...fieldWrap, flex: '0 0 100px' }}>
              <label style={labelStyle}>{c.type === 'percent' ? 'Percent' : 'Amount'}</label>
              <input
                type="number"
                min={1}
                className={styles.settingNumber}
                value={c.value ?? ''}
                onChange={(e) => updateCode(i, { value: Number(e.target.value) })}
              />
            </div>
            <div style={{ ...fieldWrap, flex: '0 0 150px' }}>
              <label style={labelStyle}>Expires (optional)</label>
              <input
                type="date"
                className={styles.settingNumber}
                value={c.expires || ''}
                onChange={(e) => updateCode(i, { expires: e.target.value || null })}
              />
            </div>
            <div style={{ ...fieldWrap, flex: '0 0 110px' }}>
              <label style={labelStyle}>Max uses</label>
              <input
                type="number"
                min={1}
                className={styles.settingNumber}
                value={c.maxUses ?? ''}
                onChange={(e) =>
                  updateCode(i, { maxUses: e.target.value ? Number(e.target.value) : null })
                }
                placeholder="∞"
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flex: '0 0 auto' }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Active</label>
              <input
                type="checkbox"
                checked={c.active !== false}
                onChange={(e) => updateCode(i, { active: e.target.checked })}
              />
            </div>
            <div style={{ flex: '1 1 auto', display: 'flex', justifyContent: 'flex-end', gap: '.75rem', alignItems: 'center' }}>
              <span style={{ color: 'var(--muted, #8a8aa0)', fontSize: '.75rem' }}>
                {c.uses || 0} used
              </span>
              <button
                type="button"
                onClick={() => removeCode(i)}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,80,80,.4)',
                  color: '#ff6b6b',
                  borderRadius: 6,
                  padding: '.4rem .7rem',
                  fontSize: '.75rem',
                  cursor: 'pointer',
                }}
              >
                Remove
              </button>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addCode}
          style={{
            background: 'transparent',
            border: '1px dashed var(--border, rgba(255,255,255,.25))',
            color: 'var(--white, #fff)',
            borderRadius: 8,
            padding: '.6rem 1rem',
            fontSize: '.85rem',
            cursor: 'pointer',
          }}
        >
          + Add promo code
        </button>
      </div>
    </div>
  );
}
