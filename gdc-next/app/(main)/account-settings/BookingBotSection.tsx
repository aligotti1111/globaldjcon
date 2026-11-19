'use client';

// BookingBotSection — "Profile Booking Assistant" card in Account Settings.
// A Premium Pro feature: a chat helper on the DJ's PUBLIC profile that answers a
// booker's questions, quotes a price range, and gets their request started.
// Shows a toggle when the account is eligible (Premium Pro+), or an upsell when
// it isn't. Owner-only (enforced server-side too).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './accountSettings.module.css';
import SectionBanner from '../update-dj-profile/SectionBanner';
import {
  trainingQuestionsFor, parseBotTraining, serializeBotTraining,
  BOT_TRAINING_ANSWER_MAX, BOT_TRAINING_EXTRA_MAX,
} from '@/lib/bookingBotTraining';

const NEON = 'var(--neon,#00e0a4)';
const MUTED = 'var(--muted,#8a8aa0)';

export default function BookingBotSection() {
  const [enabled, setEnabled] = useState(false);
  const [eligible, setEligible] = useState(true);
  // Drives which training questions the DJ sees — a club/bar DJ gets a
  // venue-focused set, a mobile DJ gets a private-event set.
  const [djType, setDjType] = useState<string>('mobile');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // "Train your assistant": the DJ's short answers to common client questions,
  // plus an optional notes box. Stored as one serialized string on the account.
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState('');
  const [savedSerialized, setSavedSerialized] = useState('');
  const [instrSaving, setInstrSaving] = useState(false);
  const [instrSaved, setInstrSaved] = useState(false);

  // Optional website used as a LAST-RESORT fallback source. Fetched server-side
  // when saved; we show the last-fetched time and whether the page was readable.
  const [siteUrl, setSiteUrl] = useState('');
  const [savedSiteUrl, setSavedSiteUrl] = useState('');
  const [siteFetchedAt, setSiteFetchedAt] = useState<string | null>(null);
  const [siteHasText, setSiteHasText] = useState(false);
  const [siteSaving, setSiteSaving] = useState(false);
  const [siteMsg, setSiteMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/dj/booking-bot-setting');
        const d = (await res.json().catch(() => ({}))) as { ok?: boolean; enabled?: boolean; eligible?: boolean; djType?: string; instructions?: string; siteUrl?: string; siteFetchedAt?: string | null; siteHasText?: boolean };
        if (alive && res.ok && d.ok) {
          setEnabled(d.enabled === true);
          setEligible(d.eligible !== false);
          setDjType(d.djType || 'mobile');
          const t = parseBotTraining(d.instructions || '');
          setAnswers(t.answers);
          setExtra(t.extra);
          setSavedSerialized(serializeBotTraining(t));
          setSiteUrl(d.siteUrl || '');
          setSavedSiteUrl(d.siteUrl || '');
          setSiteFetchedAt(d.siteFetchedAt || null);
          setSiteHasText(d.siteHasText === true);
        }
      } catch { /* keep defaults */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  async function saveSite() {
    const next = siteUrl.trim();
    setSiteSaving(true); setSiteMsg(null); setErr(null);
    try {
      const res = await fetch('/api/dj/booking-bot-setting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteUrl: next }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; siteUrl?: string; siteFetchedAt?: string | null; siteHasText?: boolean; siteStatus?: { ok?: boolean; message?: string } };
      if (!res.ok || !d.ok) throw new Error(d.error || 'Could not save.');
      setSavedSiteUrl(d.siteUrl || '');
      setSiteUrl(d.siteUrl || '');
      setSiteFetchedAt(d.siteFetchedAt || null);
      setSiteHasText(d.siteHasText === true);
      if (!next) setSiteMsg({ ok: true, text: 'Website removed.' });
      else if (d.siteStatus && d.siteStatus.ok === false) setSiteMsg({ ok: false, text: d.siteStatus.message || "Saved, but we couldn't read the page." });
      else setSiteMsg({ ok: true, text: 'Saved — the assistant can now use your website as a fallback.' });
    } catch (e) {
      setSiteMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not save.' });
    } finally {
      setSiteSaving(false);
    }
  }

  const siteDirty = siteUrl.trim() !== savedSiteUrl.trim();

  const currentSerialized = serializeBotTraining({ answers, extra });
  const trainingDirty = currentSerialized !== savedSerialized;

  async function saveInstructions() {
    const next = currentSerialized;
    setInstrSaving(true); setInstrSaved(false); setErr(null);
    try {
      const res = await fetch('/api/dj/booking-bot-setting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: next }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error || 'Could not save.');
      setSavedSerialized(next);
      setInstrSaved(true);
      setTimeout(() => setInstrSaved(false), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setInstrSaving(false);
    }
  }

  async function toggle() {
    if (!eligible) return;
    const next = !enabled;
    setEnabled(next);
    setSaving(true); setSaved(false); setErr(null);
    try {
      const res = await fetch('/api/dj/booking-bot-setting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error || 'Could not save.');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setEnabled(!next);
      setErr(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <div className={styles.card} style={{ padding: 0, overflow: 'hidden' }}>
      <SectionBanner icon="bell" title="AI Booking Assistant" subtitle="A chat helper on your public profile that answers clients and starts their request." />
      <div style={{ padding: '1.5rem' }}>
        <p style={{ color: MUTED, fontSize: '.85rem', lineHeight: 1.6, margin: '0 0 1rem' }}>
          Adds your personal AI chat to your public profile. It answers potential clients&apos;
          questions, and collects their event details to start a booking request. Responses
          are based off packages, prices, about, quick facts you input on your profile and
          any additional information you add here.
        </p>

        {!eligible ? (
          <div style={{
            background: 'rgba(0,224,164,.06)', border: '1px solid rgba(0,224,164,.25)',
            borderRadius: 10, padding: '1rem', fontSize: '.85rem', color: '#d4d4dc',
          }}>
            The Booking Assistant is a <b style={{ color: NEON }}>Premium Pro</b> feature.{' '}
            <Link href="/subscribe" style={{ color: NEON, fontWeight: 700 }}>Upgrade to turn it on →</Link>
          </div>
        ) : (
          <>
            {err && <p style={{ color: '#ff9a9a', fontSize: '.82rem', margin: '0 0 .7rem' }}>{err}</p>}
            <div style={{ display: 'flex', alignItems: 'center', gap: '.8rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={toggle}
                disabled={saving}
                style={{
                  position: 'relative', width: 50, height: 28, borderRadius: 999,
                  border: '1px solid rgba(255,255,255,.18)',
                  background: enabled ? NEON : '#2a2a33',
                  cursor: saving ? 'default' : 'pointer', transition: 'background .15s', flex: '0 0 auto',
                }}
              >
                <span style={{
                  position: 'absolute', top: 2, left: enabled ? 24 : 2,
                  width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left .15s',
                }} />
              </button>
              <span style={{ color: '#fff', fontSize: '.9rem', fontWeight: 600 }}>{enabled ? 'On' : 'Off'}</span>
              {saving && <span style={{ color: MUTED, fontSize: '.8rem' }}>Saving…</span>}
              {saved && <span style={{ color: NEON, fontSize: '.8rem', fontWeight: 700 }}>Saved ✓</span>}
            </div>

            {enabled && (
              <div style={{ marginTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,.08)', paddingTop: '1.25rem' }}>
                <label style={{ display: 'block', color: '#fff', fontSize: '.95rem', fontWeight: 700, marginBottom: '.25rem' }}>
                  Train your assistant
                </label>
                <p style={{ color: MUTED, fontSize: '.82rem', lineHeight: 1.6, margin: '0 0 1.1rem' }}>
                  Answer the questions your clients ask most. The assistant uses your answers to reply.
                  Fill in what applies and skip the rest — all optional.
                </p>

                {trainingQuestionsFor(djType).map((q) => (
                  <div key={q.key} style={{ marginBottom: '.9rem' }}>
                    <label style={{ display: 'block', color: '#eaeaf0', fontSize: '.84rem', fontWeight: 600, marginBottom: '.3rem' }}>
                      {q.label}
                    </label>
                    <input
                      type="text"
                      value={answers[q.key] || ''}
                      maxLength={BOT_TRAINING_ANSWER_MAX}
                      onChange={(e) => setAnswers((prev) => ({ ...prev, [q.key]: e.target.value.slice(0, BOT_TRAINING_ANSWER_MAX) }))}
                      placeholder={q.placeholder}
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        background: '#15151c', color: '#eaeaf0',
                        border: '1px solid rgba(255,255,255,.14)', borderRadius: 8,
                        padding: '.55rem .7rem', fontSize: '.86rem', fontFamily: 'inherit',
                      }}
                    />
                  </div>
                ))}

                <div style={{ marginBottom: '.5rem' }}>
                  <label style={{ display: 'block', color: '#eaeaf0', fontSize: '.84rem', fontWeight: 600, marginBottom: '.3rem' }}>
                    Anything else the assistant should know? <span style={{ color: MUTED, fontWeight: 400 }}>(optional)</span>
                  </label>
                  <textarea
                    value={extra}
                    onChange={(e) => setExtra(e.target.value.slice(0, BOT_TRAINING_EXTRA_MAX))}
                    maxLength={BOT_TRAINING_EXTRA_MAX}
                    rows={3}
                    placeholder="e.g. We bring backup equipment to every event and can MC in English and Spanish."
                    style={{
                      width: '100%', boxSizing: 'border-box', resize: 'vertical',
                      background: '#15151c', color: '#eaeaf0',
                      border: '1px solid rgba(255,255,255,.14)', borderRadius: 8,
                      padding: '.55rem .7rem', fontSize: '.86rem', lineHeight: 1.5, fontFamily: 'inherit',
                    }}
                  />
                </div>

                <p style={{ color: MUTED, fontSize: '.74rem', lineHeight: 1.5, margin: '0 0 .7rem' }}>
                  The assistant still follows the core rules — it won&apos;t quote exact prices, confirm dates, or take payment.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: '.8rem' }}>
                  <button
                    type="button"
                    onClick={saveInstructions}
                    disabled={instrSaving || !trainingDirty}
                    style={{
                      background: !trainingDirty ? '#2a2a33' : NEON,
                      color: !trainingDirty ? MUTED : '#04120d',
                      border: 'none', borderRadius: 8, padding: '.5rem 1.1rem',
                      fontSize: '.85rem', fontWeight: 700,
                      cursor: (instrSaving || !trainingDirty) ? 'default' : 'pointer',
                    }}
                  >
                    {instrSaving ? 'Saving…' : 'Save'}
                  </button>
                  {instrSaved && <span style={{ color: NEON, fontSize: '.8rem', fontWeight: 700 }}>Saved ✓</span>}
                </div>

                {/* Website fallback */}
                <div style={{ marginTop: '1.4rem', borderTop: '1px solid rgba(255,255,255,.08)', paddingTop: '1.25rem' }}>
                  <label style={{ display: 'block', color: '#fff', fontSize: '.9rem', fontWeight: 700, marginBottom: '.25rem' }}>
                    Your website <span style={{ color: MUTED, fontWeight: 400 }}>(optional fallback)</span>
                  </label>
                  <p style={{ color: MUTED, fontSize: '.82rem', lineHeight: 1.6, margin: '0 0 .7rem' }}>
                    Add your website and the assistant can pull from it to answer questions your profile
                    doesn&apos;t cover. Your Global DJ Connect info always comes first — the website is only a
                    fallback. Pricing never comes from your website; all prices come only from your Global DJ
                    Connect packages. We read it when you save; save again anytime to refresh.
                  </p>
                  <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="url"
                      inputMode="url"
                      value={siteUrl}
                      onChange={(e) => setSiteUrl(e.target.value.slice(0, 300))}
                      placeholder="https://yourdjsite.com"
                      style={{
                        flex: 1, minWidth: 200, boxSizing: 'border-box',
                        background: '#15151c', color: '#eaeaf0',
                        border: '1px solid rgba(255,255,255,.14)', borderRadius: 8,
                        padding: '.55rem .7rem', fontSize: '.86rem', fontFamily: 'inherit',
                      }}
                    />
                    <button
                      type="button"
                      onClick={saveSite}
                      disabled={siteSaving || !siteDirty}
                      style={{
                        background: !siteDirty ? '#2a2a33' : NEON,
                        color: !siteDirty ? MUTED : '#04120d',
                        border: 'none', borderRadius: 8, padding: '.5rem 1.1rem',
                        fontSize: '.85rem', fontWeight: 700,
                        cursor: (siteSaving || !siteDirty) ? 'default' : 'pointer', flex: '0 0 auto',
                      }}
                    >
                      {siteSaving ? 'Reading…' : (savedSiteUrl ? 'Update' : 'Save')}
                    </button>
                  </div>
                  {siteMsg && (
                    <p style={{ color: siteMsg.ok ? NEON : '#ff9a9a', fontSize: '.78rem', lineHeight: 1.5, margin: '.5rem 0 0' }}>{siteMsg.text}</p>
                  )}
                  {!siteMsg && savedSiteUrl && siteFetchedAt && (
                    <p style={{ color: MUTED, fontSize: '.75rem', margin: '.5rem 0 0' }}>
                      {siteHasText ? 'Last read' : 'Last attempted'} {new Date(siteFetchedAt).toLocaleDateString()}{!siteHasText ? ' — nothing readable was found.' : '.'}
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
