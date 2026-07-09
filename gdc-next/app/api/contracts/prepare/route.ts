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
export const maxDuration = 26;

// Wrap any promise so a hang becomes a readable error naming the step, instead
// of the whole function silently timing out to a 502.
function withTimeout<T>(p: Promise<T>, ms: number, step: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`HANG at ${step} (${ms}ms)`)), ms)),
  ]);
}

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export async function POST(req: Request) {
  // TEMP DEBUG: prove the handler runs at all, before touching any service.
  // Send { "debug": true } to get an immediate response.
  try {
    const rawBody = await req.text();
    if (rawBody.includes('"debug"')) {
      return NextResponse.json({ ok: false, debug: 'handler-reached', bodyLen: rawBody.length });
    }
    const parsed = rawBody ? JSON.parse(rawBody) : {};
    if (parsed && parsed.trace) return await tracePrepare(parsed);
    return await runPrepare(parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `outer: ${msg}`.slice(0, 400) }, { status: 500 });
  }
}

// Step-by-step diagnostic: send { bookingId, trace: true } and it returns which
// step it reached, so a hanging service call is pinpointed.
async function tracePrepare(body: { bookingId?: unknown }) {
  const steps: string[] = [];
  try {
    steps.push('start');
    const supabase = await createClient();
    steps.push('createClient');
    const { data: { user } } = await supabase.auth.getUser();
    steps.push(`getUser:${user ? 'ok' : 'none'}`);
    if (!user) return NextResponse.json({ steps });
    const admin = createAdminClient();
    steps.push('adminClient');
    const { data: djRow } = await admin.from('users').select('docuseal_template_id, name').eq('id', user.id).maybeSingle();
    const dj = djRow as { docuseal_template_id?: string | null } | null;
    steps.push(`users:${dj?.docuseal_template_id ? 'has-template' : 'no-template'}`);
    const bookingId = String(body.bookingId || '');
    let b: Record<string, unknown> | null = null;
    if (bookingId) {
      const { data: bkRow } = await admin.from('bookings').select('*').eq('id', bookingId).eq('dj_id', user.id).maybeSingle();
      b = bkRow as Record<string, unknown> | null;
    } else {
      // No id given — grab this DJ's most recent booking to trace against.
      const { data: bkRow } = await admin.from('bookings').select('*').eq('dj_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      b = bkRow as Record<string, unknown> | null;
    }
    steps.push(`booking:${b ? 'found' : 'missing'}`);
    if (b?.requester_id) {
      const { data: reqUser } = await admin.auth.admin.getUserById(String(b.requester_id));
      steps.push(`getUserById:${(reqUser as { user?: { email?: string } } | null)?.user?.email ? 'has-email' : 'no-email'}`);
    } else {
      steps.push('getUserById:skipped');
    }
    steps.push('before-createSubmission');
    const docuseal = getDocuseal();
    steps.push('getDocuseal');
    const sub = await docuseal.createSubmission({
      template_id: Number(dj?.docuseal_template_id) || (dj?.docuseal_template_id as unknown as number),
      order: 'preserved',
      submitters: [
        { role: 'DJ', email: user.email || '', name: 'DJ', send_email: false },
        { role: 'Client', email: (b?.host_email as string) || 'test@example.com', name: 'Client' },
      ],
    } as unknown as Parameters<typeof docuseal.createSubmission>[0]);
    steps.push('createSubmission:ok');
    const arr = sub as unknown as Array<Record<string, unknown>>;
    const first = Array.isArray(arr) ? arr[0] : (sub as Record<string, unknown>);
    const keys = first ? Object.keys(first) : [];
    steps.push(`isArray:${Array.isArray(arr)}`);
    steps.push(`keys:${keys.join(',')}`);
    return NextResponse.json({ steps, firstSubmitter: first });
  } catch (e) {
    return NextResponse.json({ steps, error: e instanceof Error ? e.message : String(e) });
  }
}

async function runPrepare(body: { bookingId?: unknown; clientEmail?: unknown }) {
  try {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const bookingId = body.bookingId != null ? String(body.bookingId) : '';
  const manualClientEmail = typeof body.clientEmail === 'string' ? body.clientEmail.trim() : '';
  if (!bookingId) return NextResponse.json({ error: 'Missing booking' }, { status: 400 });

  const admin = createAdminClient();

  // DJ + their contract template. (Email comes from auth, not public.users.)
  const { data: djRow } = await withTimeout<{ data: unknown }>(
    admin.from('users').select('docuseal_template_id, name').eq('id', user.id).maybeSingle() as unknown as Promise<{ data: unknown }>,
    5000, 'users-select',
  );
  const dj = djRow as { docuseal_template_id?: string | null; name?: string | null } | null;
  if (!dj?.docuseal_template_id) {
    return NextResponse.json({ error: 'Set up your contract in Booking Settings first.' }, { status: 400 });
  }
  const djEmail = user.email || '';

  // The booking — must belong to this DJ.
  const { data: bkRow } = await withTimeout<{ data: unknown }>(
    admin.from('bookings').select('*').eq('id', bookingId).eq('dj_id', user.id).maybeSingle() as unknown as Promise<{ data: unknown }>,
    5000, 'bookings-select',
  );
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

  // Resolve the client's email: the manual field on the booking (host_email),
  // else the booking requester's account email, else an email entered by the DJ.
  let clientEmail = (b.host_email as string) || '';
  if (!clientEmail && b.requester_id) {
    try {
      const { data: reqUser } = await withTimeout<{ data: { user: { email?: string } | null } }>(
        admin.auth.admin.getUserById(String(b.requester_id)) as unknown as Promise<{ data: { user: { email?: string } | null } }>,
        5000, 'getUserById',
      );
      clientEmail = reqUser?.user?.email || '';
    } catch { /* fall through */ }
  }
  if (!clientEmail && manualClientEmail) clientEmail = manualClientEmail;
  if (!clientEmail) {
    return NextResponse.json({ error: 'NO_CLIENT_EMAIL' }, { status: 400 });
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
  // Pre-fill values are passed as a `values` object on the DJ submitter.

  let embedSrc = '';
  let submissionId: string | number | undefined;
  try {
    const docuseal = getDocuseal();
    const submission = await withTimeout<unknown>(
      docuseal.createSubmission({
        template_id: Number(dj.docuseal_template_id) || (dj.docuseal_template_id as unknown as number),
        order: 'preserved',
        submitters: [
          { role: 'DJ', email: djEmail, name: dj.name || 'DJ', values, send_email: false },
          { role: 'Client', email: clientEmail, name: clientName },
        ],
      } as unknown as Parameters<typeof docuseal.createSubmission>[0]),
      12000, 'createSubmission',
    );

    type Submitter = { role?: string; embed_src?: string; submission_id?: number };
    const resp = submission as unknown as { submitters?: Submitter[] } | Submitter[];
    // Response is an object { id, submitters:[...] }; older shapes may be a bare array.
    const submitters: Submitter[] = Array.isArray(resp) ? resp : (resp.submitters || []);
    const djSubmitter = submitters.find((s: Submitter) => s.role === 'DJ') || submitters[0];
    embedSrc = djSubmitter?.embed_src || '';
    submissionId = djSubmitter?.submission_id;
    if (!embedSrc) throw new Error('No signing link returned');
  } catch (e) {
    let msg = 'Could not prepare the contract.';
    if (e instanceof Error && e.message) msg = e.message;
    else if (typeof e === 'string' && e) msg = e;
    else {
      try { msg = JSON.stringify(e); } catch { /* keep default */ }
    }
    // Some SDK errors carry the API body on a `.response` or `.body` field.
    const anyE = e as { response?: unknown; body?: unknown; status?: number };
    if (anyE?.response || anyE?.body) {
      try { msg += ` — ${JSON.stringify(anyE.response ?? anyE.body)}`; } catch { /* ignore */ }
    }
    return NextResponse.json({ error: msg.slice(0, 500) }, { status: 502 });
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
  } catch (e) {
    // Guarantee a readable JSON error instead of an infra-level 502.
    let msg = 'Prepare crashed.';
    if (e instanceof Error && e.message) msg = e.message;
    else { try { msg = JSON.stringify(e); } catch { /* keep default */ } }
    return NextResponse.json({ error: `prepare: ${msg}`.slice(0, 500) }, { status: 500 });
  }
}
