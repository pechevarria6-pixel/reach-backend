// ─── The weather on a trip idea, defined once ───────────────────────────
// The route attaches `climate` to each trip idea (lib/climate.ts
// ideaClimate); the ideas travel in the response, are saved whole in
// plans.trip_options for a group, and come back to the card on every load.
// Saved JSON is only as good as whoever wrote it last, so the card reads it
// through this and gets a well-formed IdeaClimate or null — never a line
// built from half an object, and never a "checked" that was not.
import { z } from 'zod';
import type { IdeaClimate } from '../climate.ts';

const num = z.number().finite();

const TripClimateShape = z.object({
  place: z.string(),
  months: z.array(z.object({ month: num.int().min(1).max(12), nights: num.int().min(1), rainPlace: z.string().nullable() })).min(1),
  when: z.string().min(1),
  highC: num, lowC: num, highF: num, lowF: num,
  highCExact: num.nullish(),
  lowsReliable: z.boolean().nullish(),
  rainMmDay: num.min(0),
  rainMm: num.min(0).nullish(),
  label: z.string(),
  lead: z.object({
    month: num, monthName: z.string(), highC: num, lowC: num, highF: num, lowF: num,
    rainMm: num, rainIn: num, rainClass: z.string(), rainPlace: z.string().nullable(),
    humidity: num.nullable(), label: z.string(), comfort: num,
  }),
  inWettest: z.array(num),
  cold: z.boolean(), hot: z.boolean(),
  highGround: z.boolean(), gridElevationM: num.nullable(),
  source: z.string().min(1), period: z.string().min(1),
});

export const IdeaClimateShape = z.object({
  place: z.string(),
  held: z.boolean(),
  trip: TripClimateShape.nullable(),
  best: z.string().nullable(),
  credit: z.string(),
  asked: z.boolean(),
  checked: z.boolean(),
  dates: z.object({ start: z.string().nullable(), end: z.string().nullable() }).nullish(),
  wants: z.object({ cold: z.boolean(), heat: z.boolean() }).nullish(),
  breach: z.enum(['coldWeather', 'extremeHeat']).nullish(),
}).refine(c => !c.held || !!c.credit, { message: 'held climate carries its source' })
  .refine(c => c.held || !c.checked, { message: 'nothing held cannot have been checked' })
  .refine(c => !c.breach || (c.held && !!c.trip && c.checked), { message: 'a breach is a verdict on dates, from climate held' });

/** A trip idea's climate as the card may use it, or null. */
export function ideaClimateFrom(raw: unknown): IdeaClimate | null {
  if (raw == null) return null;
  const r = IdeaClimateShape.safeParse(raw);
  return r.success ? (r.data as IdeaClimate) : null;
}
