'use client';

// AvatarCrop — modal for cropping a selected image into a 400x400 PNG
// circular avatar, then uploading to Supabase storage at
// `${userId}/avatar.png` (overwrites prior). Faithful port of vanilla
// udjp-images.js openCropModal/cropDraw/applyCrop.
//
// Flow:
//   1. Parent passes a `file` prop — when set, modal opens
//   2. User can drag (mouse or touch) to pan, slide zoom 1x-3x
//   3. "Use This Photo" → exports center 80% of canvas as a 400x400 PNG
//      clipped to a circle, uploads, calls onSuccess(publicUrl)
//   4. "Cancel" → calls onClose without uploading
//
// We render the modal only when `file` is non-null. The image-load and
// initial-fit math runs in an effect after the canvas mounts so we have
// real offsetWidth measurements.

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './updateDjProfile.module.css';

interface Props {
  file: File | null;
  userId: string;
  onClose: () => void;
  onSuccess: (publicUrl: string) => void;
}

export default function AvatarCrop({ file, userId, onClose, onSuccess }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Image data + transform state. Stored in refs (not state) because
  // mouse/touch drag handlers fire dozens of times per second and we
  // only want React renders for things that affect the UI (zoom slider).
  const imgRef = useRef<HTMLImageElement | null>(null);
  const xRef = useRef(0);
  const yRef = useRef(0);
  const scaleRef = useRef(1);
  const draggingRef = useRef(false);
  const lastXRef = useRef(0);
  const lastYRef = useRef(0);

  const [zoom, setZoom] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Load image when `file` prop is set ─────────────────────────
  useEffect(() => {
    if (!file) return;
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        imgRef.current = img;
        // Wait one frame so wrapRef.offsetWidth is valid
        requestAnimationFrame(() => {
          const wrap = wrapRef.current;
          if (!wrap) return;
          const size = wrap.offsetWidth;
          // Center the image in the canvas
          xRef.current = (size - img.width) / 2;
          yRef.current = (size - img.height) / 2;
          // Initial scale: fit the image inside the 80% circle area
          const minFit = (size * 0.8) / Math.min(img.width, img.height);
          if (minFit > 1) {
            scaleRef.current = minFit;
            setZoom(Math.min(minFit, 3));
            xRef.current = (size - img.width * minFit) / 2;
            yRef.current = (size - img.height * minFit) / 2;
          } else {
            scaleRef.current = 1;
            setZoom(1);
          }
          draw();
        });
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, [file]);

  // ── Draw current state to canvas ───────────────────────────────
  function draw() {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!wrap || !canvas) return;
    const size = wrap.offsetWidth;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    if (!img) return;
    const s = scaleRef.current;
    ctx.drawImage(img, xRef.current, yRef.current, img.width * s, img.height * s);
  }

  // ── Drag handlers (mouse + touch) ──────────────────────────────
  function onMouseDown(e: React.MouseEvent) {
    draggingRef.current = true;
    lastXRef.current = e.clientX;
    lastYRef.current = e.clientY;
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!draggingRef.current) return;
    xRef.current += e.clientX - lastXRef.current;
    yRef.current += e.clientY - lastYRef.current;
    lastXRef.current = e.clientX;
    lastYRef.current = e.clientY;
    draw();
  }
  function onMouseUp() {
    draggingRef.current = false;
  }
  function onTouchStart(e: React.TouchEvent) {
    e.preventDefault();
    const t = e.touches[0];
    draggingRef.current = true;
    lastXRef.current = t.clientX;
    lastYRef.current = t.clientY;
  }
  function onTouchMove(e: React.TouchEvent) {
    e.preventDefault();
    if (!draggingRef.current) return;
    const t = e.touches[0];
    xRef.current += t.clientX - lastXRef.current;
    yRef.current += t.clientY - lastYRef.current;
    lastXRef.current = t.clientX;
    lastYRef.current = t.clientY;
    draw();
  }

  // ── Zoom slider — anchors zoom to canvas center ────────────────
  function onZoomChange(e: React.ChangeEvent<HTMLInputElement>) {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const size = wrap.offsetWidth;
    const centerX = size / 2;
    const centerY = size / 2;
    const oldScale = scaleRef.current;
    const newScale = parseFloat(e.target.value);
    xRef.current = centerX - (centerX - xRef.current) * (newScale / oldScale);
    yRef.current = centerY - (centerY - yRef.current) * (newScale / oldScale);
    scaleRef.current = newScale;
    setZoom(newScale);
    draw();
  }

  // ── Apply: export 400x400 PNG, upload to Supabase ──────────────
  async function applyCrop() {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    setUploading(true);
    setError(null);
    try {
      const size = wrap.offsetWidth;
      const cropSize = size * 0.8;
      const offset = size * 0.1;

      // Draw the center 80% of canvas onto a 400x400 output, clipped to circle
      const out = document.createElement('canvas');
      out.width = 400;
      out.height = 400;
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');
      ctx.beginPath();
      ctx.arc(200, 200, 200, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(canvas, offset, offset, cropSize, cropSize, 0, 0, 400, 400);

      // Convert to blob
      const blob = await new Promise<Blob | null>((resolve) =>
        out.toBlob(resolve, 'image/png')
      );
      if (!blob) throw new Error('Failed to encode image');

      // Upload to Supabase. Path is fixed (`avatar.png`) so it overwrites
      // any prior avatar — matches vanilla. Append `?t=` cache-buster to
      // public URL so the new image shows up immediately.
      const supabase = createClient();
      const path = `${userId}/avatar.png`;
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, {
          upsert: true,
          contentType: 'image/png',
        });
      if (uploadErr) throw uploadErr;

      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = `${data.publicUrl}?t=${Date.now()}`;
      onSuccess(publicUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setError(msg);
    } finally {
      setUploading(false);
    }
  }

  // ── Render nothing when no file — modal closed ─────────────────
  if (!file) return null;

  return (
    <div className={styles.cropModal} onClick={onClose}>
      <div className={styles.cropModalInner} onClick={(e) => e.stopPropagation()}>
        <h3>Crop Profile Photo</h3>
        {/* Recommended-size hint — exported avatars are 400×400 square,
            so a square source 400px+ on its shortest side gives the
            best result. Anything smaller upscales and looks soft. */}
        <p style={{
          margin: '0 0 0.75rem',
          color: 'var(--muted, #888)',
          fontSize: '.78rem',
          fontFamily: 'DM Sans, sans-serif',
          textAlign: 'center',
          lineHeight: 1.5,
        }}>
          Best fit: a square image at least <strong style={{ color: 'var(--neon)' }}>400×400</strong>.
          800×800 or larger looks crispest.
        </p>

        <div
          ref={wrapRef}
          className={styles.cropCanvasWrap}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onMouseUp}
        >
          <canvas ref={canvasRef} className={styles.cropCanvas} />
          <div className={styles.cropCircleOverlay} />
        </div>

        <div className={styles.cropControls}>
          <label htmlFor="ud-crop-zoom">Zoom</label>
          <input
            id="ud-crop-zoom"
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={onZoomChange}
            className={styles.cropZoomInput}
          />
        </div>

        {error && (
          <div className={styles.cropError}>{error}</div>
        )}

        <div className={styles.cropBtnsRow}>
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className={styles.cropBtnCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={applyCrop}
            disabled={uploading}
            className={styles.cropBtnApply}
          >
            {uploading ? 'Uploading…' : 'Use This Photo'}
          </button>
        </div>
      </div>
    </div>
  );
}
