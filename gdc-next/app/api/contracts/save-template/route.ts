// POST /api/contracts/save-template
//
// Called after the DJ saves in the embedded builder. Stores the resulting
// DocuSeal template as a named row in the `contracts` table. Accepts an
// optional contractId to update an existing contract instead of creating one.

import { NextResponse } from 'next/server';
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

  let body: { templateId?: unknown; name?: unknown; contractId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const templateId = body.templateId != null ? String(body.templateId) : '';
  const name = (typeof body.name === 'string' && body.name.trim()) ? body.name.trim() : 'Your contract';
  const contractId = typeof body.contractId === 'string' && body.contractId ? body.contractId : null;
  if (!templateId) return NextResponse.json({ error: 'Missing template id' }, { status: 400 });

  try {
    const admin = createAdminClient();
    let savedId = contractId;
    if (contractId) {
      const { error } = await admin
        .from('contracts')
        .update({
          name,
          docuseal_template_id: templateId,
          is_standard: false,
          updated_at: new Date().toISOString(),
        } as unknown as never)
        .eq('id', contractId)
        .eq('dj_id', acting.djId);
      if (error) throw error;
    } else {
      const { data, error } = await admin
        .from('contracts')
        .insert({
          dj_id: acting.djId,
          name,
          docuseal_template_id: templateId,
          is_standard: false,
        } as unknown as never)
        .select('id')
        .single();
      if (error) throw error;
      savedId = (data as { id?: string } | null)?.id || null;
    }
    return NextResponse.json({ ok: true, contractId: savedId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not save.' },
      { status: 500 },
    );
  }
}
