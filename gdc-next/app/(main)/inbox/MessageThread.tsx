'use client';

// MessageThread — render the parent message + all replies as chat bubbles.
// "me" bubbles align right; "them" bubbles align left.
// Faithful port of vanilla renderThread.

import styles from './inbox.module.css';
import type { InboxMessage } from './page';

interface Props {
  parent: InboxMessage;
  replies: InboxMessage[];
  currentUserId: string;
}

export default function MessageThread({ parent, replies, currentUserId }: Props) {
  // Replies are pre-sorted ascending by created_at in the parent fetch.
  const items = [parent, ...replies];

  return (
    <div className={styles.threadWrap}>
      {items.map((m) => {
        const isMe = m.from_user_id === currentUserId;
        return (
          <div
            key={m.id}
            className={`${styles.bubble} ${isMe ? styles.bubbleMe : styles.bubbleThem}`}
          >
            <div className={styles.bubbleInner}>
              <div className={styles.bubbleMeta}>
                {isMe ? 'You' : (m.from_name || 'Anonymous')} · {timeAgo(m.created_at)}
              </div>
              <div className={styles.bubbleText}>
                {/* Preserve newlines: split on \n and join with <br>-equivalent */}
                {m.message.split('\n').map((line, i, arr) => (
                  <span key={i}>
                    {line}
                    {i < arr.length - 1 && <br />}
                  </span>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

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
