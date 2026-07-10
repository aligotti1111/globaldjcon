// POST /api/contracts/from-text
//
// The DJ writes or pastes their contract as plain text. We turn that text into
// a DocuSeal HTML template (no fields placed yet) and save it as a normal
// named contract. The DJ is then taken into the embedded field builder to drop
// in the spots where booking details and signatures go — exactly like an
// uploaded contract, but the starting document comes from pasted text.

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

  let body: { text?: unknown; name?: unknown; logoUrl?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const text = typeof body.text === 'string' ? body.text : '';
  const name = (typeof body.name === 'string' && body.name.trim()) ? body.name.trim() : 'My contract';
  const logoUrl = typeof body.logoUrl === 'string' && body.logoUrl ? body.logoUrl : null;
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

  // 2. Save it as a normal (non-standard) named contract.
  let contractId: string | null = null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('contracts')
      .insert({
        dj_id: user.id,
        name,
        docuseal_template_id: String(templateId),
        logo_url: logoUrl,
        is_standard: false,
      } as unknown as never)
      .select('id')
      .single();
    if (error) throw error;
    contractId = (data as { id?: string } | null)?.id || null;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Built the contract but could not save it.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, contractId, templateId: String(templateId), name });
}
