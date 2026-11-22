// ─── From what the group said, to the selector, and back (Task 3) ────────
// The pure half of choosing destinations in code: what the group said becomes
// tag weights; the chosen places become a fixed block in the prompt; the
// model's answer is read back against them; and once the model has priced
// each place, the budget guardrail is applied to the real figure.
// lib/destination-candidates.ts is the half that reads the database.
//
// Tags are venue interests as discovery_venues stores them (checked against
// the live table 2026-11-22): the quiz's own words in lower case — "live
// music", "outdoors", "breweries" — and cuisines as "<cuisine> restaurants".
// A candidate's tags are the interests its verified venues hold, so a pick
// that matches "breweries" is a town where we hold breweries, not a town a
// model remembers as having them.
//
// No imports beyond the selector's types, so node's test runner loads it bare.

import type { Candidate, CrowdTolerance, GroupContext, Pick, Tier } from './destination-select.ts';
import { strictestCrowd, SELECT_CONFIG } from './destination-select.ts';

/** Interests every town has; they say nothing about which town to pick. */
export const GENERIC_TAGS = new Set(['places to eat', 'places to stay', 'food', 'drink', 'culture']);

/**
 * Words in a blurb or a trip type, and the venue interests they stand for.
 * Only what a venue can actually be: "beach" and "ski" are not here because
 * no verified venue says either, and a pick has to trace to something we
 * hold. Those requests get fewer options, honestly, until the catalogue does.
 */
const WORD_TAGS: [RegExp, string[]][] = [
  [/\blive music\b|\bgigs?\b|\bconcerts?\b|\bbands?\b/, ['live music']],
  [/\bjazz\b/, ['jazz']],
  [/\bclassical\b|\borchestra\b|\bsymphony\b/, ['classical music']],
  [/\bmuseums?\b|\bhistory\b|\bhistoric\b/, ['museums & history']],
  [/\bart\b|\bgaller(y|ies)\b/, ['art & galleries']],
  [/\bhik(e|es|ing)\b|\btrails?\b|\boutdoors?\b|\bnature\b|\bcamping\b/, ['outdoors']],
  [/\bparks?\b|\bgardens?\b/, ['gardens & parks']],
  [/\bbrewer(y|ies)\b|\bcraft beer\b|\bbeers?\b/, ['breweries']],
  [/\bwine(ry|ries)?\b|\bvineyards?\b/, ['wine tasting']],
  [/\bcocktails?\b|\bbars?\b/, ['cocktail bars']],
  [/\bpubs?\b/, ['pubs']],
  [/\bclubs?\b|\bclubbing\b|\bdanc(e|ing)\b/, ['nightclubs', 'dancing']],
  [/\bspa\b|\bwellness\b|\byoga\b|\brelax(ing)?\b/, ['wellness']],
  [/\bcomedy\b|\bstand-?up\b/, ['comedy']],
  [/\btheat(re|er)\b|\bshows?\b|\bfilm\b/, ['film & theatre']],
  [/\bmarkets?\b|\bfood halls?\b/, ['markets & food halls']],
  [/\bgolf\b|\bsports?\b|\bgames?\b|\bstadium\b/, ['sport']],
  [/\bpottery\b|\bcrafts?\b|\bceramics\b/, ['pottery & crafts']],
  [/\bcooking class(es)?\b/, ['cooking']],
  [/\bphotograph(y|s)?\b/, ['photography']],
  [/\btrivia\b|\bboard games?\b/, ['trivia & board games']],
  [/\bbooks?\b|\bbookshops?\b|\btalks?\b/, ['books & talks']],
];

/** The trip types members pick (lib/taste-profile.ts TRIP_TYPES), as venue interests. */
const TRIP_TYPE_TAGS: Record<string, string[]> = {
  nature: ['outdoors', 'gardens & parks'],
  adventure: ['outdoors', 'sport'],
  wellness: ['wellness'],
  party: ['nightclubs', 'cocktail bars', 'pubs'],
  city: ['museums & history', 'film & theatre', 'art & galleries'],
  // beach: nothing we hold says "beach" — see WORD_TAGS.
};

export function tagsInWords(text: string | null | undefined): string[] {
  const t = String(text ?? '').toLowerCase();
  if (!t.trim()) return [];
  const out = new Set<string>();
  for (const [re, tags] of WORD_TAGS) if (re.test(t)) tags.forEach(x => out.add(x));
  return [...out];
}

export interface Member {
  /** users.favorite_activities: the quiz chips, e.g. "Live music". */
  favorite_activities?: unknown;
  /** users.cuisines, e.g. "Italian". */
  cuisines?: unknown;
  /** users.crowd_tolerance, once the migration has run. */
  crowd_tolerance?: unknown;
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map(x => (x as string).trim()) : []);

/**
 * Tag weights for the group. Each member counts once, whatever the group
 * size: a member's interests add 1/n each, cuisines 0.5/n. What this trip is
 * for — its blurb and its trip types — leads, at 2.
 */
export function tagWeightsFrom(input: { members: Member[]; goal?: string | null; tripTypes?: string[] }): Record<string, number> {
  const w: Record<string, number> = {};
  const add = (tag: string, by: number) => {
    const k = tag.toLowerCase().trim();
    if (!k || GENERIC_TAGS.has(k)) return;
    w[k] = Math.round(((w[k] ?? 0) + by) * 1000) / 1000;
  };
  const n = Math.max(1, input.members.length);
  for (const m of input.members) {
    for (const a of new Set(list(m.favorite_activities).map(x => x.toLowerCase()))) add(a, 1 / n);
    for (const c of new Set(list(m.cuisines).map(x => x.toLowerCase()))) add(`${c} restaurants`, 0.5 / n);
  }
  for (const t of tagsInWords(input.goal)) add(t, 2);
  for (const type of input.tripTypes ?? []) for (const t of TRIP_TYPE_TAGS[String(type).toLowerCase()] ?? []) add(t, 2);
  return w;
}

export function groupContextFrom(input: {
  members: Member[];
  goal?: string | null;
  tripTypes?: string[];
  budgetPerPersonDollars: number | null | undefined;
  excludedIds?: Iterable<string>;
  maxTravelMinutes?: number | null;
}): GroupContext {
  const crowd: CrowdTolerance = strictestCrowd(input.members.map(m => (typeof m.crowd_tolerance === 'string' ? m.crowd_tolerance : null)));
  return {
    budgetPerPersonCents: input.budgetPerPersonDollars && input.budgetPerPersonDollars > 0 ? Math.round(input.budgetPerPersonDollars * 100) : 0,
    tagWeights: tagWeightsFrom(input),
    crowdTolerance: crowd,
    excludedIds: new Set(input.excludedIds ?? []),
    maxTravelMinutes: input.maxTravelMinutes ?? null,
  };
}

/** The places, fixed, for the options prompt. The model writes about these and nothing else. */
export function fixedPlacesBlock(picks: Pick[]): string {
  const lines = picks.map((p, i) => {
    const c = p.candidate;
    const where = [c.name, c.region].filter(Boolean).join(', ');
    return `${i + 1}. ${where} — city "${c.name}"`;
  });
  return `THE PLACES ARE ALREADY CHOSEN. Reach chose them from what this group said and from
places where we hold verified venues. Write exactly ${picks.length} option${picks.length === 1 ? '' : 's'}, one for each
place below, in this order. Do not add a place, swap one, or rename one: "city"
must be exactly the name given.
${lines.join('\n')}
Never describe a place as less crowded, uncrowded, off the beaten path,
eco-friendly or sustainable, and never call anything a hidden gem.`;
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export interface TripLike { city?: unknown; destination?: unknown; total_per_person?: unknown; tier?: unknown }

/**
 * The model's options, read back against the places chosen. An option whose
 * city is not one of the picks is a stray — a place nothing vouched for — and
 * is dropped. Each kept option carries its pick, in the picks' order, one per
 * pick.
 */
export function readBackPlaces<T extends TripLike>(trips: T[], picks: Pick[]): { kept: { trip: T; pick: Pick }[]; strays: string[] } {
  const kept: { trip: T; pick: Pick }[] = [];
  const strays: string[] = [];
  const used = new Set<number>();
  for (const p of picks) {
    const want = norm(p.candidate.name);
    const at = trips.findIndex((t, i) => !used.has(i) && (norm(t.city) === want || norm(String(t.destination ?? '').split(',')[0]) === want));
    if (at >= 0) { used.add(at); kept.push({ trip: trips[at], pick: p }); }
  }
  trips.forEach((t, i) => { if (!used.has(i)) strays.push(String(t.city || t.destination || '?')); });
  return { kept, strays };
}

/**
 * The guardrail, on the model's own figure: an option over 1.2× the budget
 * is never offered. A tier comes from the price against the budget, not from
 * the model's label. No budget: the model's figure stands and the tier is
 * left as it was.
 */
export function tierPriced(totalPerPersonDollars: unknown, budgetPerPersonDollars: number | null | undefined): Tier | null | undefined {
  const total = Number(totalPerPersonDollars);
  if (!Number.isFinite(total) || total <= 0) return undefined;
  if (!(budgetPerPersonDollars && budgetPerPersonDollars > 0)) return undefined;
  const r = total / budgetPerPersonDollars;
  if (r <= SELECT_CONFIG.tierSaverMax) return 'saver';
  if (r <= SELECT_CONFIG.tierFairMax) return 'fair';
  if (r <= SELECT_CONFIG.tierStretchMax) return 'stretch';
  return null;
}

/** What the screen says when there are fewer than three. Null when there are three. */
export function fewerWords(n: number): string | null {
  if (n >= 3) return null;
  if (n === 2) return 'We found two that really fit. Want us to widen the search?';
  if (n === 1) return 'We found one that really fits. Want us to widen the search?';
  return "We couldn't find a place that fits what you said among the places we know well yet. Want us to widen the search?";
}

/** A candidate's tags, from its venues: the interests it holds at least `min` of, minus the generic ones. */
export function tagsFromCounts(counts: Record<string, number>, min = 3): string[] {
  return Object.entries(counts)
    .filter(([k, n]) => n >= min && !GENERIC_TAGS.has(k))
    .map(([k]) => k)
    .sort();
}

export type { Candidate };
