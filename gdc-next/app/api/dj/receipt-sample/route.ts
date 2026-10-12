// /api/dj/receipt-sample — a live PREVIEW of how this DJ's receipt looks with
// their current logo + address. Builds a REAL receipt PDF (same generator the
// emailed receipts use) from placeholder booking data, so the Receipt tab can
// show an exact sample. No booking is touched and nothing is sent.
//
// GET -> application/pdf (inline). DJ-authed. Returns a tiny PDF-less 200 note
// only on hard failure, never 502.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext } from '@/lib/acting';
import { buildDocumentPdf } from '@/lib/receiptPdf';
import { fetchLogo } from '@/lib/receiptDocs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response('Not signed in.', { status: 401 });
    const acting = await getActingContext(user.id);

    const admin = createAdminClient();
    const { data } = await admin
      .from('users')
      .select('name, address, city, state, zip, phone, contract_logo_url, receipt_address, receipt_color, receipt_phone')
      .eq('id', acting.djId)
      .maybeSingle();
    const dj = (data || {}) as {
      name?: string | null; address?: string | null; city?: string | null; state?: string | null;
      zip?: string | null; phone?: string | null; contract_logo_url?: string | null; receipt_address?: string | null; receipt_color?: string | null; receipt_phone?: string | null;
    };

    // Same address resolution the real receipt uses: the receipt override wins
    // (''=no address), else the account address.
    let accountAddr = (dj.address && dj.address.trim())
      || [dj.city, [dj.state, dj.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
      || '';
    if (dj.zip && String(dj.zip).trim() && accountAddr && !accountAddr.includes(String(dj.zip).trim())) {
      accountAddr = `${accountAddr} ${String(dj.zip).trim()}`;
    }
    const addressLine = dj.receipt_address != null ? dj.receipt_address.trim() : accountAddr;
    const phoneLine = dj.receipt_phone != null ? (dj.receipt_phone.trim() || null) : (dj.phone || null);

    const logo = await fetchLogo(dj.contract_logo_url);

    // Placeholder "what a paid receipt looks like" — a deposit received on a
    // sample wedding, with the remaining balance noted. Clearly a sample.
    const pdfBytes = await buildDocumentPdf({
      kind: 'receipt',
      title: 'RECEIPT',
      docNumber: 'GDC-SAMPLE',
      dateText: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      currency: 'USD',
      accentHex: dj.receipt_color || null,
      business: {
        name: dj.name || 'Your Business Name',
        address: addressLine || null,
        phone: phoneLine,
        logo,
      },
      client: { name: 'Sample Client', email: 'client@example.com' },
      event: {
        title: 'Wedding Reception',
        dateText: 'Saturday, June 20, 2026',
        timeText: '6:00 PM – 11:00 PM',
        venue: 'The Grand Ballroom',
      },
      details: [
        { label: 'Event Type', value: 'Wedding' },
        { label: 'Package', value: 'Signature DJ Package' },
      ],
      lines: [
        { label: 'Event total (incl. tax)', amount: 2400 },
        { label: 'Deposit Received (25%)', amount: 600, emphasis: 'bold' },
        { label: 'Remaining balance', amount: 1800, emphasis: 'muted', ruleAbove: true },
      ],
      headline: { label: 'Deposit Received', amount: 600 },
    });

    return new Response(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="receipt-sample.pdf"',
        // Private per-DJ sample. Cache briefly so re-opening the tab is instant;
        // saving a setting or hitting Refresh changes the ?ts= and busts it.
        'Cache-Control': 'private, max-age=120',
      },
    });
  } catch {
    return new Response('Could not build the sample.', { status: 500 });
  }
}
