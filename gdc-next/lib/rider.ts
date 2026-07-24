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
  { id: 'hosp_comps', section: 'hospitality', text: 'Estimated comps / guest-list spots needed: 2' },
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

// The equipment choice on a booking (mapped from bookings.equipment).
export type EquipChoice = 'full' | 'decks' | 'none' | null;

export interface EquipmentContext {
  choice: EquipChoice;
  systemDetail?: string | null; // equip_full_detail — the system the DJ provides
  decksDetail?: string | null;  // equip_decks_detail — the decks the DJ provides
}

/** bookings.equipment ('sound_system' | 'decks_only' | 'venue_provides') → choice. */
export function equipChoiceFromBooking(equipment: string | null | undefined): EquipChoice {
  if (equipment === 'sound_system') return 'full';
  if (equipment === 'decks_only') return 'decks';
  if (equipment === 'venue_provides') return 'none';
  return null;
}

/**
 * The rider's TECHNICAL section is driven by the equipment choice:
 *  - full  : the DJ's own system (from "list your system") shows as what THEY
 *            bring. No detail listed → a blank slot the DJ fills in.
 *  - decks : the DJ's decks show as what they bring; the venue provides sound.
 *            No detail → a blank slot.
 *  - none  : the venue provides everything, so the DJ CHOOSES the required gear
 *            (the full standard technical list, editable/trimmable).
 */
export function technicalFromEquipment(eq: EquipmentContext): RiderItem[] {
  const mk = (text: string): RiderItem => ({ id: newRiderId(), section: 'technical', text });
  const standard = () => STARTER_RIDER.filter((i) => i.section === 'technical').map((i) => mk(i.text));

  if (eq.choice === 'none') return standard();
  if (eq.choice === 'full') {
    const d = (eq.systemDetail || '').trim();
    return [
      mk(d ? `DJ provides: ${d}` : ''),
      mk('Venue provides two grounded power outlets at the booth'),
      mk('Venue provides a sturdy DJ table or booth, minimum 6 ft wide'),
    ];
  }
  if (eq.choice === 'decks') {
    const d = (eq.decksDetail || '').trim();
    return [
      mk(d ? `DJ provides: ${d}` : ''),
      mk('Venue provides house sound system + booth monitor'),
      mk('Venue provides two grounded power outlets at the booth'),
    ];
  }
  return standard();
}

/**
 * Seed a booking's rider: an equipment-driven technical section + the DJ's
 * saved hospitality default (or the starter hospitality if none). The default
 * only ever carries hospitality/custom lines — technical is per-booking, from
 * that booking's equipment choice. Every line stays editable on the card.
 */
export function seedRider(
  defaultItems: RiderItem[] | null | undefined,
  equip?: EquipmentContext | null,
): RiderItem[] {
  const tech = equip
    ? technicalFromEquipment(equip)
    : STARTER_RIDER.filter((i) => i.section === 'technical').map((i) => ({ ...i, id: newRiderId() }));
  const savedHosp = (defaultItems || []).filter((i) => i.section === 'hospitality');
  const hosp = savedHosp.length
    ? savedHosp.map((i) => ({ ...i }))
    : STARTER_RIDER.filter((i) => i.section === 'hospitality').map((i) => ({ ...i, id: newRiderId() }));
  return [...tech, ...hosp];
}

export function groupRider(items: RiderItem[]): Record<RiderSection, RiderItem[]> {
  return {
    technical: items.filter((i) => i.section === 'technical'),
    hospitality: items.filter((i) => i.section === 'hospitality'),
  };
}
