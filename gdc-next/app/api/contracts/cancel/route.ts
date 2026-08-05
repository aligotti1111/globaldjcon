// POST /api/contracts/cancel
//
// Cancels a contract that was already sent for a booking: voids (archives) the
// DocuSeal submission so the client's copy is no longer signable, and marks
// the booking's contract status 'cancelled' so the DJ can review and send a
// new one.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDocuseal } from '@/lib/docuseal';
import { getActingContext, canSendContracts } from '@/lib/acting';

export const runtime = 'nodejs';
export const maxDuration = 26;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  // Resolve the account being acted on (owner's id if a teammate) and gate:
  // cancelling a contract is the same trust level as sending one — manager+.
  // Filtering on the RESOLVED djId (not user.id) is also what makes cancel
  // actually work for teammates: a manager's user.id never equals the
  // booking's dj_id, so the old .eq('dj_id', djId) matched zero rows and
  // silently cancelled nothing.
  const acting = await getActingContext(user.id);
  if (!canSendContracts(acting.role)) {
    return NextResponse.json({ error: 'Your account level cannot cancel contracts.' }, { status: 403 });
  }
  const djId = acting.djId;

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
      .eq('dj_id', djId)
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

  // Reset the booking's contract state so "Review & Send Contract" comes back.
  //
  // 'cancelled', NOT null. Nulling it erased the fact a contract ever existed,
  // and the booking card's pipeline decides whether to show the contract stage
  // with `requires_contract || contract_status`. A booking that never REQUIRED
  // a contract but was sent one anyway — which the details panel allows, it has
  // no requires_contract gate — had the stage only because contract_status was
  // set. Cancelling nulled it, so the whole contract icon vanished from the
  // pipeline, taking "Send contract" with it at the exact moment the DJ needs
  // to send the replacement. The panel would say "review and send a new one"
  // while the pipeline had just deleted the way to do it.
  //
  // Nothing gates sending on this being null: every other read checks only for
  // 'awaiting_client' or 'signed'. 'cancelled' falls through both, so the panel
  // still offers Review & Send, and the pipeline shows the stage in amber —
  // which is what a cancel means. Back to un-sent, not never-existed.
  //
  // submission_id and sent_at still clear: those describe the DocuSeal document
  // we just voided, and it's genuinely gone.
  try {
    await admin
      .from('bookings')
      .update({
        contract_status: 'cancelled',
        contract_submission_id: null,
        contract_sent_at: null,
        // Timestamp the cancellation so the booking log can show it.
        contract_cancelled_at: new Date().toISOString(),
      } as unknown as never)
      .eq('id', bookingId)
      .eq('dj_id', djId);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not cancel the contract.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
