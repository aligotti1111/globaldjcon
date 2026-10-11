// GET /api/contracts/sign-redirect?bookingId=...
//
// Sends the signed-in host (or DJ) straight to the DocuSeal page where they can
// review and sign the contract. Used by the "View & Sign Contract" action on the
// host's Upcoming Events pipeline: a plain <a href> can open this in a new tab,
// and we 302 to the real signing URL once we've resolved it.
//
// Only the booking's DJ (dj_id) or host (requester_id) may use it.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDocuseal } from '@/lib/docuseal';
import { getActingContext } from '@/lib/acting';

export const runtime = 'nodejs';
export const maxDuration = 26;

function back(req: Request, msg?: string) {
  const base = new URL('/upcoming-events', req.url);
  if (msg) base.searchParams.set('contract', msg);
  return NextResponse.redirect(base);
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    // Bounce to login, then back here.
    const login = new URL('/login', req.url);
    login.searchParams.set('next', new URL(req.url).pathname + new URL(req.url).search);
    return NextResponse.redirect(login);
  }

  const bookingId = new URL(req.url).searchParams.get('bookingId');
  if (!bookingId) return back(req, 'missing');

  const acting = await getActingContext(user.id);
  const admin = createAdminClient();

  let submissionId: string | null = null;
  try {
    const { data } = await admin
      .from('bookings')
      .select('contract_submission_id, dj_id, requester_id')
      .eq('id', bookingId)
      .maybeSingle();
    const row = data as { contract_submission_id?: string | null; dj_id?: string | null; requester_id?: string | null } | null;
    if (!row) return back(req, 'notfound');
    if (row.dj_id !== acting.djId && row.requester_id !== user.id) return back(req, 'forbidden');
    submissionId = row.contract_submission_id || null;
  } catch { submissionId = null; }
  if (!submissionId) return back(req, 'notready');

  try {
    const docuseal = getDocuseal();
    const submission = await docuseal.getSubmission(Number(submissionId));
    type Sub = { role?: string; embed_src?: string | null; slug?: string | null; completed_at?: string | null };
    const submitters = ((submission as { submitters?: Sub[] })?.submitters) || [];
    const client = submitters.find((s) => s.role === 'Client/Host' || s.role === 'Client');
    if (!client) return back(req, 'notready');
    if (client.completed_at) return back(req, 'signed');
    const url = client.embed_src || (client.slug ? `https://docuseal.com/s/${client.slug}` : null);
    if (!url) return back(req, 'notready');
    return NextResponse.redirect(url);
  } catch {
    return back(req, 'error');
  }
}
