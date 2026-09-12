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

export const ItineraryDaySchema = z.object({
  day: z.number(),
  title: z.string(),
  morning: z.string(),
  afternoon: z.string(),
  evening: z.string(),
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
      minItems: 3,
      maxItems: 3,
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

export const ITINERARY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    itinerary: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day: num, title: str, morning: str, afternoon: str,
          evening: str, cost_today: num, insider_tip: str,
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

