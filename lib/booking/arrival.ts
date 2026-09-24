// ─── Where a trip lands ──────────────────────────────────────────────────
// The town's own airport when an airline sells to it; otherwise the nearest
// airport that has flights from home on those dates, with the rental car
// taking it from there. Used by the booking bridge and by the three trip
// options people compare before they pick, so both land in the same place.
import { resolveAirportAt, nearestAirports, flightOptions, type Gateway } from './providers/flights.duffel.ts';
import { locate } from '../discovery/geocode.ts';
import { haversineMiles } from '../discovery/distance.ts';
import { worldDestination } from '../discovery/world-destinations.ts';
import type { BookingItemRequest } from './types.ts';

export interface Arrival { iata: string; gateway: Gateway | null }

/**
 * How far a town's "own" airport may be before it is somebody else's.
 *
 * A name search matches names, not places: "Valladolid" — where people
 * sleep for Chichén Itzá — is also Spain's VLL, and "Aguas Calientes", the
 * town under Machu Picchu, is a space away from Aguascalientes, Mexico.
 * Either would have sold a group a flight to the wrong continent. A city
 * code's airports sit well inside this: Stansted is 35 miles from London.
 */
export const OWN_AIRPORT_MILES = 75;

export async function arrivalFor(opts: {
  city: string; countryCode?: string | null; named?: string | null;
  home?: string | null; start?: string | null; end?: string | null; seats?: number;
}): Promise<Arrival | null> {
  const city = (opts.city || '').trim();
  const cc = (opts.countryCode || '').trim().toUpperCase();
  // A world destination is placed from its own coordinates, not the geocoder
  // — but only when the plan names a country and it agrees. A name alone is
  // not a place: "Athens, GA" and a Spanish "Valladolid" saved without a
  // country are namesakes of towns on the list, and pinning them to Greece
  // or Yucatán would throw out their own airport and fly the group abroad.
  const known = city && /^[A-Z]{2}$/.test(cc) ? worldDestination(city, cc) : null;
  let here: { lat: number; lng: number } | null = known ? { lat: known.lat, lng: known.lng } : null;
  let asked = !!known;
  const town = async () => {
    if (!asked) { asked = true; here = await locate(city, cc || null); }
    return here;
  };

  const direct = city
    ? (await resolveAirportAt([city, cc].filter(Boolean).join(', '))) ?? (cc ? await resolveAirportAt(city) : null)
    : opts.named ? await resolveAirportAt(opts.named) : null;
  if (direct) {
    // Checked only when both ends have a point. A town the geocoder cannot
    // place keeps the answer it always had rather than losing its flight.
    const at = city && direct.lat != null && direct.lng != null ? await town() : null;
    const miles = at ? haversineMiles(at, { lat: direct.lat as number, lng: direct.lng as number }) : 0;
    if (miles <= OWN_AIRPORT_MILES) return { iata: direct.iata, gateway: null };
    console.warn('[arrival] the name matched a far airport; using the nearest instead', { iata: direct.iata, miles: Math.round(miles) });
  }
  if (!city) return null;

  const point = await town();
  if (!point) return null;
  // Nearest is not the same as served. Rincón's nearest airport is MAZ, a
  // commuter field; BQN, a few miles further, is where mainland flights land.
  // The three nearest are tried in order and the first with any flight from
  // home on these dates wins. Without a home airport, nearest stands.
  const near = (await nearestAirports(point)).slice(0, 3);
  if (!near.length) return null;
  if (opts.home && opts.start) {
    for (const g of near) {
      const probe = await flightOptions({
        vertical: 'flight', planId: '', groupId: '', travelers: [],
        flight: { origin: opts.home, destination: g.iata, departDate: opts.start,
          ...(opts.end && opts.end !== opts.start ? { returnDate: opts.end } : {}), seats: opts.seats ?? 1 },
      } as BookingItemRequest, 1);
      if (probe.options.length) return { iata: g.iata, gateway: g };
    }
  }
  return { iata: near[0].iata, gateway: near[0] };
}
