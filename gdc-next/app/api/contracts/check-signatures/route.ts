// POST /api/contracts/check-signatures
//
// Reports whether a contract's DocuSeal template has the signature fields each
// party needs. Used by the anchor-tags (fields) page to block saving/sending a
// WRITTEN or UPLOADED contract that has no Client signature — nothing should go
// to a client with no way for them to sign.
//
// Standard / wedding contracts are assembled fresh at send with a guaranteed
// signature block, so they always pass (reported hasClient: true) without a
// DocuSeal round-trip.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext, canSendContracts } from '@/lib/acting';
import { getDocuseal } from '@/lib/docuseal';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const acting = await getActingContext(user.id);
  if (!canSendContracts(acting.role)) {
    return NextResponse.json({ error: 'Your account level cannot manage contracts.' }, { status: 403 });
  }

  let contractId = '';
  try {
    const body = await req.json();
    if (body && typeof body.contractId === 'string') contractId = body.contractId;
  } catch { /* no body */ }
  if (!contractId) return NextResponse.json({ error: 'Missing contract id' }, { status: 400 });

  const admin = createAdminClient();
  const { data } = await admin
    .from('contracts')
    .select('docuseal_template_id, is_standard')
    .eq('id', contractId)
    .eq('dj_id', acting.djId)
    .maybeSingle();

  const row = data as { docuseal_template_id?: string | null; is_standard?: boolean | null } | null;
  // Standard / wedding contracts get a guaranteed signature block at send, so
  // there's nothing to check here — report both present.
  if (row?.is_standard) {
    return NextResponse.json({ ok: true, hasClient: true, hasDj: true, standard: true });
  }

  const templateId = row?.docuseal_template_id || null;
  // No template yet = nothing placed = no client signature.
  if (!templateId) {
    return NextResponse.json({ ok: true, hasClient: false, hasDj: false });
  }

  try {
    const docuseal = getDocuseal();
    const tpl = await docuseal.getTemplate(Number(templateId)) as unknown as {
      fields?: Array<{ type?: string; submitter_uuid?: string }>;
      submitters?: Array<{ uuid?: string; name?: string }>;
    };
    const subs = tpl?.submitters || [];
    const roleOf = (uuid?: string) => subs.find((s) => s.uuid === uuid)?.name || '';
    const sigFields = (tpl?.fields || []).filter((f) => (f.type || '').toLowerCase() === 'signature');
    // The client signer role is "Client/Host" on new templates, "Client" on
    // ones built before the rename — accept either.
    const isClientRole = (r: string) => r === 'Client/Host' || r === 'Client';
    const hasClient = sigFields.some((f) => isClientRole(roleOf(f.submitter_uuid)));
    const hasDj = sigFields.some((f) => roleOf(f.submitter_uuid) === 'DJ');
    return NextResponse.json({ ok: true, hasClient, hasDj });
  } catch (e) {
    // Fail OPEN: if we can't read the template, don't wrongly block the DJ. The
    // send step (prepare) does the same signature check as a backstop.
    return NextResponse.json({ ok: true, hasClient: true, hasDj: true, unchecked: true, note: e instanceof Error ? e.message : 'check failed' });
  }
}
