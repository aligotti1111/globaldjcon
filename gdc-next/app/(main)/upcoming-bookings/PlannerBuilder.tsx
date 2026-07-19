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
//   · a pencil (and click-to-rename) on the label
//   · an Enable / Disable text toggle, and (for the DJ's own additions) delete
//
// The DJ's business logo sits at the very top — the same one shown on the
// client's planner and the contract. Uploading here writes users.contract_logo_url
// via /api/dj/logo, exactly like the account-settings uploader, so it updates
// everywhere at once. Removing offers a choice: everywhere, or just this client.
//
// The data rules from lib/planner still hold and the SERVER still enforces them
// — this is the friendly front of the same constrained edit:
//   · a stock question is DISABLED, never deleted (responses are keyed by id).
//   · only a custom field the DJ added can be removed.
//   · types are shown, never changed (a live field's answers are stored in the
//     old type's shape).
//   · Guest of honour / Do NOT play / Notes are draggable here, but the server
//     re-pins them (first / last) on save — so the DJ sees a lock, not a fight.

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { PlannerField, PlannerFieldType } from '@/lib/planner';
import { NOTES_FIELD_ID, DO_NOT_PLAY_FIELD_ID, HONOREE_FIELD_ID } from '@/lib/planner';
import { createClient } from '@/lib/supabase/client';
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
  fields, eventType, bookingId,
  onPatch, onReorder, onRemove, onAdd,
}: {
  fields: PlannerField[];
  eventType: string | null;
  // The booking this editor was opened from. Used for the per-client logo hide.
  bookingId?: string | null;
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

  // ── The DJ's business logo ────────────────────────────────────────────────
  // Same shared field (users.contract_logo_url) and same upload path as the
  // account-settings uploader — so setting it here shows it everywhere.
  const [userId, setUserId] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoMsg, setLogoMsg] = useState<string | null>(null);
  const [showRemove, setShowRemove] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !active) return;
        setUserId(user.id);
        const { data } = await supabase
          .from('users')
          .select('contract_logo_url')
          .eq('id', user.id)
          .maybeSingle();
        if (active) {
          setLogoUrl((data as { contract_logo_url?: string | null } | null)?.contract_logo_url || null);
        }
      } catch { /* logo is optional */ }
    })();
    return () => { active = false; };
  }, []);

  async function onPickLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    if (!file.type.startsWith('image/')) { setLogoMsg('Logo must be an image.'); return; }
    if (file.size > 4 * 1024 * 1024) { setLogoMsg('Logo is too large (max 4MB).'); return; }
    setLogoMsg(null);
    setLogoBusy(true);
    try {
      const supabase = createClient();
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${userId}/contract_logo_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = `${data.publicUrl}?t=${Date.now()}`;
      // 'set' also clears every per-booking hide, so a new logo shows everywhere.
      const res = await fetch('/api/dj/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'set', url }),
      });
      if (!res.ok) throw new Error('save failed');
      setLogoUrl(url);
      setShowRemove(false);
      setLogoMsg('✓ Logo saved — shows on your planners and contracts.');
    } catch {
      setLogoMsg('Logo upload failed — try again.');
    } finally {
      setLogoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // Remove everywhere — clears the shared field.
  async function removeEverywhere() {
    setLogoBusy(true);
    setLogoMsg(null);
    try {
      const res = await fetch('/api/dj/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'clear' }),
      });
      if (!res.ok) throw new Error('remove failed');
      setLogoUrl(null);
      setShowRemove(false);
      setLogoMsg('✓ Logo removed everywhere.');
    } catch {
      setLogoMsg('Could not remove — try again.');
    } finally {
      setLogoBusy(false);
    }
  }

  // Hide on THIS client's planner only — leaves the logo everywhere else.
  // Only works once the planner has been sent (there's a booking_planners row);
  // before that the API says so, and we surface it.
  async function hideThisPlanner() {
    if (!bookingId) { setLogoMsg('Open this from a booking to hide it for one client.'); return; }
    setLogoBusy(true);
    setLogoMsg(null);
    try {
      const res = await fetch('/api/dj/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'hide', bookingId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setLogoMsg(j?.error || 'Could not hide it here.'); setLogoBusy(false); return; }
      setShowRemove(false);
      setLogoMsg("✓ Hidden on this client's planner. It still shows everywhere else.");
    } catch {
      setLogoMsg('Could not hide it here — try again.');
    } finally {
      setLogoBusy(false);
    }
  }

  // PREFILLED FIELDS ARE NOT QUESTIONS. Setup time, music start/end, cocktail
  // start — the client sees these as read-only facts in the "Your booking"
  // strip, filled from the booking. They are not things the DJ curates, so they
  // don't belong in the editable list.
  //
  // But they must survive the save: dropping them from the array would delete
  // them from the template. So they're ANCHORED — held at their exact index —
  // and the editable questions reorder around them. They're shown, dimmed, in a
  // read-only "Your booking" strip so the DJ sees the whole page.
  const anchored = (f: PlannerField) => !!f.prefill;
  const editable = fields.filter((f) => !anchored(f));
  const anchoredFields = fields.filter(anchored);

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
      {/* The DJ's logo, at the top — where the client sees it. Click to replace. */}
      {logoUrl ? (
        <div className={styles.logoRow}>
          <button
            type="button"
            className={styles.logoBtn}
            disabled={logoBusy}
            onClick={() => fileRef.current?.click()}
            title="Replace your logo"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt="Your logo" className={styles.logo} />
          </button>
          <button
            type="button"
            className={styles.logoRemove}
            disabled={logoBusy}
            onClick={() => setShowRemove((v) => !v)}
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={styles.addLogo}
          disabled={logoBusy}
          onClick={() => fileRef.current?.click()}
        >
          {logoBusy ? 'Uploading…' : '+ Add your logo'}
        </button>
      )}

      {showRemove && (
        <div className={styles.logoChoice}>
          <span className={styles.logoChoiceQ}>Remove the logo…</span>
          <button type="button" className={styles.logoChoiceBtn} disabled={logoBusy} onClick={removeEverywhere}>
            Everywhere
          </button>
          <button type="button" className={styles.logoChoiceBtn} disabled={logoBusy} onClick={hideThisPlanner}>
            Just this client
          </button>
          <button type="button" className={styles.logoChoiceCancel} disabled={logoBusy} onClick={() => setShowRemove(false)}>
            Cancel
          </button>
        </div>
      )}
      {logoMsg && <div className={styles.logoMsg}>{logoMsg}</div>}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickLogo} />

      {/* The page's own header, faint — so the DJ is looking at the client's
          actual page, chrome and all, not a bare list floating in a modal. */}
      <div className={styles.pageHead}>
        <div className={styles.brand}>Global DJ Connect</div>
        <div className={styles.pageTitle}>Planner &amp; Playlist</div>
        <div className={styles.pageSub}>This is exactly what your client sees. Drag to reorder; tap the pencil (or the question) to rename it.</div>
      </div>

      {/* Your booking — the read-only facts, filled from the booking, so the DJ
          arranges the whole page and doesn't turn these into questions. */}
      {anchoredFields.length > 0 && (
        <div className={styles.known}>
          <div className={styles.knownHead}>Your booking</div>
          {anchoredFields.map((f) => (
            <div key={f.id} className={styles.knownRow}>
              <span className={styles.knownK}>{f.label}</span>
              <span className={styles.knownV}>filled in from the booking</span>
            </div>
          ))}
          <div className={styles.knownNote}>
            These are filled in for your client automatically — they don&rsquo;t appear as questions.
          </div>
        </div>
      )}

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
                      // eslint-disable-next-line jsx-a11y/no-autofocus
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
                      style={{ flex: '0 1 auto' }}
                      onClick={() => setEditing(f.id)}
                      title="Click to rename"
                    >
                      {f.label || 'Untitled question'}
                      {f.required ? <span className={styles.req}>required</span> : null}
                      {f.is_custom ? <span className={styles.mine}>yours</span> : null}
                    </button>
                  )}

                  {/* Pencil — right next to the title. Clicking the title works
                      too, but the pencil is the affordance a DJ looks for. */}
                  {editing !== f.id ? (
                    <button
                      type="button"
                      className={styles.act}
                      style={{ flexShrink: 0 }}
                      title="Edit this question's title"
                      aria-label={`Edit the title of "${f.label || 'this question'}"`}
                      onClick={() => setEditing(f.id)}
                    >✎</button>
                  ) : null}

                  <div className={styles.acts} style={{ marginLeft: 'auto' }}>
                    {pinned ? (
                      <span className={styles.lock} title="Stays in place — locked position">🔒</span>
                    ) : null}
                    {/* Enable / Disable — a text button, not an eye. A disabled
                        question keeps its answers but collapses to just its
                        title, so the page reads as the client will see it. */}
                    <button
                      type="button"
                      className={styles.toggle}
                      title={f.hidden ? 'Turn on — your client will see this' : 'Turn off — hide from your client'}
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

                {/* A disabled question collapses — no help, no control, just the
                    title above — so the DJ sees exactly what drops off the page. */}
                {!f.hidden && (
                  <>
                    {f.help ? <div className={styles.help}>{f.help}</div> : null}
                    {/* The real control, empty and disabled — the whole point. */}
                    <FieldPreview field={f} />
                  </>
                )}
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
