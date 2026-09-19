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
import { getStripe } from '@/lib/stripe/server';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

// The generated Supabase types don't include the new comp_codes tables yet, so
// for those calls we use an untyped client (same pattern as the redeem route).
// Cast at the call sites via this alias.
function untyped(c: ReturnType<typeof createAdminClient>): SupabaseClient {
  return c as unknown as SupabaseClient;
}

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
// DISABLE / ENABLE USER — non-destructive alternative to delete.
// Disabling bans the auth user (they can't sign in) but keeps ALL their data;
// enabling lifts the ban. Uses Supabase's ban_duration under the hood.
// ─────────────────────────────────────────────────────────────────────────
export async function setUserDisabledAction(
  userId: string,
  disabled: boolean,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  const admin = createAdminClient();

  if (!userId) return { success: false, error: 'user_id required' };

  // ban_duration accepts a Go-style duration ('876000h' ≈ 100 years) to ban,
  // or the literal 'none' to lift a ban. Not in the generated TS type, so cast.
  const { error } = await admin.auth.admin.updateUserById(
    userId,
    { ban_duration: disabled ? '876000h' : 'none' } as unknown as { ban_duration: string },
  );
  if (error) return { success: false, error: 'Update failed: ' + error.message };

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
  // Comp tier can be any real paid tier (1=Starter … 4=Enterprise).
  const tier = [1, 2, 3, 4].includes(input.tier) ? input.tier : 1;

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
// COMP CODES — platform "Subscription Promotions" v1 (comp codes only).
// A code grants free access (tier for N months) when a DJ redeems it; no card,
// no Stripe. Redemption itself happens in /api/comp-codes/redeem — these
// actions are the ADMIN side: create / list / deactivate.
// ─────────────────────────────────────────────────────────────────────────

export interface CompCodeRow {
  id: string;
  code: string;
  grant_tier: number;
  months: number;
  expires_at: string | null;
  max_uses: number | null;
  uses_count: number;
  active: boolean;
  note: string | null;
  created_at: string;
}

export async function listCompCodesAction(): Promise<{ codes: CompCodeRow[]; error?: string }> {
  await requireAdmin();
  const admin = untyped(createAdminClient());
  const { data, error } = await admin
    .from('comp_codes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return { codes: [], error: error.message };
  return { codes: (data as CompCodeRow[]) || [] };
}

export async function createCompCodeAction(input: {
  code: string;
  grant_tier: number;
  months: number;
  max_uses?: number | null;
  expires_at?: string | null; // YYYY-MM-DD or ISO; end-of-day is stored
  note?: string | null;
}): Promise<{ success: boolean; code?: CompCodeRow; error?: string }> {
  await requireAdmin();
  const admin = untyped(createAdminClient());

  const code = (input.code || '').trim().toUpperCase();
  if (!code) return { success: false, error: 'Code is required.' };
  if (!/^[A-Z0-9_-]{6,40}$/.test(code)) {
    return { success: false, error: 'Code must be 6–40 chars: letters, numbers, dashes/underscores.' };
  }
  const tier = Math.trunc(Number(input.grant_tier));
  if (![1, 2, 3, 4].includes(tier)) return { success: false, error: 'Pick a valid plan tier.' };
  const months = Math.trunc(Number(input.months));
  if (!(months >= 1 && months <= 60)) return { success: false, error: 'Months must be 1–60.' };

  let maxUses: number | null = null;
  if (input.max_uses != null && `${input.max_uses}` !== '') {
    const m = Math.trunc(Number(input.max_uses));
    if (!(m > 0)) return { success: false, error: 'Max uses must be a positive number (or blank for unlimited).' };
    maxUses = m;
  }

  let expiresAt: string | null = null;
  if (input.expires_at) {
    const raw = input.expires_at;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T23:59:59`) : new Date(raw);
    if (isNaN(d.getTime())) return { success: false, error: 'Invalid expiry date.' };
    if (d.getTime() <= Date.now()) return { success: false, error: 'Expiry must be a future date.' };
    expiresAt = d.toISOString();
  }

  // Uniqueness pre-check (the DB unique constraint is the real guard).
  const { data: existing } = await admin.from('comp_codes').select('id').eq('code', code).limit(1);
  if (((existing || []) as Array<{ id: string }>).length > 0) {
    return { success: false, error: 'That code already exists.' };
  }
  // Cross-check: the same name can't also be a discount code, or the redeem box
  // (which checks comp codes first) would make one of them unreachable.
  const { data: dupDisc } = await admin.from('discount_codes').select('id').eq('code', code).limit(1);
  if (((dupDisc || []) as Array<{ id: string }>).length > 0) {
    return { success: false, error: 'That code already exists as a discount code. Pick a different name.' };
  }

  const { data, error } = await admin
    .from('comp_codes')
    .insert({
      code,
      grant_tier: tier,
      months,
      max_uses: maxUses,
      expires_at: expiresAt,
      note: input.note?.trim() || null,
    } as unknown as never)
    .select('*')
    .single();

  if (error) return { success: false, error: 'Create failed: ' + error.message };

  revalidatePath('/admin');
  return { success: true, code: data as CompCodeRow };
}

export interface CompRedemption {
  user_id: string;
  name: string | null;
  slug: string | null;
  email: string | null;
  redeemed_at: string;
  granted_tier: number;
  granted_months: number;
  new_expires_at: string;
}

// Who redeemed a given comp code — name/email + when + what it granted.
export async function listCompCodeRedemptionsAction(
  codeId: string,
): Promise<{ redemptions: CompRedemption[]; error?: string }> {
  await requireAdmin();
  const admin = createAdminClient();
  const u = untyped(admin);
  if (!codeId) return { redemptions: [], error: 'code id required' };

  const { data, error } = await u
    .from('comp_code_redemptions')
    .select('user_id, redeemed_at, granted_tier, granted_months, new_expires_at')
    .eq('code_id', codeId)
    .order('redeemed_at', { ascending: false });
  if (error) return { redemptions: [], error: error.message };

  const rows = (data as { user_id: string; redeemed_at: string; granted_tier: number; granted_months: number; new_expires_at: string }[]) || [];
  const ids = rows.map((r) => r.user_id);

  // Names/slugs + emails from public.users in ONE query (email is the mirrored,
  // indexed column — no per-user Auth admin calls). See scaling-email-mirror.sql.
  const nameMap: Record<string, { name: string | null; slug: string | null }> = {};
  const emailMap: Record<string, string> = {};
  if (ids.length) {
    const { data: profs } = await admin.from('users').select('id, name, slug, email').in('id', ids);
    for (const p of (profs as { id: string; name: string | null; slug: string | null; email: string | null }[] | null) || []) {
      nameMap[p.id] = { name: p.name, slug: p.slug };
      emailMap[p.id] = p.email || '';
    }
  }

  return {
    redemptions: rows.map((r) => ({
      user_id: r.user_id,
      name: nameMap[r.user_id]?.name ?? null,
      slug: nameMap[r.user_id]?.slug ?? null,
      email: emailMap[r.user_id] ?? null,
      redeemed_at: r.redeemed_at,
      granted_tier: r.granted_tier,
      granted_months: r.granted_months,
      new_expires_at: r.new_expires_at,
    })),
  };
}

// A DJ who redeemed a DISCOUNT code or SITE SALE (recorded by the Stripe
// webhook — see code-redemptions.sql). Shape mirrors CompRedemption (minus the
// grant fields) so the admin UI can render both the same way.
export interface CodeRedemption {
  user_id: string;
  name: string | null;
  slug: string | null;
  email: string | null;
  redeemed_at: string;
}

// Who used a given discount code (code_type 'discount') or site sale
// (code_type 'sale'). Usage is tracked from when code-redemptions.sql was
// applied onward — earlier Stripe redemptions aren't back-filled.
export async function listCodeRedemptionsAction(
  codeType: 'discount' | 'sale',
  codeId: string,
): Promise<{ redemptions: CodeRedemption[]; error?: string }> {
  await requireAdmin();
  const admin = createAdminClient();
  const u = untyped(admin);
  if (!codeId) return { redemptions: [], error: 'code id required' };

  const { data, error } = await u
    .from('code_redemptions')
    .select('user_id, redeemed_at')
    .eq('code_type', codeType)
    .eq('code_id', codeId)
    .order('redeemed_at', { ascending: false });
  if (error) return { redemptions: [], error: error.message };

  const rows = (data as { user_id: string; redeemed_at: string }[]) || [];
  const ids = [...new Set(rows.map((r) => r.user_id))];

  const nameMap: Record<string, { name: string | null; slug: string | null; email: string | null }> = {};
  if (ids.length) {
    const { data: profs } = await admin.from('users').select('id, name, slug, email').in('id', ids);
    for (const p of (profs as { id: string; name: string | null; slug: string | null; email: string | null }[] | null) || []) {
      nameMap[p.id] = { name: p.name, slug: p.slug, email: p.email };
    }
  }

  return {
    redemptions: rows.map((r) => ({
      user_id: r.user_id,
      name: nameMap[r.user_id]?.name ?? null,
      slug: nameMap[r.user_id]?.slug ?? null,
      email: nameMap[r.user_id]?.email ?? null,
      redeemed_at: r.redeemed_at,
    })),
  };
}

// Edit an existing comp code. The code string itself is NOT changed (it's the
// key DJs type / that the ledger references) — only its grant + limits.
export async function editCompCodeAction(
  id: string,
  input: { grant_tier: number; months: number; max_uses?: number | null; expires_at?: string | null; note?: string | null },
): Promise<{ success: boolean; code?: CompCodeRow; error?: string }> {
  await requireAdmin();
  const admin = untyped(createAdminClient());
  if (!id) return { success: false, error: 'id required' };

  const tier = Math.trunc(Number(input.grant_tier));
  if (![1, 2, 3, 4].includes(tier)) return { success: false, error: 'Pick a valid plan tier.' };
  const months = Math.trunc(Number(input.months));
  if (!(months >= 1 && months <= 60)) return { success: false, error: 'Months must be 1–60.' };

  let maxUses: number | null = null;
  if (input.max_uses != null && `${input.max_uses}` !== '') {
    const m = Math.trunc(Number(input.max_uses));
    if (!(m > 0)) return { success: false, error: 'Max uses must be a positive number (or blank for unlimited).' };
    maxUses = m;
  }
  let expiresAt: string | null = null;
  if (input.expires_at) {
    const raw = input.expires_at;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T23:59:59`) : new Date(raw);
    if (isNaN(d.getTime())) return { success: false, error: 'Invalid expiry date.' };
    expiresAt = d.toISOString();
  }

  const { data, error } = await admin
    .from('comp_codes')
    .update({ grant_tier: tier, months, max_uses: maxUses, expires_at: expiresAt, note: input.note?.trim() || null } as unknown as never)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return { success: false, error: 'Update failed: ' + error.message };
  revalidatePath('/admin');
  return { success: true, code: data as CompCodeRow };
}

export async function deactivateCompCodeAction(
  id: string,
  active: boolean,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  const admin = untyped(createAdminClient());
  if (!id) return { success: false, error: 'id required' };
  const { error } = await admin
    .from('comp_codes')
    .update({ active } as unknown as never)
    .eq('id', id);
  if (error) return { success: false, error: error.message };
  revalidatePath('/admin');
  return { success: true };
}

// Permanently delete a comp code. Redemption history rows (comp_redemptions)
// reference it; remove those first so the delete isn't blocked by the FK, then
// drop the code. Access ALREADY granted to DJs who redeemed it is untouched —
// that lives on their own user row, not here.
export async function deleteCompCodeAction(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  const admin = untyped(createAdminClient());
  if (!id) return { success: false, error: 'id required' };
  await admin.from('comp_code_redemptions').delete().eq('code_id', id);
  const { error } = await admin.from('comp_codes').delete().eq('id', id);
  if (error) return { success: false, error: error.message };
  revalidatePath('/admin');
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────
// DISCOUNT CODES — paid % off, Stripe-backed (coupon + promotion code).
// The Stripe objects are the source of truth; public.discount_codes mirrors
// them for listing. Not in the generated types → untyped() for the table.
// ─────────────────────────────────────────────────────────────────────────
export interface DiscountCodeRow {
  id: string;
  code: string;
  stripe_coupon_id: string;
  stripe_promo_id: string;
  percent_off: number;
  duration: 'once' | 'forever';
  // Which plan interval the code applies to. 'monthly' = first month on a
  // monthly plan; 'yearly' = first year on a yearly plan; 'both' = forever.
  applies_to: 'monthly' | 'yearly' | 'both';
  max_redemptions: number | null;
  expires_at: string | null;
  active: boolean;
  note: string | null;
  created_at: string;
}

export async function listDiscountCodesAction(): Promise<{ codes: DiscountCodeRow[]; error?: string }> {
  await requireAdmin();
  const admin = untyped(createAdminClient());
  const { data, error } = await admin
    .from('discount_codes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return { codes: [], error: error.message };
  return { codes: (data as DiscountCodeRow[]) || [] };
}

export async function createDiscountCodeAction(input: {
  code: string;
  percent_off: number;
  // Which interval the code targets. 'monthly'/'yearly' = first payment only on
  // that plan; 'both' = every payment forever.
  applies_to: 'monthly' | 'yearly' | 'both';
  max_redemptions?: number | null;
  expires_at?: string | null; // YYYY-MM-DD or ISO; end-of-day stored
  note?: string | null;
}): Promise<{ success: boolean; code?: DiscountCodeRow; error?: string }> {
  await requireAdmin();
  const admin = untyped(createAdminClient());

  const code = (input.code || '').trim().toUpperCase();
  // Stripe promotion codes are alphanumeric — no dashes/underscores.
  if (!/^[A-Z0-9]{4,40}$/.test(code)) {
    return { success: false, error: 'Code must be 4–40 letters/numbers (no spaces or symbols).' };
  }
  const percent = Math.trunc(Number(input.percent_off));
  if (!(percent >= 1 && percent <= 100)) return { success: false, error: 'Percent off must be 1–100.' };
  const appliesTo: 'monthly' | 'yearly' | 'both' =
    input.applies_to === 'monthly' || input.applies_to === 'yearly' ? input.applies_to : 'both';
  // 'both' recurs on every invoice → Stripe duration 'forever'. A first-payment
  // scope (monthly or yearly) → 'once' (the first invoice of that plan).
  const duration: 'once' | 'forever' = appliesTo === 'both' ? 'forever' : 'once';

  let maxRedemptions: number | null = null;
  if (input.max_redemptions != null && `${input.max_redemptions}` !== '') {
    const m = Math.trunc(Number(input.max_redemptions));
    if (!(m > 0)) return { success: false, error: 'Max uses must be a positive number (or blank for unlimited).' };
    maxRedemptions = m;
  }

  let expiresAtIso: string | null = null;
  let expiresAtUnix: number | undefined;
  if (input.expires_at) {
    const raw = input.expires_at;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T23:59:59`) : new Date(raw);
    if (isNaN(d.getTime())) return { success: false, error: 'Invalid expiry date.' };
    if (d.getTime() <= Date.now()) return { success: false, error: 'Expiry must be a future date.' };
    expiresAtIso = d.toISOString();
    expiresAtUnix = Math.floor(d.getTime() / 1000);
  }

  // Uniqueness pre-check (DB unique + Stripe both enforce it too).
  const { data: existing } = await admin.from('discount_codes').select('id').eq('code', code).limit(1);
  if (((existing || []) as Array<{ id: string }>).length > 0) {
    return { success: false, error: 'That code already exists.' };
  }
  // Cross-check: the same name can't also be a comp code (the redeem box checks
  // comp codes first, which would shadow this discount).
  const { data: dupComp } = await admin.from('comp_codes').select('id').eq('code', code).limit(1);
  if (((dupComp || []) as Array<{ id: string }>).length > 0) {
    return { success: false, error: 'That code already exists as a comp code. Pick a different name.' };
  }

  try {
    const stripe = getStripe();
    // Create a Stripe COUPON directly, with the usage cap + expiry ON the
    // coupon. We deliberately DON'T create a Stripe promotion code — this
    // account's API rejects `coupon` on promotionCodes.create, and we don't
    // need it: our own "Apply Promo Code" box looks the code up in
    // discount_codes and applies the coupon to checkout via
    // `discounts: [{ coupon }]`. duration 'once' hits only the first invoice;
    // 'forever' recurs every period.
    const scopeLabel = appliesTo === 'monthly' ? 'first month' : appliesTo === 'yearly' ? 'first year' : 'forever';
    const coupon = await stripe.coupons.create({
      percent_off: percent,
      duration,
      name: `${code} — ${percent}% off (${scopeLabel})`,
      ...(maxRedemptions != null ? { max_redemptions: maxRedemptions } : {}),
      ...(expiresAtUnix ? { redeem_by: expiresAtUnix } : {}),
    });

    const { data, error } = await admin
      .from('discount_codes')
      .insert({
        code,
        stripe_coupon_id: coupon.id,
        // No promotion code any more; the column is NOT NULL so mirror the
        // coupon id. Checkout looks up stripe_coupon_id, not this.
        stripe_promo_id: coupon.id,
        percent_off: percent,
        duration,
        applies_to: appliesTo,
        max_redemptions: maxRedemptions,
        expires_at: expiresAtIso,
        note: input.note?.trim() || null,
      } as unknown as never)
      .select('*')
      .single();
    if (error) return { success: false, error: 'Saved to Stripe but local record failed: ' + error.message };

    revalidatePath('/admin');
    return { success: true, code: data as DiscountCodeRow };
  } catch (e) {
    return { success: false, error: 'Stripe error: ' + ((e as Error).message || 'could not create code') };
  }
}

// Edit a discount code. Stripe coupons are IMMUTABLE (percent/duration can't be
// changed), so we mint a NEW coupon with the new values, point the row at it,
// then delete the old coupon. The code string stays the same.
export async function editDiscountCodeAction(
  id: string,
  input: {
    percent_off: number;
    applies_to: 'monthly' | 'yearly' | 'both';
    max_redemptions?: number | null;
    expires_at?: string | null;
    note?: string | null;
  },
): Promise<{ success: boolean; code?: DiscountCodeRow; error?: string }> {
  await requireAdmin();
  const admin = untyped(createAdminClient());
  if (!id) return { success: false, error: 'id required' };

  const percent = Math.trunc(Number(input.percent_off));
  if (!(percent >= 1 && percent <= 99)) return { success: false, error: 'Percent off must be 1–99.' };
  const appliesTo: 'monthly' | 'yearly' | 'both' =
    input.applies_to === 'monthly' || input.applies_to === 'yearly' ? input.applies_to : 'both';
  const duration: 'once' | 'forever' = appliesTo === 'both' ? 'forever' : 'once';

  let maxRedemptions: number | null = null;
  if (input.max_redemptions != null && `${input.max_redemptions}` !== '') {
    const m = Math.trunc(Number(input.max_redemptions));
    if (!(m > 0)) return { success: false, error: 'Max uses must be a positive number (or blank for unlimited).' };
    maxRedemptions = m;
  }
  let expiresAtIso: string | null = null;
  let expiresAtUnix: number | undefined;
  if (input.expires_at) {
    const raw = input.expires_at;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T23:59:59`) : new Date(raw);
    if (isNaN(d.getTime())) return { success: false, error: 'Invalid expiry date.' };
    expiresAtIso = d.toISOString();
    expiresAtUnix = Math.floor(d.getTime() / 1000);
  }

  const { data: rowData } = await admin.from('discount_codes').select('code, stripe_coupon_id').eq('id', id).maybeSingle();
  const row = rowData as { code?: string; stripe_coupon_id?: string } | null;
  if (!row?.code) return { success: false, error: 'Code not found.' };
  const oldCoupon = row.stripe_coupon_id;

  try {
    const stripe = getStripe();
    const scopeLabel = appliesTo === 'monthly' ? 'first month' : appliesTo === 'yearly' ? 'first year' : 'forever';
    const coupon = await stripe.coupons.create({
      percent_off: percent,
      duration,
      name: `${row.code} — ${percent}% off (${scopeLabel})`,
      ...(maxRedemptions != null ? { max_redemptions: maxRedemptions } : {}),
      ...(expiresAtUnix ? { redeem_by: expiresAtUnix } : {}),
    });

    const { data, error } = await admin
      .from('discount_codes')
      .update({
        stripe_coupon_id: coupon.id,
        stripe_promo_id: coupon.id,
        percent_off: percent,
        duration,
        applies_to: appliesTo,
        max_redemptions: maxRedemptions,
        expires_at: expiresAtIso,
        note: input.note?.trim() || null,
      } as unknown as never)
      .eq('id', id)
      .select('*')
      .single();
    if (error) return { success: false, error: 'Update failed: ' + error.message };

    // Retire the old coupon (best effort; existing subscriptions keep theirs).
    if (oldCoupon) { try { await stripe.coupons.del(oldCoupon); } catch { /* ignore */ } }

    revalidatePath('/admin');
    return { success: true, code: data as DiscountCodeRow };
  } catch (e) {
    return { success: false, error: 'Stripe error: ' + ((e as Error).message || 'could not update code') };
  }
}

export async function deactivateDiscountCodeAction(
  id: string,
  active: boolean,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  const admin = untyped(createAdminClient());
  if (!id) return { success: false, error: 'id required' };

  // Flip the local active flag. Checkout only applies a code whose row is
  // active, so an inactive code can't be used even though the Stripe coupon
  // still exists (kept so it can be reactivated).
  const { error } = await admin
    .from('discount_codes')
    .update({ active } as unknown as never)
    .eq('id', id);
  if (error) return { success: false, error: error.message };
  revalidatePath('/admin');
  return { success: true };
}

// Permanently delete a discount code: drop our row and retire its Stripe coupon
// (best-effort — subscriptions that already applied it keep their discount).
export async function deleteDiscountCodeAction(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  const admin = untyped(createAdminClient());
  if (!id) return { success: false, error: 'id required' };
  const { data: rowData } = await admin.from('discount_codes').select('stripe_coupon_id').eq('id', id).maybeSingle();
  const couponId = (rowData as { stripe_coupon_id?: string } | null)?.stripe_coupon_id;
  // Drop its redemption rows too (no FK — code_id is polymorphic) so they don't
  // linger as dead weight.
  await admin.from('code_redemptions').delete().eq('code_type', 'discount').eq('code_id', id);
  const { error } = await admin.from('discount_codes').delete().eq('id', id);
  if (error) return { success: false, error: error.message };
  if (couponId) { try { await getStripe().coupons.del(couponId); } catch { /* ignore */ } }
  revalidatePath('/admin');
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────
// SITE-WIDE SALES — auto-applied in a date window (see site-sales.sql).
//   'percent' → a Stripe-coupon % off at checkout.
//   'free'    → a comp granted to new DJ signups (no Stripe).
// ─────────────────────────────────────────────────────────────────────────
export interface SiteSaleRow {
  id: string;
  kind: 'percent' | 'free';
  percent_off: number | null;
  applies_to: 'monthly' | 'yearly' | 'both' | null;
  stripe_coupon_id: string | null;
  grant_tier: number | null;
  grant_months: number | null;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
  note: string | null;
  created_at: string;
}

export async function listSiteSalesAction(): Promise<{ sales: SiteSaleRow[]; error?: string }> {
  await requireAdmin();
  const admin = untyped(createAdminClient());
  const { data, error } = await admin.from('site_sales').select('*').order('created_at', { ascending: false });
  if (error) return { sales: [], error: error.message };
  return { sales: (data as SiteSaleRow[]) || [] };
}

// One ACTIVE sale per plan. Two sales for DIFFERENT plans can run at once
// (e.g. "Pro free" + "Premium Pro free", or a monthly + a yearly % sale), but
// not two live sales for the SAME plan. "Plan" = the granted tier for a free
// sale, or the interval (applies_to) for a percent sale. Returns true if
// activating this would collide with an already-active sale.
async function siteSalePlanConflict(
  admin: SupabaseClient,
  sale: { kind: 'percent' | 'free'; applies_to?: 'monthly' | 'yearly' | 'both' | null; grant_tier?: number | null },
  excludeId?: string,
): Promise<boolean> {
  let q = admin.from('site_sales').select('id').eq('active', true).eq('kind', sale.kind);
  if (sale.kind === 'percent') q = q.eq('applies_to', sale.applies_to ?? 'both');
  else q = q.eq('grant_tier', sale.grant_tier ?? 0);
  const { data } = await q;
  return ((data as Array<{ id: string }>) || []).some((r) => r.id !== excludeId);
}

const SALE_CONFLICT_MSG = 'A live sale for that plan is already active. Deactivate it first — you can only run one active sale per plan.';

export async function createSiteSaleAction(input: {
  kind: 'percent' | 'free';
  percent_off?: number | null;
  applies_to?: 'monthly' | 'yearly' | 'both' | null;
  grant_tier?: number | null;
  grant_months?: number | null;
  starts_at?: string | null; // YYYY-MM-DD or ISO
  ends_at?: string | null;
  note?: string | null;
}): Promise<{ success: boolean; sale?: SiteSaleRow; error?: string }> {
  await requireAdmin();
  const admin = untyped(createAdminClient());
  const kind = input.kind === 'free' ? 'free' : 'percent';

  const parseStart = (raw?: string | null): string | null => {
    if (!raw) return null;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
  };
  const parseEnd = (raw?: string | null): string | null => {
    if (!raw) return null;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T23:59:59`) : new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
  };
  const startsAt = parseStart(input.starts_at);
  const endsAt = parseEnd(input.ends_at);
  if (input.starts_at && !startsAt) return { success: false, error: 'Invalid start date.' };
  if (input.ends_at && !endsAt) return { success: false, error: 'Invalid end date.' };
  if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return { success: false, error: 'End must be after start.' };
  }

  let percent: number | null = null;
  let appliesTo: 'monthly' | 'yearly' | 'both' | null = null;
  let couponId: string | null = null;
  let grantTier: number | null = null;
  let grantMonths: number | null = null;

  if (kind === 'percent') {
    percent = Math.trunc(Number(input.percent_off));
    if (!(percent >= 1 && percent <= 99)) return { success: false, error: 'Percent off must be 1–99.' };
    appliesTo = input.applies_to === 'monthly' || input.applies_to === 'yearly' ? input.applies_to : 'both';
    // Block a duplicate live sale for the same interval (checked before creating
    // the Stripe coupon so a rejected create leaves no orphan coupon).
    if (await siteSalePlanConflict(admin, { kind, applies_to: appliesTo })) {
      return { success: false, error: SALE_CONFLICT_MSG };
    }
    const duration: 'once' | 'forever' = appliesTo === 'both' ? 'forever' : 'once';
    try {
      const stripe = getStripe();
      const scopeLabel = appliesTo === 'monthly' ? 'first month' : appliesTo === 'yearly' ? 'first year' : 'forever';
      const coupon = await stripe.coupons.create({
        percent_off: percent,
        duration,
        name: `Site sale — ${percent}% off (${scopeLabel})`,
        ...(endsAt ? { redeem_by: Math.floor(new Date(endsAt).getTime() / 1000) } : {}),
      });
      couponId = coupon.id;
    } catch (e) {
      return { success: false, error: 'Stripe error: ' + ((e as Error).message || 'could not create coupon') };
    }
  } else {
    grantTier = Math.trunc(Number(input.grant_tier));
    if (![1, 2, 3, 4].includes(grantTier)) return { success: false, error: 'Pick a valid plan tier.' };
    grantMonths = Math.trunc(Number(input.grant_months));
    if (!(grantMonths >= 1 && grantMonths <= 60)) return { success: false, error: 'Months must be 1–60.' };
    // Block a duplicate live free sale for the same granted plan.
    if (await siteSalePlanConflict(admin, { kind, grant_tier: grantTier })) {
      return { success: false, error: SALE_CONFLICT_MSG };
    }
  }

  const { data, error } = await admin
    .from('site_sales')
    .insert({
      kind,
      percent_off: percent,
      applies_to: appliesTo,
      stripe_coupon_id: couponId,
      grant_tier: grantTier,
      grant_months: grantMonths,
      starts_at: startsAt,
      ends_at: endsAt,
      note: input.note?.trim() || null,
    } as unknown as never)
    .select('*')
    .single();
  if (error) return { success: false, error: 'Create failed: ' + error.message };

  revalidatePath('/admin');
  return { success: true, sale: data as SiteSaleRow };
}

export async function deactivateSiteSaleAction(
  id: string,
  active: boolean,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  const admin = untyped(createAdminClient());
  if (!id) return { success: false, error: 'id required' };
  // Turning a sale back ON must not collide with another already-active sale
  // for the same plan.
  if (active) {
    const { data: rowData } = await admin.from('site_sales').select('kind, applies_to, grant_tier').eq('id', id).maybeSingle();
    const row = rowData as { kind?: 'percent' | 'free'; applies_to?: 'monthly' | 'yearly' | 'both' | null; grant_tier?: number | null } | null;
    if (row?.kind && await siteSalePlanConflict(admin, { kind: row.kind, applies_to: row.applies_to, grant_tier: row.grant_tier }, id)) {
      return { success: false, error: SALE_CONFLICT_MSG };
    }
  }
  const { error } = await admin.from('site_sales').update({ active } as unknown as never).eq('id', id);
  if (error) return { success: false, error: error.message };
  revalidatePath('/admin');
  return { success: true };
}

// Edit a site-wide sale. Like discount codes, a percent sale's Stripe coupon is
// immutable — so for percent we mint a fresh coupon with the new values, point
// the row at it, and retire the old one. A free sale just updates its tier /
// months. The sale KIND can't change (that's effectively a different sale).
export async function editSiteSaleAction(
  id: string,
  input: {
    percent_off?: number | null;
    applies_to?: 'monthly' | 'yearly' | 'both' | null;
    grant_tier?: number | null;
    grant_months?: number | null;
    starts_at?: string | null;
    ends_at?: string | null;
  },
): Promise<{ success: boolean; sale?: SiteSaleRow; error?: string }> {
  await requireAdmin();
  const admin = untyped(createAdminClient());
  if (!id) return { success: false, error: 'id required' };

  const { data: rowData } = await admin.from('site_sales').select('kind, stripe_coupon_id, active').eq('id', id).maybeSingle();
  const existing = rowData as { kind?: 'percent' | 'free'; stripe_coupon_id?: string | null; active?: boolean } | null;
  if (!existing?.kind) return { success: false, error: 'Sale not found.' };

  const parseStart = (raw?: string | null): string | null => {
    if (!raw) return null;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
  };
  const parseEnd = (raw?: string | null): string | null => {
    if (!raw) return null;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T23:59:59`) : new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
  };
  const startsAt = parseStart(input.starts_at);
  const endsAt = parseEnd(input.ends_at);
  if (input.starts_at && !startsAt) return { success: false, error: 'Invalid start date.' };
  if (input.ends_at && !endsAt) return { success: false, error: 'Invalid end date.' };
  if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return { success: false, error: 'End must be after start.' };
  }

  const patch: Record<string, unknown> = { starts_at: startsAt, ends_at: endsAt };

  try {
    if (existing.kind === 'percent') {
      const percent = Math.trunc(Number(input.percent_off));
      if (!(percent >= 1 && percent <= 99)) return { success: false, error: 'Percent off must be 1–99.' };
      const appliesTo: 'monthly' | 'yearly' | 'both' =
        input.applies_to === 'monthly' || input.applies_to === 'yearly' ? input.applies_to : 'both';
      // If this sale is live, its new interval mustn't collide with another
      // active percent sale (checked before minting the replacement coupon).
      if (existing.active && await siteSalePlanConflict(admin, { kind: 'percent', applies_to: appliesTo }, id)) {
        return { success: false, error: SALE_CONFLICT_MSG };
      }
      const duration: 'once' | 'forever' = appliesTo === 'both' ? 'forever' : 'once';
      const stripe = getStripe();
      const scopeLabel = appliesTo === 'monthly' ? 'first month' : appliesTo === 'yearly' ? 'first year' : 'forever';
      const coupon = await stripe.coupons.create({
        percent_off: percent,
        duration,
        name: `Site sale — ${percent}% off (${scopeLabel})`,
        ...(endsAt ? { redeem_by: Math.floor(new Date(endsAt).getTime() / 1000) } : {}),
      });
      patch.percent_off = percent;
      patch.applies_to = appliesTo;
      patch.stripe_coupon_id = coupon.id;
      if (existing.stripe_coupon_id) { try { await stripe.coupons.del(existing.stripe_coupon_id); } catch { /* ignore */ } }
    } else {
      const grantTier = Math.trunc(Number(input.grant_tier));
      if (![1, 2, 3, 4].includes(grantTier)) return { success: false, error: 'Pick a valid plan tier.' };
      const grantMonths = Math.trunc(Number(input.grant_months));
      if (!(grantMonths >= 1 && grantMonths <= 60)) return { success: false, error: 'Months must be 1–60.' };
      // If this sale is live, its new granted plan mustn't collide with another
      // active free sale for the same tier.
      if (existing.active && await siteSalePlanConflict(admin, { kind: 'free', grant_tier: grantTier }, id)) {
        return { success: false, error: SALE_CONFLICT_MSG };
      }
      patch.grant_tier = grantTier;
      patch.grant_months = grantMonths;
    }

    const { data, error } = await admin.from('site_sales').update(patch as unknown as never).eq('id', id).select('*').single();
    if (error) return { success: false, error: 'Update failed: ' + error.message };
    revalidatePath('/admin');
    return { success: true, sale: data as SiteSaleRow };
  } catch (e) {
    return { success: false, error: 'Stripe error: ' + ((e as Error).message || 'could not update sale') };
  }
}

// Permanently delete a site-wide sale: drop our row and retire its Stripe coupon
// (percent sales only; best-effort).
export async function deleteSiteSaleAction(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();
  const admin = untyped(createAdminClient());
  if (!id) return { success: false, error: 'id required' };
  const { data: rowData } = await admin.from('site_sales').select('stripe_coupon_id').eq('id', id).maybeSingle();
  const couponId = (rowData as { stripe_coupon_id?: string | null } | null)?.stripe_coupon_id;
  // Drop its redemption rows too (no FK — code_id is polymorphic).
  await admin.from('code_redemptions').delete().eq('code_type', 'sale').eq('code_id', id);
  const { error } = await admin.from('site_sales').delete().eq('id', id);
  if (error) return { success: false, error: error.message };
  if (couponId) { try { await getStripe().coupons.del(couponId); } catch { /* ignore */ } }
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
