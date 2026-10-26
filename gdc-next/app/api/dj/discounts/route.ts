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

// ── Input validation ─────────────────────────────────────────────────────────
// A teammate's save overwrites the owner's whole discount set, so the client is
// trusted for shape today. Re-validate here (the boundary) so a crafted body
// can't plant a negative percent, a NaN value, a non-date exclusion, or a
// megabyte "code" into the money path. Each key is coerced to a known-good
// shape; junk entries are dropped, not stored.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function finiteNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
function cleanSale(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object') return {};
  const s = v as Record<string, unknown>;
  const pctRaw = finiteNum(s.percent);
  const pct = pctRaw == null ? 0 : Math.min(100, Math.max(0, Math.round(pctRaw)));
  // A percent of 0 means "no sale" — store an empty object (cleared) so the
  // rest of the app treats it as off.
  if (pct <= 0) return {};
  const out: Record<string, unknown> = { percent: pct, active: s.active === true };
  out.starts = DATE_RE.test(String(s.starts)) ? s.starts : null;
  out.ends = DATE_RE.test(String(s.ends)) ? s.ends : null;
  if (typeof s.started_at === 'string') out.started_at = s.started_at;
  if (typeof s.show_on_profile === 'boolean') out.show_on_profile = s.show_on_profile;
  return out;
}
function cleanCodes(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    const code = String(c.code ?? '').trim().toUpperCase().slice(0, 64);
    if (!code || seen.has(code)) continue;
    const type = c.type === 'flat' ? 'flat' : 'percent';
    const valRaw = finiteNum(c.value);
    if (valRaw == null || valRaw <= 0) continue;
    const value = type === 'percent' ? Math.min(100, Math.max(1, Math.round(valRaw))) : Math.round(valRaw);
    const entry: Record<string, unknown> = { code, type, value, active: c.active !== false };
    if (DATE_RE.test(String(c.expires))) entry.expires = c.expires;
    const maxUses = finiteNum(c.maxUses);
    if (maxUses != null && maxUses >= 1) entry.maxUses = Math.round(maxUses);
    const uses = finiteNum(c.uses);
    if (uses != null && uses >= 0) entry.uses = Math.round(uses);
    seen.add(code);
    out.push(entry);
  }
  return out;
}
function cleanExclusions(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const date = String(e.date ?? '');
    if (!DATE_RE.test(date) || seen.has(date)) continue;
    const sale = e.sale === true;
    const codes = e.codes === true;
    // Both false is a no-op exclusion — drop it rather than store dead data.
    if (!sale && !codes) continue;
    seen.add(date);
    out.push({ date, sale, codes });
  }
  return out;
}
function sanitizeDiscountValue(key: DiscountKey, value: unknown): unknown {
  switch (key) {
    case 'sale': return cleanSale(value);
    case 'promo_codes': return cleanCodes(value);
    case 'exclusions': return cleanExclusions(value);
    // History is an append-only archive of ended sales — preserve its entries
    // (and any fields they carry) verbatim; only guard that it's an array.
    case 'sale_history': return Array.isArray(value) ? value : [];
    default: return value;
  }
}

// ── Activity-log summary ────────────────────────────────────────────────────
// The client sends the whole discount set on every save, so we can't tell what
// changed from the body alone. Diff the OWNER's stored settings (before) against
// the merged result (after) and name the single action the DJ just took.
function num(v: unknown): number { return typeof v === 'number' ? v : 0; }
function arr(v: unknown): Record<string, unknown>[] { return Array.isArray(v) ? (v as Record<string, unknown>[]) : []; }
// A "sale" only counts as a real, running/scheduled site-wide sale once it has
// a percent — an empty {} is a cleared/ended sale.
function saleLive(s: unknown): boolean { return !!(s && typeof s === 'object' && num((s as { percent?: unknown }).percent) > 0); }

function describeChange(before: Record<string, unknown>, after: Record<string, unknown>): string {
  const bSale = before.sale as { percent?: unknown } | undefined;
  const aSale = after.sale as { percent?: unknown } | undefined;
  const bLive = saleLive(bSale);
  const aLive = saleLive(aSale);
  const bHist = arr(before.sale_history).length;
  const aHist = arr(after.sale_history).length;

  // Site-wide sale transitions take priority — they're the headline action.
  if (bLive && !aLive && aHist > bHist) return `Manually ended the site-wide sale (${num(bSale?.percent)}% off)`;
  if (bLive && !aLive) return 'Cleared the site-wide sale';
  if (!bLive && aLive) return `Started a site-wide sale (${num(aSale?.percent)}% off)`;
  if (bLive && aLive && num(bSale?.percent) !== num(aSale?.percent)) return `Changed the site-wide sale to ${num(aSale?.percent)}% off`;

  // Promo-code changes.
  const bCodes = arr(before.promo_codes);
  const aCodes = arr(after.promo_codes);
  const codeOf = (c: Record<string, unknown>) => String(c.code || '').toUpperCase();
  if (aCodes.length > bCodes.length) {
    const added = aCodes.find((c) => !bCodes.some((x) => codeOf(x) === codeOf(c)));
    return `Added promo code ${added ? codeOf(added) : ''}`.trim();
  }
  if (aCodes.length < bCodes.length) {
    const removed = bCodes.find((c) => !aCodes.some((x) => codeOf(x) === codeOf(c)));
    return `Removed promo code ${removed ? codeOf(removed) : ''}`.trim();
  }
  const toggled = aCodes.find((c) => {
    const b = bCodes.find((x) => codeOf(x) === codeOf(c));
    return b && b.active !== c.active;
  });
  if (toggled) return `${toggled.active === false ? 'Deactivated' : 'Activated'} promo code ${codeOf(toggled)}`.trim();
  const edited = aCodes.find((c) => {
    const b = bCodes.find((x) => codeOf(x) === codeOf(c));
    return b && JSON.stringify(b) !== JSON.stringify(c);
  });
  if (edited) return `Updated promo code ${codeOf(edited)}`.trim();

  // Date exclusions (dates where discounts are blocked).
  const bEx = arr(before.exclusions).length;
  const aEx = arr(after.exclusions).length;
  if (aEx > bEx) return 'Blocked discounts on a date';
  if (aEx < bEx) return 'Removed a discount date block';

  return 'Updated discounts';
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
  // booking_settings. Any other setting is preserved exactly as saved. Keep the
  // BEFORE snapshot so the activity log can describe the specific change.
  const before = await loadSettings(acting.djId);
  const after: Record<string, unknown> = { ...before };
  let touched = false;
  for (const k of DISCOUNT_KEYS) {
    if (k in body) { after[k] = sanitizeDiscountValue(k, body[k as DiscountKey]); touched = true; }
  }
  if (!touched) return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 });

  const payload = JSON.stringify(after);
  const admin = createAdminClient();
  const { error } = await admin
    .from('users')
    .update({ booking_settings: payload } as unknown as never)
    .eq('id', acting.djId);
  if (error) return NextResponse.json({ error: error.message || 'Could not save.' }, { status: 502 });

  // Log the specific action so the owner's activity log reads clearly, e.g.
  // "Started a site-wide sale (10% off)" or "Manually ended the site-wide sale".
  await logActivity(acting, {
    action: 'discounts.updated',
    summary: describeChange(before, after),
  });

  return NextResponse.json({ ok: true });
}
