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
    try { await navigator.clipboard.writeText(httpsUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  }

  // Google gives no way to pre-fill its "URL of calendar" box from outside, so
  // the flow is: copy the link, SHOW the steps here (so the DJ knows it's
  // copied) BEFORE sending them off — otherwise the "copied" note would sit on
  // this tab while they're staring at an empty box in Google's new tab.
  async function addToGoogle() {
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

  const btnPrimary: CSSProperties = {
    display: 'inline-block', background: NEON, color: '#06231b', fontWeight: 800,
    fontSize: '.85rem', padding: '.6rem 1.1rem', borderRadius: 8, textDecoration: 'none',
  };
  const btnOutline: CSSProperties = {
    display: 'inline-block', background: 'transparent', color: NEON, border: `1px solid ${NEON}`,
    fontWeight: 700, fontSize: '.85rem', padding: '.55rem 1.05rem', borderRadius: 8, textDecoration: 'none',
  };

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
        <a href={webcalUrl} style={btnPrimary}>Subscribe on iPhone / Mac</a>
        {googleUrl && (
          <button type="button" onClick={addToGoogle} style={{ ...btnOutline, cursor: 'pointer' }}>Add to Google Calendar</button>
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
            <a href={googleUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', background: NEON, color: '#06231b', fontWeight: 800, fontSize: '.8rem', padding: '.5rem .95rem', borderRadius: 8, textDecoration: 'none' }}>
              Open Google Calendar
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
          leaks). Existing subscriptions must be re-added afterward. */}
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
    </div>
  );
}
