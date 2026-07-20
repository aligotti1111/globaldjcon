// /inbox — page where a logged-in user reads messages received from other
// users (DJs, hosts, venues) and the replies in those threads.
// Faithful port of vanilla inbox.html.
//
// Schema:
//   - messages (id, from_user_id, from_name, from_email, to_user_id,
//     to_dj_slug, subject, message, read, created_at, parent_id)
//   - parent_id is null for top-level messages, set to the parent message
//     id for replies. We render parent + replies as a thread.
//
// Data loading:
//   1. Top-level messages received BY current user (parent_id null)
//   2. Top-level messages SENT BY current user (so they see replies)
//   3. All replies whose parent_id is in either of the above
//
// Then merge + dedupe parent messages, sorted newest-first.
//
// SCOPE FOR THIS SESSION:
//   - Read existing threads
//   - Reply to threads
//   - Mark-as-read on open
//   - Delete a thread (deletes parent + replies)
//   - Filter tabs: All / Unread / Read
//
// DEFERRED:
//   - Compose new message UI (entry points on DJ profile + booking-requests
//     come in a follow-up session)
//   - Email notification on reply (depends on a send-email API route we
//     haven't ported yet)
//   - Header inbox-badge with unread count + polling

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import InboxClient from './InboxClient';

export const dynamic = 'force-dynamic';
// Disable all caching on this page. Even with `dynamic = 'force-dynamic'`,
// individual fetch results inside a server component can be cached by
// Next.js's fetch layer. `revalidate = 0` is belt-and-suspenders that
// guarantees every visit produces a fresh DB query.
export const revalidate = 0;

export interface InboxMessage {
  id: string;
  from_user_id: string | null;
  from_name: string | null;
  from_email: string | null;
  to_user_id: string | null;
  to_dj_slug: string | null;
  subject: string;
  message: string;
  read: boolean;
  created_at: string;
  parent_id: string | null;
}

export default async function InboxPage() {
  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) redirect('/login?redirect=/inbox');

  // Need name for the Reply rendering ("You — just now")
  const { data: profile } = await supabase
    .from('users')
    .select('id, name')
    .eq('id', authUser.id)
    .single<{ id: string; name: string | null }>();
  if (!profile) redirect('/login?redirect=/inbox');

  // Fetch top-level messages: received OR sent by current user.
  // parent_id is null = top of thread. Replies live under those parents.
  //
  // Soft-delete filters:
  //   - For RECEIVED: skip messages where I (the recipient) marked it deleted
  //   - For SENT: skip messages where I (the sender) marked it deleted
  //
  // EXCEPTION: if a thread I previously deleted gets a new reply addressed
  // to me (that I haven't deleted), the whole thread comes back into my
  // inbox so I can read the reply in context. Implemented in two steps:
  //   1. Fetch parents I haven't soft-deleted (the normal case)
  //   2. Find non-deleted replies addressed to me whose parent ISN'T in
  //      step 1, then fetch those parents too (resurrection case)
  const [receivedRes, sentRes] = await Promise.all([
    supabase
      .from('messages')
      .select('*')
      .eq('to_user_id', authUser.id)
      .eq('deleted_by_recipient', false)
      .is('parent_id', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('messages')
      .select('*')
      .eq('from_user_id', authUser.id)
      .eq('deleted_by_sender', false)
      .is('parent_id', null)
      .order('created_at', { ascending: false }),
  ]);

  const received = (receivedRes.data as InboxMessage[]) || [];
  const sent = (sentRes.data as InboxMessage[]) || [];

  // ── Thread resurrection: bring back parents whose threads have new
  // replies addressed to me, even if I previously deleted the parent.
  const visibleIds = new Set([...received, ...sent].map((m) => m.id));
  const { data: liveReplyRows } = await supabase
    .from('messages')
    .select('parent_id')
    .eq('to_user_id', authUser.id)
    .eq('deleted_by_recipient', false)
    .neq('from_user_id', authUser.id)
    .not('parent_id', 'is', null);
  const liveReplies = (liveReplyRows as unknown as { parent_id: string | null }[]) || [];
  const resurrectParentIds = Array.from(new Set(
    liveReplies
      .map((r) => r.parent_id)
      .filter((pid): pid is string => pid !== null && !visibleIds.has(pid))
  ));
  let resurrectedParents: InboxMessage[] = [];
  if (resurrectParentIds.length > 0) {
    const { data: parentRows } = await supabase
      .from('messages')
      .select('*')
      .in('id', resurrectParentIds);
    resurrectedParents = (parentRows as InboxMessage[]) || [];
  }

  // Merge + dedupe by id, then sort newest-first.
  const seen = new Set<string>();
  const messages: InboxMessage[] = [];
  for (const m of [...received, ...sent, ...resurrectedParents]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    messages.push(m);
  }
  messages.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  // Fetch replies. Two different rules:
  //   - For NORMAL threads (parent in received/sent): filter out replies
  //     I soft-deleted on my side.
  //   - For RESURRECTED threads (parent only came back because of a new
  //     reply): fetch ALL replies in the thread, ignoring my prior
  //     soft-delete flags. The user explicitly asked: when a thread
  //     comes back via a new reply, show the whole conversation history,
  //     not just the new reply.
  const resurrectedSet = new Set(resurrectedParents.map((p) => p.id));
  const normalParentIds = messages
    .filter((m) => !resurrectedSet.has(m.id))
    .map((m) => m.id);
  const resurrectedParentIds = messages
    .filter((m) => resurrectedSet.has(m.id))
    .map((m) => m.id);

  let replies: InboxMessage[] = [];
  if (normalParentIds.length > 0) {
    const { data: rows } = await supabase
      .from('messages')
      .select('*')
      .in('parent_id', normalParentIds)
      .or(
        `and(from_user_id.eq.${authUser.id},deleted_by_sender.eq.false),and(to_user_id.eq.${authUser.id},deleted_by_recipient.eq.false)`
      )
      .order('created_at', { ascending: true });
    replies = (rows as InboxMessage[]) || [];
  }
  if (resurrectedParentIds.length > 0) {
    const { data: rows } = await supabase
      .from('messages')
      .select('*')
      .in('parent_id', resurrectedParentIds)
      .order('created_at', { ascending: true });
    const resurrectedReplies = (rows as InboxMessage[]) || [];
    replies = [...replies, ...resurrectedReplies].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }

  return (
    <InboxClient
      currentUser={{ id: profile.id, name: profile.name || 'You', email: authUser.email || null }}
      initialMessages={messages}
      initialReplies={replies}
    />
  );
}
