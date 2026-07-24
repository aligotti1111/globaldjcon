// lib/rider.ts — DJ Rider (club/bar only).
//
// The opposite of the planner: the planner is a form the HOST fills; the rider
// is the DJ stating THEIR requirements to the host. Two sections — technical
// (gear/booth/power) and hospitality (water/food/parking/guest list). Fully
// customizable: the DJ edits, adds, removes, reorders lines.
//
// A default rider lives on booking_settings.rider_default (built once in
// Booking Settings). Each booking gets its own copy in booking_riders, seeded
// from that default (or the starter template) and editable per booking on the
// card before the DJ deploys it to the host.

export type RiderSection = 'technical' | 'hospitality';

export interface RiderItem {
  id: string;
  section: RiderSection;
  text: string;
}

export const RIDER_SECTIONS: { key: RiderSection; label: string }[] = [
  { key: 'technical', label: 'Technical' },
  { key: 'hospitality', label: 'Hospitality' },
];

// Seeded from common club/bar DJ-rider items. Every line is editable.
export const STARTER_RIDER: RiderItem[] = [
  { id: 'tech_players', section: 'technical', text: '2× Pioneer CDJ-3000 (or CDJ-2000NXS2) media players' },
  { id: 'tech_mixer', section: 'technical', text: '1× Pioneer DJM-900NXS2 (or DJM-A9) mixer' },
  { id: 'tech_monitor', section: 'technical', text: '1× powered booth monitor (minimum 100W)' },
  { id: 'tech_table', section: 'technical', text: 'Sturdy DJ table or booth, minimum 6 ft wide, at standing height' },
  { id: 'tech_power', section: 'technical', text: 'Two grounded power outlets at the booth' },
  { id: 'tech_sound', section: 'technical', text: 'House sound system suitable for the room, tested before doors' },
  { id: 'hosp_water', section: 'hospitality', text: '4× bottled water at the booth' },
  { id: 'hosp_drinks', section: 'hospitality', text: 'Drink tickets or beverages for the DJ' },
  { id: 'hosp_meal', section: 'hospitality', text: 'A meal if the set runs longer than 4 hours' },
  { id: 'hosp_parking', section: 'hospitality', text: 'Parking or loading access near the entrance' },
  { id: 'hosp_guest', section: 'hospitality', text: '2 guest-list spots' },
];

export function newRiderId(): string {
  return `r${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
}

/** Coerce whatever's in jsonb into clean RiderItem[] — drops blank lines. */
export function normalizeRiderItems(raw: unknown): RiderItem[] {
  if (!Array.isArray(raw)) return [];
  const out: RiderItem[] = [];
  for (const r of raw) {
    const o = (r || {}) as Partial<RiderItem>;
    const section: RiderSection = o.section === 'hospitality' ? 'hospitality' : 'technical';
    const text = typeof o.text === 'string' ? o.text : '';
    if (!text.trim()) continue;
    out.push({ id: (typeof o.id === 'string' && o.id) ? o.id : newRiderId(), section, text: text });
  }
  return out;
}

/**
 * Seed a booking's rider. Prefers the DJ's saved default; falls back to the
 * starter template. An equipment note (from the booking's equipment choice) is
 * folded in as the first technical line so the rider starts from what this DJ
 * actually needs the venue to provide.
 */
export function seedRider(
  defaultItems: RiderItem[] | null | undefined,
  equipmentNote?: string | null,
): RiderItem[] {
  const src = (defaultItems && defaultItems.length) ? defaultItems : STARTER_RIDER;
  const base = src.map((i) => ({ ...i }));
  const note = (equipmentNote || '').trim();
  if (note && !base.some((i) => i.text.trim() === note)) {
    base.unshift({ id: newRiderId(), section: 'technical', text: note });
  }
  return base;
}

export function groupRider(items: RiderItem[]): Record<RiderSection, RiderItem[]> {
  return {
    technical: items.filter((i) => i.section === 'technical'),
    hospitality: items.filter((i) => i.section === 'hospitality'),
  };
}
