// lib/guestlist.ts — Guest List add-on (club/bar only).
//
// The DJ sends the venue/host a list of names to add to the door. Entered as
// free text (one per line, "Name +2" for plus-ones), parsed into structured
// entries so it can be counted, alphabetized, and shown to the host cleanly.

export interface GuestEntry { id: string; name: string; plus: number; }

export function newGuestId(): string {
  return `g${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
}

/** "John Smith +2" per line → entries. Blank lines dropped. */
export function parseGuests(text: string): GuestEntry[] {
  const out: GuestEntry[] = [];
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let name = line, plus = 0;
    const m = line.match(/\+\s*(\d+)\s*$/);
    if (m && m.index != null) { plus = parseInt(m[1], 10) || 0; name = line.slice(0, m.index).trim(); }
    if (!name) continue;
    out.push({ id: newGuestId(), name, plus });
  }
  return out;
}

export function guestsToText(g: GuestEntry[]): string {
  return g.map((e) => (e.plus > 0 ? `${e.name} +${e.plus}` : e.name)).join('\n');
}

export function normalizeGuests(raw: unknown): GuestEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: GuestEntry[] = [];
  for (const r of raw) {
    const o = (r || {}) as Partial<GuestEntry>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (!name) continue;
    const plus = Number.isFinite(Number(o.plus)) ? Math.max(0, Math.floor(Number(o.plus))) : 0;
    out.push({ id: (typeof o.id === 'string' && o.id) ? o.id : newGuestId(), name, plus });
  }
  return out;
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] || '').toLowerCase();
}

/** Alphabetical by last name, then full name. */
export function sortGuests(g: GuestEntry[]): GuestEntry[] {
  return [...g].sort((a, b) => lastName(a.name).localeCompare(lastName(b.name)) || a.name.localeCompare(b.name));
}

/** Total heads = each entry + its plus-ones. */
export function headCount(g: GuestEntry[]): number {
  return g.reduce((n, e) => n + 1 + (e.plus || 0), 0);
}
