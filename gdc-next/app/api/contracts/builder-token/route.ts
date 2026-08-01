// POST /api/contracts/builder-token
//
// Generates the signed JWT that authorizes the embedded DocuSeal form builder
// for the current DJ. Optionally reopens a specific existing contract's
// template (when editing) via a contractId in the request body.
//
// Requires env vars:
//   DOCUSEAL_API_KEY    — used to sign the JWT (same key used for the API)
//   DOCUSEAL_USER_EMAIL — the admin email of your DocuSeal account (owner of the key)

import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext, canSendContracts } from '@/lib/acting';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  // Resolve the account being acted on (owner's id when a teammate) and gate:
  // creating/editing/uploading contracts is manager+ (same as sending).
  const acting = await getActingContext(user.id);
  if (!canSendContracts(acting.role)) {
    return NextResponse.json({ error: 'Your account level cannot manage contracts.' }, { status: 403 });
  }

  const apiKey = process.env.DOCUSEAL_API_KEY;
  const adminEmail = process.env.DOCUSEAL_USER_EMAIL;
  if (!apiKey || !adminEmail) {
    return NextResponse.json({ error: 'Contract builder is not configured.' }, { status: 500 });
  }

  let contractId: string | null = null;
  let name = 'Booking Contract';
  try {
    const body = await req.json();
    if (body && typeof body.contractId === 'string') contractId = body.contractId || null;
    if (body && typeof body.name === 'string' && body.name.trim()) name = body.name.trim();
  } catch { /* no body — fresh builder */ }

  // If editing an existing contract, reopen its template so the DJ can adjust it.
  let templateId: string | null = null;
  if (contractId) {
    try {
      const admin = createAdminClient();
      const { data } = await admin
        .from('contracts')
        .select('docuseal_template_id')
        .eq('id', contractId)
        .eq('dj_id', acting.djId)
        .maybeSingle();
      templateId = (data as { docuseal_template_id?: string | null } | null)?.docuseal_template_id || null;
    } catch {
      templateId = null;
    }
  }

  const payload: Record<string, unknown> = {
    user_email: adminEmail,
    integration_email: `dj_${acting.djId}@globaldjconnect.com`,
    external_id: `dj_${acting.djId}_${contractId || Date.now()}`,
    name,
  };
  if (templateId) payload.template_id = Number(templateId) || templateId;

  const token = jwt.sign(payload, apiKey);
  return NextResponse.json({ token });
}
