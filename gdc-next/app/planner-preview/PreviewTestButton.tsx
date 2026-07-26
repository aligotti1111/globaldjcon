'use client';

// PreviewTestButton — a floating "Send test to my email" control shown on the
// DJ's planner PREVIEW page. Posts to /api/planner/request with { test: true },
// which emails the SIGNED-IN DJ (or a teammate at their own email) exactly what
// the client would receive — and writes nothing, never touches the client.
//
// plannerId is the template currently being previewed (override or base), so
// the test matches the preview one-to-one.

import { useState } from 'react';

export default function PreviewTestButton({
  bookingId,
  plannerId,
}: {
  bookingId: string;
  plannerId?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  async function send() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    setErr(false);
    try {
      const res = await fetch('/api/planner/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, test: true, ...(plannerId ? { plannerId } : {}) }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; warning?: string; emailedTo?: string };
      if (!res.ok || !j.ok) {
        setErr(true);
        setMsg(j?.error || 'Could not send the test.');
      } else {
        setMsg(j.warning || `Test emailed to ${j.emailedTo || 'you'} — exactly what the client receives.`);
      }
    } catch {
      setErr(true);
      setMsg('Could not send the test.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed', right: 16, bottom: 16, zIndex: 9999,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8,
      }}
    >
      {msg && (
        <div
          style={{
            maxWidth: 320,
            background: err ? '#3a1212' : '#06231b',
            color: err ? '#ffb3b3' : '#8affdf',
            border: `1px solid ${err ? '#a33' : '#00e0a4'}`,
            borderRadius: 10, padding: '.6rem .8rem', fontSize: '.82rem', lineHeight: 1.4,
          }}
        >
          {msg}
        </div>
      )}
      <button
        type="button"
        onClick={send}
        disabled={busy}
        style={{
          background: '#00e0a4', color: '#06231b', border: 'none', borderRadius: 999,
          padding: '.7rem 1.2rem', fontWeight: 700, fontSize: '.9rem',
          boxShadow: '0 4px 14px rgba(0,0,0,.35)',
          cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? 'Sending…' : 'Send test to my email'}
      </button>
    </div>
  );
}
