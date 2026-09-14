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
        @keyframes gdcToastIn {
          from { opacity: 0; transform: translateY(12px) scale(.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          zIndex: 100000,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          maxWidth: 'min(92vw, 380px)',
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
                alignItems: 'flex-start',
                gap: 12,
                padding: '13px 15px',
                background: '#14141f',
                color: '#fff',
                border: '1px solid rgba(255,255,255,.12)',
                borderLeft: `3px solid ${accent}`,
                borderRadius: 12,
                boxShadow: '0 12px 34px rgba(0,0,0,.55)',
                fontFamily: "var(--font-inter, 'Inter'), system-ui, sans-serif",
                fontSize: 13.5,
                lineHeight: 1.45,
                animation: 'gdcToastIn .22s cubic-bezier(.2,.8,.2,1)',
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
