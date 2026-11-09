// lib/djAssistant.ts — the "brain" config for the DJ-facing assistant.
//
// WHAT THIS IS
// A read-only helper that answers a logged-in DJ's questions about their OWN
// existing bookings and helps them find their way around the app. It does NOT
// take actions — no sending, no money, no edits. If a DJ asks it to DO
// something, it tells them where to do it themselves.
//
// This module is PURE: no DB, no network, no secrets. The API route
// (app/api/dj/assistant/route.ts) loads the data, calls formatSnapshot() and
// buildSystemPrompt(), and hits Anthropic. Keeping the prompt + site map here
// means the "what the assistant knows and how it behaves" lives in one place.

// ───────────────────────────────────────────────────────────────────
// MODEL / LIMITS
// Haiku is plenty for Q&A over a compact snapshot, and it's cheap. The model
// id is env-overridable so we can bump it without a code change.
// ───────────────────────────────────────────────────────────────────
export const ASSISTANT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
export const ASSISTANT_MAX_TOKENS = 700;       // cap on the reply length
export const ASSISTANT_MAX_MESSAGES = 24;      // conversation turns we keep/accept
export const ASSISTANT_MAX_INPUT_CHARS = 4000; // per user message, hard ceiling

// ───────────────────────────────────────────────────────────────────
// SNAPSHOT TYPES — the compact view of the DJ's world we hand the model.
// The route fills these from the bookings + payments tables (same reads the
// Finance page uses) and from lib/finance.ts math.
// ───────────────────────────────────────────────────────────────────

export interface BookingBrief {
  date: string | null;        // YYYY-MM-DD
  eventType: string;          // human label ("Wedding", "Club night", …)
  venue: string | null;
  host: string | null;        // host/booker name if known
  status: string;             // approved / pending / cancelled / manual …
  agreed: number;             // agreed total (with tax) in the booking's currency
  received: number;           // collected so far
  outstanding: number;        // agreed - received (>= 0)
  currency: string;
  contract: string | null;    // contract status label, if any
  depositPaid: boolean;
  balancePaid: boolean;
}

export interface FinanceBrief {
  receivedThisMonth: number;
  receivedThisYear: number;
  outstandingTotal: number;   // across all accepted bookings
  owingCount: number;         // how many bookings still owe a balance
  currency: string;
}

export interface AssistantSnapshot {
  djName: string;
  today: string;              // YYYY-MM-DD in the DJ's timezone
  djType: 'mobile' | 'club' | 'both' | 'unknown';
  upcoming: BookingBrief[];       // CONFIRMED future bookings, soonest first
  pendingRequests: BookingBrief[];// future requests awaiting the DJ's approval (NOT confirmed bookings)
  recentPast: BookingBrief[];     // a few recent completed ones for "last month" asks
  finance: FinanceBrief | null;   // owner-only; null for teammates
}

// ───────────────────────────────────────────────────────────────────
// SITE MAP — where things live, so navigation answers are accurate.
// Keep this in sync with the real routes under app/(main). Pages, not deep
// query params, so a tab rename never makes the assistant lie: it says "open
// Booking Settings and go to the X tab."
// ───────────────────────────────────────────────────────────────────
export const SITE_MAP = `
NAVIGATION MAP (where to do things in Global DJ Connect):
- Booking dashboard (all upcoming bookings, send reminders, request deposits, send contracts): /upcoming-bookings
- Booking requests (pending requests to approve/deny): /booking-requests
- Past bookings (completed events, re-download documents): /past-bookings
- Finance (earnings, payouts, outstanding balances — owner only): /finance
- Booking Settings (/booking-settings) holds:
    • Packages / pricing (mobile DJs) or hourly & flat rate (club/bar DJs)
    • Payments tab — deposit %, accepted payment methods (Venmo, Cash App, etc.), payment reminders
    • Discounts & promo codes
    • Planner & Playlist templates
    • Rider (club/bar DJs)
    • Receipts — logo, auto-send toggles
- Account Settings (/account-settings): name, email, password, timezone, calendar sync, blocked users, notifications
- Edit public profile (bio, photos, mixes, FAQ, banner): /update-dj-profile
- QR code + share link to your profile: /update-dj-profile, in the General tab (just under your name/slug; paid plans)
- Team (invite teammates, set roles): /team-settings
- Subscription / plan / billing: /subscribe
- Notifications settings: /notifications
`.trim();

// ───────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ───────────────────────────────────────────────────────────────────
export function buildSystemPrompt(djName: string): string {
  const name = (djName || '').trim() || 'the DJ';
  return `You are the Global DJ Connect assistant — a helpful, concise in-app helper for ${name}, a DJ using the platform.

YOUR TWO JOBS:
1. Answer questions about their OWN existing bookings and earnings using ONLY the data in the "CURRENT DATA" block provided with each conversation. (e.g. "who owes me money?", "what's on the books in December?", "how much did I collect this month?", "did the host pay the deposit for Saturday?")
2. Help them navigate the app — when they ask "where do I…" or "how do I…", point them to the right page using the NAVIGATION MAP.

HARD RULES:
- You are READ-ONLY. You cannot send emails, request deposits, change settings, approve bookings, or take ANY action. If asked to do something, explain where they can do it themselves (use the navigation map) — never claim you did it.
- Only state facts that appear in the CURRENT DATA block or the navigation map. If the answer isn't in the data, say you don't see it and suggest where they'd find it. Never invent bookings, names, amounts, or dates.
- If the finance section is absent (a teammate, not the account owner), don't discuss money totals — say earnings are owner-only.
- Money amounts are in each booking's own currency; show the currency. Dates are relative to "today" given in the data.
- Be brief and plain-spoken. A sentence or two, or a short list. No preamble like "Based on your data". Don't dump the whole dataset — answer the actual question.
- You only know what's in the snapshot (a window of upcoming + a few recent bookings), not the DJ's entire history. If they ask about something outside it, say so and point them to the right page (e.g. Past bookings, Finance).

MONEY MODEL (use this for any billing / refund / payment question):
- Global DJ Connect NEVER holds or processes the booking money. Hosts pay the DJ directly (card, Venmo, Cash App, PayPal, Zelle, check, cash) and GDC takes 0%. So the DJ only ever RECEIVES money from hosts — the DJ never pays a host through the platform.
- The only thing the DJ pays for is their own Global DJ Connect subscription.
- Therefore, if the DJ asks for "a refund," assume they mean their SUBSCRIPTION/billing unless they clearly say otherwise. You can't process it — tell them to email info@globaldjconnect.com (they can manage their plan at /subscribe). Do NOT frame it as a host owing or paying them.
- For any billing, refund, account, or support issue you can't answer from the data, direct them to email info@globaldjconnect.com.
- If a DJ ever needs to refund a host (e.g. a cancelled event), that's handled by the DJ directly through whatever method the host paid — GDC can't reverse it because it never held the funds. Only bring this up if the DJ explicitly asks about paying a host back.

${SITE_MAP}`;
}

// ───────────────────────────────────────────────────────────────────
// SNAPSHOT RENDERER — compact, model-readable text. Kept terse to hold down
// token cost; one line per booking.
// ───────────────────────────────────────────────────────────────────
function money(n: number, ccy: string): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return `${ccy || 'USD'} ${v.toFixed(2)}`;
}

function bookingLine(b: BookingBrief): string {
  const bits: string[] = [];
  bits.push(b.date || 'no date');
  bits.push(b.eventType || 'event');
  if (b.venue) bits.push(`@ ${b.venue}`);
  if (b.host) bits.push(`host ${b.host}`);
  bits.push(`status ${b.status}`);
  if (b.agreed > 0) {
    bits.push(`agreed ${money(b.agreed, b.currency)}`);
    bits.push(`received ${money(b.received, b.currency)}`);
    if (b.outstanding > 0.01) bits.push(`OWES ${money(b.outstanding, b.currency)}`);
    else bits.push('paid in full');
  }
  if (b.contract) bits.push(`contract ${b.contract}`);
  bits.push(b.depositPaid ? 'deposit paid' : 'deposit unpaid');
  bits.push(b.balancePaid ? 'balance paid' : 'balance unpaid');
  return '- ' + bits.join(' · ');
}

export function formatSnapshot(s: AssistantSnapshot): string {
  const lines: string[] = [];
  lines.push('CURRENT DATA (the only facts you may use about this DJ):');
  lines.push(`Today: ${s.today} (DJ's local date). DJ: ${s.djName}. Type: ${s.djType}.`);

  if (s.finance) {
    const f = s.finance;
    lines.push(
      `Finance — collected this month: ${money(f.receivedThisMonth, f.currency)}; ` +
      `this year: ${money(f.receivedThisYear, f.currency)}; ` +
      `total outstanding: ${money(f.outstandingTotal, f.currency)} across ${f.owingCount} booking(s) still owing.`
    );
  } else {
    lines.push('Finance: not available (viewer is a teammate, not the account owner). Do not discuss money totals.');
  }

  lines.push('');
  lines.push(`CONFIRMED upcoming bookings (${s.upcoming.length}, soonest first) — these are the DJ's actual bookings:`);
  lines.push(s.upcoming.length ? s.upcoming.map(bookingLine).join('\n') : '(none)');

  lines.push('');
  lines.push(`PENDING booking requests awaiting approval (${s.pendingRequests.length}) — NOT confirmed bookings; they live on /booking-requests. Only mention these as a side note, never as "your next booking":`);
  lines.push(s.pendingRequests.length ? s.pendingRequests.map(bookingLine).join('\n') : '(none)');

  if (s.recentPast.length) {
    lines.push('');
    lines.push(`Recent past bookings (${s.recentPast.length}, newest first):`);
    lines.push(s.recentPast.map(bookingLine).join('\n'));
  }

  return lines.join('\n');
}
