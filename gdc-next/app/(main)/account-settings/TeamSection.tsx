'use client';

// TeamSection — owner-facing team management (Account settings). Self-contained:
// loads /api/team, shows seats used/limit, invites by email + role, changes
// roles, removes members. Hidden behind Pro+ (seatLimit 0 → upgrade prompt).

import { useEffect, useState, useCallback, Fragment, type CSSProperties } from 'react';
import Link from 'next/link';
import styles from './accountSettings.module.css';
import SectionBanner from '../update-dj-profile/SectionBanner';
import { TEAM_ROLES, roleMatrix, type TeamRole } from '@/lib/team';

interface Member { id: string; invited_email: string; name: string | null; role: string; status: string; member_id: string | null; can_addons: boolean; }
interface Owner { id: string; name: string | null; email: string | null; }
interface EntryBooking { date: string | null; venue: string | null; host: string | null; eventType: string | null; }
interface Entry { id: string; actorId: string; actorName: string; actorRole: string | null; action: string; summary: string; bookingId: string | null; booking: EntryBooking | null; createdAt: string; }

function dayKey(iso: string): string { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function dayLabel(iso: string): string { return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); }
function timeLabel(iso: string): string { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
function eventDateLabel(d: string | null): string {
  if (!d) return '';
  return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TeamSection({ djType }: { djType?: string | null }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [seatLimit, setSeatLimit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('assistant');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null); // member pending remove-confirmation
  const [viewerId, setViewerId] = useState<string | null>(null); // the logged-in user's id (an admin sees their own row)
  const [pendingRoles, setPendingRoles] = useState<Record<string, string>>({}); // draft role per member (not yet saved)
  const [highlightRole, setHighlightRole] = useState<TeamRole | null>(null); // column to highlight in the chart
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [owner, setOwner] = useState<Owner | null>(null);
  // Per-person activity log: fetched once (owner-only endpoint), expanded inline.
  const [activity, setActivity] = useState<Entry[] | null>(null);
  const [activityErr, setActivityErr] = useState<string | null>(null);
  const [openLogId, setOpenLogId] = useState<string | null>(null); // actorId currently expanded

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/team');
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; owner?: Owner; members?: Member[]; seatLimit?: number; viewerId?: string };
      if (res.ok && data.ok) { setOwner(data.owner ?? null); setMembers(data.members || []); setSeatLimit(data.seatLimit || 0); setViewerId(data.viewerId ?? null); }
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Lazy-load the account's activity the first time a log is opened. The endpoint
  // is owner-only, so this only ever succeeds for the owner viewer.
  async function ensureActivity() {
    if (activity || activityErr) return;
    try {
      const res = await fetch('/api/team/activity');
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; entries?: Entry[]; error?: string };
      if (!res.ok || !j.ok) { setActivityErr(j.error || 'Could not load activity.'); return; }
      setActivity(j.entries || []);
    } catch { setActivityErr('Could not load activity.'); }
  }
  function toggleLog(actorId: string) {
    setOpenLogId((cur) => (cur === actorId ? null : actorId));
    void ensureActivity();
  }

  async function invite() {
    setBusy(true); setErr(null); setNote(null);
    try {
      const res = await fetch('/api/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, role }) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; warning?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not invite.');
      setNote(data.warning || `Invite sent to ${name.trim() || email}.`); setName(''); setEmail(''); setHighlightRole(null); load();
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
    <div className={styles.card} style={{ padding: 0, overflow: 'hidden' }}>
      {/* Hero header — flush to the card edges, same as Booking Settings. */}
      <SectionBanner icon="guests" title="Team" subtitle="Give staff their own restricted logins." />
      <div style={{ padding: '1.5rem' }}>
      {seatLimit <= 0 ? (
        <p style={{ color: muted, fontSize: '.85rem', lineHeight: 1.6 }}>
          Team seats let you give staff their own restricted logins.{' '}
          <Link href="/subscribe" style={{ color: 'var(--neon,#00e0a4)', fontWeight: 700 }}>Upgrade to Pro</Link> to add teammates.
        </p>
      ) : (
        <>
          <p style={{ color: muted, fontSize: '.82rem', lineHeight: 1.6, margin: '0 0 .75rem' }}>
            {members.length} of {seatLimit} seats used. Teammates log in with their own email and get the access you choose. Change a role, then <strong style={{ color: '#fff' }}>Save</strong> — the new access applies to their account right away.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', marginBottom: '1rem' }}>
              {/* OWNER — pinned at the top. No seat, no role dropdown, never
                  removable. Shown so the list is complete and the owner's own
                  activity is auditable. */}
              {owner && (() => {
                const ownerViewer = owner.id === viewerId;
                const open = openLogId === owner.id;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', padding: '.6rem .8rem', border: '1px solid rgba(0,224,164,.3)', borderRadius: 8, background: 'rgba(0,224,164,.04)' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '.75rem', flexWrap: 'wrap' }}>
                      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                        {owner.name && <div style={{ fontSize: '.9rem', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{owner.name}</div>}
                        {owner.email && <div style={{ fontSize: owner.name ? '.76rem' : '.88rem', color: owner.name ? muted : '#fff', wordBreak: 'break-all', lineHeight: 1.4 }}>{owner.email}</div>}
                      </div>
                      {/* Status pill, top-right — matches the teammate rows. */}
                      <span style={{ display: 'inline-block', fontSize: '.62rem', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--neon,#00e0a4)', background: 'rgba(0,224,164,.14)', border: '1px solid rgba(0,224,164,.4)', borderRadius: 999, padding: '.12rem .55rem', whiteSpace: 'nowrap' }}>
                        Owner{ownerViewer ? ' · you' : ''}
                      </span>
                    </div>
                    {/* Activity log, bottom-left. */}
                    {ownerViewer && (
                      <div>
                        <button type="button" onClick={() => toggleLog(owner.id)} style={logBtnStyle(open)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="9" /></svg>
                          Activity log {open ? '▾' : '▸'}
                        </button>
                        {open && <ActorLog entries={activity} err={activityErr} actorId={owner.id} />}
                      </div>
                    )}
                  </div>
                );
              })()}
              {members.map((m) => {
                const ownerViewer = !!owner && owner.id === viewerId;
                const logOpen = openLogId === (m.member_id || '');
                return (
                <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', padding: '.6rem .8rem', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                      {m.name && (
                        <div style={{ fontSize: '.9rem', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
                      )}
                      <div style={{ fontSize: m.name ? '.76rem' : '.88rem', color: m.name ? muted : '#fff', wordBreak: 'break-all', lineHeight: 1.4 }}>
                        {m.invited_email}{m.status === 'invited' && <span style={{ color: muted }}> · pending</span>}
                      </div>
                    </div>
                    {m.member_id && m.member_id === viewerId ? (
                      <span style={{ fontSize: '.78rem', color: muted, whiteSpace: 'nowrap' }}>
                        {(TEAM_ROLES.find((r) => r.value === m.role)?.label) || m.role} · you
                      </span>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <select
                          value={pendingRoles[m.id] ?? m.role}
                          onChange={(e) => setPendingRoles((prev) => ({ ...prev, [m.id]: e.target.value }))}
                          style={{ background: 'transparent', color: '#fff', border: `1px solid ${(pendingRoles[m.id] && pendingRoles[m.id] !== m.role) ? 'var(--neon,#00e0a4)' : 'rgba(255,255,255,.2)'}`, borderRadius: 6, padding: '.25rem .4rem', fontSize: '.8rem' }}
                        >
                          {TEAM_ROLES.map((r) => <option key={r.value} value={r.value} style={{ color: '#000' }}>{r.label}</option>)}
                        </select>
                        {djType !== 'mobile' && (m.role === 'admin' || m.role === 'manager') && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: '.72rem', color: muted, whiteSpace: 'nowrap' }} title="Let this teammate turn the Rider & Guest List on/off and edit the default rider">
                            <input type="checkbox" checked={m.can_addons !== false} onChange={(e) => toggleAddons(m.id, e.target.checked)} />
                            Rider/guest-list settings
                          </label>
                        )}
                        <button type="button" onClick={() => setConfirmId(m.id)} style={{ background: 'transparent', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '.8rem' }}>Remove</button>
                      </div>
                    )}
                  </div>
                  {/* Per-teammate activity log — owner viewer only, and only for
                      accepted teammates (a pending invite has no activity yet). */}
                  {ownerViewer && m.member_id && (
                    <div>
                      <button type="button" onClick={() => toggleLog(m.member_id as string)} style={logBtnStyle(logOpen)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="9" /></svg>
                        Activity log {logOpen ? '▾' : '▸'}
                      </button>
                      {logOpen && <ActorLog entries={activity} err={activityErr} actorId={m.member_id} />}
                    </div>
                  )}
                </div>
                );
              })}
            </div>

          {/* One Save for all pending role changes — sits under the list, before
              the chart. Greyed until at least one role has been changed. */}
          {members.length > 0 && (() => {
            const dirtyIds = Object.keys(pendingRoles).filter((id) => {
              const m = members.find((x) => x.id === id);
              return !!(m && pendingRoles[id] && pendingRoles[id] !== m.role);
            });
            const dirty = dirtyIds.length > 0;
            const saving = savingRole === 'ALL';
            return (
              <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '0 0 1rem' }}>
                <button
                  type="button"
                  disabled={!dirty || saving}
                  title={dirty ? undefined : 'No role changes to save'}
                  onClick={async () => {
                    setSavingRole('ALL');
                    for (const id of dirtyIds) {
                      await fetch('/api/team', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, role: pendingRoles[id] }) });
                    }
                    setPendingRoles({});
                    setSavingRole(null);
                    load();
                  }}
                  style={{ background: dirty ? 'var(--neon,#00e0a4)' : 'transparent', border: `1px solid ${dirty ? 'var(--neon,#00e0a4)' : 'rgba(255,255,255,.18)'}`, borderRadius: 6, color: dirty ? '#06231b' : muted, padding: '.4rem 1.1rem', fontWeight: 700, fontSize: '.8rem', cursor: dirty ? 'pointer' : 'not-allowed', opacity: dirty ? 1 : 0.55 }}
                >
                  {saving ? 'Saving…' : dirty ? `Save role change${dirtyIds.length > 1 ? 's' : ''}` : 'Save role changes'}
                </button>
              </div>
            );
          })()}

          {/* Role breakdown — a matrix so the owner can compare at a glance. */}
          <div style={{ border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, padding: '.8rem .9rem', margin: '0 0 1rem', overflowX: 'auto' }}>
            <div style={{ fontWeight: 700, fontSize: '.82rem', marginBottom: '.6rem' }}>What each role can do</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px,1.6fr) repeat(3, minmax(52px,1fr))', gap: '.35rem .4rem', alignItems: 'center', fontSize: '.74rem', minWidth: 320 }}>
              <div />
              <div style={{ textAlign: 'center', fontWeight: 700, color: 'var(--neon,#00e0a4)', borderRadius: 4, background: highlightRole === 'admin' ? 'rgba(0,224,164,.16)' : undefined, boxShadow: highlightRole === 'admin' ? '0 0 0 1px rgba(0,224,164,.5)' : undefined }}>Admin</div>
              <div style={{ textAlign: 'center', fontWeight: 700, color: 'var(--neon,#00e0a4)', borderRadius: 4, background: highlightRole === 'manager' ? 'rgba(0,224,164,.16)' : undefined, boxShadow: highlightRole === 'manager' ? '0 0 0 1px rgba(0,224,164,.5)' : undefined }}>Manager</div>
              <div style={{ textAlign: 'center', fontWeight: 700, color: 'var(--neon,#00e0a4)', borderRadius: 4, background: highlightRole === 'assistant' ? 'rgba(0,224,164,.16)' : undefined, boxShadow: highlightRole === 'assistant' ? '0 0 0 1px rgba(0,224,164,.5)' : undefined }}>Assistant</div>
              {roleMatrix(djType).map((cap) => {
                const cell = (ok: boolean, role: TeamRole) => (
                  <div style={{ textAlign: 'center', color: ok ? 'var(--neon,#00e0a4)' : '#ff6b6b', fontWeight: 700, borderRadius: 4, background: highlightRole === role ? 'rgba(0,224,164,.10)' : undefined }}>{ok ? '✓' : '✗'}</div>
                );
                return (
                  <Fragment key={cap.label}>
                    <div style={{ color: 'rgba(255,255,255,.82)' }}>{cap.label}</div>
                    {cell(cap.admin, 'admin')}
                    {cell(cap.manager, 'manager')}
                    {cell(cap.assistant, 'assistant')}
                  </Fragment>
                );
              })}
            </div>
            <div style={{ fontSize: '.72rem', color: muted, marginTop: '.6rem', paddingTop: '.5rem', borderTop: '1px solid rgba(255,255,255,.08)' }}>
              Only you (the Owner) control billing, the subscription, booking settings, and account settings.
            </div>
          </div>

          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.7rem', letterSpacing: '.08em', textTransform: 'uppercase', color: muted, margin: '0 0 .55rem' }}>
            Add teammate
          </div>
          {members.length < seatLimit ? (
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Their name" style={{ flex: '1 1 140px', minWidth: 120, background: 'var(--panel-2,rgba(255,255,255,.04))', border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, color: '#fff', padding: '.5rem .6rem', fontSize: '.85rem' }} />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@email.com" style={{ flex: '2 1 180px', minWidth: 180, background: 'var(--panel-2,rgba(255,255,255,.04))', border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, color: '#fff', padding: '.5rem .6rem', fontSize: '.85rem' }} />
              <select
                value={role}
                onFocus={() => setHighlightRole(role)}
                onChange={(e) => { setRole(e.target.value as TeamRole); setHighlightRole(e.target.value as TeamRole); }}
                style={{ background: 'var(--panel-2,rgba(255,255,255,.04))', color: '#fff', border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, padding: '.5rem .4rem', fontSize: '.85rem' }}
              >
                {TEAM_ROLES.map((r) => <option key={r.value} value={r.value} style={{ color: '#000' }}>{r.label}</option>)}
              </select>
              {/* Invite sits on the right — pushed to the far edge of the row. */}
              <button type="button" onClick={invite} disabled={busy || !email} style={{ marginLeft: 'auto', background: 'var(--neon,#00e0a4)', border: 'none', borderRadius: 8, color: '#06231b', padding: '.5rem 1rem', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer' }}>{busy ? 'Sending…' : 'Invite'}</button>
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

      </div>{/* end inner padding wrapper */}
    </div>
  );
}

const MUTED = 'var(--muted,#8a8aa0)';
function logBtnStyle(open: boolean): CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: '.4rem',
    background: open ? 'rgba(0,224,164,.1)' : 'transparent',
    border: `1px solid ${open ? 'var(--neon,#00e0a4)' : 'rgba(255,255,255,.2)'}`,
    borderRadius: 8, color: open ? 'var(--neon,#00e0a4)' : '#fff',
    padding: '.35rem .8rem', fontSize: '.76rem', fontWeight: 600, cursor: 'pointer',
  };
}

// One person's activity, newest first, PAGED (a fixed number of entries per
// page with Prev / Next). The current page is grouped by day. Read-only.
const LOG_PAGE_SIZE = 20;
function ActorLog({ entries, err, actorId }: { entries: Entry[] | null; err: string | null; actorId: string }) {
  const [page, setPage] = useState(0);
  if (err) return <div style={{ color: '#ff9a9a', fontSize: '.8rem', marginTop: '.5rem' }}>{err}</div>;
  if (!entries) return <div style={{ color: MUTED, fontSize: '.8rem', marginTop: '.5rem' }}>Loading…</div>;
  const mine = entries.filter((e) => e.actorId === actorId);
  if (!mine.length) return <div style={{ color: MUTED, fontSize: '.8rem', marginTop: '.5rem' }}>No activity recorded yet.</div>;

  const pageCount = Math.ceil(mine.length / LOG_PAGE_SIZE);
  const safePage = Math.min(page, pageCount - 1);
  const pageEntries = mine.slice(safePage * LOG_PAGE_SIZE, safePage * LOG_PAGE_SIZE + LOG_PAGE_SIZE);

  const days = new Map<string, Entry[]>();
  for (const e of pageEntries) { const k = dayKey(e.createdAt); const arr = days.get(k) || []; arr.push(e); days.set(k, arr); }

  const navBtn = (disabled: boolean): CSSProperties => ({
    background: 'transparent', border: `1px solid ${disabled ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.25)'}`,
    borderRadius: 6, color: disabled ? 'rgba(255,255,255,.3)' : '#fff', padding: '.25rem .7rem',
    fontSize: '.74rem', fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
  });

  return (
    <div style={{ marginTop: '.5rem', borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: '.6rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
      {Array.from(days.entries()).map(([k, dayEntries]) => (
        <div key={k} style={{ borderLeft: '2px solid rgba(0,224,164,.4)', paddingLeft: '.7rem' }}>
          <div style={{ fontSize: '.66rem', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--neon,#00e0a4)', marginBottom: '.45rem' }}>{dayLabel(dayEntries[0].createdAt)}</div>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
            {dayEntries.map((e) => {
              // The booking this action touched: date · venue · host. Links to
              // the booking, opening in a new tab.
              const b = e.booking;
              const bits = b ? [eventDateLabel(b.date), b.venue, b.host].filter((s): s is string => !!s && !!s.trim()) : [];
              return (
                <li key={e.id} style={{ display: 'flex', gap: '.55rem', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '.7rem', color: MUTED, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', flexShrink: 0 }}>{timeLabel(e.createdAt)}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontSize: '.82rem', color: '#fff', lineHeight: 1.4 }}>{e.summary}</span>
                    {e.bookingId && bits.length > 0 && (
                      <a
                        href={`/upcoming-bookings?open=${e.bookingId}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ display: 'block', fontSize: '.72rem', color: 'var(--neon,#00e0a4)', textDecoration: 'none', marginTop: 1 }}
                        title="Open this booking in a new tab"
                      >
                        {bits.join(' · ')} ↗
                      </a>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}

      {pageCount > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.6rem', paddingTop: '.2rem' }}>
          <button type="button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} style={navBtn(safePage === 0)}>‹ Prev</button>
          <span style={{ fontSize: '.72rem', color: MUTED }}>Page {safePage + 1} of {pageCount}</span>
          <button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)} style={navBtn(safePage >= pageCount - 1)}>Next ›</button>
        </div>
      )}
    </div>
  );
}
