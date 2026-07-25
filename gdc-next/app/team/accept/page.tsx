'use client';

// /team/accept?token=… — the invited person lands here.
//
// Most invitees have no account yet, so this is also their signup: we send a
// 6-digit code to the invited email (signInWithOtp, which creates the account
// if new), they enter it, and their membership activates. Someone who already
// has an account gets the same code flow — it simply signs them in. If they're
// already signed in with the invited email, it activates immediately.
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export const dynamic = 'force-dynamic';

type Stage = 'loading' | 'invalid' | 'ready' | 'code' | 'working' | 'done';

export default function TeamAcceptPage() {
  const supabase = createClient();
  const [stage, setStage] = useState<Stage>('loading');
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [roleLabel, setRoleLabel] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const neon = 'var(--neon,#00e0a4)';

  // Try to link the membership for the currently signed-in user.
  async function tryAccept(tok: string): Promise<'ok' | 'auth' | string> {
    const res = await fetch('/api/team/accept', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tok }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; needsAuth?: boolean };
    if (res.status === 401 || data.needsAuth) return 'auth';
    if (res.status === 403) return 'auth'; // signed in as the wrong email — use the code path
    if (res.ok && data.ok) return 'ok';
    return data.error || 'Could not accept the invite.';
  }

  useEffect(() => {
    const tok = new URLSearchParams(window.location.search).get('token') || '';
    if (!tok) { setStage('invalid'); setErr('This invite link is missing its code.'); return; }
    setToken(tok);
    (async () => {
      // Load invite context.
      const res = await fetch(`/api/team/accept?token=${encodeURIComponent(tok)}`);
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; email?: string; ownerName?: string; role?: string; error?: string };
      if (!res.ok || !data.ok || !data.email) { setStage('invalid'); setErr(data.error || 'This invite is no longer valid.'); return; }
      setEmail(data.email);
      setOwnerName(data.ownerName || 'a DJ');
      setRoleLabel(data.role ? data.role.charAt(0).toUpperCase() + data.role.slice(1) : 'teammate');
      // Maybe they're already signed in with the right email.
      const r = await tryAccept(tok);
      if (r === 'ok') { setStage('done'); return; }
      setStage('ready');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendCode() {
    setErr(''); setStage('working'); setMsg('Sending your code…');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.toLowerCase(),
      options: { shouldCreateUser: true },
    });
    if (error) { setErr(error.message || 'Could not send the code.'); setStage('ready'); return; }
    setMsg(''); setStage('code');
  }

  async function verify() {
    const c = code.trim();
    if (c.length < 4) { setErr('Enter the 6-digit code from your email.'); return; }
    setErr(''); setStage('working'); setMsg('Verifying…');
    const { error } = await supabase.auth.verifyOtp({ email: email.toLowerCase(), token: c, type: 'email' });
    if (error) { setErr(error.message || 'That code didn\'t work. Try again.'); setStage('code'); return; }
    setMsg('Joining the team…');
    const r = await tryAccept(token);
    if (r === 'ok') { setStage('done'); return; }
    setErr(typeof r === 'string' && r !== 'auth' ? r : 'Signed in, but could not join the team. Contact whoever invited you.');
    setStage('code');
  }

  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#0d0d14', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' };
  const card: React.CSSProperties = { textAlign: 'center', maxWidth: 440, width: '100%' };
  const input: React.CSSProperties = { width: '100%', padding: '.8rem 1rem', borderRadius: 10, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.05)', color: '#fff', fontSize: '1.3rem', textAlign: 'center', letterSpacing: '.3em', boxSizing: 'border-box' };
  const btn: React.CSSProperties = { display: 'inline-block', marginTop: '1rem', width: '100%', background: neon, color: '#06231b', padding: '.85rem 1.4rem', borderRadius: 10, fontWeight: 700, border: 'none', fontSize: '1rem', cursor: 'pointer' };

  return (
    <div style={wrap}>
      <div style={card}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '.5rem' }}>Team invite</h1>

        {stage === 'loading' && <p style={{ color: 'rgba(255,255,255,.7)' }}>Loading your invite…</p>}

        {stage === 'invalid' && <p style={{ color: '#ff8f8f', lineHeight: 1.6 }}>{err}</p>}

        {(stage === 'ready' || stage === 'working') && (
          <>
            <p style={{ color: 'rgba(255,255,255,.8)', lineHeight: 1.6 }}>
              You've been invited to join <strong>{ownerName}</strong>'s account as <strong>{roleLabel}</strong>.
              We'll send a 6-digit code to <strong>{email}</strong> to set up your login — no password needed.
            </p>
            {err && <p style={{ color: '#ff8f8f', marginTop: '.7rem' }}>{err}</p>}
            <button style={btn} disabled={stage === 'working'} onClick={sendCode}>
              {stage === 'working' ? (msg || 'Working…') : 'Send my code'}
            </button>
          </>
        )}

        {stage === 'code' && (
          <>
            <p style={{ color: 'rgba(255,255,255,.8)', lineHeight: 1.6, marginBottom: '1rem' }}>
              Enter the 6-digit code we emailed to <strong>{email}</strong>.
            </p>
            <input style={input} inputMode="numeric" autoComplete="one-time-code" placeholder="••••••"
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter') verify(); }} autoFocus />
            {err && <p style={{ color: '#ff8f8f', marginTop: '.7rem' }}>{err}</p>}
            <button style={btn} onClick={verify}>Join the team</button>
            <button onClick={sendCode} style={{ marginTop: '.8rem', background: 'none', border: 'none', color: 'rgba(255,255,255,.6)', cursor: 'pointer', textDecoration: 'underline', fontSize: '.85rem' }}>
              Resend code
            </button>
          </>
        )}

        {stage === 'done' && (
          <>
            <p style={{ color: 'rgba(255,255,255,.85)', lineHeight: 1.6 }}>You're in. You now have access to {ownerName ? `${ownerName}'s` : 'the'} account.</p>
            <a href="/upcoming-bookings" style={{ ...btn, textDecoration: 'none' }}>Go to the account</a>
          </>
        )}
      </div>
    </div>
  );
}
