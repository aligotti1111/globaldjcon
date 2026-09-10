// Shared write path for the inline profile editors.
//
// The account OWNER writes their own users row directly (RLS lets them,
// behavior unchanged). A TEAM MEMBER can't write the owner's row, so their
// edits are POSTed to the role-gated /api/profile/update endpoint, which writes
// with the admin client.
//
// To avoid threading an `actingAsMember` prop through a dozen editor
// components, ProfileView sets a small module-level context once per render via
// setProfileEditContext(). Every editor then just calls saveProfile(djId,
// patch) and the write routes itself. Storage uploads call
// profileUploadFolder(ownerId) so a member uploads into THEIR OWN storage
// folder (which RLS allows) — the resulting public URL is saved to the owner.

import { createClient } from '@/lib/supabase/client';

let _actingAsMember = false;
let _uploaderId: string | null = null;

export function setProfileEditContext(ctx: { actingAsMember: boolean; uploaderId: string | null }): void {
  _actingAsMember = ctx.actingAsMember;
  _uploaderId = ctx.uploaderId;
}

// Storage folder to upload into: the member's own id (RLS-safe), else the owner.
export function profileUploadFolder(ownerId: string): string {
  return _actingAsMember && _uploaderId ? _uploaderId : ownerId;
}

export async function saveProfile(
  djId: string,
  patch: Record<string, unknown>,
  actingAsMember: boolean = _actingAsMember,
): Promise<void> {
  if (actingAsMember) {
    const res = await fetch('/api/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patch }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) throw new Error(data.error || 'Could not save.');
    return;
  }
  const supabase = createClient();
  const { error } = await supabase
    .from('users')
    .update(patch as unknown as never)
    .eq('id', djId);
  if (error) throw error;
}
