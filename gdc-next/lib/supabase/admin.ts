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
    // Fast path: read the mirrored, indexed email off the profile row (a single
    // by-id lookup) instead of hitting the Auth admin API. See
    // scaling-email-mirror.sql — public.users.email is kept in sync with
    // auth.users.email by triggers.
    const { data: profile } = await admin
      .from('users')
      .select('email, contact_email')
      .eq('id', userId)
      .maybeSingle<{ email: string | null; contact_email: string | null }>();
    const mirrored = profile?.email?.trim();
    if (mirrored) return mirrored;

    // Fallback for rows the mirror hasn't populated yet (pre-backfill / edge):
    // ask Auth directly, then fall back to the profile's delivery address.
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (!error && data?.user?.email) return data.user.email;
    return profile?.contact_email?.trim() || null;
  } catch (e) {
    console.error('[resolveUserEmail] error', e);
    return null;
  }
}

// Resolves a user id from auth.users by email. Returns null if no user
// with that email exists. Used by the booking-invite email flow to decide
// whether to send a "Create Account" or "Add to My Account" CTA.
//
// Implementation: an indexed equality lookup on public.users.email (the
// lowercase mirror of auth.users.email kept in sync by triggers — see
// scaling-email-mirror.sql), NOT a scan of the Auth admin API. This is a single
// by-index query regardless of how many users exist.
//
// Also checks users.contact_email, so an address a phone-signup host gave at
// booking still resolves to their account — otherwise the same person could
// be handed a "create an account" link for an account they already have.
// opts.strict — when true, a lookup FAILURE (listUsers error, DB error, or any
// thrown exception) propagates to the caller instead of being swallowed into a
// null "no match". This matters for the uniqueness check: a swallowed error
// reads as "address is free" and lets a host claim a DJ's address (fail-open).
// The conflict check passes strict:true so it fails CLOSED — a lookup it can't
// complete refuses the write and asks the user to retry, rather than allowing
// something this guard exists to prevent. The email-invite CTA leaves strict
// off: there, "couldn't tell" → show "create account" is an acceptable default.
export async function resolveUserIdByEmail(
  email: string,
  opts?: { strict?: boolean },
): Promise<string | null> {
  if (!email) return null;
  const target = email.toLowerCase().trim();
  if (!target) return null;
  const strict = opts?.strict === true;

  const run = async (): Promise<string | null> => {
    const admin = createAdminClient();
    // Authoritative lookup: a security-definer RPC that reads auth.users
    // DIRECTLY by its unique email index (O(1)). This does NOT trust the
    // client-writable users.email mirror, so it can't be forged and can't
    // fail-open on a mirror sync gap. See scaling-email-mirror.sql.
    const { data: authId, error: rpcErr } = await admin
      .rpc('auth_user_id_by_email', { p_email: target });
    if (rpcErr) {
      console.error('[resolveUserIdByEmail] auth_user_id_by_email error', rpcErr);
      if (strict) throw rpcErr; // fail closed — don't pretend "not found"
    }
    if (typeof authId === 'string' && authId) return authId;

    // Not their account email — check the profile delivery address they may
    // have given at booking (phone-signup hosts).
    const { data: profile, error: profileErr } = await admin
      .from('users')
      .select('id')
      .ilike('contact_email', target)
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (profileErr) {
      console.error('[resolveUserIdByEmail] contact_email lookup error', profileErr);
      if (strict) throw profileErr; // fail closed
    }
    return profile?.id || null;
  };

  // Strict callers get the raw error so they can decide to refuse. Lenient
  // callers keep the old swallow-to-null behavior.
  if (strict) return run();
  try {
    return await run();
  } catch (e) {
    console.error('[resolveUserIdByEmail] error', e);
    return null;
  }
}
