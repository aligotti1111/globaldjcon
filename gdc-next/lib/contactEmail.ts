// Is this delivery address free for this user to claim?
//
// WHY THIS IS A SHARED FILE AND NOT A LOCAL FUNCTION
// The same question gets asked in two places: when a phone-signup host gives
// an email at their first booking, and when a host edits it later on account
// settings. The booking route asked it. Account settings did not — it wrote
// straight from the browser — so a host could set their address to one that
// already belonged to a DJ, and nothing objected.
//
// Two copies of a rule is one copy plus a copy someone will forget. So there's
// one, here, and both callers use it.
//
// WHY IT CAN'T RUN IN THE BROWSER
// Answering it means reading auth.users, which needs the service role. Any
// version of this check written client-side is decoration: the browser is the
// thing we're guarding against. That's exactly how the hole got in — account
// settings validated the FORMAT of the address in the browser and then trusted
// the result.
//
// WHAT GOES WRONG WITHOUT IT
// Not cosmetic, and invisible to both parties:
//   - Contracts, confirmations and planner links get mailed to a stranger
//   - resolveUserIdByEmail can resolve the address to either account
//   - At login, typing it is ambiguous — and the lookup has no ORDER BY, so
//     which account it opens can differ between two identical requests

import { resolveUserIdByEmail } from '@/lib/supabase/admin';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Returns the reason to refuse, or null to proceed.
 *
 * An empty email is not a conflict — callers that require one check for that
 * separately. This function answers one question only: does somebody else
 * already own this address?
 */
export async function contactEmailConflict(
  userId: string,
  email: string,
): Promise<string | null> {
  if (!email) return null;
  if (!EMAIL_RE.test(email)) {
    return 'That email address doesn’t look right.';
  }
  try {
    const owner = await resolveUserIdByEmail(email);
    if (owner && owner !== userId) {
      return 'That email address is already used by another account. Use a different address, or log in with that email instead.';
    }
  } catch (e) {
    // A lookup failure must NOT silently allow the thing this exists to stop.
    // Refusing on error is the safe direction: the cost is one retry, and the
    // cost of the other direction is someone else's contract in a stranger's
    // inbox.
    console.error('[contactEmailConflict] lookup failed:', e);
    return 'We couldn’t verify that email address just now. Please try again.';
  }
  return null;
}
