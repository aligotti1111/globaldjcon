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

import { useState, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './inbox.module.css';
import MessageThread from './MessageThread';
import type { InboxMessage } from './page';

interface CurrentUser {
  id: string;
  name: string;
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
        .then(() => {});
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
        .then(() => {});
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

    void toName;
    void toEmail;

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

      // Email notification — DEFERRED. Vanilla calls /.netlify/functions/send-email
      // here. Once we port that route, wire it up.
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

  // ── Delete a thread ────────────────────────────────────────────
  async function deleteThread(parentId: string) {
    if (!confirm('Delete this conversation?')) return;
    const supabase = createClient();
    try {
      // Delete the parent. RLS allows deletion; we then also cascade-delete
      // the replies in a second call (parent_id matches).
      await supabase.from('messages').delete().eq('id', parentId);
      await supabase.from('messages').delete().eq('parent_id', parentId);
      setMessages((prev) => prev.filter((m) => m.id !== parentId));
      setReplies((prev) => prev.filter((r) => r.parent_id !== parentId));
      if (openId === parentId) setOpenId(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
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

            // Card header label: show the OTHER party's name. If I sent it,
            // show recipient (slug fallback). If I received it, show sender.
            const iSentThis = msg.from_user_id === currentUser.id;
            const recipientName = msg.to_dj_slug && msg.to_dj_slug !== 'NULL' ? msg.to_dj_slug : 'DJ';
            const conversationName = iSentThis ? recipientName : (msg.from_name || 'Anonymous');

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
                  <div className={styles.msgPreview}>{msg.message}</div>
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
