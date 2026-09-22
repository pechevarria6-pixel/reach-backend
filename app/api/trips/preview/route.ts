// ─── POST /api/trips/preview — the real trip behind an option ────────────
// Body: { city, countryCode, start, end, seats }
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

const Body = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  seats: z.number().int().min(1).max(20).nullish(),
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
  if (start < today()) return NextResponse.json({ error: 'Those dates have passed — pick new ones to see prices.' }, { status: 400 });

  const { data: me } = await ctx.db.from('users').select('home_airport').eq('id', ctx.user.id).maybeSingle();
  const home = me?.home_airport ?? null;
  const key = JSON.stringify([ctx.user.id, home, city, countryCode, start, end, seats]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TEN_MINUTES) return NextResponse.json(hit.body);

  const rooms = Math.max(1, Math.ceil(seats / 2));
  const base = { vertical: 'hotel' as const, planId: '', groupId: '', travelers: [] };

  const [landed, hotels] = await Promise.all([
    home ? arrivalFor({ city, countryCode, home, start, end, seats }) : Promise.resolve(null),
    hotelOptions({ ...base, hotel: { city, countryCode, checkin: start, checkout: end, rooms } }, 3),
  ]);
  const flights = landed && home
    ? await flightOptions({ ...base, vertical: 'flight',
        flight: { origin: home, destination: landed.iata, departDate: start, returnDate: end !== start ? end : undefined, seats } }, 3)
    : { error: home ? `We could not find an airport near ${city}.` : 'Add your home airport in Profile to see flights.', options: [] };

  const body = {
    from: home,
    to: landed?.iata ?? null,
    gateway: landed?.gateway ?? null,
    seats, rooms,
    flights: flights.options, flightsWhy: flights.error,
    hotels: hotels.options, hotelsWhy: hotels.error,
    car: landed?.gateway ? { url: carRentalUrl(landed.iata, start, end), from: landed.gateway } : null,
  };
  cache.set(key, { at: Date.now(), body });
  return NextResponse.json(body);
}
