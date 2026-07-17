'use server';

// Admin server actions. Each action calls requireAdmin() first, so an
// unauthenticated/non-admin user invoking these directly gets rejected
// even if they crafted a request manually. Service role calls happen
// inside these functions only.
//
// Faithful port of the vanilla Netlify functions:
//   admin-create-user.js → createUserAction
//   admin-update-user.js → updateUserAction
//   admin-delete-user.js → deleteUserAction
//   admin-list-claims.js → listClaimsAction
//   admin-list-emails.js → listEmailsAction
//   admin-approve-claim.js → approveClaimAction
//   admin-reject-claim.js → rejectClaimAction
//   admin-get-user-email.js → getUserEmailAction

import { requireAdmin } from '@/lib/supabase/admin-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────
// Whitelist of fields the admin can change on a public.users row.
// Matches vanilla ALLOWED_FIELDS in admin-update-user.js.
// ─────────────────────────────────────────────────────────────────────────
const ALLOWED_USER_FIELDS = [
  'name', 'slug', 'role', 'dj_type',
  'venue_name', 'address',
  'country', 'state', 'city', 'zip',
  'bio',
  'phone', 'website', 'instagram', 'soundcloud', 'tiktok', 'facebook', 'twitch',
  'travel_distance',
  'profile_private',
  'claimed',
  'email_verified',
] as const;

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export interface CreateUserInput {
  role: 'dj' | 'host' | 'venue';
  name: string;
  slug?: string;
  dj_type?: 'mobile' | 'club';
  country?: string;
  state?: string;
  city?: string;
  zip?: string;
  phone?: string;
  website?: string;
  instagram?: string;
  soundcloud?: string;
  venue_name?: string;
  address?: string;
}

export interface CreateUserResult {
  success: boolean;
  user_id?: string;
  placeholder_email?: string;
  error?: string;
}

export interface UpdateUserInput {
  user_id: string;
  updates: Partial<Record<typeof ALLOWED_USER_FIELDS[number] | 'email', unknown>>;
}

export interface UpdateUserResult {
  success: boolean;
  user?: Record<string, unknown>;
  email_updated?: boolean;
  email?: string;
  error?: string;
}

export interface ClaimRow {
  id: string;
  target_user_id: string | null;
  target_slug: string | null;
  target_biz_name: string;
  claimant_name: string;
  claimant_email: string;
  verify_msg: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  reviewed_notes: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// CREATE USER — admin-create-user.js
// ─────────────────────────────────────────────────────────────────────────
export async function createUserAction(input: CreateUserInput): Promise<CreateUserResult> {
  await requireAdmin();
  const admin = createAdminClient();

  // Validation
  if (!['dj', 'host', 'venue'].includes(input.role)) {
    return { success: false, error: 'Invalid role' };
  }
  if (!input.name?.trim()) {
    return { success: false, error: 'Name is required' };
  }
  if ((input.role === 'dj' || input.role === 'venue') && !input.slug?.trim()) {
    return { success: false, error: 'Slug is required for dj/venue' };
  }

  // Slug uniqueness
  if (input.slug) {
    const { data: existing } = await admin
      .from('users')
      .select('id')
      .eq('slug', input.slug)
      .limit(1);
    const existingRows = (existing || []) as Array<{ id: string }>;
    if (existingRows.length > 0) {
      return { success: false, error: 'That slug is already taken.' };
    }
  }

  // Generate placeholder email + random password (account is unclaimed)
  const baseSlug =
    input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const placeholderEmail = `${input.role}-${baseSlug}-${Date.now().toString(36)}@globaldjconnect.local`;
  const randomPassword = generateRandomPassword(20);

  // Create the auth user. The handle_new_user() Postgres trigger inserts
  // a base public.users row using the user_metadata we pass here, so we
  // include role + name + slug so the trigger can write them. We patch
  // the rest below.
  const { data: authResult, error: authErr } = await admin.auth.admin.createUser({
    email: placeholderEmail,
    password: randomPassword,
    email_confirm: true,
    user_metadata: {
      role: input.role,
      name: input.name.trim(),
      slug: input.slug,
      dj_type: input.dj_type,
      country: input.country,
      state: input.state,
      city: input.city,
      zip: input.zip,
    },
  });

  if (authErr || !authResult?.user) {
    return { success: false, error: authErr?.message || 'Failed to create auth user' };
  }
  const userId = authResult.user.id;

  // Patch public.users with the rest. Strip undefined to avoid clobbering
  // anything the trigger already filled in.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = {
    role: input.role,
    name: input.name.trim(),
    slug: input.slug || null,
    dj_type: input.dj_type || null,
    country: input.country || null,
    state: input.state || null,
    city: input.city || null,
    zip: input.zip || null,
    phone: input.phone || null,
    website: input.website || null,
    instagram: input.instagram || null,
    soundcloud: input.soundcloud || null,
    venue_name: input.venue_name || null,
    address: input.address || null,
    claimed: false,
    email_verified: true, // admin-created accounts skip email verification
    // Mobile DJs default to ALL 12 party types selected so they're bookable
    // for every event type immediately. Persisted to the DB (not just a UI
    // default) so the public booking form's event-type dropdown is populated.
    // Club DJs get none. Order matches the editor default in UpdateDjProfileClient.
    event_types: input.dj_type === 'mobile'
      ? 'weddings,corporate,birthday,anniversary,graduation,sweet16,quinceanera,mitzvah,reunion,holiday,school,community,other'
      : null,
  };

  const { error: profErr } = await admin
    .from('users')
    .update(updates as unknown as never)
    .eq('id', userId);

  if (profErr) {
    // Rollback: delete the auth user we just created
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return { success: false, error: 'Profile update failed: ' + profErr.message };
  }

  revalidatePath('/admin');
  return {
    success: true,
    user_id: userId,
    placeholder_email: placeholderEmail,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// UPDATE USER — admin-update-user.js
// ─────────────────────────────────────────────────────────────────────────
export async function updateUserAction(input: UpdateUserInput): Promise<UpdateUserResult> {
  await requireAdmin();
  const admin = createAdminClient();

  if (!input.user_id) return { success: false, error: 'user_id required' };
  if (!input.updates || typeof input.updates !== 'object') {
    return { success: false, error: 'updates object required' };
  }

  // Pull email out — lives on auth.users not public.users
  const emailRaw = (input.updates.email as string | undefined)?.trim().toLowerCase();
  const updates = { ...input.updates };
  delete updates.email;

  let emailUpdated = false;
  if (emailRaw !== undefined && emailRaw !== '') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      return { success: false, error: 'Email format invalid' };
    }

    // Check the new email isn't already on a different auth user
    try {
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const conflict = list.users.find(
        (u) => u.id !== input.user_id && (u.email || '').toLowerCase() === emailRaw
      );
      if (conflict) {
        return { success: false, error: 'That email is already in use by another account' };
      }
    } catch {
      // Non-fatal — let the update below surface a real conflict
    }

    const { error: emailErr } = await admin.auth.admin.updateUserById(input.user_id, {
      email: emailRaw,
      email_confirm: true,
    });
    if (emailErr) {
      return { success: false, error: 'Email update failed: ' + emailErr.message };
    }
    emailUpdated = true;
  }

  // Build patch from allowed fields only
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = {};
  for (const k of ALLOWED_USER_FIELDS) {
    if (k in updates) {
      const v = updates[k];
      if (v === '' || v === undefined) patch[k] = null;
      else patch[k] = v;
    }
  }

  if (Object.keys(patch).length === 0) {
    if (emailUpdated) {
      revalidatePath('/admin');
      return { success: true, email_updated: true, email: emailRaw };
    }
    return { success: false, error: 'No allowed fields to update' };
  }

  // Slug uniqueness (if slug is being changed)
  if (patch.slug) {
    const { data: existing } = await admin
      .from('users')
      .select('id')
      .eq('slug', patch.slug)
      .limit(1);
    const existingRows = (existing || []) as Array<{ id: string }>;
    if (existingRows[0] && existingRows[0].id !== input.user_id) {
      return { success: false, error: 'That slug is already taken by another user' };
    }
  }

  const { data, error } = await admin
    .from('users')
    .update(patch as unknown as never)
    .eq('id', input.user_id)
    .select('*');

  if (error) return { success: false, error: 'Update failed: ' + error.message };
  const rows = (data || []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return { success: false, error: 'User not found' };

  revalidatePath('/admin');
  return {
    success: true,
    user: rows[0],
    email_updated: emailUpdated,
    email: emailRaw,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// DELETE USER — admin-delete-user.js
// ─────────────────────────────────────────────────────────────────────────
export async function deleteUserAction(userId: string): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  const admin = createAdminClient();

  if (!userId) return { success: false, error: 'user_id required' };

  // Delete the auth user first; the public.users row should be deleted by
  // a CASCADE / trigger, but if not, do it explicitly.
  const { error: authErr } = await admin.auth.admin.deleteUser(userId);
  if (authErr) {
    return { success: false, error: 'Delete failed: ' + authErr.message };
  }

  // Defensive cleanup: delete the public.users row in case CASCADE didn't fire.
  await admin.from('users').delete().eq('id', userId).select();

  revalidatePath('/admin');
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────
// LIST EMAILS — admin-list-emails.js
// Returns an array of { id, email } for all auth users, used to display
// emails alongside the user list in the admin panel.
// ─────────────────────────────────────────────────────────────────────────
export async function listEmailsAction(): Promise<{ users: { id: string; email: string }[] }> {
  await requireAdmin();
  const admin = createAdminClient();

  const result: { id: string; email: string }[] = [];
  try {
    // Pagination: pull pages of 1000 until empty, up to a reasonable cap.
    let page = 1;
    while (page <= 5) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) break;
      if (!data.users.length) break;
      for (const u of data.users) {
        result.push({ id: u.id, email: u.email || '' });
      }
      if (data.users.length < 1000) break;
      page++;
    }
  } catch (e) {
    console.error('listEmailsAction error:', e);
  }

  return { users: result };
}

// ─────────────────────────────────────────────────────────────────────────
// GET ONE USER EMAIL — admin-get-user-email.js
// ─────────────────────────────────────────────────────────────────────────
export async function getUserEmailAction(
  userId: string
): Promise<{ email: string | null; error?: string }> {
  await requireAdmin();
  const admin = createAdminClient();

  try {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data?.user) return { email: null, error: error?.message || 'Not found' };
    return { email: data.user.email || null };
  } catch (e) {
    return { email: null, error: (e as Error).message };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// LIST CLAIMS — admin-list-claims.js
// ─────────────────────────────────────────────────────────────────────────
export async function listClaimsAction(
  status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending'
): Promise<{ claims: ClaimRow[]; error?: string }> {
  await requireAdmin();
  const admin = createAdminClient();

  let query = admin
    .from('profile_claims')
    .select('*')
    .order('created_at', { ascending: false });
  if (status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return { claims: [], error: error.message };
  return { claims: (data as ClaimRow[]) || [] };
}

// ─────────────────────────────────────────────────────────────────────────
// APPROVE CLAIM — admin-approve-claim.js
// ─────────────────────────────────────────────────────────────────────────
export async function approveClaimAction(
  claimId: string,
  reviewedNotes: string,
  siteBase: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  await requireAdmin();
  const admin = createAdminClient();

  if (!claimId) return { success: false, error: 'claim_id required' };

  // Fetch the claim
  const { data: claim, error: claimErr } = await admin
    .from('profile_claims')
    .select('*')
    .eq('id', claimId)
    .single<ClaimRow>();
  if (claimErr || !claim) return { success: false, error: 'Claim not found' };
  if (claim.status !== 'pending') {
    return { success: false, error: `Claim is not pending (status: ${claim.status})` };
  }
  if (!claim.target_user_id) return { success: false, error: 'Claim has no target user' };

  const newEmail = (claim.claimant_email || '').toLowerCase().trim();
  if (!newEmail) return { success: false, error: 'Claim has no claimant email' };

  // Check email isn't already on a different user
  try {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const conflict = list.users.find(
      (u) => u.id !== claim.target_user_id && (u.email || '').toLowerCase() === newEmail
    );
    if (conflict) {
      return { success: false, error: 'That email is already registered to another account.' };
    }
  } catch {
    // non-fatal
  }

  // Swap email on auth user (auto-confirmed)
  const { error: emailErr } = await admin.auth.admin.updateUserById(claim.target_user_id, {
    email: newEmail,
    email_confirm: true,
  });
  if (emailErr) {
    return { success: false, error: 'Failed to update email: ' + emailErr.message };
  }

  // Mark user claimed
  await admin.from('users').update({ claimed: true } as unknown as never).eq('id', claim.target_user_id);

  // Mark claim approved
  await admin
    .from('profile_claims')
    .update({
      status: 'approved',
      reviewed_at: new Date().toISOString(),
      reviewed_notes: reviewedNotes || null,
    } as unknown as never)
    .eq('id', claim.id);

  // Fetch target profile for the email
  const { data: targetProfile } = await admin
    .from('users')
    .select('name, venue_name, slug, role')
    .eq('id', claim.target_user_id)
    .single<{ name: string | null; venue_name: string | null; slug: string | null; role: string }>();

  // Generate a one-time password-setup token (24h)
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { error: tokenErr } = await admin
    .from('password_setup_tokens')
    .insert({
      token,
      user_id: claim.target_user_id,
      email: newEmail,
      expires_at: expiresAt,
    } as unknown as never);

  let emailSent = false;
  if (!tokenErr) {
    const setPasswordLink = `${siteBase}/set-password?token=${encodeURIComponent(token)}`;
    // Send the "Profile Claimed" email via the existing send-email route
    try {
      const emailRes = await fetch(`${siteBase}/api/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'profile_claimed',
          email: newEmail,
          name: targetProfile?.name || null,
          bizName: targetProfile?.venue_name || targetProfile?.name || null,
          slug: targetProfile?.slug || null,
          setPasswordLink,
        }),
      });
      emailSent = emailRes.ok;
    } catch (e) {
      console.error('approveClaimAction: send-email error', e);
    }
  }

  revalidatePath('/admin');
  return {
    success: true,
    message: emailSent
      ? `Claim approved. Profile-claimed email sent to ${newEmail}.`
      : 'Claim approved, but the email send may have failed. Check logs.',
  };
}

// ─────────────────────────────────────────────────────────────────────────
// REJECT CLAIM — admin-reject-claim.js
// ─────────────────────────────────────────────────────────────────────────
export async function rejectClaimAction(
  claimId: string,
  reviewedNotes: string
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  const admin = createAdminClient();

  if (!claimId) return { success: false, error: 'claim_id required' };
  if (!reviewedNotes?.trim()) return { success: false, error: 'Reason required' };

  const { error } = await admin
    .from('profile_claims')
    .update({
      status: 'rejected',
      reviewed_at: new Date().toISOString(),
      reviewed_notes: reviewedNotes,
    } as unknown as never)
    .eq('id', claimId)
    .eq('status', 'pending');

  if (error) return { success: false, error: error.message };

  revalidatePath('/admin');
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────
// GRANT FREE ACCESS (comp) — sets a tier + an explicit expiry date on a user.
// This is admin-issued complimentary access, read by the access module
// alongside any Stripe subscription; effective access is the higher of the
// two. Admin picks the exact expiration date (any future date). Granting
// again replaces the previous grant.
// ─────────────────────────────────────────────────────────────────────────
export async function grantCompAction(input: {
  user_id: string;
  tier: number;
  expires_at: string; // ISO date/datetime the access should end
}): Promise<{ success: boolean; expires_at?: string; error?: string }> {
  await requireAdmin();
  const admin = createAdminClient();

  if (!input.user_id) return { success: false, error: 'user_id required' };
  const tier = input.tier === 2 ? 2 : 1;

  // Parse + validate the chosen date. Accept a YYYY-MM-DD (from a date input)
  // or a full ISO string. Store end-of-day so "expires Aug 15" means access
  // lasts through Aug 15.
  if (!input.expires_at) return { success: false, error: 'Pick an expiration date.' };
  let end: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.expires_at)) {
    end = new Date(`${input.expires_at}T23:59:59`);
  } else {
    end = new Date(input.expires_at);
  }
  if (isNaN(end.getTime())) return { success: false, error: 'Invalid date.' };
  if (end.getTime() <= Date.now()) return { success: false, error: 'Pick a future date.' };

  const expiresAt = end.toISOString();

  const { error } = await admin
    .from('users')
    .update({
      comp_tier: tier,
      comp_expires_at: expiresAt,
      comp_source: 'admin',
    } as unknown as never)
    .eq('id', input.user_id);

  if (error) return { success: false, error: error.message };

  revalidatePath('/admin');
  return { success: true, expires_at: expiresAt };
}

// ─────────────────────────────────────────────────────────────────────────
// CLEAR FREE ACCESS (comp) — removes an admin/code comp grant from a user.
// Their Stripe subscription (if any) is untouched.
// ─────────────────────────────────────────────────────────────────────────
export async function clearCompAction(input: {
  user_id: string;
}): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  const admin = createAdminClient();

  if (!input.user_id) return { success: false, error: 'user_id required' };

  const { error } = await admin
    .from('users')
    .update({
      comp_tier: null,
      comp_expires_at: null,
      comp_source: null,
    } as unknown as never)
    .eq('id', input.user_id);

  if (error) return { success: false, error: error.message };

  revalidatePath('/admin');
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────
function generateRandomPassword(len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}
