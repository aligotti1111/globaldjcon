// POST /api/contracts/send-client
//
// Called after the DJ has reviewed and signed their contract. Emails the client
// their copy to sign. The client is deliberately NOT emailed when the contract
// is first prepared — only here, once the DJ clicks "Send contract" and signs —
// so nothing goes out until the DJ is ready.

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

  // Find the submission created for this booking (DJ must own it).
  let submissionId: string | null = null;
  try {
    const { data } = await admin
      .from('bookings')
      .select('contract_submission_id')
      .eq('id', bookingId)
      .eq('dj_id', user.id)
      .maybeSingle();
    submissionId = (data as { contract_submission_id?: string | null } | null)?.contract_submission_id || null;
  } catch { submissionId = null; }
  if (!submissionId) return NextResponse.json({ error: 'No contract found for this booking.' }, { status: 404 });

  // Look up the client submitter and send them their signing email.
  try {
    const docuseal = getDocuseal();
    const submission = await docuseal.getSubmission(Number(submissionId));
    type Submitter = { id?: number | string; role?: string };
    const submitters = ((submission as { submitters?: Submitter[] })?.submitters) || [];
    const client = submitters.find((s) => s.role === 'Client');
    if (client?.id == null) throw new Error('Client signer not found on the contract.');
    await docuseal.updateSubmitter(Number(client.id), { send_email: true } as unknown as Parameters<typeof docuseal.updateSubmitter>[1]);

    // The DJ has already signed by this point; enabling their email lets DocuSeal
    // send the DJ the final SIGNED copy once the client completes. (No new signing
    // request is generated for an already-completed signer.) So both parties get
    // the finished PDF, not just the client.
    const djSigner = submitters.find((s) => s.role === 'DJ');
    if (djSigner?.id != null) {
      try {
        await docuseal.updateSubmitter(Number(djSigner.id), { send_email: true } as unknown as Parameters<typeof docuseal.updateSubmitter>[1]);
      } catch { /* non-fatal — client email is the critical one */ }
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not email the client.' },
      { status: 502 },
    );
  }

  try {
    await admin
      .from('bookings')
      .update({ contract_status: 'awaiting_client' } as unknown as never)
      .eq('id', bookingId)
      .eq('dj_id', user.id);
  } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true });
}
