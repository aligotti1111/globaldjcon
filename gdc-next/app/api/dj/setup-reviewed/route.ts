// POST /api/dj/setup-reviewed
//
// Marks the acting DJ account as having seen the first-time "Review booking
// settings" prompt. Once set, the prompt never shows again — including after a
// cancel → resubscribe — because setup_reviewed lives on the account, not in a
// per-browser localStorage key.
//
// Session required. Scoped to the ACTING dj (the owner's id when a teammate is
// signed in), so the whole team shares one flag.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext } from '@/lib/acting';

export const runtime = 'nodejs';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const acting = await getActingContext(user.id);
  const djId = acting.djId || user.id;

  const admin = createAdminClient();
  // setup_reviewed postdates the generated types — one untyped cast to write it.
  await admin
    .from('users')
    .update({ setup_reviewed: true } as unknown as never)
    .eq('id', djId);

  return NextResponse.json({ ok: true });
}
