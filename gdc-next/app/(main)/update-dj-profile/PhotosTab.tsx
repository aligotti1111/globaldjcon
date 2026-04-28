'use client';

// PhotosTab — 4 gallery slot uploads in a 2x2 grid. Faithful port of
// update-dj-profile.html lines 350-429 + handleUpload from udjp-images.js.
//
// Each slot persists a public Supabase storage URL into the matching
// `gallery_img_N` column. Path: `${userId}/gallery_N.{ext}` — fixed
// names overwrite prior uploads, matching vanilla.
//
// Hover state on a populated tile shows a "Change Photo" overlay; the X
// button removes the URL from form state (the file remains in storage,
// same as vanilla — orphan cleanup is a separate housekeeping concern).

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './updateDjProfile.module.css';
import type { GeneralFormState } from './UpdateDjProfileClient';

interface Props {
  state: GeneralFormState;
  onChange: <K extends keyof GeneralFormState>(field: K, value: GeneralFormState[K]) => void;
  userId: string;
}

type GalleryKey = 'galleryImg1' | 'galleryImg2' | 'galleryImg3' | 'galleryImg4';

const SLOTS: { key: GalleryKey; label: string; pathStem: string }[] = [
  { key: 'galleryImg1', label: 'Gallery Photo 1', pathStem: 'gallery_1' },
  { key: 'galleryImg2', label: 'Gallery Photo 2', pathStem: 'gallery_2' },
  { key: 'galleryImg3', label: 'Gallery Photo 3', pathStem: 'gallery_3' },
  { key: 'galleryImg4', label: 'Gallery Photo 4', pathStem: 'gallery_4' },
];

export default function PhotosTab({ state, onChange, userId }: Props) {
  return (
    <div className={styles.galleryGrid}>
      {SLOTS.map((s) => (
        <PhotoSlot
          key={s.key}
          label={s.label}
          pathStem={s.pathStem}
          url={state[s.key]}
          onUrlChange={(url) => onChange(s.key, url)}
          userId={userId}
        />
      ))}
    </div>
  );
}

function PhotoSlot({
  label,
  pathStem,
  url,
  onUrlChange,
  userId,
}: {
  label: string;
  pathStem: string;
  url: string;
  onUrlChange: (url: string) => void;
  userId: string;
}) {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus('uploading');
    setErrMsg(null);
    try {
      const supabase = createClient();
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${userId}/${pathStem}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadErr) throw uploadErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = `${data.publicUrl}?t=${Date.now()}`;
      onUrlChange(publicUrl);
      setStatus('done');
      setTimeout(() => setStatus('idle'), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setErrMsg(msg);
      setStatus('error');
    } finally {
      // Reset the file input so the same file can be picked again later
      e.target.value = '';
    }
  }

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Remove this photo?')) return;
    onUrlChange('');
    setStatus('idle');
  }

  return (
    <div className={styles.galleryItem}>
      <label className={styles.galleryItemLabel}>{label}</label>
      <div
        className={`${styles.galleryBox} ${url ? styles.galleryBoxFilled : ''}`}
      >
        {/* File input layered on top of the box — clicking anywhere opens picker */}
        <input
          type="file"
          accept="image/*"
          onChange={handleUpload}
          className={styles.galleryInput}
        />
        {url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={label} className={styles.galleryImg} />
            <div className={styles.galleryOverlay}>
              <span>Change Photo</span>
            </div>
            <button
              type="button"
              onClick={handleRemove}
              className={styles.galleryRemoveBtn}
              title="Remove photo"
            >
              ✕
            </button>
          </>
        ) : (
          <div className={styles.galleryPlaceholder}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <span>Click to upload</span>
            <small>JPG, PNG, WebP</small>
          </div>
        )}
      </div>
      {status === 'uploading' && (
        <div className={`${styles.uploadStatus} ${styles.uploadStatusUploading}`}>
          Uploading…
        </div>
      )}
      {status === 'done' && (
        <div className={`${styles.uploadStatus} ${styles.uploadStatusDone}`}>
          ✓ Uploaded
        </div>
      )}
      {status === 'error' && (
        <div className={`${styles.uploadStatus} ${styles.uploadStatusError}`}>
          ✗ {errMsg || 'Upload failed'}
        </div>
      )}
    </div>
  );
}
