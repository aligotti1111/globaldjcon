'use client';

// DjAssistant — a floating, read-only chat helper for the logged-in DJ.
//
// It answers questions about their own bookings/earnings and helps them find
// pages in the app. It does NOT take actions. Eligibility (paid tier, not free)
// is decided by the server: on mount we GET /api/dj/assistant and only render
// the launcher when { enabled: true }. All the real work + gating happens in the
// POST handler; this component is just the UI.
//
// Mounted once in (main)/layout.tsx, so its state (the conversation) survives
// navigation between dashboard pages within that layout.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import styles from './DjAssistant.module.css';
import { ContactTrigger } from '@/components/ContactModal';

type Msg = { role: 'user' | 'assistant'; content: string; ts: number; isError?: boolean };

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch { return ''; }
}

// Render the assistant's text, turning [label](/path) markdown links into
// clickable in-app links. Only internal paths (starting with "/") become real
// links; anything else is shown as plain text so the bot can't link off-site.
const LINK_RE = /\[([^\]]+)\]\((\/[^)\s]*)\)/g;
function renderContent(text: string, onNavigate: (href: string) => void) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const label = m[1];
    const href = m[2];
    // A /contact link opens the Contact Us form as a popup (over the dashboard)
    // instead of navigating away — so the assistant can hand off to support
    // without ever exposing a raw email address.
    if (href === '/contact') {
      out.push(
        <ContactTrigger key={`${m.index}-contact`} className={styles.navlink}>{label}</ContactTrigger>
      );
    } else {
      out.push(
        <a
          key={`${m.index}-${href}`}
          href={href}
          className={styles.navlink}
          onClick={(e) => { e.preventDefault(); onNavigate(href); }}
        >{label}</a>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const GREETING =
  "Hi! I'm your Global DJ Connect assistant. Ask me about your bookings or earnings — like “who owes me money?” or “what's on the books next month?” — or where to find something in the app.";

const STORE_KEY = 'gdc_dj_assistant_convo';
const SIZE_KEY = 'gdc_dj_assistant_size';
const ENABLED_KEY = 'gdc_dj_assistant_enabled';

// Remember whether this account is eligible so the launcher shows INSTANTLY on
// the next page instead of waiting for the /api/dj/assistant round-trip. We
// still re-check on mount to catch a plan/toggle change — this just removes the
// visible delay on every navigation after the first.
function loadEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.sessionStorage.getItem(ENABLED_KEY) === '1'; } catch { return false; }
}

// The panel can be made smaller or wider. Three steps; the middle one is the
// default. Width/height are applied inline and still get clamped to the
// viewport by the CSS (max-width / max-height), so "wide" can't overflow a
// phone. Persisted so the DJ's choice sticks across reopen + navigation.
type PanelSize = 'sm' | 'md' | 'lg';
const SIZE_DIMS: Record<PanelSize, { width: number; height: number }> = {
  sm: { width: 320, height: 440 },
  md: { width: 370, height: 540 },
  lg: { width: 460, height: 660 },
};
const SIZE_ORDER: PanelSize[] = ['sm', 'md', 'lg'];
function loadSize(): PanelSize {
  if (typeof window === 'undefined') return 'md';
  try {
    const v = window.sessionStorage.getItem(SIZE_KEY);
    return v === 'sm' || v === 'lg' ? v : 'md';
  } catch { return 'md'; }
}

// Load a saved conversation (survives closing the widget or navigating between
// dashboard pages, which can remount this component). sessionStorage so it
// clears when the tab closes — a fresh visit starts clean.
function loadSaved(): Msg[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export default function DjAssistant() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(loadEnabled);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Msg[]>(loadSaved);
  const [size, setSize] = useState<PanelSize>(loadSize);
  const [startedAt] = useState(() => Date.now());
  // True while the DJ is viewing their own profile in "View as public" preview.
  // We keep showing THIS (the DJ assistant) and add a note so they know they're
  // still talking to their own assistant, not the client Booking Assistant.
  const [previewPublic, setPreviewPublic] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Persist the conversation so it survives closing/reopening and navigation.
  useEffect(() => {
    try { window.sessionStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-40))); } catch { /* ignore */ }
  }, [messages]);

  // Remember the chosen panel size.
  useEffect(() => {
    try { window.sessionStorage.setItem(SIZE_KEY, size); } catch { /* ignore */ }
  }, [size]);

  // Step the panel one size bigger / smaller (clamped to the three presets).
  const resize = (dir: 1 | -1) =>
    setSize((s) => SIZE_ORDER[Math.min(SIZE_ORDER.length - 1, Math.max(0, SIZE_ORDER.indexOf(s) + dir))]);

  // Ask the server whether this viewer may use the assistant.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/dj/assistant', { method: 'GET' });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        const ok = !!j?.enabled;
        setEnabled(ok);
        // Cache the verdict so the launcher appears instantly next navigation.
        try { window.sessionStorage.setItem(ENABLED_KEY, ok ? '1' : '0'); } catch { /* ignore */ }
      } catch { /* silent — keep whatever the cache showed */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // React instantly when the DJ flips the setting in Account Settings — no
  // page refresh needed (the widget lives in the layout, so it stays mounted).
  useEffect(() => {
    const onToggle = (e: Event) => {
      const on = (e as CustomEvent).detail?.enabled;
      setEnabled(!!on);
      try { window.sessionStorage.setItem(ENABLED_KEY, on ? '1' : '0'); } catch { /* ignore */ }
      if (!on) setOpen(false);
    };
    window.addEventListener('gdc:assistant-toggled', onToggle as EventListener);
    return () => window.removeEventListener('gdc:assistant-toggled', onToggle as EventListener);
  }, []);

  // Track the owner's "View as public" preview so we can show the reminder note.
  useEffect(() => {
    const onPreview = (e: Event) => setPreviewPublic(!!(e as CustomEvent).detail?.on);
    window.addEventListener('gdc:preview-public', onPreview as EventListener);
    return () => window.removeEventListener('gdc:preview-public', onPreview as EventListener);
  }, []);

  // Keep the transcript pinned to the newest message.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  if (!enabled) return null;

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const userMsg: Msg = { role: 'user', content: text, ts: Date.now() };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setBusy(true);
    try {
      // Only send REAL turns to the server — drop any prior error placeholders
      // (e.g. "Connection problem…") so they don't pollute the model's context.
      const history = messages.filter((m) => !m.isError);
      const r = await fetch('/api/dj/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [...history, userMsg] }),
      });
      // Read as text first so we can surface the real HTTP status even when the
      // body isn't JSON (a platform 500/504 returns an HTML error page).
      const bodyText = await r.text().catch(() => '');
      let j: { reply?: string; error?: string } = {};
      try { j = JSON.parse(bodyText); } catch { /* non-JSON error page */ }
      const ok = r.ok && !!j?.reply;
      const reply = ok
        ? String(j.reply)
        : (j?.error ? String(j.error) : `Something went wrong (HTTP ${r.status}). Please try again.`);
      setMessages((m) => [...m, { role: 'assistant', content: reply, ts: Date.now(), isError: !ok }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: 'Connection problem — please try again.', ts: Date.now(), isError: true }]);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  // Click a link in the assistant's reply → navigate there in-app and close the
  // panel so they land on the page. Only internal paths reach here.
  const navigate = (href: string) => {
    setOpen(false);
    try { router.push(href); } catch { window.location.href = href; }
  };

  return (
    <>
      {!open && (
        <button className={styles.launcher} onClick={() => setOpen(true)} aria-label="Open assistant">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span>Assistant</span>
        </button>
      )}

      {open && (
        <div
          className={styles.panel}
          role="dialog"
          aria-label="Assistant"
          style={{ ['--panel-w']: `${SIZE_DIMS[size].width}px`, ['--panel-h']: `${SIZE_DIMS[size].height}px` } as React.CSSProperties}
        >
          <div className={styles.head}>
            <div className={styles.title}>
              <span className={styles.dot} />
              Assistant
            </div>
            <div className={styles.headBtns}>
              <button className={styles.min} onClick={() => resize(-1)} disabled={size === 'sm'} aria-label="Make smaller" title="Make smaller" style={{ opacity: size === 'sm' ? 0.4 : 1 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 4 4 4 4 9" /><polyline points="15 20 20 20 20 15" /><line x1="4" y1="4" x2="10" y2="10" /><line x1="20" y1="20" x2="14" y2="14" /></svg>
              </button>
              <button className={styles.min} onClick={() => resize(1)} disabled={size === 'lg'} aria-label="Make wider" title="Make wider" style={{ opacity: size === 'lg' ? 0.4 : 1 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
              </button>
              <button className={styles.min} onClick={() => setOpen(false)} aria-label="Minimize" title="Minimize">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="6" y1="12" x2="18" y2="12" /></svg>
              </button>
              <button className={styles.close} onClick={() => setOpen(false)} aria-label="Close">&times;</button>
            </div>
          </div>

          <div className={styles.body} ref={scrollRef}>
            {previewPublic && (
              <div className={styles.previewNote}>
                You&apos;re viewing your profile as the public sees it. This is still <strong>your DJ assistant</strong> — not the client Booking Assistant visitors use.
              </div>
            )}
            <div className={`${styles.row} ${styles.rowBot}`}>
              <div className={`${styles.msg} ${styles.bot}`}>{GREETING}</div>
              <div className={styles.time}>{fmtTime(startedAt)}</div>
            </div>
            {messages.map((m, i) => (
              <div key={i} className={`${styles.row} ${m.role === 'user' ? styles.rowUser : styles.rowBot}`}>
                <div className={`${styles.msg} ${m.role === 'user' ? styles.user : styles.bot}`}>{m.role === 'assistant' ? renderContent(m.content, navigate) : m.content}</div>
                <div className={styles.time}>{fmtTime(m.ts)}</div>
              </div>
            ))}
            {busy && <div className={`${styles.msg} ${styles.bot} ${styles.typing}`}>…</div>}
          </div>

          <div className={styles.foot}>
            <textarea
              ref={inputRef}
              className={styles.input}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask about your bookings…"
              rows={1}
              maxLength={2000}
            />
            <button className={styles.send} onClick={send} disabled={busy || !input.trim()} aria-label="Send">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <div className={styles.disclaimer}>Read-only · answers about your own bookings</div>
        </div>
      )}
    </>
  );
}
