'use client';

// RiderEditor — the labeled-field rider editor (CUSTOM mode). Each field is a
// { label, value } pair — the requirement and its spec — grouped into
// Technical / Hospitality / Additional. Add / edit / remove / reorder within a
// section. Purely controlled: it owns no persistence, just items + onChange.
//
// Layout: clean two-column rows (requirement | details) that wrap to stacked
// on narrow screens, with quiet reorder/remove controls — no heavy per-field
// boxes.

import { RIDER_SECTIONS, type RiderItem, type RiderSection, newRiderId } from '@/lib/rider';

const NEON = 'var(--neon,#00e0a4)';
const MUTED = 'var(--muted,#8a8aa0)';
const BORDER = '1px solid var(--border, rgba(255,255,255,.14))';

const VALUE_PLACEHOLDER: Record<RiderSection, string> = {
  technical: 'Details / spec (optional)',
  hospitality: 'Details (optional)',
  custom: 'Details (optional)',
};

export default function RiderEditor({
  items,
  onChange,
  sections,
}: {
  items: RiderItem[];
  onChange: (next: RiderItem[]) => void;
  /** Limit which sections are shown/editable (default: all). */
  sections?: RiderSection[];
}) {
  const shownSections = RIDER_SECTIONS.filter((s) => !sections || sections.includes(s.key));

  function patch(id: string, p: Partial<RiderItem>) {
    onChange(items.map((i) => (i.id === id ? { ...i, ...p } : i)));
  }
  function remove(id: string) {
    onChange(items.filter((i) => i.id !== id));
  }
  function add(section: RiderSection) {
    onChange([...items, { id: newRiderId(), section, label: '', value: '' }]);
  }
  function move(id: string, dir: -1 | 1) {
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const sec = items[idx].section;
    let j = idx + dir;
    while (j >= 0 && j < items.length && items[j].section !== sec) j += dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  }

  const input: React.CSSProperties = {
    minWidth: 0,
    background: 'var(--panel-2, rgba(255,255,255,.04))',
    border: BORDER,
    borderRadius: 8,
    color: 'var(--white,#fff)',
    padding: '.55rem .7rem',
    fontSize: '.9rem',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.6rem' }}>
      {shownSections.map(({ key, label }) => {
        const rows = items.filter((i) => i.section === key);
        return (
          <section key={key}>
            {/* Section header with a hairline rule */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '.7rem', marginBottom: '.8rem' }}>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '.72rem', letterSpacing: '.1em', textTransform: 'uppercase', color: NEON, whiteSpace: 'nowrap' }}>
                {label}
              </span>
              <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.1)' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
              {rows.length === 0 && (
                <div style={{ color: MUTED, fontSize: '.82rem', fontStyle: 'italic' }}>
                  Nothing here yet — add a field below.
                </div>
              )}
              {rows.map((it, i) => (
                <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    value={it.label}
                    onChange={(e) => patch(it.id, { label: e.target.value })}
                    placeholder="Requirement"
                    maxLength={80}
                    style={{ ...input, flex: '1 1 170px', fontWeight: 600 }}
                  />
                  <input
                    type="text"
                    value={it.value}
                    onChange={(e) => patch(it.id, { value: e.target.value })}
                    placeholder={VALUE_PLACEHOLDER[key]}
                    maxLength={200}
                    style={{ ...input, flex: '2 1 220px' }}
                  />
                  <div style={{ display: 'flex', gap: '.25rem', flexShrink: 0 }}>
                    <button type="button" onClick={() => move(it.id, -1)} disabled={i === 0} aria-label="Move up" title="Move up" style={ctl(MUTED, i === 0)}>↑</button>
                    <button type="button" onClick={() => move(it.id, 1)} disabled={i === rows.length - 1} aria-label="Move down" title="Move down" style={ctl(MUTED, i === rows.length - 1)}>↓</button>
                    <button type="button" onClick={() => remove(it.id)} aria-label="Remove" title="Remove" style={ctl('#ff6b6b', false)}>✕</button>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => add(key)}
              style={{ marginTop: '.7rem', background: 'transparent', border: 'none', color: NEON, padding: '.2rem 0', fontSize: '.85rem', fontWeight: 700, cursor: 'pointer' }}
            >
              + Add field
            </button>
          </section>
        );
      })}
    </div>
  );
}

function ctl(color: string, disabled: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    border: BORDER,
    borderRadius: 6,
    color,
    width: 30,
    height: 34,
    flexShrink: 0,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.35 : 1,
    fontSize: '.8rem',
    lineHeight: 1,
  };
}
