'use client';

import { useState } from 'react';
import styles from './updateDjProfile.module.css';
import { createClient } from '@/lib/supabase/client';
import { updateMyEmailAction } from '@/lib/actions/updateMyEmail';
import { updateMyDjNameAction } from '@/lib/actions/updateMyDjName';

// ─────────────────────────────────────────────────────────────────────────
// NameChangeBlock — the DJ / Company Name is a public identity (it's on the
// profile, contracts, and every booking), so it stays READ-ONLY until the DJ
// re-confirms their current password. Click "Change" → type the new name +
// current password → the server action verifies and writes it. Saves itself;
// no separate Save button. Mirrors EmailChangeBlock exactly.
// ─────────────────────────────────────────────────────────────────────────
export function NameChangeBlock({
  djType, currentName, onSaved,
}: {
  djType: 'mobile' | 'club' | string | null;
  currentName: string;
  onSaved: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const [shownName, setShownName] = useState(currentName);
  const label = djType === 'club' ? 'DJ Name' : 'DJ / Company Name';

  async function save(e?: React.MouseEvent) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    setFeedback(null);
    if (!newName.trim() || !pw) {
      setFeedback({ msg: 'Please fill in both fields.', ok: false });
      return;
    }
    setBusy(true);
    try {
      const result = await updateMyDjNameAction({ newName: newName.trim(), currentPassword: pw });
      if (!result.success) {
        setFeedback({ msg: result.error || 'Failed', ok: false });
      } else {
        const saved = result.newName || newName.trim();
        setFeedback({ msg: '✓ Name changed.', ok: true });
        setShownName(saved);
        onSaved(saved);
        setNewName('');
        setPw('');
        setTimeout(() => { setOpen(false); setFeedback(null); }, 1500);
      }
    } catch (err) {
      setFeedback({ msg: err instanceof Error ? err.message : 'Failed', ok: false });
    } finally {
      setBusy(false);
    }
  }

  const btnBase: React.CSSProperties = {
    fontFamily: "'Space Mono', monospace", fontSize: '.62rem', letterSpacing: '.07em',
    textTransform: 'uppercase', padding: '.6rem 1rem', borderRadius: 6, whiteSpace: 'nowrap',
  };

  return (
    <div className={styles.formGroup}>
      <label>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <input type="text" value={shownName} readOnly className={styles.input} style={{ flex: 1, opacity: 0.7 }} />
        {!open && (
          <button
            type="button"
            onClick={() => { setOpen(true); setFeedback(null); }}
            style={{ ...btnBase, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)' }}
          >
            Change
          </button>
        )}
      </div>

      {open && (
        <div style={{ marginTop: '.75rem', padding: '1rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
          <input
            type="text"
            placeholder={djType === 'club' ? 'New DJ name' : 'New DJ / Company name'}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void save(); } }}
            className={styles.input}
          />
          <input
            type="password"
            placeholder="Current password (to confirm)"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void save(); } }}
            className={styles.input}
            autoComplete="current-password"
          />
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button" onClick={(e) => void save(e)} disabled={busy}
              style={{ ...btnBase, padding: '.55rem 1rem', border: '1px solid var(--neon)', background: 'var(--neon-dim)', color: 'var(--neon)', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1 }}
            >
              {busy ? 'Saving…' : 'Update Name'}
            </button>
            <button
              type="button" onClick={() => { setOpen(false); setNewName(''); setPw(''); setFeedback(null); }}
              style={{ ...btnBase, padding: '.55rem 1rem', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}
            >
              Cancel
            </button>
            {feedback && (
              <span style={{ fontSize: '.78rem', color: feedback.ok ? 'var(--success)' : 'var(--error)' }}>
                {feedback.msg}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// EmailChangeBlock — inline form to change the account's email address.
// Click "Change" to expand the form. Server action does the actual swap
// with email_confirm: true (no verification email sent).
// ─────────────────────────────────────────────────────────────────────────
export function EmailChangeBlock({ currentEmail }: { currentEmail: string }) {
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const [shownEmail, setShownEmail] = useState(currentEmail);

  async function save(e?: React.MouseEvent) {
    // Stop the click from bubbling up to the surrounding <form> in
    // UpdateDjProfileClient. Without this, certain browsers/autofill
    // managers can swallow the first click as a focus shift, requiring
    // a second click to actually trigger the save.
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setFeedback(null);
    if (!newEmail.trim() || !pw) {
      setFeedback({ msg: 'Please fill in both fields.', ok: false });
      return;
    }
    setBusy(true);
    try {
      const result = await updateMyEmailAction({
        newEmail: newEmail.trim(),
        currentPassword: pw,
      });
      if (!result.success) {
        setFeedback({ msg: result.error || 'Failed', ok: false });
      } else {
        setFeedback({ msg: '✓ Email changed.', ok: true });
        setShownEmail(result.newEmail || newEmail.trim());
        setNewEmail('');
        setPw('');
        // Collapse the form after a moment so the success state is visible.
        setTimeout(() => {
          setOpen(false);
          setFeedback(null);
        }, 1500);
      }
    } catch (e) {
      setFeedback({ msg: e instanceof Error ? e.message : 'Failed', ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.formGroup}>
      <label>Email Address</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <input
          type="email"
          value={shownEmail}
          readOnly
          className={styles.input}
          style={{ flex: 1, opacity: 0.7 }}
        />
        {!open && (
          <button
            type="button"
            onClick={() => { setOpen(true); setFeedback(null); }}
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '.62rem',
              letterSpacing: '.07em',
              textTransform: 'uppercase',
              padding: '.6rem 1rem',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--muted)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Change
          </button>
        )}
      </div>

      {open && (
        <div style={{
          marginTop: '.75rem',
          padding: '1rem',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '.65rem',
        }}>
          <input
            type="email"
            placeholder="New email address"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => {
              // Trap Enter so it triggers the inline save instead of the
              // outer <form>'s submit (which would save the whole profile).
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                save();
              }
            }}
            className={styles.input}
            autoComplete="email"
          />
          <input
            type="password"
            placeholder="Current password (to confirm)"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                save();
              }
            }}
            className={styles.input}
            autoComplete="current-password"
          />
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={(e) => save(e)}
              disabled={busy}
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '.62rem',
                letterSpacing: '.07em',
                textTransform: 'uppercase',
                padding: '.55rem 1rem',
                borderRadius: '6px',
                border: '1px solid var(--neon)',
                background: 'var(--neon-dim)',
                color: 'var(--neon)',
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.5 : 1,
              }}
            >
              {busy ? 'Saving…' : 'Update Email'}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setNewEmail(''); setPw(''); setFeedback(null); }}
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '.62rem',
                letterSpacing: '.07em',
                textTransform: 'uppercase',
                padding: '.55rem 1rem',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--muted)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            {feedback && (
              <span style={{
                fontSize: '.78rem',
                color: feedback.ok ? 'var(--success)' : 'var(--error)',
              }}>
                {feedback.msg}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PasswordChangeBlock — inline form to change the account's password.
// ─────────────────────────────────────────────────────────────────────────
// SlugChangeGate — the profile URL is a public identity, so we don't let it
// be edited casually. It stays LOCKED (read-only) until the DJ re-confirms
// their current password (same signInWithPassword re-auth used by the
// password/email blocks). Once unlocked, they edit a DRAFT and click Save
// (next to the field). Save writes the slug DIRECTLY to the DB — like the
// email/password blocks — and reports up via onSaved so the parent clears
// just the slug's dirty flag (no false "unsaved changes" warning).
// ─────────────────────────────────────────────────────────────────────────
type GateStatus = 'idle' | 'checking' | 'available' | 'taken';

export function SlugChangeGate({
  email,
  userId,
  currentUrl,
  currentSlug,
  onSaved,
  renderInput,
}: {
  email: string;
  userId: string;
  currentUrl: string;
  currentSlug: string;
  onSaved: (slug: string) => void;
  renderInput: (p: {
    value: string;
    onChange: (v: string) => void;
    onStatusChange: (s: GateStatus) => void;
    footer?: React.ReactNode;
  }) => React.ReactNode;
}) {
  const [unlocked, setUnlocked] = useState(false);
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [draft, setDraft] = useState(currentSlug || '');
  const [status, setStatus] = useState<GateStatus>('idle');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const changed = (draft || '').trim() !== (currentSlug || '').trim();
  const canSave = changed && status === 'available' && !saving;

  async function verify(e?: React.MouseEvent) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    setErr(null);
    if (!pw) { setErr('Enter your password to continue.'); return; }
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const addr = user?.email || email;
      if (!addr) throw new Error('Not signed in.');
      const { error } = await supabase.auth.signInWithPassword({ email: addr, password: pw });
      if (error) throw new Error('Incorrect password.');
      setUnlocked(true);
      setOpen(false);
      setPw('');
      setDraft(currentSlug || '');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not verify.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const next = (draft || '').trim();
    if (!next || next === (currentSlug || '').trim() || status !== 'available') return;
    setSaving(true);
    setErr(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from('users').update({ slug: next } as unknown as never).eq('id', userId);
      if (error) { setErr('That URL was just taken — try another.'); return; }
      onSaved(next);
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save your URL.');
    } finally {
      setSaving(false);
    }
  }

  const btn = (variant: 'ghost' | 'primary', enabled = true): React.CSSProperties => ({
    fontFamily: "'Space Mono', monospace",
    fontSize: '.62rem',
    letterSpacing: '.07em',
    textTransform: 'uppercase',
    padding: '.6rem 1.1rem',
    borderRadius: 6,
    border: variant === 'primary' ? 'none' : '1px solid var(--border)',
    background: variant === 'primary' ? 'var(--neon)' : 'transparent',
    color: variant === 'primary' ? 'var(--black)' : 'var(--muted)',
    fontWeight: variant === 'primary' ? 700 : 400,
    whiteSpace: 'nowrap',
    cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.45,
  });

  // ── Unlocked: edit a draft + Save (writes straight to the DB) ──
  if (unlocked) {
    // Status line + Cancel/Save, rendered INSIDE the URL box (via footer).
    const footer = (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem', marginTop: '.75rem' }}>
        <span style={{ fontSize: '.7rem', color: err ? '#ff6b6b' : (saved && !changed ? 'var(--success)' : 'var(--muted)') }}>
          {err
            ? err
            : (saved && !changed)
              ? '✓ URL saved.'
              : 'Enter a new URL, then click Save to apply it.'}
        </span>
        <div style={{ display: 'flex', gap: '.5rem', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => { setUnlocked(false); setDraft(currentSlug || ''); setStatus('idle'); setErr(null); setSaved(false); }}
            disabled={saving}
            style={btn('ghost', !saving)}
          >
            Cancel
          </button>
          <button type="button" disabled={!canSave} onClick={save} style={btn('primary', canSave)}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    );
    return (
      <div>
        {renderInput({
          value: draft,
          onChange: (v) => { setDraft(v); setSaved(false); },
          onStatusChange: setStatus,
          footer,
        })}
      </div>
    );
  }

  // ── Locked: read-only URL + password to unlock ──
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <input type="text" value={currentUrl} readOnly className={styles.input} style={{ flex: 1, opacity: 0.7 }} />
        {!open && (
          <button type="button" onClick={() => { setOpen(true); setErr(null); }} style={btn('ghost')}>
            🔒 Change
          </button>
        )}
      </div>

      {open && (
        <div style={{
          marginTop: '.75rem',
          padding: '1rem',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: '.65rem',
        }}>
          <p style={{ margin: 0, fontSize: '.72rem', color: 'var(--muted)', lineHeight: 1.4 }}>
            For your security, confirm your password to change your profile URL.
          </p>
          <input
            type="password"
            placeholder="Current password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); verify(); } }}
            className={styles.input}
            autoComplete="current-password"
          />
          {err && <div style={{ color: '#ff6b6b', fontSize: '.75rem' }}>{err}</div>}
          <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => { setOpen(false); setPw(''); setErr(null); }} style={btn('ghost')}>
              Cancel
            </button>
            <button type="button" onClick={verify} disabled={busy} style={btn('primary', !busy)}>
              {busy ? 'Verifying…' : 'Unlock'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Uses Supabase auth.updateUser directly after re-authenticating with
// the current password. No server action needed since password updates
// don't have the verification-email problem that email changes do.
// ─────────────────────────────────────────────────────────────────────────
export function PasswordChangeBlock() {
  const [open, setOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  async function save(e?: React.MouseEvent) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setFeedback(null);
    if (!currentPw || !newPw || !confirmPw) {
      setFeedback({ msg: 'Please fill in all fields.', ok: false });
      return;
    }
    if (newPw.length < 8) {
      setFeedback({ msg: 'New password must be at least 8 characters.', ok: false });
      return;
    }
    if (newPw !== confirmPw) {
      setFeedback({ msg: 'New passwords do not match.', ok: false });
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      // Re-auth with current password first
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !user.email) throw new Error('Not signed in.');
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPw,
      });
      if (authErr) throw new Error('Current password is incorrect.');
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
      setFeedback({ msg: '✓ Password updated.', ok: true });
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setTimeout(() => {
        setOpen(false);
        setFeedback(null);
      }, 1500);
    } catch (e) {
      setFeedback({ msg: e instanceof Error ? e.message : 'Failed', ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.formGroup}>
      <label>Password</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <input
          type="password"
          value="••••••••••"
          readOnly
          className={styles.input}
          style={{ flex: 1, opacity: 0.7 }}
        />
        {!open && (
          <button
            type="button"
            onClick={() => { setOpen(true); setFeedback(null); }}
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '.62rem',
              letterSpacing: '.07em',
              textTransform: 'uppercase',
              padding: '.6rem 1rem',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--muted)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Change
          </button>
        )}
      </div>

      {open && (
        <div style={{
          marginTop: '.75rem',
          padding: '1rem',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '.65rem',
        }}>
          <input
            type="password"
            placeholder="Current password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                save();
              }
            }}
            className={styles.input}
            autoComplete="current-password"
          />
          <input
            type="password"
            placeholder="New password (min 8 chars)"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                save();
              }
            }}
            className={styles.input}
            autoComplete="new-password"
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                save();
              }
            }}
            className={styles.input}
            autoComplete="new-password"
          />
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={(e) => save(e)}
              disabled={busy}
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '.62rem',
                letterSpacing: '.07em',
                textTransform: 'uppercase',
                padding: '.55rem 1rem',
                borderRadius: '6px',
                border: '1px solid var(--neon)',
                background: 'var(--neon-dim)',
                color: 'var(--neon)',
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.5 : 1,
              }}
            >
              {busy ? 'Saving…' : 'Update Password'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setCurrentPw(''); setNewPw(''); setConfirmPw('');
                setFeedback(null);
              }}
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '.62rem',
                letterSpacing: '.07em',
                textTransform: 'uppercase',
                padding: '.55rem 1rem',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--muted)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            {feedback && (
              <span style={{
                fontSize: '.78rem',
                color: feedback.ok ? 'var(--success)' : 'var(--error)',
              }}>
                {feedback.msg}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
