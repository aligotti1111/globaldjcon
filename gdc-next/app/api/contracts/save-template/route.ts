// POST /api/contracts/save-template
//
// Called after the DJ saves in the embedded builder. Stores the resulting
// DocuSeal template as a named row in the `contracts` table. Accepts an
// optional contractId to update an existing contract instead of creating one.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext, canSendContracts } from '@/lib/acting';
import { uniqueContractName } from '@/lib/contractName';
import { getDocuseal } from '@/lib/docuseal';

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

  const admin = createAdminClient();

  // SECURITY: the client supplies the DocuSeal template id, and all templates
  // live in ONE DocuSeal account — so without a check a DJ could point their
  // contract row at ANOTHER DJ's template id and then open/send it via the
  // builder. Reject any template that provably belongs to someone else:
  //   1. Our templates are created with external_id `dj_<djId>_…` — if it
  //      encodes a dj id, it must be ours.
  //   2. Regardless, the id must not already be linked to a DIFFERENT dj in our
  //      contracts table (covers uploaded/legacy templates with no external_id).
  try {
    const tmpl = await getDocuseal().getTemplate(Number(templateId)) as unknown as { external_id?: string | null };
    const ext = String(tmpl?.external_id || '');
    const m = ext.match(/^dj_([0-9a-fA-F-]+)_/);
    if (m && m[1] !== acting.djId) {
      return NextResponse.json({ error: 'That template belongs to another account.' }, { status: 403 });
    }
  } catch { /* template not found / API hiccup — fall through to the DB check */ }
  try {
    const { data: otherOwner } = await admin
      .from('contracts')
      .select('dj_id')
      .eq('docuseal_template_id', templateId)
      .neq('dj_id', acting.djId)
      .limit(1)
      .maybeSingle();
    if (otherOwner) {
      return NextResponse.json({ error: 'That template belongs to another account.' }, { status: 403 });
    }
  } catch { /* non-fatal: the external_id check above is the primary guard */ }

  try {
    let savedId = contractId;
    if (contractId) {
      // Editing anchor tags must NOT change what kind of contract this is. A
      // Standard (or Standard Wedding) contract keeps its is_standard flag —
      // only the DocuSeal template behind it is being re-saved here. Flipping
      // is_standard to false was relabelling Standard contracts as "Written".
      const finalName = await uniqueContractName(admin, acting.djId, name, contractId);
      const { error } = await admin
        .from('contracts')
        .update({
          name: finalName,
          docuseal_template_id: templateId,
          updated_at: new Date().toISOString(),
        } as unknown as never)
        .eq('id', contractId)
        .eq('dj_id', acting.djId);
      if (error) throw error;
    } else {
      const finalName = await uniqueContractName(admin, acting.djId, name);
      const { data, error } = await admin
        .from('contracts')
        .insert({
          dj_id: acting.djId,
          name: finalName,
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
