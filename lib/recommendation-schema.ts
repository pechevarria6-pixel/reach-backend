// ─── Experience recommendations ──────────────────────────────────────────
// Reach plans experiences, not only travel: a dinner, a gig, a weekend, a
// fortnight. This is the shape all four share.
//
// The trip path learned these lessons the hard way and this one had not: ask
// for JSON in a prompt and you spend your time fighting the answer, so the
// schema constrains generation instead. And every suggestion carries what it
// costs, whether Reach can book it, and what the place actually takes —
// because finding out at the door that it is cash only is the failure this
// product exists to prevent.
import { z } from 'zod';
import { splitVetoes, weatherLine } from './weather-no-go.ts';

export const RecommendationSchema = z.object({
  title: z.string(),
  sub: z.string(),
  emoji: z.string(),
  // Per person, whole dollars. A free gig is 0, not "free".
  cost: z.number(),
  reason: z.string(),
  highlights: z.array(z.string()),
  booking: z.enum(['reach', 'ahead', 'walk_in']),
  payment: z.string(),
});

export const RecommendationsSchema = z.object({
  recommendations: z.array(RecommendationSchema),
});

const str = { type: 'string' } as const;
const num = { type: 'number' } as const;

export const RECOMMENDATIONS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: str, sub: str, emoji: str, cost: num, reason: str,
          highlights: { type: 'array', items: str },
          booking: { type: 'string', enum: ['reach', 'ahead', 'walk_in'] },
          payment: str,
        },
        required: ['title', 'sub', 'emoji', 'cost', 'reason', 'highlights', 'booking', 'payment'],
        additionalProperties: false,
      },
    },
  },
  required: ['recommendations'],
  additionalProperties: false,
} as const;

/**
 * "Avoid: …" for the getaway and trip briefs. A weather no-go is never in
 * it: nothing here holds climate data, so "Avoid: Cold weather" would be a
 * rule the model is trusted to keep and nothing checks. It goes as the same
 * wish-not-a-rule line the trip generator uses (lib/weather-no-go.ts). A
 * create-plan draft saved before the chip was hidden still carries one.
 */
export function avoidLine(dealbreakers: unknown): string {
  const all = (Array.isArray(dealbreakers) ? dealbreakers : []).map(String).filter(Boolean);
  const { hard, weather } = splitVetoes(all);
  return `Avoid: ${hard.join(', ') || 'nothing'}.${weatherLine(weather)}`;
}

/** What each kind of experience is, in the words its own world uses.
 *
 * `location` is never defaulted. It used to read `near ${v.location || 'the
 * city'}`, and the client never sent one — so every dinner and every gig was
 * asked for "near the city" and the model picked a famous one. A pilot user in
 * Aberdeen, North Carolina was recommended restaurants in San Francisco. The
 * route refuses to call the model without a place now, so these can state it
 * plainly. */
export const EXPERIENCE_BRIEF: Record<string, (v: Record<string, unknown>) => string> = {
  restaurant: v => `Six restaurants for a group dinner.
Cuisine: ${v.cuisine || 'any'}. Atmosphere: ${v.vibe || 'casual'}.
About $${v.budget || 100} a head, ${v.travelers || 4} people, in or near ${v.location}.
Real places in ${v.location} itself — somewhere they can drive to this evening,
not a city they would have to fly to.
"sub" is cuisine and neighbourhood. "booking" is "reach" when a table can be
reserved, "walk_in" for somewhere that does not take them.`,

  concert: v => `Six gigs or shows for a night out.
Genre: ${v.genre || 'any'}. Budget about $${v.budget || 150} a head,
${v.travelers || 4} people, in or near ${v.location}.
Venues in ${v.location} itself, or close enough to drive to and back in a night.
"sub" is genre and venue. Most tickets are "ahead" — say so.`,

  weekend: v => `Six weekend getaways, two or three nights.
Vibe: ${v.vibe || 'mixed'}. Staying in: ${v.accommodation || 'a hotel'}.
About $${v.budget || 500} each for the weekend, ${v.travelers || 4} people,
leaving from ${v.location}. ${avoidLine(v.dealbreakers)}
"sub" is the length and the character of the place.`,

  trip: v => `Six destinations for a ${v.nights || 7}-night trip.
Vibe: ${v.vibe || 'mixed'}. Style: ${v.destStyle || 'city'}. Staying in: ${v.accommodation || 'a hotel'}.
About $${v.budget || 2000} each, ${v.travelers || 4} travelling, from ${v.location}.
${avoidLine(v.dealbreakers)}
"sub" is the nights and the character of the place.`,
};
