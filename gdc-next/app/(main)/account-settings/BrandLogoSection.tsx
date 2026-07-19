'use client';

// Business Logo — the ONE logo, managed here and (still) in Contract setup.
//
// Both write the same column, users.contract_logo_url, which the planner, the
// contracts, and everywhere else read. So it's a single source of truth: update
// it in either place and every surface shows the new one — no syncing.
//
// Stored in the same `avatars` storage bucket the contract logo already uses,
// at ${userId}/contract_logo_<ts>.<ext>. The DJ is authed, so the row update
// goes straight through the client SDK (RLS lets them edit their own row).

import { useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './accountSettings.module.css';

type Alert = { type: 'success' | 'error'; msg: string } | null;

export default function BrandLogoSection({
  userId, initialUrl,
}: {
  userId: string;
  initialUrl: string | null;
}) {
  const [logoUrl, setLogoUrl] = useState<string | null>(initialUrl);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<Alert>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setAlert({ type: 'error', msg: 'Logo must be an image.' }); return; }
    if (file.size > 4 * 1024 * 1024) { setAlert({ type: 'error', msg: 'Logo is too large (max 4MB).' }); return; }
    setAlert(null);
    setBusy(true);
    try {
      const supabase = createClient();
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${userId}/contract_logo_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      // Cache-bust so the new logo shows immediately in previews.
      const url = `${data.publicUrl}?t=${Date.now()}`;
      const { error: dbErr } = await supabase
        .from('users')
        .update({ contract_logo_url: url } as unknown as never)
        .eq('id', userId);
      if (dbErr) throw dbErr;
      setLogoUrl(url);
      setAlert({ type: 'success', msg: '✓ Logo saved — it now shows on your Planner & Playlist, contracts, and more.' });
    } catch (err) {
      setAlert({ type: 'error', msg: err instanceof Error ? err.message : 'Logo upload failed.' });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onRemove() {
    setBusy(true);
    setAlert(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('users')
        .update({ contract_logo_url: null } as unknown as never)
        .eq('id', userId);
      if (error) throw error;
      setLogoUrl(null);
      setAlert({ type: 'success', msg: '✓ Logo removed.' });
    } catch (err) {
      setAlert({ type: 'error', msg: err instanceof Error ? err.message : 'Could not remove logo.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.card}>
      <h2>Business Logo</h2>
      <p className={styles.cardHint}>
        Upload once and it appears everywhere your brand shows — your Planner &amp; Playlist,
        your contracts, and more. Change it any time here and every place updates with it.
      </p>
      {alert && (
        <div className={`${styles.alert} ${alert.type === 'success' ? styles.alertSuccess : styles.alertError}`}>
          {alert.msg}
        </div>
      )}
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
        <button type="button" className={styles.saveBtn} disabled={busy} onClick={() => fileRef.current?.click()}>
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
    </div>
  );
}
