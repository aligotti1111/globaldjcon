'use client';

// Business Logo — the ONE logo (users.contract_logo_url) that shows on the
// client's Planner & Playlist, the printable, and contracts. Managed here on
// the profile (a DJ's account settings) and also inline on the planner editor;
// both write the same field, so it updates everywhere at once.
//
// Self-contained: reads the current DJ's logo, uploads to the same `avatars`
// bucket the contract logo uses, saves the column, and can remove it.

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './updateDjProfile.module.css';

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
        <div
          style={{
            width: 132, height: 68, borderRadius: 8, flexShrink: 0, overflow: 'hidden',
            border: '1px solid rgba(255,255,255,.14)', background: 'rgba(255,255,255,.04)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {logoUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={logoUrl} alt="Your logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            : <span style={{ color: '#6c6c86', fontSize: '.72rem' }}>No logo yet</span>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPick} />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          style={{
            background: 'rgba(0,224,164,.08)', border: '1px solid rgba(0,224,164,.4)',
            color: '#00e0a4', borderRadius: 8, padding: '.5rem .9rem',
            fontSize: '.85rem', fontWeight: 600, cursor: 'pointer',
          }}
        >
          {busy ? 'Saving…' : logoUrl ? 'Replace logo' : 'Upload logo'}
        </button>
        {logoUrl && (
          <button
            type="button"
            disabled={busy}
            onClick={onRemove}
            style={{ background: 'transparent', border: 'none', color: '#8a8aa0', textDecoration: 'underline', cursor: 'pointer', fontSize: '.82rem' }}
          >
            Remove
          </button>
        )}
      </div>
      {msg && <div style={{ marginTop: '.5rem', fontSize: '.8rem', color: '#8a8aa0' }}>{msg}</div>}
    </div>
  );
}
