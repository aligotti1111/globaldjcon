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

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { PlannerField, PlannerFieldType } from '@/lib/planner';
import { NOTES_FIELD_ID, DO_NOT_PLAY_FIELD_ID, HONOREE_FIELD_ID, titleCaseLabel } from '@/lib/planner';
import styles from './plannerBuilder.module.css';

// The booking facts that are never planner fields — they come straight off the
// booking row. Same set the client's page shows in its "Your booking" strip.
// The sample values are illustrative — there's no client while you arrange a
// template — so the strip reads like a real filled page instead of eight
// repeated "filled from the booking" lines.
const BOOKING_FACTS: { label: string; sample: string }[] = [
  { label: 'Event', sample: 'Birthday Party' },
  { label: 'Date', sample: 'Sat, Aug 15, 2026' },
  { label: 'Start time', sample: '6:00 PM' },
  { label: 'End time', sample: '11:00 PM' },
  { label: 'Venue', sample: 'The Grand Ballroom' },
  { label: 'Guests', sample: '150' },
  { label: 'Booked by', sample: 'Jordan Ellis' },
  { label: 'Your number', sample: '(555) 012-3456' },
];

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
  onPatch, onReorder, onRemove, onAdd,
}: {
  fields: PlannerField[];
  eventType: string | null;
  onPatch: (id: string, p: Partial<PlannerField>) => void;
  // Takes the WHOLE reordered array — the builder rebuilds it so the modal
  // stays dumb about which fields are hidden from the editor.
  onReorder: (next: PlannerField[]) => void;
  onRemove: (id: string) => void;
  onAdd: (type: PlannerFieldType) => void;
}) {
  // The row being dragged, and the row it's hovering over — for the drop line.
  const [dragI, setDragI] = useState<number | null>(null);
  const [overI, setOverI] = useState<number | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // The DJ's business logo — the SAME one on the client's planner (top) and the
  // contract, read straight from their profile (users.contract_logo_url). Shown
  // here so the editor previews the real branded page. If they haven't set one,
  // an "Add your logo" button sends them to Account settings, where setting it
  // makes it appear here, on the planner, and on contracts at once.
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from('users')
          .select('contract_logo_url')
          .eq('id', user.id)
          .maybeSingle();
        if (active) setLogoUrl((data as { contract_logo_url?: string | null } | null)?.contract_logo_url || null);
      } catch { /* logo is optional — never block the editor */ }
    })();
    return () => { active = false; };
  }, []);

  // PREFILLED FIELDS ARE NOT QUESTIONS. Setup time, music start/end, cocktail
  // start — the client sees these as read-only facts in the "Your booking"
  // strip, filled from the booking. They are not things the DJ curates, so they
  // don't belong in this editor at all.
  //
  // But they must survive the save: dropping them from the array would delete
  // them from the template. So they're ANCHORED — hidden from view, held at
  // their exact index — and the editable questions reorder around them.
  const anchored = (f: PlannerField) => !!f.prefill;
  const editable = fields.filter((f) => !anchored(f));
  const shownAtTop = fields.filter(anchored);

  // Reorder the editable subsequence, leave anchored fields pinned to their
  // absolute slots, hand the whole thing back.
  function reorderEditable(fromE: number, toE: number) {
    if (fromE === toE || fromE < 0 || toE < 0 || fromE >= editable.length || toE >= editable.length) return;
    const moved = [...editable];
    const [row] = moved.splice(fromE, 1);
    moved.splice(toE, 0, row);
    let k = 0;
    onReorder(fields.map((f) => (anchored(f) ? f : moved[k++])));
  }

  return (
    <div className={styles.wrap}>
      {/* The DJ's logo at the very top — exactly where the client sees it. If
          they haven't set one, a prompt to add it (opens Account settings). */}
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="Your logo" className={styles.logo} />
      ) : (
        <button
          type="button"
          className={styles.addLogo}
          onClick={() => window.open('/account-settings', '_blank')}
          title="Add your business logo — shows here, on the planner, and on contracts"
        >
          + Add your logo
        </button>
      )}

      {/* The page's own header, faint — so the DJ is looking at the client's
          actual page, chrome and all, not a bare list floating in a modal. */}
      <div className={styles.pageHead}>
        <div className={styles.brand}>Global DJ Connect</div>
        <div className={styles.pageTitle}>Planner &amp; Playlist</div>
        <div className={styles.pageSub}>This is exactly what your client sees. Drag to reorder, click a question to rename.</div>
      </div>

      {/* YOUR BOOKING — the read-only strip the client sees at the top, filled
          from the booking. Not questions, not draggable. Shown here so the DJ
          arranges the WHOLE page, not just the middle of it. The values are
          illustrative (there's no client yet) — the point is the layout. */}
      <div className={styles.known}>
        <div className={styles.knownHead}>Your booking · example</div>
        {BOOKING_FACTS.map((f) => (
          <div key={f.label} className={styles.knownRow}>
            <span className={styles.knownK}>{f.label}</span>
            <span className={styles.knownV}>{f.sample}</span>
          </div>
        ))}
        {shownAtTop.map((f) => (
          <div key={f.id} className={styles.knownRow}>
            <span className={styles.knownK}>{titleCaseLabel(f.label)}</span>
            <span className={styles.knownV}>—</span>
          </div>
        ))}
        <p className={styles.knownNote}>
          Sample values shown. On a real planner these are filled from the booking and
          contract — the client sees them read-only at the top, never asked.
        </p>
      </div>

      <div className={styles.list}>
        {editable.map((f, i) => {
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
              onDrop={(e) => { e.preventDefault(); if (dragI !== null && dragI !== i) reorderEditable(dragI, i); setDragI(null); setOverI(null); }}
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
                    onClick={() => reorderEditable(i, i - 1)}>↑</button>
                  <button type="button" className={styles.arrow}
                    aria-label="Move down" disabled={pinned || i === editable.length - 1}
                    onClick={() => reorderEditable(i, i + 1)}>↓</button>
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
                      {f.label ? titleCaseLabel(f.label) : 'Untitled question'}
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
                      className={styles.toggle}
                      title={f.hidden ? 'Turn on — client will see this' : 'Turn off — hide from the client'}
                      onClick={() => onPatch(f.id, { hidden: !f.hidden })}
                    >{f.hidden ? 'Enable' : 'Disable'}</button>
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

                {/* Disabled = collapsed. A turned-off question is just its name
                    and the eye to switch it back on — no help, no preview box.
                    The box only earns its space when the client will actually
                    see the field. */}
                {!f.hidden && f.help ? <div className={styles.help}>{f.help}</div> : null}
                {!f.hidden ? <FieldPreview field={f} /> : null}
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
