'use client';

// NotesFeed — threaded notes attached to a single booking, shared between
// the DJ and the host/venue. Each note shows author name + timestamp.
// Authors can edit or delete their own notes; others' notes are read-only.
//
// Reads + writes go directly through the supabase client — RLS on the
// booking_notes table enforces access (parent booking's dj_id or
// requester_id must equal auth.uid()).
//
// Used inside the expanded booking card on /upcoming-events,
// /upcoming-bookings, and /booking-requests.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './notesFeed.module.css';

interface NoteRow {
  id: string;
  booking_id: string;
  author_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

interface NoteWithAuthor extends NoteRow {
  authorName: string;
}

interface Props {
  bookingId: string;
  currentUserId: string;
}

export default function NotesFeed({ bookingId, currentUserId }: Props) {
  const [notes, setNotes] = useState<NoteWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  async function load() {
    setError(null);
    try {
      const supabase = createClient();
      const { data: rows, error: e } = await supabase
        .from('booking_notes')
        .select('id, booking_id, author_id, content, created_at, updated_at')
        .eq('booking_id', bookingId)
        .order('created_at', { ascending: true });
      if (e) throw e;
      const list = (rows || []) as NoteRow[];
      // Look up author names in one query.
      const authorIds = Array.from(new Set(list.map((n) => n.author_id)));
      let nameById: Record<string, string> = {};
      if (authorIds.length > 0) {
        const { data: people } = await supabase
          .from('users')
          .select('id, name')
          .in('id', authorIds);
        nameById = (people || []).reduce(
          (acc: Record<string, string>, row: { id: string; name: string | null }) => {
            acc[row.id] = row.name || 'Unknown';
            return acc;
          },
          {},
        );
      }
      setNotes(list.map((n) => ({ ...n, authorName: nameById[n.author_id] || 'Unknown' })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notes');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: insErr } = await supabase
        .from('booking_notes')
        .insert({
          booking_id: bookingId,
          author_id: currentUserId,
          content,
        } as unknown as never);
      if (insErr) throw insErr;
      setDraft('');
      await load();
      // Best-effort notification email to the OTHER party. Fire-and-forget;
      // failure here shouldn't block the UI from showing the new note.
      fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'booking_activity',
          bookingId,
          actorId: currentUserId,
          activity: 'note',
        }),
      }).catch((e) => console.warn('[NotesFeed] activity email failed', e));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post note');
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(n: NoteWithAuthor) {
    setEditingId(n.id);
    setEditDraft(n.content);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditDraft('');
  }

  async function saveEdit(id: string) {
    const content = editDraft.trim();
    if (!content) return;
    setError(null);
    try {
      const supabase = createClient();
      const { error: updErr } = await supabase
        .from('booking_notes')
        .update({ content } as unknown as never)
        .eq('id', id)
        .eq('author_id', currentUserId);
      if (updErr) throw updErr;
      setEditingId(null);
      setEditDraft('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update note');
    }
  }

  async function deleteNote(id: string) {
    if (!confirm('Delete this note?')) return;
    setError(null);
    try {
      const supabase = createClient();
      const { error: delErr } = await supabase
        .from('booking_notes')
        .delete()
        .eq('id', id)
        .eq('author_id', currentUserId);
      if (delErr) throw delErr;
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete note');
    }
  }

  return (
    <div className={styles.feed}>
      <div className={styles.feedHeader}>Notes About Event</div>

      {loading && <div className={styles.empty}>Loading notes…</div>}

      {!loading && notes.length > 0 && (
        <div className={styles.noteList}>
          {notes.map((n) => {
            const isMine = n.author_id === currentUserId;
            const edited = n.updated_at && n.updated_at !== n.created_at;
            return (
              <div key={n.id} className={styles.note}>
                <div className={styles.noteHeader}>
                  <span className={styles.noteAuthor}>{n.authorName}</span>
                  <span className={styles.noteDate}>
                    {formatDateTime(n.created_at)}
                    {edited && <span className={styles.editedTag}> (edited)</span>}
                  </span>
                </div>
                {editingId === n.id ? (
                  <div className={styles.editBlock}>
                    <textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      className={styles.editTextarea}
                      rows={2}
                      maxLength={2000}
                    />
                    <div className={styles.editActions}>
                      <button type="button" className={styles.btnGhost} onClick={cancelEdit}>
                        Cancel
                      </button>
                      <button type="button" className={styles.btnPrimary} onClick={() => saveEdit(n.id)}>
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className={styles.noteContent}>{n.content}</div>
                    {isMine && (
                      <div className={styles.noteActions}>
                        <button type="button" className={styles.noteAction} onClick={() => startEdit(n)}>
                          Edit
                        </button>
                        <button type="button" className={styles.noteActionDanger} onClick={() => deleteNote(n.id)}>
                          Delete
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <form onSubmit={handleSubmit} className={styles.composer}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add note about event…"
          className={styles.composerInput}
          maxLength={2000}
          disabled={submitting}
        />
        <button
          type="submit"
          className={styles.postBtn}
          disabled={submitting || !draft.trim()}
        >
          {submitting ? 'Posting…' : 'Post'}
        </button>
      </form>

      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}
