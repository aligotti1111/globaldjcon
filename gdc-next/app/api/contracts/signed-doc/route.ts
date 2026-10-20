// POST /api/contracts/signed-doc
//
// Returns download URLs for a completed contract so the DJ can grab their copy
// in-app: the signed contract PDF (combined_document_url) and the audit log.
// DJ-only (must own the booking). Works once the submission is completed.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDocuseal } from '@/lib/docuseal';
import { getActingContext } from '@/lib/acting';
import { isAdminUser } from '@/lib/supabase/admin-auth';

export const runtime = 'nodejs';
export const maxDuration = 26;

// Resolve the signed-contract + audit-log URLs for a booking, after checking the
// caller is allowed to see them. Returns either the URLs or an error + HTTP
// status. Shared by POST (returns the URLs as JSON) and GET (streams the file).
async function resolveSignedDocs(
  bookingId: string,
  userId: string,
): Promise<{ contract: string | null; audit: string | null } | { error: string; status: number }> {
  const acting = await getActingContext(userId);
  const admin_ = await isAdminUser();
  const admin = createAdminClient();
  let submissionId: string | null = null;
  try {
    const { data } = await admin
      .from('bookings')
      .select('contract_submission_id, dj_id, requester_id')
      .eq('id', bookingId)
      .maybeSingle();
    const row = data as { contract_submission_id?: string | null; dj_id?: string | null; requester_id?: string | null } | null;
    if (!row) return { error: 'Booking not found.', status: 404 };
    if (!admin_ && row.dj_id !== acting.djId && row.requester_id !== userId) {
      return { error: 'Not allowed.', status: 403 };
    }
    submissionId = row.contract_submission_id || null;
  } catch { submissionId = null; }
  if (!submissionId) return { error: 'No contract found for this booking.', status: 404 };

  try {
    const docuseal = getDocuseal();
    const submission = await docuseal.getSubmission(Number(submissionId));
    const s = submission as {
      audit_log_url?: string | null;
      combined_document_url?: string | null;
      documents?: Array<{ url?: string | null }> | null;
    };
    const contract = s.combined_document_url || s.documents?.[0]?.url || null;
    const audit = s.audit_log_url || null;
    if (!contract && !audit) {
      return { error: 'The signed contract isn’t ready yet. It appears here once both parties have signed.', status: 409 };
    }
    try {
      await admin.from('bookings').update({ contract_status: 'signed' } as unknown as never).eq('id', bookingId);
    } catch { /* non-fatal */ }
    return { contract, audit };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not fetch the signed contract.', status: 502 };
  }
}

// GET /api/contracts/signed-doc?bookingId=…&which=contract|audit
//
// Streams the signed contract (or audit log) PDF back with Content-Disposition:
// attachment, so an in-app <a download> actually SAVES the file instead of
// opening the remote Docuseal URL in a new browser tab (which just views it).
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const url = new URL(req.url);
  const bookingId = url.searchParams.get('bookingId') || '';
  const which = url.searchParams.get('which') === 'audit' ? 'audit' : 'contract';
  if (!bookingId) return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });

  const resolved = await resolveSignedDocs(bookingId, user.id);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  const docUrl = which === 'audit' ? resolved.audit : resolved.contract;
  if (!docUrl) {
    return NextResponse.json(
      { error: which === 'audit' ? 'The audit log isn’t available yet.' : 'The signed contract isn’t ready yet.' },
      { status: 409 },
    );
  }

  // Pull the PDF server-side (the Docuseal URL is remote / cross-origin, so the
  // browser can't force-download it directly) and hand it back as an attachment.
  try {
    const upstream = await fetch(docUrl);
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
    const buf = await upstream.arrayBuffer();
    const filename = which === 'audit' ? `Contract-Audit-${bookingId.slice(0, 6)}.pdf` : `Contract-${bookingId.slice(0, 6)}.pdf`;
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Could not fetch the signed contract.' }, { status: 502 });
  }
}

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
  // TEAM SEATS: teammate → owner's booking (dj_id === acting.djId); host → own
  // account (requester_id === user.id). Keying only to user.id 403'd teammates.
  const acting = await getActingContext(user.id);
  // A platform admin can download any booking's signed contract (read-only).
  const admin_ = await isAdminUser();
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
    if (!admin_ && row.dj_id !== acting.djId && row.requester_id !== user.id) {
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
