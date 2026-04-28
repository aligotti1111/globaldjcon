// Admin auth gate — used by /admin routes + server actions.
// The admin is identified by a hardcoded email constant. There's exactly
// one admin user in the system. Server-side checks run on every request
// to /admin and on every admin server action.
//
// Future improvement: move to a role='admin' column on public.users so
// multiple admins are possible without code changes. For now, single-admin
// is fine — matches vanilla and avoids an extra schema migration.

import { createClient } from './server';

// The single admin email. Anything else hitting /admin or admin actions
// gets bounced to /login.
export const ADMIN_EMAIL = 'admin@globaldjconnect.com';

/** Server-only — returns true if the current request is from the admin. */
export async function isAdminUser(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  return user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

/** Throws if not admin — for use in server actions. */
export async function requireAdmin(): Promise<void> {
  const ok = await isAdminUser();
  if (!ok) throw new Error('Unauthorized — admin access required');
}
