'use client';

// FlyerSlot — lifted out of UpcomingBookingsClient unchanged.
//
// It's rendered from two different places (the row's flyer cell and the
// expanded details card), and those two now live in separate files, so it
// has to be importable by both rather than a sibling of one of them.

import { useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useConfirm } from '@/components/ConfirmModal';
import styles from './upcomingBookings.module.css';

// ───────────────────────────────────────────────────────────────────────
// FlyerSlot — add / view / remove / replace / download an event flyer on a
// club booking. Same flyer + storage as the host-side flyer on the
// Upcoming Events page (bookings.flyer_url, 'avatars' bucket). Controlled:
// the parent owns flyerUrl so the row slot and the in-card thumbnail stay
// in sync. `size` switches between the row slot and the smaller in-card one.
// ───────────────────────────────────────────────────────────────────────

export default function FlyerSlot({
  bookingId, userId, flyerUrl, onChange, size = 'row', readOnly = false,
}: {
  bookingId: string;
  userId: string;
  flyerUrl: string | null;
  onChange: (url: string | null) => void;
  size?: 'row' | 'card';
  // Archive/past view: show an existing flyer (view + download) but no add,
  // replace, or remove controls.
  readOnly?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const boxClass = size === 'card' ? styles.flyerBoxCard : styles.flyerBoxRow;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const supabase = createClient();
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${userId}/flyers/${bookingId}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadErr) throw uploadErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = `${data.publicUrl}?t=${Date.now()}`;
      // DJ-side update — this view belongs to the DJ, so key on dj_id.
      const { error: updErr } = await supabase
        .from('bookings')
        .update({ flyer_url: publicUrl } as unknown as never)
        .eq('id', bookingId)
        .eq('dj_id', userId);
      if (updErr) throw updErr;
      onChange(publicUrl);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleRemove() {
    const ok = await confirm({
      title: 'Remove this flyer?',
      message: 'The flyer will be removed from this booking.',
      confirmLabel: 'Remove',
      cancelLabel: 'Keep',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('bookings')
        .update({ flyer_url: null } as unknown as never)
        .eq('id', bookingId)
        .eq('dj_id', userId);
      if (error) throw error;
      onChange(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Remove failed');
    }
  }

  async function handleDownload() {
    if (!flyerUrl) return;
    try {
      const res = await fetch(flyerUrl);
      const blob = await res.blob();
      const ext = flyerUrl.split('?')[0].split('.').pop() || 'jpg';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flyer-${bookingId}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Fallback — open in a new tab if the blob download fails.
      window.open(flyerUrl, '_blank');
    }
  }

  if (readOnly && !flyerUrl) return null;

  return (
    <div className={styles.flyerInline}>
      {flyerUrl ? (
        <div className={styles.flyerWithActions}>
          <div className={`${styles.flyerThumbWrap} ${boxClass}`}>
            <button
              type="button"
              className={styles.flyerThumbBtn}
              onClick={() => setShowLightbox(true)}
              title="View flyer"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={flyerUrl} alt="Event flyer" className={styles.flyerThumbImg} />
            </button>
            {/* Overlaid controls — pencil replaces the flyer, ✕ removes it.
                Hidden in archive/read-only mode. */}
            {!readOnly && (
              <>
                <button
                  type="button"
                  className={`${styles.flyerOverlayBtn} ${styles.flyerOverlayEdit}`}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title="Replace flyer"
                  aria-label="Replace flyer"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`${styles.flyerOverlayBtn} ${styles.flyerOverlayDelete}`}
                  onClick={handleRemove}
                  title="Remove flyer"
                  aria-label="Remove flyer"
                >
                  ✕
                </button>
              </>
            )}
          </div>
          {/* Download icon — card variant only. */}
          {size === 'card' && (
            <button
              type="button"
              className={styles.flyerDownloadIcon}
              onClick={handleDownload}
              title="Download flyer"
              aria-label="Download flyer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          className={`${styles.flyerAddBtn} ${boxClass}`}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="Upload flyer"
        >
          {uploading ? '…' : '+ Flyer'}
        </button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      {showLightbox && flyerUrl && (
        <div
          className={styles.flyerLightbox}
          onClick={() => setShowLightbox(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className={styles.flyerLightboxInner} onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={flyerUrl} alt="Event flyer" className={styles.flyerLightboxImg} />
            <div className={styles.flyerLightboxActions}>
              <button type="button" className={styles.flyerLink} onClick={handleDownload}>
                Download
              </button>
              {!readOnly && (
                <button
                  type="button"
                  className={styles.flyerLinkMuted}
                  onClick={async () => { await handleRemove(); setShowLightbox(false); }}
                >
                  Remove
                </button>
              )}
              <button
                type="button"
                className={styles.flyerLinkMuted}
                onClick={() => setShowLightbox(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
