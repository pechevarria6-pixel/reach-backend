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
import type { BookingProvider, Vertical } from './types';
import { liteApiHotels } from './providers/hotels.liteapi';
import { duffelFlights } from './providers/flights.duffel';
import { viatorActivities, ticketmasterEvents, tableReservations } from './providers/rest';

export const PROVIDERS: Record<Vertical, BookingProvider> = {
  hotel: liteApiHotels,
  flight: duffelFlights,
  activity: viatorActivities,
  event: ticketmasterEvents,
  // The member books their own table, on the platform the restaurant uses
  // and with their own card, so their card's dining benefits survive.
  restaurant: tableReservations,
};
