// ─── Trip generation shapes ──────────────────────────────────────────────
// Two representations of the same contract, kept in one file so they cannot
// drift apart unseen: a JSON Schema that constrains what the model generates,
// and a zod schema that validates what comes back. tests/unit/trip-schema
// asserts the two agree.
import { z } from 'zod';
import { IdeaClimateShape } from './contracts/idea-climate.ts';

// Declaring the schema means the model cannot return prose, a markdown fence
// or a truncated object: the API constrains generation to match. The old code
// stripped ```json fences, hunted for the first { and last }, and on failure
// ran a regex over the raw text to salvage a trips array. None of that is
// needed now, and none of it was reliable.
export const CostLine = z.object({
  per_person: z.number(),
  details: z.string(),
});

// Exactly the fields the UI renders — no more. The old prompt also asked for
// country, highlight, weather and visa, which nothing has ever displayed.
export const TripSchema = z.object({
  id: z.string(),
  destination: z.string(),
  // The place, in the two parts a provider can actually search on. The
  // destination string is for people — "Moab, Utah, USA" — and no hotel API
  // takes it. Parsing it back apart with a regex is the kind of guess this
  // codebase keeps removing, so the model states them instead: it knows the
  // country of the place it just chose.
  // nullish, not optional: a model that has no country to give sends null
  // rather than leaving the key out, and optional() rejects that outright —
  // losing the whole trip over a field nothing depends on.
  city: z.string().nullish(),
  // A blank is no answer, not a wrong one: "" failed length(2) and took a
  // whole night out's options with it.
  country_code: z.preprocess(v => (typeof v === 'string' && !v.trim() ? null : v), z.string().length(2).nullish()),
  emoji: z.string(),
  tagline: z.string(),
  vibe: z.string(),
  why_this_group: z.string(),
  food_scene: z.string(),
  music_scene: z.string(),
  total_per_person: z.number(),
  tier: z.enum(['saver', 'on_budget', 'stretch']),
  // Which member's own words this option answers, and how. Asked for only
  // when somebody actually wrote something, and nullish rather than optional
  // so a model that has nothing to say sends null instead of omitting the
  // key — losing a whole trip over an empty list would be a poor trade.
  used_suggestions: z.array(z.string()).nullish(),
  costs: z.object({
    flights: CostLine,
    // The card shows the example hotel or area here, not the details line.
    accommodation: CostLine.extend({ example: z.string() }),
    ground_transport: CostLine,
    food_drink: CostLine,
    activities: CostLine,
    misc: CostLine,
  }),
});

export const TripsSchema = z.object({ trips: z.array(TripSchema) });

/**
 * What the route attaches to a trip idea after the model has answered, and
 * never asks the model for — so these are not in TRIPS_JSON_SCHEMA, and the
 * test that keeps the two schemas equal is about the model's part only.
 * Listed here so the whole shape of an idea is written down in one file.
 *
 *   climate  NASA POWER averages for the idea's dates (lib/climate.ts
 *            ideaClimate), and whether a weather no-go was checked.
 */
export const TripAttachments = z.object({ climate: IdeaClimateShape.nullish() });
export const ATTACHED_TRIP_FIELDS = Object.keys(TripAttachments.shape) as Array<keyof typeof TripAttachments.shape>;

// Each slot carries how you get in and what they take, not just what it is.
// Reach books whatever it can; for everything else the traveller has to be
// told the practical details up front, or a good suggestion still ends with
// somebody at a door that only takes cash.
export const SlotSchema = z.object({
  plan: z.string(),
  // What this one thing costs per person. The budget screen itemises every
  // event rather than showing a percentage split of the total, so each slot
  // has to carry its own number. 0 means genuinely free, not unknown.
  cost: z.number(),
  // reach  — Reach will book this for you
  // ahead  — needs reserving in advance, but not through Reach
  // walk_in— just turn up
  booking: z.enum(['reach', 'ahead', 'walk_in']),
  // Free text because the real world is not an enum: "Cash only",
  // "Cards, no Amex", "Contactless everywhere", "Cash for the boat".
  //
  // Nullable, and that is the whole point. This was a required string, so a
  // model that did not know what a restaurant took still had to write
  // something, and it wrote "Cash only at Milt's" in Reach's own voice with
  // nothing behind it. Checked against the sources afterwards: the venue is
  // real, and no source we hold records its payment at all.
  //
  // A required field cannot be answered honestly by a party that does not
  // know the answer. So null is a permitted answer here, it means nobody has
  // checked yet, and lib/discovery/verify.ts fills it in from a source that
  // actually says — or leaves it empty, which the screen can live with.
  payment: z.string().nullish(),
  // Which verified place this names, as [ref] from the list the prompt was
  // given. Empty when the slot names no venue at all — a walk, a drive, a
  // morning off — which is a good answer and not a missing one.
  //
  // This is what makes "only real places" checkable rather than hoped for.
  // The route resolves it against the list it handed over, and a slot whose
  // plan names a business it cannot resolve does not go out as written.
  place_ref: z.string().nullish(),
  // Where the ticket is actually sold, and the venue selling it. Never
  // written by the model — attached by the route from a listing we read, so
  // it is a fact or it is absent.
  ticket_url: z.string().nullish(),
  venue: z.string().nullish(),
  // The place's own site, for a slot that names a verified one. Attached by
  // the route from the row we matched, never written by the model — so it is
  // the real address or it is absent. Every venue we hold has one.
  place_url: z.string().nullish(),
  /** What is on at that place, in its own words. Attached by the route. */
  whats_on: z.string().nullish(),
  /** The place's number, dialable. Attached by the route from the row, never by the model. */
  place_phone: z.string().nullish(),
  /**
   * A photo of the place or act this line names, and whose it is. Attached
   * by the route from the row it cited or the listing that sells the
   * ticket, never by the model — so it is of that place or it is absent.
   */
  place_photo: z.string().nullish(),
  place_photo_credit: z.string().nullish(),
  /** What the photo is of — the act, or the place — for its alt text. Attached by the route. */
  place_photo_of: z.string().nullish(),
  /** The photo's page (a Commons file), so its credit can be followed. Attached by the route. */
  place_photo_link: z.string().nullish(),
  // Whose wish this answers, when it answers one. "Peter asked for one big
  // night out." Nullish rather than optional: plenty of a good day is just a
  // good day, and a model with nothing to say should send null rather than
  // invent a reason or omit the key and lose the whole slot.
  because: z.string().nullish(),
  /**
   * A tip about this one slot — getting there, the time of day, the weather,
   * what to bring. Written by the model, about this slot and nothing else;
   * empty when there is nothing true to say.
   *
   * It was `insider_tip` on the day, and the day's last slot wore it. Plan
   * f979c880 put "the monuments near the Mall are spread further apart than
   * the map suggests" under SPIN, a cocktail bar on F Street, because that
   * was Day 1's evening. It was saved as the bar's own description and read
   * as one. A tip lives on the slot it is about, so it cannot land on
   * another.
   */
  tip: z.string().nullish(),
  /**
   * What the place this slot names is, from the row it cites — "bar",
   * "museum". Attached by the route, never by the model; null for a slot
   * that names no place. The slot's type comes from this rather than from
   * its position, which typed a bar "restaurant" for being the evening.
   */
  kind: z.string().nullish(),
});

export const ItineraryDaySchema = z.object({
  day: z.number(),
  title: z.string(),
  morning: SlotSchema,
  afternoon: SlotSchema,
  evening: SlotSchema,
  cost_today: z.number(),
  // No insider_tip. It was the day's, and printed under the day's last slot
  // as though it described that place — see SlotSchema.tip. An older answer
  // still carrying one parses: zod drops a key it was not told about.
  /**
   * What the day around it could be, for an evening only.
   *
   * A night out is one evening and was being answered with a whole day —
   * pottery in the morning, lunch, then dinner — for somebody who asked for
   * a drink with a friend. The evening is the answer; the day is an offer,
   * kept apart so it can be shown behind "let's make a day of it" rather
   * than assumed on somebody's behalf.
   *
   * Empty on a trip, where every day is already a day.
   */
  daytime: z.array(SlotSchema).optional().default([]),
});

export const ItinerarySchema = z.object({ itinerary: z.array(ItineraryDaySchema) });

// The wire format the API constrains generation to. Written by hand rather
// than derived, because the SDK's zod helper targets zod 4 and this project
// is on zod 3; the zod schemas above still validate what comes back.
const str = { type: 'string' } as const;
const num = { type: 'number' } as const;
const costLine = {
  type: 'object',
  properties: { per_person: num, details: str },
  required: ['per_person', 'details'],
  additionalProperties: false,
} as const;

export const TRIPS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    trips: {
      type: 'array',
      // No minItems/maxItems: the API rejects any minItems above 1 with
      // "For 'array' type, 'minItems' values other than 0 or 1 are not
      // supported". The count is asked for in the prompt and checked in the
      // route instead.
      items: {
        type: 'object',
        properties: {
          id: str, destination: str, emoji: str, tagline: str, vibe: str,
          city: str, country_code: str,
          why_this_group: str, food_scene: str, music_scene: str,
          total_per_person: num,
          // Price diversity is a product principle, not a suggestion: a saver
          // option, one on budget, and a stretch. Making it an enum in the
          // schema is what stops three near-identical mid-range trips.
          tier: { type: 'string', enum: ['saver', 'on_budget', 'stretch'] },
          // Named, so that "we heard you" is a field somebody can read rather
          // than a hope. Without it, whether the model used what a person
          // wrote varied run to run: one answered a fortieth birthday in
          // every option, the next never mentioned it.
          used_suggestions: { type: 'array', items: str },
          costs: {
            type: 'object',
            properties: {
              flights: costLine,
              accommodation: {
                type: 'object',
                properties: { per_person: num, details: str, example: str },
                required: ['per_person', 'details', 'example'],
                additionalProperties: false,
              },
              ground_transport: costLine,
              food_drink: costLine, activities: costLine, misc: costLine,
            },
            required: ['flights', 'accommodation', 'ground_transport', 'food_drink', 'activities', 'misc'],
            additionalProperties: false,
          },
        },
        required: ['id', 'destination', 'city', 'country_code', 'emoji', 'tagline', 'vibe',
                   'why_this_group', 'food_scene', 'music_scene', 'total_per_person', 'tier', 'costs',
                   'used_suggestions'],
        additionalProperties: false,
      },
    },
  },
  required: ['trips'],
  additionalProperties: false,
} as const;

export const slot = {
  type: 'object',
  properties: {
    plan: str,
    cost: num,
    booking: { type: 'string', enum: ['reach', 'ahead', 'walk_in'] },
    // Same bargain as `because` below: required on the wire, empty when the
    // answer is not known. Empty means nobody has checked what this place
    // takes — it does not mean cash, and it does not mean cards. Verified
    // payment is filled in later from a source that actually records it.
    payment: str,
    // The [ref] of the verified place this slot names, or empty for a slot
    // that names none. Required on the wire so it cannot be skipped in
    // silence: a named venue with no ref is exactly the case worth catching.
    place_ref: str,
    // Required in the wire format so it cannot be quietly skipped, and
    // allowed to be empty: a day that answers nobody in particular should
    // say so rather than have a reason invented for it.
    because: str,
    // About this slot only, or empty. Same bargain again.
    tip: str,
  },
  required: ['plan', 'cost', 'booking', 'payment', 'place_ref', 'because', 'tip'],
  additionalProperties: false,
} as const;

export const ITINERARY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    itinerary: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day: num, title: str, morning: slot, afternoon: slot,
          // The offer, not the plan: what the day around an evening could
          // be, shown only if somebody asks for it. Empty on a trip.
          daytime: { type: 'array', items: slot },
          evening: slot, cost_today: num,
        },
        required: ['day', 'title', 'morning', 'afternoon', 'evening', 'cost_today', 'daytime'],
        additionalProperties: false,
      },
    },
  },
  required: ['itinerary'],
  additionalProperties: false,
} as const;

// Generation is schema-constrained, so this should never fail — but a hard
// rule says every parse of model output is guarded and logs a tail, and a
// guaranteed-safe parse costs nothing to guard.
export function parseModelJSON<T>(raw: string, schema: z.ZodType<T>, label: string): T | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error(`[${label}] JSON parse failed, len`, raw.length, 'tail:', raw.slice(-300));
    return null;
  }
  const checked = schema.safeParse(data);
  if (!checked.success) {
    console.error(`[${label}] shape did not validate:`, checked.error.issues.slice(0, 3));
    return null;
  }
  return checked.data;
}

/**
 * The trip options, each checked on its own.
 *
 * One option with a malformed field used to fail the whole response — a
 * night out in Charlotte came back as four options, the fourth with a blank
 * country code, and the person was told "No trips came back". A bad option
 * is dropped and logged; the good ones stand.
 */
export function parseTrips(raw: string, label: string): z.infer<typeof TripSchema>[] | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error(`[${label}] JSON parse failed, len`, raw.length, 'tail:', raw.slice(-300));
    return null;
  }
  const list = (data as { trips?: unknown })?.trips;
  if (!Array.isArray(list)) {
    console.error(`[${label}] no trips array in the response`);
    return null;
  }
  const kept: z.infer<typeof TripSchema>[] = [];
  list.forEach((t, i) => {
    const one = TripSchema.safeParse(t);
    if (one.success) kept.push(one.data);
    else console.error(`[${label}] dropped option ${i} that did not validate:`, one.error.issues.slice(0, 2));
  });
  return kept.length ? kept : null;
}

export function textOf(res: { content: Array<{ type: string; text?: string }> }): string {
  return res.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('');
}


// ─── Making the numbers agree ────────────────────────────────────────────
// A live generation returned four trips with one destination twice, and every
// trip's cost lines summed to less than its own headline total — Algarve came
// back at $2,380 with parts adding to $1,800. The schema cannot express "three
// distinct items" (an array minItems above 1 is rejected) and cannot express
// "these six numbers sum to that one", so both are enforced here.

// Every field is optional here because that is how zod infers the parsed
// shape, and because a model response is untrusted input regardless of what
// the schema asked for. Both functions below guard rather than assume.
type TripLike = {
  destination?: string;
  tier?: string;
  total_per_person?: number;
  costs?: Record<string, { per_person?: number } | undefined>;
};

/**
 * Scale a trip's cost lines so they sum to its headline total. The total is
 * the authoritative number — it drives budget comparison and what each person
 * is asked to pay — so the breakdown is what moves. Rounding drift lands on
 * `misc`, which is the buffer line and the only one nobody reads as a quote.
 */
export function reconcileCosts<T extends TripLike>(trip: T): T {
  const lines = Object.entries(trip.costs ?? {});
  if (!lines.length) return trip;
  const sum = lines.reduce((a, [, c]) => a + (c?.per_person ?? 0), 0);
  const total = trip.total_per_person;
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0 || sum <= 0 || sum === total) return trip;

  const scale = total / sum;
  const scaled = lines.map(([k, c]) =>
    [k, { ...(c ?? {}), per_person: Math.round((c?.per_person ?? 0) * scale) }] as const);
  const drift = total - scaled.reduce((a, [, c]) => a + (c.per_person ?? 0), 0);
  const miscIndex = scaled.findIndex(([k]) => k === 'misc');
  const absorb = miscIndex >= 0 ? miscIndex : scaled.length - 1;
  scaled[absorb] = [scaled[absorb][0], {
    ...scaled[absorb][1],
    per_person: Math.max(0, (scaled[absorb][1].per_person ?? 0) + drift),
  }] as const;

  return { ...trip, costs: Object.fromEntries(scaled) };
}

/**
 * Three distinct destinations, costs reconciled. Duplicates are dropped on
 * destination rather than id, because the model repeats the place while
 * giving it a fresh id.
 */
export function normalizeTrips<T extends TripLike>(trips: T[], samePlace = false): T[] {
  const seen = new Set<string>();
  const distinct: T[] = [];
  for (const trip of trips) {
    const key = (trip.destination ?? '').trim().toLowerCase();
    if (!key) continue;
    // Two options for the same destination are usually one option returned
    // twice — unless the group has already chosen where they are going, in
    // which case all three are meant to be the same place at three budgets.
    // Deduping on destination then threw away two of the three and showed
    // somebody a single "choice".
    if (!samePlace && seen.has(key)) continue;
    seen.add(key);
    distinct.push(reconcileCosts(trip));
  }
  // Prefer one of each tier when more than three survive, so trimming never
  // costs the price diversity the tiers exist to guarantee.
  if (distinct.length > 3) {
    const byTier: T[] = [];
    for (const tier of ['saver', 'on_budget', 'stretch']) {
      const hit = distinct.find(t => t.tier === tier);
      if (hit) byTier.push(hit);
    }
    for (const t of distinct) {
      if (byTier.length >= 3) break;
      if (!byTier.includes(t)) byTier.push(t);
    }
    return byTier.slice(0, 3);
  }
  return distinct;
}

/**
 * Filler a model writes to satisfy a required field it cannot really fill.
 * A schema can insist every slot has a plan; it cannot insist the plan names
 * somewhere real, and "placeholder" reached a live itinerary.
 */
const FILLER = /^\s*(placeholder|tbd|n\/?a|none|activity|event|lunch|dinner|breakfast|free time|explore|relax|tba|-+)\s*$/i;

export function isFiller(text: unknown): boolean {
  const t = String(text ?? '').trim();
  return !t || t.length < 4 || FILLER.test(t);
}

/** Drops any day that contains filler, rather than saving a hole. */
export function dropFillerDays<T extends { morning?: any; afternoon?: any; evening?: any }>(days: T[]): T[] {
  return (days || []).filter(d =>
    ![d.morning, d.afternoon, d.evening].some(s => isFiller(typeof s === 'string' ? s : s?.plan)));
}
