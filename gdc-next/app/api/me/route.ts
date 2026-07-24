// GET /api/me — the current user's acting context (for client-side UI gating).
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActingContext } from '@/lib/acting';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const ctx = await getActingContext(user.id);
  return NextResponse.json({ ok: true, ...ctx });
}
