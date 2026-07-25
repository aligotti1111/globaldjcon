'use client';

// RiderEditor — the planner-style labeled-field rider editor. Used wherever a
// CUSTOM-mode rider is built: the Booking Settings default builder and the
// per-booking editor. Each field is a { label, value } pair (a prompt + the
// answer), grouped into Technical / Hospitality / Additional. Add / edit /
// remove / reorder fields within a section. Purely controlled — it owns no
// persistence, just items + onChange.
//
// Mirrors the planner editor's labeled-field feel: a small mono section
// header, then rows where the DJ names the requirement (label) and states the
// spec (value), the way the planner shows a question label above its control.

import { RIDER_SECTIONS, type RiderItem, type RiderSection, newRiderId } from '@/lib/rider';

const LABEL_PLACEHOLDER: Record<RiderSection, string> = {
  technical: 'Requirement (e.g. Media players)',
  hospitality: 'Requirement (e.g. Water)',
  custom: 'Requirement (e.g. Green room)',
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

  const muted = 'var(--muted,#8a8aa0)';
  const border = '1px solid var(--border, rgba(255,255,255,.14))';
  const inputStyle: React.CSSProperties = {
    minWidth: 0,
    background: 'var(--panel-2, rgba(255,255,255,.04))',
    border,
    borderRadius: 8,
    color: 'var(--white,#fff)',
    padding: '.5rem .6rem',
    fontSize: '.9rem',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      {shownSections.map(({ key, label }) => {
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
              {rows.length === 0 && (
                <div style={{ color: muted, fontSize: '.82rem', fontStyle: 'italic' }}>
                  No {label.toLowerCase()} fields yet.
                </div>
              )}
              {rows.map((it) => (
                <div
                  key={it.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '.4rem',
                    border,
                    borderRadius: 10,
                    padding: '.5rem',
                    background: 'rgba(255,255,255,.02)',
                  }}
                >
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '.4rem', minWidth: 0 }}>
                    <input
                      type="text"
                      value={it.label}
                      onChange={(e) => patch(it.id, { label: e.target.value })}
                      placeholder={LABEL_PLACEHOLDER[key]}
                      maxLength={80}
                      style={{ ...inputStyle, fontWeight: 700 }}
                    />
                    <input
                      type="text"
                      value={it.value}
                      onChange={(e) => patch(it.id, { value: e.target.value })}
                      placeholder="Details / spec (e.g. 2× Pioneer CDJ-3000)"
                      maxLength={200}
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem', flexShrink: 0 }}>
                    <button type="button" onClick={() => move(it.id, -1)} aria-label="Move up" title="Move up" style={btn(muted)}>↑</button>
                    <button type="button" onClick={() => move(it.id, 1)} aria-label="Move down" title="Move down" style={btn(muted)}>↓</button>
                    <button type="button" onClick={() => remove(it.id)} aria-label="Remove" title="Remove" style={btn('#ff6b6b')}>✕</button>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => add(key)}
              style={{
                marginTop: '.6rem',
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
              + Add {label.toLowerCase()} field
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
    width: 28,
    height: 26,
    flexShrink: 0,
    cursor: 'pointer',
    fontSize: '.8rem',
    lineHeight: 1,
  };
}
