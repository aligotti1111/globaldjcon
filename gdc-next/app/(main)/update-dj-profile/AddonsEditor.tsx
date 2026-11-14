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
import RichTextEditor from './RichTextEditor';
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
  // Two add-ons can't share a title. Mark any card whose (trimmed, case-
  // insensitive) title matches an EARLIER card's — so the first use is kept
  // and later duplicates are flagged. Blank titles never count as duplicates.
  const dupFlags: boolean[] = (() => {
    const seen = new Set<string>();
    return display.map((a) => {
      const key = (a.title || '').trim().toLowerCase();
      if (!key) return false;
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    });
  })();

  // Activate the add-on being worked on (the last card). A separate "+" below
  // the cards opens a new blank slot.
  const working = display[display.length - 1];
  const workingIsDup = dupFlags[display.length - 1];
  const canActivate = !!(working && (working.title || '').trim()) && !workingIsDup;
  function activate() {
    if (!canActivate) return;
    const lastIdx = display.length - 1;
    const activated: MobAddon = { ...working, active: true };
    onChange(lastIdx >= list.length ? [...list, activated] : list.map((a, i) => (i === lastIdx ? activated : a)));
  }
  function addSlot() {
    onChange([...list, { title: '', price: '', photo: '', details: '', active: false }]);
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
      <p style={{ margin: '0 0 14px', fontSize: 13, color: '#9aa0b4', lineHeight: 1.5 }}>
        Optional extras a client can add to <strong>any</strong> package when they book you — a Photo Booth,
        Giveaways, Fog/Haze Machine and so on. Each add-on has one price; the client&apos;s picks are added to their total.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {display.map((addon, idx) => (
          <AddonCard
            key={idx}
            addon={addon}
            idx={idx}
            userId={userId}
            sym={sym}
            duplicate={dupFlags[idx]}
            onChange={(p) => update(idx, p)}
            onRemove={idx < list.length ? () => remove(idx) : undefined}
          />
        ))}
      </div>

      {/* "+" under the most recent add-on — opens a fresh blank slot. */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
        <button
          type="button"
          onClick={addSlot}
          aria-label="Add another add-on"
          title="Add another add-on"
          style={{
            width: 40, height: 40, borderRadius: '50%', display: 'inline-flex', alignItems: 'center',
            justifyContent: 'center', background: 'transparent', border: '1px dashed rgba(56,232,176,.5)',
            color: '#38e8b0', fontSize: 22, lineHeight: 1, cursor: 'pointer',
          }}
        >
          +
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        {(() => {
          const isActive = !!working?.active;
          const live = canActivate && !isActive; // can still be activated
          return (
            <button
              type="button"
              onClick={activate}
              disabled={!live}
              title={isActive ? 'Already active' : (canActivate ? 'Activate this add-on' : 'Add a title first')}
              style={{
                background: live ? 'rgba(56,232,176,.14)' : 'transparent',
                border: `1px solid ${live ? '#38e8b0' : 'rgba(255,255,255,.18)'}`,
                color: live ? '#38e8b0' : '#6b7080',
                borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 700,
                cursor: live ? 'pointer' : 'default', letterSpacing: '.03em',
                opacity: isActive ? 0.6 : 1,
              }}
            >
              {isActive ? 'Activated' : 'Activate'}
            </button>
          );
        })()}
      </div>
    </div>
  );
}

function AddonCard({
  addon, idx, userId, sym, duplicate, onChange, onRemove,
}: {
  addon: MobAddon;
  idx: number;
  userId: string;
  sym: string;
  duplicate?: boolean;
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
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
            style={duplicate ? { borderColor: '#f3899a' } : undefined}
          />
          {duplicate && (
            <div style={{ marginTop: 4, fontSize: 12, color: '#f3899a' }}>
              Another add-on already uses this title. Give it a unique name.
            </div>
          )}
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

      {/* Description — same rich-text toolbar as the package details field. */}
      <div>
        <label className={styles.pkgFieldLabel}>Description</label>
        <RichTextEditor
          value={addon.details || ''}
          onChange={(html) => onChange({ details: html })}
          placeholder="What this add-on includes…"
        />
      </div>

      {/* Photo — same slot UI as the package photo upload. */}
      <div className={styles.pkgFieldGroup}>
        <div className={styles.photoHeaderRow}>
          <label className={styles.pkgFieldLabel}>Add-on Photo</label>
        </div>
        <div className={styles.photoSlotGrid}>
          {addon.photo ? (
            <div className={styles.photoSlot}>
              <div className={styles.photoPreviewWrap}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={addon.photo} alt="Add-on photo" className={styles.photoSlotImg} />
                <div className={styles.photoIconActions}>
                  <label className={styles.photoIconBtn} title="Replace photo">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                    <input ref={fileRef} type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: 'none' }} />
                  </label>
                  <button type="button" onClick={() => onChange({ photo: '' })} className={styles.photoIconBtn} title="Delete photo">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.photoSlot}>
              <label className={styles.photoSlotEmpty}>
                <input ref={fileRef} type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: 'none' }} />
                <span className={styles.photoSlotPlus}>+</span>
                <span className={styles.photoSlotHint}>Add photo</span>
                <span className={styles.photoSlotSize}>1000&times;1000px</span>
              </label>
            </div>
          )}
        </div>
        {uploadStatus.kind !== 'idle' && (
          <div
            className={`${styles.uploadStatus} ${
              uploadStatus.kind === 'uploading' ? styles.uploadStatusUploading
                : uploadStatus.kind === 'done' ? styles.uploadStatusDone
                : styles.uploadStatusError
            }`}
          >
            {uploadStatus.msg}
          </div>
        )}
      </div>
    </div>
  );
}
