'use client';

import { useEffect, useState, type CSSProperties } from 'react';

// ── Payment Reminder ──────────────────────────────────────────────────
// A standalone box (own load + save, own GET/POST to /api/dj/payment-reminders)
// so it doesn't entangle the rail editor's dirty/save machinery above. Each kind
// (deposit, balance) gets up to TWO reminders, each a "days after the request was
// sent" dropdown, both defaulting to None (off). Every reminder email carries a
// one-click link to stop reminders for that one payment.

// Dropdown choices — None (off) plus a sensible spread of days-after-request.
const PR_DAY_OPTIONS = [1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60];

export function PaymentReminderBox() {
  // Each value is '' (None) or a stringified day count.
  const [d1, setD1] = useState<string>(''); // deposit reminder 1
  const [d2, setD2] = useState<string>(''); // deposit reminder 2
  const [b1, setB1] = useState<string>(''); // balance reminder 1
  const [b2, setB2] = useState<string>(''); // balance reminder 2
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ d1: string; d2: string; b1: string; b2: string } | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/dj/payment-reminders');
        const j = (await r.json().catch(() => ({}))) as {
          depositDays?: number | null; depositDays2?: number | null;
          balanceDays?: number | null; balanceDays2?: number | null;
        };
        if (cancelled) return;
        const s = (n: number | null | undefined) => (n != null ? String(n) : '');
        const next = { d1: s(j.depositDays), d2: s(j.depositDays2), b1: s(j.balanceDays), b2: s(j.balanceDays2) };
        setD1(next.d1); setD2(next.d2); setB1(next.b1); setB2(next.b2);
        setSaved(next);
      } catch { /* leave as None */ }
      finally { if (!cancelled) setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  const dirty = !!saved && (d1 !== saved.d1 || d2 !== saved.d2 || b1 !== saved.b1 || b2 !== saved.b2);

  const save = async () => {
    setSaving(true); setMsg(null);
    const num = (v: string) => (v === '' ? null : parseInt(v, 10));
    try {
      const r = await fetch('/api/dj/payment-reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depositDays: num(d1), depositDays2: num(d2), balanceDays: num(b1), balanceDays2: num(b2) }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setMsg({ text: j.error || 'Could not save.', ok: false });
      } else {
        setSaved({ d1, d2, b1, b2 });
        setMsg({ text: 'Saved.', ok: true });
      }
    } catch {
      setMsg({ text: 'Could not save.', ok: false });
    } finally { setSaving(false); }
  };

  const selectStyle: CSSProperties = {
    background: 'var(--panel, #11151a)', color: '#f4f6f8', border: '1px solid var(--border)',
    borderRadius: 7, padding: '.5rem .6rem', fontSize: '.85rem', fontFamily: "'Space Mono', monospace",
    minWidth: 150,
  };
  const groupTitle: CSSProperties = {
    fontFamily: "'Bebas Neue', Impact, sans-serif", fontSize: '1.05rem', letterSpacing: '.04em',
    color: '#aeb4bc', marginBottom: '.5rem',
  };

  // `exclude` is the sibling reminder's value — the two reminders for one kind
  // can't fire on the same day, so that option is disabled here.
  const picker = (value: string, onChange: (v: string) => void, id: string, exclude: string) => (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
      <option value="">None</option>
      {PR_DAY_OPTIONS.map((n) => (
        <option key={n} value={String(n)} disabled={exclude !== '' && String(n) === exclude}>
          {n} day{n === 1 ? '' : 's'} after request
        </option>
      ))}
    </select>
  );

  return (
    <div style={{ marginTop: '1.4rem', border: '1px solid var(--border)', borderRadius: 10, background: 'rgba(255,255,255,.02)', overflow: 'hidden' }}>
      {/* Hero banner — full-width gradient strip, same language as the
          Balance/Deposit heads above. */}
      <div style={{
        background: 'linear-gradient(90deg, rgba(0,245,196,.9), rgba(0,245,196,.12))',
        padding: '.75rem 1.1rem',
      }}>
        <div style={{ fontFamily: "'Bebas Neue', Impact, sans-serif", fontSize: '1.6rem', letterSpacing: '.04em', color: '#04121a', lineHeight: 1 }}>
          Automatic Payment Reminder
        </div>
      </div>

      <div style={{ padding: '1.1rem 1.1rem 1.2rem' }}>
      <p style={{ margin: '0 0 1.1rem', fontSize: '.78rem', color: '#8d95a0', lineHeight: 1.55 }}>
        Nudge a host who hasn&rsquo;t paid yet. Pick when to remind them — up to two reminders each for the deposit and the balance. Every email has a one-tap link to stop reminders for that payment.
      </p>

      {!loaded ? (
        <p style={{ margin: 0, fontSize: '.78rem', color: '#6b727b' }}>Loading…</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.3rem' }}>
            <div>
              <div style={groupTitle}>Deposit</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
                {picker(d1, setD1, 'pr-d1', d2)}
                {picker(d2, setD2, 'pr-d2', d1)}
              </div>
            </div>
            <div>
              <div style={groupTitle}>Balance</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
                {picker(b1, setB1, 'pr-b1', b2)}
                {picker(b2, setB2, 'pr-b2', b1)}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '.9rem', marginTop: '1.2rem' }}>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !dirty}
              style={{
                background: !saving && dirty ? 'var(--neon)' : 'transparent',
                color: !saving && dirty ? '#04121a' : 'var(--muted)',
                border: `1px solid ${!saving && dirty ? 'var(--neon)' : 'var(--border)'}`,
                borderRadius: 7, padding: '.55rem 1.2rem',
                fontFamily: "'Space Mono', monospace", fontSize: '.62rem', fontWeight: 700,
                letterSpacing: '.06em', textTransform: 'uppercase',
                cursor: !saving && dirty ? 'pointer' : 'not-allowed',
              }}
            >
              {saving ? 'Saving…' : dirty ? 'Save' : '✓ Saved'}
            </button>
            {msg && (
              <span style={{ fontSize: '.75rem', color: msg.ok ? 'var(--success)' : '#ff6b6b' }}>{msg.text}</span>
            )}
          </div>
        </>
      )}
      </div>
    </div>
  );
}
