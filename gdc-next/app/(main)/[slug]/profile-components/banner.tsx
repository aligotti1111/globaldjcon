'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from '../profile.module.css';
import { createClient } from '@/lib/supabase/client';
import { EVENT_TYPE_LABELS } from '../constants';
import { validateImageFile } from '../profilePhotoUtils';
import { saveProfile, profileUploadFolder } from '../profileSave';
import { mobEventLabel, type CustomEventType } from '@/lib/constants';

export function BannerTypeEventsDropdown({ events, customTypes = [] }: { events: string[]; customTypes?: CustomEventType[] }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const badgeRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest('[data-banner-type-dropdown]')) {
        setOpen(false);
      }
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function update() {
      if (!badgeRef.current) return;
      const r = badgeRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  const hasEvents = events.length > 0;

  return (
    <div
      ref={badgeRef}
      data-banner-type-dropdown
      className={`${styles.bannerNameBadge} ${styles.bannerNameBadgeMobile}`}
      onClick={(e) => {
        if (!hasEvents) return;
        e.stopPropagation();
        setOpen(o => !o);
      }}
      role={hasEvents ? 'button' : undefined}
      tabIndex={hasEvents ? 0 : undefined}
      onKeyDown={(e) => {
        if (!hasEvents) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setOpen(o => !o);
        }
      }}
      style={{ cursor: hasEvents ? 'pointer' : 'default' }}
    >
      Mobile DJ{hasEvents && ' ▾'}
      {mounted && open && hasEvents && pos && createPortal(
        <div
          className={styles.bannerTypeDropdown}
          data-banner-type-dropdown
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
        >
          {events.map(ev => (
            <div key={ev} className={styles.bannerTypeDropdownItem}>
              {EVENT_TYPE_LABELS[ev] || mobEventLabel(ev, customTypes)}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}



// ── BannerEditModal ────────────────────────────────────────────
// Self-contained modal for owner banner management:
//   - Upload / replace banner image
//   - Two side-by-side previews (DESKTOP 4:1 and MOBILE 1.6:1) — each
//     independently draggable to reposition the image vertically for
//     that viewport.
//   - Save commits banner_url (if new file uploaded), banner_position
//     (desktop), and banner_position_mobile (mobile) in one update.
// The modal reloads the page on save so the live banner refreshes.
export function BannerEditModal({
  userId,
  initialUrl,
  initialPosition,
  initialPositionMobile,
  onClose,
}: {
  userId: string;
  initialUrl: string | null;
  initialPosition: string | null;
  initialPositionMobile: string | null;
  onClose: () => void;
}) {
  function parsePosY(stored: string | null, fallback: number): number {
    const parts = (stored || '').split(' ');
    const y = parseFloat(parts[1] || '');
    return Number.isFinite(y) ? y : fallback;
  }

  // Working state — starts from props but tracks unsaved changes locally.
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialUrl);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingObjectUrl, setPendingObjectUrl] = useState<string | null>(null);
  const [posY, setPosY] = useState<number>(() => parsePosY(initialPosition, 50));
  // Mobile defaults to the desktop position if not yet set so the user has
  // a sane starting point on first edit.
  const [posYMobile, setPosYMobile] = useState<number>(() =>
    parsePosY(initialPositionMobile, parsePosY(initialPosition, 50))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True while a file is being dragged over the drop zone — drives the
  // highlighted "drop to upload" state.
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDesktopRef = useRef<{ startY: number; startPos: number } | null>(null);
  const dragMobileRef = useRef<{ startY: number; startPos: number } | null>(null);

  useEffect(() => {
    return () => {
      if (pendingObjectUrl) URL.revokeObjectURL(pendingObjectUrl);
    };
  }, [pendingObjectUrl]);

  // Shared file handler — used by both the file picker and drag-and-drop.
  async function applyFile(file: File | undefined | null) {
    if (!file) return;
    const valErr = await validateImageFile(file);
    if (valErr) {
      setError(valErr);
      return;
    }
    setError(null);
    if (pendingObjectUrl) URL.revokeObjectURL(pendingObjectUrl);
    const blobUrl = URL.createObjectURL(file);
    setPendingObjectUrl(blobUrl);
    setPreviewUrl(blobUrl);
    setPendingFile(file);
  }

  async function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    await applyFile(file);
  }

  // Drag-and-drop: accept an image file dropped anywhere on the drop zone.
  function onDropZoneDragOver(e: React.DragEvent) {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      setDragOver(true);
    }
  }
  function onDropZoneDragLeave(e: React.DragEvent) {
    // Only clear when leaving the zone itself, not when moving between
    // children (relatedTarget still inside).
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  }
  async function onDropZoneDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    await applyFile(file);
  }

  // Generic drag handlers parameterized by which viewport we're editing.
  function makePointerDown(
    ref: React.MutableRefObject<{ startY: number; startPos: number } | null>,
    currentPos: number
  ) {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      if (!previewUrl) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      ref.current = { startY: e.clientY, startPos: currentPos };
    };
  }
  function makePointerMove(
    ref: React.MutableRefObject<{ startY: number; startPos: number } | null>,
    setter: (v: number) => void
  ) {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      if (!ref.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const delta = e.clientY - ref.current.startY;
      const deltaPct = (delta / rect.height) * 100;
      let next = ref.current.startPos - deltaPct;
      if (next < 0) next = 0;
      if (next > 100) next = 100;
      setter(next);
    };
  }
  function makePointerUp(
    ref: React.MutableRefObject<{ startY: number; startPos: number } | null>
  ) {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      if (ref.current) {
        e.currentTarget.releasePointerCapture(e.pointerId);
        ref.current = null;
      }
    };
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      let newPublicUrl: string | null = null;
      if (pendingFile) {
        const ext = (pendingFile.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${profileUploadFolder(userId)}/banner.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('avatars')
          .upload(path, pendingFile, { upsert: true, contentType: pendingFile.type });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
        newPublicUrl = `${pub.publicUrl}?t=${Date.now()}`;
      }
      const patch: Record<string, string> = {
        banner_position: `50% ${posY}%`,
        banner_position_mobile: `50% ${posYMobile}%`,
      };
      if (newPublicUrl) patch.banner_url = newPublicUrl;
      await saveProfile(userId, patch);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
      setBusy(false);
    }
  }

  async function removeBanner() {
    if (!confirm('Remove your banner?')) return;
    setBusy(true);
    setError(null);
    try {
      await saveProfile(userId, {
        banner_url: null,
        banner_position: null,
        banner_position_mobile: null,
      });
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed.');
      setBusy(false);
    }
  }

  return (
    <div className={styles.bannerModalBackdrop} onClick={onClose}>
      <div className={styles.bannerModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.bannerModalHeader}>
          <h2 className={styles.bannerModalTitle}>Edit Banner</h2>
          <button
            type="button"
            onClick={onClose}
            className={styles.bannerModalClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className={styles.bannerModalBody}>
          {/* Two-up previews — desktop (4:1) on left, mobile (1.6:1) on
              right. Each is independently draggable so the DJ can position
              the image differently for each viewport. When no banner is
              set, clicking either preview opens the file picker. */}
          <div
            className={styles.bannerPreviewsRow}
            onDragOver={onDropZoneDragOver}
            onDragLeave={onDropZoneDragLeave}
            onDrop={onDropZoneDrop}
            style={dragOver ? { outline: '2px dashed var(--neon, #00e0a4)', outlineOffset: 4, borderRadius: 8 } : undefined}
          >
            <div className={styles.bannerPreviewBlock}>
              <div className={styles.bannerPreviewLabel}>
                Desktop view
                <span className={styles.bannerPreviewRatio}>1600 × 400 (4:1)</span>
              </div>
              <div
                className={`${styles.bannerModalPreview} ${styles.bannerModalPreviewDesktop} ${
                  !previewUrl ? styles.bannerModalPreviewEmpty : ''
                }`}
                style={
                  previewUrl
                    ? {
                        backgroundImage: `url(${previewUrl})`,
                        backgroundPosition: `50% ${posY}%`,
                        cursor: 'grab',
                      }
                    : undefined
                }
                onClick={!previewUrl ? () => fileRef.current?.click() : undefined}
                onPointerDown={previewUrl ? makePointerDown(dragDesktopRef, posY) : undefined}
                onPointerMove={previewUrl ? makePointerMove(dragDesktopRef, setPosY) : undefined}
                onPointerUp={previewUrl ? makePointerUp(dragDesktopRef) : undefined}
                onPointerCancel={previewUrl ? makePointerUp(dragDesktopRef) : undefined}
              >
                {!previewUrl && (
                  <div className={styles.bannerModalEmpty}>
                    {dragOver ? 'Drop image to upload' : 'Click or drop an image'}
                  </div>
                )}
                {previewUrl && (
                  <div className={styles.bannerModalDragHint}>Drag to reposition</div>
                )}
              </div>
            </div>

            <div className={styles.bannerPreviewBlock}>
              <div className={styles.bannerPreviewLabel}>
                Mobile view
                <span className={styles.bannerPreviewRatio}>~1.6:1</span>
              </div>
              <div
                className={`${styles.bannerModalPreview} ${styles.bannerModalPreviewMobile} ${
                  !previewUrl ? styles.bannerModalPreviewEmpty : ''
                }`}
                style={
                  previewUrl
                    ? {
                        backgroundImage: `url(${previewUrl})`,
                        backgroundPosition: `50% ${posYMobile}%`,
                        cursor: 'grab',
                      }
                    : undefined
                }
                onClick={!previewUrl ? () => fileRef.current?.click() : undefined}
                onPointerDown={previewUrl ? makePointerDown(dragMobileRef, posYMobile) : undefined}
                onPointerMove={previewUrl ? makePointerMove(dragMobileRef, setPosYMobile) : undefined}
                onPointerUp={previewUrl ? makePointerUp(dragMobileRef) : undefined}
                onPointerCancel={previewUrl ? makePointerUp(dragMobileRef) : undefined}
              >
                {!previewUrl && (
                  <div className={styles.bannerModalEmpty}>
                    {dragOver ? 'Drop image to upload' : 'Click or drop an image'}
                  </div>
                )}
                {previewUrl && (
                  <div className={styles.bannerModalDragHint}>Drag to reposition</div>
                )}
              </div>
            </div>
          </div>

          <div className={styles.bannerModalHint}>
            Drag &amp; drop an image onto the previews, or use the button below
            (recommended <strong>1600 × 400px</strong>, max 5 MB). Once set, drag
            each preview vertically to set the crop for desktop and mobile
            independently.
          </div>
          <div className={styles.bannerModalNote}>
            Note: if dragging doesn&apos;t move the image, the entire image is
            already fitting within the frame &mdash; no repositioning needed.
          </div>

          {error && <div className={styles.bannerModalError}>{error}</div>}

          <div className={styles.bannerModalActions}>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className={styles.bannerModalBtn}
            >
              {previewUrl ? 'Choose new image' : 'Upload image'}
            </button>
            {initialUrl && (
              <button
                type="button"
                onClick={removeBanner}
                disabled={busy}
                className={`${styles.bannerModalBtn} ${styles.bannerModalBtnDanger}`}
              >
                Remove banner
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className={styles.bannerModalBtn}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || !previewUrl}
              className={`${styles.bannerModalBtn} ${styles.bannerModalBtnPrimary}`}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={onFilePick}
          />
        </div>
      </div>
    </div>
  );
}

// ── EditTabsModal ──────────────────────────────────────────────
// Owner-only modal to toggle which tabs are visible to public visitors.
// Booking tab is not in here — it's controlled separately by booking
// settings. Persists to users.tab_visibility as a JSON object.
export function EditTabsModal({
  userId,
  initial,
  initialOrder,
  isMobileDJ,
  onClose,
}: {
  userId: string;
  initial: {
    about: boolean;
    mixes: boolean;
    images: boolean;
    video: boolean;
    testimonials: boolean;
    faq: boolean;
    staff: boolean;
    affiliates: boolean;
  };
  // The owner's current tab order (keys), from users.tab_order.
  initialOrder?: string[];
  isMobileDJ: boolean;
  onClose: () => void;
}) {
  type TabRowKey = keyof typeof initial;
  const [vis, setVis] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(key: TabRowKey) {
    setVis(v => ({ ...v, [key]: !v[key] }));
  }

  // The keys that appear as draggable rows here. Testimonials + FAQ are only
  // relevant for mobile DJs, so club DJs never see (or reorder) them.
  const META: Record<TabRowKey, { label: string; hint?: string }> = {
    about: { label: 'About' },
    mixes: { label: 'Mixes' },
    images: { label: 'Photos' },
    video: { label: 'Video' },
    testimonials: { label: 'Testimonials', hint: 'Off by default for new mobile DJs' },
    faq: { label: 'FAQ', hint: 'Off by default — turn on to answer common questions' },
    staff: { label: 'Staff', hint: 'Off by default — show your team members' },
    affiliates: { label: 'Affiliates', hint: 'Off by default — companies you recommend' },
  };
  const AVAILABLE: TabRowKey[] = isMobileDJ
    ? ['about', 'mixes', 'images', 'video', 'testimonials', 'faq', 'staff', 'affiliates']
    : ['about', 'mixes', 'images', 'video'];

  // Working order: start from the saved order (filtered to what's available),
  // then append any available key the saved order didn't include.
  const [order, setOrder] = useState<TabRowKey[]>(() => {
    const avail = new Set<TabRowKey>(AVAILABLE);
    const seen = new Set<TabRowKey>();
    const out: TabRowKey[] = [];
    for (const k of initialOrder || []) {
      if (avail.has(k as TabRowKey) && !seen.has(k as TabRowKey)) {
        out.push(k as TabRowKey); seen.add(k as TabRowKey);
      }
    }
    for (const k of AVAILABLE) if (!seen.has(k)) out.push(k);
    return out;
  });

  // ── Drag to reorder (pointer-based, so it works on mouse AND touch) ──────
  const listRef = useRef<HTMLDivElement | null>(null);
  const [dragKey, setDragKey] = useState<TabRowKey | null>(null);

  function reorder(list: TabRowKey[], fromKey: TabRowKey, toKey: TabRowKey): TabRowKey[] {
    const from = list.indexOf(fromKey);
    const to = list.indexOf(toKey);
    if (from < 0 || to < 0 || from === to) return list;
    const next = list.slice();
    next.splice(from, 1);
    next.splice(to, 0, fromKey);
    return next;
  }

  useEffect(() => {
    if (!dragKey) return;
    const activeKey = dragKey; // narrowed, stable for this drag
    function onMove(e: PointerEvent) {
      const container = listRef.current;
      if (!container) return;
      const rowEls = Array.from(container.querySelectorAll<HTMLElement>('[data-tab-key]'));
      let targetKey: TabRowKey | null = null;
      for (const el of rowEls) {
        const r = el.getBoundingClientRect();
        // Pick the row whose vertical midpoint the pointer has crossed.
        if (e.clientY < r.top + r.height / 2) { targetKey = el.dataset.tabKey as TabRowKey; break; }
        targetKey = el.dataset.tabKey as TabRowKey;
      }
      if (targetKey && targetKey !== activeKey) {
        const dest = targetKey;
        setOrder(prev => reorder(prev, activeKey, dest));
      }
    }
    function onUp() { setDragKey(null); }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragKey]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveProfile(userId, { tab_visibility: vis, tab_order: order });
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
      setBusy(false);
    }
  }

  return (
    <div className={styles.bannerModalBackdrop} onClick={onClose}>
      <div className={styles.bannerModal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className={styles.bannerModalHeader}>
          <h2 className={styles.bannerModalTitle}>Edit Tabs</h2>
          <button
            type="button"
            onClick={onClose}
            className={styles.bannerModalClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className={styles.bannerModalBody}>
          <div className={styles.bannerModalHint}>
            Toggle which tabs are visible, and drag the handle to reorder them.
            The <strong>Booking</strong> tab is controlled separately by your
            booking settings.
          </div>

          <div className={styles.tabsList} ref={listRef}>
            {order.map(key => {
              const meta = META[key];
              return (
                <div
                  key={key}
                  data-tab-key={key}
                  className={`${styles.tabsRow} ${dragKey === key ? styles.tabsRowDragging : ''}`}
                >
                  <button
                    type="button"
                    className={styles.tabsDragHandle}
                    aria-label={`Reorder ${meta.label}`}
                    onPointerDown={(e) => { e.preventDefault(); setDragKey(key); }}
                    style={{ touchAction: 'none' }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" />
                      <path d="M9 8 12 5l3 3" />
                      <path d="M9 16 12 19l3-3" />
                      <path d="M8 9 5 12l3 3" />
                      <path d="M16 9 19 12l-3 3" />
                    </svg>
                  </button>
                  <div className={styles.tabsRowText}>
                    <div className={styles.tabsRowLabel}>{meta.label}</div>
                    {meta.hint && (
                      <div className={styles.tabsRowHint}>{meta.hint}</div>
                    )}
                  </div>
                  <input
                    type="checkbox"
                    checked={vis[key]}
                    onChange={() => toggle(key)}
                    className={styles.tabsCheckbox}
                    aria-label={`Show ${meta.label} tab`}
                  />
                </div>
              );
            })}
          </div>

          {error && <div className={styles.bannerModalError}>{error}</div>}

          <div className={styles.bannerModalActions}>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className={styles.bannerModalBtn}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className={`${styles.bannerModalBtn} ${styles.bannerModalBtnPrimary}`}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
