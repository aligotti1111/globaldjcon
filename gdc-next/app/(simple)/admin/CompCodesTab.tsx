'use client';

// CompCodesTab — admin "Promotions" v1: create + manage COMP CODES.
// A comp code grants free access (a tier for N months) when a DJ redeems it at
// signup or /subscribe. No card, no Stripe. Creation/deactivation run through
// admin server actions; redemption happens in /api/comp-codes/redeem.

import { useState } from 'react';
import styles from './admin.module.css';
import {
  createCompCodeAction,
  editCompCodeAction,
  deactivateCompCodeAction,
  listCompCodeRedemptionsAction,
  type CompCodeRow,
  type CompRedemption,
} from './actions';
import { TIER_LABELS } from '@/lib/access';

const TIER_OPTIONS = [1, 2, 3, 4] as const;

export default function CompCodesTab({ initialCodes }: { initialCodes: CompCodeRow[] }) {
  const [codes, setCodes] = useState<CompCodeRow[]>(initialCodes);
  const [code, setCode] = useState('');
  const [tier, setTier] = useState(2);
  const [months, setMonths] = useState(1);
  const [maxUses, setMaxUses] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [fb, setFb] = useState<{ msg: string; ok: boolean } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  function resetForm() {
    setCode(''); setMaxUses(''); setExpiresAt(''); setNote(''); setMonths(1); setTier(2);
    setEditingId(null);
  }

  function startEdit(c: CompCodeRow) {
    setFb(null);
    setEditingId(c.id);
    setCode(c.code);
    setTier(c.grant_tier);
    setMonths(c.months);
    setMaxUses(c.max_uses != null ? String(c.max_uses) : '');
    setExpiresAt(c.expires_at ? c.expires_at.slice(0, 10) : '');
    setNote(c.note || '');
  }

  // Which code row is expanded to show its redemptions, plus a per-code cache of
  // who redeemed it (loaded on first open).
  const [openId, setOpenId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [reds, setReds] = useState<Record<string, CompRedemption[]>>({});

  async function toggleRow(id: string) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (!reds[id]) {
      setLoadingId(id);
      try {
        const res = await listCompCodeRedemptionsAction(id);
        setReds((prev) => ({ ...prev, [id]: res.redemptions || [] }));
      } catch {
        setReds((prev) => ({ ...prev, [id]: [] }));
      } finally {
        setLoadingId(null);
      }
    }
  }

  async function submit() {
    setFb(null);
    setBusy(true);
    try {
      if (editingId) {
        const res = await editCompCodeAction(editingId, {
          grant_tier: tier,
          months,
          max_uses: maxUses === '' ? null : Number(maxUses),
          expires_at: expiresAt || null,
          note: note || null,
        });
        if (res.success && res.code) {
          setCodes((prev) => prev.map((x) => (x.id === editingId ? (res.code as CompCodeRow) : x)));
          resetForm();
          setFb({ msg: '✓ Code updated', ok: true });
        } else {
          setFb({ msg: '✗ ' + (res.error || 'Update failed'), ok: false });
        }
      } else {
        const res = await createCompCodeAction({
          code,
          grant_tier: tier,
          months,
          max_uses: maxUses === '' ? null : Number(maxUses),
          expires_at: expiresAt || null,
          note: note || null,
        });
        if (res.success && res.code) {
          setCodes((prev) => [res.code as CompCodeRow, ...prev]);
          resetForm();
          setFb({ msg: '✓ Code created', ok: true });
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

  async function toggle(c: CompCodeRow) {
    const next = !c.active;
    try {
      const res = await deactivateCompCodeAction(c.id, next);
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
      <div className={styles.formSectionLabel}>{editingId ? 'Edit Comp Code' : 'Create Comp Code'}</div>
      <p className={styles.formHint} style={{ marginTop: '-.25rem', marginBottom: '.7rem' }}>
        A comp code grants free access — a plan for a number of months — when a DJ redeems it. No card, no billing.
        They drop to Free when it ends (unless they add a card to continue).
      </p>

      <div className={styles.formGrid}>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Code{editingId ? ' (can’t be changed)' : ''}</label>
          <input
            className={styles.formInput}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="SUMMER3"
            style={{ textTransform: 'uppercase', opacity: editingId ? 0.6 : 1 }}
            disabled={!!editingId}
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Plan granted</label>
          <select className={styles.formSelect} value={tier} onChange={(e) => setTier(Number(e.target.value))}>
            {TIER_OPTIONS.map((t) => (
              <option key={t} value={t}>{TIER_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Months free</label>
          <input
            className={styles.formInput}
            type="number"
            min={1}
            max={60}
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
          />
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
            placeholder="Summer promo"
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
          {busy ? 'Saving…' : editingId ? 'Save Changes' : 'Create Code'}
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
        <div className={styles.formSectionLabel} style={{ margin: 0 }}>Comp Codes</div>
        <div className={styles.usersHeaderRight}>
          <span className={styles.usersCount}>{codes.length} {codes.length === 1 ? 'code' : 'codes'}</span>
        </div>
      </div>

      {codes.length === 0 ? (
        <div className={styles.emptyAdmin}>No comp codes yet.</div>
      ) : (
        <div className={styles.adminList}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.2rem 1rem .4rem' }}>
            {(() => {
              const h: React.CSSProperties = { fontFamily: "'Space Mono', monospace", fontSize: '.58rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' };
              return (
                <>
                  <div style={{ ...h, flex: 1.2, minWidth: 120 }}>Code</div>
                  <div style={{ ...h, flex: 1, minWidth: 90 }}>Grants</div>
                  <div style={{ ...h, flex: 1, minWidth: 80 }}>Uses</div>
                  <div style={{ ...h, flex: 1, minWidth: 100 }}>Expires</div>
                  <div style={{ ...h, flex: '0 0 120px', textAlign: 'right' }}>Actions</div>
                </>
              );
            })()}
          </div>
          {codes.map((c) => {
            const isOpen = openId === c.id;
            const rowReds = reds[c.id];
            return (
            <div key={c.id}>
            <div
              className={styles.adminRow}
              onClick={() => toggleRow(c.id)}
              style={{ cursor: 'pointer' }}
              title="Click to see who redeemed this code"
            >
              <div className={styles.arName}>
                <span style={{ display: 'inline-block', width: '.8rem', color: 'var(--muted)', fontSize: '.7rem' }}>
                  {isOpen ? '▾' : '▸'}
                </span>
                {c.code}
                {!c.active && (
                  <span style={{ marginLeft: '.4rem', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#ff8b8b', border: '1px solid #ff8b8b', borderRadius: 4, padding: '1px 5px' }}>
                    Off
                  </span>
                )}
                {c.note && <span style={{ marginLeft: '.4rem', color: 'var(--muted)', fontSize: '.75rem' }}>· {c.note}</span>}
              </div>
              <div className={styles.arDetail}>
                {(TIER_LABELS[c.grant_tier as 1 | 2 | 3 | 4] ?? `Tier ${c.grant_tier}`)} · {c.months} mo
              </div>
              <div className={styles.arDetail}>
                {c.uses_count}{c.max_uses != null ? ` / ${c.max_uses}` : ''}
              </div>
              <div className={styles.arDetail} style={{ color: c.expires_at ? 'var(--white)' : '#6b6b88' }}>
                {c.expires_at ? new Date(c.expires_at).toLocaleDateString() : 'Never'}
              </div>
              <div style={{ display: 'flex', gap: '.4rem', flex: '0 0 170px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); startEdit(c); }}
                  className={`${styles.btn} ${styles.btnOutline} ${styles.btnSmall}`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggle(c); }}
                  className={`${styles.btn} ${styles.btnOutline} ${styles.btnSmall}`}
                  style={c.active ? { borderColor: '#ff8b8b', color: '#ff8b8b' } : { borderColor: 'var(--neon, #00e0a4)', color: 'var(--neon, #00e0a4)' }}
                >
                  {c.active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>

            {isOpen && (
              <div style={{ padding: '.5rem 1rem .9rem 2rem', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                {loadingId === c.id || rowReds === undefined ? (
                  <div style={{ color: 'var(--muted)', fontSize: '.8rem', padding: '.3rem 0' }}>Loading…</div>
                ) : rowReds.length === 0 ? (
                  <div style={{ color: 'var(--muted)', fontSize: '.8rem', padding: '.3rem 0' }}>No one has redeemed this code yet.</div>
                ) : (
                  <>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.58rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '.35rem' }}>
                      {rowReds.length} {rowReds.length === 1 ? 'account' : 'accounts'} redeemed
                    </div>
                    {rowReds.map((r) => (
                      <div
                        key={r.user_id}
                        style={{ display: 'flex', alignItems: 'baseline', gap: '.6rem', padding: '.28rem 0', borderTop: '1px solid rgba(255,255,255,.04)', fontSize: '.82rem' }}
                      >
                        <div style={{ flex: 1.4, minWidth: 140, color: 'var(--white)' }}>
                          {r.slug ? (
                            <a href={`/${r.slug}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: 'var(--white)' }}>
                              {r.name || 'Unnamed'}
                            </a>
                          ) : (
                            r.name || 'Unnamed'
                          )}
                        </div>
                        <div style={{ flex: 1.6, minWidth: 160, color: 'var(--muted)' }}>{r.email || '—'}</div>
                        <div style={{ flex: 1, minWidth: 110, color: 'var(--muted)' }}>
                          {(TIER_LABELS[r.granted_tier as 1 | 2 | 3 | 4] ?? `Tier ${r.granted_tier}`)} · {r.granted_months} mo
                        </div>
                        <div style={{ flex: '0 0 100px', textAlign: 'right', color: 'var(--muted)' }}>
                          {new Date(r.redeemed_at).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
            </div>
          );
          })}
        </div>
      )}
    </div>
  );
}
