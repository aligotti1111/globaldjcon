// /api/dj/discounts — read + write ONLY the discount/promo-code portion of a
// DJ's booking_settings.
//
// Why this exists: discounts are the one piece of Booking Settings a teammate
// may touch (managers + admins, not assistants). Everything else on that page
// stays owner-only. A teammate acts on the OWNER's account (acting.djId), and
// they can't update the owner's users row directly through the client (RLS),
// so this route does the merge server-side with the service-role client.
//
// GET  → { promo_codes, sale, sale_history, exclusions, rate_currency }
// POST → merges any of { promo_codes, sale, sale_history, exclusions } into the
//        owner's booking_settings, leaving every other setting untouched.
//
// Manager+ only (owner / admin / manager). Assistants get 403.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext, canDiscounts } from '@/lib/acting';
import { logActivity } from '@/lib/activityLog';

export const runtime = 'nodejs';
export const maxDuration = 15;

// The keys this route is allowed to read/write. Guards against a teammate
// writing arbitrary booking_settings through the discounts endpoint.
const DISCOUNT_KEYS = ['promo_codes', 'sale', 'sale_history', 'exclusions'] as const;
type DiscountKey = (typeof DISCOUNT_KEYS)[number];

function parseSettings(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return { ...(raw as Record<string, unknown>) };
  if (typeof raw === 'string' && raw.trim()) {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

async function loadSettings(djId: string): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('users')
    .select('booking_settings')
    .eq('id', djId)
    .maybeSingle();
  return parseSettings((data as { booking_settings?: unknown } | null)?.booking_settings);
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const acting = await getActingContext(user.id);
  if (!canDiscounts(acting.role)) {
    return NextResponse.json({ error: 'You do not have permission to manage discounts.' }, { status: 403 });
  }

  const settings = await loadSettings(acting.djId);
  return NextResponse.json({
    promo_codes: settings.promo_codes ?? [],
    sale: settings.sale ?? {},
    sale_history: settings.sale_history ?? [],
    exclusions: settings.exclusions ?? [],
    rate_currency: settings.rate_currency ?? 'USD',
  });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const acting = await getActingContext(user.id);
  if (!canDiscounts(acting.role)) {
    return NextResponse.json({ error: 'You do not have permission to manage discounts.' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  // Merge ONLY the discount keys present in the body onto the owner's current
  // booking_settings. Any other setting is preserved exactly as saved.
  const settings = await loadSettings(acting.djId);
  let touched = false;
  for (const k of DISCOUNT_KEYS) {
    if (k in body) { settings[k] = body[k as DiscountKey]; touched = true; }
  }
  if (!touched) return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 });

  const payload = JSON.stringify(settings);
  const admin = createAdminClient();
  const { error } = await admin
    .from('users')
    .update({ booking_settings: payload } as unknown as never)
    .eq('id', acting.djId);
  if (error) return NextResponse.json({ error: error.message || 'Could not save.' }, { status: 502 });

  // Log the action so the owner's activity log shows who changed discounts.
  const codeCount = Array.isArray(settings.promo_codes) ? settings.promo_codes.length : 0;
  const saleOn = !!(settings.sale && typeof settings.sale === 'object' && (settings.sale as { active?: boolean }).active);
  await logActivity(acting, {
    action: 'discounts.updated',
    summary: `Updated discounts (${codeCount} promo code${codeCount === 1 ? '' : 's'}${saleOn ? ', sale on' : ''})`,
  });

  return NextResponse.json({ ok: true });
}
