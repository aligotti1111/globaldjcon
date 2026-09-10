// GET /api/me/role — the current user's ACTING role (owner/admin/manager/
// assistant) resolved via getActingContext. Client nav (header, burger, DJ
// menu) uses this to hide items a teammate's role can't use. Safe for any
// authenticated user (unlike /api/team/settings which is manager+).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getActingContext } from '@/lib/acting';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ role: null, isMember: false }, { status: 200 });
  const acting = await getActingContext(user.id);

  // For a team member, surface the OWNER's slug so nav can link to the profile
  // they manage ("View Profile"). Owners already have their own slug in state.
  let ownerSlug: string | null = null;
  if (acting.isMember) {
    const admin = createAdminClient() as unknown as SupabaseClient;
    const { data } = await admin.from('users').select('slug').eq('id', acting.djId).maybeSingle();
    ownerSlug = (data as unknown as { slug?: string | null } | null)?.slug ?? null;
  }

  return NextResponse.json({ role: acting.role, isMember: acting.isMember, djId: acting.djId, ownerSlug });
}
