// Admin Supabase client — uses the service role key.
// SERVER-ONLY. Never import this in a Client Component.
// Use for: looking up auth.users emails (the bug we hit before),
// admin actions like create-user/delete-user/approve-claim.
//
// Now typed via the Database generic. Auth admin methods (auth.admin.*)
// are NOT in the Database type — they live on the client itself and
// remain typed by @supabase/supabase-js.
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

// Resolves a user's email from auth.users by user id.
// This replaces the resolveUserEmail helper in the old send-email Netlify function.
export async function resolveUserEmail(userId: string): Promise<string | null> {
  if (!userId) return null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data?.user?.email) return null;
    return data.user.email;
  } catch (e) {
    console.error('[resolveUserEmail] error', e);
    return null;
  }
}

// Resolves a user id from auth.users by email. Returns null if no user
// with that email exists. Used by the booking-invite email flow to decide
// whether to send a "Create Account" or "Add to My Account" CTA.
//
// Implementation: paginate auth.admin.listUsers and match locally. Supabase
// JS SDK doesn't expose a filter param on listUsers (as of v2.x), so we
// fetch pages of 1000 and bail as soon as we find the match. For a typical
// site this completes in 1-2 page fetches.
export async function resolveUserIdByEmail(email: string): Promise<string | null> {
  if (!email) return null;
  const target = email.toLowerCase().trim();
  if (!target) return null;
  try {
    const admin = createAdminClient();
    const perPage = 1000;
    // Cap at a few pages so a misconfigured account can't spiral into a
    // long-running request. 5 pages = 5000 users, well past typical scale.
    for (let page = 1; page <= 5; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) {
        console.error('[resolveUserIdByEmail] listUsers error', error);
        return null;
      }
      const users = data?.users || [];
      const match = users.find((u) => (u.email || '').toLowerCase() === target);
      if (match) return match.id;
      if (users.length < perPage) return null; // last page
    }
    return null;
  } catch (e) {
    console.error('[resolveUserIdByEmail] error', e);
    return null;
  }
}
