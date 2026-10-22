'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from '../profile.module.css';
import { createClient } from '@/lib/supabase/client';
import type { Testimonial, Faq, AboutStats } from '../profileTypes';
import { thumbUrl, validateImageFile } from '../profilePhotoUtils';
import { saveProfile, profileUploadFolder } from '../profileSave';
import {
  STAFF_MAX, AFFILIATES_MAX, newEntryId, initialsOf, normalizeUrl, safeHexColor, isLightHex,
  type StaffMember, type Affiliate,
} from '@/lib/staff';
import AvatarCrop from '../../update-dj-profile/AvatarCrop';
import { useConfirm } from '@/components/ConfirmModal';

// ── TestimonialAddForm ─────────────────────────────────────────
// Owner-only inline form to append a new testimonial. Lives at the
// bottom of the Testimonials tab pane. On submit, appends to the
// existing array and writes back to users.testimonials (JSON-stringified).
export function TestimonialAddForm({
  userId,
  existing,
}: {
  userId: string;
  existing: Testimonial[];
}) {
  const [open, setOpen] = useState(false);
  const [blurb, setBlurb] = useState('');
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setBlurb('');
    setName('');
    setDate('');
    setError(null);
  }

  async function save() {
    if (!blurb.trim() || !name.trim()) {
      setError('Quote and name are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next: Testimonial[] = [
        ...existing,
        { blurb: blurb.trim(), name: name.trim(), date: date.trim() || undefined },
      ];
      await saveProfile(userId, { testimonials: JSON.stringify(next) });
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={styles.testimonialAddBtn}
      >
        + Add testimonial
      </button>
    );
  }

  return (
    <div className={styles.testimonialAddForm}>
      <div className={styles.testimonialAddFormRow}>
        <div style={{ flex: 1 }}>
          <div className={styles.testimonialAddFormLabel}>Name</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sarah J."
            className={styles.testimonialAddInput}
            disabled={busy}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div className={styles.testimonialAddFormLabel}>Date (optional)</div>
          <input
            value={date}
            onChange={(e) => setDate(e.target.value)}
            placeholder="May 2024"
            className={styles.testimonialAddInput}
            disabled={busy}
          />
        </div>
      </div>
      <div className={styles.testimonialAddFormLabel}>Quote</div>
      <textarea
        value={blurb}
        onChange={(e) => setBlurb(e.target.value)}
        rows={3}
        placeholder="What they said about you…"
        className={styles.testimonialAddInput}
        disabled={busy}
      />
      {error && <div className={styles.testimonialAddError}>{error}</div>}
      <div className={styles.testimonialAddActions}>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={busy}
          className={styles.testimonialAddCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className={styles.testimonialAddSave}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ── AboutStatsRow ──────────────────────────────────────────────
// About-tab highlight cards (mobile DJs only). Each card must be activated
// by the owner to show to visitors. The owner sets each value (established
// year, events tier, insured, deposit %, and the yes/no facts).
export function AboutStatsRow({
  userId,
  isOwnProfile,
  stats,
  djType,
}: {
  userId: string;
  isOwnProfile: boolean;
  stats: AboutStats;
  // travelDistance is still passed by the caller but no longer surfaced here.
  travelDistance?: string | null;
  /** 'club' shows the club/bar quick-facts set; anything else the mobile set. */
  djType?: 'club' | 'mobile' | string | null;
}) {
  const isClub = djType === 'club';
  const eventsLabel = isClub ? 'Sets played' : 'Total events';
  // A follower count the owner typed → grouped with thousands separators for the
  // public card (e.g. "12000" → "12,000"). Non-numeric input shows as-is.
  const fmtFollowers = (raw: string): string => {
    const digits = (raw || '').replace(/[^0-9]/g, '');
    if (!digits) return (raw || '').trim();
    return Number(digits).toLocaleString('en-US');
  };
  const [draft, setDraft] = useState<AboutStats>(stats);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build the list of cards to show to visitors (activated + has a value).
  type Card = { key: string; label: string; value: string };
  const cards: Card[] = [];
  if (stats.established?.on && stats.established.year) cards.push({ key: 'established', label: 'Established', value: String(stats.established.year) });
  if (stats.events?.on && stats.events.tier) cards.push({ key: 'events', label: eventsLabel, value: stats.events.tier });
  if (stats.insured?.on) cards.push({ key: 'insured', label: 'Insured', value: stats.insured.answer || 'Yes' });
  if (isClub) {
    if (stats.ownEquipment?.on) cards.push({ key: 'ownEquipment', label: 'Brings own equipment', value: stats.ownEquipment.answer || 'Yes' });
    if (stats.residencies?.on) cards.push({ key: 'residencies', label: 'Open to residencies', value: stats.residencies.answer || 'Yes' });
    if (stats.travels?.on) cards.push({ key: 'travels', label: 'Travels for bookings', value: stats.travels.answer || 'Yes' });
    if (stats.followers?.on && stats.followers.count) cards.push({ key: 'followers', label: 'Total Followers', value: fmtFollowers(stats.followers.count) });
  } else {
    if (stats.depositRequired?.on) cards.push({ key: 'depositRequired', label: 'Deposit required', value: stats.depositRequired.answer || 'Yes' });
    if (stats.deposit?.on && stats.deposit.value) cards.push({ key: 'deposit', label: 'Deposit %', value: /%\s*$/.test(stats.deposit.value.trim()) ? stats.deposit.value.trim() : `${stats.deposit.value.trim().replace(/[^0-9.]/g, '')}%` });
    if (stats.destination?.on) cards.push({ key: 'destination', label: 'Destination weddings', value: stats.destination.answer || 'Yes' });
  }
  if (stats.backup?.on) cards.push({ key: 'backup', label: 'Backup equipment', value: stats.backup.answer || 'Yes' });

  async function save() {
    // Any fact that's turned on must have an answer before saving.
    const missing = STAT_FIELDS.filter(f => {
      if (!draft[f.key]?.on) return false;
      if (f.control === 'year') return !draft.established?.year;
      if (f.control === 'tier') return !draft.events?.tier;
      if (f.control === 'pct') return !draft.deposit?.value;
      if (f.control === 'count') return !draft.followers?.count;
      return !(draft[f.key] as { answer?: string } | undefined)?.answer;
    });
    if (missing.length) {
      setError(`Please answer (or turn off): ${missing.map(f => f.label).join(', ')}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveProfile(userId, { about_stats: JSON.stringify(draft) });
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'about');
      window.location.href = url.toString();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
      setBusy(false);
    }
  }

  function toggle(key: keyof AboutStats) {
    setDraft(d => ({ ...d, [key]: { ...(d[key] || {}), on: !(d[key]?.on) } }));
  }

  const currentYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = currentYear; y >= 1970; y--) years.push(y);
  const eventTiers = ['50+', '100+', '200+', '500+', '1000+'];
  const depositPcts = Array.from({ length: 99 }, (_, i) => `${i + 1}%`);

  // The editable facts, in display order. Labels match the public cards so the
  // owner sees exactly what a visitor sees as they fill each one in.
  const STAT_FIELDS: { key: keyof AboutStats; label: string; control: 'year' | 'tier' | 'pct' | 'yesno' | 'count' }[] = isClub
    ? [
        { key: 'established', label: 'Established', control: 'year' },
        { key: 'events', label: eventsLabel, control: 'tier' },
        { key: 'followers', label: 'Total Followers', control: 'count' },
        { key: 'insured', label: 'Insured', control: 'yesno' },
        { key: 'ownEquipment', label: 'Brings own equipment', control: 'yesno' },
        { key: 'residencies', label: 'Open to residencies', control: 'yesno' },
        { key: 'travels', label: 'Travels for bookings', control: 'yesno' },
        { key: 'backup', label: 'Backup equipment', control: 'yesno' },
      ]
    : [
        { key: 'established', label: 'Established', control: 'year' },
        { key: 'events', label: 'Total events', control: 'tier' },
        { key: 'insured', label: 'Insured', control: 'yesno' },
        { key: 'depositRequired', label: 'Deposit required', control: 'yesno' },
        { key: 'deposit', label: 'Deposit %', control: 'pct' },
        { key: 'destination', label: 'Destination weddings', control: 'yesno' },
        { key: 'backup', label: 'Backup equipment', control: 'yesno' },
      ];

  // Picking a value auto-activates the fact (checks "show on profile"); clearing
  // it back to blank auto-hides it. The owner no longer has to both answer AND
  // tick the box — answering is the activation.
  function setAnswer(key: keyof AboutStats, v: string) {
    setDraft(d => ({ ...d, [key]: { ...(d[key] || {}), answer: (v || undefined) as 'Yes' | 'No' | undefined, on: !!v } }));
  }

  // Renders the inline editor control that sits in place of a card's value, so
  // the owner edits the exact public box. `big` styles it like the teal value.
  function renderStatControl(key: keyof AboutStats, control: 'year' | 'tier' | 'pct' | 'yesno' | 'count', big?: boolean) {
    const cls = big ? styles.aboutStatValueSelect : styles.aboutStatsSelect;
    if (control === 'count') {
      // Free number entry (Total Followers). Digits only; stored as the raw
      // string and grouped with separators on the public card.
      return (
        <input
          type="text"
          inputMode="numeric"
          className={cls}
          placeholder="e.g. 12,500"
          value={draft.followers?.count ?? ''}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^0-9]/g, '');
            setDraft(d => ({ ...d, followers: { ...(d.followers || {}), count: digits || undefined, on: !!digits } }));
          }}
        />
      );
    }
    if (control === 'year') {
      return (
        <select
          className={cls}
          value={draft.established?.year ?? ''}
          onChange={(e) => setDraft(d => ({ ...d, established: { ...(d.established || {}), year: e.target.value ? parseInt(e.target.value, 10) : undefined, on: !!e.target.value } }))}
        >
          <option value="">Year…</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      );
    }
    if (control === 'tier') {
      return (
        <select
          className={cls}
          value={draft.events?.tier ?? ''}
          onChange={(e) => setDraft(d => ({ ...d, events: { ...(d.events || {}), tier: e.target.value || undefined, on: !!e.target.value } }))}
        >
          <option value="">Amount…</option>
          {eventTiers.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      );
    }
    if (control === 'pct') {
      return (
        <select
          className={cls}
          value={draft.deposit?.value ?? ''}
          onChange={(e) => setDraft(d => ({ ...d, deposit: { ...(d.deposit || {}), value: e.target.value || undefined, on: !!e.target.value } }))}
        >
          <option value="">Percent…</option>
          {depositPcts.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      );
    }
    return (
      <select
        className={cls}
        value={(draft[key] as { answer?: string } | undefined)?.answer ?? ''}
        onChange={(e) => setAnswer(key, e.target.value)}
      >
        <option value="">Yes / No…</option>
        <option value="Yes">Yes</option>
        <option value="No">No</option>
      </select>
    );
  }

  // ── Owner view: the exact public boxes, made editable (list on mobile) ──
  if (isOwnProfile) {
    return (
      <div className={styles.aboutStatsWrap}>
        <div className={styles.aboutStatsHeading}>
          Quick Facts
          <span className={styles.aboutStatsHint}>Only checked facts show on your profile</span>
        </div>
        <div className={styles.aboutStatsEditCol}>
          <div className={styles.aboutStatsGrid}>
            {STAT_FIELDS.map(f => {
              const on = !!draft[f.key]?.on;
              return (
                <div key={f.key} className={`${styles.aboutStatCard} ${styles.aboutStatCardEdit}`}>
                  <input
                    type="checkbox"
                    className={styles.aboutStatShowCheck}
                    checked={on}
                    onChange={() => toggle(f.key)}
                    title={on ? 'Showing to visitors — uncheck to hide' : 'Hidden — check to show'}
                  />
                  <div className={styles.aboutStatValue}>{renderStatControl(f.key, f.control, true)}</div>
                  <div className={`${styles.aboutStatLabel} ${on ? '' : styles.aboutStatLabelOff}`}>{f.label}?</div>
                </div>
              );
            })}
          </div>
          {error && <div className={styles.testimonialAddError}>{error}</div>}
          <div className={styles.aboutStatsActions}>
            <button type="button" className={styles.testimonialAddSave} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Visitor view: the activated facts as boxes (list on mobile) ──
  if (cards.length === 0) return null;
  return (
    <div className={styles.aboutStatsWrap}>
      <div className={styles.aboutStatsHeading}>Quick Facts</div>
      <div className={styles.aboutStatsGrid}>
        {cards.map(c => (
          <div key={c.key} className={styles.aboutStatCard}>
            <div className={styles.aboutStatValue}>{c.value}</div>
            <div className={styles.aboutStatLabel}>{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── FaqAccordion ───────────────────────────────────────────────
// Read-only (visitor) + owner view of the FAQ list, rendered as an
// accordion. The first question is open by default; tapping any question
// toggles its answer. Owner sees a delete ✕ on each card. Question sits
// in a dark-grey banner; the answer opens into a light-grey panel.
export function FaqAccordion({
  faqs,
  userId,
  isOwnProfile,
}: {
  faqs: Faq[];
  userId: string;
  isOwnProfile: boolean;
}) {
  // Multiple can be open at once. First item open by default; toggling one
  // never closes the others.
  const [openSet, setOpenSet] = useState<Set<number>>(() => new Set([0]));
  function toggle(i: number) {
    setOpenSet(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  // Styled delete confirm (replaces the native window.confirm). Holds the
  // index pending deletion, or null when no dialog is open.
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (pendingDelete == null) return;
    setDeleting(true);
    try {
      const next = faqs.filter((_, idx) => idx !== pendingDelete);
      await saveProfile(userId, { faqs: JSON.stringify(next) });
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'faq');
      window.location.href = url.toString();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed.');
      setDeleting(false);
      setPendingDelete(null);
    }
  }

  return (
    <>
      {faqs.map((f, i) => {
        const open = openSet.has(i);
        return (
          <div key={i} className={styles.faqItem}>
            {isOwnProfile && (
              <button
                type="button"
                onClick={() => setPendingDelete(i)}
                className={styles.faqDeleteBtn}
                title="Delete FAQ"
                aria-label="Delete FAQ"
              >
                ✕
              </button>
            )}
            <button
              type="button"
              className={styles.faqQuestion}
              onClick={() => toggle(i)}
              aria-expanded={open}
            >
              <span className={styles.faqQuestionText}>{f.question || ''}</span>
              <span className={styles.faqChevron} aria-hidden="true">
                {open ? '−' : '+'}
              </span>
            </button>
            {open && (
              <div className={styles.faqAnswer}>{f.answer || ''}</div>
            )}
          </div>
        );
      })}

      {pendingDelete != null && (
        <div
          className={styles.faqConfirmBackdrop}
          onClick={() => !deleting && setPendingDelete(null)}
        >
          <div
            className={styles.faqConfirmModal}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.faqConfirmTitle}>Delete this FAQ?</div>
            <div className={styles.faqConfirmText}>
              This question and answer will be permanently removed from your
              profile.
            </div>
            <div className={styles.faqConfirmActions}>
              <button
                type="button"
                className={styles.faqConfirmCancel}
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.faqConfirmDelete}
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── FaqAddForm ─────────────────────────────────────────────────
// Owner-only inline form to append a new FAQ (question + answer). Lives at
// the bottom of the FAQ tab pane. Shows suggested questions the owner can
// tap to prefill the question field. On submit, appends to the existing
// array and writes back to users.faqs (JSON-stringified). Capped at 10 by
// the caller (the form is only rendered while there's room).
const FAQ_SUGGESTIONS = [
  'Do you provide your own equipment?',
  'How far are you willing to travel?',
  'What genres of music do you play?',
  'Do you take song requests?',
  "What's your deposit and cancellation policy?",
  'Do you offer MC / hosting services?',
  'How far in advance should I book?',
  'Do you have lighting?',
  'Are you insured?',
  'What happens if you get sick or have an emergency?',
];

export function FaqAddForm({
  userId,
  existing,
}: {
  userId: string;
  existing: Faq[];
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setQuestion('');
    setAnswer('');
    setError(null);
  }

  async function save() {
    if (!question.trim() || !answer.trim()) {
      setError('Question and answer are both required.');
      return;
    }
    if (existing.length >= 10) {
      setError('You can add up to 10 FAQs.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next: Faq[] = [
        ...existing,
        { question: question.trim(), answer: answer.trim() },
      ];
      await saveProfile(userId, { faqs: JSON.stringify(next) });
      // Reload with ?tab=faq so the user lands back on the FAQ tab
      // instead of jumping to the default (booking/about).
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'faq');
      window.location.href = url.toString();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={styles.testimonialAddBtn}
      >
        + Add FAQ
      </button>
    );
  }

  // Questions the owner hasn't already used, so suggestions stay useful.
  const usedQuestions = new Set(
    existing.map((f) => (f.question || '').trim().toLowerCase()),
  );
  const suggestions = FAQ_SUGGESTIONS.filter(
    (q) => !usedQuestions.has(q.toLowerCase()),
  );

  return (
    <div className={styles.testimonialAddForm}>
      <div className={styles.testimonialAddFormLabel}>Question</div>
      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="e.g. Do you provide your own equipment?"
        className={styles.testimonialAddInput}
        disabled={busy}
      />
      {suggestions.length > 0 && (
        <div className={styles.faqSuggestWrap}>
          <div className={styles.faqSuggestLabel}>Need ideas? Tap one:</div>
          <div className={styles.faqSuggestList}>
            {suggestions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setQuestion(q)}
                className={styles.faqSuggestChip}
                disabled={busy}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className={styles.testimonialAddFormLabel}>Answer</div>
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={3}
        placeholder="Your answer…"
        className={styles.testimonialAddInput}
        disabled={busy}
      />
      {error && <div className={styles.testimonialAddError}>{error}</div>}
      <div className={styles.testimonialAddActions}>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={busy}
          className={styles.testimonialAddCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className={styles.testimonialAddSave}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Staff + Affiliates (mobile DJs only)
//
// Two profile tabs backed by jsonb arrays on public.users (staff / affiliates),
// parsed with parseStaff() / parseAffiliates() from lib/staff.ts.
//
//   Staff       — image (optional) + name + job position, stacked photo→name→pos.
//   Affiliates  — image (optional) + name + company type + optional description.
//
// The *Grid components render the read-only display shown to visitors, plus a
// delete control for the owner. The *Editor components are the owner's "+ Add"
// form. Images are optional everywhere — the grid shows initials when absent.
// ──────────────────────────────────────────────────────────────────────────

// Shared: upload one optional entry image to the avatars bucket and return its
// public URL, or null if no file was chosen. Throws on a validation/upload
// failure so the caller can surface the message.
async function uploadEntryImage(
  userId: string,
  file: File | null,
  prefix: 'staff' | 'affiliate',
): Promise<string | null> {
  if (!file) return null;
  const valErr = await validateImageFile(file);
  if (valErr) throw new Error(valErr);
  const supabase = createClient();
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const id = rand.replace(/[^a-z0-9]/gi, '');
  const path = `${profileUploadFolder(userId)}/${prefix}_${id}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) throw new Error(upErr.message);
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

// A round/tile image with an initials fallback when no photo is set.
function EntryImage({ src, name, size, square }: { src?: string | null; name: string; size: number; square?: boolean }) {
  const radius = square ? 12 : '50%';
  if (src) {
    // Sizes to the CARD, never a fixed width that can exceed it (that is what
    // let the card shear the circle's left/right into flat sides):
    //  - OUTER: block, width 100% of the card's inner width, capped at `size`,
    //    centered. Because it's block + width:100% (not a shrink-wrapping flex
    //    child), it always resolves to a real width and never collapses.
    //  - INNER: width 100% + padding-bottom 100% (a % padding measures against
    //    the OUTER's width), so height always equals width — a perfect square,
    //    hence a true circle. The padding trick can't collapse to zero.
    // Photo is a BACKGROUND (no <img>) so nothing leaks its proportions in.
    return (
      <span style={{ display: 'block', width: '100%', maxWidth: size, margin: '0 auto' }}>
        <span
          role="img"
          aria-label={name}
          style={{
            display: 'block', position: 'relative',
            width: '100%', height: 0, paddingBottom: '100%',
            borderRadius: radius, overflow: 'hidden', border: 'none',
            backgroundImage: `url("${thumbUrl(src, 400)}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
      </span>
    );
  }
  return (
    <div
      aria-hidden="true"
      style={{
        width: size, height: 'auto', maxWidth: '100%', aspectRatio: '1 / 1', borderRadius: radius,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)',
        color: 'var(--neon,#00e0a4)', fontFamily: "'Bebas Neue', sans-serif",
        fontSize: size * 0.4, letterSpacing: '.03em',
      }}
    >
      {initialsOf(name)}
    </div>
  );
}

export function StaffSection({ userId, staff, isOwnProfile, onPhotoClick }: { userId: string; staff: StaffMember[]; isOwnProfile: boolean; onPhotoClick?: (src: string) => void }) {
  const { confirm, confirmDialog } = useConfirm();
  // mode: null (viewing), 'new' (adding), or an entry id (editing that one).
  const [mode, setMode] = useState<null | 'new' | string>(null);
  const [entryId, setEntryId] = useState('');
  const [name, setName] = useState('');
  const [position, setPosition] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [bgColor, setBgColor] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A staff headshot opens in its OWN circular viewer (not the rectangular
  // gallery lightbox) so it stays a clean circle when enlarged.
  const [viewSrc, setViewSrc] = useState<string | null>(null);
  void onPhotoClick;
  const inputRef = useRef<HTMLInputElement>(null);

  function openNew() {
    if (staff.length >= STAFF_MAX) { setError(`You can add up to ${STAFF_MAX} team members.`); return; }
    setEntryId(newEntryId()); setName(''); setPosition(''); setPhoto(null); setBgColor(null); setError(null); setMode('new');
  }
  function openEdit(s: StaffMember) {
    setEntryId(s.id); setName(s.name); setPosition(s.position); setPhoto(s.photo || null); setBgColor(s.bgColor || null); setError(null); setMode(s.id);
  }
  function close() { setMode(null); setCropFile(null); setError(null); }

  async function persist(next: StaffMember[]) {
    await saveProfile(userId, { staff: next });
    const url = new URL(window.location.href);
    url.searchParams.set('tab', 'staff');
    window.location.href = url.toString();
  }

  async function remove(s: StaffMember) {
    const ok = await confirm({
      title: 'Remove this team member?',
      message: `${s.name || 'This person'} will be removed from your Staff tab. You can add them back any time.`,
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try { await persist(staff.filter((x) => x.id !== s.id)); }
    catch (err) { setBusy(false); setError(err instanceof Error ? err.message : 'Could not remove.'); }
  }

  async function save() {
    if (!name.trim()) { setError('Name is required.'); return; }
    setBusy(true); setError(null);
    try {
      const entry: StaffMember = { id: entryId, name: name.trim(), position: position.trim(), photo, bgColor: safeHexColor(bgColor) };
      const next = mode === 'new'
        ? [...staff, entry]
        : staff.map((s) => (s.id === entryId ? entry : s));
      await persist(next);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Save failed.');
    }
  }

  const editLight = isLightHex(bgColor);
  // The editor lives INSIDE a staff card shell so a member is edited right where
  // it shows — one box, no separate form.
  const editorCard = (
    <div
      className={`${styles.staffCard} ${styles.staffCardEditing} ${editLight ? styles.affiliateCardEditingLight : ''}`}
      style={bgColor ? { background: bgColor } : undefined}
    >
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className={styles.entryPhotoPick} aria-label="Add photo (optional)">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
        ) : (
          <span>Photo<br /><small>optional</small></span>
        )}
      </button>
      {photo && <button type="button" onClick={() => setPhoto(null)} disabled={busy} className={styles.entryPhotoClear}>Remove photo</button>}
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0] || null; if (f) setCropFile(f); e.currentTarget.value = ''; }} />

      <div className={styles.testimonialAddFormLabel}>Name</div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jordan Reyes" className={styles.testimonialAddInput} disabled={busy} />
      <div className={styles.testimonialAddFormLabel}>Job position</div>
      <input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="e.g. MC / Host" className={styles.testimonialAddInput} disabled={busy} />

      <div className={styles.testimonialAddFormLabel}>Card background <span style={{ opacity: .6 }}>(optional)</span></div>
      <div className={styles.affiliateColorRow}>
        <label className={styles.affiliateColorWheel} title="Pick a color" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <input
            type="color"
            value={safeHexColor(bgColor) || '#141414'}
            onChange={(e) => setBgColor(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            disabled={busy}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
          />
        </label>
        {bgColor && <span className={styles.affiliateColorChip} style={{ background: bgColor }} aria-hidden="true" />}
        <span className={styles.affiliateColorLabel}>{bgColor ? bgColor.toUpperCase() : 'Default (black)'}</span>
        {bgColor && <button type="button" className={styles.affiliateColorReset} onClick={() => setBgColor(null)} disabled={busy}>Reset</button>}
      </div>

      {error && <div className={styles.testimonialAddError}>{error}</div>}
      <div className={styles.testimonialAddActions}>
        <button type="button" onClick={close} disabled={busy} className={styles.testimonialAddCancel}>Cancel</button>
        <button type="button" onClick={save} disabled={busy} className={styles.testimonialAddSave}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );

  return (
    <>
      {(staff.length > 0 || mode === 'new') && (
        <div className={styles.staffGrid}>
          {staff.map((s) => {
            // display:contents lets editorCard itself be the grid item (spanning
            // 2 cols, not the full row), so editing looks like the add editor.
            if (mode === s.id) return <div key={s.id} style={{ display: 'contents' }}>{editorCard}</div>;
            const light = isLightHex(s.bgColor);
            const nameColor = s.bgColor ? (light ? '#141414' : '#fff') : undefined;
            const posColor = s.bgColor ? (light ? 'rgba(0,0,0,.62)' : undefined) : undefined;
            const actionBtnStyle: React.CSSProperties | undefined = s.bgColor
              ? { background: light ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.14)', color: light ? '#141414' : '#fff' }
              : undefined;
            return (
            <div key={s.id} className={styles.staffCard} style={s.bgColor ? { background: s.bgColor } : undefined}>
              {s.photo ? (
                // NOTE: this wrapper is a <span>, not a <button>. A <button>
                // clips its content to its own box, so when the card got narrow
                // the button sheared the left/right off the circle (flat sides).
                // A plain inline-block span never clips its child.
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() => setViewSrc(s.photo!)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViewSrc(s.photo!); } }}
                  aria-label={`View ${s.name}'s photo`}
                  style={{ display: 'block', width: '100%', cursor: 'zoom-in', lineHeight: 0 }}
                >
                  <EntryImage src={s.photo} name={s.name} size={96} />
                </span>
              ) : (
                <EntryImage src={s.photo} name={s.name} size={96} />
              )}
              <div className={styles.staffName} style={nameColor ? { color: nameColor } : undefined}>{s.name}</div>
              {s.position && <div className={styles.staffPosition} style={posColor ? { color: posColor } : undefined}>{s.position}</div>}
              {isOwnProfile && (
                <div className={styles.entryCardActions}>
                  <button type="button" onClick={() => openEdit(s)} className={styles.entryEditBtn} title="Edit" aria-label="Edit team member" style={actionBtnStyle}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                  </button>
                  <button type="button" onClick={() => remove(s)} className={styles.entryDeleteBtn} title="Remove" aria-label="Remove team member" style={actionBtnStyle}>✕</button>
                </div>
              )}
            </div>
            );
          })}
          {/* Inline "+" add tile sits to the RIGHT of the staff cards once at
              least one member exists — a quick way to add another without
              scrolling to the button below. */}
          {isOwnProfile && !mode && staff.length > 0 && staff.length < STAFF_MAX && (
            <button type="button" onClick={openNew} className={styles.staffAddTile} aria-label="Add staff member">
              <span aria-hidden="true">+</span>
            </button>
          )}
          {/* New-member editor renders as a normal grid item so it appears in
              the next column — to the RIGHT of the existing card(s) — rather
              than spanning the full row below them. */}
          {mode === 'new' && editorCard}
        </div>
      )}

      {/* The full-width button shows only when there are no members yet; once
          there's at least one, the inline "+" tile above handles adding more. */}
      {isOwnProfile && !mode && staff.length === 0 && (
        <button type="button" onClick={openNew} className={styles.testimonialAddBtn}>+ Add staff member</button>
      )}
      {error && !mode && <div className={styles.testimonialAddError} style={{ marginTop: '.5rem' }}>{error}</div>}

      {/* Circular headshot viewer — a real round crop, isolated from the gallery
          lightbox so it can't render as an oval. Rendered through a PORTAL to
          <body> so a transformed/stacked ancestor (e.g. the banner) can't trap
          the fixed overlay behind it. */}
      {viewSrc && typeof document !== 'undefined' && createPortal(
        <div
          onClick={() => setViewSrc(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
        >
          <span
            style={{ display: 'block', width: 'min(360px, 80vw, 70vh)', height: 'min(360px, 80vw, 70vh)', borderRadius: '50%', overflow: 'hidden', border: '2px solid rgba(255,255,255,.15)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={viewSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
          </span>
        </div>,
        document.body
      )}

      {confirmDialog}
      <AvatarCrop
        file={cropFile}
        userId={userId}
        uploadFolder={profileUploadFolder(userId)}
        storagePath={`${profileUploadFolder(userId)}/staff_${entryId}.png`}
        title="Position Photo"
        fitMode="contain"
        hint="The whole photo shows by default — drag to move, slide to zoom in."
        onClose={() => setCropFile(null)}
        onSuccess={(u) => { setPhoto(u); setCropFile(null); }}
      />
    </>
  );
}

export function AffiliatesSection({ userId, affiliates, isOwnProfile }: { userId: string; affiliates: Affiliate[]; isOwnProfile: boolean }) {
  const { confirm, confirmDialog } = useConfirm();
  const [mode, setMode] = useState<null | 'new' | string>(null);
  const [entryId, setEntryId] = useState('');
  const [name, setName] = useState('');
  const [companyType, setCompanyType] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [bgColor, setBgColor] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(f: File | null) {
    setFile(f);
    setPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return f ? URL.createObjectURL(f) : null; });
  }
  function openNew() {
    if (affiliates.length >= AFFILIATES_MAX) { setError(`You can add up to ${AFFILIATES_MAX} affiliates.`); return; }
    setEntryId(newEntryId()); setName(''); setCompanyType(''); setDescription(''); setWebsite(''); setImage(null); setBgColor(null); pick(null); setError(null); setMode('new');
  }
  function openEdit(a: Affiliate) {
    setEntryId(a.id); setName(a.name); setCompanyType(a.companyType); setDescription(a.description || ''); setWebsite(a.url || ''); setImage(a.image || null); setBgColor(a.bgColor || null); pick(null); setError(null); setMode(a.id);
  }
  function close() { setMode(null); pick(null); setError(null); }

  async function persist(next: Affiliate[]) {
    await saveProfile(userId, { affiliates: next });
    const url = new URL(window.location.href);
    url.searchParams.set('tab', 'affiliates');
    window.location.href = url.toString();
  }

  async function remove(a: Affiliate) {
    const ok = await confirm({
      title: 'Remove this affiliate?',
      message: `${a.name || 'This company'} will be removed from your Affiliates tab. You can add it back any time.`,
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try { await persist(affiliates.filter((x) => x.id !== a.id)); }
    catch (err) { setBusy(false); setError(err instanceof Error ? err.message : 'Could not remove.'); }
  }

  async function save() {
    if (!name.trim()) { setError('Name is required.'); return; }
    setBusy(true); setError(null);
    try {
      const uploaded = file ? await uploadEntryImage(userId, file, 'affiliate') : image;
      const entry: Affiliate = { id: entryId, name: name.trim(), companyType: companyType.trim(), description: description.trim(), image: uploaded, url: normalizeUrl(website), bgColor: safeHexColor(bgColor) };
      const next = mode === 'new'
        ? [...affiliates, entry]
        : affiliates.map((a) => (a.id === entryId ? entry : a));
      await persist(next);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Save failed.');
    }
  }

  const shownPreview = preview || image;

  // The editor lives INSIDE a card shell (same box as the display card) so a DJ
  // edits the affiliate right where it shows — no separate form below.
  const editLight = isLightHex(bgColor);
  const editorCard = (
    <div
      className={`${styles.affiliateCard} ${styles.affiliateCardEditing} ${editLight ? styles.affiliateCardEditingLight : ''}`}
      style={bgColor ? { background: bgColor } : undefined}
    >
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className={styles.affiliateImgTop} style={{ cursor: 'pointer', padding: 0, marginBottom: '.85rem' }} aria-label="Add image (optional)">
        {shownPreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shownPreview} alt="" />
        ) : (
          <span className={styles.affiliateImgFallback} style={{ fontFamily: "'Space Mono', monospace", fontSize: '.8rem', textTransform: 'uppercase' }}><span>Image</span><small style={{ fontSize: '.65rem', opacity: .8 }}>optional</small></span>
        )}
      </button>
      {shownPreview && <button type="button" onClick={() => { pick(null); setImage(null); }} disabled={busy} className={styles.entryPhotoClear} style={{ marginBottom: '.6rem' }}>Remove image</button>}
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0] || null)} />

      <div className={styles.testimonialAddFormLabel}>Company name</div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bloom & Co" className={styles.testimonialAddInput} disabled={busy} />
      <div className={styles.testimonialAddFormLabel}>Type of company</div>
      <input value={companyType} onChange={(e) => setCompanyType(e.target.value)} placeholder="e.g. Florist" className={styles.testimonialAddInput} disabled={busy} />
      <div className={styles.testimonialAddFormLabel}>Website <span style={{ opacity: .6 }}>(optional)</span></div>
      <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="e.g. bloomandco.com" className={styles.testimonialAddInput} disabled={busy} />
      <div className={styles.testimonialAddFormLabel}>Description <span style={{ opacity: .6 }}>(optional)</span></div>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="A short note on why you recommend them…" className={styles.testimonialAddInput} disabled={busy} />

      <div className={styles.testimonialAddFormLabel}>Card background <span style={{ opacity: .6 }}>(optional)</span></div>
      <div className={styles.affiliateColorRow}>
        {/* Wheel stays a rainbow so it's always visible; the chosen color shows
            in the swatch + hex next to it. */}
        <label
          className={styles.affiliateColorWheel}
          title="Pick a color"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="color"
            value={safeHexColor(bgColor) || '#141414'}
            onChange={(e) => setBgColor(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            disabled={busy}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
          />
        </label>
        {bgColor && <span className={styles.affiliateColorChip} style={{ background: bgColor }} aria-hidden="true" />}
        <span className={styles.affiliateColorLabel}>{bgColor ? bgColor.toUpperCase() : 'Default (black)'}</span>
        {bgColor && (
          <button type="button" className={styles.affiliateColorReset} onClick={() => setBgColor(null)} disabled={busy}>Reset</button>
        )}
      </div>

      {error && <div className={styles.testimonialAddError}>{error}</div>}
      <div className={styles.testimonialAddActions}>
        <button type="button" onClick={close} disabled={busy} className={styles.testimonialAddCancel}>Cancel</button>
        <button type="button" onClick={save} disabled={busy} className={styles.testimonialAddSave}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );

  return (
    <>
      {(affiliates.length > 0 || mode === 'new') && (
        <div className={styles.affiliateList}>
          {affiliates.map((a) => {
            // Editing THIS one → the card becomes its editor in place.
            if (mode === a.id) return <div key={a.id} style={{ display: 'contents' }}>{editorCard}</div>;

            // Contrast: on a light custom bg, switch text + action buttons to dark
            // so they don't blend in (and vice-versa on dark).
            const light = isLightHex(a.bgColor);
            const nameColor = a.bgColor ? (light ? '#141414' : '#fff') : undefined;
            const typeColor = a.bgColor ? (light ? '#0a7f63' : undefined) : undefined;
            const descColor = a.bgColor ? (light ? 'rgba(0,0,0,.62)' : 'rgba(255,255,255,.72)') : undefined;
            const actionBtnStyle: React.CSSProperties | undefined = a.bgColor
              ? { background: light ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.14)', color: light ? '#141414' : '#fff' }
              : undefined;
            return (
            <div key={a.id} className={styles.affiliateCard} style={a.bgColor ? { background: a.bgColor } : undefined}>
              <div className={styles.affiliateMain}>
                {a.image ? (
                  a.url ? (
                    <a href={a.url} target="_blank" rel="noopener noreferrer nofollow" className={styles.affiliateImgTop} aria-label={`${a.name} website`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbUrl(a.image, 700)} alt={a.name} />
                    </a>
                  ) : (
                    <div className={styles.affiliateImgTop}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbUrl(a.image, 700)} alt={a.name} />
                    </div>
                  )
                ) : (
                  <div className={styles.affiliateImgTop}>
                    <span className={styles.affiliateImgFallback}>{initialsOf(a.name)}</span>
                  </div>
                )}
                <div className={styles.affiliateBody}>
                  {a.url ? (
                    <a href={a.url} target="_blank" rel="noopener noreferrer nofollow" className={styles.affiliateNameLink} style={nameColor ? { color: nameColor } : undefined}>
                      {a.name}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 6, verticalAlign: 'middle', opacity: .8 }}><path d="M7 17 17 7M8 7h9v9"/></svg>
                    </a>
                  ) : (
                    <div className={styles.affiliateName} style={nameColor ? { color: nameColor } : undefined}>{a.name}</div>
                  )}
                  {a.companyType && <div className={styles.affiliateType} style={typeColor ? { color: typeColor } : undefined}>{a.companyType}</div>}
                  {a.description && <div className={styles.affiliateDesc} style={descColor ? { color: descColor } : undefined}>{a.description}</div>}
                </div>
              </div>
              {isOwnProfile && (
                <div className={styles.entryCardActions}>
                  <button type="button" onClick={() => openEdit(a)} className={styles.entryEditBtn} title="Edit" aria-label="Edit affiliate" style={actionBtnStyle}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                  </button>
                  <button type="button" onClick={() => remove(a)} className={styles.entryDeleteBtn} title="Remove" aria-label="Remove affiliate" style={actionBtnStyle}>✕</button>
                </div>
              )}
            </div>
            );
          })}
          {/* Inline "+" tile to the RIGHT of the cards once at least one exists. */}
          {isOwnProfile && !mode && affiliates.length > 0 && affiliates.length < AFFILIATES_MAX && (
            <button type="button" onClick={openNew} className={styles.staffAddTile} aria-label="Add affiliate">
              <span aria-hidden="true">+</span>
            </button>
          )}
          {/* Adding a new one → the editor renders as a normal grid item so it
              opens NEXT TO the existing card(s), not full-width below. */}
          {mode === 'new' && editorCard}
        </div>
      )}

      {/* Full-width button only when there are none yet; the inline "+" tile
          handles adding more once at least one affiliate exists. */}
      {isOwnProfile && !mode && affiliates.length === 0 && (
        <button type="button" onClick={openNew} className={styles.testimonialAddBtn}>+ Add affiliate</button>
      )}
      {error && !mode && <div className={styles.testimonialAddError} style={{ marginTop: '.5rem' }}>{error}</div>}

      {confirmDialog}
    </>
  );
}
