'use client';

import styles from '../profile.module.css';

// Full-screen image overlay for gallery photos and the avatar. Prev/next arrows
// (shown only when more than one image is in the current list), zoom controls,
// the image itself, and an optional caption band along the bottom. All state
// stays in ProfileView; this is a pure presentational component.
export function Lightbox({ src, zoom, list, captions, onClose, onStep, onZoom }: {
  src: string | null;
  zoom: number;
  list: string[];
  captions: Record<string, string>;
  onClose: () => void;
  onStep: (dir: 1 | -1) => void;
  onZoom: (next: number) => void;
}) {
  return (
    <div
      className={`${styles.lightbox} ${src ? styles.lightboxActive : ''}`}
      onClick={() => onClose()}
    >
      <button
        className={styles.lightboxClose}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        type="button"
        aria-label="Close"
      >
        ×
      </button>
      {src && (
        /* Wrap the image so the prev/next arrows can sit at the image's own
           left/right edges (not the far screen edges). */
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} onClick={(e) => e.stopPropagation()}>
          {list.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous photo"
                onClick={(e) => { e.stopPropagation(); onStep(-1); }}
                style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 2 }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
              </button>
              <button
                type="button"
                aria-label="Next photo"
                onClick={(e) => { e.stopPropagation(); onStep(1); }}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 2 }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            </>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={captions[src] || ''}
            style={{ transform: `scale(${zoom})`, transition: 'transform .15s ease', transformOrigin: 'center center', maxWidth: '90vw', maxHeight: '88vh', width: 'auto', height: 'auto', objectFit: 'contain', borderRadius: 8 }}
          />
          {/* Caption band — transparent black strip along the bottom of the
              photo, shown when this photo has a caption. */}
          {captions[src] && (
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '.7rem 1rem', background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: '.9rem', lineHeight: 1.35, textAlign: 'center', borderBottomLeftRadius: 8, borderBottomRightRadius: 8, pointerEvents: 'none' }}>
              {captions[src]}
            </div>
          )}
        </div>
      )}
      {/* Zoom controls — bottom center. Zoom out disabled at fit (1x). */}
      {src && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(4px)', borderRadius: 999, padding: '.3rem .4rem', zIndex: 3 }}
        >
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoom <= 1}
            onClick={(e) => { e.stopPropagation(); onZoom(Math.max(1, Math.round((zoom - 0.5) * 10) / 10)); }}
            style={{ width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'transparent', color: '#fff', cursor: zoom <= 1 ? 'default' : 'pointer', opacity: zoom <= 1 ? 0.4 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
          </button>
          <span style={{ color: '#fff', fontSize: '.78rem', minWidth: 38, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoom >= 4}
            onClick={(e) => { e.stopPropagation(); onZoom(Math.min(4, Math.round((zoom + 0.5) * 10) / 10)); }}
            style={{ width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'transparent', color: '#fff', cursor: zoom >= 4 ? 'default' : 'pointer', opacity: zoom >= 4 ? 0.4 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}
