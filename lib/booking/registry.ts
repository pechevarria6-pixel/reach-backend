// ─── Who books what — one list ───────────────────────────────────────────
// Quoting and booking each kept their own map of providers, and they had
// drifted: /api/bookings quoted flights with Duffel while /approve booked
// them with Kiwi — a dormant integration that invents a date of birth
// (1990-01-01) and calls everybody "mr". A comment beside the Duffel entry
// said "nothing routes to it". Approval did.
//
// One map, imported by both, so the provider that prices a thing is the one
// that books it. tests/unit/provider-registry.test.ts fails if a route grows
// its own again.
import { usableTableProvider, type BookingProvider, type Vertical } from './types';
import { liteApiHotels } from './providers/hotels.liteapi';
import { duffelFlights } from './providers/flights.duffel';
import { viatorActivities, ticketmasterEvents, tableReservations } from './providers/rest';
import { yelpReservations } from './providers/tables.yelp';
import { openTableReservations } from './providers/tables.opentable';
import type { TablePlatform, TableProvider } from './tables/types';
import { pickTable } from './tables/pick';

export const PROVIDERS: Record<Vertical, BookingProvider> = {
  hotel: liteApiHotels,
  flight: duffelFlights,
  activity: viatorActivities,
  event: ticketmasterEvents,
  // The member books their own table, on the platform the restaurant uses
  // and with their own card, so their card's dining benefits survive.
  restaurant: tableReservations,
};

// ─── Restaurants Reach books itself ──────────────────────────────────────
// The two platforms that let a partner book a table in-app. Each is off
// until its credentials are set (enabled()), and is used only for a
// restaurant whose id on it we already hold, from a link the restaurant or
// the map published (venueIdFrom). Everything else stays with
// `restaurant` above: the member books on the restaurant's own platform, and
// "Book on your own OpenTable/Resy" sits beside Reach's button either way.
//
// OpenTable first: when a restaurant's links name both, its larger network
// is the one more likely to have the table.
export const TABLE_PROVIDERS: Record<TablePlatform, TableProvider> = {
  opentable: openTableReservations,
  yelp: yelpReservations,
};

/**
 * The platform Reach can book this restaurant on now, and its id there — or
 * null. Off, not allowed (a Yelp business outside the test list), or no id
 * we hold: all null, and the screen keeps the hand-off.
 */
export function tableProviderFor(
  urls: readonly (string | null | undefined)[],
  env: NodeJS.ProcessEnv = process.env,
): { provider: TableProvider; venueId: string } | null {
  return pickTable(Object.values(TABLE_PROVIDERS), urls, env);
}

/** The platform a table was booked on, from the row's provider. */
export function tableProviderNamed(name: unknown): TableProvider | null {
  return name === 'yelp' || name === 'opentable' ? TABLE_PROVIDERS[name] : null;
}

/**
 * Transitional (rebase of the orchestrator onto the table providers): the
 * orchestrator's quote/book contract is not the providers' hold/reserve one,
 * so nothing is offered instantly until the next commit wires the two.
 */
export function tableProvider(_platform: string | null | undefined, registry: Partial<Record<string, BookingProvider>> = {}): BookingProvider | null {
  return usableTableProvider(_platform ? registry[_platform] : undefined);
}
