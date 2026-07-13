// POST /api/contracts/signed-doc
//
// Returns download URLs for a completed contract so the DJ can grab their copy
// in-app: the signed contract PDF (combined_document_url) and the audit log.
// DJ-only (must own the booking). Works once the submission is completed.

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

  // Find the submission for this booking. EITHER party may download the signed
  // contract — the DJ (dj_id) or the host/booker (requester_id).
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
    const s = submission as {
      status?: string;
      audit_log_url?: string | null;
      combined_document_url?: string | null;
      documents?: Array<{ url?: string | null }> | null;
    };
    const contract = s.combined_document_url || s.documents?.[0]?.url || null;
    const audit = s.audit_log_url || null;
    if (!contract && !audit) {
      return NextResponse.json(
        { error: 'The signed contract isn’t ready yet. It appears here once both parties have signed.' },
        { status: 409 },
      );
    }
    // Self-heal: a signed doc / audit log only exists once the submission is
    // completed, so make sure the booking's status reflects that (covers rows
    // whose webhook never fired). Idempotent, non-fatal.
    try {
      await admin.from('bookings').update({ contract_status: 'signed' } as unknown as never).eq('id', bookingId);
    } catch { /* non-fatal */ }
    return NextResponse.json({ contract, audit });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not fetch the signed contract.' },
      { status: 502 },
    );
  }
}
