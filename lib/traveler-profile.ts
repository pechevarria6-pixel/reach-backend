// ─── What kind of traveller somebody is, from six taps ───────────────────
// The onboarding quiz v3 (REACH-QUIZ-V3-2026-09-24.md). Everything that turns
// answers into a profile lives here, in pure functions, so the preview the
// browser shows and the row the server stores are computed by the same code
// — and the server never takes the browser's word for it.
//
// Two things come out, and they are used differently on purpose:
//
//   · six scores (what somebody chases) and a primary/secondary name, which
//     are DISPLAY FLAVOUR — the reveal and the group mix card;
//   · four dials and the raw scores, which Discover RANKS by.
//
// Nobody is collapsed to a single label for recommendations. A letter tally
// is lossy, and "The Taster" says nothing about whether you go to bed at ten.
//
// This file is shared with the client bundle. No database, no clock unless
// one is passed in, no imports beyond types.

// ─── The six things people chase ─────────────────────────────────────────

export const ARCHETYPES = ['scout', 'storyteller', 'thrill', 'recharger', 'taster', 'spark'] as const;
export type ArchetypeKey = typeof ARCHETYPES[number];

export const DIALS = ['pace', 'novelty', 'energy', 'crowd'] as const;
export type DialKey = typeof DIALS[number];

/**
 * The fixed copy for each result. Deterministic and reviewable — the spec
 * rules out model-written result prose, and so does CLAUDE.md: this is a
 * sentence about a person, and it should be the same sentence every time.
 */
export const RESULT_COPY: Record<ArchetypeKey, { name: string; short: string; emoji: string; line: string }> = {
  scout: { name: 'The Scout', short: 'Scout', emoji: '🧭', line: 'First to find it, never the one following a list.' },
  storyteller: { name: 'The Storyteller', short: 'Storyteller', emoji: '🏛️', line: 'You travel for the story behind the place.' },
  thrill: { name: 'The Thrill-Seeker', short: 'Thrill-Seeker', emoji: '🧗', line: 'If it climbs, moves or gets you wet, you are in.' },
  recharger: { name: 'The Recharger', short: 'Recharger', emoji: '🌅', line: 'A trip is how you come back better than you left.' },
  taster: { name: 'The Taster', short: 'Taster', emoji: '🍜', line: 'The meal is the trip. Everything else is between meals.' },
  spark: { name: 'The Spark', short: 'Spark', emoji: '✨', line: 'Where you go, the night goes. You bring the people.' },
};

/** What the reveal says when nothing was answered, or nothing scored. */
export const EVERYTHING_COPY = {
  name: "You're a bit of everything",
  emoji: '🌀',
  line: 'Tell us more as you go and this sharpens.',
};

// ─── The six upfront screens ─────────────────────────────────────────────

export const UPFRONT_SCREENS = ['first_move', 'interests', 'plan', 'restaurant', 'late', 'no_way'] as const;
export type ScreenId = typeof UPFRONT_SCREENS[number];

type Effect = { a?: Partial<Record<ArchetypeKey, number>>; d?: Partial<Record<DialKey, number>> };

export const FIRST_MOVE = {
  eat: { a: { taster: 3 } },
  wander: { a: { scout: 3 } },
  famous: { a: { storyteller: 2 } },
  slow: { a: { recharger: 3 } },
  group: { a: { spark: 3 } },
} satisfies Record<string, Effect>;
export type FirstMove = keyof typeof FIRST_MOVE;

export const PLAN = {
  wing: { d: { pace: 0 }, a: { scout: 1 } },
  loose: { d: { pace: 25 } },
  daily: { d: { pace: 50 } },
  full: { d: { pace: 75 } },
  // Planning is not a type. "Every hour" sets the dial and nothing else.
  hourly: { d: { pace: 100 } },
} satisfies Record<string, Effect>;
export type PlanChoice = keyof typeof PLAN;

export const RESTAURANT = {
  famous: { d: { novelty: 15 } },
  locals: { d: { novelty: 50 } },
  new: { d: { novelty: 80 }, a: { scout: 2 } },
  truck: { d: { novelty: 95 }, a: { scout: 2, taster: 1 } },
} satisfies Record<string, Effect>;
export type RestaurantChoice = keyof typeof RESTAURANT;

export const LATE = {
  asleep: { d: { energy: 15 }, a: { recharger: 1 } },
  one_more: { d: { energy: 45 } },
  next_spot: { d: { energy: 75 }, a: { spark: 2 } },
  sunrise: { d: { energy: 95 }, a: { spark: 2, thrill: 1 } },
} satisfies Record<string, Effect>;
export type LateChoice = keyof typeof LATE;

// ─── Drip questions: asked later, one at a time ──────────────────────────

export const NIGHT_OUT = {
  six: { d: { crowd: 20 } },
  buzzy: { d: { crowd: 50 } },
  live: { d: { crowd: 80 } },
  stadium: { d: { crowd: 95 } },
} satisfies Record<string, Effect>;
export type NightOutChoice = keyof typeof NIGHT_OUT;

/**
 * "Free afternoon, zero plans?" Fine-tunes pace rather than setting it: an
 * answer about one afternoon is weaker evidence than "How much plan do you
 * like?", so it moves the dial fifteen points and no more.
 */
export const FREE_AFTERNOON = {
  outdoors: { a: { thrill: 3 } },
  wander: { pace: -15 },
  book: { pace: 15 },
  rest: { a: { recharger: 2 } },
} satisfies Record<string, Effect & { pace?: number }>;
export type FreeAfternoonChoice = keyof typeof FREE_AFTERNOON;

/**
 * The words on the drink chips, exactly as v2 stored them in
 * users.drink_style, so an old answer and a new one are the same string and
 * Discover's existing "Not drinking" rule reads both.
 */
export const DRINKS = ['Cocktails', 'Wine', 'Beer', 'Coffee, honestly', 'Not drinking'] as const;
export const NOT_DRINKING = 'Not drinking';

/** The v2 seating chips, as stored in users.dining_vibe. */
export const SEATING = [
  'A tiny place locals queue for', 'Somewhere buzzy', 'A proper tasting menu',
  'Outside, always', 'Quiet enough to talk', "Wherever's good",
] as const;

// ─── What you're into ────────────────────────────────────────────────────

/**
 * Every v2 interest chip, and who it counts towards. One map, keyed on the
 * words on the chip (what users.favorite_activities stores), so a v2 answer
 * scores exactly as the same tap would today.
 */
export const INTEREST_ARCHETYPE: Record<string, ArchetypeKey> = {
  'Cooking': 'taster',
  'Pottery & crafts': 'storyteller',
  'Live music': 'spark',
  'Art & galleries': 'storyteller',
  'Outdoors': 'thrill',
  'Sport': 'thrill',
  'Comedy': 'spark',
  'Film & theatre': 'storyteller',
  'Dancing': 'spark',
  'Wellness': 'recharger',
  'Books & talks': 'storyteller',
  'Photography': 'scout',
  'Markets & food halls': 'taster',
  'Museums & history': 'storyteller',
  'Wine tasting': 'taster',
  'Breweries': 'taster',
  'Trivia & board games': 'spark',
  'Gardens & parks': 'recharger',
};

/**
 * The twelve that fit on one phone screen (spec 3a: cap at 12). The other
 * six still count when a v2 answer holds them, and are still offered in
 * Profile's full list — saving this screen never drops them.
 */
export const Q2_TILES = [
  'Live music', 'Outdoors', 'Sport', 'Art & galleries', 'Museums & history', 'Film & theatre',
  'Markets & food halls', 'Wine tasting', 'Wellness', 'Gardens & parks', 'Comedy', 'Photography',
] as const;

// ─── No way, José ────────────────────────────────────────────────────────

/** Food somebody cannot or will not eat. Written to users.dietary_needs. */
export const DIETARY = [
  'Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free', 'No shellfish', 'No nuts', 'No pork', 'Halal', 'Kosher',
] as const;

/** Absolute nos, as the v2 chips stored them in users.no_way_jose. */
export const DISLIKES = [
  'Big crowds', 'Loud rooms', 'Early mornings', 'Heights', 'Clubs',
  'Very spicy food', 'Cold weather', 'Camping', 'Karaoke',
] as const;

// ─── The answers ─────────────────────────────────────────────────────────

export type OneOrMore<T extends string> = T | T[] | null;

/** An answer as a list of the picks the table knows, whatever shape it came in. */
export function picksOf<T extends string>(v: OneOrMore<T> | undefined, table: Record<string, unknown>): T[] {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  return [...new Set(list)].filter((x): x is T => typeof x === 'string' && Object.prototype.hasOwnProperty.call(table, x));
}

export interface QuizAnswers {
  // One pick or several. People are more than one thing — "find the food"
  // and "walk until something looks interesting" are both true of plenty of
  // travellers — so these screens take every answer that fits and blend them.
  first_move?: OneOrMore<FirstMove>;
  interests?: string[] | null;
  plan?: OneOrMore<PlanChoice>;
  restaurant?: OneOrMore<RestaurantChoice>;
  late?: OneOrMore<LateChoice>;
  /** PRIVATE. Never leaves this person's own screens. */
  dietary?: string[] | null;
  /** PRIVATE. */
  dislikes?: string[] | null;
  /** PRIVATE. A typed hard no. */
  no_way_text?: string | null;
  eat_everything?: boolean | null;
  drinks?: string[] | null;
  seating?: string[] | null;
  night_out?: OneOrMore<NightOutChoice>;
  camera_roll?: ArchetypeKey | null;
  free_afternoon?: FreeAfternoonChoice | null;
  /** PRIVATE. Their own words. */
  free_interests?: string | null;
  /** A nudge on the reveal's bars. Wins over whatever the answers set. */
  dial_overrides?: Partial<Record<DialKey, number>> | null;
  /** Upfront screens tapped past with Skip. */
  skipped?: string[] | null;
  /** Drip question id → when it was dismissed. The 60-day clock. */
  drip_dismissed?: Record<string, string> | null;
  /** When the six upfront screens were last worked through. */
  completed_at?: string | null;
}

export interface TravelerProfile {
  /** Highest score. Null when nothing scored — "a bit of everything". */
  primary: ArchetypeKey | null;
  /** Second highest, only when it is at least 60% of the primary. */
  secondary: ArchetypeKey | null;
  scores: Record<ArchetypeKey, number>;
  /** 0–100. Unanswered dials sit at 50 and are listed in `unanswered`. */
  dials: Record<DialKey, number>;
  /** Dials nobody has answered. The group mix rules ignore these. */
  unanswered: DialKey[];
  version: 3;
  computed_at: string;
}

const clampDial = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map(s => s.trim()))] : [];

function interestCounts(interests: string[]): Record<ArchetypeKey, number> {
  const counts = Object.fromEntries(ARCHETYPES.map(k => [k, 0])) as Record<ArchetypeKey, number>;
  for (const i of interests) {
    const k = INTEREST_ARCHETYPE[i];
    if (k) counts[k] += 1;
  }
  return counts;
}

/**
 * The one scoring function. Client preview and server both call this; the
 * server recomputes on every save and never stores a value it was sent.
 *
 * `now` is a parameter so a fixture always produces the same object.
 */
export function scoreQuiz(answers: QuizAnswers | null | undefined, now: Date = new Date()): TravelerProfile {
  const a = answers ?? {};
  const scores = Object.fromEntries(ARCHETYPES.map(k => [k, 0])) as Record<ArchetypeKey, number>;
  const dials = { pace: 50, novelty: 50, energy: 50, crowd: 50 } as Record<DialKey, number>;
  const answered = new Set<DialKey>();

  const apply = (e: Effect | undefined) => {
    if (!e) return;
    for (const [k, v] of Object.entries(e.a ?? {})) scores[k as ArchetypeKey] += v as number;
    for (const [k, v] of Object.entries(e.d ?? {})) { dials[k as DialKey] = v as number; answered.add(k as DialKey); }
  };

  // Several picks on one screen are blended, not stacked. The screen keeps
  // the weight it has with one pick, shared between the picks, so choosing
  // everything is not a louder answer than choosing one; and a dial is the
  // average of where the picks put it, so "Loose outline" and "Every hour"
  // is somebody in between, not whichever was tapped last.
  const blend = (table: Record<string, Effect>, v: OneOrMore<string> | undefined) => {
    const picks = picksOf(v, table);
    if (!picks.length) return;
    const share = 1 / picks.length;
    const sums: Partial<Record<DialKey, { total: number; n: number }>> = {};
    for (const pick of picks) {
      const e = table[pick];
      for (const [k, pts] of Object.entries(e.a ?? {})) scores[k as ArchetypeKey] += (pts as number) * share;
      for (const [k, d] of Object.entries(e.d ?? {})) {
        const s = sums[k as DialKey] ?? { total: 0, n: 0 };
        s.total += d as number; s.n++;
        sums[k as DialKey] = s;
      }
    }
    for (const [k, s] of Object.entries(sums)) {
      dials[k as DialKey] = clampDial(Math.round(s!.total / s!.n));
      answered.add(k as DialKey);
    }
  };

  blend(FIRST_MOVE, a.first_move);
  blend(PLAN, a.plan);
  blend(RESTAURANT, a.restaurant);
  blend(LATE, a.late);
  blend(NIGHT_OUT, a.night_out);

  const interests = strings(a.interests);
  const perInterest = interestCounts(interests);
  for (const k of ARCHETYPES) scores[k] += perInterest[k];

  if (a.free_afternoon && FREE_AFTERNOON[a.free_afternoon]) {
    const f = FREE_AFTERNOON[a.free_afternoon] as Effect & { pace?: number };
    apply({ a: f.a });
    if (typeof f.pace === 'number') {
      dials.pace = clampDial(dials.pace + f.pace);
      answered.add('pace');
    }
  }

  const camera = a.camera_roll && (ARCHETYPES as readonly string[]).includes(a.camera_roll) ? a.camera_roll : null;
  if (camera) scores[camera] += 2;

  for (const [k, v] of Object.entries(a.dial_overrides ?? {})) {
    if ((DIALS as readonly string[]).includes(k) && typeof v === 'number' && Number.isFinite(v)) {
      dials[k as DialKey] = clampDial(v);
      answered.add(k as DialKey);
    }
  }

  // Highest first. A tie is broken by the camera roll once it is answered,
  // then by how many of their interests point that way, then by the fixed
  // order above — so the same answers always give the same result.
  const order = [...ARCHETYPES].sort((x, y) =>
    (scores[y] - scores[x])
    || ((y === camera ? 1 : 0) - (x === camera ? 1 : 0))
    || (perInterest[y] - perInterest[x])
    || (ARCHETYPES.indexOf(x) - ARCHETYPES.indexOf(y)));

  const top = order[0];
  const primary = scores[top] > 0 ? top : null;
  const next = order[1];
  const secondary = primary && scores[next] > 0 && scores[next] >= 0.6 * scores[primary] ? next : null;

  return {
    primary,
    secondary,
    scores,
    dials,
    unanswered: DIALS.filter(d => !answered.has(d)),
    version: 3,
    computed_at: now.toISOString(),
  };
}

/**
 * A reveal nudge applied to a profile already computed — exactly what
 * scoreQuiz does with `dial_overrides`, and nothing more: the dial moves and
 * counts as answered, the scores and the result stay as they were.
 *
 * Before the migration the server keeps no answers, so it cannot rescore a
 * nudge from anything but the v2 columns, and that throws away the first
 * move, the plan, the restaurant and the 11pm answer the reveal is showing.
 * The reveal applies the nudge to the result it holds instead. After the
 * migration the server rescores, and this gives the same dials.
 */
export function applyDialOverride<P extends Pick<TravelerProfile, 'dials' | 'unanswered'>>(profile: P, dial: DialKey, value: number): P {
  if (!(DIALS as readonly string[]).includes(dial) || typeof value !== 'number' || !Number.isFinite(value)) return profile;
  return {
    ...profile,
    dials: { ...profile.dials, [dial]: clampDial(value) },
    unanswered: (profile.unanswered ?? []).filter(d => d !== dial),
  };
}

/**
 * The dials a set of answers speaks to. A nudge on the reveal corrects the
 * answer it sits on top of; answering that question again is a newer
 * correction, and the old nudge must give way to it rather than win forever.
 */
export function dialsSetBy(answers: QuizAnswers | null | undefined): DialKey[] {
  const a = answers ?? {};
  const out = new Set<DialKey>();
  const add = (e: Effect | undefined) => { for (const k of Object.keys(e?.d ?? {})) out.add(k as DialKey); };
  for (const k of picksOf(a.plan, PLAN)) add(PLAN[k]);
  for (const k of picksOf(a.restaurant, RESTAURANT)) add(RESTAURANT[k]);
  for (const k of picksOf(a.late, LATE)) add(LATE[k]);
  for (const k of picksOf(a.night_out, NIGHT_OUT)) add(NIGHT_OUT[k]);
  if (a.free_afternoon && typeof (FREE_AFTERNOON[a.free_afternoon] as { pace?: number })?.pace === 'number') out.add('pace');
  return DIALS.filter(d => out.has(d));
}

// ─── Plain words for a dial ──────────────────────────────────────────────

export const DIAL_COPY: Record<DialKey, { label: string; stops: [number, string][] }> = {
  pace: { label: 'Pace', stops: [[0, 'Wing it'], [25, 'Loose outline'], [50, 'Daily plan'], [75, 'Morning to night'], [100, 'Every hour']] },
  novelty: { label: 'Finds', stops: [[15, 'Tried-and-true'], [50, "Locals' spots"], [80, 'Off the beaten path'], [95, "Nobody's heard of it"]] },
  energy: { label: 'Nights', stops: [[15, 'Early night'], [45, 'One more drink'], [75, 'Next spot'], [95, 'Sunrise']] },
  crowd: { label: 'Crowd', stops: [[20, 'Small table'], [50, 'Buzzy room'], [80, 'Live show'], [95, 'Packed stadium']] },
};

/** The stop nearest a value: 62 on pace is "Morning to night". */
export function dialLabel(dial: DialKey, value: number): string {
  const stops = DIAL_COPY[dial].stops;
  let best = stops[0];
  for (const s of stops) if (Math.abs(s[0] - value) < Math.abs(best[0] - value)) best = s;
  return best[1];
}

/** "You're The Taster — with a side of Scout." */
export function headline(profile: Pick<TravelerProfile, 'primary' | 'secondary'> | null): string {
  if (!profile?.primary) return EVERYTHING_COPY.name;
  const main = `You're ${RESULT_COPY[profile.primary].name}`;
  return profile.secondary ? `${main} — with a side of ${RESULT_COPY[profile.secondary].short}` : main;
}

// ─── What a group may see ────────────────────────────────────────────────

/** The only part of a profile anybody else is ever shown. */
export interface PublicProfile {
  primary: ArchetypeKey | null;
  secondary: ArchetypeKey | null;
  dials: Record<DialKey, number>;
  unanswered: DialKey[];
}

/**
 * Built field by field, never by spreading. A spread of whatever object
 * arrived is how a dietary restriction ends up on somebody else's screen the
 * day somebody adds it to the profile "just for convenience".
 */
export function publicProfile(p: unknown): PublicProfile | null {
  if (!p || typeof p !== 'object') return null;
  const src = p as Record<string, unknown>;
  const key = (v: unknown): ArchetypeKey | null =>
    typeof v === 'string' && (ARCHETYPES as readonly string[]).includes(v) ? v as ArchetypeKey : null;
  const rawDials = (src.dials && typeof src.dials === 'object' ? src.dials : {}) as Record<string, unknown>;
  const dials = Object.fromEntries(DIALS.map(d => {
    const v = rawDials[d];
    return [d, typeof v === 'number' && Number.isFinite(v) ? clampDial(v) : 50];
  })) as Record<DialKey, number>;
  const unanswered = Array.isArray(src.unanswered)
    ? DIALS.filter(d => (src.unanswered as unknown[]).includes(d))
    : DIALS.filter(d => typeof rawDials[d] !== 'number');
  return { primary: key(src.primary), secondary: key(src.secondary), dials, unanswered };
}

// ─── The group mix card ──────────────────────────────────────────────────

export interface MixMember { id: string; name: string; profile: PublicProfile }
export interface GroupMix { members: MixMember[]; sentence: string | null }

/** Widest gap between two members who have both answered a dial. */
export function dialSpread(profiles: PublicProfile[], dial: DialKey): number | null {
  const vals = profiles.filter(p => !p.unanswered.includes(dial)).map(p => p.dials[dial]);
  if (vals.length < 2) return null;
  return Math.max(...vals) - Math.min(...vals);
}

/**
 * One sentence about how a group fits together, from a fixed table.
 *
 * Worded as a read of the group, never as something Reach will do: "we'll
 * leave one open afternoon" is a promise about the itinerary that nothing
 * checks, and CLAUDE.md is clear about promises nothing checks. Generation is
 * told the same facts (generationHints) and asked to act on them.
 *
 * Deliberately never mentions drinking. Somebody not drinking is not a fact
 * about them the group needs a sentence on.
 */
export function mixSentence(profiles: PublicProfile[]): string | null {
  if (profiles.length < 2) return null;
  const pace = dialSpread(profiles, 'pace');
  if (pace !== null && pace > 50) return 'Planners and wing-it types in one group. An open afternoon keeps both happy.';
  const tasters = profiles.filter(p => p.primary === 'taster').length;
  // More than half, not half: in a pair, one Taster is half the group, and
  // "the common thread" would be a claim about the other person too.
  if (tasters * 2 > profiles.length) return 'This group travels by stomach. Food is the common thread.';
  const energy = dialSpread(profiles, 'energy');
  if (energy !== null && energy > 50) return 'Early birds and night owls. Worth splitting the last night.';
  const novelty = dialSpread(profiles, 'novelty');
  if (novelty !== null && novelty > 50) return 'Some want the famous spot, some want the one nobody has found. Mix both.';
  const primaries = profiles.map(p => p.primary).filter((k): k is ArchetypeKey => !!k);
  if (primaries.length === profiles.length && new Set(primaries).size === 1) {
    return `A whole group of ${RESULT_COPY[primaries[0]].short}s. Easy to plan for.`;
  }
  return null;
}

/**
 * The card, from group_members rows as the mix route reads them.
 *
 * Takes whatever the rows hold and keeps only the public part, so even a
 * select that one day widens to `users(*)` cannot put a restriction on the
 * card. Needs two members who have finished; fewer is no card at all.
 */
export function mixFromRows(rows: unknown[]): GroupMix | null {
  const members: MixMember[] = [];
  for (const row of rows ?? []) {
    const u = (row as { users?: Record<string, unknown> } | null)?.users;
    if (!u || typeof u.id !== 'string') continue;
    // Finished means worked through: quiz_version is 3 only once the six
    // screens (or a v2 account's two taps) were answered. A drip answer or a
    // ✕ also writes a traveler_profile, scored from v2 interests, and that
    // person never took the quiz the card says they took.
    if (u.quiz_version !== 3) continue;
    const profile = publicProfile(u.traveler_profile);
    if (!profile) continue;
    const first = typeof u.name === 'string' ? u.name.trim().split(/\s+/)[0] : '';
    members.push({ id: u.id, name: first || 'Member', profile });
  }
  if (members.length < 2) return null;
  return { members, sentence: mixSentence(members.map(m => m.profile)) };
}

/**
 * The same facts, for trip generation. No names, no restrictions: what the
 * model writes is read by the whole group.
 */
export function generationHints(profiles: PublicProfile[], opts: { evening?: boolean } = {}): string[] {
  const out: string[] = [];
  // A night out is one evening. Days, afternoons and "the last night" are
  // words for a trip, and a model told to fill a day will fill one.
  const evening = !!opts.evening;
  const answered = (d: DialKey) => profiles.filter(p => !p.unanswered.includes(d)).map(p => p.dials[d]);
  const pace = answered('pace');
  if (pace.length) {
    const avg = pace.reduce((s, n) => s + n, 0) / pace.length;
    if (avg <= 30) out.push(evening
      ? 'They like to wing it: one or two fixed stops, room to drift.'
      : 'They like to wing it: keep each day light, two or three fixed things, room to wander.');
    else if (avg >= 70) out.push(evening
      ? 'They like a plan: give the evening a clear order of stops with times.'
      : 'They like a full plan: schedule each day from morning to night.');
  }
  const paceSpread = dialSpread(profiles, 'pace');
  if (paceSpread !== null && paceSpread > 50) out.push(evening
    ? 'Some like a plan and some wing it: fix the first stop and leave the rest loose.'
    : 'Some plan every hour and some wing it: leave one afternoon unscheduled.');
  const energySpread = dialSpread(profiles, 'energy');
  if (energySpread !== null && energySpread > 50) out.push(evening
    ? 'Early sleepers and night owls in one group: give the evening a natural point to head home before a later last stop.'
    : 'Early sleepers and late nights in one group: end one night early and let the last night run late.');
  const energy = answered('energy');
  if (energy.length && Math.max(...energy) <= 30) out.push('Nobody wants a late night: nothing after about 10pm.');
  const novelty = answered('novelty');
  if (novelty.length) {
    const avg = novelty.reduce((s, n) => s + n, 0) / novelty.length;
    if (avg >= 70) out.push('They prefer lesser-known local places over famous ones.');
    else if (avg <= 30) out.push('They prefer well-known, well-reviewed places.');
  }
  const tasters = profiles.filter(p => p.primary === 'taster').length;
  if (profiles.length && tasters * 2 > profiles.length) out.push(evening
    ? 'Food matters most to them: build the evening around a meal worth going out for.'
    : 'Food matters most to this group: build each day around a meal worth travelling for.');
  return out;
}

// ─── v2 answers carry over ───────────────────────────────────────────────

/** The v2 columns on users that the quiz reads and writes. */
export interface V2Columns {
  favorite_activities?: string[] | null;
  activity_vibe?: string[] | null;
  no_way_jose?: string[] | null;
  dietary_needs?: string | null;
  drink_style?: string | null;
  dining_vibe?: string | null;
  trip_summary?: string | null;
}

/**
 * What a v2 account already told us, in v3's shape. Section 7: nobody redoes
 * the quiz. Interests, drinks, seating, restrictions, hard nos and free text
 * all carry; the four questions v2 never asked are simply unanswered.
 */
export function answersFromV2(row: V2Columns | null | undefined): QuizAnswers {
  if (!row) return {};
  const out: QuizAnswers = {};
  const interests = strings(row.favorite_activities);
  if (interests.length) out.interests = interests;
  const nos = strings(row.no_way_jose).map(s => s.replace(/^custom:/, '').trim()).filter(Boolean);
  if (nos.length) out.dislikes = nos;
  const diet = typeof row.dietary_needs === 'string' ? row.dietary_needs.trim() : '';
  if (diet && diet.toLowerCase() !== 'none') {
    out.dietary = diet.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  }
  if (typeof row.drink_style === 'string' && row.drink_style.trim()) out.drinks = [row.drink_style.trim()];
  if (typeof row.dining_vibe === 'string' && row.dining_vibe.trim()) out.seating = [row.dining_vibe.trim()];
  if (typeof row.trip_summary === 'string' && row.trip_summary.trim()) out.free_interests = row.trip_summary.trim();
  return out;
}

/** Whether a v2 account answered anything the quiz could build on. */
export function hasV2Answers(row: V2Columns | null | undefined): boolean {
  return Object.keys(answersFromV2(row)).length > 0;
}

/**
 * The v2 columns a set of answers implies, so everything that already reads
 * them — Discover's taste, trip generation, the hard-no filter — keeps
 * working without learning about v3. Only the fields the answers actually
 * speak to are returned; anything else on the row is left alone.
 */
export function columnsFromAnswers(answers: QuizAnswers, existing: V2Columns | null | undefined): Partial<V2Columns> {
  const out: Partial<V2Columns> = {};
  if (Array.isArray(answers.interests)) {
    const chosen = strings(answers.interests);
    // The six interests that do not fit on this screen, and anything typed in
    // Profile, are kept: saving twelve tiles must not delete the rest.
    const kept = strings(existing?.favorite_activities)
      .filter(i => !(Q2_TILES as readonly string[]).includes(i) && !chosen.includes(i));
    out.favorite_activities = [...kept, ...chosen];
    // Trip generation reads this column for the same thing (see the v2 save).
    out.activity_vibe = out.favorite_activities;
  }
  // "Nothing — I eat everything" is about food. Heights, clubs and big
  // crowds are hard nos of a different kind, and a tap on the food button
  // must not quietly rule them back in.
  if (answers.eat_everything) {
    out.dietary_needs = 'none';
  } else if (Array.isArray(answers.dietary)) {
    const diet = strings(answers.dietary);
    out.dietary_needs = diet.length ? diet.join(', ') : 'none';
  }
  if (Array.isArray(answers.dislikes) || typeof answers.no_way_text === 'string') {
    const typed = typeof answers.no_way_text === 'string' ? answers.no_way_text.trim().slice(0, 120) : '';
    out.no_way_jose = strings([...(answers.dislikes ?? strings(existing?.no_way_jose)), ...(typed ? [typed] : [])]);
  }
  if (Array.isArray(answers.drinks)) {
    const d = strings(answers.drinks);
    // One column, one word. Not drinking wins over anything alongside it,
    // because it is the answer that rules things out.
    out.drink_style = d.includes(NOT_DRINKING) ? NOT_DRINKING : (d[0] ?? null);
  }
  if (Array.isArray(answers.seating)) out.dining_vibe = strings(answers.seating)[0] ?? null;
  return out;
}

/** Only "Not drinking" among their drinks. Suppresses bar-led suggestions. */
export function onlyNotDrinking(answers: QuizAnswers | null | undefined): boolean {
  const d = strings(answers?.drinks);
  return d.length > 0 && d.every(x => x === NOT_DRINKING);
}

/**
 * A finding built around a drink: a bar, pub, brewery, taproom, winery or
 * club, by what it calls itself. Discover drops these for somebody who said
 * "Not drinking" — from every source, not only the map's interest kinds,
 * because a harvested pub quiz or a ticketed brewery night is still a night
 * at a bar. A sushi, salad or juice bar is a place to eat, and stays.
 */
const BAR_LED = /\b(bars?|pubs?|brewer(y|ies)|brewpub|taproom|tap room|tavern|saloon|cocktails?|winer(y|ies)|wine tasting|nightclubs?|beer garden|beer hall|speakeasy)\b/i;
const NOT_A_DRINK_BAR = /\b(sushi|salad|juice|raw|oyster|snack|coffee|espresso|dessert|smoothie|nail|protein|candy|breakfast|salsa|taco|ramen|poke)\s+bars?\b/gi;
export function barLed(f: { title?: string | null; category?: string | null; venue?: string | null; meta?: string | null }): boolean {
  const hay = `${f.title ?? ''} ${f.category ?? ''} ${f.venue ?? ''}`.replace(NOT_A_DRINK_BAR, ' ');
  return BAR_LED.test(hay);
}

// ─── Ranking by the raw signals ──────────────────────────────────────────

/** What each archetype is looking for, read against a card's own words. */
const CHASES: Record<ArchetypeKey, RegExp> = {
  scout: /\b(new|opening|hidden|pop-?up|secret|underground|photograph|market)/i,
  storyteller: /\b(museum|histor|memorial|monument|galler|\bart\b|theat|tour|film|cinema|book|craft|potter|heritage)/i,
  thrill: /\b(outdoor|trail|hik|climb|surf|beach|kayak|water|rafting|zipline|bike|cycl|sport|nature|viewpoint)/i,
  recharger: /\b(spa|sauna|yoga|wellness|garden|park|beach|cafe|café|coffee|scenic|viewpoint|botanic)/i,
  taster: /\b(restaurant|food|eat|market|brewer|wine|winery|cooking|bakery|kitchen|taco|pizza|sushi|tasting|diner|bbq|barbecue)/i,
  spark: /\b(bar|pub|concert|live music|club|comedy|game|trivia|karaoke|festival|party|night|dance|dancing|stadium)/i,
};

/** The fields of a Discover finding this reads. Structural, so rank.ts can pass its own type. */
export interface Rankable { title?: string | null; category?: string | null; meta?: string | null; source?: string | null }

/**
 * How much a profile likes a card, in the same points rank() uses.
 *
 * Kept below rank()'s interest match (+40) on purpose: a profile shades the
 * order among things somebody might want, and never lifts something they did
 * not ask for over something they did.
 */
export function profileBoost(f: Rankable, profile: TravelerProfile | PublicProfile | null | undefined): number {
  if (!profile) return 0;
  const hay = `${f.title ?? ''} ${f.category ?? ''} ${f.meta ?? ''}`;
  let s = 0;
  const scores = (profile as TravelerProfile).scores;
  if (scores) {
    const max = Math.max(...ARCHETYPES.map(k => scores[k] || 0));
    if (max > 0) {
      let best = 0;
      for (const k of ARCHETYPES) if (CHASES[k].test(hay)) best = Math.max(best, (scores[k] || 0) / max);
      s += Math.round(best * 30);
    }
  } else if (profile.primary && CHASES[profile.primary].test(hay)) {
    s += 30;
  }
  const answered = (d: DialKey) => !profile.unanswered.includes(d);
  const held = f.source === 'osm' || f.source === 'harvest';
  const ticketed = f.source === 'ticketmaster';
  if (answered('novelty')) {
    // Somewhere nobody reviews is exactly what a high-novelty person wants,
    // and the map's own venues are the ones no review site has found.
    if (profile.dials.novelty >= 65 && held) s += 10;
    if (profile.dials.novelty <= 35 && (ticketed || f.source === 'yelp-places')) s += 10;
  }
  if (answered('crowd')) {
    if (profile.dials.crowd >= 70 && ticketed) s += 8;
    if (profile.dials.crowd <= 30 && ticketed) s -= 8;
  }
  if (answered('energy') && profile.dials.energy <= 30 && /\b(nightclub|club|late)\b/i.test(hay)) s -= 10;
  return s;
}

// ─── The reveal's "near you" cards ───────────────────────────────────────

/**
 * Sources whose places we hold ourselves: the map's venues in
 * discovery_venues, and what is on at them read off their own pages. The
 * same list the itinerary generator is allowed to name from. A listing from a
 * ticket or review site can be real and still not be ours to vouch for on a
 * screen that says "here's what that means near you".
 */
export const HELD_SOURCES = ['osm', 'harvest'] as const;

export function revealCards<T extends Rankable & { url?: string | null }>(
  findings: T[], profile: TravelerProfile | null | undefined, n = 3,
): T[] {
  return (findings ?? [])
    .filter(f => (HELD_SOURCES as readonly string[]).includes(String(f.source)) && !!f.title && !!f.url)
    .map((f, i) => ({ f, i, s: profileBoost(f, profile) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .slice(0, n)
    .map(x => x.f);
}

// ─── The share card ──────────────────────────────────────────────────────

/**
 * A result as a short code for a link: primary, secondary and the dials,
 * nothing else. There is nothing private in a profile to leak, and the code
 * carries no id — the page needs no account and no database to show it.
 */
export function shareCode(p: PublicProfile): string {
  const dial = (d: DialKey) => (p.unanswered.includes(d) ? 'x' : String(p.dials[d]));
  return [p.primary ?? 'none', p.secondary ?? 'none', ...DIALS.map(dial)].join('-');
}

export function fromShareCode(code: string | null | undefined): PublicProfile | null {
  if (typeof code !== 'string' || code.length > 80) return null;
  const parts = code.split('-');
  if (parts.length !== 2 + DIALS.length) return null;
  const key = (v: string): ArchetypeKey | null | undefined =>
    v === 'none' ? null : (ARCHETYPES as readonly string[]).includes(v) ? v as ArchetypeKey : undefined;
  const primary = key(parts[0]);
  const secondary = key(parts[1]);
  if (primary === undefined || secondary === undefined) return null;
  const dials = {} as Record<DialKey, number>;
  const unanswered: DialKey[] = [];
  for (const [i, d] of DIALS.entries()) {
    const raw = parts[2 + i];
    if (raw === 'x') { dials[d] = 50; unanswered.push(d); continue; }
    if (!/^\d{1,3}$/.test(raw)) return null;
    dials[d] = clampDial(Number(raw));
  }
  return { primary, secondary: primary ? secondary : null, dials, unanswered };
}
