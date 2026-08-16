'use server';

// updateMyDjNameAction — change the current user's DJ / Company Name, gated by
// the account password. A name change is public-facing (it's on the profile,
// contracts, and every booking's display), so we require re-authentication with
// the current password before writing it — same guard the email change uses.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export interface UpdateMyDjNameResult {
  success: boolean;
  error?: string;
  newName?: string;
}

export async function updateMyDjNameAction(input: {
  newName: string;
  currentPassword: string;
}): Promise<UpdateMyDjNameResult> {
  const newName = (input.newName || '').trim();
  if (!newName) {
    return { success: false, error: 'Name can’t be empty.' };
  }
  if (newName.length > 120) {
    return { success: false, error: 'Name is too long.' };
  }
  if (!input.currentPassword) {
    return { success: false, error: 'Current password is required.' };
  }

  // Step 1: confirm there's a logged-in user.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return { success: false, error: 'Not signed in.' };
  }

  // Step 2: verify the current password by attempting a password sign-in
  // against the user's existing email. Server-side, so a wrong password leaks
  // nothing beyond the error.
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: input.currentPassword,
  });
  if (authErr) {
    return { success: false, error: 'Current password is incorrect.' };
  }

  // Step 3: write the new name. Service role, since we've already re-authed.
  const admin = createAdminClient();
  const { error: updateErr } = await admin
    .from('users')
    .update({ name: newName } as unknown as never)
    .eq('id', user.id);
  if (updateErr) {
    return { success: false, error: 'Name update failed: ' + updateErr.message };
  }

  return { success: true, newName };
}
