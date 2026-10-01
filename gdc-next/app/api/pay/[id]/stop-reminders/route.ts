// GET /api/pay/[id]/stop-reminders
//
// The "Already paid — stop these reminders" link in a payment-reminder email.
// No login: the payment id is an unguessable UUID (a capability URL, same as the
// pay links). It flips booking_payments.payment_reminders_stopped on JUST this
// row, so the host stops hearing about this one deposit/balance — the other
// request (if any) is untouched. Returns a tiny confirmation page.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function page(title: string, body: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#0a0a0c;color:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;">
<div style="max-width:440px;text-align:center;">
<div style="font-family:Impact,Arial,sans-serif;font-size:26px;letter-spacing:.06em;color:#00f5c4;margin-bottom:18px;">GLOBAL DJ CONNECT</div>
<h1 style="font-size:20px;margin:0 0 10px;">${title}</h1>
<p style="color:#8d95a0;font-size:15px;line-height:1.6;margin:0;">${body}</p>
</div></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();
  const db = admin as unknown as SupabaseClient;

  const { data } = await db
    .from('booking_payments')
    .select('id, kind')
    .eq('id', id)
    .maybeSingle();
  const pay = data as { id: string; kind: string | null } | null;
  if (!pay) return page('Link not found', 'We couldn’t find that payment. It may have been removed.');

  const kind = pay.kind === 'deposit' ? 'deposit' : pay.kind === 'balance' ? 'balance' : 'payment';
  await db
    .from('booking_payments')
    .update({ payment_reminders_stopped: true } as unknown as never)
    .eq('id', id);

  return page('Reminders stopped', `You won’t get any more reminders about this ${kind}. If you still owe it, you can pay any time from the original link.`);
}
