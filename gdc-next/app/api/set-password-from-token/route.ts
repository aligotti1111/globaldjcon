// POST /api/set-password-from-token
// Public endpoint used by /set-password after a claim approval.
//
// Replaces the vanilla Netlify function set-password-from-token.js.
// Same flow:
//   1. Client POSTs { token, password }
//   2. We look up the token in password_setup_tokens using service_role
//   3. Validate: token exists, not used, not expired
//   4. Set the user's password via auth.admin.updateUserById (with
//      email_confirm: true so they can sign in immediately)
//   5. Mark the token as used (one-time)
//
// Service role is used here because:
//   - The user has no session yet (they're activating their account)
//   - We need to write to auth.users (admin endpoint)
//   - We need to read+write password_setup_tokens (RLS-protected)

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

interface RequestBody {
  token?: unknown;
  password?: unknown;
}

interface TokenRow {
  token: string;
  user_id: string;
  email: string;
  expires_at: string;
  used_at: string | null;
}

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!token) {
    return NextResponse.json({ error: 'Token required' }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters' },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Step 1: look up the token row
  const { data: tokenRow, error: lookupErr } = await admin
    .from('password_setup_tokens')
    .select('*')
    .eq('token', token)
    .limit(1)
    .maybeSingle<TokenRow>();

  if (lookupErr) {
    return NextResponse.json({ error: 'Token lookup failed' }, { status: 500 });
  }
  if (!tokenRow) {
    // 404 → client uses this to show a "link no longer valid" full-error state
    return NextResponse.json(
      {
        error:
          'Invalid or unknown link. Ask the admin to re-approve your claim if you believe this is an error.',
      },
      { status: 404 }
    );
  }
  if (tokenRow.used_at) {
    // 410 → already used. Tell the user to use forgot-password instead.
    return NextResponse.json(
      {
        error:
          'This link has already been used. If you need to change your password, use the Forgot Password option on the sign-in page.',
      },
      { status: 410 }
    );
  }
  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return NextResponse.json(
      {
        error:
          'This link has expired. Ask the admin to re-approve your claim to get a new link.',
      },
      { status: 410 }
    );
  }

  // Step 2: set the password on the auth user (auto-confirm so they can sign in)
  const { error: updateErr } = await admin.auth.admin.updateUserById(tokenRow.user_id, {
    password,
    email_confirm: true,
  });
  if (updateErr) {
    console.error('[set-password-from-token] password update failed:', updateErr);
    return NextResponse.json(
      { error: 'Failed to set password: ' + updateErr.message },
      { status: 500 }
    );
  }

  // Step 3: mark token as used (one-time). Non-fatal if it fails.
  await admin
    .from('password_setup_tokens')
    .update({ used_at: new Date().toISOString() } as unknown as never)
    .eq('token', token);

  return NextResponse.json({
    success: true,
    email: tokenRow.email,
    message: 'Password set. You can now sign in.',
  });
}
