'use client';

// The visual planner editor.
//
// NOT a list of settings. It renders the ACTUAL client form — the real labels,
// the real controls, empty — and the DJ rearranges the page itself. A checklist
// with up/down arrows made you imagine the result; this IS the result, with a
// grip on the side of every question.
//
// Each question shows:
//   · a drag handle (desktop) + up/down arrows (touch — drag fights scroll)
//   · the real control it will show the client, disabled and empty, so the
//     page reads exactly as they'll see it
//   · hide/show and, for the DJ's own additions, delete
//   · a click-to-rename label
//
// The data rules from lib/planner still hold and the SERVER still enforces them
// — this is the friendly front of the same constrained edit:
//   · a stock question HIDES, never deletes (responses are keyed by field id).
//   · only a custom field the DJ added can be removed.
//   · types are shown, never changed (a live field's answers are stored in the
//     old type's shape).
//   · Guest of honour / Do NOT play / Notes are draggable here, but the server
//     re-pins them (first / last) on save — so the DJ sees a lock, not a fight.

import { useState } from 'react';
import type { PlannerField, PlannerFieldType } from '@/lib/planner';
import { NOTES_FIELD_ID, DO_NOT_PLAY_FIELD_ID, HONOREE_FIELD_ID } from '@/lib/planner';
import styles from './plannerBuilder.module.css';

const ADDABLE: { type: PlannerFieldType; label: string }[] = [
  { type: 'text', label: 'Short text' },
  { type: 'longtext', label: 'Paragraph' },
  { type: 'time', label: 'Time' },
  { type: 'song', label: 'One song' },
  { type: 'songlist', label: 'Song list' },
  { type: 'textlist', label: 'Text list' },
  { type: 'people', label: 'People' },
  { type: 'yesno', label: 'Yes / no' },
];

/** The pinned three — locked in position by the server, so shown with a lock. */
const isPinned = (id: string) =>
  id === HONOREE_FIELD_ID || id === DO_NOT_PLAY_FIELD_ID || id === NOTES_FIELD_ID;

export default function PlannerBuilder({
  fields, eventType,
  onPatch, onMoveTo, onRemove, onAdd,
}: {
  fields: PlannerField[];
  eventType: string | null;
  onPatch: (id: string, p: Partial<PlannerField>) => void;
  onMoveTo: (from: number, to: number) => void;
  onRemove: (id: string) => void;
  onAdd: (type: PlannerFieldType) => void;
}) {
  // The row being dragged, and the row it's hovering over — for the drop line.
  const [dragI, setDragI] = useState<number | null>(null);
  const [overI, setOverI] = useState<number | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  function drop(to: number) {
    if (dragI !== null && dragI !== to) onMoveTo(dragI, to);
    setDragI(null);
    setOverI(null);
  }

  return (
    <div className={styles.wrap}>
      {/* The page's own header, faint — so the DJ is looking at the client's
          actual page, chrome and all, not a bare list floating in a modal. */}
      <div className={styles.pageHead}>
        <div className={styles.brand}>Global DJ Connect</div>
        <div className={styles.pageTitle}>Planner &amp; Playlist</div>
        <div className={styles.pageSub}>This is exactly what your client sees. Drag to reorder, click a question to rename.</div>
      </div>

      <div className={styles.list}>
        {fields.map((f, i) => {
          const pinned = isPinned(f.id);
          const dragging = dragI === i;
          const over = overI === i && dragI !== null && dragI !== i;
          return (
            <div
              key={f.id}
              className={[
                styles.field,
                f.hidden ? styles.hidden : '',
                dragging ? styles.dragging : '',
                over ? styles.over : '',
              ].join(' ')}
              // Whole row is draggable via the handle only (draggable set on the
              // handle would still need the row to carry the events).
              onDragOver={(e) => { e.preventDefault(); setOverI(i); }}
              onDrop={(e) => { e.preventDefault(); drop(i); }}
            >
              <div className={styles.rail}>
                <span
                  className={styles.grip}
                  // Desktop drag. Touch users get the arrows below instead.
                  draggable={!pinned}
                  onDragStart={() => setDragI(i)}
                  onDragEnd={() => { setDragI(null); setOverI(null); }}
                  aria-hidden="true"
                >⠿</span>
                <div className={styles.arrows}>
                  <button type="button" className={styles.arrow}
                    aria-label="Move up" disabled={pinned || i === 0}
                    onClick={() => onMoveTo(i, i - 1)}>↑</button>
                  <button type="button" className={styles.arrow}
                    aria-label="Move down" disabled={pinned || i === fields.length - 1}
                    onClick={() => onMoveTo(i, i + 1)}>↓</button>
                </div>
              </div>

              <div className={styles.body}>
                <div className={styles.labelRow}>
                  {editing === f.id ? (
                    <input
                      className={styles.labelEdit}
                      autoFocus
                      value={f.label}
                      onChange={(e) => onPatch(f.id, { label: e.target.value })}
                      onBlur={() => setEditing(null)}
                      onKeyDown={(e) => { if (e.key === 'Enter') setEditing(null); }}
                    />
                  ) : (
                    <button
                      type="button"
                      className={styles.label}
                      onClick={() => setEditing(f.id)}
                      title="Click to rename"
                    >
                      {f.label || 'Untitled question'}
                      {f.required ? <span className={styles.req}>required</span> : null}
                      {f.is_custom ? <span className={styles.mine}>yours</span> : null}
                    </button>
                  )}

                  <div className={styles.acts}>
                    {pinned ? (
                      <span className={styles.lock} title="Stays in place — locked position">🔒</span>
                    ) : null}
                    <button
                      type="button"
                      className={styles.act}
                      title={f.hidden ? 'Turn on — client will see this' : 'Turn off — hide from the client'}
                      onClick={() => onPatch(f.id, { hidden: !f.hidden })}
                    >{f.hidden ? '🙈' : '👁'}</button>
                    {f.is_custom ? (
                      <button
                        type="button"
                        className={styles.act}
                        title="Delete this question"
                        onClick={() => onRemove(f.id)}
                      >🗑</button>
                    ) : null}
                  </div>
                </div>

                {f.help ? <div className={styles.help}>{f.help}</div> : null}

                {/* The real control, empty and disabled — the whole point. */}
                <FieldPreview field={f} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Add a question — the same dashed "+ Add another" the client sees on a
          list field, so it reads as part of the page. */}
      <div className={styles.addWrap}>
        {addOpen ? (
          <div className={styles.addMenu}>
            {ADDABLE.map((a) => (
              <button
                key={a.type}
                type="button"
                className={styles.addPick}
                onClick={() => { onAdd(a.type); setAddOpen(false); }}
              >{a.label}</button>
            ))}
            <button type="button" className={styles.addCancel} onClick={() => setAddOpen(false)}>Cancel</button>
          </div>
        ) : (
          <button type="button" className={styles.addBtn} onClick={() => setAddOpen(true)}>
            + Add a question
          </button>
        )}
      </div>

      <p className={styles.foot}>
        Saves to <strong>your {eventType || 'default'} planner</strong> — every {eventType || 'booking'} after
        this uses it, with no clicks. Turned-off questions are kept, not deleted.
      </p>
    </div>
  );
}

/**
 * The client's control, rendered EMPTY and DISABLED.
 *
 * Deliberately a separate, dumb mirror of the client's `Control` rather than a
 * shared component: the client's is interactive, saves, searches Deezer, plays
 * previews. None of that belongs in a preview, and importing it would drag all
 * of it in. This shows the SHAPE — a text line, a time dropdown, a song box, a
 * people grid — which is all the DJ needs to grasp the page.
 */
function FieldPreview({ field }: { field: PlannerField }) {
  switch (field.type) {
    case 'longtext':
      return <div className={`${styles.pv} ${styles.pvArea}`} />;
    case 'time':
    case 'select':
      return <div className={`${styles.pv} ${styles.pvSelect}`}><span>{field.type === 'time' ? 'Select a time…' : 'Select…'}</span></div>;
    case 'yesno':
      return (
        <div className={styles.pvYesno}>
          <span className={styles.pvToggle}>Yes</span>
          <span className={styles.pvToggle}>No</span>
        </div>
      );
    case 'song':
      return <div className={`${styles.pv} ${styles.pvSong}`}><span>♪ Search a song, or type it</span></div>;
    case 'songlist':
      return (
        <div className={styles.pvStack}>
          <div className={`${styles.pv} ${styles.pvSong}`}><span>♪ Search a song, or type it</span></div>
          <span className={styles.pvAdd}>+ Add another</span>
        </div>
      );
    case 'textlist':
      return (
        <div className={styles.pvStack}>
          <div className={styles.pv} />
          <span className={styles.pvAdd}>+ Add another</span>
        </div>
      );
    case 'people':
      return (
        <div className={styles.pvStack}>
          <div className={styles.pvPeople}>
            <span>Name</span><span>Role</span><span>Say it like</span>
          </div>
          <span className={styles.pvAdd}>+ Add another</span>
        </div>
      );
    case 'timeline':
      return (
        <div className={styles.pvStack}>
          <div className={styles.pvTimeline}>
            <span className={styles.pvTimeCell}>Time…</span>
            <div className={styles.pv} style={{ flex: 1 }} />
          </div>
          <span className={styles.pvAdd}>+ Add another</span>
        </div>
      );
    case 'link':
      return <div className={styles.pv}><span className={styles.pvPh}>https://…</span></div>;
    default:
      return <div className={styles.pv} />;
  }
}
