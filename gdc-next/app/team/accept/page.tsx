'use client';

// /team/accept?token=… — the invited person lands here. If signed in with the
// invited email, their membership activates; otherwise they're sent to log in
// and returned here.
import { useEffect, useState } from 'react';

export const dynamic = 'force-dynamic';

export default function TeamAcceptPage() {
  const [msg, setMsg] = useState('Accepting your invite…');
  const [ok, setOk] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token') || '';
    if (!token) { setMsg('This invite link is missing its code.'); return; }
    (async () => {
      try {
        const res = await fetch('/api/team/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; needsAuth?: boolean };
        if (res.status === 401 || data.needsAuth) {
          window.location.href = `/login?redirect=${encodeURIComponent('/team/accept?token=' + token)}`;
          return;
        }
        if (res.ok && data.ok) { setOk(true); setMsg("You're in. You now have access to the account."); }
        else setMsg(data.error || 'Could not accept the invite.');
      } catch { setMsg('Could not accept the invite. Please try again.'); }
    })();
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d14', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '.6rem' }}>Team invite</h1>
        <p style={{ color: 'rgba(255,255,255,.75)', lineHeight: 1.6 }}>{msg}</p>
        {ok && <a href="/upcoming-bookings" style={{ display: 'inline-block', marginTop: '1.2rem', background: 'var(--neon,#00e0a4)', color: '#06231b', padding: '.7rem 1.4rem', borderRadius: 8, fontWeight: 700, textDecoration: 'none' }}>Go to the account</a>}
      </div>
    </div>
  );
}
