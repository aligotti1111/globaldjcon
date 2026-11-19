'use client';

// Admin → Backup tab. One button to download a JSON copy of the core business
// tables (bookings, payments, users, planners, etc.). Fetches the owner-only
// /api/admin/backup route as a blob so we can show progress + catch errors,
// then triggers a browser download.

import { useState } from 'react';
import styles from './admin.module.css';

export default function BackupTab() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/backup', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(res.status === 403 ? 'Not authorized.' : `Backup failed (${res.status}).`);
      }
      const blob = await res.blob();
      // Pull the filename the server set, falling back to a timestamped name.
      const cd = res.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="([^"]+)"/);
      const name = match?.[1] || `gdc-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const mb = (blob.size / (1024 * 1024)).toFixed(2);
      setMsg(`Downloaded ${name} (${mb} MB).`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h2 style={{ fontFamily: "'Bebas Neue', Impact, sans-serif", fontSize: '1.6rem', letterSpacing: '.03em', margin: '0 0 .5rem' }}>
        Download a backup
      </h2>
      <p style={{ color: 'var(--muted, #9aa0a6)', fontSize: '.92rem', lineHeight: 1.5, margin: '0 0 1rem' }}>
        Saves a JSON copy of your core data — bookings, payments, users, planners,
        riders, guest lists, contracts, messages, discount &amp; comp codes, and
        site sales. Keep it somewhere safe as an extra copy you control.
      </p>

      <button
        type="button"
        onClick={download}
        disabled={busy}
        className={`${styles.btn}`}
        style={{ opacity: busy ? 0.6 : 1 }}
      >
        {busy ? 'Preparing backup…' : '💾 Download backup (JSON)'}
      </button>

      {msg && (
        <p style={{ color: 'var(--neon, #00e0a4)', fontSize: '.88rem', marginTop: '.85rem' }}>{msg}</p>
      )}
      {err && (
        <p style={{ color: '#ff6b6b', fontSize: '.88rem', marginTop: '.85rem' }}>{err}</p>
      )}

      <div style={{ marginTop: '1.5rem', padding: '.9rem 1rem', border: '1px solid var(--border, rgba(255,255,255,.14))', borderRadius: 8, background: 'rgba(255,255,255,.03)' }}>
        <div style={{ fontSize: '.72rem', fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted, #9aa0a6)', marginBottom: '.4rem' }}>
          Good to know
        </div>
        <p style={{ color: 'var(--muted, #9aa0a6)', fontSize: '.82rem', lineHeight: 1.5, margin: 0 }}>
          This is a data export, not a full restore point. It does <strong>not</strong> include
          uploaded files (logos, rider PDFs, gallery images — those live in Supabase
          Storage), login passwords, or database policies. For true point-in-time
          recovery, keep Supabase&apos;s own backups / PITR on.
        </p>
      </div>
    </div>
  );
}
