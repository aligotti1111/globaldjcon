// POST /api/contracts/from-text
//
// The DJ writes or pastes their contract as plain text and "locks it in". We
// turn that text into a DocuSeal template and save it as a normal named
// contract, keeping the raw text on the row so the DJ can come back and edit
// the words later. After locking in, the DJ is taken into the field builder to
// drop in the spots where booking details and signatures go.
//
// Every NEW contract also gets a DJ + Client signature block automatically, so
// it's always signable — a contract with zero fields is rejected by DocuSeal
// ("Template does not contain fields") and can't be sent.
//
// Pass a contractId to re-lock an existing text contract after editing (rebuilds
// its template from the new text; previously placed fields are kept).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDocuseal } from '@/lib/docuseal';
import { CONTRACT_DATA_FIELDS } from '@/lib/contractText';

export const runtime = 'nodejs';
export const maxDuration = 26;

const DJ_SIGNATURE_FIELD = '<signature-field name="DJ Signature" role="DJ" format="typed" style="width:220px;height:44px;display:inline-block;"></signature-field>';
const CLIENT_SIGNATURE_FIELD = '<signature-field name="Client Signature" role="Client" format="typed" style="width:220px;height:44px;display:inline-block;"></signature-field>';

// Convert friendly {{tags}} typed/pasted in the editor into DocuSeal field
// elements, so booking details (set_type, equipment, price, date…) auto-fill
// per booking and signature lines are collected from each party. Runs on the
// already-HTML body (the rich-text editor output) — no escaping.
function translateTags(html: string): string {
  let out = html;
  out = out.replace(/\{\{\s*dj_signature\s*\}\}/gi, DJ_SIGNATURE_FIELD);
  out = out.replace(/\{\{\s*client_signature\s*\}\}/gi, CLIENT_SIGNATURE_FIELD);
  for (const f of CONTRACT_DATA_FIELDS) {
    out = out.replace(
      new RegExp(`\\{\\{\\s*${f}\\s*\\}\\}`, 'gi'),
      `<text-field name="${f}" role="DJ" required="false" readonly="true" style="min-width:120px;display:inline-block;"></text-field>`,
    );
  }
  return out;
}

// Wrap the DJ's formatted contract HTML into a full print-ready document. Any
// {{tags}} become auto-fill fields. When ensureSignature is true (new contract)
// and the DJ placed no signature, a DJ + Client signature block is appended so
// the contract is always signable.
function wrapContractHtml(bodyHtml: string, logoUrl?: string | null, ensureSignature = false): string {
  let body = translateTags(bodyHtml);
  if (ensureSignature) {
    // Guarantee a signature spot for each party. Checked separately so a
    // contract that only has a DJ signature still gets a Client one — the
    // client MUST have somewhere to sign. (DJ may have pre-signed in the text.)
    const hasDjSig = /<signature-field[^>]*role="DJ"/i.test(body);
    const hasClientSig = /<signature-field[^>]*role="Client"/i.test(body);
    if (!hasDjSig || !hasClientSig) {
      let block = '<div style="margin-top:40px">';
      if (!hasDjSig) block += `<div style="margin-bottom:22px">DJ signature: ${DJ_SIGNATURE_FIELD}</div>`;
      if (!hasClientSig) block += `<div>Client signature: ${CLIENT_SIGNATURE_FIELD}</div>`;
      block += '</div>';
      body += block;
    }
  }
  const logo = logoUrl
    ? `<div style="text-align:center;margin-bottom:18px"><img src="${logoUrl}" style="max-height:90px;max-width:260px" /></div>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#111;padding:40px}
    h1{font-size:20px;margin:.4em 0}h2{font-size:16px;margin:.4em 0}h3{font-size:14px;margin:.4em 0}
    p{margin:.5em 0}ul,ol{margin:.5em 0 .5em 1.4em}
    strong,b{font-weight:bold}em,i{font-style:italic}u{text-decoration:underline}
  </style></head><body>${logo}${body}</body></html>`;
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

  // 1. Build/refresh the DocuSeal template from the text. New contracts get the
  //    signature block guaranteed; edits keep the existing (transferred) fields.
  let templateId: string | number | undefined;
  try {
    const docuseal = getDocuseal();
    // Always guarantee DJ + Client signature spots — on create AND edit — so a
    // contract can never end up without somewhere for the client to sign.
    const html = wrapContractHtml(text, logoUrl, true);
    if (existingTemplateId) {
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
