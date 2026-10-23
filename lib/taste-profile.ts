// ─── One taste profile per person, distilled from what they already did ──
// Discover, Home's recommended trips and (later) the generator each re-read
// the quiz on every request, and none of them learns from anything after it:
// the pottery studio somebody went to, the "not for me" on a brewery, the
// three trips that all started on a Friday. This turns the signals we already
// hold (lib/signals.ts, v_taste_signals) into one small profile per person,
// once a day, inside /api/cron/knowledge — no new vercel.json entry.
//
// The rules, each enforced here rather than promised:
//
//   * Explainable, not a score. Every facet is something a person could be
//     told in a sentence ("drawn to live music", "trips usually start on a
//     Friday"), and `evidence` records which kinds of signal fed it and how
//     many. Nothing is a learned weight nobody can read.
//   * An explicit avoid beats a positive. A "not for me" on a kind of place,
//     or a trip's "no way" on clubs, takes that kind out of `interests`
//     whatever else pointed at it. It is the person's own word.
//   * Travel and leisure only. Every string in the output is chosen from a
//     fixed list here (venue-table words, the trip quiz's own ids) or is a
//     booked city and country. Nothing typed is copied: the per-trip answers
//     carry sentences (goalBlurb, noWay, mustDo) and those keys are never
//     read. Nothing dietary, and no avoid of a drink — a profile that says
//     somebody avoids bars says something about them that is not ours to
//     infer. "Not drinking" is read live from the quiz where it matters.
//   * Never shown. Not to the person, not to their group. It reorders what
//     is already true (lib/recommendations/trip-picks.ts) and adds no line to
//     any card. The only read outside the ranking is the ops route, behind a
//     server secret, by opaque profile_id.
//   * A failure never breaks a request. The distill runs in a cron and
//     reports; the read in the ranking returns null on any error.
//
// Pure apart from distillAll() and readProfile() at the bottom, so the rules
// above are unit tested without a database (tests/unit/taste-profile.test.ts).
import type { SupabaseClient } from '@supabase/supabase-js';
import { kindFor, mappableKinds, tasteFrom, QUIZ_CUISINES } from './discovery/taste.ts';
import { publicProfile, type ArchetypeKey } from './traveler-profile.ts';
import { readSignals, type Signal } from './signals.ts';
import { tierOf } from './recommendations/trip-picks.ts';

export const MODEL_VERSION = 1;

// ─── The shape ──────────────────────────────────────────────────────────

export type Pace = 'relaxed' | 'balanced' | 'packed';
export type BudgetPosture = 'lean' | 'mid' | 'comfortable' | 'splurge';
export type NightEnergy = 'chilled' | 'lively' | 'big';

/**
 * The "absolute no" answers that are about travel and leisure, one name each.
 * A trip's answers (trip_input) carry the per-trip quiz's ids, and a trip and
 * a night out spell them differently — `crowded` and `big crowds`,
 * `loud rooms` — while the profile quiz's own ids (`crowds`, `loud`, ...) live
 * in users.no_way_jose, which the view leaves out. NO_GO_ID reads every
 * spelling the quiz screens save into one of these.
 */
export const NO_GOS = [
  'crowds', 'loud', 'clubs', 'earlyMornings', 'longFlights', 'coldWeather', 'camping', 'hiking',
  'heights', 'karaoke', 'longQueues', 'standingAllNight', 'dressingUp',
] as const;
export type NoGo = typeof NO_GOS[number];

/**
 * Every id a "No Way José" screen saves, into its NoGo. The trip quiz
 * (components/reach-app.jsx, CreatePlanFlow's trip questions), the night-out
 * quiz (its phrases) and the profile quiz's ids, carried onto a trip.
 * Food ("spicy") is left out: it is not about where anybody goes.
 */
export const NO_GO_ID: Readonly<Record<string, NoGo>> = {
  // The trip quiz.
  camping: 'camping', longFlights: 'longFlights', coldWeather: 'coldWeather',
  crowded: 'crowds', earlyMornings: 'earlyMornings', hiking: 'hiking',
  // The night-out quiz.
  'big crowds': 'crowds', 'loud rooms': 'loud', clubs: 'clubs',
  'long queues': 'longQueues', 'standing all night': 'standingAllNight', 'dressing up': 'dressingUp',
  // The profile quiz's ids.
  crowds: 'crowds', loud: 'loud', heights: 'heights', karaoke: 'karaoke',
};

export interface TasteProfile {
  version: 1;
  /** Venue-table words → 0..1, strongest first, net of every explicit avoid. */
  interests: Record<string, number>;
  /** Venue-table words they said no to → 0..1. Beats anything in `interests`. */
  avoid: Record<string, number>;
  /** The trip quiz's own "no way" ids they have used, most used first. */
  no_go: NoGo[];
  pace: Pace | null;
  budget_posture: BudgetPosture | null;
  /** Share of the interest weight that is about eating, 0..1. */
  food: number | null;
  nightlife: { energy: NightEnergy | null; share: number | null };
  outdoors: number | null;
  culture: number | null;
  travel_style: {
    archetype: { primary: ArchetypeKey | null; secondary: ArchetypeKey | null } | null;
    /** The trip quiz's trip-type ids → how often chosen. */
    trip_types: Record<string, number>;
    /** The trip quiz's stay ids → how often chosen. */
    lodging: Record<string, number>;
  };
  time_prefs: {
    /** Share of the dates they offered that start Thursday to Saturday. */
    weekend_start_share: number | null;
    /** Nights a trip of theirs usually runs, the median. */
    typical_nights: number | null;
  };
  /** Where they have been on a booked trip: city and country, never a point. */
  places: { been: Array<{ city: string; country: string | null; trips: number }> };
  social: { solo_plans: number; group_plans: number; nights_out: number; trips: number; votes: number; vetoes: number };
  /** How much there was to go on, per facet, 0..1. */
  confidence: Record<string, number>;
  /** Facet → signal kind → how many rows of it fed that facet. */
  evidence: Record<string, Record<string, number>>;
}

export interface Distilled {
  profile: TasteProfile;
  signal_count: number;
  last_signal_at: string | null;
}

// ─── The words ──────────────────────────────────────────────────────────

/**
 * Interests that would say something about health, faith or ethics rather
 * than about a weekend. Kept out in both directions.
 */
const SENSITIVE = new Set(['veggie restaurants', 'vegetarian restaurants', 'vegan restaurants', 'halal restaurants', 'kosher restaurants']);
/**
 * Drinks: a positive is a leisure taste; an avoid would be an inference about
 * the person (are they not drinking, and why?), so it is never written down.
 * Nightclubs are not here: "no clubs" is a stated no-go about noise and
 * crowds, and the trip quiz offers it as one.
 */
const DRINKS = new Set(['wine tasting', 'breweries', 'pubs', 'cocktail bars']);

const KNOWN = new Set<string>([...mappableKinds().map(k => k.key), 'coffee']);
KNOWN.delete('places to stay');

/** A venue-table word this profile may hold, or null. Typed words never qualify. */
export function tagOf(word: unknown): string | null {
  if (typeof word !== 'string') return null;
  const raw = word.replace(/^custom:/i, '').trim().toLowerCase();
  if (!raw) return null;
  const cuisine = QUIZ_CUISINES.includes(raw) ? `${raw} restaurants` : raw;
  const key = kindFor(cuisine).key;
  const ok = KNOWN.has(key)
    || (/^(\w+) restaurants$/.test(key) && QUIZ_CUISINES.includes(key.replace(/ restaurants$/, '')));
  return ok && !SENSITIVE.has(key) ? key : null;
}

const FOOD = (t: string) => t === 'places to eat' || t === 'markets & food halls' || t === 'cooking' || t === 'coffee' || t.endsWith(' restaurants');
const NIGHT = (t: string) => ['live music', 'comedy', 'dancing', 'nightclubs', 'pubs', 'cocktail bars', 'jazz', 'trivia & board games', 'breweries', 'wine tasting'].includes(t);
const OUTDOORS = (t: string) => ['outdoors', 'gardens & parks', 'sport'].includes(t);
const CULTURE = (t: string) => ['museums & history', 'art & galleries', 'film & theatre', 'books & talks', 'classical music', 'pottery & crafts', 'photography'].includes(t);

// The per-trip quiz's ids, as CreatePlanFlow saves them, into venue words.
const NIGHT_KIND: Record<string, string> = { dinner: 'places to eat', drinks: 'cocktail bars', livemusic: 'live music', game: 'sport', show: 'film & theatre' };
const NIGHT_FOOD: Record<string, string> = { smallplates: 'places to eat' };
const TRIP_TYPE_TAG: Record<string, string> = { nature: 'outdoors', adventure: 'outdoors', wellness: 'wellness', party: 'nightclubs' };
const TRIP_TYPES = ['beach', 'city', 'nature', 'party', 'wellness', 'adventure'];
const LODGING = ['hotel', 'resort', 'airbnb', 'villa', 'boutique', 'hostel'];
const PACES: Pace[] = ['relaxed', 'balanced', 'packed'];
const ENERGIES: NightEnergy[] = ['chilled', 'lively', 'big'];
/** A trip's "no way" ids that rule out a kind of place outright. */
const NO_GO_TAG: Partial<Record<NoGo, string>> = { clubs: 'nightclubs', loud: 'nightclubs' };

// ─── Weights ────────────────────────────────────────────────────────────

/** A year-old signal counts half. Declared answers are current and do not decay. */
const HALF_LIFE_DAYS = 365;
export function decay(at: string | null | undefined, now: number): number {
  const t = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(t)) return 0.5;
  const days = Math.max(0, (now - t) / 86_400_000);
  return Math.pow(0.5, days / HALF_LIFE_DAYS);
}

/** Profiles nobody has added a signal to for this long are deleted (retention). */
export const RETENTION_MONTHS = 24;

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const r2 = (n: number) => Math.round(n * 100) / 100;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

function median(ns: number[]): number | null {
  const s = ns.filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The quiz's budget band, read by the ranking's own parser so there is one idea of it. */
const POSTURE_OF_TIER: Record<string, BudgetPosture> = {
  under50: 'lean', '50to100': 'lean', '100to200': 'mid', '200to400': 'comfortable', over400: 'splurge',
};
function tierPosture(budget: unknown): BudgetPosture | null {
  const tier = tierOf(str(budget) || null);
  return tier ? POSTURE_OF_TIER[tier] ?? null : null;
}

/**
 * A trip's per-person budget spread over its days, in the same four bands.
 * Null when the trip has no length yet: the create flow sends nights 0 for a
 * trip whose dates are still to come from the poll, and a week's budget read
 * as one day's spend is "splurge" for almost anybody.
 */
export function perDayPosture(budget: unknown, nights: unknown): BudgetPosture | null {
  const total = Number(str(budget) || budget);
  if (!Number.isFinite(total) || total <= 0) return null;
  const n = Number(nights);
  if (!Number.isFinite(n) || n <= 0) return null;
  const perDay = total / n;
  if (perDay < 100) return 'lean';
  if (perDay < 200) return 'mid';
  if (perDay < 400) return 'comfortable';
  return 'splurge';
}

// ─── The distill ────────────────────────────────────────────────────────

/** One person's profile from their signals. Pure and deterministic. */
export function distill(signals: Signal[], now: number = Date.now()): Distilled {
  const evidence: Record<string, Record<string, number>> = {};
  const saw = (facet: string, kind: string) => {
    const e = evidence[facet] ?? (evidence[facet] = {});
    e[kind] = (e[kind] ?? 0) + 1;
  };

  const plus = new Map<string, number>();
  const minus = new Map<string, number>();
  const add = (m: Map<string, number>, tag: string | null, w: number) => {
    if (!tag || w <= 0) return;
    m.set(tag, (m.get(tag) ?? 0) + w);
  };

  const noGo = new Map<NoGo, number>();
  const paceVotes = new Map<Pace, number>();
  const energyVotes = new Map<NightEnergy, number>();
  const tripTypes: Record<string, number> = {};
  const lodging: Record<string, number> = {};
  const postureVotes = new Map<BudgetPosture, number>();
  let archetype: TasteProfile['travel_style']['archetype'] = null;
  let weekendStarts = 0, datesOffered = 0;
  const nights: number[] = [];
  const been = new Map<string, { city: string; country: string | null; plans: Set<string> }>();
  const social = { solo_plans: 0, group_plans: 0, nights_out: 0, trips: 0, votes: 0, vetoes: 0 };
  let last: number | null = null;

  for (const s of signals) {
    const t = s.at ? Date.parse(s.at) : NaN;
    if (Number.isFinite(t) && (last === null || t > last)) last = t;
    const d = obj(s.detail);
    const w = decay(s.at, now);

    switch (s.kind) {
      case 'profile': {
        // Their own answers, most telling first (tasteFrom's order). Not
        // decayed: this is what they say today.
        const { interests } = tasteFrom({
          favorite_activities: list(d.favorite_activities).filter((x): x is string => typeof x === 'string'),
          cuisines: list(d.cuisines).filter((x): x is string => typeof x === 'string'),
          music_genres: list(d.music_genres).filter((x): x is string => typeof x === 'string'),
          nightlife_style: str(d.nightlife_style) || null,
          drink_style: str(d.drink_style) || null,
        });
        interests.forEach((i, idx) => {
          const tag = tagOf(i);
          if (tag) { add(plus, tag, Math.max(0.5, 1 - idx * 0.05)); saw('interests', 'profile'); }
        });
        const p = publicProfile(d.traveler_profile);
        if (p && (p.primary || p.secondary)) {
          archetype = { primary: p.primary, secondary: p.secondary };
          saw('travel_style', 'profile');
        }
        if (p && !p.unanswered.includes('pace')) {
          const pace: Pace = p.dials.pace <= 35 ? 'relaxed' : p.dials.pace >= 65 ? 'packed' : 'balanced';
          paceVotes.set(pace, (paceVotes.get(pace) ?? 0) + 1);
          saw('pace', 'profile');
        }
        const posture = tierPosture(d.budget_range);
        if (posture) { postureVotes.set(posture, (postureVotes.get(posture) ?? 0) + 1.5); saw('budget_posture', 'profile'); }
        break;
      }
      case 'trip_input': {
        // Only named keys, each checked against the quiz's own ids. The
        // typed ones (goalBlurb, noWay, mustDo) are never touched.
        const a = obj(d.answers);
        for (const k of list(a.nightKind)) {
          const tag = NIGHT_KIND[str(k)];
          if (tag) { add(plus, tag, 0.6 * w); saw('interests', 'trip_input'); }
        }
        for (const f of list(a.nightFood)) {
          const tag = NIGHT_FOOD[str(f)] ?? tagOf(f);
          if (tag && FOOD(tag)) { add(plus, tag, 0.6 * w); saw('interests', 'trip_input'); }
        }
        for (const ty of list(a.tripType)) {
          const id = str(ty);
          if (!TRIP_TYPES.includes(id)) continue;
          tripTypes[id] = (tripTypes[id] ?? 0) + 1;
          saw('travel_style', 'trip_input');
          add(plus, TRIP_TYPE_TAG[id] ?? null, 0.4 * w);
        }
        for (const l of list(a.accommodation)) {
          const id = str(l);
          if (LODGING.includes(id)) { lodging[id] = (lodging[id] ?? 0) + 1; saw('travel_style', 'trip_input'); }
        }
        for (const n of list(a.noWayJose)) {
          const id = NO_GO_ID[str(n)];
          if (!id) continue;
          noGo.set(id, (noGo.get(id) ?? 0) + 1);
          saw('no_go', 'trip_input');
          const tag = NO_GO_TAG[id];
          if (tag) { add(minus, tag, 1); saw('avoid', 'trip_input'); }
        }
        const pace = str(a.pace) as Pace;
        if (PACES.includes(pace)) { paceVotes.set(pace, (paceVotes.get(pace) ?? 0) + w); saw('pace', 'trip_input'); }
        const energy = str(a.nightEnergy) as NightEnergy;
        if (ENERGIES.includes(energy)) { energyVotes.set(energy, (energyVotes.get(energy) ?? 0) + w); saw('nightlife', 'trip_input'); }
        const posture = perDayPosture(a.budget, a.nights);
        if (posture) { postureVotes.set(posture, (postureVotes.get(posture) ?? 0) + w); saw('budget_posture', 'trip_input'); }
        break;
      }
      case 'feedback_done': {
        // "Already done it": they went, so it is their sort of thing.
        const tag = tagOf(d.vertical);
        if (tag) { add(plus, tag, 0.8 * w); saw('interests', 'feedback_done'); }
        break;
      }
      case 'feedback_not_interested': {
        // "Not for me": an explicit avoid. Not decayed — it is their word
        // until they take it back, and taking it back removes the row.
        const tag = tagOf(d.vertical);
        if (tag) { add(minus, tag, 1); saw('avoid', 'feedback_not_interested'); }
        break;
      }
      case 'itinerary_item_swapped': {
        // What they swapped in is what they wanted. What they swapped out is
        // not an avoid — a swap says "not this one", not "never this kind".
        add(plus, tagOf(d.to_interest), 0.6 * w);
        if (tagOf(d.to_interest)) saw('interests', 'itinerary_item_swapped');
        break;
      }
      case 'dates_offered': {
        const dow = Number(d.weekday_start);
        if (Number.isInteger(dow) && dow >= 1 && dow <= 7) {
          datesOffered++;
          if (dow >= 4 && dow <= 6) weekendStarts++;
          saw('time_prefs', 'dates_offered');
        }
        break;
      }
      case 'plan_created': {
        const kind = str(d.kind);
        if (d.solo === true) social.solo_plans++; else if (d.solo === false) social.group_plans++;
        if (kind === 'restaurant' || kind === 'night') social.nights_out++;
        else if (kind) social.trips++;
        const n = Number(d.nights);
        if (kind && kind !== 'restaurant' && kind !== 'night' && Number.isFinite(n) && n > 0) {
          nights.push(n);
          saw('time_prefs', 'plan_created');
        }
        saw('social', 'plan_created');
        break;
      }
      case 'booked': {
        const city = str(d.city).slice(0, 60);
        if (city) {
          const country = str(d.country).toUpperCase().slice(0, 2) || null;
          const key = `${city.toLowerCase()}|${country ?? ''}`;
          const e = been.get(key) ?? { city, country, plans: new Set<string>() };
          e.plans.add(String(s.plan_id ?? s.ref ?? ''));
          been.set(key, e);
          saw('places', 'booked');
        }
        break;
      }
      case 'vote': social.votes++; saw('social', 'vote'); break;
      case 'veto': social.vetoes++; saw('social', 'veto'); break;
      // skip, recommendation_dismissed (the same tap as the feedback row),
      // quiz_dial_adjusted (the dial lands in traveler_profile) and
      // next_trip_started_from_close are counted, not interpreted.
      default: break;
    }
  }

  // An explicit avoid beats a positive: anything avoided leaves interests.
  // Drinks are never written as an avoid (see the header).
  const avoid: Record<string, number> = {};
  const maxMinus = Math.max(0, ...minus.values());
  for (const [tag, v] of [...minus.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    if (DRINKS.has(tag)) continue;
    avoid[tag] = r2(v / maxMinus);
  }
  for (const tag of minus.keys()) plus.delete(tag);

  const ranked = [...plus.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12);
  const top = ranked[0]?.[1] ?? 0;
  const interests: Record<string, number> = Object.fromEntries(ranked.map(([k, v]) => [k, r2(v / top)]));
  const mass = ranked.reduce((n, [, v]) => n + v, 0);
  const share = (pred: (t: string) => boolean) =>
    mass > 0 ? r2(ranked.filter(([k]) => pred(k)).reduce((n, [, v]) => n + v, 0) / mass) : null;

  const winner = <K extends string>(m: Map<K, number>): K | null =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

  const count = (facet: string) => Object.values(evidence[facet] ?? {}).reduce((n, v) => n + v, 0);
  const confidence: Record<string, number> = {};
  for (const [facet, enough] of Object.entries({
    interests: 8, avoid: 2, pace: 2, budget_posture: 2, nightlife: 2, travel_style: 3, time_prefs: 3, places: 1, social: 3, no_go: 1,
  })) confidence[facet] = r2(Math.min(1, count(facet) / enough));

  const profile: TasteProfile = {
    version: 1,
    interests,
    avoid,
    no_go: [...noGo.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k),
    pace: winner(paceVotes),
    budget_posture: winner(postureVotes),
    food: share(FOOD),
    nightlife: { energy: winner(energyVotes), share: share(NIGHT) },
    outdoors: share(OUTDOORS),
    culture: share(CULTURE),
    travel_style: { archetype, trip_types: tripTypes, lodging },
    time_prefs: {
      weekend_start_share: datesOffered ? r2(weekendStarts / datesOffered) : null,
      typical_nights: median(nights),
    },
    places: {
      been: [...been.values()]
        .map(e => ({ city: e.city, country: e.country, trips: e.plans.size }))
        .sort((a, b) => b.trips - a.trips || a.city.localeCompare(b.city))
        .slice(0, 20),
    },
    social,
    confidence,
    evidence,
  };
  return { profile, signal_count: signals.length, last_signal_at: last === null ? null : new Date(last).toISOString() };
}

/** A stored profile, checked enough to be read by the ranking. Null when it is not one. */
export function profileFrom(raw: unknown): TasteProfile | null {
  const p = obj(raw);
  if (p.version !== 1) return null;
  const nums = (v: unknown) => Object.fromEntries(
    Object.entries(obj(v)).filter(([k, n]) => tagOf(k) === k && typeof n === 'number' && Number.isFinite(n)),
  ) as Record<string, number>;
  const interests = nums(p.interests);
  const avoid = nums(p.avoid);
  for (const k of Object.keys(avoid)) delete interests[k];
  return { ...(p as unknown as TasteProfile), interests, avoid };
}

// ─── The database side ──────────────────────────────────────────────────

const WRITE_CHUNK = 200;

export interface DistillReport {
  distilled: number;
  skipped_excluded: number;
  purged_excluded: number;
  purged_stale: number;
  rows_read: number;
  truncated: boolean;
  errors: string[];
}

/**
 * Distil every person's signals and store the profiles. Folded into the daily
 * /api/cron/knowledge run. Never throws: every failure is a line in the
 * report, and a part that fails does not stop the parts after it.
 */
export async function distillAll(
  db: SupabaseClient,
  opts: { budgetMs?: number; maxRows?: number; now?: number } = {},
): Promise<DistillReport> {
  const now = opts.now ?? Date.now();
  const deadline = now + (opts.budgetMs ?? 60_000);
  const report: DistillReport = {
    distilled: 0, skipped_excluded: 0, purged_excluded: 0, purged_stale: 0, rows_read: 0, truncated: false, errors: [],
  };
  const fail = (what: string, e: { code?: string; message?: string } | null | undefined) => {
    const line = `${what}: ${`${e?.code ?? ''} ${e?.message ?? 'unknown'}`.trim()}`;
    console.error('[taste-profile]', line);
    report.errors.push(line.slice(0, 200));
  };

  try {
    // Who must not have one: anybody scheduled for deletion (the view already
    // hides their signals; this removes what an earlier run wrote) and
    // anybody who turned personalised recommendations off.
    const { data: deleting, error: delErr } = await db.from('users').select('id').not('deletion_scheduled_at', 'is', null);
    if (delErr) fail('could not read who is being deleted', delErr);
    const { data: optedOut, error: optErr } = await db.from('users').select('id').eq('consent_personalized', false);
    if (optErr) fail('could not read who opted out', optErr);
    const excluded = new Set<string>([...(deleting ?? []), ...(optedOut ?? [])].map(r => String((r as { id: string }).id)));

    if (excluded.size) {
      const ids = [...excluded];
      for (let i = 0; i < ids.length; i += WRITE_CHUNK) {
        const chunk = ids.slice(i, i + WRITE_CHUNK);
        const { error: p1, count } = await db.from('user_taste_profile').delete({ count: 'exact' }).in('user_id', chunk);
        if (p1) fail('could not purge profiles', p1);
        else report.purged_excluded += count ?? 0;
        const { error: p2 } = await db.from('taste_profile_ids').delete().in('user_id', chunk);
        if (p2) fail('could not purge profile ids', p2);
      }
    }

    // Retention: nothing new from somebody in two years, nothing kept — the
    // profile and the pseudonym that maps it back to their users.id.
    const cutoff = new Date(now);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS);
    const { data: staleRows, error: staleErr } = await db.from('user_taste_profile')
      .delete().lt('last_signal_at', cutoff.toISOString()).select('user_id');
    if (staleErr) fail('could not apply retention', staleErr);
    else {
      const staleIds = (staleRows ?? []).map(r => String((r as { user_id: string }).user_id));
      report.purged_stale = staleIds.length;
      for (let i = 0; i < staleIds.length; i += WRITE_CHUNK) {
        const { error } = await db.from('taste_profile_ids').delete().in('user_id', staleIds.slice(i, i + WRITE_CHUNK));
        if (error) fail('could not purge stale profile ids', error);
      }
    }

    const read = await readSignals(db, { maxRows: opts.maxRows ?? 50_000, deadline });
    report.rows_read = read.rows;
    report.truncated = read.truncated;
    // A failed page leaves byUser holding everyone read before it, the person
    // it cut off already dropped (lib/signals.ts), so the rest are whole.
    if (read.error) fail('could not read v_taste_signals', { message: read.error });

    const rows: Array<Record<string, unknown>> = [];
    for (const [userId, signals] of read.byUser) {
      if (excluded.has(userId)) { report.skipped_excluded++; continue; }
      const d = distill(signals, now);
      // Retention again: a person whose newest signal is already past the
      // cutoff is not written back in the same run that deleted them.
      if (d.last_signal_at && d.last_signal_at < cutoff.toISOString()) continue;
      rows.push({
        user_id: userId,
        profile: d.profile,
        model_version: MODEL_VERSION,
        signal_count: d.signal_count,
        last_signal_at: d.last_signal_at,
        distilled_at: new Date(now).toISOString(),
      });
    }

    // One row per person is guaranteed by the grouping above, so no upsert
    // names a row twice (Postgres refuses that).
    for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
      const chunk = rows.slice(i, i + WRITE_CHUNK);
      const { error: wrote } = await db.from('user_taste_profile').upsert(chunk, { onConflict: 'user_id' });
      if (wrote) { fail('could not store profiles', wrote); continue; }
      report.distilled += chunk.length;
      // The pseudonym, made once and never changed: ignoreDuplicates keeps
      // an existing profile_id rather than minting a new one.
      const { error: ids } = await db.from('taste_profile_ids')
        .upsert(chunk.map(r => ({ user_id: r.user_id })), { onConflict: 'user_id', ignoreDuplicates: true });
      if (ids) fail('could not store profile ids', ids);
    }
  } catch (e) {
    fail('distill stopped', { message: e instanceof Error ? e.message : String(e) });
  }
  return report;
}

/**
 * Delete one person's profile and pseudonym, at the moment they ask to be
 * deleted rather than thirty days later when the user row goes (both tables
 * cascade from it). Never throws. A purge that fails is said out loud, and
 * the next distill purges anybody scheduled for deletion anyway, so it cannot
 * stay failed for longer than a day — and v_taste_signals stops returning
 * their rows the moment deletion_scheduled_at is set, so nothing rebuilds it.
 */
export async function purgeProfile(db: SupabaseClient, userId: string, label: string): Promise<boolean> {
  try {
    const { error: p1 } = await db.from('user_taste_profile').delete().eq('user_id', userId);
    const { error: p2 } = await db.from('taste_profile_ids').delete().eq('user_id', userId);
    // A table that is not there holds nothing to purge.
    const real = [p1, p2].filter(e => e && !/^(PGRST205|42P01)$/.test(String(e.code)));
    if (real.length) {
      console.error(`[${label}] could not purge the taste profile`, { user: userId, codes: real.map(e => e!.code) });
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[${label}] could not purge the taste profile`, { user: userId, error: e instanceof Error ? e.message : 'unknown' });
    return false;
  }
}

/**
 * One person's stored profile, for the ranking. Null when there is none, the
 * table is not there, or anything at all goes wrong: a recommendation without
 * the profile is the one Home showed before it existed.
 */
export async function readProfile(db: SupabaseClient, userId: string): Promise<TasteProfile | null> {
  try {
    const { data, error } = await db.from('user_taste_profile').select('profile').eq('user_id', userId).maybeSingle();
    if (error) {
      if (!/PGRST205|user_taste_profile/i.test(`${error.code} ${error.message}`)) {
        console.error('[taste-profile] could not read a profile', { code: error.code });
      }
      return null;
    }
    return profileFrom((data as { profile?: unknown } | null)?.profile);
  } catch {
    return null;
  }
}
