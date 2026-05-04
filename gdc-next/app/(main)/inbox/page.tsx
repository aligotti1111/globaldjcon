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
  // The other party still sees their copy. When BOTH flags are true, a
  // future cleanup job can hard-delete the row.
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

  // Merge + dedupe by id (a user can't message themselves but defensive
  // dedupe is cheap), then sort newest-first.
  const seen = new Set<string>();
  const messages: InboxMessage[] = [];
  for (const m of [...received, ...sent]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    messages.push(m);
  }
  messages.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  // Fetch all replies for these threads in one query.
  // Soft-delete filter: a reply is hidden from me if I marked it deleted on
  // whichever side I'm on. Replies I sent → check deleted_by_sender;
  // replies sent to me → check deleted_by_recipient. The .or() expresses
  // "show this row if it's mine and I haven't deleted as sender, OR it's
  // addressed to me and I haven't deleted as recipient."
  let replies: InboxMessage[] = [];
  if (messages.length > 0) {
    const parentIds = messages.map((m) => m.id);
    const { data: replyRows } = await supabase
      .from('messages')
      .select('*')
      .in('parent_id', parentIds)
      .or(
        `and(from_user_id.eq.${authUser.id},deleted_by_sender.eq.false),and(to_user_id.eq.${authUser.id},deleted_by_recipient.eq.false)`
      )
      .order('created_at', { ascending: true });
    replies = (replyRows as InboxMessage[]) || [];
  }

  return (
    <InboxClient
      currentUser={{ id: profile.id, name: profile.name || 'You', email: authUser.email || null }}
      initialMessages={messages}
      initialReplies={replies}
    />
  );
}
