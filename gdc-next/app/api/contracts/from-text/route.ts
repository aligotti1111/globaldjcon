// POST /api/contracts/from-text
//
// The DJ writes or pastes their contract as plain text and "locks it in". We
// turn that text into a DocuSeal template (no fields placed yet) and save it as
// a normal named contract, keeping the raw text on the row so the DJ can come
// back and edit the words later. After locking in, the DJ is taken into the
// field builder to drop in the spots where booking details and signatures go.
//
// Pass a contractId to re-lock an existing text contract after editing (rebuilds
// its template from the new text; previously placed fields are re-placed).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDocuseal, buildContractHtml } from '@/lib/docuseal';

export const runtime = 'nodejs';
export const maxDuration = 26;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: { text?: unknown; name?: unknown; logoUrl?: unknown; contractId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const text = typeof body.text === 'string' ? body.text : '';
  const name = (typeof body.name === 'string' && body.name.trim()) ? body.name.trim() : 'My contract';
  const logoUrl = typeof body.logoUrl === 'string' && body.logoUrl ? body.logoUrl : null;
  const contractId = typeof body.contractId === 'string' && body.contractId ? body.contractId : null;
  if (!text.trim()) return NextResponse.json({ error: 'Contract text is empty' }, { status: 400 });

  // 1. Build the DocuSeal template from the pasted text.
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

  // 2. Save (or update) it as a normal (non-standard) named contract, keeping
  //    the raw text so it can be edited later.
  let savedId: string | null = contractId;
  try {
    const admin = createAdminClient();
    if (contractId) {
      const { error } = await admin
        .from('contracts')
        .update({
          name,
          docuseal_template_id: String(templateId),
          body_text: text,
          logo_url: logoUrl,
          is_standard: false,
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
          body_text: text,
          logo_url: logoUrl,
          is_standard: false,
        } as unknown as never)
        .select('id')
        .single();
      if (error) throw error;
      savedId = (data as { id?: string } | null)?.id || null;
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Built the contract but could not save it.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, contractId: savedId, templateId: String(templateId), name });
}
