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

// A rider is a set of BOXES. The four default boxes are Technical, Visuals,
// Beverages and "Who's allowed in the booth" (booth); the DJ can add more
// (custom-named) boxes. 'hospitality' and 'custom' are kept ONLY for backward
// compatibility with riders saved before this rework — the normalizer never
// crashes on them and they still render.
export type RiderSection = 'technical' | 'visuals' | 'beverages' | 'booth' | 'hospitality' | 'custom';

export type RiderMode = 'upload' | 'custom';

export interface RiderItem {
  id: string;
  section: RiderSection;
  /** The prompt/question — e.g. "Media players", "Water", "Green room". */
  label: string;
  /** The answer/spec — e.g. "2× Pioneer CDJ-3000". */
  value: string;
  /**
   * A rider is persisted as a FLAT array so it keeps flowing through the single
   * `items` jsonb column everywhere. Box order + disabled state ride along as
   * lightweight MARKER rows interleaved in that array: a row with
   * `type:'box'` opens a box (carrying its `section`, custom `title` and
   * `disabled` flag); every following field row of the same section belongs to
   * it, until the next marker. The order of the markers IS the box order. Field
   * rows leave `type` undefined, so old data (which has no markers) is upgraded
   * transparently — a rider with no markers is grouped by section on the fly.
   */
  type?: 'box' | 'field';
  /** Box markers only: the box's display name (blank ⇒ the section default). */
  title?: string;
  /** Box markers only: when true the whole box is excluded from the sent rider
   *  / PDF, but its content is preserved so re-enabling restores it. */
  disabled?: boolean;
  /**
   * Box markers only, and ONLY on the Technical + Visuals boxes: a single
   * uploaded file (image or PDF, ≤5MB) that travels with the rider. Stored as
   * the public storage URL + the original filename. Both optional and normalized
   * defensively, so older data (no attachment) round-trips untouched.
   */
  attachmentUrl?: string;
  attachmentName?: string;
}

/** Sections whose boxes may carry a single file attachment (image or PDF). */
export const ATTACHMENT_SECTIONS: RiderSection[] = ['technical', 'visuals'];

/** Max attachment size — enforced client-side and defensively on send. */
export const RIDER_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

/** True when a box's section is allowed to hold an attachment. */
export function sectionAllowsAttachment(section: RiderSection): boolean {
  return ATTACHMENT_SECTIONS.includes(section);
}

export const RIDER_SECTIONS: { key: RiderSection; label: string }[] = [
  { key: 'technical', label: 'Technical' },
  { key: 'visuals', label: 'Visuals' },
  { key: 'beverages', label: 'Beverages' },
  { key: 'booth', label: "Who's allowed in the booth" },
  { key: 'hospitality', label: 'Hospitality' },
  { key: 'custom', label: 'Additional' },
];

const VALID_SECTIONS: RiderSection[] = ['technical', 'visuals', 'beverages', 'booth', 'hospitality', 'custom'];

/** Canonical section order used when grouping marker-less (legacy/seeded) data. */
const SECTION_ORDER: RiderSection[] = ['technical', 'visuals', 'beverages', 'booth', 'hospitality', 'custom'];

/** The default display title for each section's box. */
export const DEFAULT_BOX_TITLES: Record<RiderSection, string> = {
  technical: 'Technical',
  visuals: 'Visuals',
  beverages: 'Beverages',
  booth: "Who's allowed in the booth",
  hospitality: 'Hospitality',
  custom: 'Additional',
};

/** The four default boxes every custom rider starts with, in order. */
export const DEFAULT_BOX_SECTIONS: RiderSection[] = ['technical', 'visuals', 'beverages', 'booth'];

/** Stable ids for the default boxes so re-renders don't churn React keys. */
export const DEFAULT_BOX_IDS: Record<'technical' | 'visuals' | 'beverages' | 'booth', string> = {
  technical: 'box_technical',
  visuals: 'box_visuals',
  beverages: 'box_beverages',
  booth: 'box_booth',
};

// Seeded from common club/bar DJ-rider items, now as labeled fields. Every
// field is editable.
// Starter fields are LABELS ONLY — empty values. The DJ fills in their own
// requirements; we never fabricate specific gear, brands, or quantities. The
// only pre-filled technical value comes from the DJ's own equipment settings
// (see technicalFromEquipment / seedRider).
export const STARTER_RIDER: RiderItem[] = [
  { id: 'tech_players', section: 'technical', label: 'DJ Decks/Turntables/Controller', value: '' },
  { id: 'tech_mixer', section: 'technical', label: 'Mixer', value: '' },
  { id: 'tech_monitor', section: 'technical', label: 'Booth monitor', value: '' },
  { id: 'tech_table', section: 'technical', label: 'DJ table / booth', value: '' },
  { id: 'tech_power', section: 'technical', label: 'Power', value: '' },
  { id: 'tech_sound', section: 'technical', label: 'Sound system', value: '' },
  { id: 'hosp_water', section: 'hospitality', label: 'Water', value: '' },
  { id: 'hosp_drinks', section: 'hospitality', label: 'Drinks', value: '' },
  { id: 'hosp_meal', section: 'hospitality', label: 'Meal', value: '' },
  { id: 'hosp_parking', section: 'hospitality', label: 'Parking', value: '' },
  { id: 'hosp_comps', section: 'hospitality', label: 'Guest list', value: '' },
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
    const id = (typeof o.id === 'string' && o.id) ? o.id : newRiderId();

    // Box MARKER rows carry the box's identity, order (position), title and
    // disabled state. They are preserved even with no label/value — an empty
    // (or disabled) box still has to survive a round-trip.
    if (o.type === 'box') {
      // Attachments only live on the attachment-eligible sections; a URL on any
      // other section is dropped so bad/old data never leaks a link.
      const attUrl = typeof o.attachmentUrl === 'string' && o.attachmentUrl ? o.attachmentUrl : '';
      const attName = typeof o.attachmentName === 'string' && o.attachmentName ? o.attachmentName : '';
      const box: RiderItem = {
        id,
        type: 'box',
        section,
        label: '',
        value: '',
        title: typeof o.title === 'string' ? o.title : '',
        disabled: o.disabled === true,
      };
      if (attUrl && sectionAllowsAttachment(section)) {
        box.attachmentUrl = attUrl;
        box.attachmentName = attName || 'attachment';
      }
      out.push(box);
      continue;
    }

    const label = typeof o.label === 'string' ? o.label : '';
    let value = typeof o.value === 'string' ? o.value : '';
    // Upgrade the legacy { text } shape.
    if (!label && !value && typeof o.text === 'string') value = o.text;
    if (!label.trim() && !value.trim()) continue;
    out.push({ id, section, label, value });
  }
  return out;
}

/** Normalize a rider mode value from jsonb; defaults to 'custom'. */
export function normalizeRiderMode(raw: unknown): RiderMode {
  // Default is Upload — an unset rider starts on the Upload Rider option.
  return raw === 'custom' ? 'custom' : 'upload';
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
      mk('Power', ''),
      mk('DJ table / booth', ''),
    ];
  }
  if (eq.choice === 'decks') {
    const d = (eq.decksDetail || '').trim();
    return [
      mk('DJ provides (decks / controller)', d),
      mk('Sound system', ''),
      mk('Power', ''),
    ];
  }
  return standard();
}

/**
 * Seed a booking's rider from the DJ's default. Technical is ALWAYS driven by
 * this booking's equipment choice (never the default's technical box); every
 * OTHER box the DJ set as a default — Visuals, Beverages, any custom boxes, and
 * legacy hospitality — is carried over with its order + disabled state intact.
 * Visuals + Beverages are always present (empty if the DJ never filled them).
 * The result is a fully box-markered flat array. Every field stays editable.
 */
export function seedRider(
  defaultItems: RiderItem[] | null | undefined,
  equip?: EquipmentContext | null,
): RiderItem[] {
  const techItems = technicalFromEquipment(equip || { choice: null }).map((i) => ({
    ...i, id: newRiderId(), section: 'technical' as RiderSection,
  }));
  const techBox: RiderBox = {
    id: DEFAULT_BOX_IDS.technical, section: 'technical',
    title: DEFAULT_BOX_TITLES.technical, disabled: false, items: techItems,
  };

  const defBoxes = groupRiderBoxes(normalizeRiderItems(defaultItems || []));
  const restBoxes: RiderBox[] = defBoxes
    .filter((b) => b.section !== 'technical')
    .map((b) => ({
      id: b.section === 'visuals' ? DEFAULT_BOX_IDS.visuals
        : b.section === 'beverages' ? DEFAULT_BOX_IDS.beverages
        : b.section === 'booth' ? DEFAULT_BOX_IDS.booth
        : newRiderId(),
      section: b.section,
      title: b.title,
      disabled: b.disabled,
      // Carry a Visuals-box attachment through the per-booking seed so the
      // DJ's default file is there every time (Technical is rebuilt from
      // equipment, so its default attachment intentionally does not carry).
      attachmentUrl: b.attachmentUrl,
      attachmentName: b.attachmentName,
      items: b.items.map((i) => ({ ...i, id: newRiderId() })),
    }));

  return flattenBoxes(ensureDefaultBoxes([techBox, ...restBoxes]));
}

/**
 * Group items by section into a fixed record, EXCLUDING box markers. Kept for
 * backward compatibility / simple by-section reads. For order-and-disabled
 * aware rendering use groupRiderBoxes instead.
 */
export function groupRider(items: RiderItem[]): Record<RiderSection, RiderItem[]> {
  const base: Record<RiderSection, RiderItem[]> = {
    technical: [], visuals: [], beverages: [], booth: [], hospitality: [], custom: [],
  };
  for (const it of (Array.isArray(items) ? items : [])) {
    if (it.type === 'box') continue;
    base[it.section].push(it);
  }
  return base;
}

// ── Box model (order + disabled aware) ─────────────────────────────────────

/** A rider box: a titled group of fields the DJ can reorder + disable. */
export interface RiderBox {
  id: string;
  section: RiderSection;
  /** Resolved display title (never blank). */
  title: string;
  disabled: boolean;
  /** Field rows only (no markers). */
  items: RiderItem[];
  /** Technical/Visuals only: a single attached file that travels with the rider. */
  attachmentUrl?: string;
  attachmentName?: string;
}

/** Resolve a box's display title, falling back to the section default. */
export function resolveBoxTitle(section: RiderSection, title?: string | null): string {
  const t = (title || '').trim();
  return t || DEFAULT_BOX_TITLES[section];
}

/**
 * Walk the flat items array into ordered boxes. When box markers are present
 * their order + disabled state win. Marker-less data (legacy riders, or a
 * freshly equipment-seeded technical list) is grouped by section in canonical
 * order so nothing is lost. Never throws on unexpected shapes.
 */
export function groupRiderBoxes(items: RiderItem[]): RiderBox[] {
  const list = Array.isArray(items) ? items : [];
  const hasMarkers = list.some((i) => i.type === 'box');

  if (hasMarkers) {
    const boxes: RiderBox[] = [];
    let current: RiderBox | null = null;
    const synth: Partial<Record<RiderSection, RiderBox>> = {};
    for (const it of list) {
      if (it.type === 'box') {
        current = {
          id: it.id, section: it.section,
          title: resolveBoxTitle(it.section, it.title),
          disabled: it.disabled === true, items: [],
          attachmentUrl: it.attachmentUrl,
          attachmentName: it.attachmentName,
        };
        boxes.push(current);
      } else if (current && current.section === it.section) {
        current.items.push(it);
      } else {
        // A field with no matching preceding marker — keep it in a synthesized
        // box for its section rather than dropping it.
        let bx = synth[it.section];
        if (!bx) {
          bx = { id: `synth_${it.section}`, section: it.section, title: DEFAULT_BOX_TITLES[it.section], disabled: false, items: [] };
          synth[it.section] = bx;
          boxes.push(bx);
        }
        bx.items.push(it);
      }
    }
    return boxes;
  }

  // No markers: one box per non-empty section, canonical order, all enabled.
  const boxes: RiderBox[] = [];
  for (const section of SECTION_ORDER) {
    const rows = list.filter((i) => i.section === section && i.type !== 'box');
    if (rows.length) {
      boxes.push({ id: `synth_${section}`, section, title: DEFAULT_BOX_TITLES[section], disabled: false, items: rows });
    }
  }
  return boxes;
}

/** Flatten boxes back into the persisted flat array (marker row + its fields). */
export function flattenBoxes(boxes: RiderBox[]): RiderItem[] {
  const out: RiderItem[] = [];
  for (const b of boxes) {
    const marker: RiderItem = {
      id: b.id, type: 'box', section: b.section, label: '', value: '',
      // Store a blank title for default-named boxes so the section default keeps
      // applying; only genuinely custom names are persisted.
      title: b.title === DEFAULT_BOX_TITLES[b.section] ? '' : b.title,
      disabled: b.disabled,
    };
    // Persist an attachment only on the sections allowed to carry one.
    if (b.attachmentUrl && sectionAllowsAttachment(b.section)) {
      marker.attachmentUrl = b.attachmentUrl;
      marker.attachmentName = b.attachmentName || 'attachment';
    }
    out.push(marker);
    for (const it of b.items) {
      out.push({ id: it.id, section: it.section, label: it.label, value: it.value });
    }
  }
  return out;
}

/** Ensure the three default boxes (Technical, Visuals, Beverages) exist,
 *  WITHOUT disturbing the order or content of boxes already present. A missing
 *  default is inserted just after the previous default so the defaults keep
 *  their canonical Technical → Visuals → Beverages order (and land ahead of any
 *  legacy/custom boxes), while boxes the DJ has explicitly reordered — which
 *  always carry markers and thus already include all three — are left as-is. */
export function ensureDefaultBoxes(boxes: RiderBox[]): RiderBox[] {
  const result = boxes.slice();
  let anchor = -1; // index of the last default box seen or inserted
  for (const section of DEFAULT_BOX_SECTIONS) {
    const existingIdx = result.findIndex((b) => b.section === section);
    if (existingIdx >= 0) {
      anchor = existingIdx;
    } else {
      const insertAt = anchor + 1;
      const id = section === 'technical' ? DEFAULT_BOX_IDS.technical
        : section === 'visuals' ? DEFAULT_BOX_IDS.visuals
        : section === 'beverages' ? DEFAULT_BOX_IDS.beverages
        : DEFAULT_BOX_IDS.booth;
      result.splice(insertAt, 0, { id, section, title: DEFAULT_BOX_TITLES[section], disabled: false, items: [] });
      anchor = insertAt;
    }
  }
  return result;
}

/** True when the rider has at least one real field (ignores box markers). */
export function riderHasFields(items: RiderItem[]): boolean {
  return (Array.isArray(items) ? items : []).some(
    (i) => i.type !== 'box' && (!!(i.label || '').trim() || !!(i.value || '').trim()),
  );
}

/** Populate the Technical box with the starter technical checklist, preserving
 *  every other box + the default-box scaffold. Used by the "Load starter
 *  technical" convenience button in the settings builders. */
export function withStarterTechnical(items: RiderItem[]): RiderItem[] {
  const boxes = ensureDefaultBoxes(groupRiderBoxes(items));
  const tech: RiderItem[] = STARTER_RIDER
    .filter((i) => i.section === 'technical')
    .map((i) => ({ id: newRiderId(), section: 'technical' as RiderSection, label: i.label, value: i.value }));
  const next = boxes.map((b) => (b.section === 'technical' ? { ...b, items: tech } : b));
  return flattenBoxes(next);
}

/** A one-line display string for a field: "Label: value" (or whichever it has). */
export function riderLine(it: RiderItem): string {
  const l = (it.label || '').trim();
  const v = (it.value || '').trim();
  if (l && v) return `${l}: ${v}`;
  return l || v;
}

// ── Named, reusable riders (the DJ's library) ──────────────────────────────
// The DJ's saved riders live on users.booking_settings JSON under `riders`: an
// array the DJ can quick-send to any booking. Each entry is a FULL snapshot —
// mode + items + pdf — so sending one never depends on other settings. No new
// table; scoped to the acting djId by whoever reads/writes booking_settings.

export interface NamedRider {
  id: string;
  name: string;
  mode: RiderMode;
  items: RiderItem[];
  pdfUrl: string | null;
  updatedAt: string;
}

/** Coerce one jsonb entry into a clean NamedRider, or null if it has no name. */
export function normalizeNamedRider(raw: unknown): NamedRider | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (!name) return null;
  const id = typeof o.id === 'string' && o.id ? o.id : newRiderId();
  const mode = normalizeRiderMode(o.mode);
  const items = normalizeRiderItems(o.items);
  const pdfUrl = typeof o.pdfUrl === 'string' && o.pdfUrl ? o.pdfUrl : null;
  const updatedAt = typeof o.updatedAt === 'string' && o.updatedAt ? o.updatedAt : new Date().toISOString();
  return { id, name, mode, items, pdfUrl, updatedAt };
}

/** Coerce the whole `riders` array from booking_settings into NamedRider[]. */
export function normalizeNamedRiders(raw: unknown): NamedRider[] {
  if (!Array.isArray(raw)) return [];
  const out: NamedRider[] = [];
  for (const r of raw) {
    const n = normalizeNamedRider(r);
    if (n) out.push(n);
  }
  return out;
}

/**
 * Upsert a named rider into a library array. Matches by id when given, else by
 * case-insensitive name (so re-sending "House rider" updates the same entry).
 * Returns a NEW array; never mutates the input.
 */
export function upsertNamedRider(riders: NamedRider[], rider: NamedRider): NamedRider[] {
  const next = riders.slice();
  let idx = rider.id ? next.findIndex((r) => r.id === rider.id) : -1;
  if (idx < 0) idx = next.findIndex((r) => r.name.trim().toLowerCase() === rider.name.trim().toLowerCase());
  if (idx >= 0) next[idx] = { ...rider, id: next[idx].id };
  else next.push(rider);
  return next;
}
