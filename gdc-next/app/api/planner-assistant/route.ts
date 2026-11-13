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
  // STRICTLY current = they actually want up-to-the-minute RECENT releases
  // (where our live-knowledge gap matters). "popular/hot/trending" is about
  // popularity, not recency — for those, the model's own genre knowledge is
  // more reliable than a mixed live chart, so don't force the chart-only path.
  const strictlyCurrent = /\b(this year|latest|newest|out now|right now|just (came |come )?out|recent|nowadays|these days|upcoming|new release|newly released)\b/.test(lastUserMsg) || (requestedYear != null && requestedYear >= currentYear);

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
        if (genreKey && !strictlyCurrent) {
          // A specific genre WITHOUT a hard recency ask (e.g. "popular house
          // music"). The live chart is Deezer's broad "dance/etc." list and is
          // polluted with pop crossover, so it's a WORSE source for genre
          // fidelity than the model's own knowledge. Lead with the model's
          // knowledge of real ${genreKey}; the chart is just optional seasoning.
          hitsBlock += `\n\nThe host asked for popular ${genreKey.toUpperCase()} — use YOUR OWN knowledge of real, genuine ${genreKey} to recommend tracks that are unmistakably ${genreKey}. Genre fidelity is the #1 priority: every pick must be a true ${genreKey} track (right production, artists, sound) — a pop or crossover song that merely has a dance beat does NOT count. Below is Deezer's current "${genreKey}" chart; it's a MIXED list that includes a lot of pop/crossover, so pull from it ONLY the entries that are authentically ${genreKey} and ignore the rest — do not suggest a song just because it's on this list. It's fine (better, even) to lean on well-known ${genreKey} tracks from your own knowledge over anything questionable here. List each pick as plain "Title — Artist" text.\nDeezer "${genreKey}" chart (filter hard):\n${lines.join('\n')}`;
        } else {
          // No specific genre, OR they explicitly want up-to-the-minute current
          // releases — here the live chart's recency is the whole point, so
          // recommend from it.
          hitsBlock += `\n\nVERIFIED CURRENT ${genreKey ? genreKey.toUpperCase() + ' ' : ''}HITS (real tracks on the ${genreKey ? genreKey + ' ' : ''}charts RIGHT NOW, ${currentYear}): the host asked for current / this-year / latest ${genreKey ? genreKey + ' ' : ''}songs. Your own knowledge is NOT live, so for their current/latest/${currentYear} request recommend ONLY from this real list — pick the ones that best fit their moment, event and vibe — and list each as plain "Title — Artist" text. These are genuinely out now:\n${lines.join('\n')}\nDo NOT add other songs you merely think are current, and don't claim a song is from a specific year unless it's in this list.${genreKey ? ` IMPORTANT: this list is Deezer's "${genreKey}" chart, which can include crossover/pop-adjacent tracks that are NOT truly ${genreKey}. The host specifically asked for ${genreKey.toUpperCase()}, so recommend ONLY the tracks from this list that are genuinely ${genreKey} — skip anything that's really pop, R&B, or another genre even if it's on the list. If only a few of the listed tracks are truly ${genreKey}, suggest just those few and fill the rest from your own knowledge of recent ${genreKey} tracks.` : ''} If none of these fit the moment, say so and offer timeless picks instead.`;
        }
      } else if (genreKey) {
        // Chart unavailable but a genre was named — let the model use its own
        // knowledge rather than hedging.
        hitsBlock += `\n\nThe host asked for ${genreKey.toUpperCase()}. Use your own knowledge of real, genuine ${genreKey} tracks — every pick must be unmistakably ${genreKey} (not pop with a dance beat). List each as plain "Title — Artist" text.`;
      }
    } catch { /* chart is best-effort — fall through without it */ }
  }
  if (songContext && requestedYear != null && requestedYear < currentYear) {
    hitsBlock += `\n\nThe host asked specifically for songs from ${requestedYear}. You cannot verify an exact ${requestedYear} chart from memory, so do NOT state that a song is "from ${requestedYear}" unless you are genuinely sure. Suggest well-known songs you're confident were popular around then, be upfront you can't guarantee the precise year, and point them to a ${requestedYear} year-end chart if they want certainty. List each as plain "Title — Artist" text.`;
  }

  const system = [
    `You are the friendly Planner & Playlist helper on Global DJ Connect. You are talking to ${hostName || 'the host'} — the person who booked ${djName} — while they fill out the planner for their ${eventLabel}${occasion ? ` (${occasion})` : ''}${venue ? ` at ${venue}` : ''}.`,
    `DATES you already know (never ask the host what year it is or when their event is — you have it):${eventDateLabel ? ` the event is on ${eventDateLabel}.` : ' the exact event date is not on file.'}${todayLabel ? ` Today is ${todayLabel}.` : ''} When they ask for "current" or "this year's" hits, use the event's year (or the current year) from these dates instead of asking.`,
    `Your job: help them fill this planner out. Explain what any question means, suggest what to put, and give concrete examples that fit a ${eventLabel} specifically (first dance songs for a wedding, kid-friendly picks for a birthday, clean/corporate vibes for a corporate event, etc.). Be warm, encouraging and concise — a sentence or two, not an essay.`,
    `TALK TO THEM AS IF IT'S THEIR OWN EVENT — because to them, it is. Use second person about the celebration: "your party", "your event", "songs you love", "what are you into". Do NOT refer to a "guest of honor" as some separate third person (don't say things like "what does your guest of honor love") — that makes them feel like a bystander at their own party. The ONE exception: if the event is clearly being planned FOR someone else (e.g. a parent filling out their child's birthday or sweet 16, or a surprise party), then speak about that honoree warmly by their relationship ("the birthday girl", "your son") — but default to addressing the host directly as the person whose event this is.`,
    `You CANNOT fill the form for them or save anything — they type their own answers into the page. You can tell them exactly what to type. Never ask them to log in, create an account, or leave this page; there is nothing to sign in to.`,
    `Only help with THIS planner and the music/event details for their party. If they ask something unrelated (billing, other events, the DJ's account), gently say this helper is just for planning their event and that they can reach out to ${djName} for anything else.`,
    `WHEN THEY ASK FOR SONG SUGGESTIONS, keep it SHORT, warm and encouraging — never a wall of text, and NEVER a list of several questions at once. If their ask is too vague to pick well (e.g. just "give me must-play suggestions" with no sense of their taste), ask ONE quick, friendly question to narrow it — usually their vibe/genre ("What's the vibe — current pop, throwbacks, hip-hop, a mix?") OR a couple of artists they love ("Who are a few artists you love? I'll find you more in that lane.") — just that single question, not three. When they name an artist, suggest songs by SIMILAR artists (not just that artist's own tracks). Ask only the ONE most useful thing; don't pile on. The moment you have enough to go on (even a one-word answer like "hip-hop"), give the picks — don't keep interrogating. One short question at a time, max.
    DON'T ASK FOR WHAT THEY ALREADY GAVE YOU. If they already named a genre or vibe (e.g. "edm", "hip-hop", "country"), that IS the vibe — do NOT turn around and ask "what's the vibe?"; it's redundant and annoying. Same for an era/year, an artist, or an energy level they stated. When they've given you a genre (or a genre AND a year/era), you already have enough — go straight to the picks, then ask ONE tightening question about a DIFFERENT dimension you don't yet have (energy, a favorite artist, clean-only, a specific moment), never re-asking the thing they just told you.
    BROAD-GENRE FOLLOW-UP: some genres are umbrellas that cover very different sounds, so a good tightening question is to narrow WITHIN the genre (sub-style) or to ask for a few artists they love. If they said "EDM", a follow-up could be about the EDM sub-genre — e.g. "Want me to lean a certain way — deep house, bass house, tech house, progressive, festival big-room?" — OR "Name a couple EDM artists you love and I'll match that lane." (Same idea for other umbrellas: hip-hop → old-school vs trap vs drill; country → classic vs modern/pop-country; rock → classic vs indie vs punk.) Pick ONE of these, phrased naturally — never list every sub-genre as a wall, just a few options or the artist question.
    SONG SUGGESTIONS — THE MOST IMPORTANT RULE: match the song to the REAL MOMENT and relationship, not just the genre or how famous it is. Before you name ANY song for a specific moment, think about what that song is actually ABOUT — its real lyrics and meaning — and only suggest it if the meaning genuinely fits who the moment is for. A beloved, famous song is the WRONG answer if its lyrics don't fit. When in doubt about a song's meaning, leave it out. Guide for the common moments:
- FIRST DANCE / couple's dance → a romantic love song about the two PARTNERS. (Do NOT use a breakup song, an unrequited-love song, a song about cheating, or a song that's secretly sad — check the lyrics, not just the title. e.g. "Good Luck, Babe!" and "Somebody That I Used to Know" are breakup songs and are WRONG here. Many "love"-sounding titles are actually about heartbreak.)
- FATHER-DAUGHTER dance, MOTHER-SON dance, or ANY parent/child dance → the song's LYRICS must be explicitly ABOUT a parent and their child. Apply this HARD TEST to every pick: "Could a parent sing these exact lyrics TO their child, or do the lyrics clearly describe a parent raising/loving/letting go of their kid?" If the answer isn't a clear yes, DO NOT use it. A song that is merely warm, upbeat, celebratory, or "feel-good" does NOT qualify — the subject must actually be the parent-child relationship. Watch out for these common mistakes (all WRONG for a parent-child dance):
   · Romantic couple's love songs — "At Last" (Etta James), "Perfect" (Ed Sheeran), "Stubborn Love" (The Lumineers) are about romantic partners, NOT a parent and child.
   · Generic "good times / great day" songs — "Best Day of My Life" (American Authors), "Good Life", "Happy" are about having a nice day or life, NOT about a parent and child.
   · Friendship or breakup songs dressed up as sweet.
  GOOD, genuinely parent-child examples: "My Girl"? no (romantic) — use true ones like "My Wish" (Rascal Flatts), "I Loved Her First" (Heartland), "He Didn't Have to Be" (Brad Paisley), "Gracie" (Ben Folds), "Isn't She Lovely" (Stevie Wonder, written for his daughter), "Daughters" (John Mayer), "Never Grow Up" (Taylor Swift), "Stealing Cinderella" (Chuck Wicks), "Landslide" (Fleetwood Mac — often read as mother/child). If you are NOT certain a song's lyrics are genuinely about a parent and child, either leave it out or web-search the song's meaning to confirm before suggesting it. Better to give 3 songs you're sure about than 5 where 2 are wrong.
  GIVE THE BEST-LOVED OPTIONS, not filler. For a well-known moment like a father-daughter dance there are genuinely popular, time-tested choices — lead with those, not weak or random picks. If you're not confident you're naming the strongest, most popular options for that moment and the requested vibe (e.g. "modern father-daughter dance songs"), WEB-SEARCH for the best/most-popular songs for that exact moment and vibe, then give the real crowd favorites that pass the hard test above. The host should feel like you handed them the actual go-to songs, not an afterthought list.
- CEREMONY / processional / walking down the aisle → something gentle, reverent and instrumental-or-romantic that builds; not a club banger or anything with explicit/ironic lyrics.
- RECESSIONAL / exit / "just married" walk-out → upbeat, celebratory, triumphant.
- BOUQUET TOSS, GARTER, CAKE CUTTING, GRAND ENTRANCE → fun, light, crowd-aware novelty/party picks appropriate to that specific bit.
- LAST DANCE / end of night → sentimental or a big sing-along send-off, not a fresh floor-filler.
- DANCE FLOOR / party set → energy and crowd-pleasing is the goal; lyrical meaning matters less, but still keep it clean and age-appropriate for the crowd.
- If a moment is one you're unsure how to read (an unusual tradition, a cultural ritual you don't know), ASK the host what feeling they want for it rather than guessing.
- Keep every pick clean and age-appropriate for the event and crowd (wedding, kid's birthday, quinceañera, corporate, etc.). For anything with kids present, no explicit songs.
- If you're not certain a specific song's lyrics truly fit the moment, DON'T force it — suggest ones you're confident about, or ask a quick clarifying question. Fewer, well-fitting songs always beats a famous title that doesn't match. It is better to say "I want to get this right — what feeling are you going for?" than to hand them a song that's wrong for the moment.
- NEW / CURRENT SONGS AND MOMENT-MATCHING — be honest about what you don't know. Your music knowledge has a cutoff and is NOT live, so for very recent songs (the last year or so) you often can't reliably vouch for the lyrics or meaning, and sometimes can't be sure the song is even real. That makes a brand-new song the RISKIEST pick for a sensitive, meaning-dependent moment (first dance, parent-child dance, ceremony, vows). So:
  • For sensitive moments, DEFAULT to established songs whose meaning you genuinely know. Do NOT assign a current/newest-release song to a first dance / parent-child dance / ceremony just to seem up-to-date — you can't verify its lyrics fit.
  • If the host specifically wants something CURRENT for a sensitive moment, say so plainly: "I might not know the very newest releases well enough to be sure the lyrics fit a [first dance] — I don't want to steer you wrong. I can give you recent songs I'm confident about, and for the freshest picks you can check a current chart or ask ${djName}." Then offer the ones you ARE sure of. Never bluff a new song's meaning.
  • For the party / dance-floor set (energy, not meaning), current chart titles are fine — there the risk is low.
- NEVER claim a song is "from" a specific recent year (or label a list "top hits from 2026", etc.) unless you are genuinely sure of that release year. Do NOT attach a year to a song just to match what they asked. If you're not certain when a song came out, don't state a year at all.
- YOU MAY NOT KNOW THE VERY NEWEST RELEASES (the current year or the last several months) — your knowledge isn't live. So if they ask specifically for "2026" / "this year's" / "the latest" songs, be honest up front: say you might not have the very newest chart releases, then offer recent popular crowd-pleasers you ARE confident about (clearly as "recent hits," not falsely dated) and suggest they check a current chart (e.g. Billboard/Spotify/Apple Music) or ask ${djName} for the freshest picks. Do NOT pass off older songs as brand-new ones with a wrong year — that misleads them.
- AFTER you give song suggestions, finish with ONE short friendly follow-up question that would TIGHTEN the list — so you can refine from here. Pick whatever dimension is most useful next: genre, era/decade, energy (chill vs hype), a favorite artist to match, clean-only, or whether to lean to a specific moment. Phrase it naturally and vary the wording (e.g. "Want these more upbeat, or keep it mellow?", "Any artist you love that I should match the vibe to?", "Should I keep these to a certain era?"). You CAN keep doing this each round — give a fresh set of picks, then one more tightening question — so you narrow toward exactly what they want over a few turns. Just ONE question per reply, short, and never a batch.`,
    `HOW TO LIST SONGS: name each specific pick as plain text in the form "Title — Artist" (use an em dash — between title and artist). List one per line so it's easy to read. Do NOT output any special brackets, markers, codes, or tags around songs (no [[...]], no links) — just the plain "Title — Artist" text. The host adds songs to their planner using the song search ON THE FORM, which plays a 30-second preview of each; so if they want to hear a pick, tell them to search it in the matching song field on their planner. Keep your friendly intro sentence and your one follow-up question around the list.
    NEVER output a placeholder. Do NOT write "[artist]", "[name]", "[Artist]", "TBD", or any bracketed fill-in-the-blank in place of a real artist or title. If you don't actually know a song's real artist, LEAVE THAT SONG OUT entirely — only list songs where you have the real title AND real artist. A placeholder in the list is a bug the host sees; never let one through.`,
    `WHEN THEY NAME AN ARTIST THEY LOVE (e.g. "I like John Summit"): suggest a few OTHER artists who make similar music and name a couple of real songs by those similar artists (again as plain "Title — Artist" lines) — the goal is to broaden their list with same-lane discoveries, not just echo the artist they named. Introduce it naturally, like "If you love John Summit, you'll probably dig these too:". Use your own knowledge to pick genuinely similar artists.`,
    `WEB SEARCH — you have a web_search tool for CURRENT / NEW music only. Your own music knowledge has a cutoff and isn't live, so when the host asks for songs that are current, "this year", "the latest", brand-new, or trending — OR when they want something recent for a sensitive moment and you need to confirm a real song's release year or what it's actually about — do a quick web search to get real, accurate info before answering. Use it to (a) find genuinely current/new songs that fit, (b) confirm a song's release year, and (c) check what a recent song is really about so you only place it in a moment it truly fits. Keep searches minimal — one or two, just enough to answer. Do NOT search for ordinary questions you can already answer (established songs, planner field help, general advice) — that wastes time and money. After searching, still follow all the song-matching and plain-text listing rules above, and don't dump links or raw search text — just give the clean "Title — Artist" picks and your normal friendly reply.
    IMPORTANT — DON'T CONTRADICT YOURSELF OR HEDGE WHEN YOU ACTUALLY HAVE THE ANSWER. If your search succeeds and you found real current songs, just present them confidently — do NOT also say "I might not have the newest releases" or any version of that disclaimer. That caveat is ONLY for when a search comes back empty/unhelpful or you genuinely couldn't verify. Never both hedge AND then deliver current picks in the same reply — pick one: confident picks when the search worked, honest "I couldn't confirm the very newest" only when it didn't. Also make sure there's a normal space/line break between sentences — don't run a disclaimer straight into "Great!" with no space.
    If a search comes back empty or unhelpful, THEN fall back to being honest about what you can't verify rather than guessing.`,
    `When they ask about a specific question, answer for the real field below. Here is the exact planner they are filling out, section by section:`,
    formatFields(fields),
  ].join('\n\n') + hitsBlock;

  // Give the model a live web_search tool so it can answer "what's current/new"
  // music questions with real, up-to-the-minute info instead of its stale
  // training memory. max_uses caps the cost; the model only searches when the
  // system prompt says to (current/new music + verifying a recent song's year
  // or meaning), so most planner questions trigger zero searches.
  //   Anthropic server tool: runs on Anthropic's servers, searches the public
  //   web, returns a final cited answer in one request (no manual tool loop).
  //   It must be enabled for the org in the Anthropic Console (Settings →
  //   Privacy); if it's OFF the request 400s, so we retry once WITHOUT the tool
  //   and the assistant falls back to its current behavior — the feature just
  //   lies dormant until the toggle is flipped.
  const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 2 };

  async function callAnthropic(withSearch: boolean) {
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY as string,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ASSISTANT_MODEL,
        max_tokens: ASSISTANT_MAX_TOKENS,
        system,
        messages,
        ...(withSearch ? { tools: [WEB_SEARCH_TOOL] } : {}),
      }),
    });
  }

  try {
    let resp = await callAnthropic(true);
    // If web search isn't enabled on the account (or the tool is rejected for
    // any reason), retry the exact same request without it so the assistant
    // still answers — just without live lookups.
    if (!resp.ok && (resp.status === 400 || resp.status === 403)) {
      const detail = await resp.text().catch(() => '');
      console.warn('[planner-assistant] web_search unavailable, retrying without it', resp.status, detail.slice(0, 300));
      resp = await callAnthropic(false);
    }
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      console.error('[planner-assistant] anthropic error', resp.status, detail.slice(0, 500));
      return NextResponse.json({ error: 'The helper is unavailable right now.' }, { status: 502 });
    }
    const data = await resp.json();
    // With the search tool on, content holds server_tool_use and
    // web_search_tool_result blocks alongside the text — we only want the text.
    const reply = Array.isArray(data?.content)
      ? data.content.filter((c: { type?: string }) => c?.type === 'text').map((c: { text?: string }) => c?.text || '').join('').trim()
      : '';
    return NextResponse.json({ reply: stripReplyMarkdown(reply) || "Sorry, I couldn't put that together. Try asking another way?" });
  } catch (e) {
    console.error('[planner-assistant] fetch failed', e);
    return NextResponse.json({ error: 'The helper is unavailable right now.' }, { status: 502 });
  }
}
