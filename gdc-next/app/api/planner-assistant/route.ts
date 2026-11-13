// POST /api/planner-assistant
//
// A HOST-facing helper for the Planner & Playlist page (/planner/[id]). The
// client has no account — exactly like the planner page itself, this is scoped
// by the planner's unguessable UUID (a capability URL). Given that id, it loads
// THIS planner's fields + the booking's event context and helps the host
// understand and answer each question for their specific kind of event
// (wedding, birthday, corporate, …). It never writes answers — the host types
// those into the form — it only explains and suggests.
//
// Read-only + same-exposure: it reveals nothing the holder of the planner link
// can't already see on the planner page. No session; reads with the admin
// client, same as /planner/[id] and /pay/[id].

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  ASSISTANT_MODEL,
  ASSISTANT_MAX_TOKENS,
  ASSISTANT_MAX_MESSAGES,
  ASSISTANT_MAX_INPUT_CHARS,
  stripReplyMarkdown,
} from '@/lib/djAssistant';
import { visibleFields, type PlannerField, isSection } from '@/lib/planner';
import { canBook, type AccessFields } from '@/lib/access';
import { MOB_EVENT_LABELS } from '@/lib/constants';

export const runtime = 'nodejs';

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

// Render the planner's fields the way the host sees them — section headings,
// then each question with its type, choices and helper text — so the model can
// speak to the exact form in front of them.
function formatFields(fields: PlannerField[]): string {
  const out: string[] = [];
  for (const f of fields) {
    if (isSection(f)) {
      out.push(`\n## ${f.label}`);
      continue;
    }
    let line = `- "${f.label}" (${f.type}`;
    if (f.options && f.options.length) line += `: choose from ${f.options.join(' / ')}`;
    line += ')';
    if (f.help) line += ` — ${f.help}`;
    out.push(line);
  }
  return out.join('\n');
}

export async function POST(req: Request) {
  let body: { plannerId?: string; messages?: { role?: string; content?: string }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }); }

  const plannerId = str(body?.plannerId);
  if (!/^[0-9a-f-]{36}$/i.test(plannerId)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'The assistant is not available right now.' }, { status: 503 });
  }

  // Sanitize the conversation (same shape/guards as the DJ assistant).
  const raw = Array.isArray(body?.messages) ? body.messages : [];
  const messages = raw
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
    .map((m) => ({ role: m!.role as 'user' | 'assistant', content: String(m!.content).slice(0, ASSISTANT_MAX_INPUT_CHARS) }))
    .slice(-ASSISTANT_MAX_MESSAGES);
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'No question.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const db = admin as unknown as SupabaseClient;

  const { data: pData } = await db
    .from('booking_planners')
    .select('id, booking_id, dj_id, fields, status, cancelled_at')
    .eq('id', plannerId)
    .maybeSingle();
  const planner = pData as unknown as (Row & { booking_id?: string; dj_id?: string; fields?: PlannerField[]; cancelled_at?: string | null }) | null;
  if (!planner || planner.cancelled_at) {
    return NextResponse.json({ error: 'This planner is no longer available.' }, { status: 404 });
  }

  const { data: bData } = await admin
    .from('bookings')
    .select('event_date, start_time, end_time, venue_name, event_type, event_details, requester_name')
    .eq('id', planner.booking_id as string)
    .maybeSingle();
  const booking = bData as unknown as Row | null;

  const { data: djData } = await admin
    .from('users')
    .select('name, dj_type, planner_assistant_enabled, sub_tier, sub_status, sub_period_start, sub_period_end, comp_tier, comp_expires_at, comp_source')
    .eq('id', planner.dj_id as string).maybeSingle();
  const djRow = djData as (Row & { dj_type?: string | null; planner_assistant_enabled?: boolean | null }) | null;
  const djName = str(djRow?.name) || 'your DJ';

  // Same gate the planner page uses to decide whether to show the helper: paid
  // Mobile DJ account, with the toggle not switched off. Enforced here too so the
  // endpoint can't be hit directly for a free/lapsed or opted-out account.
  const djIsMobile = str(djRow?.dj_type).toLowerCase().includes('mobile');
  const djIsPaid = canBook((djRow || {}) as unknown as AccessFields);
  const assistantOn = djRow?.planner_assistant_enabled !== false;
  if (!djIsMobile || !djIsPaid || !assistantOn) {
    return NextResponse.json({ error: 'This helper is not available.' }, { status: 403 });
  }

  const eventType = str(booking?.event_type);
  const eventLabel = (eventType && MOB_EVENT_LABELS[eventType]) || eventType || 'your event';
  const hostName = str(booking?.requester_name);
  const occasion = str(booking?.event_details);
  const venue = str(booking?.venue_name);
  const fields = visibleFields((planner.fields as PlannerField[]) ?? []);

  // Give the model the real dates so it never has to ASK what year it is: the
  // event date (from the booking) and today. It uses these to know "this year"
  // for current-hits suggestions, etc.
  const fmtDay = (iso?: string | null) => {
    const s = str(iso).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    try {
      return new Date(`${s}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    } catch { return ''; }
  };
  const eventDateLabel = fmtDay((booking as Row | null)?.event_date as string | undefined);
  const todayLabel = (() => { try { return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); } catch { return ''; } })();

  // YEAR-ACCURATE SONGS. The model's knowledge isn't live, so it can't reliably
  // name current-year releases. When the host asks for "this year / latest /
  // <current year>" songs, pull REAL tracks from Deezer's live chart and hand
  // the model that verified list to recommend from. For a specific PAST year we
  // can't verify a chart, so we just tell it to be honest about the year.
  const currentYear = new Date().getFullYear();
  const lastUserMsg = (messages[messages.length - 1]?.content || '').toLowerCase();
  const songContext = /\b(song|songs|track|tracks|music|hit|hits|playlist|artist|tune|jam|dj|dance|edm|pop|rap|hip ?hop|r&b|country|genre|anthem|banger)\b/.test(lastUserMsg);
  const yrMatch = lastUserMsg.match(/\b(19\d{2}|20\d{2})\b/);
  const requestedYear = yrMatch ? Number(yrMatch[1]) : null;
  const wantsCurrent = /\b(this year|latest|current|new|newest|fresh|freshest|hot|hottest|popular|trending|upcoming|out now|right now|recent|nowadays|these days|top charts?|billboard|whats? (hot|popular|new))\b/.test(lastUserMsg) || (requestedYear != null && requestedYear >= currentYear);

  // Map a genre word in the request to Deezer's editorial genre-chart id, so
  // "current EDM / hip-hop / country hits" pulls THAT genre's chart, not the
  // all-genres pop chart. 0 = all genres (the default).
  const GENRE_CHART_IDS: Record<string, string> = {
    edm: '106', electronic: '106', electro: '106', house: '106', techno: '106', dance: '106', 'drum and bass': '106', dubstep: '106',
    pop: '132',
    rap: '116', 'hip hop': '116', 'hip-hop': '116', hiphop: '116', trap: '116',
    'r&b': '165', 'r and b': '165', rnb: '165', soul: '165',
    rock: '152', indie: '152', punk: '152',
    alternative: '85',
    country: '84',
    latin: '197', reggaeton: '197', 'latin pop': '197',
    reggae: '144', dancehall: '144',
    metal: '464',
    afrobeat: '2', afrobeats: '2',
    jazz: '129',
  };
  const genreKey = Object.keys(GENRE_CHART_IDS).find((g) => new RegExp(`\\b${g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lastUserMsg));
  const chartGenreId = genreKey ? GENRE_CHART_IDS[genreKey] : '0';

  // Fetch a Deezer chart's track lines ("- Title — Artist"). Returns [] on any
  // failure/empty.
  async function chartLines(chartId: string): Promise<string[]> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      let res: Response | null = null;
      try { res = await fetch(`https://api.deezer.com/chart/${chartId}/tracks?limit=25`, { signal: ctrl.signal, headers: { Accept: 'application/json' } }); } finally { clearTimeout(timer); }
      const cj = res && res.ok ? ((await res.json().catch(() => null)) as { data?: unknown } | null) : null;
      const rows = Array.isArray(cj?.data) ? (cj!.data as Array<{ title_short?: string; title?: string; artist?: { name?: string } }>) : [];
      return rows
        .map((t) => { const title = str(t.title_short) || str(t.title); const artist = str(t.artist?.name); return title ? `- ${title}${artist ? ` — ${artist}` : ''}` : ''; })
        .filter(Boolean)
        .slice(0, 25);
    } catch { return []; }
  }

  let hitsBlock = '';
  if (songContext && wantsCurrent) {
    try {
      // Try the genre chart; if it comes back empty, fall back to the
      // all-genres chart so we NEVER drop to the "check Spotify" hedge.
      let lines = await chartLines(chartGenreId);
      if (lines.length === 0 && chartGenreId !== '0') lines = await chartLines('0');
      if (lines.length) {
        hitsBlock += `\n\nVERIFIED CURRENT ${genreKey ? genreKey.toUpperCase() + ' ' : ''}HITS (real tracks on the ${genreKey ? genreKey + ' ' : ''}charts RIGHT NOW, ${currentYear}): the host asked for current / this-year / latest ${genreKey ? genreKey + ' ' : ''}songs. Your own knowledge is NOT live, so for their current/latest/${currentYear} request recommend ONLY from this real list — pick the ones that best fit their moment, event and vibe — and emit a [[SONG]] marker for each one you suggest. These are genuinely out now:\n${lines.join('\n')}\nDo NOT add other songs you merely think are current, and don't claim a song is from a specific year unless it's in this list.${genreKey ? ` IMPORTANT: this list is Deezer's "${genreKey}" chart, which can include crossover/pop-adjacent tracks that are NOT truly ${genreKey}. The host specifically asked for ${genreKey.toUpperCase()}, so recommend ONLY the tracks from this list that are genuinely ${genreKey} — skip anything that's really pop, R&B, or another genre even if it's on the list (e.g. don't hand them a pop/R&B singer's track when they asked for ${genreKey}). Use your own knowledge of each artist/song to judge the genre. If only a few of the listed tracks are truly ${genreKey}, suggest just those few rather than padding the list with off-genre songs.` : ''} If none of these fit the moment, say so and offer timeless picks instead.`;
      }
    } catch { /* chart is best-effort — fall through without it */ }
  }
  if (songContext && requestedYear != null && requestedYear < currentYear) {
    hitsBlock += `\n\nThe host asked specifically for songs from ${requestedYear}. You cannot verify an exact ${requestedYear} chart from memory, so do NOT state that a song is "from ${requestedYear}" unless you are genuinely sure. Suggest well-known songs you're confident were popular around then, be upfront you can't guarantee the precise year, and point them to a ${requestedYear} year-end chart if they want certainty. Still emit [[SONG]] markers so they can preview the ones you name.`;
  }

  const system = [
    `You are the friendly Planner & Playlist helper on Global DJ Connect. You are talking to ${hostName || 'the host'} — the person who booked ${djName} — while they fill out the planner for their ${eventLabel}${occasion ? ` (${occasion})` : ''}${venue ? ` at ${venue}` : ''}.`,
    `DATES you already know (never ask the host what year it is or when their event is — you have it):${eventDateLabel ? ` the event is on ${eventDateLabel}.` : ' the exact event date is not on file.'}${todayLabel ? ` Today is ${todayLabel}.` : ''} When they ask for "current" or "this year's" hits, use the event's year (or the current year) from these dates instead of asking.`,
    `Your job: help them fill this planner out. Explain what any question means, suggest what to put, and give concrete examples that fit a ${eventLabel} specifically (first dance songs for a wedding, kid-friendly picks for a birthday, clean/corporate vibes for a corporate event, etc.). Be warm, encouraging and concise — a sentence or two, not an essay.`,
    `TALK TO THEM AS IF IT'S THEIR OWN EVENT — because to them, it is. Use second person about the celebration: "your party", "your event", "songs you love", "what are you into". Do NOT refer to a "guest of honor" as some separate third person (don't say things like "what does your guest of honor love") — that makes them feel like a bystander at their own party. The ONE exception: if the event is clearly being planned FOR someone else (e.g. a parent filling out their child's birthday or sweet 16, or a surprise party), then speak about that honoree warmly by their relationship ("the birthday girl", "your son") — but default to addressing the host directly as the person whose event this is.`,
    `You CANNOT fill the form for them or save anything — they type their own answers into the page. You can tell them exactly what to type. Never ask them to log in, create an account, or leave this page; there is nothing to sign in to.`,
    `Only help with THIS planner and the music/event details for their party. If they ask something unrelated (billing, other events, the DJ's account), gently say this helper is just for planning their event and that they can reach out to ${djName} for anything else.`,
    `WHEN THEY ASK FOR SONG SUGGESTIONS, keep it SHORT, warm and encouraging — never a wall of text, and NEVER a list of several questions at once. If their ask is too vague to pick well (e.g. just "give me must-play suggestions" with no sense of their taste), ask ONE quick, friendly question to narrow it — usually their vibe/genre ("What's the vibe — current pop, throwbacks, hip-hop, a mix?") OR a couple of artists they love ("Who are a few artists you love? I'll find you more in that lane.") — just that single question, not three. When they name an artist, use the [[SIMILAR]] marker so they get real songs by similar artists. Ask only the ONE most useful thing; don't pile on. The moment you have enough to go on (even a one-word answer like "hip-hop"), give the picks — don't keep interrogating. One short question at a time, max.
    DON'T ASK FOR WHAT THEY ALREADY GAVE YOU. If they already named a genre or vibe (e.g. "edm", "hip-hop", "country"), that IS the vibe — do NOT turn around and ask "what's the vibe?"; it's redundant and annoying. Same for an era/year, an artist, or an energy level they stated. When they've given you a genre (or a genre AND a year/era), you already have enough — go straight to the picks, then ask ONE tightening question about a DIFFERENT dimension you don't yet have (energy, a favorite artist, clean-only, a specific moment), never re-asking the thing they just told you.
    SONG SUGGESTIONS — match the song to the REAL MOMENT and relationship, not just the genre. The LYRICS and meaning must fit who it's for:
- A FATHER-DAUGHTER dance (or mother-son dance, or any parent/child dance) needs songs about a PARENT–CHILD bond — growing up, a dad/mom and their kid, pride, letting go. Do NOT suggest romantic love songs or songs about couples/lovers for a parent-child dance (for example "At Last" by Etta James is a romantic love song and is WRONG for a father-daughter dance). Lean toward songs clearly about a father/daughter or parent and child.
- A FIRST DANCE / couple's dance is the opposite: that IS the romantic love song between the two partners.
- Keep every pick clean and age-appropriate for the event, and fitting the vibe (wedding, birthday, quinceañera, etc.).
- If you're not certain a specific song's lyrics truly fit the moment, don't force it — suggest ones you're confident about, or ask a quick clarifying question. Better to give fewer, well-fitting songs than a famous title that doesn't match the moment.
- NEVER claim a song is "from" a specific recent year (or label a list "top hits from 2026", etc.) unless you are genuinely sure of that release year. Do NOT attach a year to a song just to match what they asked. If you're not certain when a song came out, don't state a year at all.
- YOU MAY NOT KNOW THE VERY NEWEST RELEASES (the current year or the last several months) — your knowledge isn't live. So if they ask specifically for "2026" / "this year's" / "the latest" songs, be honest up front: say you might not have the very newest chart releases, then offer recent popular crowd-pleasers you ARE confident about (clearly as "recent hits," not falsely dated) and suggest they check a current chart (e.g. Billboard/Spotify/Apple Music) or ask ${djName} for the freshest picks. Do NOT pass off older songs as brand-new ones with a wrong year — that misleads them.
- AFTER you give song suggestions, finish with ONE short friendly follow-up question that would TIGHTEN the list — so you can refine from here. Pick whatever dimension is most useful next: genre, era/decade, energy (chill vs hype), a favorite artist to match, clean-only, or whether to lean to a specific moment. Phrase it naturally and vary the wording (e.g. "Want these more upbeat, or keep it mellow?", "Any artist you love that I should match the vibe to?", "Should I keep these to a certain era?"). You CAN keep doing this each round — give a fresh set of picks, then one more tightening question — so you narrow toward exactly what they want over a few turns. Just ONE question per reply, short, and never a batch.`,
    `SONG MARKERS (so they can PLAY a preview): whenever you recommend a SPECIFIC song by title, also output it on ITS OWN LINE as a marker exactly like this: [[SONG: Song Title — Artist]] (use an em dash — between the title and the artist). Put one marker per song, each on its own line, right after the short sentence that introduces your picks. The app turns each marker into a little play-a-preview card for them. Still write your normal friendly prose around the markers (the intro and the follow-up question) — the markers are IN ADDITION to, not instead of, talking to them. Only use a marker for a real, specific song you're recommending; don't wrap a whole genre or a vague idea in a marker.`,
    `SIMILAR-ARTIST MARKER: when the host names an ARTIST they love (e.g. "I like John Summit"), output [[SIMILAR: Artist Name]] on its own line. The app finds artists who make SIMILAR music and shows a few of THEIR songs as playable cards — NOT that named artist's own songs. The point is to broaden their list with other artists in the same lane. So for "John Summit" the cards are tracks by similar house/dance artists, not John Summit himself. Use one [[SIMILAR]] marker per artist they name, and introduce it in a sentence like "If you love John Summit, you'll probably dig these too:". You can also add a couple of [[SONG]] markers for specific picks if you want, but the [[SIMILAR]] marker is how you turn an artist they like into fresh, same-vibe discoveries.`,
    `When they ask about a specific question, answer for the real field below. Here is the exact planner they are filling out, section by section:`,
    formatFields(fields),
  ].join('\n\n') + hitsBlock;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY as string,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: ASSISTANT_MODEL, max_tokens: ASSISTANT_MAX_TOKENS, system, messages }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      console.error('[planner-assistant] anthropic error', resp.status, detail.slice(0, 500));
      return NextResponse.json({ error: 'The helper is unavailable right now.' }, { status: 502 });
    }
    const data = await resp.json();
    const reply = Array.isArray(data?.content)
      ? data.content.filter((c: { type?: string }) => c?.type === 'text').map((c: { text?: string }) => c?.text || '').join('').trim()
      : '';
    return NextResponse.json({ reply: stripReplyMarkdown(reply) || "Sorry, I couldn't put that together. Try asking another way?" });
  } catch (e) {
    console.error('[planner-assistant] fetch failed', e);
    return NextResponse.json({ error: 'The helper is unavailable right now.' }, { status: 502 });
  }
}
