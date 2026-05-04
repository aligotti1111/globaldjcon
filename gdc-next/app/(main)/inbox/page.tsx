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
// guarantees every visit produces a fresh DB query — critical for an
// inbox where stale data would show ghost messages or hide new ones.
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

  // ── Orphan-reply promotion (Gmail-style "fresh thread" behavior) ─
  // If I previously soft-deleted a thread but the other party then
  // replied, those new replies are NOT in my visible top-level set
  // (because their parent IS soft-deleted from my view). To match
  // Gmail behavior — where a new reply to a deleted thread shows up
  // as a NEW fresh message in the inbox without resurrecting the old
  // history — we find those orphan replies and treat each one as if
  // it were a top-level message.
  const visibleParentIds = new Set([...received, ...sent].map((m) => m.id));
  const { data: orphanRows } = await supabase
    .from('messages')
    .select('*')
    .eq('to_user_id', authUser.id)
    .eq('deleted_by_recipient', false)
    .neq('from_user_id', authUser.id) // don't promote my own replies
    .not('parent_id', 'is', null)
    .order('created_at', { ascending: false });
  const orphanReplies = ((orphanRows as InboxMessage[]) || []).filter(
    (r) => r.parent_id !== null && !visibleParentIds.has(r.parent_id)
  );
  // Treat each orphan as a fresh top-level message by clearing parent_id
  // for display. The DB row is unchanged — this is a view-only adjustment.
  const promotedOrphans: InboxMessage[] = orphanReplies.map((r) => ({
    ...r,
    parent_id: null,
  }));

  // Merge + dedupe by id, then sort newest-first.
  const seen = new Set<string>();
  const messages: InboxMessage[] = [];
  for (const m of [...received, ...sent, ...promotedOrphans]) {
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
  //
  // IMPORTANT: We exclude the orphan-reply IDs from this query because
  // they're now displayed as standalone top-level messages, not as replies
  // to anything. (They'd otherwise show up twice — once as a top-level
  // and once as a reply to the hidden parent.)
  const orphanIds = new Set(promotedOrphans.map((r) => r.id));
  let replies: InboxMessage[] = [];
  if (messages.length > 0) {
    // Only ask for replies to ACTUAL parent threads (skip the promoted
    // orphans whose parent_id was nulled for display).
    const realParentIds = messages
      .filter((m) => !orphanIds.has(m.id))
      .map((m) => m.id);
    if (realParentIds.length > 0) {
      const { data: replyRows } = await supabase
        .from('messages')
        .select('*')
        .in('parent_id', realParentIds)
        .or(
          `and(from_user_id.eq.${authUser.id},deleted_by_sender.eq.false),and(to_user_id.eq.${authUser.id},deleted_by_recipient.eq.false)`
        )
        .order('created_at', { ascending: true });
      replies = (replyRows as InboxMessage[]) || [];
    }
  }

  return (
    <InboxClient
      currentUser={{ id: profile.id, name: profile.name || 'You', email: authUser.email || null }}
      initialMessages={messages}
      initialReplies={replies}
    />
  );
}
