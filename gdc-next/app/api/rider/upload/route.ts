// POST /api/rider/upload — the DJ uploads a pre-made rider PDF.
//
// Mirrors the logo-upload pattern (Supabase storage upload + return the stored
// URL), but for a PDF and done server-side: the file rides in as multipart
// FormData, we push the bytes to the public `avatars` bucket under the DJ's id,
// and hand back the public URL. The CALLER persists that URL — as
// booking_settings.rider_pdf_url (default) or booking_riders.rider_pdf_url
// (per booking) — through the existing save flows.
//
// Session required. booking_riders / the new columns postdate the generated DB
// types, so the admin client is cast (house pattern). Never 502 — always 500.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { getActingContext } from '@/lib/acting';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
    const acting = await getActingContext(user.id);

    let form: FormData;
    try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 }); }
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file.' }, { status: 400 });

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) return NextResponse.json({ error: 'The rider must be a PDF.' }, { status: 400 });
    if (file.size === 0) return NextResponse.json({ error: 'The file is empty.' }, { status: 400 });
    if (file.size > 12 * 1024 * 1024) return NextResponse.json({ error: 'PDF is too large (max 12MB).' }, { status: 400 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const admin = createAdminClient() as unknown as SupabaseClient;
    const path = `${acting.djId}/rider_${Date.now()}.pdf`;
    const { error: upErr } = await admin.storage
      .from('avatars')
      .upload(path, bytes, { upsert: true, contentType: 'application/pdf' });
    if (upErr) return NextResponse.json({ error: 'Could not store the PDF.' }, { status: 500 });

    const { data } = admin.storage.from('avatars').getPublicUrl(path);
    const url = `${data.publicUrl}?t=${Date.now()}`;
    return NextResponse.json({ ok: true, url });
  } catch {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
