'use client';

// Owner/editor view toggle — a compact pill that names the current mode and
// switches to a live "public view" preview (all edit chrome hidden). Two fixed
// segments; the highlight moves to the active one. Gating by baseCanEdit stays
// at the call site. Session-only: a reload returns to owner view.
export function OwnerViewToggle({ previewPublic, onChange }: {
  previewPublic: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Preview mode"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 2,
        background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.14)',
        borderRadius: 999, padding: 2,
      }}
    >
      {([
        { on: false, label: 'Owner view' },
        { on: true, label: 'Public view' },
      ] as const).map((seg) => {
        const active = previewPublic === seg.on;
        return (
          <button
            key={seg.label}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(seg.on)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: active ? 'var(--neon,#00e0a4)' : 'transparent',
              color: active ? '#06231b' : 'rgba(255,255,255,.7)',
              border: 'none', borderRadius: 999, padding: '.28rem .7rem',
              fontSize: '.62rem', fontWeight: 700, letterSpacing: '.03em',
              textTransform: 'uppercase', cursor: active ? 'default' : 'pointer', whiteSpace: 'nowrap',
              transition: 'background .12s, color .12s',
            }}
          >
            {seg.on ? null : <span style={{ width: 6, height: 6, borderRadius: '50%', background: active ? '#06231b' : 'var(--neon,#00e0a4)' }} />}
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}
