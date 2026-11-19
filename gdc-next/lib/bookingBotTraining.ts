// lib/bookingBotTraining.ts — the "train your assistant" model for the profile
// Booking Assistant. PURE + client-safe (no Node builtins, no DB) so the Account
// Settings UI and the server-side prompt builder can share one source of truth.
//
// The idea: don't hand the DJ a blank box and ask them to write about their
// business — they don't know what to put. Instead we give them the exact
// questions their clients actually ask, and they just fill in a short answer
// (or skip it). Each answer becomes an FAQ the assistant can use verbatim.

export interface BotTrainingQuestion {
  key: string;
  label: string;       // the question, shown to the DJ as the field label
  placeholder: string; // a concrete example answer
}

// The trainer asks the questions a DJ's own clients actually ask — but a
// wedding/private-event (mobile) DJ and a club/bar DJ get asked DIFFERENT
// things. Use trainingQuestionsFor(djType) to get the right list for a profile.

// Mobile / private-event DJ (weddings, birthdays, corporate parties).
// UNCHANGED from the original shared set — mobile DJs see exactly these.
const MOBILE_QUESTIONS: BotTrainingQuestion[] = [
  { key: 'standout', label: 'What makes you stand out?', placeholder: 'e.g. 15+ years, bilingual MC, huge open-format library' },
  { key: 'music', label: 'Tell clients about your music library', placeholder: 'e.g. 50,000+ tracks, every era and format, constantly updated with the latest releases' },
  { key: 'weddings_experience', label: 'Weddings — how experienced are you, and do you MC?', placeholder: 'e.g. 300+ weddings; I MC all announcements — grand entrance, first dance, toasts, cake cutting' },
  { key: 'requests', label: 'Do you take song requests or a do-not-play list?', placeholder: 'e.g. Yes — clients send must-plays and a do-not-play list' },
  { key: 'clean_edits', label: 'Do you have clean radio edits when needed?', placeholder: 'e.g. Yes — I can keep it all clean for family-friendly events, or mix explicit and clean to your preference' },
  { key: 'backup_equipment', label: 'Do you have backup equipment?', placeholder: 'e.g. Yes — I bring backup decks, speakers, cables and a spare laptop so the music never stops' },
  { key: 'pre_booking_call', label: 'Are you open to a call or Zoom before booking?', placeholder: 'e.g. Yes — happy to hop on a quick call or Zoom to talk through your event before you book' },
  { key: 'book_ahead', label: 'How far ahead should clients book?', placeholder: 'e.g. 3–6 months out for weddings; sooner for peak dates' },
];

// Club / bar / venue DJ (club nights, bar sets, lounges, residencies).
const CLUB_QUESTIONS: BotTrainingQuestion[] = [
  { key: 'standout', label: 'What makes you stand out?', placeholder: 'e.g. 15+ years, open-format, known for packing the floor' },
  { key: 'music', label: 'Tell clients about your music library', placeholder: 'e.g. 50,000+ tracks, every genre and era, always current with new releases' },
  { key: 'genres', label: 'What genres / format do you play for a room?', placeholder: 'e.g. Open-format — hip-hop, house, Latin, Top 40; I read the room and keep the floor moving' },
  { key: 'crowd_read', label: 'How do you read and work a crowd?', placeholder: 'e.g. I watch the floor and ride the energy — no dead air, smooth transitions, build to peak time' },
  { key: 'clean_edits', label: 'Do you have clean radio edits when needed?', placeholder: 'e.g. Yes — I can keep it clean for the room, or mix explicit and clean to the venue’s preference' },
  { key: 'residencies', label: 'Which venues / residencies have you played?', placeholder: 'e.g. Weekly Friday residency at [venue]; guest sets at clubs and lounges across the city' },
  { key: 'own_gear', label: 'What gear do you bring vs. need the venue to have?', placeholder: 'e.g. I bring my own controller/headphones/USBs; venue provides the sound system and DJ booth' },
  { key: 'backup_equipment', label: 'Do you have backup equipment?', placeholder: 'e.g. Yes — I bring a spare controller, cables and USBs so the music never stops' },
  { key: 'set_length', label: 'How flexible are you on set length / timing?', placeholder: 'e.g. I can do a 2-hour warm-up or play all night — flexible on start time and length' },
  { key: 'pre_booking_call', label: 'Are you open to a call or Zoom before booking?', placeholder: 'e.g. Yes — happy to hop on a quick call or Zoom before you book' },
];

// Back-compat: a combined list used by the parser/serializer so EVERY stored
// answer (from either type, past or present) stays valid even if a DJ switches
// type. The UI renders only the type-specific subset via trainingQuestionsFor().
export const BOT_TRAINING_QUESTIONS: BotTrainingQuestion[] = (() => {
  const seen = new Set<string>();
  const all: BotTrainingQuestion[] = [];
  for (const q of [...MOBILE_QUESTIONS, ...CLUB_QUESTIONS]) {
    if (!seen.has(q.key)) { seen.add(q.key); all.push(q); }
  }
  return all;
})();

/** The questions to SHOW a DJ, by their profile type. */
export function trainingQuestionsFor(djType: string | null | undefined): BotTrainingQuestion[] {
  return (djType || '').toLowerCase() === 'club' ? CLUB_QUESTIONS : MOBILE_QUESTIONS;
}

// Per-field caps — short answers only, so no one writes an essay.
export const BOT_TRAINING_ANSWER_MAX = 300;
export const BOT_TRAINING_EXTRA_MAX = 400;
// A safety cap on the whole serialized blob stored in the DB column.
export const BOT_TRAINING_SERIALIZED_MAX = 4000;

export interface BotTraining {
  answers: Record<string, string>;
  extra: string;
}

const VALID_KEYS = new Set(BOT_TRAINING_QUESTIONS.map((q) => q.key));

// Read whatever is stored in the column back into structured training.
// Backward-compatible: an older plain-text value (before the trainer existed)
// is kept as the free-form "extra" notes so nothing a DJ already wrote is lost.
export function parseBotTraining(raw: string | null | undefined): BotTraining {
  const empty: BotTraining = { answers: {}, extra: '' };
  const txt = (raw || '').trim();
  if (!txt) return empty;
  if (!txt.startsWith('{')) {
    return { answers: {}, extra: txt.slice(0, BOT_TRAINING_EXTRA_MAX) };
  }
  try {
    const o = JSON.parse(txt) as { answers?: unknown; extra?: unknown };
    const answers: Record<string, string> = {};
    if (o && typeof o.answers === 'object' && o.answers) {
      for (const [k, v] of Object.entries(o.answers as Record<string, unknown>)) {
        if (VALID_KEYS.has(k) && typeof v === 'string' && v.trim()) {
          answers[k] = v.trim().slice(0, BOT_TRAINING_ANSWER_MAX);
        }
      }
    }
    const extra = typeof o.extra === 'string' ? o.extra.trim().slice(0, BOT_TRAINING_EXTRA_MAX) : '';
    return { answers, extra };
  } catch {
    return { answers: {}, extra: txt.slice(0, BOT_TRAINING_EXTRA_MAX) };
  }
}

// Serialize structured training back to the stored string. Empty answers are
// dropped so a blank form stores '' (which the bot treats as "no training").
export function serializeBotTraining(t: BotTraining): string {
  const answers: Record<string, string> = {};
  for (const q of BOT_TRAINING_QUESTIONS) {
    const v = (t.answers?.[q.key] || '').trim().slice(0, BOT_TRAINING_ANSWER_MAX);
    if (v) answers[q.key] = v;
  }
  const extra = (t.extra || '').trim().slice(0, BOT_TRAINING_EXTRA_MAX);
  if (Object.keys(answers).length === 0 && !extra) return '';
  return JSON.stringify({ answers, extra }).slice(0, BOT_TRAINING_SERIALIZED_MAX);
}
