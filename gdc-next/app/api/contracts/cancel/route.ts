// POST /api/contracts/cancel
//
// Cancels a contract that was already sent for a booking: voids (archives) the
// DocuSeal submission so the client's copy is no longer signable, and clears
// the booking's contract status so the DJ can review and send a new one.

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

  // Find the submission for this booking (DJ must own it) and its status.
  let submissionId: string | null = null;
  let status: string | null = null;
  try {
    const { data } = await admin
      .from('bookings')
      .select('contract_submission_id, contract_status')
      .eq('id', bookingId)
      .eq('dj_id', user.id)
      .maybeSingle();
    const row = data as { contract_submission_id?: string | null; contract_status?: string | null } | null;
    submissionId = row?.contract_submission_id || null;
    status = row?.contract_status || null;
  } catch { submissionId = null; }

  // A fully signed contract can't be cancelled — it's an executed agreement.
  if (status === 'signed') {
    return NextResponse.json({ error: 'This contract has been signed and can no longer be cancelled.' }, { status: 400 });
  }

  // Void the DocuSeal submission (best-effort — clearing the booking is what
  // lets the DJ send again, so we don't hard-fail if the archive call errors).
  if (submissionId) {
    try {
      const docuseal = getDocuseal();
      await docuseal.archiveSubmission(Number(submissionId));
    } catch { /* best-effort */ }
  }

  // Clear the booking's contract state so "Review & Send Contract" comes back.
  try {
    await admin
      .from('bookings')
      .update({
        contract_status: null,
        contract_submission_id: null,
        contract_sent_at: null,
      } as unknown as never)
      .eq('id', bookingId)
      .eq('dj_id', user.id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not cancel the contract.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
