'use client';

// Host-facing approve/decline UI for a booking change batch. Dumb + self-
// contained: it POSTs the token + action to /api/bookings/change-response and
// swaps to a thank-you state.

import { useState } from 'react';

const NEON = '#00f5c4';
const LEGAL = 'Approving or declining here does not legally cancel or modify either party’s existing obligations. Any change must be mutually agreed upon by both parties. Global DJ Connect is not responsible for enforcing this booking or any changes to it.';

interface Change { label: string; old: string; neu: string }

export default function ChangeRespond({
  token, valid, resolved, ctx, changes,
}: {
  token: string;
  valid: boolean;
  resolved: boolean;
  ctx: { djName: string; when: string | null; venue: string | null } | null;
  changes: Change[];
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'approved' | 'declined' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function respond(action: 'approve' | 'decline') {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/bookings/change-response', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || 'Something went wrong.');
      setDone(action === 'approve' ? 'approved' : 'declined');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setBusy(false); }
  }

  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#0a0a0f', color: '#fff', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif" };
  const card: React.CSSProperties = { width: '100%', maxWidth: 520, background: '#12121a', border: '1px solid rgba(255,255,255,.12)', borderRadius: 16, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,.5)' };

  if (!valid) {
    return <div style={wrap}><div style={card}><h1 style={{ fontSize: '1.1rem', margin: '0 0 8px' }}>Link not found</h1><p style={{ color: '#8a8aa0', fontSize: '.9rem', margin: 0 }}>This approval link isn&rsquo;t valid. It may have expired or already been used.</p></div></div>;
  }
  if (done || resolved) {
    const msg = done === 'approved' ? 'Thanks — the changes are approved and applied.'
      : done === 'declined' ? 'Got it — the changes were declined and nothing was changed.'
      : 'This request has already been answered. Nothing else to do.';
    return <div style={wrap}><div style={card}><h1 style={{ fontSize: '1.1rem', margin: '0 0 8px' }}>{done === 'declined' ? 'Declined' : done === 'approved' ? 'Approved' : 'All set'}</h1><p style={{ color: '#c9c9d6', fontSize: '.92rem', margin: 0, lineHeight: 1.55 }}>{msg}</p></div></div>;
  }

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ fontFamily: "'Space Mono',ui-monospace,monospace", fontSize: '.6rem', letterSpacing: '.16em', textTransform: 'uppercase', color: NEON, marginBottom: 8 }}>Booking change request</div>
        <h1 style={{ fontSize: '1.15rem', margin: '0 0 4px' }}>{ctx?.djName} would like to update your booking</h1>
        {(ctx?.when || ctx?.venue) && <p style={{ color: '#8a8aa0', fontSize: '.86rem', margin: '0 0 16px' }}>{[ctx?.when, ctx?.venue].filter(Boolean).join(' · ')}</p>}

        <div style={{ margin: '4px 0 6px', fontSize: '.9rem', color: '#c9c9d6' }}>Please review and approve or decline:</div>
        <div style={{ border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, overflow: 'hidden', margin: '6px 0 16px' }}>
          {changes.map((c, i) => (
            <div key={i} style={{ padding: '12px 14px', borderTop: i ? '1px solid rgba(255,255,255,.08)' : 'none' }}>
              <div style={{ fontWeight: 700, fontSize: '.9rem' }}>{c.label}</div>
              <div style={{ fontSize: '.86rem', marginTop: 3 }}><span style={{ color: '#8a8aa0' }}>{c.old}</span> <span style={{ color: '#8a8aa0' }}>→</span> <span style={{ color: NEON, fontWeight: 700 }}>{c.neu}</span></div>
            </div>
          ))}
        </div>

        <p style={{ fontSize: '.72rem', color: '#8a8aa0', lineHeight: 1.5, margin: '0 0 16px', borderLeft: '3px solid #f5e642', paddingLeft: 10 }}>{LEGAL}</p>

        {err && <div style={{ color: '#ff6b6b', fontSize: '.82rem', marginBottom: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" disabled={busy} onClick={() => respond('decline')} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.22)', color: '#ff9a9a', borderRadius: 9, padding: '10px 18px', fontWeight: 700, fontSize: '.86rem', cursor: busy ? 'default' : 'pointer' }}>Decline</button>
          <button type="button" disabled={busy} onClick={() => respond('approve')} style={{ background: NEON, border: 'none', color: '#04150f', borderRadius: 9, padding: '10px 20px', fontWeight: 800, fontSize: '.86rem', cursor: busy ? 'default' : 'pointer' }}>{busy ? 'Saving…' : 'Approve changes'}</button>
        </div>
      </div>
    </div>
  );
}
