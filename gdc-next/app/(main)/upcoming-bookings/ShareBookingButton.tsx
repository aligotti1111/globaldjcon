'use client';

// ShareBookingButton — the paper-plane icon (same one the profile pages use)
// that sits at the top-right of a booking card. Clicking it opens a share
// sheet that:
//   1. shows a live PREVIEW of exactly what the recipient will see
//      (the public, read-only /card/<token> page in an iframe), and
//   2. offers three ways to send it: Copy link, Email, Text.
//
// For a MOBILE DJ booking that already has a planner, the sheet also offers a
// toggle to include a link to the client's UNEDITABLE planner
// (/planner/<id>/print — no login, read-only). When that's on, every share
// method carries both links.
//
// The whole row is a click-to-expand button, so every interactive element here
// calls stopPropagation.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { createClient } from '@/lib/supabase/client';

// Turn the DJ's account-email domain into a web-compose URL builder for the big
// webmail providers. For these, a plain mailto: is unreliable on desktop (it
// just opens the provider's homepage), so we open the provider's own compose
// page directly in a new tab with the subject + body preloaded. Anything we
// don't recognise returns null and we fall back to mailto:.
function webComposer(email: string | null): ((subject: string, body: string) => string) | null {
  const domain = (email || '').split('@')[1]?.toLowerCase() || '';
  const enc = encodeURIComponent;
  // NB: Gmail's compose URL names the subject param "su", not "subject".
  if (/^(gmail\.com|googlemail\.com)$/.test(domain))
    return (s, b) => `https://mail.google.com/mail/?view=cm&fs=1&tf=1&su=${enc(s)}&body=${enc(b)}`;
  if (/^(outlook\.|hotmail\.|live\.|msn\.)/.test(domain) || domain === 'outlook.com')
    return (s, b) => `https://outlook.live.com/mail/0/deeplink/compose?subject=${enc(s)}&body=${enc(b)}`;
  if (/^(yahoo\.|ymail\.com|rocketmail\.com)/.test(domain) || domain === 'yahoo.com')
    return (s, b) => `https://compose.mail.yahoo.com/?subject=${enc(s)}&body=${enc(b)}`;
  if (domain === 'aol.com')
    return (s, b) => `https://mail.aol.com/?subject=${enc(s)}&body=${enc(b)}`;
  return null;
}

interface Props {
  shareToken?: string | null;
  /** Only mobile DJ bookings offer the planner link. */
  djType?: 'club' | 'mobile';
  /** The booking's planner id, when one exists (for the uneditable planner link). */
  plannerId?: string | null;
  /** Prefills the recipient number on Text when we have it. */
  phone?: string | null;
  /** A short name for the event, used in the email subject line. */
  eventLabel?: string | null;
  /** Event type + date — led with in the text message so the recipient knows
      which event the link is for. */
  eventType?: string | null;
  eventDate?: string | null;
}

export default function ShareBookingButton({
  shareToken, djType = 'mobile', plannerId, phone, eventLabel, eventType, eventDate,
}: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Default the planner link ON when one is available — the DJ asked for it,
  // so assume they want to send it unless they turn it off.
  const [includePlanner, setIncludePlanner] = useState(true);
  // The DJ's account email, read once so Email can route to their webmail's
  // compose page (Gmail / Outlook / Yahoo / AOL) instead of a flaky mailto:.
  const [acctEmail, setAcctEmail] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    createClient().auth.getUser().then(({ data }) => {
      if (alive) setAcctEmail(data.user?.email ?? null);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!shareToken) return null;

  const canPlanner = djType === 'mobile' && !!plannerId;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const cardUrl = `${origin}/card/${shareToken}`;
  const plannerUrl = plannerId ? `${origin}/planner/${plannerId}/print` : '';

  // The text every method sends. One link, or two when the planner is included.
  function buildBody(): string {
    if (canPlanner && includePlanner) {
      return `Here are your event details:\n${cardUrl}\n\nAnd your event planner:\n${plannerUrl}`;
    }
    return `Here are your event details:\n${cardUrl}`;
  }
  function buildLinks(): string {
    return canPlanner && includePlanner ? `${cardUrl}\n${plannerUrl}` : cardUrl;
  }

  async function copyLink() {
    const text = buildLinks();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  // Event type + date, e.g. "Wedding — Jan 15, 2026". Reused for the subject.
  const eventHeadline = (): string => {
    const niceDate = eventDate
      ? new Date(`${eventDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
    return [eventType || eventLabel || '', niceDate].filter(Boolean).join(' — ');
  };

  // Email, with no recipient pre-set so the DJ sends to whoever they want.
  // Subject carries the event type + date. If the DJ's account email is a known
  // webmail provider, open THAT provider's compose page directly (new tab) with
  // everything preloaded — reliable on desktop. Otherwise fall back to mailto:,
  // which opens whatever mail app their computer has set as default.
  function shareByEmail() {
    const subject = eventHeadline() || 'Event details';
    const body = buildBody();
    const compose = webComposer(acctEmail);
    if (compose) {
      const a = document.createElement('a');
      a.href = compose(subject, body); a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    const a = document.createElement('a');
    a.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function downloadCard() {
    // The public card page runs the html2canvas capture; ?download=1 makes it
    // fire on open. Open it in its own tab so the share sheet stays put.
    const a = document.createElement('a');
    a.href = `${cardUrl}?download=1`; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function shareByText() {
    const num = phone ? String(phone).replace(/[^\d+]/g, '') : '';
    // The text leads with WHICH event — type + date — before the link(s), so
    // the recipient has context the moment it arrives.
    const headline = eventHeadline();
    const head = headline ? `${headline}\n\n` : '';
    // iOS wants ?&body=, Android wants ?body= — the ?&body form works on both.
    window.location.href = `sms:${num}?&body=${encodeURIComponent(head + buildBody())}`;
  }

  // Bare icon — no box, no border.
  const iconBtn = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28,
    border: 'none', background: 'transparent',
    color: 'var(--muted,#8a8aa0)',
    cursor: 'pointer', flexShrink: 0,
  } as const;

  return (
    <>
      <span
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        role="button"
        tabIndex={0}
        aria-label="Share booking card"
        title="Share a view-only link to this booking card"
        style={iconBtn}
      >
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </span>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          onClick={(e) => { e.stopPropagation(); setOpen(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 2147483000,
            background: 'rgba(0,0,0,.66)', backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(440px, 96vw)', maxHeight: '90vh', overflowY: 'auto',
              background: '#14141c', border: '1px solid rgba(255,255,255,.12)',
              borderRadius: 14, padding: '1.1rem 1.2rem 1.3rem',
              boxShadow: '0 24px 60px rgba(0,0,0,.6)', color: '#e9e9f2',
              fontFamily: 'var(--font-inter), system-ui, sans-serif',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, letterSpacing: '.01em' }}>Share booking card</h3>
              <button
                type="button" onClick={() => setOpen(false)} aria-label="Close"
                style={{ background: 'transparent', border: 'none', color: '#8a8aa0', fontSize: '1.3rem', lineHeight: 1, cursor: 'pointer' }}
              >×</button>
            </div>

            <p style={{ margin: '0 0 .7rem', fontSize: '.78rem', color: '#9b9baa' }}>
              This is exactly what they&apos;ll see — a read-only card, no login needed.
            </p>

            {/* Live preview of the public card. pointer-events:none so it can't be
                interacted with inside the sheet — it's a preview, not the page. */}
            <div
              style={{
                borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,.1)',
                height: 240, marginBottom: '.5rem', background: '#0b0b12', position: 'relative',
              }}
            >
              <iframe
                src={cardUrl}
                title="Card preview"
                style={{
                  width: '200%', height: '480px', border: 'none',
                  transform: 'scale(0.5)', transformOrigin: 'top left', pointerEvents: 'none',
                }}
              />
            </div>

            {canPlanner && (
              <label
                style={{
                  display: 'flex', alignItems: 'center', gap: '.55rem',
                  fontSize: '.82rem', color: '#d6d6e4', cursor: 'pointer',
                  padding: '.6rem .7rem', margin: '0 0 .9rem',
                  border: '1px solid rgba(0,224,164,.35)', borderRadius: 9,
                  background: 'rgba(0,224,164,.06)',
                }}
              >
                <input
                  type="checkbox"
                  checked={includePlanner}
                  onChange={(e) => setIncludePlanner(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: '#00e0a4', cursor: 'pointer' }}
                />
                <span>
                  Also include a link to the <strong>event planner</strong>
                  <span style={{ display: 'block', color: '#8a8aa0', fontSize: '.72rem', marginTop: 2 }}>
                    Read-only — the client can view it but can&apos;t edit it.
                  </span>
                </span>
              </label>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem' }}>
              <MethodButton
                onClick={copyLink}
                active={copied}
                label={copied ? 'Copied!' : 'Copy link'}
                icon={copied
                  ? <polyline points="20 6 9 17 4 12" />
                  : <><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>}
              />
              <MethodButton
                onClick={shareByEmail}
                label="Email"
                icon={<><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></>}
              />
              <MethodButton
                onClick={shareByText}
                label="Text"
                icon={<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />}
              />
              <MethodButton
                onClick={downloadCard}
                label="Download"
                icon={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>}
              />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function MethodButton({
  onClick, label, icon, active = false, busy = false,
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.4rem',
        padding: '.75rem .4rem', borderRadius: 10, cursor: busy ? 'wait' : 'pointer',
        border: `1px solid ${active ? 'rgba(0,224,164,.6)' : 'rgba(255,255,255,.14)'}`,
        background: active ? 'rgba(0,224,164,.1)' : 'rgba(255,255,255,.03)',
        color: active ? '#00e0a4' : '#e9e9f2',
        fontSize: '.74rem', fontWeight: 700, opacity: busy ? 0.7 : 1,
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {icon}
      </svg>
      {label}
    </button>
  );
}
