'use client';

// AddonsEditor — manages the mobile DJ's global ADD-ONS list.
//
// Add-ons are optional extras a host can attach to ANY package at booking time
// (uplighting, photo booth, extra hour, monogram, …). One global list, not
// per-event-type. Each add-on has: a title, one flat price, a photo and a
// description. Stored on booking_settings.mob_addons.
//
// This component ONLY edits the list — selection + pricing on the booking side
// is wired separately. Photo upload mirrors PackageEditor (Supabase storage
// `avatars` bucket, keyed by userId).

import { useRef, useState } from 'react';
import styles from './updateDjProfile.module.css';
import { createClient } from '@/lib/supabase/client';
import { useConfirm } from '@/components/ConfirmModal';
import type { MobAddon } from '@/app/(main)/[slug]/bookingSettings';
import { currencySymbol } from '@/lib/constants';

export default function AddonsEditor({
  addons,
  userId,
  currency,
  onChange,
}: {
  addons: MobAddon[];
  userId: string;
  currency?: string;
  onChange: (next: MobAddon[]) => void;
}) {
  const sym = currencySymbol(currency);
  const { confirm, confirmDialog } = useConfirm();
  const list = Array.isArray(addons) ? addons : [];
  // Always show at least the first add-on's fields, even before anything is
  // saved — a blank starter card so the DJ can type straight in instead of
  // having to click "Add Add-on" first. Editing it promotes it into the list.
  const display: MobAddon[] = list.length ? list : [{ title: '', price: '', photo: '', details: '' }];

  function update(idx: number, patch: Partial<MobAddon>) {
    // Editing the blank starter card (which isn't in the stored list yet)
    // creates the first real add-on.
    if (idx >= list.length) {
      onChange([...list, { title: '', price: '', photo: '', details: '', ...patch }]);
      return;
    }
    onChange(list.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  }
  function add() {
    onChange([...list, { title: '', price: '', photo: '', details: '' }]);
  }
  async function remove(idx: number) {
    const ok = await confirm({
      title: 'Delete this add-on?',
      message: list[idx]?.title ? `"${list[idx].title}" will be removed.` : undefined,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    onChange(list.filter((_, i) => i !== idx));
  }

  return (
    <div style={{ marginTop: 24 }}>
      {confirmDialog}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 15, letterSpacing: '.04em', color: '#38e8b0', textTransform: 'uppercase' }}>
          Add-ons
        </h3>
      </div>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: '#9aa0b4', lineHeight: 1.5 }}>
        Optional extras a client can add to <strong>any</strong> package when they book you — uplighting, a photo
        booth, an extra hour, and so on. Each add-on has one price; the client&apos;s picks are added to their total.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {display.map((addon, idx) => (
          <AddonCard
            key={idx}
            addon={addon}
            idx={idx}
            userId={userId}
            sym={sym}
            onChange={(p) => update(idx, p)}
            onRemove={idx < list.length ? () => remove(idx) : undefined}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={add}
        style={{
          marginTop: 14, background: 'transparent', border: '1px dashed rgba(56,232,176,.5)',
          color: '#38e8b0', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 700,
          cursor: 'pointer', letterSpacing: '.03em',
        }}
      >
        + Add Add-on
      </button>
    </div>
  );
}

function AddonCard({
  addon, idx, userId, sym, onChange, onRemove,
}: {
  addon: MobAddon;
  idx: number;
  userId: string;
  sym: string;
  onChange: (patch: Partial<MobAddon>) => void;
  onRemove?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadStatus, setUploadStatus] = useState<{ kind: 'idle' | 'uploading' | 'done' | 'error'; msg?: string }>({ kind: 'idle' });

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus({ kind: 'uploading', msg: 'Uploading…' });
    try {
      const supabase = createClient();
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${userId}/addons/addon_${idx}_${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: pubData } = supabase.storage.from('avatars').getPublicUrl(path);
      onChange({ photo: `${pubData.publicUrl}?t=${Date.now()}` });
      setUploadStatus({ kind: 'done', msg: '✓ Uploaded' });
      setTimeout(() => setUploadStatus({ kind: 'idle' }), 3000);
    } catch (err) {
      setUploadStatus({ kind: 'error', msg: '✗ ' + (err instanceof Error ? err.message : 'Upload failed') });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div
      style={{
        background: '#000', border: '1px solid rgba(255,255,255,.08)', borderRadius: 14,
        padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#9aa0b4', letterSpacing: '.04em' }}>
          ADD-ON {idx + 1}
        </span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove add-on"
            style={{ background: 'none', border: 'none', color: '#f3899a', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Title + price on one row */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: '2 1 200px' }}>
          <label className={styles.pkgFieldLabel}>Title</label>
          <input
            type="text"
            placeholder="e.g. Uplighting"
            value={addon.title || ''}
            onChange={(e) => onChange({ title: e.target.value })}
            className={styles.pkgInput}
          />
        </div>
        <div style={{ flex: '1 1 120px' }}>
          <label className={styles.pkgFieldLabel}>Price</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#9aa0b4', fontSize: 14 }}>{sym}</span>
            <input
              type="number"
              min={0}
              placeholder="0"
              value={addon.price ?? ''}
              onChange={(e) => onChange({ price: e.target.value })}
              className={styles.pkgInput}
            />
          </div>
        </div>
      </div>

      {/* Description */}
      <div>
        <label className={styles.pkgFieldLabel}>Description</label>
        <textarea
          placeholder="What this add-on includes…"
          value={addon.details || ''}
          onChange={(e) => onChange({ details: e.target.value })}
          rows={3}
          className={styles.pkgInput}
          style={{ resize: 'vertical', minHeight: 64, fontFamily: 'inherit' }}
        />
      </div>

      {/* Photo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 64, height: 64, borderRadius: 10, flex: '0 0 auto', overflow: 'hidden',
            background: addon.photo ? `center/cover no-repeat url(${addon.photo})` : '#23232e',
            border: '1px solid rgba(255,255,255,.1)',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input ref={fileRef} type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: 'none' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              style={{ background: '#23232e', border: '1px solid rgba(255,255,255,.12)', color: '#e6e6ef', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}
            >
              {addon.photo ? 'Change photo' : 'Upload photo'}
            </button>
            {addon.photo && (
              <button
                type="button"
                onClick={() => onChange({ photo: '' })}
                style={{ background: 'none', border: 'none', color: '#f3899a', fontSize: 12, cursor: 'pointer' }}
              >
                Remove
              </button>
            )}
          </div>
          {uploadStatus.kind !== 'idle' && (
            <span style={{ fontSize: 11, color: uploadStatus.kind === 'error' ? '#f3899a' : '#9aa0b4' }}>
              {uploadStatus.msg}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
