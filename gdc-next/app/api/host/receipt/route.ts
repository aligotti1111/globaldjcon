// GET /api/host/receipt?bookingId=<id>&kind=deposit|balance
//
// Host-facing receipt download. The DJ has /api/payments (action:download-receipt),
// but that's DJ-gated. This lets the HOST who made the booking download their own
// receipt PDF for a settled deposit/balance — used by the read-only pipeline on
// the Past Events / Upcoming Events cards.
//
// Access: the caller must be signed in AND be the booking's requester_id. Only
// paid/settled amounts produce a receipt.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildBookingDocAttachment } from '@/lib/receiptDocs';

export const dynamic = 'force-dynamic';

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(req: NextRequest) {
  const bookingId = req.nextUrl.searchParams.get('bookingId') || '';
  const kind = req.nextUrl.searchParams.get('kind') === 'deposit' ? 'deposit' : 'balance';
  if (!bookingId) return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });

  // Auth — must be the host who owns this booking.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  // Admin client to read the booking + DJ + payment rows (all owned by the DJ
  // under RLS). Safe: we verify requester ownership before returning anything.
  const db = createAdminClient();

  const { data: bData } = await db
    .from('bookings')
    .select('id, requester_id, dj_id, currency, deposit_amount, total_with_tax, counter_rate, quoted_rate, offer_amount, status_overrides')
    .eq('id', bookingId)
    .maybeSingle();
  const b = bData as {
    id: string; requester_id: string | null; dj_id: string | null; currency: string | null;
    deposit_amount: number | null; total_with_tax: number | null; counter_rate: number | null;
    quoted_rate: number | null; offer_amount: number | null;
    status_overrides: Record<string, boolean> | string | null;
  } | null;

  if (!b) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
  if (b.requester_id !== user.id) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
  if (!b.dj_id) return NextResponse.json({ error: 'No receipt available.' }, { status: 404 });

  // Only settled payments of this kind produce a receipt. The generated types
  // predate booking_payments, so cast the client for this one query.
  const payDb = db as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, v: string) => Promise<{ data: Record<string, unknown>[] | null }>;
      };
    };
  };
  const { data: payData } = await payDb
    .from('booking_payments')
    .select('kind, status, amount_paid')
    .eq('booking_id', bookingId);
  const pays = ((payData as { kind: string; status: string; amount_paid: number | null }[] | null) || []);
  const settled = (s: string) => s === 'paid' || s === 'waived';
  // The DJ may have marked this stage complete manually (paid in full in cash)
  // via status_overrides, with no payment row — honor that too.
  let overrides: Record<string, boolean> = {};
  if (b.status_overrides) {
    try {
      overrides = typeof b.status_overrides === 'string' ? JSON.parse(b.status_overrides) : b.status_overrides;
    } catch { overrides = {}; }
  }
  const overrideKey = kind === 'balance' ? 'invoice' : 'deposit';
  const thisKindPaid = pays.some((p) => p.kind === kind && settled(p.status)) || !!overrides[overrideKey];
  if (!thisKindPaid) return NextResponse.json({ error: 'No settled payment to receipt.' }, { status: 404 });

  const cur = b.currency || 'USD';
  const agreed = Number(b.total_with_tax ?? b.counter_rate ?? b.quoted_rate ?? b.offer_amount ?? 0);
  const paidSoFar = pays.reduce((s, r) => s + Number(r.amount_paid || 0), 0);

  let received: number;
  let paidToDate: number;
  if (kind === 'deposit') {
    received = b.deposit_amount != null ? Number(b.deposit_amount) : round2(agreed);
    paidToDate = round2(paidSoFar > 0 ? paidSoFar : received);
  } else {
    received = round2(Math.max(0, agreed - (b.deposit_amount != null ? Number(b.deposit_amount) : 0)));
    paidToDate = round2(agreed);
  }

  const receiptAtt = await buildBookingDocAttachment(db, {
    docKind: 'receipt',
    bookingId,
    djId: b.dj_id,
    currency: cur,
    paymentKind: kind,
    receivedNow: received,
    method: null,
    paidToDate,
    clientEmail: null,
  });
  if (!receiptAtt) return NextResponse.json({ error: 'Could not build the receipt.' }, { status: 500 });

  const pdf = Buffer.from(receiptAtt.content, 'base64');
  return new NextResponse(pdf, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${receiptAtt.filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
