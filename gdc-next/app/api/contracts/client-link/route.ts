// POST /api/contracts/client-link
//
// Returns the client's DocuSeal signing link for a booking so the DJ (or host)
// can copy it and send it directly — handy if the DocuSeal email didn't land.
// Only the DJ (dj_id) or host (requester_id) on the booking may fetch it.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDocuseal } from '@/lib/docuseal';

export const runtime = 'nodejs';
export const maxDuration = 26;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: { bookingId?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const bookingId = typeof body.bookingId === 'string' && body.bookingId ? body.bookingId : null;
  if (!bookingId) return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });

  const admin = createAdminClient();
  let submissionId: string | null = null;
  try {
    const { data } = await admin
      .from('bookings')
      .select('contract_submission_id, dj_id, requester_id')
      .eq('id', bookingId)
      .maybeSingle();
    const row = data as { contract_submission_id?: string | null; dj_id?: string | null; requester_id?: string | null } | null;
    if (!row) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
    if (row.dj_id !== user.id && row.requester_id !== user.id) {
      return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
    }
    submissionId = row.contract_submission_id || null;
  } catch { submissionId = null; }
  if (!submissionId) return NextResponse.json({ error: 'No contract found for this booking.' }, { status: 404 });

  try {
    const docuseal = getDocuseal();
    const submission = await docuseal.getSubmission(Number(submissionId));
    type Sub = { role?: string; embed_src?: string | null; slug?: string | null; completed_at?: string | null };
    const submitters = ((submission as { submitters?: Sub[] })?.submitters) || [];
    const client = submitters.find((s) => s.role === 'Client');
    if (!client) return NextResponse.json({ error: 'Client signer not found on the contract.' }, { status: 404 });
    if (client.completed_at) {
      return NextResponse.json({ error: 'The client has already signed this contract.', signed: true }, { status: 409 });
    }
    const url = client.embed_src || (client.slug ? `https://docuseal.com/s/${client.slug}` : null);
    if (!url) return NextResponse.json({ error: 'Signing link isn’t available yet.' }, { status: 409 });
    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not get the signing link.' }, { status: 502 });
  }
}
