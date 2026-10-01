// /api/dj/payment-reminders — the DJ's automatic payment-reminder settings.
//
// GET  → { depositDays, balanceDays } (null = off)
// POST → save { depositDays, balanceDays } (null or 1–60). OWNER ONLY, since it
//        governs money-chasing messages sent on the DJ's behalf.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getActingContext } from '@/lib/acting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Null = off. Otherwise an integer 1–60 (days after the request was sent).
function clean(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(n, 60);
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  const acting = await getActingContext(user.id);

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data } = await admin
    .from('users')
    .select('payment_reminder_deposit_days, payment_reminder_balance_days')
    .eq('id', acting.djId)
    .maybeSingle();
  const row = (data || {}) as { payment_reminder_deposit_days?: number | null; payment_reminder_balance_days?: number | null };
  return NextResponse.json({
    depositDays: row.payment_reminder_deposit_days ?? null,
    balanceDays: row.payment_reminder_balance_days ?? null,
  });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const acting = await getActingContext(user.id);
  if (acting.role !== 'owner') {
    return NextResponse.json({ error: 'Only the account owner can change payment reminders.' }, { status: 403 });
  }

  let body: { depositDays?: unknown; balanceDays?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { error } = await admin
    .from('users')
    .update({
      payment_reminder_deposit_days: clean(body.depositDays),
      payment_reminder_balance_days: clean(body.balanceDays),
    } as unknown as never)
    .eq('id', acting.djId);
  if (error) return NextResponse.json({ error: 'Could not save.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
