'use client';

// PlannerAssistant — a floating helper for the HOST filling out their Planner &
// Playlist. It knows this planner's fields and the event type (server-side) and
// walks the host through answering each question. Self-contained inline styles
// so it sits cleanly on either planner theme (dark or light). It only advises —
// the host still types their answers into the form itself.

import { useState, useRef, useEffect } from 'react';

type Msg = { role: 'user' | 'assistant'; content: string };

const GREETING =
  "Hi! I can help you fill out your planner. Not sure what to put for a question, or want song ideas for your event? Just ask — like “what should I put for must-play songs?”";

export default function PlannerAssistant({
  plannerId,
  accent = '#1f9e74',
}: {
  plannerId: string;
  accent?: string;
}) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, open, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    const next: Msg[] = [...msgs, { role: 'user', content: text }];
    setMsgs(next);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/planner-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plannerId, messages: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'The helper is unavailable right now.');
      setMsgs((prev) => [...prev, { role: 'assistant', content: String(data.reply || '') }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open the planner helper"
        style={{
          position: 'fixed', right: 18, bottom: 18, zIndex: 4000,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '12px 18px', borderRadius: 999, border: 'none', cursor: 'pointer',
          background: accent, color: '#fff', fontWeight: 700, fontSize: 14,
          boxShadow: '0 8px 24px rgba(0,0,0,.35)', fontFamily: 'inherit',
        }}
      >
        💬 Need help?
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed', right: 18, bottom: 18, zIndex: 4000,
        width: 'min(380px, calc(100vw - 36px))', height: 'min(540px, calc(100dvh - 36px))',
        display: 'flex', flexDirection: 'column',
        background: '#15151c', color: '#f0f0f8', borderRadius: 16, overflow: 'hidden',
        boxShadow: '0 16px 48px rgba(0,0,0,.5)', border: '1px solid rgba(255,255,255,.08)',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#0e0e14', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, display: 'inline-block' }} />
          Planner Helper
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ background: 'none', border: 'none', color: '#9aa0b4', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>✕</button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 4px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ alignSelf: 'flex-start', maxWidth: '88%', background: '#23232e', borderRadius: 12, padding: '10px 13px', fontSize: 13.5, lineHeight: 1.55, color: '#d7d7e2' }}>
          {GREETING}
        </div>
        {msgs.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '88%',
              background: m.role === 'user' ? accent : '#23232e',
              color: m.role === 'user' ? '#fff' : '#d7d7e2',
              borderRadius: 12, padding: '10px 13px', fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-wrap',
            }}
          >
            {m.content}
          </div>
        ))}
        {busy && (
          <div style={{ alignSelf: 'flex-start', background: '#23232e', borderRadius: 12, padding: '10px 13px', fontSize: 13.5, color: '#9aa0b4' }}>Thinking…</div>
        )}
        {/* One-time disclaimer, shown once the helper has answered — so the host
            knows the suggestions are the platform's, not the DJ's. */}
        {msgs.some((m) => m.role === 'assistant') && (
          <div style={{ alignSelf: 'center', textAlign: 'center', maxWidth: '94%', color: '#8a8fa3', fontSize: 11, lineHeight: 1.5, padding: '2px 4px' }}>
            ℹ️ Suggestions and responses here are powered by Global DJ Connect and are not shaped by the DJ you&apos;ve booked.
          </div>
        )}
        {error && (
          <div style={{ alignSelf: 'flex-start', maxWidth: '88%', background: '#3a1f24', color: '#f3b9c1', borderRadius: 12, padding: '10px 13px', fontSize: 13 }}>{error}</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid rgba(255,255,255,.07)' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask about any question…"
          style={{ flex: 1, background: '#0e0e14', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, color: '#fff', padding: '10px 12px', fontSize: 13.5, outline: 'none', fontFamily: 'inherit' }}
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || !input.trim()}
          style={{ background: accent, border: 'none', borderRadius: 10, color: '#fff', padding: '0 14px', fontWeight: 700, fontSize: 13.5, cursor: busy || !input.trim() ? 'default' : 'pointer', opacity: busy || !input.trim() ? 0.6 : 1 }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
