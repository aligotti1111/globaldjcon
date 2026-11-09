// /api/dj/booking-bot-setting
//
//   GET  — { enabled, eligible } : is the profile booking bot on, and is this
//          account allowed to use it (Premium Pro / tier >= BOT_MIN_TIER)?
//   POST — turn it on/off. Body { enabled: boolean }. OWNER ONLY. Enabling is
//          rejected unless the account is Premium Pro or higher — the feature is
//          tier-gated, so a lower tier can't switch it on from a stale UI.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActingContext } from '@/lib/acting';
import { effectiveTier, type AccessFields } from '@/lib/access';
import { BOT_MIN_TIER, BOT_MAX_INSTRUCTIONS } from '@/lib/bookingBot';

export const runtime = 'nodejs';

// Columns that ALWAYS exist — tier/eligibility + the on/off flag. Keeping the
// instructions column OUT of this read means a not-yet-migrated DB (no
// booking_bot_instructions column) can never break eligibility and wrongly show
// the upgrade prompt to a paid account.
const COLS = 'booking_bot_enabled, sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, comp_source';
interface Row extends AccessFields { booking_bot_enabled: boolean | null }

// Best-effort read of the custom-instructions column: if the column doesn't
// exist yet, swallow the error and return '' rather than failing the request.
async function readInstructions(db: SupabaseClient, djId: string): Promise<string> {
  try {
    const { data, error } = await db.from('users').select('booking_bot_instructions').eq('id', djId).maybeSingle<{ booking_bot_instructions: string | null }>();
    if (error) return '';
    return data?.booking_bot_instructions || '';
  } catch { return ''; }
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const acting = await getActingContext(user.id);
  const db = createAdminClient() as unknown as SupabaseClient;
  const { data } = await db.from('users').select(COLS).eq('id', acting.djId).maybeSingle<Row>();
  const eligible = !!data && effectiveTier(data as AccessFields) >= BOT_MIN_TIER;
  const instructions = await readInstructions(db, acting.djId);
  return NextResponse.json({
    ok: true,
    enabled: data?.booking_bot_enabled === true,
    instructions,
    eligible,
  });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const acting = await getActingContext(user.id);
  if (acting.role !== 'owner') {
    return NextResponse.json({ error: 'Only the account owner can change this.' }, { status: 403 });
  }

  let body: { enabled?: unknown; instructions?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  const hasEnabled = typeof body.enabled === 'boolean';
  const hasInstructions = typeof body.instructions === 'string';
  if (!hasEnabled && !hasInstructions) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const db = createAdminClient() as unknown as SupabaseClient;
  const { data } = await db.from('users').select(COLS).eq('id', acting.djId).maybeSingle<Row>();
  const eligible = !!data && effectiveTier(data as AccessFields) >= BOT_MIN_TIER;
  // Turning the bot on, or setting custom instructions, both require Premium Pro.
  if ((body.enabled === true || hasInstructions) && !eligible) {
    return NextResponse.json({ error: 'The booking assistant is a Premium Pro feature.' }, { status: 403 });
  }

  // Save the on/off flag (always-present column) on its own, so saving it never
  // depends on the instructions column existing.
  if (hasEnabled) {
    const { error } = await db.from('users').update({ booking_bot_enabled: body.enabled as boolean }).eq('id', acting.djId);
    if (error) return NextResponse.json({ error: 'Could not save your setting.' }, { status: 500 });
  }

  // Save instructions separately; if the column isn't migrated yet, report that
  // specifically instead of failing the whole request.
  let savedInstructions = await readInstructions(db, acting.djId);
  if (hasInstructions) {
    const next = String(body.instructions).slice(0, BOT_MAX_INSTRUCTIONS);
    const { error } = await db.from('users').update({ booking_bot_instructions: next }).eq('id', acting.djId);
    if (error) {
      return NextResponse.json({ error: 'Your settings are saved, but custom instructions need a quick database update first (the booking_bot_instructions column).' }, { status: 409 });
    }
    savedInstructions = next;
  }

  return NextResponse.json({
    ok: true,
    enabled: hasEnabled ? (body.enabled as boolean) : data?.booking_bot_enabled === true,
    instructions: savedInstructions,
  });
}
