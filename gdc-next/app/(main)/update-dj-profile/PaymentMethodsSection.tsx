'use client';

// PaymentMethodsSection — where a DJ lists how clients can pay them.
//
// Phase 1 is MANUAL rails only: the platform never touches the money. We
// publish the DJ's handle to one client, for one payment, and the DJ confirms
// what actually arrived. No processing, no custody, no chargeback liability.
//
// Self-contained: loads and saves users.payment_methods on its own, exactly
// like the email/password blocks. It does NOT go through the profile's master
// save, so a DJ can add a handle without touching the rest of the form (and
// vice-versa).
//
// WHY ITS OWN COLUMN, NOT booking_settings:
// booking_settings is serialized to every visitor of a DJ's public profile —
// it already leaks the full promo-code list. Payment handles are a worse leak:
// scraping every DJ's Zelle email and Venmo handle builds a ready-made
// phishing list. Handles only ever reach a client via the token-authed pay
// page.
//
// THE TYPO PROBLEM (why the preview exists):
// Zelle and Venmo are irreversible. A mistyped handle sends a stranger real
// money, permanently, and no deploy claws it back. So the DJ is shown their
// own handle rendered exactly as the client will see it, before it can ever be
// used. That readback is the cheapest defense that exists.

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './updateDjProfile.module.css';
import {
  METHOD_TYPES,
  TYPE_ORDER,
  isLinkable,
  isMobileOnly,
  displayHandle,
  cleanHandle,
  type PaymentMethod,
  type PaymentMethodType,
} from '@/lib/paymentMethods';

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `m${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
}

export default function PaymentMethodsSection({ userId }: { userId: string }) {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('users')
          .select('payment_methods')
          .eq('id', userId)
          .maybeSingle();
        if (cancelled) return;
        const raw = (data as { payment_methods?: unknown } | null)?.payment_methods;
        const arr = Array.isArray(raw) ? raw : [];
        setMethods(
          arr.map((r) => {
            const o = (r || {}) as Partial<PaymentMethod>;
            return {
              id: o.id || newId(),
              type: (TYPE_ORDER.includes(o.type as PaymentMethodType) ? o.type : 'zelle') as PaymentMethodType,
              handle: typeof o.handle === 'string' ? o.handle : '',
              note: typeof o.note === 'string' ? o.note : '',
              enabled: o.enabled !== false,
            };
          }),
        );
      } catch {
        // Non-fatal — an empty list is a valid state (no methods yet).
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const patch = useCallback((id: string, next: Partial<PaymentMethod>) => {
    setFeedback(null);
    setMethods((prev) => prev.map((m) => (m.id === id ? { ...m, ...next } : m)));
  }, []);

  const add = useCallback(() => {
    setFeedback(null);
    setMethods((prev) => [...prev, { id: newId(), type: 'zelle', handle: '', note: '', enabled: true }]);
  }, []);

  const remove = useCallback((id: string) => {
    setFeedback(null);
    setMethods((prev) => prev.filter((m) => m.id !== id));
  }, []);

  // Only ENABLED methods are validated. A disabled half-filled row is
  // harmless — it's never shown to a client.
  const errorFor = (m: PaymentMethod): string | null =>
    m.enabled ? METHOD_TYPES[m.type].validate(m.handle) : null;
  const firstError = methods.map(errorFor).find((e) => e) || null;
  const enabledCount = methods.filter((m) => m.enabled).length;

  async function save() {
    if (firstError) {
      setFeedback({ msg: 'Fix the highlighted method before saving.', ok: false });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const supabase = createClient();
      // Normalise on the way in so the pay page never has to guess: strip the
      // @ / $ prefixes and trim, storing the bare handle.
      const clean = methods.map((m) => ({
        id: m.id,
        type: m.type,
        handle: cleanHandle(m),
        note: m.note.trim(),
        enabled: m.enabled,
      }));
      const { error } = await supabase
        .from('users')
        .update({ payment_methods: clean } as unknown as never)
        .eq('id', userId);
      if (error) throw error;
      setFeedback({ msg: '✓ Payment methods saved.', ok: true });
      setTimeout(() => setFeedback(null), 2500);
    } catch (e) {
      setFeedback({ msg: e instanceof Error ? e.message : 'Could not save.', ok: false });
    } finally {
      setSaving(false);
    }
  }

  const label: React.CSSProperties = {
    fontFamily: "'Space Mono', monospace",
    fontSize: '.6rem',
    letterSpacing: '.08em',
    textTransform: 'uppercase',
    color: 'var(--muted)',
    marginBottom: '.35rem',
    display: 'block',
  };
  const field: React.CSSProperties = {
    width: '100%',
    background: 'var(--deep)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--white)',
    padding: '.55rem .75rem',
    fontFamily: "'DM Sans', sans-serif",
    fontSize: '.88rem',
    outline: 'none',
  };
  const btn = (primary: boolean, enabled = true): React.CSSProperties => ({
    fontFamily: "'Space Mono', monospace",
    fontSize: '.65rem',
    letterSpacing: '.08em',
    textTransform: 'uppercase',
    padding: '.6rem 1.2rem',
    borderRadius: 6,
    border: primary ? 'none' : '1px solid var(--border)',
    background: primary ? 'var(--neon)' : 'transparent',
    color: primary ? 'var(--black)' : 'var(--muted)',
    fontWeight: primary ? 700 : 400,
    cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.45,
  });

  if (!loaded) {
    return (
      <div className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Payment Methods</div>
        </div>
        <div className={styles.sectionBody}>
          <p className={styles.bodyHint}>Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>Payment Methods</div>
      </div>
      <div className={styles.sectionBody}>
        <p className={styles.bodyHint}>
          How clients can pay your deposit and invoice. They pick whichever
          they prefer — you&apos;re never handcuffing them to one. Money goes
          straight to you; Global DJ Connect never touches it and takes no cut.
        </p>

        {methods.length === 0 && (
          <p style={{ ...label, textTransform: 'none', letterSpacing: 0, fontSize: '.8rem', marginTop: '1rem' }}>
            No methods yet. Add the ones you actually use.
          </p>
        )}

        {methods.map((m) => {
          const cfg = METHOD_TYPES[m.type];
          const err = errorFor(m);
          return (
            <div
              key={m.id}
              style={{
                marginTop: '1rem',
                padding: '.9rem',
                border: `1px solid ${err ? '#ff6b6b' : 'var(--border)'}`,
                borderRadius: 8,
                background: 'rgba(255,255,255,.02)',
                opacity: m.enabled ? 1 : 0.55,
              }}
            >
              <div style={{ display: 'flex', gap: '.6rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: '0 0 130px' }}>
                  <label style={label}>Method</label>
                  <select
                    value={m.type}
                    onChange={(e) => patch(m.id, { type: e.target.value as PaymentMethodType, handle: '' })}
                    style={{ ...field, cursor: 'pointer' }}
                  >
                    {TYPE_ORDER.map((t) => (
                      <option key={t} value={t}>{METHOD_TYPES[t].label}</option>
                    ))}
                  </select>
                </div>

                {cfg.handleLabel && (
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <label style={label}>{cfg.handleLabel}</label>
                    <input
                      type="text"
                      value={m.handle}
                      onChange={(e) => patch(m.id, { handle: e.target.value })}
                      placeholder={cfg.placeholder}
                      style={field}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                )}
              </div>

              <p style={{ margin: '.5rem 0 0', fontSize: '.7rem', color: 'var(--muted)', lineHeight: 1.45 }}>
                {cfg.hint}
              </p>
              {err && (
                <p style={{ margin: '.4rem 0 0', fontSize: '.72rem', color: '#ff6b6b' }}>{err}</p>
              )}

              {/* The readback. Irreversible rails demand the DJ sees their own
                  handle exactly as the client will. */}
              {m.enabled && !err && (m.handle.trim() || m.type === 'cash') && (
                <div
                  style={{
                    marginTop: '.6rem',
                    padding: '.5rem .7rem',
                    borderRadius: 6,
                    background: 'var(--deep)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <span style={{ ...label, marginBottom: '.2rem' }}>Client sees</span>
                  <span
                    style={{
                      fontFamily: "'Space Mono', monospace",
                      fontSize: '.85rem',
                      color: 'var(--neon)',
                      wordBreak: 'break-all',
                    }}
                  >
                    {cfg.label}: {displayHandle(m)}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      marginTop: '.3rem',
                      fontSize: '.68rem',
                      color: isLinkable(m) ? 'var(--success)' : 'var(--muted)',
                    }}
                  >
                    {isLinkable(m)
                      ? (isMobileOnly(m)
                          ? '⚡ One tap on a phone — amount filled in for them'
                          : '⚡ One tap — amount filled in for them')
                      : m.type === 'cash' || m.type === 'check'
                      ? 'Handled in person'
                      : 'Client sends this manually — no link is possible'}
                  </span>
                </div>
              )}

              <div style={{ marginTop: '.7rem' }}>
                <label style={label}>Note to client (optional)</label>
                <input
                  type="text"
                  value={m.note}
                  onChange={(e) => patch(m.id, { note: e.target.value })}
                  placeholder="e.g. Put the reference code in the memo"
                  style={field}
                  autoComplete="off"
                />
              </div>

              <div style={{ display: 'flex', gap: '.8rem', alignItems: 'center', marginTop: '.7rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '.45rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={m.enabled}
                    onChange={(e) => patch(m.id, { enabled: e.target.checked })}
                    style={{ width: 15, height: 15, accentColor: 'var(--neon)', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '.78rem', color: 'var(--white)' }}>Offer this to clients</span>
                </label>
                <button
                  type="button"
                  onClick={() => remove(m.id)}
                  style={{
                    marginLeft: 'auto',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--muted)',
                    fontSize: '.72rem',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}

        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginTop: '1rem', alignItems: 'center' }}>
          <button type="button" onClick={add} style={btn(false)}>+ Add method</button>
          <button type="button" onClick={save} disabled={saving || !!firstError} style={btn(true, !saving && !firstError)}>
            {saving ? 'Saving…' : 'Save methods'}
          </button>
          {feedback && (
            <span style={{ fontSize: '.75rem', color: feedback.ok ? 'var(--success)' : '#ff6b6b' }}>
              {feedback.msg}
            </span>
          )}
        </div>

        {/* Only a warning, never a block: a DJ may legitimately want a deposit
            policy set up before they've added a handle. The request flow is
            what needs a method, not this screen. */}
        {enabledCount === 0 && methods.length > 0 && (
          <p style={{ margin: '.8rem 0 0', fontSize: '.72rem', color: 'var(--muted)' }}>
            Nothing is switched on — clients won&apos;t see a way to pay until you enable at least one.
          </p>
        )}
      </div>
    </div>
  );
}
