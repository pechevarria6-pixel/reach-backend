// ─── Trips worth suggesting, from what we hold ──────────────────────────
// The owner asked for recommended trips on Home, and said the only way this
// app adds value is the recommendation itself. So the rule that governs
// every other screen governs this one more than most: Reach may only state
// what it has verified.
//
// A recommendation here is therefore not a model's idea of somewhere nice.
// It is a town we hold checked venues for, chosen by arithmetic over those
// venues and over what this person (and the people they plan with) told
// the quiz. Every sentence on the card is a count of rows we hold, a thing
// they said, or an estimate that says it is one. Nothing is written per page
// load by a model, so the same data gives the same three cards every time,
// and a card can always be traced back to the rows that put it there.
//
// Three shapes, because Reach is a night out as much as a fortnight away:
//
//   night    the held town nearest home, for an evening
//   weekend  a drive: forty to three hundred and fifty miles
//   away     further than that — a flight, the world list included
//
// A town with nothing held never appears. A town with a handful of rows is
// not a trip either (St. Augustine holds two), so there is a floor, and it
// is written down below rather than tuned by feel.
//
// Pure: no database, no network. lib/recommendations/holdings.ts reads the
// rows and app/api/recommendations/trips hands both to pickTrips().
import { vetoBreach } from '../vetoes.ts';
import { tasteFrom, type Profile } from '../discovery/taste.ts';
import { nameKey } from '../discovery/regions.ts';
import { DIALS, INTEREST_ARCHETYPE, publicProfile, type ArchetypeKey, type DialKey } from '../traveler-profile.ts';

// ─── The shapes ─────────────────────────────────────────────────────────

export type Band = 'night' | 'weekend' | 'away';

/** A town we might suggest: a seed, a Discover area, or the world list. */
export interface Candidate {
  /** Stable across loads: folded name and country. What a dismissal names. */
  key: string;
  name: string;
  /** ISO 3166-1 alpha-2 when we know it. */
  country: string | null;
  /** "Raleigh, North Carolina", "Paris, France" — what the Where step shows. */
  label: string;
  lat: number;
  lng: number;
  /** What people come for when it is a site outside the town (Machu Picchu). */
  site?: string | null;
  /** Euromonitor rank, for the world list's cities. */
  rank?: number | null;
  /**
   * Towns folded into this one because they read the same box (see
   * candidatesFrom). The counts are theirs as much as this town's, so the
   * card says so, and a person who lives in one of them is shown their own
   * town's name rather than the neighbour's.
   */
  aliases?: Place[];
}

/** One named town: what a card calls it and where it is. */
export interface Place { name: string; label: string; lat: number; lng: number }

/** A town somebody already has a plan for, as the plans row names it. */
export interface PlannedAt {
  /** "NC" from "Asheville, NC"; null when the row gave only the town. */
  area: string | null;
  /** plans.destination_country, when it was saved. */
  country: string | null;
}

/**
 * What we hold around a town, inside the same twenty-five mile box the
 * itinerary menu reads (real-places.ts). Counted per interest and per the
 * map's own kind, so a veto can take out the nightclubs filed under "live
 * music" without taking out the jazz bar.
 */
export interface Holdings {
  /**
   * "interest|kind" → rows, or "interest|kind|tags" when the venue's own
   * name says what the map's kind does not (see nameTags). Kind may be empty.
   */
  counts: Record<string, number>;
  /** The read stopped at its page limit, so every number is a floor. */
  floor: boolean;
}

/** One person's side of it, from the users row. */
export interface Taste extends Profile {
  budget_range?: string | null;
  /** users.traveler_profile (quiz v3), when the column exists and is filled. */
  traveler_profile?: unknown;
}

export interface Person {
  /** Where they are starting from. Null: nothing can be measured. */
  home: { lat: number; lng: number } | null;
  /** Their home country, when known, to tell a flight abroad from one at home. */
  homeCountry: string | null;
  homeAirport: string | null;
  me: Taste;
  /**
   * Who they plan with, when that is anybody: the group they most recently
   * made a plan in that has other people in it. Its members' answers shade
   * the ranking and every one of their vetoes counts.
   */
  group: {
    id: string; name: string; members: Taste[];
    /** The other members' names, as users.name holds them, in no set order. */
    names?: Array<string | null>;
  } | null;
  /** Towns they already have a plan for, by folded name (see plannedKeys). */
  planned: Planned;
  /** Candidate keys they said "not for me" to. */
  dismissed: Set<string>;
}

export interface TripPick {
  /** `trip:<candidate key>` — the recommendation_feedback item_ref. */
  ref: string;
  band: Band;
  /** The plan type CreatePlanFlow starts on. */
  planType: 'restaurant' | 'weekend' | 'trip';
  /**
   * What the plan's Where is set to. `city` is the name the geocoder is
   * handed (plans.destination_city), so it carries the state when we know
   * it: "Aberdeen, US" is South Dakota, and the card counted North Carolina.
   */
  destination: { city: string; country: string | null; label: string };
  site: string | null;
  /** 0 for an evening. */
  nights: number;
  miles: number;
  title: string;
  /** "For you" / "For you and Ali" / "For the five of you". */
  who: string;
  /** The facts: counts of what we hold there. */
  held: string;
  /** Which of their answers it matches, or null when none do. */
  matched: string | null;
  /** A veto that took something out of this town's numbers, said once. */
  leftOut: string | null;
  /** A no-go about the place that nothing we hold could check, said plainly. */
  unchecked: string | null;
  /**
   * A picture of the place, when one is held. Filled by the destination
   * photo work, never here: a card with no photo is a card without one,
   * not one with a stock picture of somewhere else.
   */
  photo?: { url: string; alt: string; credit: string | null } | null;
  howFar: string;
  cost: { low: number; high: number; each: boolean; label: string };
  cta: string;
  groupId: string | null;
  /** Deterministic score, for tests and logs. Not shown. */
  score: number;
}

// ─── The floor ──────────────────────────────────────────────────────────

/**
 * How much has to be held before a town is a suggestion rather than a gap
 * with a name on it. Twenty places, at least five of them to eat: enough to
 * fill an evening's menu for a night out, and a weekend's for anything
 * longer. A town under this still gets an honest itinerary if somebody asks
 * for it — it is just not something Reach puts forward.
 */
export const FLOOR = { total: 20, food: 5 } as const;

/** Distances, in miles as the crow flies. */
export const BANDS = {
  /** The night out: a held town this close counts as home. */
  nightMax: 30,
  /** Closer than this and it is not a weekend away, it is home. */
  weekendMin: 40,
  /** Roughly five and a half hours on the road. Past it, people fly. */
  weekendMax: 350,
} as const;

// ─── What the venue table's words mean on a card ────────────────────────

/** Interests that are a drink, for somebody not drinking. */
const ALCOHOL = new Set(['breweries', 'wine tasting', 'pubs', 'cocktail bars', 'drink']);

const isFood = (interest: string) =>
  interest === 'places to eat' || interest === 'food' || interest === 'markets & food halls'
  || interest === 'cooking' || interest === 'tacos'
  || / restaurants$/.test(interest)
  || /^(italian|mexican|japanese|seafood|barbecue|thai|indian|steak|veggie)$/.test(interest);

/** The noun a count reads as. Anything missing reads as "places for <interest>". */
const NOUN: Record<string, [string, string]> = {
  'places to eat': ['place to eat', 'places to eat'],
  'live music': ['live-music venue', 'live-music venues'],
  'breweries': ['brewery', 'breweries'],
  'wine tasting': ['wine shop or winery', 'wine shops and wineries'],
  'cocktail bars': ['cocktail bar', 'cocktail bars'],
  'pubs': ['pub', 'pubs'],
  'nightclubs': ['nightclub', 'nightclubs'],
  'museums & history': ['museum or historic site', 'museums and historic sites'],
  'art & galleries': ['gallery or arts centre', 'galleries and arts centres'],
  'outdoors': ['park or nature spot', 'parks and nature spots'],
  'gardens & parks': ['garden or zoo', 'gardens and zoos'],
  'markets & food halls': ['market', 'markets'],
  'comedy': ['comedy stage', 'comedy stages'],
  'film & theatre': ['cinema or theatre', 'cinemas and theatres'],
  // taste.ts files dancing schools and leisure=dance here, not nightclubs:
  // the rows are studios, so the card says studios.
  'dancing': ['dance studio', 'dance studios'],
  'books & talks': ['bookshop or library', 'bookshops and libraries'],
  'pottery & crafts': ['craft studio', 'craft studios'],
  'sport': ['sports centre', 'sports centres'],
  'wellness': ['spa or studio', 'spas and studios'],
  'trivia & board games': ['games shop', 'games shops'],
  'photography': ['photo shop or studio', 'photo shops and studios'],
  'cooking': ['cooking school', 'cooking schools'],
};

function noun(interest: string, n: number): string {
  const cuisine = /^(\w[\w\s]*?) restaurants$/i.exec(interest)?.[1];
  if (cuisine) {
    const c = cuisine.charAt(0).toUpperCase() + cuisine.slice(1);
    return n === 1 ? `${c} restaurant` : `${c} restaurants`;
  }
  const pair = NOUN[interest];
  if (pair) return n === 1 ? pair[0] : pair[1];
  return `places for ${interest}`;
}

/** What somebody said they are into, as they would say it back. */
// One word or two each, so three of them read as a list and not as
// "pottery and crafts and sport".
const SAID: Record<string, string> = {
  'places to eat': 'good food',
  'live music': 'live music',
  'museums & history': 'museums',
  'art & galleries': 'art',
  'outdoors': 'the outdoors',
  'gardens & parks': 'gardens',
  'markets & food halls': 'markets',
  'film & theatre': 'film and theatre',
  'books & talks': 'books',
  'pottery & crafts': 'pottery',
  'trivia & board games': 'trivia',
  'wine tasting': 'wine',
};
function said(interest: string): string {
  const cuisine = /^(\w[\w\s]*?) restaurants$/i.exec(interest)?.[1];
  if (cuisine) return `${cuisine.charAt(0).toUpperCase()}${cuisine.slice(1)} food`;
  return SAID[interest] ?? interest;
}

// ─── The quiz's six, without saying the word on screen ──────────────────
// Quiz v3 stores the result on users.traveler_profile, already blended when
// somebody picked more than one answer on a screen. It is read through
// lib/traveler-profile.ts's own parser (publicProfile), so this file does
// not keep a second idea of what a profile looks like. For an account that
// only ever answered v2, the same thing is worked out from the v2
// activities with the scorer's own chip-to-kind table (INTEREST_ARCHETYPE).

type Archetype = ArchetypeKey;
type Dial = DialKey;

/** INTEREST_ARCHETYPE, keyed the way favorite_activities is compared here. */
const V2_ARCHETYPE: Record<string, Archetype> = Object.fromEntries(
  Object.entries(INTEREST_ARCHETYPE).map(([chip, k]) => [chip.toLowerCase(), k]),
);

/** The interests (venue-table words) each kind of traveller is drawn to. */
const DRAWN_TO: Record<Archetype, (interest: string) => boolean> = {
  taster: i => isFood(i) || i === 'wine tasting' || i === 'breweries',
  storyteller: i => ['museums & history', 'art & galleries', 'books & talks', 'pottery & crafts', 'film & theatre', 'culture'].includes(i),
  thrill: i => ['outdoors', 'sport'].includes(i),
  recharger: i => ['wellness', 'gardens & parks', 'outdoors'].includes(i),
  spark: i => ['live music', 'comedy', 'dancing', 'nightclubs', 'pubs', 'cocktail bars'].includes(i),
  // A scout is drawn to the less obvious town, not to a kind of venue.
  scout: () => false,
};

export interface Leaning {
  primary: Archetype | null;
  secondary: Archetype | null;
  /** Only the dials somebody actually answered. */
  dials: Partial<Record<Dial, number>>;
}

/**
 * What kind of traveller the quiz says this is: v3's stored profile when it
 * is there and well formed, otherwise the v2 activities counted.
 */
export function leaningOf(t: Taste | null | undefined): Leaning {
  const raw = t?.traveler_profile as Record<string, unknown> | null | undefined;
  const p = publicProfile(raw);
  // A stored primary the scorer does not know is not a profile. A null one
  // is: it is how v3 says "a bit of everything".
  if (p && raw && (p.primary !== null || raw.primary === null)) {
    const stored = (raw.dials && typeof raw.dials === 'object' ? raw.dials : {}) as Record<string, unknown>;
    const dials: Partial<Record<Dial, number>> = {};
    for (const d of DIALS) {
      if (typeof stored[d] === 'number' && !p.unanswered.includes(d)) dials[d] = p.dials[d];
    }
    return { primary: p.primary, secondary: p.secondary, dials };
  }
  const counts = new Map<Archetype, number>();
  for (const a of t?.favorite_activities ?? []) {
    const k = V2_ARCHETYPE[String(a).trim().toLowerCase()];
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const primary = ranked[0]?.[0] ?? null;
  // Same rule as v3: a second only when it is most of the way to the first.
  const secondary = ranked[1] && ranked[1][1] >= 0.6 * ranked[0][1] ? ranked[1][0] : null;
  return { primary, secondary, dials: {} };
}

// ─── Vetoes ─────────────────────────────────────────────────────────────

/** Every hard no that counts: the person's and, for a group, every member's. */
export function vetoesOf(person: Pick<Person, 'me' | 'group'>): string[] {
  const all = [person.me, ...(person.group?.members ?? [])]
    .flatMap(t => (Array.isArray(t?.no_way_jose) ? t!.no_way_jose! : []))
    .map(v => String(v || '').trim()).filter(Boolean);
  return [...new Set(all)];
}

/** Somebody going is not drinking, so nothing is chosen for its bars. */
function anyoneSober(person: Pick<Person, 'me' | 'group'>): boolean {
  return [person.me, ...(person.group?.members ?? [])].some(isSober);
}
function isSober(t: Taste | null | undefined): boolean {
  return String(t?.drink_style ?? '').trim().toLowerCase() === 'not drinking';
}

/**
 * Whether a held row is ruled out by a veto: its own words break one
 * ("seafood restaurants" for a seafood veto, a "nightclub" for clubs), or
 * it is a drink for a party with somebody sober in it, or a nightclub for
 * somebody who said no to loud rooms.
 */
export function vetoedRow(interest: string, kind: string, vetoes: string[], sober: boolean, tags = ''): boolean {
  return !!whyVetoed(interest, kind, vetoes, sober, tags);
}

/**
 * What the map's kinds do not say but a venue's own name does. OSM files a
 * karaoke bar as amenity=nightclub, so "Novabox Karaoke" is a live-music
 * nightclub to the table, and a Karaoke no-go (one of the quiz's own chips)
 * could never find it by interest and kind alone. holdings.ts reads each
 * row's name through this and keeps the tag on the count's key.
 */
const NAME_TAGS: Array<{ re: RegExp; tag: string; noun: string }> = [
  { re: /\bkaraoke\b/i, tag: 'karaoke', noun: 'karaoke bars' },
];

export function nameTags(name: string | null | undefined): string[] {
  const n = String(name ?? '');
  return NAME_TAGS.filter(t => t.re.test(n)).map(t => t.tag);
}

/**
 * Why a row is out, as the card would name what went: "nightclubs",
 * "karaoke bars", "seafood restaurants" — or "bars" when it is out only
 * because somebody going is not drinking. Null: it stays.
 */
export function whyVetoed(interest: string, kind: string, vetoes: string[], sober: boolean, tags = ''): string | null {
  const low = vetoes.map(v => v.toLowerCase());
  if ((low.includes('clubs') || low.includes('loud rooms') || low.includes('loud'))
    && (interest === 'nightclubs' || kind === 'nightclub')) return 'nightclubs';
  const own = vetoBreach(`${interest} ${kind}`.trim(), vetoes);
  // Named for whichever word broke it: a "seafood" no-go took out seafood
  // restaurants; a no-go that matched the kind "nightclub" took nightclubs.
  if (own) return !vetoBreach(interest, vetoes) && kind === 'nightclub' ? 'nightclubs' : noun(interest, 2);
  if (tags && vetoBreach(tags, vetoes)) {
    const hit = NAME_TAGS.find(t => tags.split(/\s+/).includes(t.tag) && vetoBreach(t.tag, vetoes));
    return hit ? hit.noun : noun(interest, 2);
  }
  if (sober && ALCOHOL.has(interest)) return 'bars';
  return null;
}

// A no-go is one of three things here, and the card has to be honest about
// which:
//
//   about a venue     clubs, loud rooms, camping, karaoke, a typed word.
//                     Checked against every row's interest and kind, and
//                     its name for what the kinds cannot say (nameTags:
//                     karaoke), and said on the card when it took something
//                     out (leftOut). A typed word that names neither a kind
//                     nor a tag finds nothing, and nothing claims it did.
//   about getting     long flights. Checked from the one thing we do hold,
//   there             the distance: nothing further than LONG_FLIGHT_MILES
//                     is offered as a flight, and the card says so.
//   about the place   cold weather, extreme heat, big crowds. We hold no
//                     weather and no crowd data, so these cannot be
//                     checked, and the card says that plainly (unchecked)
//                     rather than letting "No nightclubs" read as if every
//                     no-go had been honoured.
//
// Everything else (early mornings, spicy food, heights) is about what the
// plan does, not which town it is in. It goes to the itinerary with the
// rest of their answers, and no card here claims it.

/** Past this, a flight is a long one. About four hours in the air. */
export const LONG_FLIGHT_MILES = 1500;

const LONG_FLIGHTS = /^(long ?flights|longflights)$/i;

const UNCHECKABLE: Array<{ re: RegExp; said: string; lacks: 'weather' | 'crowd' }> = [
  { re: /^(cold ?weather|coldweather|cold)$/i, said: 'cold weather', lacks: 'weather' },
  { re: /^(extreme heat|heat)$/i, said: 'extreme heat', lacks: 'weather' },
  { re: /^(big crowds|crowds|crowded)$/i, said: 'big crowds', lacks: 'crowd' },
];

const bare = (v: string) => String(v || '').replace(/^custom:/, '').trim();

export function refusesLongFlights(vetoes: string[]): boolean {
  return vetoes.some(v => LONG_FLIGHTS.test(bare(v)));
}

/** The no-gos about a place that nothing we hold can check, as said on a card. */
export function uncheckedVetoes(vetoes: string[]): Array<{ said: string; lacks: 'weather' | 'crowd' }> {
  const out: Array<{ said: string; lacks: 'weather' | 'crowd' }> = [];
  for (const v of vetoes) {
    const u = UNCHECKABLE.find(x => x.re.test(bare(v)));
    if (u && !out.some(o => o.said === u.said)) out.push({ said: u.said, lacks: u.lacks });
  }
  return out;
}

/**
 * Said on a drive or a flight when a no-go could not be checked. Not on a
 * night out: that is the town they already live in, and the evening's own
 * plan is where a crowd is avoided.
 */
export function uncheckedLine(mine: string[], others: string[] = []): string | null {
  const own = uncheckedVetoes(mine);
  const theirs = uncheckedVetoes(others).filter(u => !own.some(o => o.said === u.said));
  const say = (u: typeof own, who: string) => {
    if (!u.length) return null;
    const what = listOf(u.map(x => x.said));
    const lacks = listOf([...new Set(u.map(x => x.lacks))], 'or');
    // Worded to stand for every drive and flight at once, because Home says
    // it once above the row rather than on each card (the redundancy rule).
    return `${who} ${what}. Reach doesn't hold ${lacks} data yet, so trips away aren't checked for ${u.length > 1 ? 'them' : 'it'}.`;
  };
  return [say(own, 'You ruled out'), say(theirs, 'Somebody in the group ruled out')].filter(Boolean).join(' ') || null;
}

// ─── Counting what a town holds, for one party ──────────────────────────

export interface Tally {
  total: number;
  food: number;
  byInterest: Map<string, number>;
  /** Rows a veto took out, by interest — said on the card, never counted. */
  removed: Map<string, number>;
  /** The same rows, by what the card calls them ("nightclubs", "karaoke bars"). */
  removedAs: Map<string, number>;
  /** Of those, the rows out only because somebody going is not drinking. */
  sober: number;
  floor: boolean;
}

export function tally(h: Holdings, vetoes: string[], sober: boolean): Tally {
  const byInterest = new Map<string, number>();
  const removed = new Map<string, number>();
  const removedAs = new Map<string, number>();
  let total = 0, food = 0, soberOut = 0;
  for (const [key, n] of Object.entries(h.counts ?? {})) {
    if (!(n > 0)) continue;
    const [interest, kind = '', tags = ''] = key.split('|');
    if (!interest || interest === 'places to stay') continue;
    const why = whyVetoed(interest, kind, vetoes, sober, tags);
    if (why) {
      // "bars" is only ever the answer when no no-go took the row first.
      if (why === 'bars') soberOut += n;
      else {
        removed.set(interest, (removed.get(interest) ?? 0) + n);
        removedAs.set(why, (removedAs.get(why) ?? 0) + n);
      }
      continue;
    }
    byInterest.set(interest, (byInterest.get(interest) ?? 0) + n);
    total += n;
    if (isFood(interest)) food += n;
  }
  return { total, food, byInterest, removed, removedAs, sober: soberOut, floor: !!h.floor };
}

/** Held well enough to put forward. */
export function clearsFloor(t: Tally): boolean {
  return t.total >= FLOOR.total && t.food >= FLOOR.food;
}

// ─── Distance ───────────────────────────────────────────────────────────

export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function bandFor(miles: number): Band | null {
  if (miles <= BANDS.nightMax) return 'night';
  if (miles >= BANDS.weekendMin && miles <= BANDS.weekendMax) return 'weekend';
  if (miles > BANDS.weekendMax) return 'away';
  // Between thirty and forty miles: too far to call home for an evening's
  // menu, too close to be a weekend away. Not suggested as either.
  return null;
}

// ─── Money, as an estimate and never as a price ─────────────────────────
// Nobody has priced anything when Home draws. These are sums of round
// figures scaled by what the person said a normal night out costs them,
// shown as a range and labelled as an estimate on the card itself. The
// trip's own screen quotes real flights and rooms once there are dates.

type Tier = 'under50' | '50to100' | '100to200' | '200to400' | 'over400' | null;

/** The quiz stores the chip's words ("$50 – $100"). */
export function tierOf(budget: string | null | undefined): Tier {
  const s = String(budget ?? '').toLowerCase().replace(/[,\s]/g, '');
  if (!s || s.includes('depends')) return null;
  if (s.includes('under')) return 'under50';
  if (s.includes('400+') || s.startsWith('$400') || s.includes('over400')) return 'over400';
  if (s.includes('200') && s.includes('400')) return '200to400';
  if (s.includes('100') && s.includes('200')) return '100to200';
  if (s.includes('50') && s.includes('100')) return '50to100';
  return null;
}

const NIGHT_RANGE: Record<Exclude<Tier, null> | 'none', [number, number]> = {
  under50: [25, 50], '50to100': [50, 100], '100to200': [100, 200],
  '200to400': [200, 400], over400: [400, 600], none: [40, 90],
};
const ROOM_NIGHT: Record<Exclude<Tier, null> | 'none', number> = {
  under50: 110, '50to100': 150, '100to200': 210, '200to400': 320, over400: 500, none: 170,
};
/**
 * The most a trip is suggested at, per person, for each budget. A budget
 * is respected by not putting a fortnight in Tokyo in front of somebody who
 * said a night out is under fifty dollars — not by pretending it is cheap.
 */
const TRIP_CEILING: Record<Exclude<Tier, null> | 'none', number> = {
  under50: 900, '50to100': 1600, '100to200': 2600, '200to400': 4200, over400: Infinity, none: 2600,
};

/** The tightest budget in the party. A group can go only as far as its tightest. */
export function partyTier(person: Pick<Person, 'me' | 'group'>): Tier {
  const order: Exclude<Tier, null>[] = ['under50', '50to100', '100to200', '200to400', 'over400'];
  const tiers = [person.me, ...(person.group?.members ?? [])].map(t => tierOf(t?.budget_range)).filter((t): t is Exclude<Tier, null> => !!t);
  if (!tiers.length) return null;
  return order[Math.min(...tiers.map(t => order.indexOf(t)))];
}

const roundTo = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);

export function estimate(opts: {
  band: Band; miles: number; nights: number; party: number; tier: Tier; abroad: boolean;
}): { low: number; high: number } {
  const t = opts.tier ?? 'none';
  const [nLow, nHigh] = NIGHT_RANGE[t];
  if (opts.band === 'night') return { low: nLow, high: nHigh };
  const party = Math.max(1, opts.party);
  const rooms = Math.ceil(party / 2);
  const stay = (ROOM_NIGHT[t] * rooms * opts.nights) / party;
  const days = opts.nights + 1;
  const food = ((nLow + nHigh) / 2) * 1.3 * days;
  const getThere = opts.band === 'weekend'
    // Fuel both ways, one car for up to four.
    ? (opts.miles * 1.25 * 2 * 0.15) / Math.min(party, 4)
    : opts.abroad
      ? Math.min(1600, Math.max(600, 400 + opts.miles * 0.08))
      : Math.min(600, Math.max(200, 150 + opts.miles * 0.1));
  const sum = stay + food + getThere;
  const step = sum > 1000 ? 50 : 10;
  return { low: roundTo(sum * 0.85, step), high: roundTo(sum * 1.25, step) };
}

// ─── Words ──────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString('en-US');
function listOf(items: string[], joiner = 'and'): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${joiner} ${items[items.length - 1]}`;
}
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/**
 * Who a card is for. Never the group's own name: people name a group for an
 * occasion ("Ali and Pete, go to St. Augustine", "30th bday", "Dinner"), and
 * that name over a weekend in Washington contradicts the card it sits on.
 * The people are what does not change, so up to two are named, and a bigger
 * group is counted.
 */
export function whoFor(group: Person['group']): string {
  if (!group) return 'For you';
  const n = group.members.length + 1;
  const first = (s: string | null | undefined) => {
    const w = String(s ?? '').trim().split(/\s+/)[0] ?? '';
    return w && !w.includes('@') ? w : '';
  };
  const names = (group.names ?? []).map(first).filter(Boolean).sort((a, b) => a.localeCompare(b));
  if (group.members.length <= 2 && names.length === group.members.length && names.length) {
    return `For ${listOf(['you', ...names])}`;
  }
  return `For the ${NUMBER_WORDS[n] ?? n} of you`;
}

function howFarFor(band: Band, miles: number, airport: string | null): string {
  if (band === 'night') return miles < 3 ? 'Where you are' : `${fmt(Math.round(miles))} miles from you`;
  const m = fmt(Math.round(miles / 10) * 10);
  if (band === 'weekend') {
    // Roads are longer than the crow flies; a fifth longer at sixty an hour
    // is a plain estimate and is worded as one ("about").
    const hours = (miles * 1.2) / 60;
    const half = Math.round(hours * 2) / 2;
    const said = half < 1 ? 'under an hour' : `about ${half % 1 ? `${Math.floor(half)}½` : half} hour${half > 1 ? 's' : ''}`;
    return `${m} miles — ${said} by car`;
  }
  return airport ? `${m} miles — a flight from ${airport}` : `${m} miles — a flight away`;
}

function titleFor(band: Band, c: Candidate, nights: number): string {
  if (band === 'night') return `A night out in ${c.name}`;
  if (band === 'weekend') return `A weekend in ${c.name}`;
  if (c.site) return `${nights} nights in ${c.name}, for ${c.site}`;
  return `${nights} nights in ${c.name}`;
}

const CTA: Record<Band, string> = { night: 'Plan the night →', weekend: 'Plan the weekend →', away: 'Plan this trip →' };
const PLAN_TYPE: Record<Band, TripPick['planType']> = { night: 'restaurant', weekend: 'weekend', away: 'trip' };

/**
 * The facts line: what we hold, as counts. Food first because every one of
 * these has a dinner in it, then the two biggest things they are into that
 * the town actually has, then anything else worth a mention.
 */
export function heldLine(t: Tally, interests: string[], around: string[] = []): string {
  const plus = t.floor ? '+' : '';
  const parts: string[] = [];
  const used = new Set<string>();
  const eat = t.byInterest.get('places to eat') ?? 0;
  if (t.food > 0) {
    parts.push(`${fmt(t.food)}${plus} ${t.food === 1 ? 'place to eat' : 'places to eat'}`);
    for (const [i] of t.byInterest) if (isFood(i)) used.add(i);
  } else if (eat) used.add('places to eat');
  for (const i of interests) {
    if (parts.length >= 3) break;
    if (used.has(i)) continue;
    const n = t.byInterest.get(i) ?? 0;
    if (!n) continue;
    used.add(i);
    parts.push(`${fmt(n)}${plus} ${noun(i, n)}`);
  }
  // Nothing they asked for beyond food: say the town's next biggest thing,
  // so the line is not only restaurants.
  if (parts.length < 2) {
    const next = [...t.byInterest.entries()].filter(([i]) => !used.has(i)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (next) parts.push(`${fmt(next[1])}${plus} ${noun(next[0], next[1])}`);
  }
  // Towns folded into one box share its counts: "around Aberdeen and
  // Southern Pines", not a small town credited with its neighbour's dinners.
  const where = around.length > 1 ? ` around ${listOf(around.slice(0, 3))}` : '';
  return `${listOf(parts)} we've checked${where}`;
}

export function matchedLine(matched: string[], group: boolean): string | null {
  if (!matched.length) return null;
  const shown = matched.slice(0, 3).map(said);
  const words = listOf(shown);
  // "Breweries come up", "live music comes up".
  const plural = shown.length > 1
    || !/^(the outdoors|live music|comedy|dancing|sport|wine|art|trivia|pottery|cooking|wellness|photography|[\w ]+ food)$/i.test(shown[0]);
  return group
    ? `${words.charAt(0).toUpperCase() + words.slice(1)} come${plural ? '' : 's'} up in your group's answers.`
    : `You said you're into ${words}.`;
}

/**
 * What a veto took out, said once. Only ever about the person reading it
 * (their own no-go, their own not drinking), or about "somebody in the
 * group" when there are enough others that it names nobody — see
 * othersMaySpeak. Somebody else not drinking is never said at all: it is
 * not a fact about them the group needs a sentence on (mixSentence).
 */
export function leftOutLine(t: Tally, whose: 'mine' | 'theirs', except: Map<string, number> = new Map()): string | null {
  const top = [...t.removedAs.entries()].filter(([w]) => !except.has(w))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (!top) {
    if (!t.sober || whose === 'theirs') return null;
    return "Picked without the bars, since you're not drinking.";
  }
  return whose === 'theirs'
    ? `No ${top[0]} — somebody in the group ruled them out.`
    : `No ${top[0]}, as you asked.`;
}

/**
 * Whether a line may speak of the others' answers at all. "Somebody in the
 * group" hides who only when there are two or more somebodies: in a pair it
 * is the other person by name. Their no-gos are applied either way; they
 * are just not said back.
 */
export function othersMaySpeak(group: Person['group']): boolean {
  return (group?.members.length ?? 0) >= 2;
}

// ─── Candidates ─────────────────────────────────────────────────────────

/** US states and territories by Geofabrik path segment, for labels. */
const US_STATE_NAME: Record<string, string> = {
  'alabama': 'Alabama', 'alaska': 'Alaska', 'arizona': 'Arizona', 'arkansas': 'Arkansas',
  'california': 'California', 'colorado': 'Colorado', 'connecticut': 'Connecticut',
  'delaware': 'Delaware', 'district-of-columbia': 'DC', 'florida': 'Florida', 'georgia': 'Georgia',
  'hawaii': 'Hawaii', 'idaho': 'Idaho', 'illinois': 'Illinois', 'indiana': 'Indiana', 'iowa': 'Iowa',
  'kansas': 'Kansas', 'kentucky': 'Kentucky', 'louisiana': 'Louisiana', 'maine': 'Maine',
  'maryland': 'Maryland', 'massachusetts': 'Massachusetts', 'michigan': 'Michigan',
  'minnesota': 'Minnesota', 'mississippi': 'Mississippi', 'missouri': 'Missouri', 'montana': 'Montana',
  'nebraska': 'Nebraska', 'nevada': 'Nevada', 'new-hampshire': 'New Hampshire', 'new-jersey': 'New Jersey',
  'new-mexico': 'New Mexico', 'new-york': 'New York', 'north-carolina': 'North Carolina',
  'north-dakota': 'North Dakota', 'ohio': 'Ohio', 'oklahoma': 'Oklahoma', 'oregon': 'Oregon',
  'pennsylvania': 'Pennsylvania', 'rhode-island': 'Rhode Island', 'south-carolina': 'South Carolina',
  'south-dakota': 'South Dakota', 'tennessee': 'Tennessee', 'texas': 'Texas', 'utah': 'Utah',
  'vermont': 'Vermont', 'virginia': 'Virginia', 'washington': 'Washington', 'west-virginia': 'West Virginia',
  'wisconsin': 'Wisconsin', 'wyoming': 'Wyoming', 'puerto-rico': 'Puerto Rico', 'us-virgin-islands': 'US Virgin Islands',
};

/** A country's English name, from the runtime's own table. */
function countryName(cc: string): string {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(cc) ?? cc; } catch { return cc; }
}

/** Where a Geofabrik path is: its country and how a label names it. */
export function placeOfRegion(region: string | null | undefined): { country: string | null; area: string | null } {
  const r = String(region || '');
  const us = /^north-america\/us\/([a-z-]+)$/.exec(r);
  if (us) {
    if (us[1] === 'puerto-rico') return { country: 'PR', area: 'Puerto Rico' };
    if (us[1] === 'us-virgin-islands') return { country: 'VI', area: 'US Virgin Islands' };
    return { country: 'US', area: US_STATE_NAME[us[1]] ?? null };
  }
  if (r.startsWith('europe/united-kingdom')) return { country: 'GB', area: 'United Kingdom' };
  if (r === 'north-america/mexico') return { country: 'MX', area: 'Mexico' };
  if (r === 'central-america/bahamas') return { country: 'BS', area: 'Bahamas' };
  return { country: null, area: null };
}

/**
 * Not a town. A county, a whole state or territory, an airport code left in
 * discovery_areas by a search, or no name at all. Each of these is in the
 * live table today, and none of them is somewhere to go for the weekend.
 */
export function notATown(name: string | null | undefined): boolean {
  const n = String(name ?? '').trim();
  if (!n || n.length < 3 || /^null$/i.test(n)) return true;
  if (/^[A-Z]{3}$/.test(n)) return true;
  if (/\b(county|parish|borough of|province|region|state)\b/i.test(n)) return true;
  const folded = nameKey(n);
  return Object.values(US_STATE_NAME).some(s => nameKey(s) === folded && folded !== 'washington');
}

/**
 * A candidate's key: folded name, country, and the US state when one is
 * known — "portland|US|oregon", "paris|FR". The holdings cache and a
 * dismissal both go by it, so two towns sharing one would share their
 * counts and their "not for me" (Portland, Maine and Portland, Oregon;
 * Fayetteville NC and AR). candidatesFrom adds the point as a last resort
 * when even that is not enough.
 */
export function candidateKey(name: string, country: string | null, state: string | null = null): string {
  const base = `${nameKey(name)}|${String(country ?? '').toUpperCase()}`;
  return state ? `${base}|${nameKey(state)}` : base;
}

/** A US state's name from a postal code or the name itself; null for anything else. */
function usStateOf(s: string | null | undefined): string | null {
  const t = String(s ?? '').trim();
  if (!t) return null;
  if (/^[A-Za-z]{2}$/.test(t)) return US_CODE[t.toUpperCase()] ?? null;
  const k = nameKey(t);
  return Object.values(US_CODE).find(v => nameKey(v) === k) ?? null;
}

/**
 * Every town we might suggest, once each.
 *
 * World destinations first (they know their country and site), then seeds
 * (which know their region), then Discover's areas (which know only a
 * point). A later source is dropped when an earlier one already has a town
 * of that name within fifteen miles, or any town within five — Southern
 * Pines and Aberdeen, NC read the same box and are one suggestion, not two.
 */
export function candidatesFrom(input: {
  world: Array<{ name: string; country: string; lat: number; lng: number; site?: string; rank?: number }>;
  seeds: Array<{ name: string | null; lat: number | null; lng: number | null; region: string | null }>;
  areas: Array<{ city: string | null; lat: number | null; lng: number | null }>;
}): Candidate[] {
  const out: Candidate[] = [];
  // Everything seen, kept or not, so a town dropped for sitting beside
  // another still claims its own name: the area "Southern Pines, NC" must
  // not come back in after the seed Southern Pines was folded into Aberdeen.
  // Each remembers which kept town it was folded into, so that town can say
  // whose counts it is carrying.
  const seen: Array<{ name: string; lat: number; lng: number; country: string | null; into: Candidate | null }> = [];
  const near = (a: { lat: number; lng: number }, name: string) => seen.find(c => {
    const d = milesBetween(a, c);
    return d <= 5 || (d <= 15 && nameKey(c.name) === nameKey(name));
  });
  const keys = new Set<string>();
  const push = (c: Omit<Candidate, 'key'>, state: string | null = null) => {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng) || (Math.abs(c.lat) < 0.01 && Math.abs(c.lng) < 0.01)) return;
    if (notATown(c.name)) return;
    const dup = near(c, c.name);
    if (dup) {
      const into = dup.into;
      seen.push({ name: c.name, lat: c.lat, lng: c.lng, country: c.country, into });
      const known = into && [into.name, ...(into.aliases ?? []).map(a => a.name)].some(n => nameKey(n) === nameKey(c.name));
      if (into && !known) (into.aliases ??= []).push({ name: c.name, label: c.label, lat: c.lat, lng: c.lng });
      return;
    }
    let key = candidateKey(c.name, c.country, c.country === 'US' ? state : null);
    // Two towns of one name with nothing to tell them apart: the point does.
    if (keys.has(key)) key = `${key}@${c.lat.toFixed(2)},${c.lng.toFixed(2)}`;
    keys.add(key);
    const kept: Candidate = { ...c, key };
    out.push(kept);
    seen.push({ name: c.name, lat: c.lat, lng: c.lng, country: c.country, into: kept });
  };
  /** An area knows only its point; the nearest placed town within thirty miles says which country. */
  const countryNear = (a: { lat: number; lng: number }) =>
    seen.filter(s => s.country).map(s => ({ s, d: milesBetween(a, s) })).filter(x => x.d <= 30)
      .sort((x, y) => x.d - y.d)[0]?.s.country ?? null;
  for (const w of input.world ?? []) {
    push({ name: w.name, country: w.country, label: `${w.name}, ${countryName(w.country)}`, lat: w.lat, lng: w.lng, site: w.site ?? null, rank: w.rank ?? null });
  }
  for (const s of input.seeds ?? []) {
    const name = String(s.name ?? '').split(',')[0].trim();
    const where = placeOfRegion(s.region);
    push({
      name, country: where.country,
      label: where.area && where.area !== name ? `${name}, ${where.area}` : name,
      lat: Number(s.lat), lng: Number(s.lng),
    }, where.country === 'US' ? where.area : null);
  }
  for (const a of input.areas ?? []) {
    const [name, ...rest] = String(a.city ?? '').split(',').map(x => x.trim());
    const at = { lat: Number(a.lat), lng: Number(a.lng) };
    // "Fayetteville, AR" says its own country when no placed town is near.
    const state = usStateOf(rest[0]);
    push({ name, country: countryNear(at) ?? (state ? 'US' : null), label: [name, ...rest].filter(Boolean).join(', '), ...at }, state);
  }
  return out;
}

/** Towns with a plan, by folded name. A name can be more than one town. */
export type Planned = { trips: Map<string, PlannedAt[]>; nights: Map<string, PlannedAt[]> };

/**
 * The towns somebody already has a plan for, folded.
 *
 * A trip anywhere — coming up or already taken — rules that town out as a
 * trip: it is planned, or they have been. A night out is different. The
 * town they live in is somewhere to go out every Friday, so only an evening
 * still to come there rules out suggesting another one. A cancelled plan is
 * neither: calling something off is not the same as having done it.
 *
 * Kept with whatever the row says about which town it means ("Portland,
 * ME", the country), because a name alone is not a town: a plan in
 * Portland, Maine is not a trip to Portland, Oregon (see isPlanned).
 */
export function plannedKeys(
  plans: Array<{ destination_city?: string | null; destination_country?: string | null; status?: string | null; type?: string | null; start_date?: string | null }>,
  todayISO: string,
): Planned {
  const trips = new Map<string, PlannedAt[]>(), nights = new Map<string, PlannedAt[]>();
  const add = (m: Map<string, PlannedAt[]>, k: string, at: PlannedAt) => m.set(k, [...(m.get(k) ?? []), at]);
  for (const p of plans ?? []) {
    if (p.status === 'cancelled') continue;
    const [town, area] = String(p.destination_city ?? '').split(',').map(x => x.trim());
    if (!town) continue;
    // Only an ISO code is compared; "USA" or "United States" is read as not
    // saying, which errs towards hiding rather than repeating.
    const cc = String(p.destination_country ?? '').trim().toUpperCase();
    const at: PlannedAt = { area: area || null, country: /^[A-Z]{2}$/.test(cc) ? cc : null };
    const evening = p.type === 'restaurant' || p.type === 'concert';
    if (!evening) add(trips, nameKey(town), at);
    else if (p.status !== 'completed' && (!p.start_date || String(p.start_date) >= todayISO)) add(nights, nameKey(town), at);
  }
  return { trips, nights };
}

/** US state postal codes, for telling "Portland, ME" from "Portland, Oregon". */
const US_CODE: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'DC', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine',
  MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico', VI: 'US Virgin Islands',
};
const areaKey = (a: string) => {
  const t = a.trim();
  return nameKey(US_CODE[t.toUpperCase()] && /^[A-Za-z]{2}$/.test(t) ? US_CODE[t.toUpperCase()] : t);
};

/**
 * Whether a plan row means this town. The name has to match; then the
 * country, when both sides know one; then the state or region, when both
 * sides say one. A row that gives only "Portland" cannot be told apart and
 * is taken to mean it — hiding a card is the smaller mistake than offering
 * somebody the trip they already have.
 */
export function isPlanned(list: Map<string, PlannedAt[]>, place: Place, country: string | null): boolean {
  const rows = list.get(nameKey(place.name));
  if (!rows?.length) return false;
  // What the label says beyond the name: a state, a region, a country.
  // Only a label that says one can rule a row out by it.
  const areas = place.label.split(',').slice(1).map(areaKey).filter(Boolean);
  if (areas.length && country) areas.push(nameKey(countryName(country)));
  return rows.some(r => {
    if (r.country && country && homeSide(r.country) !== homeSide(country)) return false;
    if (!r.area || !areas.length) return true;
    return areas.includes(areaKey(r.area));
  });
}

/**
 * The town somebody's home_city names, from the towns we already know,
 * without a lookup. users.home_city is "Pittsburgh, Pennsylvania" or
 * "Aberdeen, Scotland": everything after the town has to agree with the
 * candidate too, or "Athens, Georgia" is placed in Greece and "Aberdeen,
 * South Dakota" in North Carolina. Null when nothing agrees, or more than
 * one town does — the geocoder is asked instead, with the whole string.
 */
export function homeTownOf(homeCity: string, candidates: Candidate[]): Place | null {
  const [town, ...rest] = String(homeCity || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!town) return null;
  const said = rest.map(areaKey);
  const named = candidates.flatMap(c => placesOf(c).map(p => ({ p, c })))
    .filter(x => nameKey(x.p.name) === nameKey(town));
  const fits = !said.length ? named : named.filter(({ p, c }) => {
    const known = p.label.split(',').slice(1).map(areaKey);
    if (c.country) {
      known.push(nameKey(countryName(c.country)), nameKey(c.country));
      if (c.country === 'US') known.push('usa', 'united states', 'united states of america');
      if (c.country === 'GB') known.push('uk', 'england', 'scotland', 'wales', 'northern ireland');
    }
    return said.every(a => known.includes(a));
  });
  // "Aberdeen, United Kingdom" is still two Aberdeens if we held both.
  const distinct = fits.filter((x, i) => fits.findIndex(y => milesBetween(x.p, y.p) < 5) === i);
  return distinct.length === 1 ? distinct[0].p : null;
}

/**
 * The airport a flight card names. It has to be the airport of the place
 * the miles were measured from: a Raleigh user in Seattle with location on
 * is measured from Seattle, and "2,350 miles — a flight from RDU" is two
 * starting points on one line. So with a position from the device, only
 * the airport the device's own place gave; without one, their home airport.
 */
export function startingAirport(opts: { at: { lat: number; lng: number } | null; sent?: string | null; homeAirport?: unknown }): string | null {
  const code = (v: unknown) => (typeof v === 'string' && /^[A-Z]{3}$/i.test(v.trim()) ? v.trim().toUpperCase() : null);
  return opts.at ? code(opts.sent) : code(opts.homeAirport);
}

// ─── Ranking ────────────────────────────────────────────────────────────

/** What the party is into, in the venue table's words, most telling first. */
export function interestsOf(person: Pick<Person, 'me' | 'group'>, vetoes: string[]): { mine: string[]; theirs: string[] } {
  const clean = (list: string[]) => list.filter(i => !vetoBreach(i, vetoes));
  const mine = clean(tasteFrom(person.me).interests);
  const theirs = clean([...new Set((person.group?.members ?? []).flatMap(m => tasteFrom(m).interests))]).filter(i => !mine.includes(i));
  return { mine, theirs };
}

interface Scored {
  c: Candidate; band: Band; miles: number; t: Tally; h: Holdings; score: number; matched: string[];
  /** The town the card names: the candidate, or the folded town they live in. */
  shown: Place; shownMiles: number;
}

/** The candidate and every town folded into it. */
function placesOf(c: Candidate): Place[] {
  return [{ name: c.name, label: c.label, lat: c.lat, lng: c.lng }, ...(c.aliases ?? [])];
}

/**
 * Which name a card uses. Somebody who lives in a town that was folded into
 * its neighbour sees their own town's name: "A night out in Southern Pines,
 * where you are", not "in Aberdeen, 4 miles away", for the same venues.
 */
const HOME_TOWN_MILES = 5;
function shownPlace(c: Candidate, home: { lat: number; lng: number }): Place {
  const [own, ...rest] = placesOf(c);
  const nearest = [own, ...rest].map(p => ({ p, d: milesBetween(home, p) })).sort((a, b) => a.d - b.d)[0];
  return nearest && nearest.d <= HOME_TOWN_MILES ? nearest.p : own;
}

/**
 * A "big crowds" no-go cannot be checked (uncheckedLine says so), but it
 * can still be leaned on: the ranking treats it as the crowd dial turned
 * right down, which steers away from the biggest cities without claiming
 * anything about how busy the rest are.
 */
function crowdAverse(lean: Leaning, vetoes: string[]): Leaning {
  if (!uncheckedVetoes(vetoes).some(u => u.lacks === 'crowd')) return lean;
  return { ...lean, dials: { ...lean.dials, crowd: Math.min(lean.dials.crowd ?? 20, 20) } };
}

/**
 * How well a town suits this party, from counts alone.
 *
 * Each interest they share with the town adds the log of how much of it is
 * held, weighted by how early it came in their answers; their members' add
 * half as much. The kind of traveller they are adds for the venues that
 * kind is drawn to. The log is deliberate: a city with two thousand
 * restaurants is not a hundred times the dinner of a town with twenty.
 */
export function scoreOf(t: Tally, c: Candidate, band: Band, miles: number, mine: string[], theirs: string[], lean: Leaning): { score: number; matched: string[] } {
  // What each shared interest added, so the card can lead with the ones
  // that did most to choose the town rather than whichever was ticked first.
  const adds: Array<{ i: string; w: number }> = [];
  let score = 0;
  mine.forEach((i, idx) => {
    const n = t.byInterest.get(i) ?? 0;
    if (!n) return;
    const w = Math.max(0.5, 1 - idx * 0.06) * Math.log2(1 + n);
    adds.push({ i, w });
    score += w;
  });
  for (const i of theirs) {
    const n = t.byInterest.get(i) ?? 0;
    if (!n) continue;
    const w = 0.5 * Math.log2(1 + n);
    adds.push({ i, w });
    score += w;
  }
  const matched = adds.map((a, k) => ({ ...a, k })).sort((a, b) => b.w - a.w || a.k - b.k).map(a => a.i);
  const drawn = (a: Archetype | null, w: number) => {
    if (!a) return;
    let n = 0;
    for (const [i, k] of t.byInterest) if (DRAWN_TO[a](i)) n += k;
    // A low-energy night owl is not chosen for its nightlife.
    if (a === 'spark' && (lean.dials.energy ?? 50) <= 30) return;
    score += w * Math.log2(1 + n);
  };
  drawn(lean.primary, 1.5);
  drawn(lean.secondary, 0.75);
  // Somebody with nothing to go on still gets the best-held towns.
  score += 0.5 * Math.log2(1 + t.total);

  const crowd = lean.dials.crowd, novelty = lean.dials.novelty;
  const big = t.total >= 1000 || (c.rank != null && c.rank <= 20);
  if (crowd != null && crowd <= 30 && big) score -= 2;
  if (crowd != null && crowd >= 70 && big) score += 1;
  const scout = lean.primary === 'scout' || lean.secondary === 'scout';
  if ((novelty != null && novelty >= 65) || scout) {
    if (c.rank != null && c.rank <= 20) score -= 1.5;
    if (t.total < 400) score += 1;
  }
  if (novelty != null && novelty <= 35 && c.rank != null) score += 1;

  // A weekend is best a couple of hours away, not five and a half.
  if (band === 'weekend') score -= Math.max(0, miles - 250) / 100;
  // A night out is the nearest good town, full stop.
  if (band === 'night') score -= miles / 10;
  return { score: Math.round(score * 100) / 100, matched };
}

function nightsFor(band: Band, abroad: boolean, miles: number): number {
  if (band === 'night') return 0;
  if (band === 'weekend') return 2;
  if (abroad && miles >= 3000) return 7;
  return abroad ? 6 : 4;
}

/**
 * The recommendations: up to `max`, in the order night, weekend, away,
 * then the next best of any band. Deterministic — the same rows give the
 * same cards — with ties settled by name.
 */
export function pickTrips(
  candidates: Candidate[],
  holdings: Map<string, Holdings>,
  person: Person,
  opts: { max?: number } = {},
): { picks: TripPick[]; reason: 'no_location' | 'nothing_held' | 'all_dismissed' | null } {
  const max = opts.max ?? 4;
  if (!person.home) return { picks: [], reason: 'no_location' };
  const vetoes = vetoesOf(person);
  const sober = anyoneSober(person);
  const { mine, theirs } = interestsOf(person, vetoes);
  const lean = crowdAverse(leaningOf(person.me), vetoes);
  const longHaulOut = refusesLongFlights(vetoes);
  const tier = partyTier(person);
  const party = 1 + (person.group?.members.length ?? 0);
  const group = !!person.group;

  const scored: Scored[] = [];
  let heldAny = false, dismissedAny = false;
  for (const c of candidates) {
    const h = holdings.get(c.key);
    if (!h) continue;
    const t = tally(h, vetoes, sober);
    if (!clearsFloor(t)) continue;
    const miles = milesBetween(person.home, c);
    const band = bandFor(miles);
    if (!band) continue;
    // A name that is itself a veto ("custom:Paris") is not offered.
    if (vetoBreach(`${c.name} ${c.site ?? ''}`, vetoes)) continue;
    // A long flight for somebody who ruled them out is not offered at all:
    // distance is the one part of that we can check.
    if (band === 'away' && longHaulOut && miles > LONG_FLIGHT_MILES) continue;
    heldAny = true;
    if (person.dismissed.has(c.key)) { dismissedAny = true; continue; }
    // Already planned (see plannedKeys for why an evening differs), under
    // this town's name or any town folded into it.
    const list = person.planned[band === 'night' ? 'nights' : 'trips'];
    if (placesOf(c).some(pl => isPlanned(list, pl, c.country))) continue;
    const { score, matched } = scoreOf(t, c, band, miles, mine, theirs, lean);
    const shown = shownPlace(c, person.home);
    scored.push({ c, band, miles, t, h, score, matched, shown, shownMiles: milesBetween(person.home, shown) });
  }

  const order = (a: Scored, b: Scored) => b.score - a.score || a.c.name.localeCompare(b.c.name);
  const byBand = (b: Band) => scored.filter(s => s.band === b).sort(order);
  const nightTop = byBand('night')[0];
  // Only the one night out: two towns to go out in tonight is one too many.
  const chosen: Scored[] = [];
  const affordable = (s: Scored) => {
    const abroad = isAbroad(s.c, person, s.miles);
    const nights = nightsFor(s.band, abroad, s.miles);
    const cost = estimate({ band: s.band, miles: s.miles, nights, party, tier, abroad });
    return cost.low <= TRIP_CEILING[tier ?? 'none'];
  };
  const weekends = byBand('weekend').filter(affordable);
  const aways = byBand('away').filter(affordable);
  if (nightTop) chosen.push(nightTop);
  // Then a weekend and a flight, taking turns, so four cards are a mix and
  // not three drives because the state happens to be well mapped.
  const queues = [weekends, aways];
  for (let round = 0; chosen.length < max && queues.some(q => q.length > round); round++) {
    for (const q of queues) if (q[round] && chosen.length < max) chosen.push(q[round]);
  }

  const picks = chosen.slice(0, max).map(s => toPick(s, person, { party, tier, group }));
  if (!picks.length) return { picks, reason: dismissedAny && heldAny ? 'all_dismissed' : 'nothing_held' };
  return { picks, reason: null };
}

/** US territories fly as domestic from the mainland: no passport, a US fare. */
const AS_US = new Set(['US', 'PR', 'VI', 'GU']);
const homeSide = (cc: string) => (AS_US.has(cc.toUpperCase()) ? 'US' : cc.toUpperCase());

export function isAbroad(c: Pick<Candidate, 'country'>, person: Pick<Person, 'homeCountry'>, miles: number): boolean {
  if (c.country && person.homeCountry) return homeSide(c.country) !== homeSide(person.homeCountry);
  return miles > 2500;
}

function toPick(s: Scored, person: Person, ctx: { party: number; tier: Tier; group: boolean }): TripPick {
  const abroad = isAbroad(s.c, person, s.miles);
  const nights = nightsFor(s.band, abroad, s.miles);
  const { low, high } = estimate({ band: s.band, miles: s.miles, nights, party: ctx.party, tier: ctx.tier, abroad });
  const vetoes = vetoesOf(person);
  // Whose each no-go is. The reader's own are said as theirs; the others'
  // only when saying "somebody" names nobody (othersMaySpeak).
  const mine = vetoesOf({ me: person.me, group: null });
  const speak = othersMaySpeak(person.group);
  const theirs = speak ? vetoes.filter(v => !mine.includes(v)) : [];
  const each = ctx.party > 1;
  const basis = s.band === 'night'
    ? !ctx.tier ? 'a typical night out'
      : ctx.group ? 'going by the tightest budget in the group' : 'going by what you said a night out costs you'
    : s.band === 'weekend' ? 'room share, food and fuel' : 'flight, room share and food';
  const matchedLineText = matchedLine(s.matched, ctx.group);
  const flights = s.band !== 'away' ? null
    : refusesLongFlights(mine) ? `Kept under ${fmt(LONG_FLIGHT_MILES)} miles, since you ruled out long flights.`
      : refusesLongFlights(theirs) ? `Kept under ${fmt(LONG_FLIGHT_MILES)} miles — somebody in the group ruled out long flights.`
        : null;
  // Counted again with only the reader's own answers, to tell what they
  // took out from what somebody else did.
  const own = tally(s.h, mine, isSober(person.me));
  const removed = own.removedAs.size || own.sober
    ? leftOutLine(own, 'mine')
    : speak ? leftOutLine(s.t, 'theirs', own.removedAs) : null;
  const leftOut = [removed, flights].filter(Boolean).join(' ') || null;
  const unchecked = s.band === 'night' ? null : uncheckedLine(mine, theirs);
  const around = (s.c.aliases?.length ? [s.shown, ...placesOf(s.c).filter(p => p !== s.shown && p.name !== s.shown.name)] : []).map(p => p.name);
  const lines = {
    title: titleFor(s.band, { ...s.c, name: s.shown.name }, nights),
    held: heldLine(s.t, s.matched.length ? s.matched : [], around),
    matched: matchedLineText,
    leftOut,
  };
  // Belt and braces: no line on the card may name something vetoed. The
  // counts already left it out; this catches the words around them.
  const safe = (line: string | null) => (line && vetoBreach(line, vetoes) && line !== leftOut ? null : line);
  return {
    ref: `trip:${s.c.key}`,
    band: s.band,
    planType: PLAN_TYPE[s.band],
    destination: { city: whereName(s.shown, s.c.country), country: s.c.country, label: s.shown.label },
    site: s.c.site ?? null,
    nights,
    miles: Math.round(s.shownMiles),
    title: lines.title,
    who: whoFor(person.group),
    held: safe(lines.held) ?? `${fmt(s.t.total)}${s.t.floor ? '+' : ''} places we've checked`,
    matched: safe(lines.matched),
    leftOut,
    unchecked,
    photo: null,
    howFar: howFarFor(s.band, s.shownMiles, s.band === 'away' ? person.homeAirport : null),
    cost: {
      low, high, each,
      label: `Estimate — ${basis}. Nothing is priced yet.`,
    },
    cta: CTA[s.band],
    groupId: person.group?.id ?? null,
    score: s.score,
  };
}

/**
 * The name the plan's Where is saved under, which is what the itinerary
 * later hands the geocoder with the country. The label's state goes with
 * it ("Aberdeen, North Carolina") because a bare "Aberdeen, US" comes back
 * as South Dakota, a thousand miles from the venues the card counted. A
 * label that only repeats the country ("Paris, France") adds nothing.
 */
export function whereName(p: Place, country: string | null): string {
  const parts = p.label.split(',').map(x => x.trim()).filter(Boolean);
  if (parts.length < 2 || nameKey(parts[0]) !== nameKey(p.name)) return p.name;
  if (country && parts.length === 2 && nameKey(parts[1]) === nameKey(countryName(country))) return p.name;
  return parts.slice(0, 2).join(', ');
}
