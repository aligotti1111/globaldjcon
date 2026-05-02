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
