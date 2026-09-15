// ─── Trip generation shapes ──────────────────────────────────────────────
// Two representations of the same contract, kept in one file so they cannot
// drift apart unseen: a JSON Schema that constrains what the model generates,
// and a zod schema that validates what comes back. tests/unit/trip-schema
// asserts the two agree.
import { z } from 'zod';

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
  emoji: z.string(),
  tagline: z.string(),
  vibe: z.string(),
  why_this_group: z.string(),
  food_scene: z.string(),
  music_scene: z.string(),
  total_per_person: z.number(),
  tier: z.enum(['saver', 'on_budget', 'stretch']),
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
  payment: z.string(),
});

export const ItineraryDaySchema = z.object({
  day: z.number(),
  title: z.string(),
  morning: SlotSchema,
  afternoon: SlotSchema,
  evening: SlotSchema,
  cost_today: z.number(),
  insider_tip: z.string(),
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
          why_this_group: str, food_scene: str, music_scene: str,
          total_per_person: num,
          // Price diversity is a product principle, not a suggestion: a saver
          // option, one on budget, and a stretch. Making it an enum in the
          // schema is what stops three near-identical mid-range trips.
          tier: { type: 'string', enum: ['saver', 'on_budget', 'stretch'] },
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
        required: ['id', 'destination', 'emoji', 'tagline', 'vibe', 'why_this_group',
                   'food_scene', 'music_scene', 'total_per_person', 'tier', 'costs'],
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
    payment: str,
  },
  required: ['plan', 'cost', 'booking', 'payment'],
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
          evening: slot, cost_today: num, insider_tip: str,
        },
        required: ['day', 'title', 'morning', 'afternoon', 'evening', 'cost_today', 'insider_tip'],
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
export function normalizeTrips<T extends TripLike>(trips: T[]): T[] {
  const seen = new Set<string>();
  const distinct: T[] = [];
  for (const trip of trips) {
    const key = (trip.destination ?? '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
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
