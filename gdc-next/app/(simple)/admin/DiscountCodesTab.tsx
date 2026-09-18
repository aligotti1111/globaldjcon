'use client';

// DiscountCodesTab — admin "Promotions": paid DISCOUNT CODES.
// Unlike a comp code (free access), a discount code takes a % off a PAID
// subscription at Stripe checkout. Creating one makes a real Stripe coupon +
// promotion code; the DJ enters it in the same "Apply Promo Code" box and it
// comes off automatically when they pick a plan.

import { useState } from 'react';
import styles from './admin.module.css';
import {
  createDiscountCodeAction,
  editDiscountCodeAction,
  deactivateDiscountCodeAction,
  type DiscountCodeRow,
} from './actions';

const PERCENTS = Array.from({ length: 99 }, (_, i) => i + 1); // 1–99

export default function DiscountCodesTab({ initialCodes }: { initialCodes: DiscountCodeRow[] }) {
  const [codes, setCodes] = useState<DiscountCodeRow[]>(initialCodes);
  const [code, setCode] = useState('');
  const [percent, setPercent] = useState(20);
  const [appliesTo, setAppliesTo] = useState<'monthly' | 'yearly' | 'both'>('monthly');
  const [maxUses, setMaxUses] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [fb, setFb] = useState<{ msg: string; ok: boolean } | null>(null);
  // When set, the form is editing an existing code instead of creating one.
  const [editingId, setEditingId] = useState<string | null>(null);

  function resetForm() {
    setCode(''); setMaxUses(''); setExpiresAt(''); setNote(''); setPercent(20); setAppliesTo('monthly');
    setEditingId(null);
  }

  function startEdit(c: DiscountCodeRow) {
    setFb(null);
    setEditingId(c.id);
    setCode(c.code);
    setPercent(c.percent_off);
    setAppliesTo(c.applies_to);
    setMaxUses(c.max_redemptions != null ? String(c.max_redemptions) : '');
    setExpiresAt(c.expires_at ? c.expires_at.slice(0, 10) : '');
    setNote(c.note || '');
  }

  async function submit() {
    setFb(null);
    setBusy(true);
    try {
      if (editingId) {
        const res = await editDiscountCodeAction(editingId, {
          percent_off: percent,
          applies_to: appliesTo,
          max_redemptions: maxUses === '' ? null : Number(maxUses),
          expires_at: expiresAt || null,
          note: note || null,
        });
        if (res.success && res.code) {
          setCodes((prev) => prev.map((x) => (x.id === editingId ? (res.code as DiscountCodeRow) : x)));
          resetForm();
          setFb({ msg: '✓ Discount code updated', ok: true });
        } else {
          setFb({ msg: '✗ ' + (res.error || 'Update failed'), ok: false });
        }
      } else {
        const res = await createDiscountCodeAction({
          code,
          percent_off: percent,
          applies_to: appliesTo,
          max_redemptions: maxUses === '' ? null : Number(maxUses),
          expires_at: expiresAt || null,
          note: note || null,
        });
        if (res.success && res.code) {
          setCodes((prev) => [res.code as DiscountCodeRow, ...prev]);
          resetForm();
          setFb({ msg: '✓ Discount code created', ok: true });
        } else {
          setFb({ msg: '✗ ' + (res.error || 'Create failed'), ok: false });
        }
      }
    } catch (e) {
      setFb({ msg: '✗ ' + (e as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(c: DiscountCodeRow) {
    const next = !c.active;
    try {
      const res = await deactivateDiscountCodeAction(c.id, next);
      if (res.success) {
        setCodes((prev) => prev.map((x) => (x.id === c.id ? { ...x, active: next } : x)));
      } else {
        alert('✗ ' + (res.error || 'Update failed'));
      }
    } catch (e) {
      alert('✗ ' + (e as Error).message);
    }
  }

  return (
    <div>
      <div className={styles.formSectionLabel}>{editingId ? 'Edit Discount Code' : 'Create Discount Code'}</div>
      <p className={styles.formHint} style={{ marginTop: '-.25rem', marginBottom: '.7rem' }}>
        A discount code takes a percentage off a paid subscription at checkout. It creates a real Stripe coupon —
        DJs enter it in the same “Apply Promo Code” box and the discount applies when they pick a plan.
      </p>

      <div className={styles.formGrid}>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Code{editingId ? ' (can’t be changed)' : ''}</label>
          <input
            className={styles.formInput}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="LAUNCH20"
            style={{ textTransform: 'uppercase', opacity: editingId ? 0.6 : 1 }}
            disabled={!!editingId}
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Percent off</label>
          <select className={styles.formSelect} value={percent} onChange={(e) => setPercent(Number(e.target.value))}>
            {PERCENTS.map((p) => (
              <option key={p} value={p}>{p}% off</option>
            ))}
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
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Max uses (blank = unlimited)</label>
          <input
            className={styles.formInput}
            type="number"
            min={1}
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            placeholder="Unlimited"
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Code expires (blank = never)</label>
          <input
            className={styles.formInput}
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Note (admin only)</label>
          <input
            className={styles.formInput}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Launch promo"
          />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginTop: '.6rem' }}>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className={`${styles.btn} ${styles.btnAdmin}`}
        >
          {busy ? 'Saving…' : editingId ? 'Save Changes' : 'Create Discount Code'}
        </button>
        {editingId && (
          <button type="button" onClick={resetForm} disabled={busy} className={`${styles.btn} ${styles.btnOutline}`}>
            Cancel
          </button>
        )}
        {fb && (
          <span className={`${styles.formFb} ${fb.ok ? styles.formFbOk : styles.formFbErr}`}>{fb.msg}</span>
        )}
      </div>

      {/* Existing codes */}
      <div className={styles.usersHeaderBar} style={{ marginTop: '1.5rem' }}>
        <div className={styles.formSectionLabel} style={{ margin: 0 }}>Discount Codes</div>
        <div className={styles.usersHeaderRight}>
          <span className={styles.usersCount}>{codes.length} {codes.length === 1 ? 'code' : 'codes'}</span>
        </div>
      </div>

      {codes.length === 0 ? (
        <div className={styles.emptyAdmin}>No discount codes yet.</div>
      ) : (
        <div className={styles.adminList}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.2rem 1rem .4rem' }}>
            {(() => {
              const h: React.CSSProperties = { fontFamily: "'Space Mono', monospace", fontSize: '.58rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' };
              return (
                <>
                  <div style={{ ...h, flex: 1.2, minWidth: 120 }}>Code</div>
                  <div style={{ ...h, flex: 1, minWidth: 90 }}>Discount</div>
                  <div style={{ ...h, flex: 1, minWidth: 110 }}>Applies</div>
                  <div style={{ ...h, flex: 1, minWidth: 100 }}>Expires</div>
                  <div style={{ ...h, flex: '0 0 120px', textAlign: 'right' }}>Actions</div>
                </>
              );
            })()}
          </div>
          {codes.map((c) => (
            <div key={c.id} className={styles.adminRow}>
              <div className={styles.arName}>
                {c.code}
                {!c.active && (
                  <span style={{ marginLeft: '.4rem', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#ff8b8b', border: '1px solid #ff8b8b', borderRadius: 4, padding: '1px 5px' }}>
                    Off
                  </span>
                )}
                {c.note && <span style={{ marginLeft: '.4rem', color: 'var(--muted)', fontSize: '.75rem' }}>· {c.note}</span>}
              </div>
              <div className={styles.arDetail}>{c.percent_off}% off</div>
              <div className={styles.arDetail}>{c.applies_to === 'monthly' ? 'First month' : c.applies_to === 'yearly' ? 'First year' : 'Every payment'}</div>
              <div className={styles.arDetail} style={{ color: c.expires_at ? 'var(--white)' : '#6b6b88' }}>
                {c.expires_at ? new Date(c.expires_at).toLocaleDateString() : 'Never'}
              </div>
              <div style={{ display: 'flex', gap: '.4rem', flex: '0 0 170px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => startEdit(c)}
                  className={`${styles.btn} ${styles.btnOutline} ${styles.btnSmall}`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => toggle(c)}
                  className={`${styles.btn} ${styles.btnOutline} ${styles.btnSmall}`}
                  style={c.active ? { borderColor: '#ff8b8b', color: '#ff8b8b' } : { borderColor: 'var(--neon, #00e0a4)', color: 'var(--neon, #00e0a4)' }}
                >
                  {c.active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
