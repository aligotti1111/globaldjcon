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

const NEON = 'var(--neon,#00e0a4)';
const MUTED = 'var(--muted,#8a8aa0)';

const INSTR_MAX = 600;

export default function BookingBotSection() {
  const [enabled, setEnabled] = useState(false);
  const [eligible, setEligible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Custom instructions (tone / emphasis) the DJ can give the bot.
  const [instructions, setInstructions] = useState('');
  const [savedInstructions, setSavedInstructions] = useState('');
  const [instrSaving, setInstrSaving] = useState(false);
  const [instrSaved, setInstrSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/dj/booking-bot-setting');
        const d = (await res.json().catch(() => ({}))) as { ok?: boolean; enabled?: boolean; eligible?: boolean; instructions?: string };
        if (alive && res.ok && d.ok) {
          setEnabled(d.enabled === true);
          setEligible(d.eligible !== false);
          setInstructions(d.instructions || '');
          setSavedInstructions(d.instructions || '');
        }
      } catch { /* keep defaults */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  async function saveInstructions() {
    const next = instructions.slice(0, INSTR_MAX);
    setInstrSaving(true); setInstrSaved(false); setErr(null);
    try {
      const res = await fetch('/api/dj/booking-bot-setting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: next }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error || 'Could not save.');
      setSavedInstructions(next);
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
      <SectionBanner icon="bell" title="Booking Assistant" subtitle="A chat helper on your public profile that answers clients and starts their request." />
      <div style={{ padding: '1.5rem' }}>
        <p style={{ color: MUTED, fontSize: '.85rem', lineHeight: 1.6, margin: '0 0 1rem' }}>
          Adds a chat bubble to your public profile. It answers potential clients&apos;
          questions, gives them a ballpark price from your packages (or your hourly/flat
          rate), and collects their event details to start a booking request — which
          you still approve. It never confirms a date or takes payment.
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '.8rem' }}>
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
                <label style={{ display: 'block', color: '#fff', fontSize: '.9rem', fontWeight: 600, marginBottom: '.4rem' }}>
                  Custom instructions <span style={{ color: MUTED, fontWeight: 400 }}>(optional)</span>
                </label>
                <p style={{ color: MUTED, fontSize: '.82rem', lineHeight: 1.6, margin: '0 0 .7rem' }}>
                  Shape how the assistant sounds and what it highlights — tone, phrases, things to
                  mention (e.g. &ldquo;keep it upbeat and casual,&rdquo; &ldquo;we specialize in weddings and
                  bilingual events,&rdquo; &ldquo;always suggest adding uplighting&rdquo;). It still follows the
                  core rules: it won&apos;t quote exact prices, confirm dates, or take payment.
                </p>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value.slice(0, INSTR_MAX))}
                  maxLength={INSTR_MAX}
                  rows={4}
                  placeholder="e.g. Friendly and concise. We mainly do weddings and corporate events. Mention our premium package includes uplighting and a photo booth add-on."
                  style={{
                    width: '100%', boxSizing: 'border-box', resize: 'vertical',
                    background: '#15151c', color: '#eaeaf0',
                    border: '1px solid rgba(255,255,255,.14)', borderRadius: 10,
                    padding: '.7rem .8rem', fontSize: '.88rem', lineHeight: 1.5, fontFamily: 'inherit',
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: '.8rem', marginTop: '.7rem' }}>
                  <button
                    type="button"
                    onClick={saveInstructions}
                    disabled={instrSaving || instructions === savedInstructions}
                    style={{
                      background: instructions === savedInstructions ? '#2a2a33' : NEON,
                      color: instructions === savedInstructions ? MUTED : '#04120d',
                      border: 'none', borderRadius: 8, padding: '.5rem 1.1rem',
                      fontSize: '.85rem', fontWeight: 700,
                      cursor: (instrSaving || instructions === savedInstructions) ? 'default' : 'pointer',
                    }}
                  >
                    {instrSaving ? 'Saving…' : 'Save instructions'}
                  </button>
                  {instrSaved && <span style={{ color: NEON, fontSize: '.8rem', fontWeight: 700 }}>Saved ✓</span>}
                  <span style={{ color: MUTED, fontSize: '.75rem', marginLeft: 'auto' }}>{instructions.length}/{INSTR_MAX}</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
