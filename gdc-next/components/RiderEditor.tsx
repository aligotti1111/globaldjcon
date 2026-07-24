'use client';

// RiderEditor — the customizable DJ-rider list. Used in two places with the
// same shape: the Booking Settings default builder, and the per-booking editor
// on the booking card. Add / edit / remove / reorder lines within Technical and
// Hospitality. Purely controlled: it owns no persistence, just items + onChange.

import { RIDER_SECTIONS, type RiderItem, type RiderSection, newRiderId } from '@/lib/rider';

export default function RiderEditor({
  items,
  onChange,
}: {
  items: RiderItem[];
  onChange: (next: RiderItem[]) => void;
}) {
  function update(id: string, text: string) {
    onChange(items.map((i) => (i.id === id ? { ...i, text } : i)));
  }
  function remove(id: string) {
    onChange(items.filter((i) => i.id !== id));
  }
  function add(section: RiderSection) {
    onChange([...items, { id: newRiderId(), section, text: '' }]);
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

  const muted = 'var(--muted,#8a8aa0)';
  const border = '1px solid var(--border, rgba(255,255,255,.14))';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      {RIDER_SECTIONS.map(({ key, label }) => {
        const rows = items.filter((i) => i.section === key);
        return (
          <div key={key}>
            <div
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: '.7rem',
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: muted,
                marginBottom: '.5rem',
              }}
            >
              {label}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
              {rows.length === 0 && (
                <div style={{ color: muted, fontSize: '.82rem', fontStyle: 'italic' }}>
                  No {label.toLowerCase()} items yet.
                </div>
              )}
              {rows.map((it) => (
                <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                  <input
                    type="text"
                    value={it.text}
                    onChange={(e) => update(it.id, e.target.value)}
                    placeholder={`Add a ${label.toLowerCase()} requirement…`}
                    maxLength={160}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      background: 'var(--panel-2, rgba(255,255,255,.04))',
                      border,
                      borderRadius: 8,
                      color: 'var(--white,#fff)',
                      padding: '.55rem .65rem',
                      fontSize: '.9rem',
                    }}
                  />
                  <button type="button" onClick={() => move(it.id, -1)} aria-label="Move up" title="Move up"
                    style={btn(muted)}>↑</button>
                  <button type="button" onClick={() => move(it.id, 1)} aria-label="Move down" title="Move down"
                    style={btn(muted)}>↓</button>
                  <button type="button" onClick={() => remove(it.id)} aria-label="Remove" title="Remove"
                    style={btn('#ff6b6b')}>✕</button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => add(key)}
              style={{
                marginTop: '.5rem',
                background: 'transparent',
                border: '1px dashed var(--border, rgba(255,255,255,.28))',
                borderRadius: 8,
                color: 'var(--neon,#00e0a4)',
                padding: '.4rem .7rem',
                fontSize: '.82rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              + Add {label.toLowerCase()} item
            </button>
          </div>
        );
      })}
    </div>
  );
}

function btn(color: string): React.CSSProperties {
  return {
    background: 'transparent',
    border: '1px solid var(--border, rgba(255,255,255,.18))',
    borderRadius: 6,
    color,
    width: 30,
    height: 30,
    flexShrink: 0,
    cursor: 'pointer',
    fontSize: '.85rem',
    lineHeight: 1,
  };
}
