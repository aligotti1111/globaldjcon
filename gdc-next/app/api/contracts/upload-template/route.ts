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
  const isJpg = lower.endsWith('.jpg') || lower.endsWith('.jpeg') || file.type === 'image/jpeg';
  const isPng = lower.endsWith('.png') || file.type === 'image/png';
  const isImage = isJpg || isPng;
  if (!isPdf && !isDocx && !isImage) {
    return NextResponse.json({ error: 'Upload a PDF, Word (.docx), or image (JPG/PNG)' }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: 'File is too large (max 20MB)' }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // 3. Create the DocuSeal template.
  let templateId: string | number | undefined;
  try {
    const docuseal = getDocuseal();

    if (isImage) {
      // Images have no tags — wrap the picture into a PDF and add a signature
      // strip at the bottom with DocuSeal tag text drawn on it, so DocuSeal
      // detects the fields the same reliable way it does for a normal PDF.
      const { PDFDocument, StandardFonts } = await import('pdf-lib');
      const pdf = await PDFDocument.create();
      const img = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const maxW = 612;
      const scale = Math.min(1, maxW / img.width);
      const w = img.width * scale;
      const h = img.height * scale;
      const page = pdf.addPage([w, h + 70]);
      page.drawImage(img, { x: 0, y: 70, width: w, height: h });
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      // DocuSeal reads these {{...}} tags from the PDF text layer.
      page.drawText('DJ: {{Signature;role=DJ;type=signature}}', { x: 20, y: 30, size: 11, font });
      page.drawText('Client: {{Signature;role=Client;type=signature}}', { x: Math.max(20, w / 2), y: 30, size: 11, font });
      const pdfBytes = await pdf.save();
      const pdfBase64 = Buffer.from(pdfBytes).toString('base64');

      const template = await docuseal.createTemplateFromPdf({
        name: `Contract — ${user.id}`,
        documents: [{ name: name.replace(/\.(jpe?g|png)$/i, '.pdf'), file: pdfBase64 }],
      });
      templateId = (template as { id?: string | number }).id;
    } else {
      // PDF / DOCX — tags are read straight from the document.
      const base64 = Buffer.from(bytes).toString('base64');
      const docs = [{ name, file: base64 }];
      const template = isPdf
        ? await docuseal.createTemplateFromPdf({ name: `Contract — ${user.id}`, documents: docs })
        : await docuseal.createTemplateFromDocx({ name: `Contract — ${user.id}`, documents: docs });
      templateId = (template as { id?: string | number }).id;
    }

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
