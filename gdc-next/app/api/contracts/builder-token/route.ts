// POST /api/contracts/builder-token
//
// Generates the signed JWT that authorizes the embedded DocuSeal form builder
// for the current DJ. The builder lets the DJ upload their contract and place
// fields (client name, date, signatures) visually — no tags, no re-upload.
//
// Requires env vars:
//   DOCUSEAL_API_KEY   — used to sign the JWT (same key used for the API)
//   DOCUSEAL_USER_EMAIL — the admin email of your DocuSeal account (owner of the key)

import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const apiKey = process.env.DOCUSEAL_API_KEY;
  const adminEmail = process.env.DOCUSEAL_USER_EMAIL;
  if (!apiKey || !adminEmail) {
    return NextResponse.json({ error: 'Contract builder is not configured.' }, { status: 500 });
  }

  // Reopen the DJ's existing template if they have one; otherwise the builder
  // starts fresh and lets them upload.
  let templateId: string | null = null;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('users')
      .select('docuseal_template_id')
      .eq('id', user.id)
      .maybeSingle();
    templateId = (data as { docuseal_template_id?: string | null } | null)?.docuseal_template_id || null;
  } catch {
    templateId = null;
  }

  const payload: Record<string, unknown> = {
    user_email: adminEmail,
    integration_email: user.email || `dj_${user.id}@globaldjconnect.com`,
    external_id: `dj_${user.id}`,
    name: 'Booking Contract',
  };
  if (templateId) payload.template_id = Number(templateId) || templateId;

  const token = jwt.sign(payload, apiKey);
  return NextResponse.json({ token });
}
