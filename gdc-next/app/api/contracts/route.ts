// /api/contracts — list, rename, and delete the acting account's saved
// contracts. These used to be client-side Supabase queries in ContractPortal,
// which RLS blocks for a teammate reading/writing the OWNER's rows. Moving them
// to the server (admin client + acting authorization) is what lets an admin or
// manager actually see, rename, and delete the owner's saved contracts.
//
//   GET    -> list the owner's contracts (any staff login may read)
//   PATCH  -> rename one   { id, name }        (manager+)
//   DELETE -> remove one   ?id=...             (manager+)

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext, canSendContracts } from '@/lib/acting';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const acting = await getActingContext(user.id);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('contracts')
    .select('id, name, docuseal_template_id, is_standard, body_text, updated_at')
    .eq('dj_id', acting.djId)
    .order('is_standard', { ascending: true })
    .order('updated_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contracts: data || [] });
}

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const acting = await getActingContext(user.id);
  if (!canSendContracts(acting.role)) {
    return NextResponse.json({ error: 'Your account level cannot manage contracts.' }, { status: 403 });
  }

  let body: { id?: unknown; name?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const id = typeof body.id === 'string' && body.id ? body.id : null;
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
  if (!id || !name) return NextResponse.json({ error: 'Missing id or name' }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from('contracts')
    .update({ name, updated_at: new Date().toISOString() } as unknown as never)
    .eq('id', id)
    .eq('dj_id', acting.djId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const acting = await getActingContext(user.id);
  if (!canSendContracts(acting.role)) {
    return NextResponse.json({ error: 'Your account level cannot manage contracts.' }, { status: 403 });
  }

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from('contracts')
    .delete()
    .eq('id', id)
    .eq('dj_id', acting.djId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
