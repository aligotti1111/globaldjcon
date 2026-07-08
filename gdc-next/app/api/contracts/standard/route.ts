// POST /api/contracts/standard
//
// Creates the DJ's contract from the editable standard template. Receives the
// DJ's edited text (+ optional logo URL), builds HTML with the field tags,
// creates a DocuSeal template from it, and stores the template id + logo.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDocuseal, buildContractHtml } from '@/lib/docuseal';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: { text?: unknown; logoUrl?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const text = typeof body.text === 'string' ? body.text : '';
  const logoUrl = typeof body.logoUrl === 'string' && body.logoUrl ? body.logoUrl : null;
  if (!text.trim()) return NextResponse.json({ error: 'Contract text is empty' }, { status: 400 });

  let templateId: string | number | undefined;
  try {
    const docuseal = getDocuseal();
    const html = buildContractHtml(text, logoUrl);
    const template = await docuseal.createTemplateFromHtml({
      name: `Contract — ${user.id}`,
      html,
      external_id: `dj_${user.id}`,
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
    const { error } = await admin
      .from('users')
      .update({
        docuseal_template_id: String(templateId),
        contract_file_name: 'Standard contract',
        contract_uploaded_at: new Date().toISOString(),
        contract_logo_url: logoUrl,
      } as unknown as never)
      .eq('id', user.id);
    if (error) throw error;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Built the contract but could not save it.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, templateId: String(templateId) });
}
