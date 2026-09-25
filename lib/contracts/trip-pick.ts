// ─── A recommended trip, defined once ───────────────────────────────────
// The card on Home travels three layers:
//
//   what pickTrips builds                 lib/recommendations/trip-picks.ts
//   what the route sends                  app/api/recommendations/trips
//   what the Home card and the plan flow  components/reach-app.jsx
//   read off it
//
// The dominant bug here is a fact held correctly and dropped one layer
// short of the screen. So the route parses its answer through this before
// sending it, and the client parses what it receives through the same
// schema: a field added here arrives on the card, and a field renamed on
// one side is a card that does not render rather than one that renders
// with a hole in it.
import { z } from 'zod';

export const TripPickSchema = z.object({
  /** recommendation_feedback.item_ref, "trip:<candidate key>" (town|country, and the US state when known). */
  ref: z.string().min(1),
  band: z.enum(['night', 'weekend', 'away']),
  /** The kind of plan CreatePlanFlow starts on. */
  planType: z.enum(['restaurant', 'weekend', 'trip']),
  /**
   * What the Where step is pre-filled with. `city` is what the plan saves as
   * destination_city and the itinerary geocodes, so it carries the state
   * when one is known ("Aberdeen, North Carolina").
   */
  destination: z.object({
    city: z.string().min(1),
    country: z.string().nullable(),
    label: z.string().min(1),
  }),
  /** A site outside the town that people go for, e.g. Machu Picchu. */
  site: z.string().nullable(),
  /** 0 for an evening. Suggested length, never dates. */
  nights: z.number().int().min(0),
  miles: z.number().min(0),
  title: z.string().min(1),
  who: z.string().min(1),
  /** Counts of the venues we hold there. Always present: no holdings, no card. */
  held: z.string().min(1),
  /** Which of their answers it matches; null when none do. */
  matched: z.string().nullable(),
  /** A veto that took something out of the counts; null when none did. */
  leftOut: z.string().nullable(),
  /** A no-go about the place that nothing we hold could check, said plainly. */
  unchecked: z.string().nullable(),
  /**
   * A picture of the place. Optional: the destination-photo work fills it;
   * until then every card has none and draws without one. When present it
   * carries its credit, because the licence asks for it.
   */
  photo: z.object({
    url: z.string().url(),
    alt: z.string().min(1),
    credit: z.string().nullable(),
  }).nullable().optional(),
  /**
   * When the weather is usually best there, from the averages we hold:
   * "Best weather in Moab: April–May, September–October". Information only —
   * never a check that a no-go passed. Absent when nothing is held.
   */
  weather: z.object({ line: z.string().min(1), credit: z.string().min(1) }).nullable().optional(),
  howFar: z.string().min(1),
  /** An estimate, and labelled as one on the card. Never a price. */
  cost: z.object({
    low: z.number().min(0),
    high: z.number().min(0),
    each: z.boolean(),
    label: z.string().min(1),
  }),
  cta: z.string().min(1),
  /** The group the plan starts in, when the card was chosen for one. */
  groupId: z.string().nullable(),
  score: z.number(),
});
export type TripPickData = z.infer<typeof TripPickSchema>;

export const TripPicksResponse = z.object({
  picks: z.array(TripPickSchema),
  /** Why there are none, when there are none. */
  reason: z.enum(['no_location', 'nothing_held', 'all_dismissed']).nullable(),
  /** Where the distances were measured from, as the card should say it. */
  from: z.string().nullable(),
});
export type TripPicksResponseData = z.infer<typeof TripPicksResponse>;

/**
 * The route's answer, parsed for the browser. A card that does not match
 * the contract is left out, and the log says so, rather than rendered with
 * a missing line.
 */
export function picksFrom(json: unknown): TripPicksResponseData {
  const raw = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const picks: TripPickData[] = [];
  for (const p of Array.isArray(raw.picks) ? raw.picks : []) {
    const r = TripPickSchema.safeParse(p);
    if (r.success) picks.push(r.data);
    else console.error('[trip-picks] a card did not match the contract', r.error.issues.map(i => i.path.join('.')));
  }
  const reason = TripPicksResponse.shape.reason.safeParse(raw.reason ?? null);
  return {
    picks,
    reason: reason.success ? reason.data : null,
    from: typeof raw.from === 'string' ? raw.from : null,
  };
}

/**
 * What CreatePlanFlow is started with from a card. The destination, the
 * kind of plan, the suggested length and the group — nothing about dates,
 * which are theirs to choose.
 */
export interface PlanSeed {
  planType: TripPickData['planType'];
  where: { city: string; country: string | null; label: string };
  nights: number;
  groupId: string | null;
  planName: string;
}

export function seedFromPick(p: TripPickData): PlanSeed {
  return {
    planType: p.planType,
    where: { city: p.destination.city, country: p.destination.country, label: p.destination.label },
    nights: p.nights,
    groupId: p.groupId,
    planName: p.title,
  };
}
