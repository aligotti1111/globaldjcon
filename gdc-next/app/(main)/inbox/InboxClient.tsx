'use client';

// InboxClient — list + filter + open + reply.
// Faithful port of vanilla inbox.html JS section (renderMessages, openMessage,
// sendReply, deleteMessage, setFilter).
//
// State:
//   - messages: top-level threads (parent_id null)
//   - replies: all replies for the visible threads
//   - filter: 'all' | 'unread' | 'read'
//   - openId: id of the currently expanded thread (one at a time)
//
// UI patterns matching vanilla:
//   - Cards collapse/expand on click; only one open at a time
//   - Reply box is open by default inside an expanded card
//   - Mark-as-read fires automatically when a thread opens
//   - "↑ Sent" / "↓ Received" indicator based on most recent message
//
// Note: we operate directly against Supabase from the client (RLS is
// permissive on this table — same as vanilla). All state mutations are
// optimistic; the DB write happens in parallel.

import { useState, useMemo, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './inbox.module.css';
import MessageThread from './MessageThread';
import { useConfirm } from '@/components/ConfirmModal';
import type { InboxMessage } from './page';

interface CurrentUser {
  id: string;
  name: string;
  email: string | null;
}

interface Props {
  currentUser: CurrentUser;
  initialMessages: InboxMessage[];
  initialReplies: InboxMessage[];
}

type Filter = 'all' | 'unread' | 'read';

export default function InboxClient({
  currentUser, initialMessages, initialReplies,
}: Props) {
  const [messages, setMessages] = useState<InboxMessage[]>(initialMessages);
  const [replies, setReplies] = useState<InboxMessage[]>(initialReplies);
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyStatus, setReplyStatus] = useState<Record<string, { text: string; ok: boolean }>>({});
  const [sending, setSending] = useState<Record<string, boolean>>({});
  // Site-uniform confirm dialog (replaces native window.confirm)
  const { confirm, confirmDialog } = useConfirm();

  // Resolve display names for everyone in these threads by user id. The message
  // rows only carry the SENDER's name (from_name), so a thread I started shows
  // no name for the recipient until they reply. We look the participants up once
  // so the card header can show the real person (host or DJ) right away.
  const [nameById, setNameById] = useState<Record<string, string>>({});
  useEffect(() => {
    const ids = new Set<string>();
    for (const m of [...messages, ...replies]) {
      if (m.from_user_id) ids.add(m.from_user_id);
      if (m.to_user_id) ids.add(m.to_user_id);
    }
    ids.delete(currentUser.id);
    const want = [...ids].filter((id) => !(id in nameById));
    if (!want.length) return;
    (async () => {
      try {
        const db = createClient();
        const { data } = await db.from('users').select('id, name').in('id', want);
        const rows = (data as { id: string; name?: string | null }[] | null) || [];
        if (rows.length) {
          setNameById((prev) => {
            const next = { ...prev };
            for (const r of rows) next[r.id] = r.name || '';
            return next;
          });
        }
      } catch { /* names stay as their fallbacks */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, replies]);

  // ── Helpers ────────────────────────────────────────────────────
  // A thread is "unread" if the parent is unread to current user OR any
  // reply in it is unread to current user. Self-sent messages don't count.
  function threadIsUnread(msg: InboxMessage): boolean {
    const parentUnread = !msg.read
      && msg.to_user_id === currentUser.id
      && msg.from_user_id !== currentUser.id;
    if (parentUnread) return true;
    return replies.some((r) =>
      r.parent_id === msg.id
      && !r.read
      && r.to_user_id === currentUser.id
      && r.from_user_id !== currentUser.id
    );
  }

  // ── Filtered list ──────────────────────────────────────────────
  const filteredMessages = useMemo(() => {
    if (filter === 'unread') return messages.filter(threadIsUnread);
    if (filter === 'read') {
      return messages.filter((m) => m.read || m.from_user_id === currentUser.id);
    }
    return messages;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, replies, filter, currentUser.id]);

  // Total unread count for subtitle
  const unreadCount = messages.filter(threadIsUnread).length;

  // ── Open a thread + mark read ──────────────────────────────────
  async function openThread(msg: InboxMessage) {
    // If the same thread is already open, collapse it (toggle behavior)
    if (openId === msg.id) {
      setOpenId(null);
      return;
    }
    setOpenId(msg.id);

    const supabase = createClient();

    // Mark parent as read locally + in DB if I'm the recipient and it was unread
    if (!msg.read && msg.to_user_id === currentUser.id && msg.from_user_id !== currentUser.id) {
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, read: true } : m))
      );
      // Don't await — fire and forget so the UI feels instant
      supabase
        .from('messages')
        .update({ read: true } as unknown as never)
        .eq('id', msg.id)
        .then(() => {
          // Tell the header badge to re-fetch its count (custom event,
          // listened to by useUnreadInboxCount).
          window.dispatchEvent(new CustomEvent('gdc:refresh-inbox-count'));
        });
    }

    // Mark all unread replies in this thread as read (only ones addressed
    // to current user). Same fire-and-forget approach.
    const unreadReplies = replies.filter(
      (r) => r.parent_id === msg.id
        && !r.read
        && r.to_user_id === currentUser.id
        && r.from_user_id !== currentUser.id
    );
    if (unreadReplies.length > 0) {
      setReplies((prev) =>
        prev.map((r) =>
          (r.parent_id === msg.id && r.to_user_id === currentUser.id && !r.read)
            ? { ...r, read: true }
            : r
        )
      );
      supabase
        .from('messages')
        .update({ read: true } as unknown as never)
        .eq('parent_id', msg.id)
        .eq('to_user_id', currentUser.id)
        .then(() => {
          window.dispatchEvent(new CustomEvent('gdc:refresh-inbox-count'));
        });
    }
  }

  // ── Send a reply ───────────────────────────────────────────────
  // Optimistic: drop the bubble into the thread + clear the textarea
  // before we even hit the network. The DB write happens in the background.
  // If it fails we surface an error and remove the optimistic bubble.
  async function sendReply(parentMsg: InboxMessage) {
    const text = (replyDrafts[parentMsg.id] || '').trim();
    if (!text) return;

    // Determine recipient first (same logic as before).
    let toUserId: string | null = null;
    let toName = '';
    let toEmail = '';
    if (parentMsg.from_user_id === currentUser.id) {
      const otherReply = replies.find(
        (r) => r.parent_id === parentMsg.id && r.from_user_id !== currentUser.id
      );
      toUserId = otherReply?.from_user_id ?? parentMsg.to_user_id;
      toName = otherReply?.from_name || '';
      toEmail = otherReply?.from_email || '';
    } else {
      toUserId = parentMsg.from_user_id;
      toName = parentMsg.from_name || '';
      toEmail = parentMsg.from_email || '';
    }

    const subject = (parentMsg.subject || '').startsWith('Re:')
      ? parentMsg.subject
      : 'Re: ' + (parentMsg.subject || '');

    // Build the optimistic reply with a temp id we can swap out later.
    // tempId prefix lets us identify+replace it when the real row comes back.
    const tempId = 'temp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const optimistic: InboxMessage = {
      id: tempId,
      parent_id: parentMsg.id,
      from_user_id: currentUser.id,
      from_name: currentUser.name,
      from_email: null,
      to_user_id: toUserId,
      to_dj_slug: null,
      subject,
      message: text,
      read: false,
      created_at: new Date().toISOString(),
    };

    // Step 1: Update UI immediately so the user sees the bubble appear and
    // the textarea clear. No await — these are synchronous setState calls.
    setReplies((prev) => [...prev, optimistic]);
    setReplyDrafts((prev) => ({ ...prev, [parentMsg.id]: '' }));
    setSending((prev) => ({ ...prev, [parentMsg.id]: true }));
    setReplyStatus((prev) => ({ ...prev, [parentMsg.id]: { text: '', ok: false } }));

    // Step 2: Fire the actual insert in the background.
    const supabase = createClient();
    try {
      const { data: inserted, error } = await supabase
        .from('messages')
        .insert([{
          parent_id: parentMsg.id,
          to_user_id: toUserId,
          from_user_id: currentUser.id,
          from_name: currentUser.name,
          subject,
          message: text,
          read: false,
        }] as unknown as never)
        .select('*')
        .single();

      if (error) throw error;
      const newReply = inserted as InboxMessage;

      // Step 3: Swap the optimistic bubble for the real row (gets a real
      // id + timestamp from the DB).
      setReplies((prev) => prev.map((r) => (r.id === tempId ? newReply : r)));
      setReplyStatus((prev) => ({ ...prev, [parentMsg.id]: { text: '✓ Sent', ok: true } }));
      setTimeout(() => {
        setReplyStatus((prev) => ({ ...prev, [parentMsg.id]: { text: '', ok: false } }));
      }, 2000);

      // Email the recipient that they have a new reply. Resolves their
      // email server-side via admin API (we have toUserId from above; the
      // toEmail captured from the parent row may be null after Auth migration).
      // Failures are swallowed so a successful DB insert isn't undone by
      // an email outage.
      try {
        await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'inbox_notification',
            recipientUserId: toUserId,
            recipientEmail: toEmail || undefined,
            recipientName: toName,
            senderName: currentUser.name,
            senderEmail: currentUser.email || undefined,
            subject,
            message: text,
            // Lets the recipient reply straight from the email (routes back
            // through the platform via the inbound webhook). parentMsg.id is the
            // thread id.
            threadId: parentMsg.id,
          }),
        });
      } catch (e) {
        console.warn('Inbox notification email failed:', e);
      }
    } catch (err) {
      // Rollback: remove the optimistic bubble + restore the textarea
      // contents so the user can retry without retyping.
      setReplies((prev) => prev.filter((r) => r.id !== tempId));
      setReplyDrafts((prev) => ({ ...prev, [parentMsg.id]: text }));
      const msg = err instanceof Error ? err.message : 'Send failed';
      setReplyStatus((prev) => ({ ...prev, [parentMsg.id]: { text: 'Failed: ' + msg, ok: false } }));
    } finally {
      setSending((prev) => ({ ...prev, [parentMsg.id]: false }));
    }
  }

  // ── Delete a thread (soft-delete) ──────────────────────────────
  // We don't actually remove the rows. We set a per-user flag so the
  // thread disappears from MY inbox while the other party still sees
  // their copy. This matches how Gmail / iMessage / etc. handle deletion.
  //
  // For each message in the thread (parent + every reply), the flag we
  // set depends on which side I'm on:
  //   - If I sent it    → set deleted_by_sender = true
  //   - If I received it → set deleted_by_recipient = true
  //
  // CRITICAL: we query the DB directly for ALL rows in the thread instead
  // of relying on local state. Local state may be stale (replies that
  // arrived after page load aren't in `replies` until refresh), and a
  // missed row means the thread can resurrect itself when those rows
  // contain unread messages later.
  //
  // When BOTH flags are eventually true on a row, a future cleanup job
  // can hard-delete it for real.
  async function deleteThread(parentId: string) {
    if (!(await confirm({
      title: 'Delete this conversation?',
      message: 'The conversation will be removed from your inbox. The other person will still have their copy.',
      confirmLabel: 'Delete',
      variant: 'danger',
    }))) return;
    const supabase = createClient();
    try {
      // Simpler, more reliable approach: do 4 small updates instead of 2 with
      // .or() filters. This ensures we hit each combination unambiguously and
      // sidesteps any Postgrest filter-combining quirks.
      //
      // (1) Parent row, if I sent it → deleted_by_sender = true
      await supabase
        .from('messages')
        .update({ deleted_by_sender: true } as unknown as never)
        .eq('id', parentId)
        .eq('from_user_id', currentUser.id);

      // (2) Parent row, if I received it → deleted_by_recipient = true
      await supabase
        .from('messages')
        .update({ deleted_by_recipient: true } as unknown as never)
        .eq('id', parentId)
        .eq('to_user_id', currentUser.id);

      // (3) Reply rows under the parent that I sent → deleted_by_sender = true
      await supabase
        .from('messages')
        .update({ deleted_by_sender: true } as unknown as never)
        .eq('parent_id', parentId)
        .eq('from_user_id', currentUser.id);

      // (4) Reply rows under the parent that I received → deleted_by_recipient = true
      await supabase
        .from('messages')
        .update({ deleted_by_recipient: true } as unknown as never)
        .eq('parent_id', parentId)
        .eq('to_user_id', currentUser.id);

      // Optimistic UI: drop the thread + its replies from local state
      // immediately.
      setMessages((prev) => prev.filter((m) => m.id !== parentId));
      setReplies((prev) => prev.filter((r) => r.parent_id !== parentId));
      if (openId === parentId) setOpenId(null);
      // Refresh the header inbox badge — deleting a thread can change
      // the unread count.
      window.dispatchEvent(new CustomEvent('gdc:refresh-inbox-count'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      alert('Error: ' + msg);
    }
  }

  // ── Who's the other person in this thread? ─────────────────────
  // Mirrors sendReply's recipient logic: if I started the thread, the other
  // party is whoever replied (or the original recipient); otherwise it's the
  // sender. Returns null id for an anonymous/no-account counterparty (nothing
  // to block).
  function threadCounterparty(parentMsg: InboxMessage): { id: string | null; name: string } {
    if (parentMsg.from_user_id === currentUser.id) {
      const otherReply = replies.find(
        (r) => r.parent_id === parentMsg.id && r.from_user_id !== currentUser.id
      );
      // I started this thread, so parentMsg.from_name is ME — never use it as the
      // other person's name. Use the replier's name if they've written, else a
      // neutral label.
      return {
        id: otherReply?.from_user_id ?? parentMsg.to_user_id ?? null,
        name: otherReply?.from_name || 'this person',
      };
    }
    return { id: parentMsg.from_user_id ?? null, name: parentMsg.from_name || 'this person' };
  }

  // ── Block the other person from the inbox ──────────────────────
  // Adds their user id to MY users.blocked_users — the same list the booking
  // flow and the Blocked Users settings section use. Once blocked they can't
  // send new booking requests or messages. We hide the thread afterward so the
  // annoying conversation is out of the way (it's not deleted — it resurfaces
  // if you unblock and they write again).
  async function blockFromThread(parentMsg: InboxMessage) {
    const { id: otherId, name } = threadCounterparty(parentMsg);
    if (!otherId || otherId === currentUser.id) {
      alert('This conversation has no account to block (it may be an anonymous message).');
      return;
    }
    if (!(await confirm({
      title: `Block ${name}?`,
      message: 'They will no longer be able to send you booking requests or messages. You can unblock them later under Update Profile → General → Blocked Users.',
      confirmLabel: 'Block',
      variant: 'danger',
    }))) return;
    const supabase = createClient();
    try {
      const { data, error: readErr } = await supabase
        .from('users')
        .select('blocked_users')
        .eq('id', currentUser.id)
        .single();
      if (readErr) throw readErr;
      const current = (data as { blocked_users?: string[] | null } | null)?.blocked_users || [];
      const updated = [...new Set([...current, otherId])];
      const { error } = await supabase
        .from('users')
        .update({ blocked_users: updated } as unknown as never)
        .eq('id', currentUser.id);
      if (error) throw error;
      // Also soft-delete this thread from MY inbox so it stays gone on reload
      // (same per-user delete flags as the Delete action). Blocking stops future
      // messages (enforced by a DB trigger); this clears the current one.
      const pid = parentMsg.id;
      await supabase.from('messages').update({ deleted_by_sender: true } as unknown as never).eq('id', pid).eq('from_user_id', currentUser.id);
      await supabase.from('messages').update({ deleted_by_recipient: true } as unknown as never).eq('id', pid).eq('to_user_id', currentUser.id);
      await supabase.from('messages').update({ deleted_by_sender: true } as unknown as never).eq('parent_id', pid).eq('from_user_id', currentUser.id);
      await supabase.from('messages').update({ deleted_by_recipient: true } as unknown as never).eq('parent_id', pid).eq('to_user_id', currentUser.id);
      // Hide the thread from view (collapse + drop from local list).
      setMessages((prev) => prev.filter((m) => m.id !== parentMsg.id));
      setReplies((prev) => prev.filter((r) => r.parent_id !== parentMsg.id));
      if (openId === parentMsg.id) setOpenId(null);
      window.dispatchEvent(new CustomEvent('gdc:refresh-inbox-count'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Block failed';
      alert('Error: ' + msg);
    }
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className={styles.pageWrap}>
      <div className={styles.pageHeader}>
        <h1>Inbox</h1>
        <p>
          {unreadCount > 0
            ? `${unreadCount} unread message${unreadCount > 1 ? 's' : ''}`
            : 'Your messages from party hosts and venues'}
        </p>
      </div>

      <div className={styles.filterTabs}>
        <FilterTab active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterTab>
        <FilterTab active={filter === 'unread'} onClick={() => setFilter('unread')}>Unread</FilterTab>
        <FilterTab active={filter === 'read'} onClick={() => setFilter('read')}>Read</FilterTab>
      </div>

      {filteredMessages.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📭</div>
          <div className={styles.emptyTitle}>No Messages</div>
          <div className={styles.emptySub}>
            {filter === 'unread' ? 'No unread messages.' : 'Your inbox is empty.'}
          </div>
        </div>
      ) : (
        <div className={styles.messagesList}>
          {filteredMessages.map((msg) => {
            const isUnread = threadIsUnread(msg);
            const isOpen = openId === msg.id;

            // Card header label: show the OTHER party's name. threadCounterparty
            // resolves the real name when the other person has written in the
            // thread. If I started it and they haven't replied yet, we can't know
            // their name from the row (from_name is ME), so fall back to the DJ
            // slug when the recipient is a DJ, otherwise a neutral "Recipient" —
            // never a blanket "DJ".
            const iSentThis = msg.from_user_id === currentUser.id;
            const cp = threadCounterparty(msg);
            // The other person's user id — recipient if I sent it, sender if I
            // received it — resolved to their real name via the nameById lookup.
            const otherId = iSentThis ? (cp.id ?? msg.to_user_id ?? null) : (msg.from_user_id ?? null);
            const resolvedName = otherId ? nameById[otherId] : '';
            const slug = msg.to_dj_slug && msg.to_dj_slug !== 'NULL' ? msg.to_dj_slug : '';
            const conversationName =
              resolvedName
              || (cp.name && cp.name !== 'this person' ? cp.name : '')
              || (iSentThis ? '' : (msg.from_name || ''))
              || slug
              || 'Recipient';

            // Sent/Received indicator based on most recent message in thread
            const threadReplies = replies.filter((r) => r.parent_id === msg.id);
            const lastMsg: InboxMessage = threadReplies.length > 0
              ? threadReplies[threadReplies.length - 1]
              : msg;
            const lastWasMe = lastMsg.from_user_id === currentUser.id;

            return (
              <div
                key={msg.id}
                className={`${styles.msgCard} ${isUnread ? styles.msgCardUnread : ''} ${isOpen ? styles.msgCardOpen : ''}`}
                onClick={() => openThread(msg)}
              >
                <div className={styles.msgTop}>
                  <span className={styles.msgFrom}>{conversationName}</span>
                  <span className={styles.msgTime}>{timeAgo(msg.created_at)}</span>
                </div>
                <div className={styles.msgSubject}>{msg.subject}</div>
                <div className={styles.msgMidRow}>
                  {/* Preview shows the LATEST message in the thread (could be
                      the parent itself if no replies yet, or whichever reply
                      is most recent). Matches user expectation that the inbox
                      preview reflects the current state of the conversation,
                      not its starting point. */}
                  <div className={styles.msgPreview}>{lastMsg.message}</div>
                  <div className={styles.sentLabel}>
                    {lastWasMe ? (
                      <span className={styles.sentLabelMe}>↑ Sent</span>
                    ) : (
                      <span className={styles.sentLabelThem}>↓ Received</span>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div className={styles.msgBody} onClick={(e) => e.stopPropagation()}>
                    <MessageThread
                      parent={msg}
                      replies={threadReplies}
                      currentUserId={currentUser.id}
                    />
                    {/* Reply box */}
                    <div className={styles.replyBox}>
                      <textarea
                        value={replyDrafts[msg.id] || ''}
                        onChange={(e) =>
                          setReplyDrafts((prev) => ({ ...prev, [msg.id]: e.target.value }))
                        }
                        placeholder="Write your reply..."
                        className={styles.replyTextarea}
                        rows={3}
                      />
                      <div className={styles.replyActions}>
                        <button
                          type="button"
                          onClick={() => sendReply(msg)}
                          disabled={sending[msg.id] || !(replyDrafts[msg.id] || '').trim()}
                          className={styles.replySendBtn}
                        >
                          {sending[msg.id] ? 'Sending...' : '↩ Send'}
                        </button>
                        <span
                          className={styles.replyStatus}
                          style={{
                            color: replyStatus[msg.id]?.ok ? 'var(--success)' : 'var(--error)',
                          }}
                        >
                          {replyStatus[msg.id]?.text || ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => blockFromThread(msg)}
                          className={styles.blockBtn}
                          title="Block this person from messaging or booking you"
                        >
                          Block
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteThread(msg.id)}
                          className={styles.deleteBtn}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* Site-uniform confirm dialog (replaces window.confirm) */}
      {confirmDialog}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────

function FilterTab({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.filterTab} ${active ? styles.filterTabActive : ''}`}
    >
      {children}
    </button>
  );
}

// "5 minutes ago" / "2h ago" / "3d ago" — same logic as vanilla timeAgo
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}
