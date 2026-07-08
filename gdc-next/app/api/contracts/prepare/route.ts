// POST /api/contracts/prepare
//
// Lazily prepares a contract for an approved booking: creates a DocuSeal
// submission from the DJ's template with the booking details pre-filled
// (read-only), DJ as first signer (order 'preserved'), client second.
// Returns the DJ's embedded signing URL so the DJ can review + sign in-app;
// the client is emailed to sign automatically once the DJ finishes.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDocuseal } from '@/lib/docuseal';

export const runtime = 'nodejs';

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: { bookingId?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const bookingId = body.bookingId != null ? String(body.bookingId) : '';
  if (!bookingId) return NextResponse.json({ error: 'Missing booking' }, { status: 400 });

  const admin = createAdminClient();

  // DJ + their contract template. (Email comes from auth, not public.users.)
  const { data: djRow } = await admin
    .from('users')
    .select('docuseal_template_id, name')
    .eq('id', user.id)
    .maybeSingle();
  const dj = djRow as { docuseal_template_id?: string | null; name?: string | null } | null;
  if (!dj?.docuseal_template_id) {
    return NextResponse.json({ error: 'Set up your contract in Booking Settings first.' }, { status: 400 });
  }
  const djEmail = user.email || '';

  // The booking — must belong to this DJ.
  const { data: bkRow } = await admin
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .eq('dj_id', user.id)
    .maybeSingle();
  const b = bkRow as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  const currency = (b.currency as string) || 'USD';
  const price = (b.counter_rate ?? b.quoted_rate ?? b.offer_amount) as number | null;
  const depositAmount = b.deposit_amount as number | null;
  const depositPct = b.deposit_pct as number | null;

  // Build the payment_terms sentence (handles deposit / no deposit).
  let paymentTerms: string;
  if (price == null) {
    paymentTerms = 'Payment terms as agreed between the DJ and Client.';
  } else if (depositAmount != null && depositAmount > 0) {
    const bal = Math.max(0, price - depositAmount);
    paymentTerms = `A deposit of ${money(depositAmount, currency)} is due upon signing to reserve the date, with the remaining balance of ${money(bal, currency)} due by the day of the event.`;
  } else if (depositPct != null && depositPct > 0) {
    const dep = (price * depositPct) / 100;
    const bal = Math.max(0, price - dep);
    paymentTerms = `A deposit of ${depositPct}% (${money(dep, currency)}) is due upon signing to reserve the date, with the remaining balance of ${money(bal, currency)} due by the day of the event.`;
  } else {
    paymentTerms = `Full payment of ${money(price, currency)} is due by the day of the event.`;
  }

  const clientName = (b.requester_name as string) || 'Client';
  const clientEmail = (b.host_email as string) || '';
  if (!clientEmail) {
    return NextResponse.json({ error: "This booking has no client email. Add one on the booking first." }, { status: 400 });
  }

  // Pre-fill values (all read-only for signers — they're facts of the booking).
  const values: Record<string, string> = {
    client_name: clientName,
    dj_name: dj.name || 'DJ',
    event_date: (b.event_date as string) || '',
    event_type: (b.event_type as string) || '',
    venue_name: (b.venue_name as string) || '',
    event_address: (b.venue_address as string) || '',
    start_time: (b.start_time as string) || '',
    end_time: (b.end_time as string) || '',
    package: (b.package_title as string) || '',
    price: price != null ? money(price, currency) : '',
    deposit: depositAmount != null ? money(depositAmount, currency) : (depositPct != null ? `${depositPct}%` : ''),
    payment_terms: paymentTerms,
  };
  const fields = Object.entries(values).map(([name, default_value]) => ({ name, default_value, readonly: true }));

  let embedSrc = '';
  let submissionId: string | number | undefined;
  try {
    const docuseal = getDocuseal();
    const submission = await docuseal.createSubmission({
      template_id: Number(dj.docuseal_template_id) || (dj.docuseal_template_id as unknown as number),
      order: 'preserved',
      submitters: [
        { role: 'DJ', email: djEmail, name: dj.name || 'DJ', fields, send_email: false },
        { role: 'Client', email: clientEmail, name: clientName },
      ],
    } as unknown as Parameters<typeof docuseal.createSubmission>[0]);

    const arr = submission as unknown as Array<{ role?: string; embed_src?: string; submission_id?: number }>;
    const djSubmitter = Array.isArray(arr) ? arr.find((s) => s.role === 'DJ') || arr[0] : undefined;
    embedSrc = djSubmitter?.embed_src || '';
    submissionId = djSubmitter?.submission_id;
    if (!embedSrc) throw new Error('No signing link returned');
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not prepare the contract.' }, { status: 502 });
  }

  try {
    await admin
      .from('bookings')
      .update({
        contract_submission_id: submissionId != null ? String(submissionId) : null,
        contract_status: 'awaiting_dj',
        contract_sent_at: new Date().toISOString(),
      } as unknown as never)
      .eq('id', bookingId)
      .eq('dj_id', user.id);
  } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true, embedSrc, submissionId: submissionId != null ? String(submissionId) : null });
}
