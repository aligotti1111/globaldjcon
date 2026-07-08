// POST /api/contracts/upload-template
//
// The DJ uploads their own contract (PDF or DOCX) with tags in it. We send it
// to DocuSeal, which auto-detects the {{...}} tags and creates a reusable
// template. We store the returned template id on the DJ's row. One contract
// per DJ for now (multiple-by-event-type later).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDocuseal } from '@/lib/docuseal';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  // 1. Auth — must be a signed-in DJ acting on their own account.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  // 2. Read the uploaded file.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  const name = file.name || 'contract';
  const lower = name.toLowerCase();
  const isPdf = lower.endsWith('.pdf') || file.type === 'application/pdf';
  const isDocx =
    lower.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (!isPdf && !isDocx) {
    return NextResponse.json({ error: 'Upload a PDF or Word (.docx) file' }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: 'File is too large (max 20MB)' }, { status: 400 });
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');

  // 3. Create the DocuSeal template from the file (tags auto-detected).
  let templateId: string | number | undefined;
  try {
    const docuseal = getDocuseal();
    const docs = [{ name, file: base64 }];
    const template = isPdf
      ? await docuseal.createTemplateFromPdf({ name: `Contract — ${user.id}`, documents: docs })
      : await docuseal.createTemplateFromDocx({ name: `Contract — ${user.id}`, documents: docs });
    templateId = (template as { id?: string | number }).id;
    if (templateId == null) throw new Error('No template id returned');
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not process the contract.' },
      { status: 502 },
    );
  }

  // 4. Store the template id on the DJ's row.
  try {
    const admin = createAdminClient();
    const { error: dbErr } = await admin
      .from('users')
      .update({
        docuseal_template_id: String(templateId),
        contract_file_name: name,
        contract_uploaded_at: new Date().toISOString(),
      } as unknown as never)
      .eq('id', user.id);
    if (dbErr) throw dbErr;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Saved to DocuSeal but could not update your account.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, templateId: String(templateId), fileName: name });
}
