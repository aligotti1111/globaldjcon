// POST /api/contracts/save-template
//
// Called after the DJ saves in the embedded builder. Stores the resulting
// DocuSeal template id on the DJ's row so we can create submissions from it
// per booking later.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: { templateId?: unknown; fileName?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const templateId = body.templateId != null ? String(body.templateId) : '';
  if (!templateId) return NextResponse.json({ error: 'Missing template id' }, { status: 400 });

  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from('users')
      .update({
        docuseal_template_id: templateId,
        contract_file_name: body.fileName ? String(body.fileName) : 'Your contract',
        contract_uploaded_at: new Date().toISOString(),
      } as unknown as never)
      .eq('id', user.id);
    if (error) throw error;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not save.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
