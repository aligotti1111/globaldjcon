'use client';

// Toaster — replaces the browser's native window.alert() with on-brand toast
// notifications, app-wide, without touching any of the ~hundreds of existing
// alert() call sites. Mounted once in the root layout.
//
// How: on mount we swap window.alert for a function that pushes the message
// onto a queue and renders it as a styled toast (auto-dismissing). The original
// alert is restored on unmount. confirm()/prompt() are left native — they must
// return synchronously, which a React modal can't do without refactoring every
// caller to async.
//
// Tone is inferred from the text: failures ("could not", "failed", "invalid"…)
// get a red accent; everything else gets the neon "success" accent. Purely
// cosmetic — the message is shown verbatim either way.

import { useEffect, useRef, useState } from 'react';

interface Toast { id: number; msg: string; error: boolean }

const ERROR_HINT = /(could ?n['o]t|cannot|can't|failed|error|invalid|unable|not allowed|try again|wrong|must |enter |missing|too (large|big)|required)/i;

export default function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    const original = window.alert;
    window.alert = (message?: unknown) => {
      const msg = message == null ? '' : String(message);
      const id = ++idRef.current;
      setToasts((list) => [...list, { id, msg, error: ERROR_HINT.test(msg) }]);
      // Auto-dismiss; errors linger a little longer so they can be read.
      window.setTimeout(
        () => setToasts((list) => list.filter((t) => t.id !== id)),
        ERROR_HINT.test(msg) ? 6000 : 4200,
      );
    };
    return () => { window.alert = original; };
  }, []);

  const dismiss = (id: number) => setToasts((list) => list.filter((t) => t.id !== id));

  return (
    <>
      <style>{`
        @keyframes gdcToastIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes gdcToastOut { from { opacity: 1; } to { opacity: 0; } }
      `}</style>
      {/* Full-screen flex wrapper centers the box WITHOUT a transform on the box
          itself — a translate(-50%,-50%) on an odd-width element lands on a
          half-pixel and renders the text blurry. Opacity-only fade keeps it
          crisp. */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          pointerEvents: 'none',
        }}
        aria-live="polite"
        role="status"
      >
        {toasts.map((t) => {
          const accent = t.error ? '#ff6b6b' : 'var(--neon, #00f5c4)';
          return (
            <div
              key={t.id}
              onClick={() => dismiss(t.id)}
              style={{
                pointerEvents: 'auto',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 13,
                padding: '18px 22px',
                background: '#14141f',
                color: '#fff',
                border: `1px solid ${t.error ? 'rgba(255,107,107,.4)' : 'rgba(0,245,196,.35)'}`,
                borderTop: `3px solid ${accent}`,
                borderRadius: 6,
                boxShadow: '0 24px 60px rgba(0,0,0,.6)',
                fontFamily: "var(--font-inter, 'Inter'), system-ui, sans-serif",
                fontSize: 15,
                fontWeight: 600,
                lineHeight: 1.4,
                textAlign: 'left',
                // Fade in, hold, then fade away (opacity only — no scale, which blurs text).
                animation: `gdcToastIn .2s ease, gdcToastOut .5s ease forwards ${(t.error ? 6000 : 4200) - 500}ms`,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flexShrink: 0,
                  marginTop: 1,
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: accent,
                  color: '#0b0b12',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                {t.error ? '!' : '✓'}
              </span>
              <span style={{ flex: 1 }}>{t.msg}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
