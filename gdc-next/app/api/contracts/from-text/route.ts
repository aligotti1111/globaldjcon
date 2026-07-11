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
import { getDocuseal } from '@/lib/docuseal';

export const runtime = 'nodejs';
export const maxDuration = 26;

// Wrap the DJ's formatted contract HTML (from the rich-text editor) into a
// full print-ready document. The body is already HTML (headings, bold, lists),
// so we inject it as-is rather than escaping. No field tags are added here —
// the DJ drags fields on in the builder step.
function wrapContractHtml(bodyHtml: string, logoUrl?: string | null): string {
  const logo = logoUrl
    ? `<div style="text-align:center;margin-bottom:18px"><img src="${logoUrl}" style="max-height:90px;max-width:260px" /></div>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#111;padding:40px}
    h1{font-size:20px;margin:.4em 0}h2{font-size:16px;margin:.4em 0}h3{font-size:14px;margin:.4em 0}
    p{margin:.5em 0}ul,ol{margin:.5em 0 .5em 1.4em}
    strong,b{font-weight:bold}em,i{font-style:italic}u{text-decoration:underline}
  </style></head><body>${logo}${bodyHtml}</body></html>`;
}

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

  const admin = createAdminClient();

  // When editing an existing contract, find its current DocuSeal template so we
  // can update it in place (keeping the fields the DJ already dragged on).
  let existingTemplateId: string | null = null;
  if (contractId) {
    try {
      const { data } = await admin
        .from('contracts')
        .select('docuseal_template_id')
        .eq('id', contractId)
        .eq('dj_id', user.id)
        .maybeSingle();
      existingTemplateId = (data as { docuseal_template_id?: string | null } | null)?.docuseal_template_id || null;
    } catch { existingTemplateId = null; }
  }

  // 1. Build/refresh the DocuSeal template from the text.
  let templateId: string | number | undefined;
  try {
    const docuseal = getDocuseal();
    const html = wrapContractHtml(text, logoUrl);
    if (existingTemplateId) {
      // Replace the document in place. The new HTML carries no fields, so
      // DocuSeal transfers the DJ's previously dragged fields onto it — their
      // placements are kept when they reopen the builder.
      await docuseal.updateTemplateDocuments(Number(existingTemplateId), {
        documents: [{ html, position: 0, replace: true }],
      });
      templateId = existingTemplateId;
    } else {
      const template = await docuseal.createTemplateFromHtml({
        name: `${name} — ${user.id}`,
        html,
        external_id: `dj_${user.id}_${Date.now()}`,
      });
      templateId = (template as { id?: string | number }).id;
    }
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
