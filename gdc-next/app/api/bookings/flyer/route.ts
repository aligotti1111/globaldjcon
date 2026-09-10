// /api/bookings/flyer — set / remove a club booking's event flyer.
//
// The flyer lived as two browser writes: a Storage upload into the DJ's folder
// and a bookings.flyer_url update. Both are RLS-scoped to the auth user, so a
// TEAM MEMBER (whose folder/booking belong to the OWNER) could do neither — the
// upload was refused and the row update silently matched nothing. Both now run
// here with the admin client, scoped to the acting OWNER, gated assistant+
// (every seat may update a flyer, per the role matrix).
//
//   POST  (multipart)  fields: bookingId, file  → upload + set flyer_url
//   DELETE (json)      { bookingId }             → clear flyer_url

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext, canSendDocs } from '@/lib/acting';

export const runtime = 'nodejs';
export const maxDuration = 26;

const BUCKET = 'avatars';

async function authorize() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) };
  const acting = await getActingContext(user.id);
  if (!canSendDocs(acting.role)) {
    return { error: NextResponse.json({ error: 'Your role cannot update the flyer.' }, { status: 403 }) };
  }
  return { djId: acting.djId, admin: createAdminClient() as unknown as SupabaseClient };
}

export async function POST(req: Request) {
  const auth = await authorize();
  if ('error' in auth) return auth.error;
  const { djId, admin } = auth;

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Invalid form data' }, { status: 400 }); }
  const bookingId = String(form.get('bookingId') || '');
  const file = form.get('file');
  if (!bookingId || !(file instanceof File)) {
    return NextResponse.json({ error: 'Missing bookingId or file' }, { status: 400 });
  }

  // Confirm the booking belongs to the acting owner before touching anything.
  const { data: bRow } = await admin.from('bookings').select('id, dj_id').eq('id', bookingId).maybeSingle();
  if (!bRow || (bRow as { dj_id?: string | null }).dj_id !== djId) {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
  }

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${djId}/flyers/${bookingId}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, { upsert: true, contentType: file.type || 'image/jpeg' });
  if (upErr) return NextResponse.json({ error: upErr.message || 'Upload failed' }, { status: 400 });

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = `${pub.publicUrl}?t=${Date.now()}`;

  const { error: updErr } = await admin
    .from('bookings')
    .update({ flyer_url: publicUrl } as unknown as never)
    .eq('id', bookingId)
    .eq('dj_id', djId);
  if (updErr) return NextResponse.json({ error: 'Could not save the flyer.' }, { status: 500 });

  return NextResponse.json({ ok: true, url: publicUrl });
}

export async function DELETE(req: Request) {
  const auth = await authorize();
  if ('error' in auth) return auth.error;
  const { djId, admin } = auth;

  let body: { bookingId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const bookingId = typeof body.bookingId === 'string' ? body.bookingId : '';
  if (!bookingId) return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });

  const { error } = await admin
    .from('bookings')
    .update({ flyer_url: null } as unknown as never)
    .eq('id', bookingId)
    .eq('dj_id', djId);
  if (error) return NextResponse.json({ error: 'Could not remove the flyer.' }, { status: 500 });

  return NextResponse.json({ ok: true });
}
