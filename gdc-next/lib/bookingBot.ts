// lib/bookingBot.ts — the "brain" config for the BOOKER-facing profile bot.
//
// WHAT THIS IS
// A chat helper that lives ONLY on a DJ's public profile. It answers a
// potential client's questions, gives a PRICE RANGE from that DJ's own packages
// (mobile) or hourly/flat rate (club/bar), and collects the details needed to
// start a booking request. It never quotes an exact price, confirms a date, or
// takes payment — exact pricing + the real packages appear on the booking form,
// and the DJ still approves every request.
//
// GATING: Premium Pro and up (tier >= 3), AND the DJ switched it on. Anonymous
// visitors get a few free messages, then a wall asking them to create an account
// to keep chatting (enforced in the route via a signed cookie).
//
// PURE module: no DB, no network, no secrets EXCEPT the cookie HMAC helpers,
// which only use Node's crypto + an env secret.

import crypto from 'crypto';
import { normalizeMobPackages } from '@/app/(main)/[slug]/packageModel';
import type { BookingSettings } from '@/app/(main)/[slug]/bookingSettings';

// ── Model / limits ──────────────────────────────────────────────
export const BOT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
export const BOT_MAX_TOKENS = 600;
export const BOT_MAX_MESSAGES = 24;
export const BOT_MAX_INPUT_CHARS = 2000;

// Free messages an ANONYMOUS visitor gets before the "make an account" wall.
export const BOT_FREE_MESSAGES = 4;

// Premium Pro is tier 3. The booker bot is this tier and up.
export const BOT_MIN_TIER = 3;

// ── Price range ─────────────────────────────────────────────────
export interface PriceRange {
  hasPrice: boolean;
  min: number;
  max: number;
  unit: 'package' | 'flat' | 'hourly';
  currency: string;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function rangeOf(values: (number | null)[], unit: PriceRange['unit'], currency: string): PriceRange {
  const nums = values.filter((n): n is number => n != null);
  if (nums.length === 0) return { hasPrice: false, min: 0, max: 0, unit, currency };
  return { hasPrice: true, min: Math.min(...nums), max: Math.max(...nums), unit, currency };
}

// Mobile DJ: the floor-to-ceiling of every configured package price.
export function mobileRange(settings: BookingSettings): PriceRange {
  const currency = settings.rate_currency || 'USD';
  const mob = normalizeMobPackages(settings.mob_packages as Record<string, unknown> | undefined);
  const prices: (number | null)[] = [];
  for (const p of mob.general) prices.push(num((p as Record<string, unknown>).price));
  for (const k of Object.keys(mob.overrides)) {
    for (const p of mob.overrides[k]) prices.push(num((p as Record<string, unknown>).price));
  }
  return rangeOf(prices, 'package', currency);
}

// Club/bar DJ: from the universal flat or hourly rate fields. 'offers' mode (and
// no rates set) => no price, intake-only.
export function clubRange(settings: BookingSettings): PriceRange {
  const currency = settings.rate_currency || 'USD';
  const type = (settings.global_rate_type as string) || 'flat';
  if (type === 'offers') return { hasPrice: false, min: 0, max: 0, unit: 'flat', currency };
  if (type === 'hourly') {
    return rangeOf(
      [settings.rate_hourly_with_system, settings.rate_hourly_with_decks, settings.rate_hourly_no_equip].map(num),
      'hourly', currency,
    );
  }
  return rangeOf(
    [settings.rate_with_system, settings.rate_with_decks, settings.rate_no_equip].map(num),
    'flat', currency,
  );
}

export function priceRangeFor(djType: string, settings: BookingSettings | null | undefined): PriceRange {
  const s = settings || ({} as BookingSettings);
  if (djType === 'club') return clubRange(s);
  return mobileRange(s);
}

function money(n: number, ccy: string): string {
  return `${ccy || 'USD'} ${Math.round(n)}`;
}

export function describeRange(r: PriceRange): string {
  if (!r.hasPrice) return 'No set prices — custom quote per event (collect details and the DJ will price it).';
  const span = r.min === r.max ? money(r.min, r.currency) : `${money(r.min, r.currency)}–${money(r.max, r.currency)}`;
  const suffix = r.unit === 'hourly' ? ' per hour' : (r.unit === 'package' ? ' depending on the package (hours, add-ons)' : '');
  return `Approximate ${r.unit === 'hourly' ? 'hourly ' : ''}range: ${span}${suffix}. This is a ballpark — the exact packages and price show on the booking form.`;
}

// ── System prompt (booker-facing) ───────────────────────────────
export function buildBotSystemPrompt(djName: string, djType: string, range: PriceRange, faq: string): string {
  const name = (djName || '').trim() || 'this DJ';
  const typeLabel = djType === 'club' ? 'club/bar' : 'mobile';
  return `You are the booking assistant on ${name}'s Global DJ Connect profile. ${name} is a ${typeLabel} DJ. You're talking to a potential client (a host/promoter) who's considering booking ${name}.

YOUR JOBS:
1. Answer their questions about booking ${name} — what's included, how booking works, general policies — using the FAQ and facts below.
2. When they ask about price, give the RANGE below. Never quote an exact figure or promise a specific total — tell them the exact packages and price appear on the booking request form once they enter their details.
3. Collect what's needed to start a booking request: event type, date, start & end time, venue/location, and their name + email (or phone). Ask for missing pieces naturally, a couple at a time.
4. Once you have the essentials (at least event type, date, and a way to contact them), tell them you'll hand this to the booking request form to review and submit — the real packages/price will be there, and ${name} personally approves every request.

HARD RULES:
- You CANNOT confirm a date, lock a booking, take payment, or sign anything. You only answer, quote ranges, and gather details.
- Pricing: ${describeRange(range)}
- If there's no set price, say pricing is custom for each event and focus on collecting their details for a quote — never invent a number.
- Availability: you don't have the live calendar. If asked whether a date is open, say the availability calendar on this page shows open and booked dates, and offer to take their details so ${name} can confirm.
- Only state facts from the FAQ/context below. Don't invent packages, inclusions, or policies. If you don't know, say so and offer to collect their details.
- Be warm, friendly and concise — a sentence or two. You represent ${name}'s brand.

${faq ? `FAQ / about ${name}:\n${faq}` : `(No FAQ provided — stick to booking logistics and collecting details.)`}`;
}

// ── Anonymous message-cap cookie (signed) ───────────────────────
// A tiny tamper-resistant counter so clearing React state can't reset the free
// allowance. Value is "count.sig"; sig = HMAC(djId:count). Logged-in users skip
// this entirely (the route checks auth first).
function secret(): string {
  return process.env.BOOKING_BOT_SECRET || process.env.CRON_SECRET || 'gdc-booking-bot';
}
export function cookieName(djId: string): string {
  return 'bb_' + djId.replace(/[^a-z0-9]/gi, '').slice(0, 12);
}
function sign(djId: string, count: number): string {
  return crypto.createHmac('sha256', secret()).update(`${djId}:${count}`).digest('hex').slice(0, 20);
}
export function makeCookieValue(djId: string, count: number): string {
  return `${count}.${sign(djId, count)}`;
}
// Returns the verified count, or 0 if missing/tampered.
export function readCookieCount(djId: string, raw: string | undefined): number {
  if (!raw) return 0;
  const [cStr, sig] = raw.split('.');
  const count = parseInt(cStr, 10);
  if (!Number.isFinite(count) || count < 0) return 0;
  return sig === sign(djId, count) ? count : 0;
}
