// /api/dj/receipt-settings — the address line printed on this DJ's invoices and
// receipts. Deliberately a SEPARATE field (users.receipt_address) from the
// account address, so changing what shows on receipts never touches the master
// address, the ZIP-derived timezone, or the public profile.
//
//   GET  -> { receiptAddress, accountAddress }
//           receiptAddress: null => using the account default
//                           ''   => showing NO address on receipts
//                           text => a custom receipt address
//   POST { address: string | null }
//           null => reset to the account default
//           ''   => show no address
//           text => use this exact line
//
// Stored on the OWNER's row (acting.djId) for team seats. Never 502 — always 500.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext, canEditProfile } from '@/lib/acting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function accountAddressOf(dj: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null } | null): string {
  if (!dj) return '';
  return (dj.address && dj.address.trim())
    || [dj.city, [dj.state, dj.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    || '';
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
    const acting = await getActingContext(user.id);
    const admin = createAdminClient();
    const { data } = await admin
      .from('users')
      .select('address, city, state, zip, phone, receipt_address, receipt_color, receipt_phone')
      .eq('id', acting.djId)
      .maybeSingle();
    const dj = data as { address?: string | null; city?: string | null; state?: string | null; zip?: string | null; phone?: string | null; receipt_address?: string | null; receipt_color?: string | null; receipt_phone?: string | null } | null;
    return NextResponse.json({
      receiptAddress: dj?.receipt_address ?? null,
      accountAddress: accountAddressOf(dj),
      receiptColor: dj?.receipt_color ?? null,
      receiptPhone: dj?.receipt_phone ?? null,
      accountPhone: dj?.phone ?? '',
    });
  } catch {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
    const acting = await getActingContext(user.id);
    if (!canEditProfile(acting.role)) {
      return NextResponse.json({ error: 'You do not have permission to change receipt settings.' }, { status: 403 });
    }
    const body = (await req.json().catch(() => ({}))) as { address?: string | null; color?: string | null; phone?: string | null };
    const update: Record<string, string | null> = {};
    // Only touch the fields the caller actually sent (key present in body).
    if ('address' in body) {
      // null => reset to account default; string (incl. '') => store as-is (trimmed).
      update.receipt_address = body.address == null ? null : String(body.address).slice(0, 300).trim();
    }
    if ('phone' in body) {
      // null => account phone; '' => no phone; text => custom.
      update.receipt_phone = body.phone == null ? null : String(body.phone).slice(0, 40).trim();
    }
    if ('color' in body) {
      // null/'' => house default; otherwise must be a #rrggbb hex.
      const c = body.color == null ? '' : String(body.color).trim();
      update.receipt_color = /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : null;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
    }
    const admin = createAdminClient();
    const { error } = await admin
      .from('users')
      .update(update as unknown as never)
      .eq('id', acting.djId);
    if (error) return NextResponse.json({ error: 'Could not save receipt settings.' }, { status: 500 });
    return NextResponse.json({ ok: true, ...update });
  } catch {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
