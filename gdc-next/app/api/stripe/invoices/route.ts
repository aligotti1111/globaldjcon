// Subscription invoices — list + branded PDF download.
//
//   GET /api/stripe/invoices
//     → { invoices: [{ id, number, dateText, created, amount, currency,
//                       status, description }] }  (newest first, up to 24)
//
//   GET /api/stripe/invoices?id=<invoiceId>&download=1
//     → application/pdf — OUR Global-DJ-Connect-branded invoice PDF for that
//       invoice (see lib/subscriptionInvoicePdf.ts for why we render our own).
//
// OWNER ONLY — billing/invoices belong to the account owner, never a teammate.
// Every invoice returned is verified to belong to the caller's Stripe customer.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/server';
import { getActingContext, canBilling } from '@/lib/acting';
import { buildSubscriptionInvoicePdf, type SubInvoiceLine } from '@/lib/subscriptionInvoicePdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const round2 = (n: number) => Math.round(n * 100) / 100;

function fmtDate(unixSec: number): string {
  try {
    return new Date(unixSec * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

export async function GET(req: NextRequest) {
  // Must be signed in.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  // OWNER ONLY.
  const acting = await getActingContext(user.id);
  if (!canBilling(acting.role)) {
    return NextResponse.json({ error: 'Only the account owner can view invoices.' }, { status: 403 });
  }

  // The caller's Stripe customer id — every invoice we touch must belong to it.
  const admin = createAdminClient();
  const { data: rowData } = await admin
    .from('users')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle();
  const customerId = (rowData as unknown as { stripe_customer_id: string | null } | null)?.stripe_customer_id || null;
  if (!customerId) {
    return NextResponse.json({ error: 'No subscription found for this account.' }, { status: 400 });
  }

  const stripe = getStripe();
  const wantId = req.nextUrl.searchParams.get('id');
  const wantDownload = req.nextUrl.searchParams.get('download');

  // ── PDF download for a single invoice ──
  if (wantId && wantDownload) {
    let inv;
    try {
      inv = await stripe.invoices.retrieve(wantId);
    } catch {
      return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
    }
    // Ownership: the invoice must belong to THIS customer.
    const invCustomer = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id || null;
    if (invCustomer !== customerId) {
      return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
    }

    const currency = (inv.currency || 'usd').toUpperCase();
    const lines: SubInvoiceLine[] = (inv.lines?.data || []).map((li) => {
      const period = li.period && li.period.start && li.period.end
        ? `  (${fmtDate(li.period.start)} – ${fmtDate(li.period.end)})`
        : '';
      return {
        label: `${li.description || 'Subscription'}${period}`,
        amount: round2((li.amount || 0) / 100),
      };
    });
    if (lines.length === 0) {
      lines.push({ label: 'Global DJ Connect subscription', amount: round2((inv.subtotal ?? inv.total ?? 0) / 100) });
    }

    // Discounts (promo codes) are applied at the invoice level, not on the line —
    // so a $49.99 line can settle at $24.99. Surface the discount as its own
    // negative line so the item total, the discount, and the amount paid all
    // reconcile on paper instead of looking like a mismatch.
    const discountCents = (inv.total_discount_amounts || []).reduce((s, d) => s + Number(d.amount || 0), 0);
    if (discountCents > 0) {
      lines.push({ label: 'Discount', amount: -round2(discountCents / 100) });
    }

    const paid = inv.status === 'paid';
    const totalCents = paid ? (inv.amount_paid || inv.total || 0) : (inv.amount_due || inv.total || 0);

    // Billing address — Stripe snapshots it onto the invoice (customer_address).
    // Format to readable lines, dropping any blank field.
    const addr = inv.customer_address || null;
    const addressLines: string[] = [];
    if (addr) {
      if (addr.line1) addressLines.push(addr.line1);
      if (addr.line2) addressLines.push(addr.line2);
      const cityLine = [addr.city, addr.state, addr.postal_code].filter(Boolean).join(', ');
      if (cityLine) addressLines.push(cityLine);
      if (addr.country) addressLines.push(addr.country);
    }

    const pdfBytes = await buildSubscriptionInvoicePdf({
      number: inv.number || wantId,
      dateText: fmtDate(inv.created),
      currency,
      billedTo: {
        name: inv.customer_name || null,
        email: inv.customer_email || null,
        addressLines,
      },
      lines,
      total: { label: paid ? 'Paid' : 'Amount due', amount: round2(totalCents / 100) },
      note: paid
        ? 'This invoice has been paid. Thank you for being a Global DJ Connect member.'
        : 'This invoice reflects the amount due on your Global DJ Connect subscription.',
    });

    const pdf = Buffer.from(pdfBytes);
    const fname = `GlobalDJConnect-Invoice-${(inv.number || wantId).replace(/[^\w-]/g, '')}.pdf`;
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fname}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // ── List ──
  try {
    const list = await stripe.invoices.list({ customer: customerId, limit: 24 });
    const invoices = (list.data || []).map((inv) => ({
      id: inv.id,
      number: inv.number || inv.id,
      created: inv.created,
      dateText: fmtDate(inv.created),
      amount: round2((inv.status === 'paid' ? (inv.amount_paid || inv.total || 0) : (inv.amount_due || inv.total || 0)) / 100),
      currency: (inv.currency || 'usd').toUpperCase(),
      status: inv.status || 'open',
      description: inv.lines?.data?.[0]?.description || 'Subscription',
    }));
    return NextResponse.json({ invoices });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Could not load invoices: ${detail}` }, { status: 500 });
  }
}
