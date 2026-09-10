// /api/dj/payment-methods — saves users.payment_methods. OWNER ONLY.
//
// Payment options decide where a booking's money lands, so NO team member —
// admin, manager, or assistant — may change them, regardless of which UI path
// they reach the editor through. The client editor POSTs here; the acting role
// gate is the real enforcement (the UI locks are convenience, not security).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getActingContext } from '@/lib/acting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const acting = await getActingContext(user.id);
  if (acting.role !== 'owner') {
    return NextResponse.json({ error: 'Only the account owner can change payment options.' }, { status: 403 });
  }

  let body: { methods?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  if (!Array.isArray(body.methods)) {
    return NextResponse.json({ error: 'Missing methods.' }, { status: 400 });
  }

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { error } = await admin
    .from('users')
    .update({ payment_methods: body.methods } as unknown as never)
    .eq('id', acting.djId);
  if (error) return NextResponse.json({ error: 'Could not save.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
