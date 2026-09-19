'use client';

// SiteSalesTab — admin "Promotions": SITE-WIDE SALES (auto-applied, no code).
//   • percent → a % off paid plans at checkout (Stripe coupon), applied to
//     everyone; bigger of it and a personal code wins.
//   • free    → new DJ signups during the window get free access (a plan for N
//     months), no card; they drop to Free when it ends.
// Scheduled by a date window + an on/off toggle.

import { useState } from 'react';
import styles from './admin.module.css';
import {
  createSiteSaleAction,
  deactivateSiteSaleAction,
  type SiteSaleRow,
} from './actions';
import { TIER_LABELS } from '@/lib/access';

const PERCENTS = Array.from({ length: 99 }, (_, i) => i + 1);
const TIER_OPTIONS = [1, 2, 3, 4] as const;

export default function SiteSalesTab({ initialSales }: { initialSales: SiteSaleRow[] }) {
  const [sales, setSales] = useState<SiteSaleRow[]>(initialSales);
  const [kind, setKind] = useState<'percent' | 'free'>('percent');
  const [percent, setPercent] = useState(20);
  const [appliesTo, setAppliesTo] = useState<'monthly' | 'yearly' | 'both'>('monthly');
  const [tier, setTier] = useState(2);
  const [months, setMonths] = useState(1);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [fb, setFb] = useState<{ msg: string; ok: boolean } | null>(null);

  async function create() {
    setFb(null);
    setBusy(true);
    try {
      const res = await createSiteSaleAction({
        kind,
        percent_off: kind === 'percent' ? percent : null,
        applies_to: kind === 'percent' ? appliesTo : null,
        grant_tier: kind === 'free' ? tier : null,
        grant_months: kind === 'free' ? months : null,
        starts_at: startsAt || null,
        ends_at: endsAt || null,
        note: note || null,
      });
      if (res.success && res.sale) {
        setSales((prev) => [res.sale as SiteSaleRow, ...prev]);
        setStartsAt(''); setEndsAt(''); setNote(''); setPercent(20); setAppliesTo('monthly'); setTier(2); setMonths(1);
        setFb({ msg: '✓ Sale created', ok: true });
      } else {
        setFb({ msg: '✗ ' + (res.error || 'Create failed'), ok: false });
      }
    } catch (e) {
      setFb({ msg: '✗ ' + (e as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(s: SiteSaleRow) {
    const next = !s.active;
    try {
      const res = await deactivateSiteSaleAction(s.id, next);
      if (res.success) setSales((prev) => prev.map((x) => (x.id === s.id ? { ...x, active: next } : x)));
      else alert('✗ ' + (res.error || 'Update failed'));
    } catch (e) {
      alert('✗ ' + (e as Error).message);
    }
  }

  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');

  return (
    <div>
      <div className={styles.formSectionLabel}>Create Site-Wide Sale</div>
      <p className={styles.formHint} style={{ marginTop: '-.25rem', marginBottom: '.7rem' }}>
        A site-wide sale applies automatically to everyone during its date window — no code needed. A <b>% off</b> sale
        discounts paid plans at checkout; a <b>free</b> sale gives new DJ signups free access (no card) that drops to Free when it ends.
      </p>

      <div className={styles.formGrid} style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Sale type</label>
          <select className={styles.formSelect} value={kind} onChange={(e) => setKind(e.target.value as 'percent' | 'free')}>
            <option value="percent">% off paid plans</option>
            <option value="free">Free for new signups (no card)</option>
          </select>
        </div>

        {kind === 'percent' ? (
          <>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Percent off</label>
              <select className={styles.formSelect} value={percent} onChange={(e) => setPercent(Number(e.target.value))}>
                {PERCENTS.map((p) => <option key={p} value={p}>{p}% off</option>)}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Applies to</label>
              <select className={styles.formSelect} value={appliesTo} onChange={(e) => setAppliesTo(e.target.value as 'monthly' | 'yearly' | 'both')}>
                <option value="monthly">First month (monthly plans)</option>
                <option value="yearly">First year (yearly plans)</option>
                <option value="both">Every payment (forever)</option>
              </select>
            </div>
          </>
        ) : (
          <>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Plan granted free</label>
              <select className={styles.formSelect} value={tier} onChange={(e) => setTier(Number(e.target.value))}>
                {TIER_OPTIONS.map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Months free</label>
              <input className={styles.formInput} type="number" min={1} max={60} value={months} onChange={(e) => setMonths(Number(e.target.value))} />
            </div>
          </>
        )}

        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Starts (blank = now)</label>
          <input className={styles.formInput} type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Ends (blank = no end)</label>
          <input className={styles.formInput} type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginTop: '.6rem' }}>
        <button type="button" onClick={create} disabled={busy} className={`${styles.btn} ${styles.btnAdmin}`}>
          {busy ? 'Creating…' : 'Create Sale'}
        </button>
        {fb && <span className={`${styles.formFb} ${fb.ok ? styles.formFbOk : styles.formFbErr}`}>{fb.msg}</span>}
      </div>

      {/* Existing sales */}
      <div className={styles.usersHeaderBar} style={{ marginTop: '1.5rem' }}>
        <div className={styles.formSectionLabel} style={{ margin: 0 }}>Site-Wide Sales</div>
        <div className={styles.usersHeaderRight}>
          <span className={styles.usersCount}>{sales.length} {sales.length === 1 ? 'sale' : 'sales'}</span>
        </div>
      </div>

      {sales.length === 0 ? (
        <div className={styles.emptyAdmin}>No site-wide sales yet.</div>
      ) : (
        <div className={styles.adminList}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.2rem 1rem .4rem' }}>
            {(() => {
              const h: React.CSSProperties = { fontFamily: "'Space Mono', monospace", fontSize: '.58rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' };
              return (
                <>
                  <div style={{ ...h, flex: 1.4, minWidth: 150 }}>Sale</div>
                  <div style={{ ...h, flex: 1, minWidth: 110 }}>Applies</div>
                  <div style={{ ...h, flex: 1.2, minWidth: 150 }}>Window</div>
                  <div style={{ ...h, flex: '0 0 120px', textAlign: 'right' }}>Actions</div>
                </>
              );
            })()}
          </div>
          {sales.map((s) => (
            <div key={s.id} className={styles.adminRow}>
              <div className={styles.arName}>
                {s.kind === 'percent'
                  ? `${s.percent_off}% off`
                  : `${TIER_LABELS[s.grant_tier as 1 | 2 | 3 | 4] ?? `Tier ${s.grant_tier}`} free · ${s.grant_months} mo`}
                {!s.active && (
                  <span style={{ marginLeft: '.4rem', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#ff8b8b', border: '1px solid #ff8b8b', borderRadius: 4, padding: '1px 5px' }}>
                    Off
                  </span>
                )}
                {s.note && <span style={{ marginLeft: '.4rem', color: 'var(--muted)', fontSize: '.75rem' }}>· {s.note}</span>}
              </div>
              <div className={styles.arDetail}>
                {s.kind === 'free'
                  ? 'New signups'
                  : s.applies_to === 'monthly' ? 'First month'
                  : s.applies_to === 'yearly' ? 'First year'
                  : 'Every payment'}
              </div>
              <div className={styles.arDetail}>{fmtDate(s.starts_at)} → {fmtDate(s.ends_at)}</div>
              <div style={{ display: 'flex', gap: '.4rem', flex: '0 0 120px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => toggle(s)}
                  className={`${styles.btn} ${styles.btnOutline} ${styles.btnSmall}`}
                  style={s.active ? { borderColor: '#ff8b8b', color: '#ff8b8b' } : { borderColor: 'var(--neon, #00e0a4)', color: 'var(--neon, #00e0a4)' }}
                >
                  {s.active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
