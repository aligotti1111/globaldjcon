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

// Keep these generic enough to fit both mobile (private events) and club/bar
// DJs. The DJ answers the ones that apply and leaves the rest blank.
export const BOT_TRAINING_QUESTIONS: BotTrainingQuestion[] = [
  { key: 'standout', label: 'What makes you stand out?', placeholder: 'e.g. 15+ years, bilingual MC, huge open-format library' },
  { key: 'included', label: "What's included in your pricing?", placeholder: 'e.g. DJ + MC, premium sound, dance-floor lighting, setup & teardown' },
  { key: 'travel', label: 'Do you travel — how far, and any travel fee?', placeholder: 'e.g. Up to 2 hours from NYC; small fee past the first hour' },
  { key: 'requests', label: 'Do you take song requests or a do-not-play list?', placeholder: 'e.g. Yes — clients send must-plays and a do-not-play list' },
  { key: 'extras', label: 'What add-ons or extras do you offer?', placeholder: 'e.g. Uplighting, photo booth, cold sparklers' },
  { key: 'book_ahead', label: 'How far ahead should clients book?', placeholder: 'e.g. 3–6 months out for weddings; sooner for peak dates' },
];

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
