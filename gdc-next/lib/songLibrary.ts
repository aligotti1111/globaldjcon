// Curated, DJ-vetted song lists for specific wedding/event MOMENTS.
//
// Why this exists: the planner assistant kept pulling wrong-meaning songs from
// the model's memory for meaning-critical moments (a romantic song for a
// parent-child dance, a father-daughter song for a mother-son dance). A hand-
// curated list the DJ controls is the most reliable source. The assistant is
// told to PREFER these — filtered to the genre the host asks for — but it is NOT
// limited to them: it may add others that genuinely fit. The hard rule is the
// PAIRING: a song for one pairing (e.g. mother-son) must never be offered for a
// different one (e.g. father-daughter).
//
// Edit freely — add songs, fix a genre tag, or move a song's pairing. Keep the
// shape: title, artist, pairing, genres (lowercase tags). `era` is optional.

export type Pairing =
  | 'mother-son'
  | 'mother-daughter'
  | 'mother-child' // a mother + a son OR a daughter
  | 'father-daughter'
  | 'father-son'
  | 'father-child' // a father + a son OR a daughter
  | 'parent-child' // ANY parent + ANY child — fits a mother's OR a father's dance
  | 'first-dance';

export interface CuratedSong {
  title: string;
  artist: string;
  pairing: Pairing;
  /** lowercase genre/era tags the host might ask for: modern, country, classic,
   *  rock, soul, rnb, pop, jazz, folk, hiphop, acoustic, etc. */
  genres: string[];
  /** niche for THIS moment — a fine pick but not a crowd default. Kept OFF the
   *  top of a general (no-genre) ask, and only surfaces when the host asks for
   *  a genre this song matches. */
  niche?: boolean;
  /** the lyrics are specifically about a WEDDING — the daughter getting married,
   *  giving her away, her wedding day. ONLY offered at a wedding. Excluded for a
   *  Sweet 16, quinceañera, birthday, etc. (she isn't getting married). */
  wedding?: boolean;
}

export interface AvoidSong {
  title: string;
  artist?: string;
  reason: string;
}

// ── MOTHER'S DANCE (mother-son and mother-daughter) ─────────────────────────
// Tagged per song. 'mother-child' = works for a son or a daughter.
export const SONG_LIBRARY: CuratedSong[] = [
  // Either a son or a daughter — safe for a mother-son OR mother-daughter dance.
  { title: 'In My Life', artist: 'The Beatles', pairing: 'mother-child', genres: ['classic', 'rock', 'oldies'] },
  { title: 'What a Wonderful World', artist: 'Louis Armstrong', pairing: 'mother-child', genres: ['classic', 'jazz', 'oldies'] },
  { title: 'Unforgettable', artist: 'Nat King Cole', pairing: 'mother-child', genres: ['classic', 'jazz'] },
  { title: 'Stand By Me', artist: 'Ben E. King', pairing: 'mother-child', genres: ['classic', 'soul', 'oldies'] },
  { title: 'Forever Young', artist: 'Rod Stewart', pairing: 'mother-child', genres: ['classic', 'rock', '80s'] },
  { title: 'Forever Young', artist: 'Bob Dylan', pairing: 'parent-child', genres: ['classic', 'folk'] },
  { title: 'My Wish', artist: 'Rascal Flatts', pairing: 'parent-child', genres: ['country'] },
  { title: 'Humble and Kind', artist: 'Tim McGraw', pairing: 'parent-child', genres: ['country', 'modern'] },
  { title: 'I Hope You Dance', artist: 'Lee Ann Womack', pairing: 'parent-child', genres: ['country'] },
  { title: 'You Are the Sunshine of My Life', artist: 'Stevie Wonder', pairing: 'mother-child', genres: ['soul', 'classic'] },
  { title: 'Because You Loved Me', artist: 'Céline Dion', pairing: 'parent-child', genres: ['pop', 'ballad'] },
  { title: "You're My Best Friend", artist: 'Queen', pairing: 'mother-child', genres: ['classic', 'rock'] },
  { title: '93 Million Miles', artist: 'Jason Mraz', pairing: 'mother-child', genres: ['modern', 'pop', 'acoustic'] },
  { title: "You'll Be in My Heart", artist: 'Phil Collins', pairing: 'mother-child', genres: ['pop', 'classic'] },
  { title: 'Letter to My Mother', artist: 'Edwin McCain', pairing: 'mother-child', genres: ['modern', 'rock', 'ballad'] },
  { title: 'Turn to You', artist: 'Justin Bieber', pairing: 'mother-child', genres: ['modern', 'pop'] },
  { title: 'I Got You', artist: 'Ciara', pairing: 'mother-child', genres: ['modern', 'rnb', 'pop'] },
  { title: "I'll Be There", artist: 'Mac Miller', pairing: 'mother-child', genres: ['modern', 'hiphop'] },

  // Specifically a mother and her SON.
  { title: 'A Song for Mama', artist: 'Boyz II Men', pairing: 'mother-son', genres: ['rnb', '90s'] },
  { title: 'Beautiful Boy', artist: 'John Lennon', pairing: 'mother-son', genres: ['classic', 'rock'] },
  { title: 'Simple Man', artist: 'Lynyrd Skynyrd', pairing: 'mother-son', genres: ['classic', 'rock', 'southern'] },

  // Specifically a mother and her DAUGHTER.
  { title: 'Like My Mother Does', artist: 'Lauren Alaina', pairing: 'mother-daughter', genres: ['country', 'modern'] },
  { title: 'Landslide', artist: 'Fleetwood Mac', pairing: 'mother-daughter', genres: ['classic', 'rock', 'soft-rock'] },
  { title: 'The House That Built Me', artist: 'Miranda Lambert', pairing: 'mother-daughter', genres: ['country', 'modern'] },
  { title: 'Mother Like Mine', artist: 'The Band Perry', pairing: 'mother-daughter', genres: ['country', 'modern'] },
  { title: 'The Best Day', artist: 'Taylor Swift', pairing: 'mother-daughter', genres: ['country', 'modern'] },
  { title: "Mama's Song", artist: 'Carrie Underwood', pairing: 'mother-daughter', genres: ['country', 'modern'] },

  // ── FATHER'S DANCE — a father and his DAUGHTER. ───────────────────────────
  { title: "Isn't She Lovely", artist: 'Stevie Wonder', pairing: 'father-daughter', genres: ['classic', 'soul'] },
  { title: 'I Loved Her First', artist: 'Heartland', pairing: 'father-daughter', genres: ['country'], wedding: true },
  { title: 'Butterfly Kisses', artist: 'Bob Carlisle', pairing: 'father-daughter', genres: ['country', 'classic', 'ballad'], wedding: true },
  { title: 'Dance with My Father', artist: 'Luther Vandross', pairing: 'father-daughter', genres: ['rnb', 'soul'] },
  { title: 'Wildflowers', artist: 'Tom Petty', pairing: 'father-daughter', genres: ['classic', 'rock'] },
  { title: 'Daddy Daughter Dance', artist: 'Julia Cole', pairing: 'father-daughter', genres: ['country', 'modern'], wedding: true },
  { title: 'Yours', artist: 'Post Malone', pairing: 'father-daughter', genres: ['modern', 'pop'], wedding: true },
  { title: 'My Little Girl', artist: 'Tim McGraw', pairing: 'father-daughter', genres: ['country'], wedding: true },
  { title: 'First Man', artist: 'Camila Cabello', pairing: 'father-daughter', genres: ['modern', 'pop'] },
  { title: 'Count on Me', artist: 'Bruno Mars', pairing: 'father-daughter', genres: ['modern', 'pop'] },
  { title: 'Tiny Dancer', artist: 'Elton John', pairing: 'father-daughter', genres: ['classic', 'rock'] },
  { title: 'Constellations', artist: 'Jack Johnson', pairing: 'father-daughter', genres: ['acoustic', 'modern'] },
  { title: 'To Make You Feel My Love', artist: 'Bob Dylan', pairing: 'father-daughter', genres: ['classic', 'folk', 'ballad'] },
  { title: 'Brown Eyed Girl', artist: 'Van Morrison', pairing: 'father-daughter', genres: ['classic', 'rock', 'oldies'] },
  { title: 'There Goes My Life', artist: 'Kenny Chesney', pairing: 'father-daughter', genres: ['country'] },
  { title: 'One Call Away', artist: 'Charlie Puth', pairing: 'father-daughter', genres: ['modern', 'pop'] },
  { title: 'Sweet Pea', artist: 'Amos Lee', pairing: 'father-daughter', genres: ['acoustic', 'modern', 'soul'] },
  { title: 'Never Grow Up', artist: 'Taylor Swift', pairing: 'father-daughter', genres: ['country', 'modern'] },
  { title: "Daddy's Little Girl", artist: 'Michael Bublé', pairing: 'father-daughter', genres: ['classic', 'pop', 'jazz'] },
  { title: 'Half the Man', artist: 'Jennifer Hart', pairing: 'father-daughter', genres: ['modern'] },
  { title: "Ain't That Love", artist: 'Ray Charles', pairing: 'father-daughter', genres: ['classic', 'soul', 'rnb'] },
  { title: 'Ballerina Girl', artist: 'Lionel Richie', pairing: 'father-daughter', genres: ['classic', 'soul', '80s'] },
  { title: 'God Gave Me You', artist: 'Blake Shelton', pairing: 'father-daughter', genres: ['country', 'modern'] },
  { title: 'Butterfly Fly Away', artist: 'Miley Cyrus', pairing: 'father-daughter', genres: ['modern', 'pop', 'country'] },
  // Expanded (vetted father-daughter standards across genres).
  { title: 'Daughters', artist: 'John Mayer', pairing: 'father-daughter', genres: ['modern', 'acoustic'] },
  { title: "He Didn't Have to Be", artist: 'Brad Paisley', pairing: 'father-daughter', genres: ['country'] }, // great for a stepdad
  { title: 'Gracie', artist: 'Ben Folds', pairing: 'father-daughter', genres: ['modern', 'acoustic'] },
  { title: 'Cinderella', artist: 'Steven Curtis Chapman', pairing: 'father-daughter', genres: ['country', 'ballad'], wedding: true },
  { title: 'Stealing Cinderella', artist: 'Chuck Wicks', pairing: 'father-daughter', genres: ['country'], wedding: true },
  { title: 'The Way You Look Tonight', artist: 'Frank Sinatra', pairing: 'father-daughter', genres: ['classic', 'jazz'] },
  { title: 'Good Hands', artist: 'Kylie Morgan', pairing: 'father-daughter', genres: ['country', 'modern'] },
  { title: 'Forever Now', artist: 'Michael Bublé', pairing: 'father-daughter', genres: ['modern', 'pop', 'jazz'] },
  { title: 'Daddy Dance with Me', artist: 'Krystal Keith', pairing: 'father-daughter', genres: ['country', 'modern'] },
  { title: 'Dance With My Daughter', artist: 'Jason Blaine', pairing: 'father-daughter', genres: ['country', 'modern'] },
  // Rock father-daughter picks.
  { title: 'Father and Daughter', artist: 'Paul Simon', pairing: 'father-daughter', genres: ['rock', 'folk'] },
  { title: 'Have I Told You Lately', artist: 'Rod Stewart', pairing: 'father-daughter', genres: ['rock', 'classic'] },
  { title: 'Lullaby (Goodnight, My Angel)', artist: 'Billy Joel', pairing: 'father-daughter', genres: ['rock', 'classic', 'ballad'] },
  { title: 'Thank You', artist: 'Led Zeppelin', pairing: 'father-daughter', genres: ['rock', 'classic'], niche: true },
  { title: 'My Hero', artist: 'Foo Fighters', pairing: 'father-daughter', genres: ['rock'], niche: true },

  // ── FIRST DANCE — the couple. (Moved here from father-daughter.) ──────────
  { title: 'Perfect', artist: 'Ed Sheeran', pairing: 'first-dance', genres: ['modern', 'pop'] },
  { title: 'Just the Way You Are', artist: 'Billy Joel', pairing: 'first-dance', genres: ['classic', 'pop'] },
  { title: 'My Girl', artist: 'The Temptations', pairing: 'first-dance', genres: ['classic', 'soul', 'motown'] },
];

// Songs explicitly NOT to recommend (e.g. commonly suggested but a poor fit).
export const AVOID_SONGS: AvoidSong[] = [
  { title: "You've Got a Friend", reason: 'not a good wedding / mother-dance recommendation' },
];

// Which library pairings cover a requested moment. A mother-son dance draws
// from 'mother-son' + the gender-neutral 'mother-child'; never from father or
// mother-daughter songs.
const PAIRING_COVERAGE: Record<string, Pairing[]> = {
  'mother-son': ['mother-son', 'mother-child', 'parent-child'],
  'mother-daughter': ['mother-daughter', 'mother-child', 'parent-child'],
  'father-son': ['father-son', 'father-child', 'parent-child'],
  'father-daughter': ['father-daughter', 'father-child', 'parent-child'],
  'first-dance': ['first-dance'],
  // Extended-family dances (grandparent↔grandchild, aunt/uncle↔niece/nephew)
  // reuse the GENDER-NEUTRAL family songs — the ones that are about love and
  // growing up without naming "mom/dad". Parent-named songs are filtered out
  // below. One bucket each (the generic songs fit any gender combo).
  'grandparent-grandchild': ['parent-child', 'mother-child', 'father-child'],
  'aunt-uncle-niece-nephew': ['parent-child', 'mother-child', 'father-child'],
};

// Moments that must drop songs whose lyrics specifically name a PARENT — they
// don't fit a grandparent/aunt/uncle. (Most '-child' songs are generic; only a
// few name a parent.) Matched by title, lowercased.
const EXTENDED_FAMILY_MOMENTS = new Set(['grandparent-grandchild', 'aunt-uncle-niece-nephew']);
const PARENT_NAMED_TITLES = new Set(['letter to my mother']);

// Detect the pairing the host is asking about from their recent chat text.
export function detectPairing(text: string): keyof typeof PAIRING_COVERAGE | null {
  const t = text.toLowerCase();
  // Extended family first (so "grandfather-daughter" style phrases don't match
  // the parent patterns).
  if (/\bgrand(pa|ma|father|mother|parent|dad|mom|son|daughter|child|kid)\b|\bgrand[-\s]?(daughter|son|child|kid)\b/.test(t)) return 'grandparent-grandchild';
  if (/\baunt\b|\buncle\b|\bniece\b|\bnephew\b/.test(t)) return 'aunt-uncle-niece-nephew';
  if (/\bmother[-\s]?son\b|\bson[-\s]?mother\b/.test(t)) return 'mother-son';
  if (/\bmother[-\s]?daughter\b|\bdaughter[-\s]?mother\b/.test(t)) return 'mother-daughter';
  if (/\bfather[-\s]?son\b|\bson[-\s]?father\b/.test(t)) return 'father-son';
  if (/\bfather[-\s]?daughter\b|\bdaughter[-\s]?father\b|\bdaddy[-\s]?daughter\b/.test(t)) return 'father-daughter';
  if (/\bfirst\s+dance\b/.test(t)) return 'first-dance';
  return null;
}

// Return the vetted songs for a moment, optionally sorted so the host's
// requested genre floats to the top (never filtered out entirely — the genre
// shapes the order, it doesn't limit). Returns [] if we have no list for it.
export function curatedForMoment(momentText: string, limit = 24, isWedding = true): CuratedSong[] {
  const pairing = detectPairing(momentText);
  if (!pairing) return [];
  const cover = new Set(PAIRING_COVERAGE[pairing]);
  const extended = EXTENDED_FAMILY_MOMENTS.has(pairing);
  const songs = SONG_LIBRARY.filter(
    (s) =>
      cover.has(s.pairing) &&
      !(extended && PARENT_NAMED_TITLES.has(s.title.trim().toLowerCase())) &&
      !(s.wedding && !isWedding), // drop marriage-specific songs when it's not a wedding
  );
  const t = momentText.toLowerCase();
  // Pull out any genre word the host used so we can sort those first.
  const askedGenres = ['modern', 'country', 'classic', 'rock', 'soul', 'rnb', 'r&b', 'pop', 'jazz', 'folk', 'hiphop', 'hip hop', 'acoustic', '80s', '90s', 'oldies']
    .filter((g) => new RegExp(`\\b${g.replace('&', '&').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t))
    .map((g) => (g === 'r&b' ? 'rnb' : g === 'hip hop' ? 'hiphop' : g));
  const match = (s: CuratedSong) => s.genres.some((g) => askedGenres.includes(g));
  const sorted = [...songs].sort((a, b) => {
    // When a genre is asked, matching songs float up. Otherwise niche songs sink.
    if (askedGenres.length) return Number(match(b)) - Number(match(a));
    return Number(!!a.niche) - Number(!!b.niche);
  });
  return sorted.slice(0, limit);
}

// Normalized titles of EVERY vetted song for a moment (no genre limit). The
// route uses this so the verification pass TRUSTS a curated pick and never
// strips it — if the DJ put it on the list, it's approved.
export function curatedTitlesForMoment(momentText: string, isWedding = true): Set<string> {
  const pairing = detectPairing(momentText);
  if (!pairing) return new Set();
  const cover = new Set(PAIRING_COVERAGE[pairing]);
  const extended = EXTENDED_FAMILY_MOMENTS.has(pairing);
  return new Set(
    SONG_LIBRARY.filter(
      (s) =>
        cover.has(s.pairing) &&
        !(extended && PARENT_NAMED_TITLES.has(s.title.trim().toLowerCase())) &&
        !(s.wedding && !isWedding),
    ).map((s) => s.title.trim().toLowerCase()),
  );
}

// Format the vetted list for injection into the assistant's prompt.
export function formatCuratedBlock(momentText: string, isWedding = true): string | null {
  const pairing = detectPairing(momentText);
  if (!pairing) return null;
  const songs = curatedForMoment(momentText, 24, isWedding);
  if (songs.length === 0) return null;
  const label = pairing.replace(/-/g, '–').toUpperCase();
  const lines = songs.map((s) => `- ${s.title} — ${s.artist} [${s.genres.join(', ')}]`).join('\n');
  const avoid = AVOID_SONGS.map((a) => `- ${a.title}${a.artist ? ` — ${a.artist}` : ''} (${a.reason})`).join('\n');
  return (
    `VETTED ${label} SONGS (a DJ-curated list for THIS exact moment — this is your PREFERRED source, not your memory). ` +
    `Lead with these. If the host named a genre/era, pick the ones tagged with it (tags are in brackets); the list is already ordered to help. ` +
    `You MAY add a song that's NOT on this list if it genuinely fits this exact pairing and the host's vibe — the list guides you, it doesn't cap you. If the host asks for MORE and you've used the best fits from this list, WEB-SEARCH for additional real "${label.toLowerCase()} dance songs" (plus their genre/vibe) to pull fresh vetted picks rather than guessing from memory, then apply the same pairing/meaning check. ` +
    `But NEVER offer a song meant for a different pairing (these are ${label} songs — do not use them for a father's dance or a first dance, and vice-versa):\n${lines}` +
    (avoid ? `\nDo NOT recommend:\n${avoid}` : '')
  );
}
