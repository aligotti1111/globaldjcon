'use client';

// ActivityLogModal — owner-only audit trail, opened from the Team section.
// One collapsible log per user, entries grouped by day, each showing the exact
// time and what they did. Owner appears alongside teammates (everyone's actions
// are recorded). Read-only: the owner can review but never edit the history.

import { useEffect, useMemo, useState } from 'react';

interface Entry {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: string | null;
  action: string;
  summary: string;
  bookingId: string | null;
  createdAt: string;
}

const NEON = 'var(--neon,#00e0a4)';
const MUTED = 'var(--muted,#8a8aa0)';

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export default function ActivityLogModal({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openActor, setOpenActor] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const res = await fetch('/api/team/activity');
        const j = await res.json().catch(() => ({}));
        if (!on) return;
        if (!res.ok) { setErr(j?.error || 'Could not load activity.'); return; }
        setEntries((j.entries || []) as Entry[]);
      } catch { if (on) setErr('Could not load activity.'); }
    })();
    return () => { on = false; };
  }, []);

  // Group: actor → ordered days → entries (all already newest-first from the API).
  const byActor = useMemo(() => {
    const map = new Map<string, { name: string; role: string | null; days: Map<string, Entry[]> }>();
    for (const e of entries || []) {
      let a = map.get(e.actorId);
      if (!a) { a = { name: e.actorName, role: e.actorRole, days: new Map() }; map.set(e.actorId, a); }
      const k = dayKey(e.createdAt);
      const arr = a.days.get(k) || [];
      arr.push(e);
      a.days.set(k, arr);
    }
    return Array.from(map.entries()).map(([actorId, v]) => ({
      actorId, name: v.name, role: v.role,
      count: Array.from(v.days.values()).reduce((n, arr) => n + arr.length, 0),
      days: Array.from(v.days.entries()), // [dayKey, entries][]
    }));
  }, [entries]);

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(4,4,10,.7)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1100, padding: '2rem 1rem', overflowY: 'auto' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#14141c', border: '1px solid rgba(255,255,255,.14)', borderRadius: 16, padding: '1.4rem', maxWidth: 620, width: '100%', boxShadow: '0 24px 70px rgba(0,0,0,.55)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.4rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#fff' }}>Team activity log</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: MUTED, cursor: 'pointer', fontSize: '1.3rem', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ margin: '0 0 1rem', fontSize: '.78rem', color: MUTED, lineHeight: 1.5 }}>
          Every key action taken on your account, by whom and exactly when. Tap a name to see their history.
        </p>

        {err && <div style={{ color: '#ff8f8f', fontSize: '.85rem' }}>{err}</div>}
        {!entries && !err && <div style={{ color: MUTED, fontSize: '.85rem' }}>Loading…</div>}
        {entries && entries.length === 0 && !err && (
          <div style={{ color: MUTED, fontSize: '.85rem' }}>No activity recorded yet.</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {byActor.map((a) => {
            const open = openActor === a.actorId;
            return (
              <div key={a.actorId} style={{ border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => setOpenActor(open ? null : a.actorId)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.6rem', padding: '.7rem .85rem', background: open ? 'rgba(255,255,255,.04)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem', minWidth: 0 }}>
                    <span style={{ fontSize: '.9rem', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
                    {a.role && (
                      <span style={{ fontSize: '.6rem', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: NEON, background: 'rgba(0,224,164,.12)', border: '1px solid rgba(0,224,164,.35)', borderRadius: 999, padding: '.08rem .45rem' }}>{a.role}</span>
                    )}
                  </span>
                  <span style={{ fontSize: '.74rem', color: MUTED, whiteSpace: 'nowrap' }}>{a.count} action{a.count === 1 ? '' : 's'} {open ? '▾' : '▸'}</span>
                </button>

                {open && (
                  <div style={{ padding: '.2rem .85rem .8rem' }}>
                    {a.days.map(([k, dayEntries]) => (
                      <div key={k} style={{ marginTop: '.6rem' }}>
                        <div style={{ fontSize: '.66rem', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: MUTED, marginBottom: '.35rem' }}>
                          {dayLabel(dayEntries[0].createdAt)}
                        </div>
                        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                          {dayEntries.map((e) => (
                            <li key={e.id} style={{ display: 'flex', gap: '.6rem', alignItems: 'baseline' }}>
                              <span style={{ fontSize: '.7rem', color: MUTED, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', flexShrink: 0 }}>{timeLabel(e.createdAt)}</span>
                              <span style={{ fontSize: '.82rem', color: '#fff', lineHeight: 1.4 }}>{e.summary}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
