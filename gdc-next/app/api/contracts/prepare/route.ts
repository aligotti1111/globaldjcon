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
import { getDocuseal, buildBookedContractHtml } from '@/lib/docuseal';

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

// Convert "2026-08-28" to "August 28, 2026". Leaves unparseable input as-is.
function fmtDate(dstr: string | null | undefined): string {
  if (!dstr) return '';
  const d = new Date(dstr);
  if (isNaN(d.getTime())) return dstr;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// Convert "17:00" / "17:00:00" (24-hour) to "5:00 PM". Leaves anything it
// can't parse untouched.
// Hours between "17:00" and "23:00" as "6 hours" (or "6.5 hours"). Handles
// past-midnight end times. Blank if either is missing/unparseable.
function fmtDuration(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return '';
  const p = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(t.trim()); return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : NaN; };
  const a = p(start); let b = p(end);
  if (isNaN(a) || isNaN(b)) return '';
  if (b < a) b += 24 * 60; // crosses midnight
  const hrs = (b - a) / 60;
  if (hrs <= 0) return '';
  const rounded = Math.round(hrs * 100) / 100;
  return `${rounded % 1 === 0 ? rounded : rounded.toFixed(1)} hour${rounded === 1 ? '' : 's'}`;
}

function fmtTime(t: string | null | undefined): string {
  if (!t) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const min = m[2];
  if (isNaN(h) || h > 23) return t;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${ampm}`;
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
    console.error('[prepare] outer crash:', msg);
    return NextResponse.json({ ok: false, error: `outer: ${msg}`.slice(0, 400) }, { status: 200 });
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

async function runPrepare(body: { bookingId?: unknown; clientEmail?: unknown; contractId?: unknown }) {
  try {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const bookingId = body.bookingId != null ? String(body.bookingId) : '';
  const manualClientEmail = typeof body.clientEmail === 'string' ? body.clientEmail.trim() : '';
  const contractId = typeof body.contractId === 'string' && body.contractId ? body.contractId : null;
  if (!bookingId) return NextResponse.json({ error: 'Missing booking' }, { status: 400 });

  const admin = createAdminClient();

  // Fetch the DJ profile, the chosen contract/template, and the booking in
  // PARALLEL. Running these sequentially was slow enough that bookings needing
  // extra client lookups (mobile) could exceed the platform time limit and
  // surface as a 502. They're independent, so fire them together.
  let cq = admin.from('contracts').select('id, docuseal_template_id, body_text, logo_url, is_standard').eq('dj_id', user.id);
  cq = contractId ? cq.eq('id', contractId) : cq.order('updated_at', { ascending: false });

  const [{ data: djRow }, { data: cRow }, { data: bkRow }] = await Promise.all([
    withTimeout<{ data: unknown }>(
      admin.from('users').select('name, company, dj_type, booking_settings').eq('id', user.id).maybeSingle() as unknown as Promise<{ data: unknown }>,
      5000, 'users-select',
    ),
    withTimeout<{ data: { id?: string; docuseal_template_id?: string | null; body_text?: string | null; logo_url?: string | null; is_standard?: boolean | null } | null }>(
      cq.limit(1).maybeSingle() as unknown as Promise<{ data: { id?: string; docuseal_template_id?: string | null; body_text?: string | null; logo_url?: string | null; is_standard?: boolean | null } | null }>,
      5000, 'contracts-select',
    ),
    withTimeout<{ data: unknown }>(
      admin.from('bookings').select('*').eq('id', bookingId).eq('dj_id', user.id).maybeSingle() as unknown as Promise<{ data: unknown }>,
      5000, 'bookings-select',
    ),
  ]);

  const dj = djRow as { name?: string | null; company?: string | null; dj_type?: string | null; booking_settings?: string | null } | null;
  const djEmail = user.email || '';
  const companyName = (dj?.company || dj?.name || '').trim();
  const isClub = dj?.dj_type === 'club';

  // Club DJs set a standing deposit policy in Booking Settings (club_deposit_pct
  // in the booking_settings JSON). It flows into the contract's payment terms
  // for club bookings that don't already carry a per-booking deposit.
  let clubDepositPct = 0;
  // Sales tax % — only when the DJ turned it on. Applies to both DJ types.
  let taxPctVal = 0;
  try {
    const raw = dj?.booking_settings;
    const bs = (typeof raw === 'string' ? JSON.parse(raw) : (raw || {})) as { club_deposit_pct?: number; tax_enabled?: boolean; tax_pct?: number };
    if (isClub) {
      const v = Number(bs?.club_deposit_pct);
      if (Number.isFinite(v) && v > 0) clubDepositPct = v;
    }
    if (bs?.tax_enabled) {
      const t = Number(bs?.tax_pct);
      if (Number.isFinite(t) && t > 0) taxPctVal = t;
    }
  } catch { /* bad JSON — no deposit/tax */ }

  const cData = cRow as { id?: string; docuseal_template_id?: string | null; body_text?: string | null; logo_url?: string | null; is_standard?: boolean | null } | null;
  let templateId: string | null = cData?.docuseal_template_id || null;
  const usedContractId: string | null = cData?.id || null;
  if (!templateId) {
    return NextResponse.json({ error: 'Set up your contract in Booking Settings first.' }, { status: 400 });
  }
  // Auto-fit: the standard/wedding contracts are assembled fresh for THIS
  // booking, so every value is sized to its own text (no fixed-width gaps) and
  // empty lines (e.g. no cocktail hour) drop out. Needs the saved body text.
  const autoFit = !!cData?.is_standard && !!(cData?.body_text || '').trim();
  const b = bkRow as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  const currency = (b.currency as string) || 'USD';
  const price = (b.counter_rate ?? b.quoted_rate ?? b.offer_amount) as number | null;
  const depositAmount = b.deposit_amount as number | null;
  const depositPctRaw = b.deposit_pct as number | null;
  // For club bookings with no per-booking deposit, fall back to the DJ's
  // standing club deposit % so the contract still shows deposit + balance.
  const depositPct = (isClub
    && (depositAmount == null || depositAmount <= 0)
    && (depositPctRaw == null || depositPctRaw <= 0)
    && clubDepositPct > 0)
    ? clubDepositPct
    : depositPctRaw;

  // Sales tax on the post-discount price, then the TOTAL the client owes.
  // The deposit is taken on this tax-inclusive total.
  const taxAmt = (taxPctVal > 0 && price != null) ? (price * taxPctVal) / 100 : 0;
  const totalWithTax = price != null ? price + taxAmt : null;

  // Build the payment_terms sentence (handles deposit / no deposit). All
  // amounts are on the tax-inclusive total the client owes.
  let paymentTerms: string;
  if (totalWithTax == null) {
    paymentTerms = 'Payment terms as agreed between the DJ and Client.';
  } else if (depositPct != null && depositPct > 0) {
    const dep = (totalWithTax * depositPct) / 100;
    const bal = Math.max(0, totalWithTax - dep);
    paymentTerms = `A deposit of ${depositPct}% (${money(dep, currency)}) is due upon signing to reserve the date, with the remaining balance of ${money(bal, currency)} due by the day of the event.`;
  } else if (depositAmount != null && depositAmount > 0) {
    const bal = Math.max(0, totalWithTax - depositAmount);
    paymentTerms = `A deposit of ${money(depositAmount, currency)} is due upon signing to reserve the date, with the remaining balance of ${money(bal, currency)} due by the day of the event.`;
  } else {
    paymentTerms = `Full payment of ${money(totalWithTax, currency)} is due by the day of the event.`;
  }

  // Resolve the client's email + display name. Both come from requester_id, so
  // run them together (parallel, settled) to keep the request fast and never
  // let one slow/failed lookup hang the whole route.
  let clientEmail = (b.host_email as string) || '';
  let accountName = '';
  if (b.requester_id) {
    const [emailRes, nameRes] = await Promise.allSettled([
      withTimeout<{ data: { user: { email?: string } | null } }>(
        admin.auth.admin.getUserById(String(b.requester_id)) as unknown as Promise<{ data: { user: { email?: string } | null } }>,
        5000, 'getUserById',
      ),
      withTimeout<{ data: { name?: string | null } | null }>(
        admin.from('users').select('name').eq('id', String(b.requester_id)).maybeSingle() as unknown as Promise<{ data: { name?: string | null } | null }>,
        5000, 'requester-name',
      ),
    ]);
    if (!clientEmail && emailRes.status === 'fulfilled') clientEmail = emailRes.value?.data?.user?.email || '';
    if (nameRes.status === 'fulfilled') accountName = (nameRes.value?.data?.name || '').trim();
  }
  if (!clientEmail && manualClientEmail) clientEmail = manualClientEmail;
  if (!clientEmail) {
    return NextResponse.json({ error: 'NO_CLIENT_EMAIL' }, { status: 400 });
  }
  const emailPrefix = clientEmail.includes('@') ? clientEmail.split('@')[0] : '';
  const clientName = accountName || ((b.requester_name as string) || '').trim() || emailPrefix || 'Client';

  // Cocktail hour (wedding bookings only). Fills the field next to the
  // "Cocktail hour:" label; stays empty (blank) when the booking has none.
  let cocktailHour = '';
  if (b.cocktail_needed === true) {
    const cStart = fmtTime(b.cocktail_start_time as string);
    const room = b.cocktail_same_room === true ? 'same room'
      : (b.cocktail_same_room === false ? 'separate room' : '');
    cocktailHour = [cStart, room].filter(Boolean).join(' · ') || 'Yes';
  }

  // Pre-fill values (all read-only for signers — they're facts of the booking).
  const values: Record<string, string> = {
    agreement_date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    cocktail_hour: cocktailHour,
    tax: (taxAmt > 0) ? `${money(taxAmt, currency)} (${taxPctVal}%)` : '',
    grand_total: (taxAmt > 0 && totalWithTax != null) ? money(totalWithTax, currency) : '',
    client_name: clientName,
    dj_name: companyName || dj?.name || 'DJ',
    event_date: fmtDate(b.event_date as string),
    event_type: (b.event_type as string) || '',
    venue_name: (b.venue_name as string) || '',
    event_address: (b.venue_address as string) || '',
    start_time: fmtTime(b.start_time as string),
    end_time: fmtTime(b.end_time as string),
    package: [(b.package_title as string) || '', (b.package_details as string) || ''].filter(Boolean).join(' — '),
    set_type: (b.set_type as string) || '',
    equipment: (b.equipment as string) || '',
    duration: fmtDuration(b.start_time as string, b.end_time as string),
    overtime_rate: b.overtime_rate != null && b.overtime_rate !== '' ? (isNaN(Number(b.overtime_rate)) ? String(b.overtime_rate) : money(Number(b.overtime_rate), currency)) : '',
    price: price != null ? money(price, currency) : '',
    deposit: (depositPct != null && depositPct > 0 && totalWithTax != null)
      ? `${money((totalWithTax * depositPct) / 100, currency)} (${depositPct}%)`
      : (depositAmount != null && depositAmount > 0)
        ? money(depositAmount, currency)
        : '',
    payment_terms: paymentTerms,
  };
  // Pre-fill values are passed as a `values` object on the DJ submitter.

  let embedSrc = '';
  let submissionId: string | number | undefined;
  let hasClientSig = false;
  let hasDjSig = false;
  try {
    const docuseal = getDocuseal();

    // AUTO-FIT (standard + wedding contracts): assemble the contract for THIS
    // booking with every value sized to its own text, then turn it into a
    // throwaway template to submit from. Signatures are always present, so the
    // guard below is skipped for it.
    if (autoFit) {
      const html = buildBookedContractHtml(cData?.body_text || '', values, cData?.logo_url || null);
      const fitTpl = await withTimeout<{ id?: string | number }>(
        docuseal.createTemplateFromHtml({
          name: `Contract — ${bookingId} — ${Date.now()}`,
          html,
          external_id: `fit_${user.id}_${bookingId}_${Date.now()}`,
        }) as unknown as Promise<{ id?: string | number }>,
        14000, 'createTemplateFromHtml',
      );
      const fitId = fitTpl?.id;
      if (fitId == null) throw new Error('Could not build the contract.');
      templateId = String(fitId);
      hasClientSig = true;
      hasDjSig = true;
    }

    // Guard: a contract MUST have a client signature field. Without one,
    // DocuSeal "completes" the submission after the data fields are filled and
    // it goes out with nobody signing. Verify signature fields exist first, and
    // if not, route the DJ to add them (message matches the client-side check
    // that opens the field builder). (Skipped for auto-fit — we just built it
    // with both signatures.)
    if (!autoFit) try {
      const tpl = await withTimeout<{ fields?: Array<{ type?: string; submitter_uuid?: string }>; submitters?: Array<{ uuid?: string; name?: string }> }>(
        docuseal.getTemplate(Number(templateId)) as unknown as Promise<{ fields?: Array<{ type?: string; submitter_uuid?: string }>; submitters?: Array<{ uuid?: string; name?: string }> }>,
        8000, 'getTemplate',
      );
      const subs = tpl?.submitters || [];
      const roleOf = (uuid?: string) => subs.find((s) => s.uuid === uuid)?.name || '';
      const sigFields = (tpl?.fields || []).filter((f) => (f.type || '').toLowerCase() === 'signature');
      hasClientSig = sigFields.some((f) => roleOf(f.submitter_uuid) === 'Client');
      hasDjSig = sigFields.some((f) => roleOf(f.submitter_uuid) === 'DJ');
      if (!hasClientSig) {
        return NextResponse.json(
          { ok: false, error: 'This contract has no signature fields for the client yet, so there’s nothing to sign. Add a Client signature (and a DJ signature if you sign in the app), save, then send.' },
          { status: 200 },
        );
      }
    } catch { /* if the template check itself fails, don't block sending */ }

    // Contract name for the subject: skip any missing parts.
    const prettyDate = fmtDate(b.event_date as string);
    const timeRange = [fmtTime(b.start_time as string), fmtTime(b.end_time as string)]
      .filter(Boolean).join(' – ');
    const venueLine = [(b.venue_name as string) || '', (b.event_address as string) || (b.venue_address as string) || '']
      .map((p) => (p || '').trim()).filter(Boolean).join(', ');
    const priceStr = price != null ? money(price, currency) : '';
    const depositStr = (depositPct != null && depositPct > 0 && totalWithTax != null)
      ? money((totalWithTax * depositPct) / 100, currency)
      : (depositAmount != null && depositAmount > 0 ? money(depositAmount, currency) : '');

    const brand = companyName || 'your DJ';

    // Subject: "Contract from [Company] | [event or venue] | [date]" — skip missing parts.
    const middle = isClub ? ((b.venue_name as string) || '') : ((b.event_type as string) || '');
    const subjectParts = [
      companyName ? `Contract from ${companyName}` : 'Contract',
      middle,
      prettyDate,
    ].map((p) => (p || '').trim()).filter(Boolean);
    const subject = subjectParts.join(' | ');

    // Body: personalized, branches on club vs mobile, lists relevant details.
    const detailLines: string[] = [];
    if (isClub) {
      if (b.venue_name) detailLines.push(`Venue: ${b.venue_name as string}`);
      if (prettyDate) detailLines.push(`Date: ${prettyDate}`);
      if (timeRange) detailLines.push(`Set time: ${timeRange}`);
      if (b.set_type) detailLines.push(`Set type: ${b.set_type as string}`);
      if (priceStr) detailLines.push(`Rate: ${priceStr}`);
    } else {
      if (b.event_type) detailLines.push(`Event: ${b.event_type as string}`);
      if (prettyDate) detailLines.push(`Date: ${prettyDate}`);
      if (timeRange) detailLines.push(`Time: ${timeRange}`);
      if (venueLine) detailLines.push(`Venue: ${venueLine}`);
      if (b.package_title) detailLines.push(`Package: ${b.package_title as string}`);
      if (priceStr) detailLines.push(`Total: ${priceStr}`);
      if (depositStr) detailLines.push(`Deposit: ${depositStr}`);
    }

    // Greet the host by name — prefer their resolved account/booking name (first
    // name), falling back to "there" only when we genuinely have no name.
    const greetingName = (clientName && clientName !== 'Client') ? clientName.split(' ')[0] : 'there';
    const intro = isClub
      ? `Please review and sign your booking contract with ${brand}. Details below:`
      : `Please review and sign your contract with ${brand} for your upcoming event. Details below:`;

    // Mobile + deposit: note the follow-up deposit email (Option A wording).
    const depositNote = (!isClub && depositStr)
      ? `\n\nA deposit of ${depositStr} is required to secure your date. Once the contract is signed, you'll receive a separate email with instructions to submit your deposit.`
      : '';

    const signOff = companyName ? `\n\n— ${companyName}` : '';
    const body = `Hi ${greetingName},\n\n${intro}\n\n${detailLines.join('\n')}${depositNote}\n\nClick below to review and sign:\n{{submitter.link}}\n\nQuestions? Just reply to this email.${signOff}`;

    const submission = await withTimeout<unknown>(
      docuseal.createSubmission({
        template_id: Number(templateId) || (templateId as unknown as number),
        order: 'preserved',
        reply_to: djEmail || undefined,
        message: { subject, body },
        submitters: [
          // DJ signs first (embedded, no email). The client is NOT emailed at
          // creation — only after the DJ reviews, signs, and sends, via
          // /api/contracts/send-client. This is what stops the auto-send.
          { role: 'DJ', email: djEmail, name: dj?.name || 'DJ', values, send_email: false },
          { role: 'Client', email: clientEmail, name: clientName, send_email: false },
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
    // Common cause: the chosen contract has no fields placed on it yet, so
    // there's nothing to sign. Give the DJ an actionable message.
    if (/does not contain fields|no fields|without fields/i.test(msg)) {
      msg = 'This contract has no signature fields yet, so there’s nothing to sign. Open it in the Contract Portal, place at least a DJ signature and a Client signature (plus any booking details), save, then send.';
    }
    console.error('[prepare] contract error:', msg);
    // Return 200 with ok:false so the platform doesn't replace this JSON body
    // with a generic HTML 502 — the real reason reaches the app.
    return NextResponse.json({ ok: false, error: msg.slice(0, 500) }, { status: 200 });
  }

  try {
    await admin
      .from('bookings')
      .update({
        contract_submission_id: submissionId != null ? String(submissionId) : null,
        contract_id: usedContractId,
        contract_status: 'awaiting_dj',
        contract_sent_at: new Date().toISOString(),
      } as unknown as never)
      .eq('id', bookingId)
      .eq('dj_id', user.id);
  } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true, embedSrc, submissionId: submissionId != null ? String(submissionId) : null, hasClientSig, hasDjSig });
  } catch (e) {
    // Guarantee a readable JSON error instead of an infra-level 502.
    let msg = 'Prepare crashed.';
    if (e instanceof Error && e.message) msg = e.message;
    else { try { msg = JSON.stringify(e); } catch { /* keep default */ } }
    console.error('[prepare] crash:', msg);
    return NextResponse.json({ ok: false, error: `prepare: ${msg}`.slice(0, 500) }, { status: 200 });
  }
}
