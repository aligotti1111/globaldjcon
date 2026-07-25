'use client';

// TeamSection — owner-facing team management (Account settings). Self-contained:
// loads /api/team, shows seats used/limit, invites by email + role, changes
// roles, removes members. Hidden behind Pro+ (seatLimit 0 → upgrade prompt).

import { useEffect, useState, useCallback, Fragment } from 'react';
import Link from 'next/link';
import styles from './accountSettings.module.css';
import { TEAM_ROLES, roleMatrix, type TeamRole } from '@/lib/team';

interface Member { id: string; invited_email: string; role: string; status: string; member_id: string | null; can_addons: boolean; }

export default function TeamSection({ djType }: { djType?: string | null }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [seatLimit, setSeatLimit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('assistant');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null); // member pending remove-confirmation
  const [viewerId, setViewerId] = useState<string | null>(null); // the logged-in user's id (an admin sees their own row)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/team');
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; members?: Member[]; seatLimit?: number; viewerId?: string };
      if (res.ok && data.ok) { setMembers(data.members || []); setSeatLimit(data.seatLimit || 0); setViewerId(data.viewerId ?? null); }
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function invite() {
    setBusy(true); setErr(null); setNote(null);
    try {
      const res = await fetch('/api/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, role }) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; warning?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not invite.');
      setNote(data.warning || `Invite sent to ${email}.`); setEmail(''); load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not invite.'); }
    finally { setBusy(false); }
  }
  async function changeRole(id: string, r: string) {
    await fetch('/api/team', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, role: r }) });
    load();
  }
  async function toggleAddons(id: string, val: boolean) {
    await fetch('/api/team', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, canAddons: val }) });
    load();
  }
  async function remove(id: string) {
    setConfirmId(null);
    await fetch('/api/team', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    load();
  }

  if (loading) return null;
  const muted = 'var(--muted,#8a8aa0)';

  return (
    <div className={styles.card}>
      <h2>Team</h2>
      {seatLimit <= 0 ? (
        <p style={{ color: muted, fontSize: '.85rem', lineHeight: 1.6 }}>
          Team seats let you give staff their own restricted logins.{' '}
          <Link href="/subscribe" style={{ color: 'var(--neon,#00e0a4)', fontWeight: 700 }}>Upgrade to Pro</Link> to add teammates.
        </p>
      ) : (
        <>
          <p style={{ color: muted, fontSize: '.82rem', lineHeight: 1.6, margin: '0 0 1rem' }}>
            {members.length} of {seatLimit} seats used. Teammates log in with their own email and get the access you choose.
          </p>

          {members.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', marginBottom: '1rem' }}>
              {members.map((m) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', padding: '.5rem .7rem', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8 }}>
                  <span style={{ flex: '1 1 100%', minWidth: 0, fontSize: '.88rem', wordBreak: 'break-all' }}>
                    {m.invited_email}{m.status === 'invited' && <span style={{ color: muted }}> · pending</span>}
                  </span>
                  {m.member_id && m.member_id === viewerId ? (
                    <span style={{ fontSize: '.78rem', color: muted, whiteSpace: 'nowrap' }}>
                      {(TEAM_ROLES.find((r) => r.value === m.role)?.label) || m.role} · you
                    </span>
                  ) : (
                    <>
                      <select value={m.role} onChange={(e) => changeRole(m.id, e.target.value)} style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 6, padding: '.25rem .4rem', fontSize: '.8rem' }}>
                        {TEAM_ROLES.map((r) => <option key={r.value} value={r.value} style={{ color: '#000' }}>{r.label}</option>)}
                      </select>
                      {djType !== 'mobile' && (m.role === 'admin' || m.role === 'manager') && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: '.72rem', color: muted, whiteSpace: 'nowrap' }} title="Let this teammate turn the Rider & Guest List on/off and edit the default rider">
                          <input type="checkbox" checked={m.can_addons !== false} onChange={(e) => toggleAddons(m.id, e.target.checked)} />
                          Rider/guest-list settings
                        </label>
                      )}
                      <button type="button" onClick={() => setConfirmId(m.id)} style={{ background: 'transparent', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '.8rem' }}>Remove</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Role breakdown — a matrix so the owner can compare at a glance. */}
          <div style={{ border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, padding: '.8rem .9rem', margin: '0 0 1rem', overflowX: 'auto' }}>
            <div style={{ fontWeight: 700, fontSize: '.82rem', marginBottom: '.6rem' }}>What each role can do</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px,1.6fr) repeat(3, minmax(52px,1fr))', gap: '.35rem .4rem', alignItems: 'center', fontSize: '.74rem', minWidth: 320 }}>
              <div />
              <div style={{ textAlign: 'center', fontWeight: 700, color: 'var(--neon,#00e0a4)' }}>Admin</div>
              <div style={{ textAlign: 'center', fontWeight: 700, color: 'var(--neon,#00e0a4)' }}>Manager</div>
              <div style={{ textAlign: 'center', fontWeight: 700, color: 'var(--neon,#00e0a4)' }}>Assistant</div>
              {roleMatrix(djType).map((cap) => {
                const cell = (ok: boolean) => (
                  <div style={{ textAlign: 'center', color: ok ? 'var(--neon,#00e0a4)' : '#ff6b6b', fontWeight: 700 }}>{ok ? '\u2713' : '\u2717'}</div>
                );
                return (
                  <Fragment key={cap.label}>
                    <div style={{ color: 'rgba(255,255,255,.82)' }}>{cap.label}</div>
                    {cell(cap.admin)}
                    {cell(cap.manager)}
                    {cell(cap.assistant)}
                  </Fragment>
                );
              })}
            </div>
            <div style={{ fontSize: '.72rem', color: muted, marginTop: '.6rem', paddingTop: '.5rem', borderTop: '1px solid rgba(255,255,255,.08)' }}>
              Only you (the Owner) control billing, the subscription, and booking settings.
            </div>
          </div>

          {members.length < seatLimit ? (
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@email.com" style={{ flex: 1, minWidth: 180, background: 'var(--panel-2,rgba(255,255,255,.04))', border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, color: '#fff', padding: '.5rem .6rem', fontSize: '.85rem' }} />
              <select value={role} onChange={(e) => setRole(e.target.value as TeamRole)} style={{ background: 'var(--panel-2,rgba(255,255,255,.04))', color: '#fff', border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, padding: '.5rem .4rem', fontSize: '.85rem' }}>
                {TEAM_ROLES.map((r) => <option key={r.value} value={r.value} style={{ color: '#000' }}>{r.label}</option>)}
              </select>
              <button type="button" onClick={invite} disabled={busy || !email} style={{ background: 'var(--neon,#00e0a4)', border: 'none', borderRadius: 8, color: '#06231b', padding: '.5rem 1rem', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer' }}>{busy ? 'Sending…' : 'Invite'}</button>
            </div>
          ) : (
            <p style={{ color: muted, fontSize: '.8rem' }}>All seats used. Remove a member, or upgrade for more.</p>
          )}
          {err && <div style={{ color: '#ff8f8f', fontSize: '.82rem', marginTop: '.6rem' }}>{err}</div>}
          {note && !err && <div style={{ color: 'var(--neon,#00e0a4)', fontSize: '.82rem', marginTop: '.6rem' }}>{note}</div>}
        </>
      )}

      {/* Remove-teammate confirmation — styled modal popup. */}
      {(() => {
        const cm = members.find((m) => m.id === confirmId);
        if (!cm) return null;
        const pending = cm.status === 'invited';
        return (
          <div
            onClick={() => setConfirmId(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(4,4,10,.65)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ background: '#14141c', border: '1px solid rgba(255,255,255,.14)', borderRadius: 16, padding: '1.5rem', maxWidth: 400, width: '100%', boxShadow: '0 24px 70px rgba(0,0,0,.55)' }}
            >
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,107,107,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '.9rem' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg>
              </div>
              <h3 style={{ margin: '0 0 .5rem', fontSize: '1.15rem', color: '#fff' }}>Remove {pending ? 'invite' : 'teammate'}?</h3>
              <p style={{ margin: '0 0 1.3rem', fontSize: '.85rem', color: muted, lineHeight: 1.6 }}>
                <strong style={{ color: '#fff' }}>{cm.invited_email}</strong> will {pending ? 'no longer be able to accept this invite' : 'immediately lose access, and their staff account is deleted (freeing their email)'}. This frees the seat — you can re-invite them anytime.
              </p>
              <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setConfirmId(null)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,.25)', borderRadius: 8, color: '#fff', padding: '.6rem 1.1rem', cursor: 'pointer', fontSize: '.85rem', fontWeight: 600 }}>Cancel</button>
                <button type="button" onClick={() => remove(cm.id)} style={{ background: '#ff6b6b', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, padding: '.6rem 1.2rem', cursor: 'pointer', fontSize: '.85rem' }}>Remove</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
