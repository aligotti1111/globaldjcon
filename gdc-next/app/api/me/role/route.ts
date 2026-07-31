// GET /api/me/role — the current user's ACTING role (owner/admin/manager/
// assistant) resolved via getActingContext. Client nav (header, burger, DJ
// menu) uses this to hide items a teammate's role can't use. Safe for any
// authenticated user (unlike /api/team/settings which is manager+).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActingContext } from '@/lib/acting';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ role: null, isMember: false }, { status: 200 });
  const acting = await getActingContext(user.id);
  return NextResponse.json({ role: acting.role, isMember: acting.isMember, djId: acting.djId });
}
