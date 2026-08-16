'use client';

// Business Logo — the ONE logo (users.contract_logo_url) that shows on the
// client's Planner & Playlist, the printable, and contracts. Managed here on
// the profile (a DJ's account settings) and also inline on the planner editor;
// both write the same field, so it updates everywhere at once.
//
// Self-contained: reads the current DJ's logo, uploads to the same `avatars`
// bucket the contract logo uses, saves the column, and can remove it.

import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './updateDjProfile.module.css';

// Small round icon button that sits directly on top of the logo image.
const iconBtnStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 24, height: 24, borderRadius: 6, cursor: 'pointer', padding: 0,
  background: 'rgba(0,0,0,.6)', border: '1px solid rgba(255,255,255,.25)', color: '#fff',
};

export default function BusinessLogoSection() {
  const [userId, setUserId] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !active) return;
        setUserId(user.id);
        const { data } = await supabase
          .from('users')
          .select('contract_logo_url')
          .eq('id', user.id)
          .maybeSingle();
        if (active) setLogoUrl((data as { contract_logo_url?: string | null } | null)?.contract_logo_url || null);
      } catch { /* logo is optional */ }
    })();
    return () => { active = false; };
  }, []);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    if (!file.type.startsWith('image/')) { setMsg('Logo must be an image.'); return; }
    if (file.size > 4 * 1024 * 1024) { setMsg('Logo is too large (max 4MB).'); return; }
    setMsg(null);
    setBusy(true);
    try {
      const supabase = createClient();
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${userId}/contract_logo_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = `${data.publicUrl}?t=${Date.now()}`;
      // Save via the API — 'set' also clears every per-booking hide, so a new
      // logo shows everywhere again (the "change overrides all" rule).
      const res = await fetch('/api/dj/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'set', url }),
      });
      if (!res.ok) throw new Error('save failed');
      setLogoUrl(url);
      setMsg('✓ Logo saved — it shows on your Planner & Playlist, contracts, and more.');
    } catch {
      setMsg('Logo upload failed — try again.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onRemove() {
    if (!userId) return;
    setBusy(true);
    setMsg(null);
    try {
      // From account settings, removing the logo deletes it everywhere.
      const res = await fetch('/api/dj/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'clear' }),
      });
      if (!res.ok) throw new Error('remove failed');
      setLogoUrl(null);
      setMsg('✓ Logo removed everywhere.');
    } catch {
      setMsg('Could not remove — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.formGroup}>
      <label>Business Logo</label>
      <div style={{ fontSize: '.8rem', color: '#8a8aa0', margin: '0 0 .6rem' }}>
        Shows on your Planner &amp; Playlist, your contracts, and more. Update it any time and every place updates with it.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPick} />
        <div
          style={{
            position: 'relative',
            width: 132, height: 68, borderRadius: 8, flexShrink: 0, overflow: 'hidden',
            border: '1px solid rgba(255,255,255,.14)', background: 'rgba(255,255,255,.04)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {logoUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUrl} alt="Your logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              {/* Replace + Remove live ON the logo as icons, not as separate buttons. */}
              <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 4 }}>
                <button
                  type="button" disabled={busy} onClick={() => fileRef.current?.click()}
                  title="Replace logo" aria-label="Replace logo" style={iconBtnStyle}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
                <button
                  type="button" disabled={busy} onClick={onRemove}
                  title="Remove logo" aria-label="Remove logo" style={iconBtnStyle}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              </div>
            </>
          ) : (
            // No logo yet — the whole tile is the uploader.
            <button
              type="button" disabled={busy} onClick={() => fileRef.current?.click()}
              title="Upload logo" aria-label="Upload logo"
              style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 3,
                background: 'transparent', border: 'none', color: '#8a8aa0', cursor: 'pointer', fontSize: '.68rem',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {busy ? 'Saving…' : 'Upload logo'}
            </button>
          )}
        </div>
      </div>
      {msg && <div style={{ marginTop: '.5rem', fontSize: '.8rem', color: '#8a8aa0' }}>{msg}</div>}
    </div>
  );
}
