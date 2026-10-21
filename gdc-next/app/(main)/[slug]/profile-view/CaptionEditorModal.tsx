'use client';

// Owner-only modal to write/edit the caption shown at the bottom of a photo in
// the lightbox. Gated at the call site (captionFor && canEdit); all state and
// the save/close handlers stay in ProfileView.
export function CaptionEditorModal({ target, draft, busy, onDraftChange, onSave, onClose }: {
  target: string;
  draft: string;
  busy: boolean;
  onDraftChange: (text: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  // `target` is the URL being captioned — retained so the call site passes the
  // exact photo whose caption is being edited (used by the wired onSave).
  void target;
  return (
    <div onClick={() => onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2100, padding: '1rem' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#14141b', border: '1px solid rgba(255,255,255,.14)', borderRadius: 12, padding: '1.25rem', width: '100%', maxWidth: 420 }}>
        <div style={{ fontSize: '.95rem', fontWeight: 600, color: '#fff', marginBottom: '.75rem' }}>Photo caption</div>
        <textarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          maxLength={200}
          rows={3}
          autoFocus
          placeholder="Write a caption…"
          style={{ width: '100%', padding: '.6rem .8rem', borderRadius: 8, border: '1px solid rgba(255,255,255,.25)', background: '#0c0c11', color: '#fff', fontSize: '.9rem', resize: 'vertical', fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '.4rem' }}>
          <span style={{ fontSize: '.7rem', color: 'var(--muted,#888)' }}>{draft.length}/200</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', marginTop: '.9rem' }}>
          <button type="button" onClick={() => onClose()} style={{ padding: '.5rem 1rem', borderRadius: 8, border: '1px solid rgba(255,255,255,.25)', background: 'transparent', color: '#fff', fontSize: '.8rem', cursor: 'pointer' }}>Cancel</button>
          <button type="button" disabled={busy} onClick={() => onSave()} style={{ padding: '.5rem 1.1rem', borderRadius: 8, border: 'none', background: 'var(--neon)', color: '#04121a', fontWeight: 700, fontSize: '.8rem', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
