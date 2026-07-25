// lib/rider.ts — DJ Rider (club/bar only). REBUILT as a planner-style,
// labeled-field rider with two entry modes.
//
// The opposite of the planner: the planner is a form the HOST fills; the rider
// is the DJ stating THEIR requirements to the host. The DJ picks ONE of two
// modes up front:
//   · 'upload' — the DJ hands over a pre-made rider as a PDF (rider_pdf_url).
//   · 'custom' — the DJ builds the rider from labeled FIELDS (label + value),
//                grouped into sections: Technical, Hospitality, and any custom
//                fields the DJ adds. Mirrors the planner's labeled-field feel.
//
// Each custom field is a { label, value } pair — a prompt/question plus the
// answer — instead of a single free-text line. A backward-compatible
// normalizer upgrades the old { text } shape to { label:'', value:text } so
// existing riders keep working.
//
// A default rider lives on booking_settings (rider_default + rider_mode +
// rider_pdf_url), built once in Booking Settings. Each booking gets its own
// copy in booking_riders, seeded from that default (or the starter template),
// editable per booking before the DJ deploys it to the host.

export type RiderSection = 'technical' | 'hospitality' | 'custom';

export type RiderMode = 'upload' | 'custom';

export interface RiderItem {
  id: string;
  section: RiderSection;
  /** The prompt/question — e.g. "Media players", "Water", "Green room". */
  label: string;
  /** The answer/spec — e.g. "2× Pioneer CDJ-3000". */
  value: string;
}

export const RIDER_SECTIONS: { key: RiderSection; label: string }[] = [
  { key: 'technical', label: 'Technical' },
  { key: 'hospitality', label: 'Hospitality' },
  { key: 'custom', label: 'Additional' },
];

const VALID_SECTIONS: RiderSection[] = ['technical', 'hospitality', 'custom'];

// Seeded from common club/bar DJ-rider items, now as labeled fields. Every
// field is editable.
export const STARTER_RIDER: RiderItem[] = [
  { id: 'tech_players', section: 'technical', label: 'Media players', value: '2× Pioneer CDJ-3000 (or CDJ-2000NXS2)' },
  { id: 'tech_mixer', section: 'technical', label: 'Mixer', value: '1× Pioneer DJM-900NXS2 (or DJM-A9)' },
  { id: 'tech_monitor', section: 'technical', label: 'Booth monitor', value: '1× powered booth monitor (minimum 100W)' },
  { id: 'tech_table', section: 'technical', label: 'DJ table / booth', value: 'Sturdy, minimum 6 ft wide, at standing height' },
  { id: 'tech_power', section: 'technical', label: 'Power', value: 'Two grounded power outlets at the booth' },
  { id: 'tech_sound', section: 'technical', label: 'Sound system', value: 'House PA suitable for the room, tested before doors' },
  { id: 'hosp_water', section: 'hospitality', label: 'Water', value: '4× bottled water at the booth' },
  { id: 'hosp_drinks', section: 'hospitality', label: 'Drinks', value: 'Drink tickets or beverages for the DJ' },
  { id: 'hosp_meal', section: 'hospitality', label: 'Meal', value: 'A meal if the set runs longer than 4 hours' },
  { id: 'hosp_parking', section: 'hospitality', label: 'Parking', value: 'Parking or loading access near the entrance' },
  { id: 'hosp_comps', section: 'hospitality', label: 'Guest list', value: 'Estimated comps / guest-list spots needed: 2' },
];

export function newRiderId(): string {
  return `r${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Coerce whatever's in jsonb into clean RiderItem[].
 *
 * BACKWARD COMPATIBLE: old riders stored a single `text` per item. Those are
 * upgraded to { label:'', value:text } so nothing breaks. New items carry
 * `label` + `value` directly. A field survives if EITHER its label or value
 * has content — a bare label ("Green room") with a blank value is a legit,
 * still-being-filled prompt; only fully-empty rows are dropped.
 */
export function normalizeRiderItems(raw: unknown): RiderItem[] {
  if (!Array.isArray(raw)) return [];
  const out: RiderItem[] = [];
  for (const r of raw) {
    const o = (r || {}) as Partial<RiderItem> & { text?: unknown };
    const section: RiderSection = VALID_SECTIONS.includes(o.section as RiderSection)
      ? (o.section as RiderSection)
      : 'technical';
    const label = typeof o.label === 'string' ? o.label : '';
    let value = typeof o.value === 'string' ? o.value : '';
    // Upgrade the legacy { text } shape.
    if (!label && !value && typeof o.text === 'string') value = o.text;
    if (!label.trim() && !value.trim()) continue;
    out.push({
      id: (typeof o.id === 'string' && o.id) ? o.id : newRiderId(),
      section,
      label,
      value,
    });
  }
  return out;
}

/** Normalize a rider mode value from jsonb; defaults to 'custom'. */
export function normalizeRiderMode(raw: unknown): RiderMode {
  return raw === 'upload' ? 'upload' : 'custom';
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
 * The rider's TECHNICAL section is DRIVEN BY the equipment settings — whatever
 * the DJ entered in their Equipment section appears here as editable labeled
 * fields:
 *  - full  : the DJ's own system (from "list your system") shows as what THEY
 *            bring; the venue supplies power + table. No detail → a blank slot.
 *  - decks : the DJ's decks show as what they bring; the venue provides sound.
 *  - none  : the venue provides everything, so the DJ CHOOSES the required gear
 *            (the full standard technical list, editable/trimmable).
 */
export function technicalFromEquipment(eq: EquipmentContext): RiderItem[] {
  const mk = (label: string, value: string): RiderItem => ({ id: newRiderId(), section: 'technical', label, value });
  const standard = () => STARTER_RIDER.filter((i) => i.section === 'technical').map((i) => mk(i.label, i.value));

  if (eq.choice === 'none') return standard();
  if (eq.choice === 'full') {
    const d = (eq.systemDetail || '').trim();
    return [
      mk('DJ provides (sound system + decks)', d),
      mk('Power', 'Two grounded power outlets at the booth'),
      mk('DJ table / booth', 'Sturdy, minimum 6 ft wide, at standing height'),
    ];
  }
  if (eq.choice === 'decks') {
    const d = (eq.decksDetail || '').trim();
    return [
      mk('DJ provides (decks / controller)', d),
      mk('Sound system', 'Venue provides house sound system + booth monitor'),
      mk('Power', 'Two grounded power outlets at the booth'),
    ];
  }
  return standard();
}

/**
 * Seed a booking's rider: an equipment-driven technical section + the DJ's
 * saved hospitality/custom default (or the starter hospitality if none). The
 * default only ever carries hospitality/custom fields — technical is
 * per-booking, from that booking's equipment choice. Every field stays editable.
 */
export function seedRider(
  defaultItems: RiderItem[] | null | undefined,
  equip?: EquipmentContext | null,
): RiderItem[] {
  const tech = equip
    ? technicalFromEquipment(equip)
    : STARTER_RIDER.filter((i) => i.section === 'technical').map((i) => ({ ...i, id: newRiderId() }));
  const savedRest = (defaultItems || []).filter((i) => i.section === 'hospitality' || i.section === 'custom');
  const rest = savedRest.length
    ? savedRest.map((i) => ({ ...i, id: newRiderId() }))
    : STARTER_RIDER.filter((i) => i.section === 'hospitality').map((i) => ({ ...i, id: newRiderId() }));
  return [...tech, ...rest];
}

export function groupRider(items: RiderItem[]): Record<RiderSection, RiderItem[]> {
  return {
    technical: items.filter((i) => i.section === 'technical'),
    hospitality: items.filter((i) => i.section === 'hospitality'),
    custom: items.filter((i) => i.section === 'custom'),
  };
}

/** A one-line display string for a field: "Label: value" (or whichever it has). */
export function riderLine(it: RiderItem): string {
  const l = (it.label || '').trim();
  const v = (it.value || '').trim();
  if (l && v) return `${l}: ${v}`;
  return l || v;
}
