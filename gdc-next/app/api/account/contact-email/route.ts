// POST /api/account/contact-email — change a host's delivery address.
//
// WHY THIS ROUTE EXISTS
// Account settings used to write contact_email straight from the browser:
//
//   supabase.from('users').update({ contact_email }).eq('id', profile.id)
//
// The only check was a regex on the SHAPE of the address. Nothing asked
// whether it already belonged to somebody, so a host could set their delivery
// address to a DJ's email and the app would agree. That's how it was found.
//
// The check can't live in the browser. Answering "does anyone else have this
// address?" means reading auth.users, which needs the service role — and a
// client-side guard is decoration anyway, because the client is the thing
// being guarded. The booking form already did this correctly on the server;
// account settings was the door left open next to it.
//
// WHAT A DUPLICATE ACTUALLY BREAKS — it isn't just tidiness:
//   - Contracts, confirmations and planner links go to a stranger's inbox
//   - /api/auth/lookup-identifier finds accounts by contact_email with
//     `.limit(1)` and no ORDER BY, so with two matches Postgres returns
//     whichever it likes — the account that email opens can differ between
//     two identical login attempts
//   - resolveUserIdByEmail has the same shape, so a booking invite can attach
//     to the wrong account
//
// HOSTS ONLY. A DJ or venue changes a real auth email, which needs their
// password and goes through updateMyEmailAction. This address is a delivery
// destination, not a credential — which is why it needs no verification, and
// exactly why it still needs to be unique.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { contactEmailConflict, EMAIL_RE } from '@/lib/contactEmail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Always 500, never 502. Cloudflare swallows a 502 and the browser sees a
 * generic network failure instead of the message, so the user is told nothing.
 */
function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return bad('Invalid request.');
  }

  // The session decides whose row is written — never a user id from the body.
  // Taking the id from the request would let anyone rewrite anyone's address.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return bad('Not signed in.', 401);

  const email = (body.email || '').trim().toLowerCase();
  if (!email) return bad('Please enter an email address.');
  if (!EMAIL_RE.test(email)) return bad('Please enter a valid email address.');

  const admin = createAdminClient();

  // Confirm the caller is actually a host before writing. A DJ hitting this
  // route directly shouldn't be able to set a contact_email that quietly
  // shadows their real auth email in resolveUserEmail's fallback.
  const { data: profile } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle<{ role: string | null }>();
  if (!profile) return bad('Account not found.', 404);
  if (profile.role !== 'host') {
    return bad('Use the email form on your profile to change your sign-in address.', 403);
  }

  const conflict = await contactEmailConflict(user.id, email);
  if (conflict) return bad(conflict, 409);

  const { error } = await admin
    .from('users')
    .update({ contact_email: email } as unknown as never)
    .eq('id', user.id);
  if (error) {
    console.error('[account/contact-email] update failed:', error);
    return bad('Could not save that address. Please try again.', 500);
  }

  return NextResponse.json({ ok: true, email });
}
