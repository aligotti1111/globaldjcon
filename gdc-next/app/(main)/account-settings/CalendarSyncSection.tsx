'use client';

// CalendarSyncSection — "Sync to your calendar" card in DJ Settings. Fetches
// the DJ's private subscription link (/api/dj/calendar-token, generated lazily)
// and offers ONE-CLICK subscribe buttons:
//   • Apple (iPhone / Mac) via a webcal:// link the OS calendar opens directly.
//   • Google Calendar via Google's own "add calendar by URL" screen.
// The raw feed URL is tucked behind a "Set it up manually" toggle so nobody's
// front door is a link that downloads a mystery .ics file — with plain-language
// reassurance for anyone who does open it.
//
// Subscribing once puts every approved booking on the DJ's phone AND computer
// and keeps them in sync as bookings change or cancel — read-only.

import { useEffect, useState, type CSSProperties } from 'react';
import styles from './accountSettings.module.css';

const NEON = 'var(--neon,#00e0a4)';
const MUTED = 'var(--muted,#8a8aa0)';

export default function CalendarSyncSection() {
  const [webcalUrl, setWebcalUrl] = useState('');
  const [httpsUrl, setHttpsUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [howto, setHowto] = useState(false);
  const [manual, setManual] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [googleStep, setGoogleStep] = useState(false);
  const [googleCopied, setGoogleCopied] = useState(false);
  // Reset only makes sense once the DJ has actually used the link. We can't see
  // the subscribe (it happens inside their calendar app), so we treat clicking
  // Subscribe / Add to Google / Copy as "started using it" and remember it.
  const [linkUsed, setLinkUsed] = useState(false);

  useEffect(() => {
    try { if (localStorage.getItem('gdcCalendarLinkUsed') === '1') setLinkUsed(true); } catch { /* ignore */ }
  }, []);

  function markUsed() {
    setLinkUsed(true);
    try { localStorage.setItem('gdcCalendarLinkUsed', '1'); } catch { /* ignore */ }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/dj/calendar-token');
        const d = (await res.json().catch(() => ({}))) as { ok?: boolean; webcalUrl?: string; httpsUrl?: string; error?: string };
        if (!alive) return;
        if (res.ok && d.ok) { setWebcalUrl(d.webcalUrl || ''); setHttpsUrl(d.httpsUrl || ''); }
        else setErr(d.error || 'Could not load your calendar link.');
      } catch { if (alive) setErr('Could not load your calendar link.'); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  // Google Calendar's actual "Add calendar → From URL" screen. (The old
  // ?cid= trick only works for Google-HOSTED calendars, not an external .ics
  // feed — Google just ignored it and opened the normal view.) We also copy the
  // link to the clipboard so it's a one-paste job: the addbyurl page has a
  // single URL box, and ?url= prefills it in most cases; if it doesn't, the DJ
  // just pastes.
  const googleUrl = httpsUrl
    ? `https://calendar.google.com/calendar/u/0/r/settings/addbyurl?url=${encodeURIComponent(httpsUrl)}`
    : '';

  async function copy() {
    markUsed();
    try { await navigator.clipboard.writeText(httpsUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  }

  // Google gives no way to pre-fill its "URL of calendar" box from outside, so
  // the flow is: copy the link, SHOW the steps here (so the DJ knows it's
  // copied) BEFORE sending them off — otherwise the "copied" note would sit on
  // this tab while they're staring at an empty box in Google's new tab.
  async function addToGoogle() {
    markUsed();
    let ok = false;
    try { await navigator.clipboard.writeText(httpsUrl); ok = true; } catch { /* blocked — the panel's copy button is the fallback */ }
    setGoogleCopied(ok);
    setGoogleStep(true);
  }

  async function reset() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/dj/calendar-token', { method: 'POST' });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; webcalUrl?: string; httpsUrl?: string; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error || 'Could not reset the link.');
      setWebcalUrl(d.webcalUrl || ''); setHttpsUrl(d.httpsUrl || ''); setConfirmReset(false);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not reset the link.'); }
    finally { setBusy(false); }
  }

  if (loading) return null;

  // Each subscribe button wears its platform's own colors so it reads as the
  // trusted, familiar control: Apple = black + Apple logo, Google = white +
  // the multi-color "G" (Google's official button styling).
  const btnApple: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '.5rem',
    background: '#000', color: '#fff', fontWeight: 600, fontSize: '.85rem',
    padding: '.58rem 1.1rem', borderRadius: 8, textDecoration: 'none', border: '1px solid rgba(255,255,255,.35)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', cursor: 'pointer',
  };
  const btnGoogle: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '.55rem',
    background: '#fff', color: '#3c4043', fontWeight: 600, fontSize: '.85rem',
    padding: '.52rem 1.05rem', borderRadius: 8, textDecoration: 'none', border: '1px solid #dadce0',
    fontFamily: 'Roboto, arial, sans-serif', cursor: 'pointer',
  };
  const AppleGlyph = (
    <svg width="15" height="15" viewBox="0 0 384 512" fill="#fff" aria-hidden="true">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
  const GoogleGlyph = (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );

  return (
    <div className={styles.card}>
      <h2>Sync to your calendar</h2>
      <p style={{ color: MUTED, fontSize: '.85rem', lineHeight: 1.6, margin: '0 0 1rem' }}>
        Subscribe once and every confirmed booking lands on your phone and computer — and stays in
        sync as bookings change or cancel. Read-only, so nothing you edit in your calendar touches
        Global DJ Connect.
      </p>

      {err && (
        <p style={{ color: '#ff9a9a', fontSize: '.82rem', margin: '0 0 .8rem' }}>{err}</p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.6rem', alignItems: 'center', marginBottom: '.5rem' }}>
        <a href={webcalUrl} onClick={markUsed} style={btnApple}>{AppleGlyph}Subscribe on iPhone / Mac</a>
        {googleUrl && (
          <button type="button" onClick={addToGoogle} style={btnGoogle}>{GoogleGlyph}Add to Google Calendar</button>
        )}
        <button
          type="button"
          onClick={() => setHowto((v) => !v)}
          style={{ background: 'transparent', border: 'none', color: NEON, fontWeight: 700, fontSize: '.8rem', cursor: 'pointer', padding: '.4rem' }}
        >
          {howto ? 'Hide steps' : 'How do I add it?'}
        </button>
      </div>

      {/* Add-once warning: two subscriptions to the same feed are two separate
          calendars in the phone/computer, so they DON'T merge — every booking
          shows twice. There's no server-side dedupe across calendars; the only
          fix is removing the extra one. */}
      <p style={{ color: MUTED, fontSize: '.76rem', lineHeight: 1.5, margin: '0 0 .9rem' }}>
        Add it once per device. If every booking shows up <strong>twice</strong>, you&apos;ve added the
        calendar more than once — remove the extra one in your calendar app (they don&apos;t merge).
      </p>

      {googleStep && (
        <div style={{ margin: '.2rem 0 .7rem', padding: '.8rem .9rem', background: 'rgba(0,224,164,.08)', border: `1px solid ${NEON}`, borderRadius: 8, fontSize: '.82rem', color: 'rgba(255,255,255,.9)', lineHeight: 1.65 }}>
          <div style={{ fontWeight: 800, color: NEON, marginBottom: '.35rem' }}>
            {googleCopied ? '✓ Calendar link copied to your clipboard' : 'Copy your calendar link (button below), then:'}
          </div>
          <div style={{ marginBottom: '.6rem' }}>
            1. Click <strong>Open Google Calendar</strong> below.<br />
            2. In the <strong>&ldquo;URL of calendar&rdquo;</strong> box that opens, paste the link — <strong>⌘V</strong> (Mac) or <strong>Ctrl-V</strong>.<br />
            3. Press <strong>Add calendar</strong>. Done.
          </div>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <a href={googleUrl} target="_blank" rel="noopener noreferrer" style={{ ...btnGoogle, fontSize: '.8rem', padding: '.46rem .9rem' }}>
              {GoogleGlyph}Open Google Calendar
            </a>
            <button
              type="button"
              onClick={copy}
              style={{ background: 'transparent', color: NEON, border: `1px solid ${NEON}`, borderRadius: 8, padding: '.45rem .8rem', fontWeight: 700, fontSize: '.78rem', cursor: 'pointer' }}
            >
              {copied ? 'Copied ✓' : 'Copy link again'}
            </button>
          </div>
        </div>
      )}

      {howto && (
        <div style={{ marginTop: '.6rem', fontSize: '.82rem', color: 'rgba(255,255,255,.8)', lineHeight: 1.7 }}>
          <p style={{ margin: '0 0 .5rem' }}><strong style={{ color: '#fff' }}>iPhone / iPad / Mac:</strong> tap <strong>Subscribe on iPhone / Mac</strong> — your Calendar app opens and asks you to confirm. Done.</p>
          <p style={{ margin: '0 0 .5rem' }}><strong style={{ color: '#fff' }}>Google Calendar:</strong> tap <strong>Add to Google Calendar</strong> — it opens Google&apos;s &ldquo;Add calendar from URL&rdquo; box in a new tab. Your link is copied automatically; if the box is empty, paste it and press Add. It then shows up in the Google Calendar app on your phone too.</p>
          <p style={{ margin: 0, color: MUTED }}>Calendars refresh on the app&apos;s own schedule (often a few hours), so new bookings can take a little while to appear.</p>
        </div>
      )}

      {/* Manual / advanced — hidden by default so the "front door" isn't a raw
          link that downloads a file. Revealed only for people who need to paste
          the URL somewhere themselves, with reassurance about the download. */}
      <div style={{ marginTop: '.9rem' }}>
        <button
          type="button"
          onClick={() => setManual((v) => !v)}
          style={{ background: 'transparent', border: 'none', color: MUTED, fontSize: '.78rem', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
        >
          {manual ? 'Hide manual setup' : 'Set it up manually'}
        </button>

        {manual && (
          <div style={{ marginTop: '.7rem' }}>
            <p style={{ color: MUTED, fontSize: '.78rem', lineHeight: 1.6, margin: '0 0 .5rem' }}>
              Paste this where your calendar app asks for a calendar URL. It&apos;s your private,
              read-only booking feed — opening it in a browser just downloads a standard
              <strong> .ics</strong> calendar file, which is normal and safe.
            </p>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
              <input
                readOnly
                value={httpsUrl}
                onFocus={(e) => e.currentTarget.select()}
                style={{
                  flex: '1 1 260px', minWidth: 0, background: '#16161f', color: '#fff',
                  border: '1px solid rgba(255,255,255,.18)', borderRadius: 8, padding: '9px 11px',
                  fontSize: '.8rem', outline: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
              />
              <button
                type="button"
                onClick={copy}
                style={{
                  background: 'transparent', color: NEON, border: `1px solid ${NEON}`,
                  borderRadius: 8, padding: '9px 14px', fontWeight: 700, fontSize: '.8rem', cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                {copied ? 'Copied ✓' : 'Copy link'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Reset — rotates the token so the old links stop working (use if it ever
          leaks). Only shown once the DJ has actually used the link (subscribe /
          add / copy); existing subscriptions must be re-added afterward. */}
      {linkUsed && (
      <div style={{ marginTop: '1.1rem', paddingTop: '.9rem', borderTop: '1px solid rgba(255,255,255,.08)' }}>
        {!confirmReset ? (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            style={{ background: 'transparent', border: 'none', color: MUTED, fontSize: '.78rem', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
          >
            Reset calendar link
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
            <span style={{ color: '#ffb4b4', fontSize: '.8rem' }}>Reset makes a NEW link — it can&apos;t remove calendars you already added. First remove the old calendar from each device, THEN re-add with the new link. Skipping that first step is what makes every booking show twice.</span>
            <button type="button" onClick={reset} disabled={busy} style={{ background: '#c0392b', color: '#fff', border: 'none', borderRadius: 6, padding: '.4rem .8rem', fontWeight: 700, fontSize: '.78rem', cursor: busy ? 'default' : 'pointer' }}>
              {busy ? 'Resetting…' : 'Yes, reset'}
            </button>
            <button type="button" onClick={() => setConfirmReset(false)} style={{ background: 'transparent', border: 'none', color: MUTED, fontSize: '.78rem', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
