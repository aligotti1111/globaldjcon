'use client';

// BookingBot — the booker-facing chat helper on a DJ's public profile.
//
// Answers a potential client's questions, quotes a price RANGE from the DJ's
// packages/rate, and collects booking details. After a few free messages an
// anonymous visitor hits a wall asking them to create an account to keep going
// (enforced server-side; here we just render the CTA). Mounted by ProfileView
// only when the server says this DJ is eligible (Premium Pro+, bot on).

import { useEffect, useRef, useState } from 'react';
import styles from './bookingBot.module.css';
import { saveBookingPrefill } from '@/lib/bookingPrefill';

type Msg = { role: 'user' | 'assistant'; content: string };

// One saved conversation PER DJ (keyed by slug) so a booker who browses from
// profile to profile keeps each chat separately and can come back to reread.
// sessionStorage: survives close/reopen + navigation, clears when the tab closes.
const storeKey = (slug: string) => `gdc_bookingbot_${slug}`;
function loadSaved(slug: string): Msg[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(storeKey(slug));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// Remember (per DJ, for the tab session) that the booker already submitted a
// request / sent a message, so the buttons stay in their done state on reopen.
const flagKey = (slug: string, k: string) => `gdc_bookingbot_${k}_${slug}`;
function loadFlag(slug: string, k: string): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.sessionStorage.getItem(flagKey(slug, k)) === '1'; } catch { return false; }
}
function saveFlag(slug: string, k: string): void {
  try { window.sessionStorage.setItem(flagKey(slug, k), '1'); } catch { /* ignore */ }
}

export default function BookingBot({ slug, djName }: { slug: string; djName: string | null }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [prepping, setPrepping] = useState(false);
  const [messages, setMessages] = useState<Msg[]>(() => loadSaved(slug));
  // Done states: the request was actually submitted / a message was actually
  // sent (fired by the booking form + compose modal, not just a click).
  const [requestSent, setRequestSent] = useState(() => loadFlag(slug, 'reqsent'));
  const [messageSent, setMessageSent] = useState(() => loadFlag(slug, 'msgsent'));
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // If this widget is reused for a different DJ, load that DJ's saved chat + flags.
  useEffect(() => {
    setMessages(loadSaved(slug));
    setRequestSent(loadFlag(slug, 'reqsent'));
    setMessageSent(loadFlag(slug, 'msgsent'));
  }, [slug]);

  // Listen for the real completion signals from the booking form / compose modal.
  useEffect(() => {
    const onBooked = (e: Event) => {
      if ((e as CustomEvent).detail?.slug && (e as CustomEvent).detail.slug !== slug) return;
      saveFlag(slug, 'reqsent');
      setRequestSent(true);
    };
    const onMessaged = (e: Event) => {
      if ((e as CustomEvent).detail?.slug && (e as CustomEvent).detail.slug !== slug) return;
      saveFlag(slug, 'msgsent');
      setMessageSent(true);
    };
    window.addEventListener('gdc:booking-submitted', onBooked as EventListener);
    window.addEventListener('gdc:message-sent', onMessaged as EventListener);
    return () => {
      window.removeEventListener('gdc:booking-submitted', onBooked as EventListener);
      window.removeEventListener('gdc:message-sent', onMessaged as EventListener);
    };
  }, [slug]);

  // Persist this DJ's conversation under its own key.
  useEffect(() => {
    try { window.sessionStorage.setItem(storeKey(slug), JSON.stringify(messages.slice(-40))); } catch { /* ignore */ }
  }, [slug, messages]);

  const name = (djName || 'this DJ').trim();
  const greeting = `Hi! I can answer questions about booking ${name}, give you a ballpark price, and get your booking request started. What's your event?`;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy, open, locked]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const openSignup = () => {
    window.dispatchEvent(new CustomEvent('gdc:open-auth', { detail: { mode: 'signup' } }));
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy || locked) return;
    const next: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const r = await fetch('/api/booking-bot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, messages: next }),
      });
      const j = await r.json().catch(() => ({}));
      if (j?.locked) {
        setLocked(true);
        setMessages((m) => [...m, { role: 'assistant', content: String(j.reply || 'Create a free account to keep chatting.') }]);
      } else {
        const reply = r.ok && j?.reply ? String(j.reply) : (j?.error ? String(j.error) : 'Something went wrong. Please try again.');
        setMessages((m) => [...m, { role: 'assistant', content: reply }]);
      }
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: 'Connection problem — please try again.' }]);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  // How many times the visitor has spoken — gate the hand-off button until
  // there's something worth pre-filling.
  const userTurns = messages.filter((m) => m.role === 'user').length;

  // Pull what the bot collected into a prefill, then open the real booking
  // request form (the Booking tab) pre-filled for the client to review + submit.
  const startRequest = async () => {
    if (prepping) return;
    setPrepping(true);
    try {
      const r = await fetch('/api/booking-bot/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, messages }),
      });
      const j = await r.json().catch(() => ({}));
      const d = (j && j.draft) || {};
      saveBookingPrefill({
        slug,
        eventType: d.eventType, eventTypeKey: d.eventTypeKey, eventSubType: d.eventSubType,
        date: d.date, startTime: d.startTime, endTime: d.endTime,
        venueName: d.venueName, venueAddress: d.venueAddress,
        fullName: d.fullName, email: d.email, phone: d.phone, notes: d.notes,
        ts: Date.now(),
      });
    } catch {
      // Even if extraction fails, still take them to the form.
      saveBookingPrefill({ slug, ts: Date.now() });
    } finally {
      setPrepping(false);
      setOpen(false);
      window.dispatchEvent(new CustomEvent('gdc:open-booking', { detail: { slug } }));
    }
  };

  return (
    <>
      {!open && (
        <button className={styles.launcher} onClick={() => setOpen(true)} aria-label="Assistant">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span>Assistant</span>
        </button>
      )}

      {open && (
        <div className={styles.panel} role="dialog" aria-label="Booking assistant">
          <div className={styles.head}>
            <div className={styles.title}>
              <span className={styles.dot} />
              Booking {name}
            </div>
            <button className={styles.close} onClick={() => setOpen(false)} aria-label="Close">&times;</button>
          </div>

          <div className={styles.body} ref={scrollRef}>
            <div className={`${styles.msg} ${styles.bot}`}>{greeting}</div>
            {messages.map((m, i) => {
              // The bot appends [[ASK_DJ]] when it can't answer a question about
              // the DJ. Strip it from the text and show a "Message the DJ" button.
              const askDj = m.role === 'assistant' && m.content.includes('[[ASK_DJ]]');
              const text = askDj ? m.content.replace(/\[\[ASK_DJ\]\]/g, '').trim() : m.content;
              return (
                <div key={i}>
                  <div className={`${styles.msg} ${m.role === 'user' ? styles.user : styles.bot}`}>{text}</div>
                  {askDj && (
                    <button
                      className={styles.cta}
                      disabled={messageSent}
                      onClick={() => {
                        if (messageSent) return;
                        setOpen(false);
                        // Prefill the message to the DJ with the booker's own
                        // question (the most recent thing they asked) plus the
                        // assistant's reply, so they don't retype it.
                        const question = [...messages].slice(0, i).reverse()
                          .find((x) => x.role === 'user')?.content?.trim() || '';
                        const subject = question
                          ? `Question about booking: ${question.slice(0, 60)}`
                          : `Question about booking ${name}`;
                        const bodyParts = [];
                        if (question) bodyParts.push(`My question: ${question}`);
                        bodyParts.push(`(Asked through your booking assistant on your profile.)`);
                        const body = bodyParts.join('\n\n');
                        window.dispatchEvent(new CustomEvent('gdc:open-compose', { detail: { slug, subject, body } }));
                      }}
                    >
                      {messageSent ? 'Message sent ✓' : `Message ${name} →`}
                    </button>
                  )}
                </div>
              );
            })}
            {busy && <div className={`${styles.msg} ${styles.bot} ${styles.typing}`}>…</div>}
            {!locked && userTurns >= 2 && (
              <button
                className={styles.startBtn}
                onClick={startRequest}
                disabled={prepping || requestSent}
              >
                {requestSent ? 'Booking request sent ✓' : prepping ? 'Preparing…' : 'Start my booking request →'}
              </button>
            )}
            {locked && (
              <button className={styles.cta} onClick={openSignup}>Create a free account</button>
            )}
          </div>

          {!locked && (
            <div className={styles.foot}>
              <textarea
                ref={inputRef}
                className={styles.input}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Type your question…"
                rows={1}
                maxLength={1500}
              />
              <button className={styles.send} onClick={send} disabled={busy || !input.trim()} aria-label="Send">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          )}
          <div className={styles.disclaimer}>Gives estimates · the DJ confirms every booking</div>
        </div>
      )}
    </>
  );
}
