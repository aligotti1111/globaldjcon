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
import { BOT_MIN_TIER } from '@/lib/bookingBot';
import { parseBotTraining, serializeBotTraining } from '@/lib/bookingBotTraining';
import { fetchSiteText, BOT_SITE_URL_MAX } from '@/lib/botSite';

export const runtime = 'nodejs';

// Columns that ALWAYS exist — tier/eligibility + the on/off flag. Keeping the
// instructions column OUT of this read means a not-yet-migrated DB (no
// booking_bot_instructions column) can never break eligibility and wrongly show
// the upgrade prompt to a paid account.
const COLS = 'booking_bot_enabled, dj_type, sub_tier, sub_status, sub_period_end, comp_tier, comp_expires_at, comp_source';
interface Row extends AccessFields { booking_bot_enabled: boolean | null; dj_type: string | null }

// Best-effort read of the custom-instructions column: if the column doesn't
// exist yet, swallow the error and return '' rather than failing the request.
async function readInstructions(db: SupabaseClient, djId: string): Promise<string> {
  try {
    const { data, error } = await db.from('users').select('booking_bot_instructions').eq('id', djId).maybeSingle<{ booking_bot_instructions: string | null }>();
    if (error) return '';
    return data?.booking_bot_instructions || '';
  } catch { return ''; }
}

// Best-effort read of the website columns (URL + last-fetched + whether a text
// snapshot exists). Swallows the error on a not-yet-migrated DB.
async function readSite(db: SupabaseClient, djId: string): Promise<{ url: string; fetchedAt: string | null; hasText: boolean }> {
  try {
    const { data, error } = await db.from('users')
      .select('booking_bot_site_url, booking_bot_site_text, booking_bot_site_fetched_at')
      .eq('id', djId)
      .maybeSingle<{ booking_bot_site_url: string | null; booking_bot_site_text: string | null; booking_bot_site_fetched_at: string | null }>();
    if (error || !data) return { url: '', fetchedAt: null, hasText: false };
    return {
      url: data.booking_bot_site_url || '',
      fetchedAt: data.booking_bot_site_fetched_at || null,
      hasText: !!(data.booking_bot_site_text && data.booking_bot_site_text.trim()),
    };
  } catch { return { url: '', fetchedAt: null, hasText: false }; }
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
  const site = await readSite(db, acting.djId);
  return NextResponse.json({
    ok: true,
    enabled: data?.booking_bot_enabled === true,
    djType: data?.dj_type || 'mobile',
    instructions,
    siteUrl: site.url,
    siteFetchedAt: site.fetchedAt,
    siteHasText: site.hasText,
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

  let body: { enabled?: unknown; instructions?: unknown; siteUrl?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  const hasEnabled = typeof body.enabled === 'boolean';
  const hasInstructions = typeof body.instructions === 'string';
  const hasSiteUrl = typeof body.siteUrl === 'string';
  if (!hasEnabled && !hasInstructions && !hasSiteUrl) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const db = createAdminClient() as unknown as SupabaseClient;
  const { data } = await db.from('users').select(COLS).eq('id', acting.djId).maybeSingle<Row>();
  const eligible = !!data && effectiveTier(data as AccessFields) >= BOT_MIN_TIER;
  // Turning the bot on, or editing instructions/website, all require Premium Pro.
  if ((body.enabled === true || hasInstructions || hasSiteUrl) && !eligible) {
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
    // Normalize server-side: parse → re-serialize drops unknown keys, caps each
    // field, and discards anything that isn't valid structured training — so the
    // client can't store an oversized or malformed blob.
    const next = serializeBotTraining(parseBotTraining(String(body.instructions)));
    const { error } = await db.from('users').update({ booking_bot_instructions: next }).eq('id', acting.djId);
    if (error) {
      return NextResponse.json({ error: 'Your settings are saved, but custom instructions need a quick database update first (the booking_bot_instructions column).' }, { status: 409 });
    }
    savedInstructions = next;
  }

  // Website fallback: fetch the page NOW (never on every chat turn), store a
  // plain-text snapshot + timestamp. An empty string clears it. A fetch failure
  // still saves the URL (with an empty snapshot) and reports why.
  let site = await readSite(db, acting.djId);
  let siteStatus: { ok: boolean; message?: string } | undefined;
  if (hasSiteUrl) {
    const url = String(body.siteUrl).trim().slice(0, BOT_SITE_URL_MAX);
    if (!url) {
      const { error } = await db.from('users')
        .update({ booking_bot_site_url: null, booking_bot_site_text: null, booking_bot_site_fetched_at: null })
        .eq('id', acting.djId);
      if (error) return NextResponse.json({ error: 'Your website needs a quick database update first (the booking_bot_site_* columns).' }, { status: 409 });
      site = { url: '', fetchedAt: null, hasText: false };
      siteStatus = { ok: true };
    } else {
      const fetched = await fetchSiteText(url);
      const { error } = await db.from('users')
        .update({
          booking_bot_site_url: url,
          booking_bot_site_text: fetched.ok ? fetched.text : null,
          booking_bot_site_fetched_at: new Date().toISOString(),
        })
        .eq('id', acting.djId);
      if (error) return NextResponse.json({ error: 'Your website needs a quick database update first (the booking_bot_site_* columns).' }, { status: 409 });
      site = await readSite(db, acting.djId);
      siteStatus = fetched.ok
        ? { ok: true }
        : { ok: false, message: fetched.error || "We saved the link but couldn't read the page." };
    }
  }

  return NextResponse.json({
    ok: true,
    enabled: hasEnabled ? (body.enabled as boolean) : data?.booking_bot_enabled === true,
    instructions: savedInstructions,
    siteUrl: site.url,
    siteFetchedAt: site.fetchedAt,
    siteHasText: site.hasText,
    siteStatus,
  });
}
