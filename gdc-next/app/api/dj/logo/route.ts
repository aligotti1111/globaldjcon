// /api/dj/logo — the one place the DJ's business logo is mutated, so the shared
// rules live in one spot:
//
//   op:'set'   { url }             — set the shared logo (users.contract_logo_url)
//                                    AND clear every per-booking hide, so the new
//                                    logo shows EVERYWHERE again. Used when a DJ
//                                    adds/changes the logo (account settings, the
//                                    planner editor).
//   op:'clear'                     — delete the logo everywhere (field → null).
//   op:'hide'  { bookingId }       — hide the logo on ONE client's planner only.
//   op:'show'  { bookingId }       — un-hide it on that planner.
//
// DJ-authed by session. booking_planners postdates the generated DB types, so
// it's touched through an admin client cast (house pattern). Never 502 —
// Cloudflare eats the body; always 500.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext, canEditProfile } from '@/lib/acting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

    // TEAM SEATS: the logo belongs to the OWNER's account. A teammate who may
    // edit the profile / send documents may change it, and it must be stored on
    // the owner's row (acting.djId) — keying to user.id stored it on the
    // teammate's own row and 404'd the per-planner hide/show for them.
    const acting = await getActingContext(user.id);
    if (!canEditProfile(acting.role)) {
      return NextResponse.json({ error: 'You do not have permission to change the logo.' }, { status: 403 });
    }
    const djId = acting.djId;

    const admin = createAdminClient();
    const db = admin as unknown as SupabaseClient;

    const body = (await req.json().catch(() => ({}))) as {
      op?: string;
      url?: string;
      bookingId?: string;
    };
    const op = body.op;

    if (op === 'set') {
      const url = typeof body.url === 'string' && body.url.trim() ? body.url : null;
      if (!url) return NextResponse.json({ error: 'Missing logo url.' }, { status: 400 });
      const { error: e1 } = await admin
        .from('users')
        .update({ contract_logo_url: url } as unknown as never)
        .eq('id', djId);
      if (e1) return NextResponse.json({ error: 'Could not save the logo.' }, { status: 500 });
      // Change overrides all instances — un-hide every planner so the new logo
      // shows everywhere again.
      await db
        .from('booking_planners')
        .update({ logo_hidden: false } as unknown as never)
        .eq('dj_id', djId);
      return NextResponse.json({ ok: true, url });
    }

    if (op === 'clear') {
      const { error } = await admin
        .from('users')
        .update({ contract_logo_url: null } as unknown as never)
        .eq('id', djId);
      if (error) return NextResponse.json({ error: 'Could not remove the logo.' }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (op === 'hide' || op === 'show') {
      const bookingId = typeof body.bookingId === 'string' ? body.bookingId : '';
      if (!/^[0-9a-f-]{36}$/i.test(bookingId)) {
        return NextResponse.json({ error: 'Missing booking.' }, { status: 400 });
      }
      const { data: bp } = await db
        .from('booking_planners')
        .select('id, dj_id')
        .eq('booking_id', bookingId)
        .maybeSingle();
      const row = bp as unknown as { id: string; dj_id: string } | null;
      // 404 (not 403) if it isn't theirs — don't confirm a guessed id exists.
      if (!row) return NextResponse.json({ error: "This planner hasn't been sent yet." }, { status: 404 });
      if (row.dj_id !== djId) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
      const { error } = await db
        .from('booking_planners')
        .update({ logo_hidden: op === 'hide' } as unknown as never)
        .eq('id', row.id);
      if (error) return NextResponse.json({ error: 'Could not update.' }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown operation.' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
