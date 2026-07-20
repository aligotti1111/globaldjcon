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
//
// FALLS BACK TO users.contact_email. A host who signed up with a phone number
// has no address in auth.users — they gave one at their first booking instead,
// and it lives on their profile. Every email in the app funnels through here,
// so without this fallback a phone-signup host books successfully and then
// silently receives nothing: no offer, no confirmation, no contract, no
// planner link, no cancellation link. The failure is invisible on both sides,
// which is what makes it worth the extra query.
export async function resolveUserEmail(userId: string): Promise<string | null> {
  if (!userId) return null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (!error && data?.user?.email) return data.user.email;

    // No auth email — try the delivery address on their profile.
    const { data: profile } = await admin
      .from('users')
      .select('contact_email')
      .eq('id', userId)
      .maybeSingle<{ contact_email: string | null }>();
    const fallback = profile?.contact_email?.trim();
    return fallback || null;
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
//
// Also checks users.contact_email, so an address a phone-signup host gave at
// booking still resolves to their account — otherwise the same person could
// be handed a "create an account" link for an account they already have.
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
        break;
      }
      const users = data?.users || [];
      const match = users.find((u) => (u.email || '').toLowerCase() === target);
      if (match) return match.id;
      if (users.length < perPage) break; // last page
    }

    // Not an auth email — check profile delivery addresses.
    const { data: profile } = await admin
      .from('users')
      .select('id')
      .ilike('contact_email', target)
      .limit(1)
      .maybeSingle<{ id: string }>();
    return profile?.id || null;
  } catch (e) {
    console.error('[resolveUserIdByEmail] error', e);
    return null;
  }
}
