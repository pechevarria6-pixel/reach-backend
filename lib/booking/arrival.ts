// ─── Where a trip lands ──────────────────────────────────────────────────
// The town's own airport when an airline sells to it; otherwise the nearest
// airport that has flights from home on those dates, with the rental car
// taking it from there. Used by the booking bridge and by the three trip
// options people compare before they pick, so both land in the same place.
import { resolveAirport, nearestAirports, flightOptions, type Gateway } from './providers/flights.duffel';
import { locate } from '../discovery/geocode';
import type { BookingItemRequest } from './types';

export interface Arrival { iata: string; gateway: Gateway | null }

export async function arrivalFor(opts: {
  city: string; countryCode?: string | null; named?: string | null;
  home?: string | null; start?: string | null; end?: string | null; seats?: number;
}): Promise<Arrival | null> {
  const city = (opts.city || '').trim();
  const cc = (opts.countryCode || '').trim().toUpperCase();
  const direct = city
    ? (await resolveAirport([city, cc].filter(Boolean).join(', '))) ?? (cc ? await resolveAirport(city) : null)
    : opts.named ? await resolveAirport(opts.named) : null;
  if (direct) return { iata: direct, gateway: null };
  if (!city) return null;

  const here = await locate(city, cc || null);
  if (!here) return null;
  // Nearest is not the same as served. Rincón's nearest airport is MAZ, a
  // commuter field; BQN, a few miles further, is where mainland flights land.
  // The three nearest are tried in order and the first with any flight from
  // home on these dates wins. Without a home airport, nearest stands.
  const near = (await nearestAirports(here)).slice(0, 3);
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
