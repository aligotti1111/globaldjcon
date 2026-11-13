// lib/addons.ts
//
// Mobile booking ADD-ONS snapshot helpers.
//
// When a host picks optional add-ons on a mobile booking, each add-on's price
// is folded into the booking's single quoted_rate server-side — there is NO
// separate add-ons money column. The chosen items (title + price, frozen at
// booking time) are stored in bookings.addons (jsonb array of
// { title, price }) purely so the DJ card, emails, contract and receipt can
// itemize them. This module is the one place that parses that jsonb safely and
// formats the itemized lines, so every surface renders them identically.

export interface BookingAddon {
  title: string;
  price: number;
}

// Parse the bookings.addons jsonb (unknown shape from the DB) into clean,
// display-ready items. Tolerates null / string-encoded json / malformed rows;
// returns [] on anything it can't make sense of.
export function parseBookingAddons(raw: unknown): BookingAddon[] {
  let val = raw;
  if (typeof val === 'string') {
    try { val = JSON.parse(val); } catch { return []; }
  }
  if (!Array.isArray(val)) return [];
  const out: BookingAddon[] = [];
  for (const item of val) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const title = typeof rec.title === 'string' ? rec.title.trim() : '';
    const price = Number(rec.price);
    if (!title) continue;
    out.push({ title, price: Number.isFinite(price) ? price : 0 });
  }
  return out;
}

// Sum of the chosen add-on prices (what got folded into quoted_rate).
export function addonsTotal(addons: BookingAddon[]): number {
  return addons.reduce((s, a) => s + (Number.isFinite(a.price) ? a.price : 0), 0);
}
