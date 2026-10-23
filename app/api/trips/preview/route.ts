// ─── POST /api/trips/preview — the real trip behind an option ────────────
// Body: { city, countryCode, start, end, seats, tier?, flying? }
//
//   tier    the option's tier. Flights and hotels come back ranked by its
//           rule (lib/away-lines.ts TIER_TRAVEL) — a saver's cheapest
//           with-a-stop, a stretch's nonstop at sociable hours and a
//           four-star — each saying whether it fits (`fitsTier`). Without
//           one, cheapest first, as before.
//   flying  how many of the seats are on the flight. Somebody driving or
//           already holding a flight is off it (decision 8); 0 means
//           nobody is flying, and no flight is searched for. The rooms are
//           still for everybody.
//
// The three options people compare carry the model's estimates: a flight
// "about $400", a hotel it names as an example. Nobody should choose a trip
// on that alone. This asks the providers what is actually on sale for those
// dates — the cheapest few flights from the traveller's home airport, the
// cheapest few hotels by name with a photo, and the rental car when the
// flight lands at an airport that is not in the town — so an option can be
// judged on what Reach would really book.
//
// Read-only: nothing is quoted onto a plan and nothing is held. Answers are
// kept for ten minutes, because people flick between three cards.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, isFail } from '@/lib/auth';
import { arrivalFor } from '@/lib/booking/arrival';
import { flightOptions } from '@/lib/booking/providers/flights.duffel';
import { hotelOptions } from '@/lib/booking/providers/hotels.liteapi';
import { carRentalUrl } from '@/lib/ground';
import { today } from '@/lib/calendar';
import { TIER_TRAVEL, flightsForTier, hotelsForTier, nightsWord, type Tier } from '@/lib/away-lines';
import { nightsBetween } from '@/lib/away';

const Body = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  seats: z.number().int().min(1).max(20).nullish(),
  tier: z.enum(['saver', 'on_budget', 'stretch']).nullish(),
  flying: z.number().int().min(0).max(20).nullish(),
});

const cache = new Map<string, { at: number; body: unknown }>();
const TEN_MINUTES = 600_000;

export async function POST(req: NextRequest) {
  const ctx = await requireUser();
  if (isFail(ctx)) return ctx.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'That trip is missing its place or its dates.' }, { status: 400 });
  const { city, countryCode, start, end } = parsed.data;
  const seats = parsed.data.seats ?? 1;
  const tier: Tier | null = parsed.data.tier ?? null;
  // Never more on the flight than are going.
  const flying = Math.min(seats, parsed.data.flying ?? seats);
  if (start < today()) return NextResponse.json({ error: 'Those dates have passed — pick new ones to see prices.' }, { status: 400 });

  const { data: me } = await ctx.db.from('users').select('home_airport').eq('id', ctx.user.id).maybeSingle();
  const home = me?.home_airport ?? null;
  const key = JSON.stringify([ctx.user.id, home, city, countryCode, start, end, seats, tier, flying]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TEN_MINUTES) return NextResponse.json(hit.body);

  const rooms = Math.max(1, Math.ceil(seats / 2));
  const base = { vertical: 'hotel' as const, planId: '', groupId: '', travelers: [] };

  // A tier is chosen from a wider look: the three cheapest are rarely the
  // three a stretch would fly.
  const wide = tier && tier !== 'saver' ? 12 : 3;
  const nights = nightsBetween(start, end) ?? 0;
  const [landed, hotelsAll] = await Promise.all([
    // The airport is wanted even with nobody flying: the rental car is
    // picked up there.
    home ? arrivalFor({ city, countryCode, home, start, end, seats: Math.max(1, flying) }) : Promise.resolve(null),
    nights >= 1
      ? hotelOptions({ ...base, hotel: { city, countryCode, checkin: start, checkout: end, rooms } }, wide)
      : Promise.resolve({ error: 'A day trip has no night to sleep.', options: [] }),
  ]);
  const flightsAll = flying < 1
    ? { error: 'Nobody on this one is flying.', options: [] }
    : landed && home
      ? await flightOptions({ ...base, vertical: 'flight',
          flight: { origin: home, destination: landed.iata, departDate: start, returnDate: end !== start ? end : undefined, seats: flying } }, wide)
      : { error: home ? `We could not find an airport near ${city}.` : 'Add your home airport in Profile to see flights.', options: [] };
  const flights = { ...flightsAll, options: tier ? flightsForTier(flightsAll.options, tier, 3) : flightsAll.options.slice(0, 3) };
  const hotels = { ...hotelsAll, options: tier ? hotelsForTier(hotelsAll.options, tier, 3) : hotelsAll.options.slice(0, 3) };

  const body = {
    from: home,
    to: landed?.iata ?? null,
    gateway: landed?.gateway ?? null,
    seats, rooms, flying,
    // What the tier means, so the screen can say why these and not the
    // cheapest. Live prices, not estimates: these are what is on sale now.
    tier, travel: tier ? TIER_TRAVEL[tier] : null,
    stay: nights >= 1 ? { nights, label: nightsWord(nights), checkin: start, checkout: end } : null,
    flights: flights.options, flightsWhy: flights.error,
    hotels: hotels.options, hotelsWhy: hotels.error,
    car: landed?.gateway ? { url: carRentalUrl(landed.iata, start, end), from: landed.gateway } : null,
  };
  cache.set(key, { at: Date.now(), body });
  return NextResponse.json(body);
}
