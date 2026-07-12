// POST /api/contracts/standard
//
// Creates or updates one of the DJ's named contracts from the editable standard
// text. Builds a DocuSeal HTML template and stores it as a row in the
// `contracts` table. Accepts an optional contractId to edit an existing one.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDocuseal, buildContractHtml } from '@/lib/docuseal';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: { text?: unknown; logoUrl?: unknown; name?: unknown; contractId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const text = typeof body.text === 'string' ? body.text : '';
  const logoUrl = typeof body.logoUrl === 'string' && body.logoUrl ? body.logoUrl : null;
  const name = (typeof body.name === 'string' && body.name.trim()) ? body.name.trim() : 'Standard contract';
  const contractId = typeof body.contractId === 'string' && body.contractId ? body.contractId : null;
  if (!text.trim()) return NextResponse.json({ error: 'Contract text is empty' }, { status: 400 });

  let templateId: string | number | undefined;
  try {
    const docuseal = getDocuseal();
    const html = buildContractHtml(text, logoUrl);
    const template = await docuseal.createTemplateFromHtml({
      name: `${name} — ${user.id}`,
      html,
      external_id: `dj_${user.id}_${Date.now()}`,
    });
    templateId = (template as { id?: string | number }).id;
    if (templateId == null) throw new Error('No template id returned');
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not build the contract.' },
      { status: 502 },
    );
  }

  try {
    const admin = createAdminClient();
    let savedId = contractId;
    if (contractId) {
      const { error } = await admin
        .from('contracts')
        .update({
          name,
          docuseal_template_id: String(templateId),
          logo_url: logoUrl,
          is_standard: true,
          // Keep the raw text so per-booking contracts (e.g. the wedding
          // contract) can be rebuilt fresh with the booking's data baked in.
          body_text: text,
          updated_at: new Date().toISOString(),
        } as unknown as never)
        .eq('id', contractId)
        .eq('dj_id', user.id);
      if (error) throw error;
    } else {
      const { data, error } = await admin
        .from('contracts')
        .insert({
          dj_id: user.id,
          name,
          docuseal_template_id: String(templateId),
          logo_url: logoUrl,
          is_standard: true,
          body_text: text,
        } as unknown as never)
        .select('id')
        .single();
      if (error) throw error;
      savedId = (data as { id?: string } | null)?.id || null;
    }
    return NextResponse.json({ ok: true, contractId: savedId, templateId: String(templateId) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Built the contract but could not save it.' },
      { status: 500 },
    );
  }
}
