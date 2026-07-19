'use client';

// Blocked Users — moved here from the old /account-settings page, which DJs no
// longer see (their account settings IS this profile). Self-contained: it reads
// the current DJ's blocked_users, hydrates the names, and unblocks in place.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './updateDjProfile.module.css';

interface Blocked {
  id: string;
  name: string;
}

export default function BlockedUsersSection() {
  const [userId, setUserId] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<Blocked[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !active) { setLoaded(true); return; }
        setUserId(user.id);
        const { data } = await supabase
          .from('users')
          .select('blocked_users')
          .eq('id', user.id)
          .maybeSingle();
        const ids = (data as { blocked_users?: string[] | null } | null)?.blocked_users || [];
        if (ids.length === 0) { if (active) setLoaded(true); return; }
        const { data: rows } = await supabase.from('users').select('id, name').in('id', ids);
        const list = ((rows as { id: string; name: string | null }[] | null) || []).map((r) => ({
          id: r.id,
          name: r.name || 'Unknown User',
        }));
        if (active) { setBlocked(list); setLoaded(true); }
      } catch {
        if (active) setLoaded(true);
      }
    })();
    return () => { active = false; };
  }, []);

  async function unblock(id: string) {
    if (!userId) return;
    setBusyId(id);
    setMsg(null);
    try {
      const supabase = createClient();
      const next = blocked.filter((b) => b.id !== id).map((b) => b.id);
      const { error } = await supabase
        .from('users')
        .update({ blocked_users: next } as unknown as never)
        .eq('id', userId);
      if (error) throw error;
      setBlocked((prev) => prev.filter((b) => b.id !== id));
      setMsg('✓ Unblocked.');
    } catch {
      setMsg('Could not unblock — try again.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.formGroup}>
      <label>Blocked Users</label>
      {!loaded ? (
        <div style={{ color: '#8a8aa0', fontSize: '.85rem' }}>Loading…</div>
      ) : blocked.length === 0 ? (
        <div style={{ color: '#8a8aa0', fontSize: '.85rem' }}>You haven&apos;t blocked anyone.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
          {blocked.map((b) => (
            <div
              key={b.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: '.6rem', padding: '.5rem .7rem',
                border: '1px solid rgba(255,255,255,.1)', borderRadius: 8,
              }}
            >
              <span style={{ color: '#e8e8f0', fontSize: '.9rem' }}>{b.name}</span>
              <button
                type="button"
                disabled={busyId === b.id}
                onClick={() => unblock(b.id)}
                style={{
                  background: 'transparent', border: '1px solid rgba(255,255,255,.2)',
                  color: '#9d9db5', borderRadius: 6, padding: '.3rem .7rem',
                  fontSize: '.78rem', cursor: 'pointer',
                }}
              >
                {busyId === b.id ? 'Unblocking…' : 'Unblock'}
              </button>
            </div>
          ))}
        </div>
      )}
      {msg && <div style={{ marginTop: '.4rem', fontSize: '.8rem', color: '#8a8aa0' }}>{msg}</div>}
    </div>
  );
}
