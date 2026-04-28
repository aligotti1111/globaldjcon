'use server';

// updateMyEmailAction — change the current user's email without triggering
// Supabase's "confirm your new email" verification flow.
//
// Why this exists:
// The standard supabase.auth.updateUser({ email }) sends a confirmation
// link to the new address. Anthony's preference is for email changes to
// be immediate — no link, no extra step.
//
// How it works:
// We use the SERVICE ROLE admin client to call updateUserById with
// email_confirm: true, which auto-confirms the new email and doesn't
// send any email at all. We still verify the user owns the account by
// requiring re-authentication with their current password BEFORE we
// touch anything.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export interface UpdateMyEmailResult {
  success: boolean;
  error?: string;
  newEmail?: string;
}

export async function updateMyEmailAction(input: {
  newEmail: string;
  currentPassword: string;
}): Promise<UpdateMyEmailResult> {
  const newEmail = input.newEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    return { success: false, error: 'Please enter a valid email address.' };
  }
  if (!input.currentPassword) {
    return { success: false, error: 'Current password is required.' };
  }

  // Step 1: confirm there's a logged-in user
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return { success: false, error: 'Not signed in.' };
  }

  // Step 2: verify the current password by attempting a password sign-in
  // against the user's existing email. This is server-side so a bad
  // password doesn't leak any state to the client beyond the error.
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: input.currentPassword,
  });
  if (authErr) {
    return { success: false, error: 'Current password is incorrect.' };
  }

  // Step 3: check the new email isn't already used by someone else
  if (newEmail !== user.email.toLowerCase()) {
    const admin = createAdminClient();
    try {
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const conflict = list.users.find(
        (u) => u.id !== user.id && (u.email || '').toLowerCase() === newEmail
      );
      if (conflict) {
        return { success: false, error: 'That email is already in use by another account.' };
      }
    } catch {
      // Non-fatal — let the update below surface a real conflict.
    }

    // Step 4: update the email with email_confirm: true so no verification
    // email is sent to the new address.
    const { error: updateErr } = await admin.auth.admin.updateUserById(user.id, {
      email: newEmail,
      email_confirm: true,
    });
    if (updateErr) {
      return { success: false, error: 'Email update failed: ' + updateErr.message };
    }
  }

  return { success: true, newEmail };
}
