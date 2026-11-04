// ─── What OpenStreetMap already says about booking a table ──────────────
// Every restaurant row carries the tags its map entry was loaded with, and
// some of those tags answer the question the platforms cron spends a page
// fetch on — without fetching anything:
//
//   reservation=no                     they do not take bookings
//   reservation:website=<url>          where they take them
//   reservation:phone=<number>         the number for a table, as such
//
// Counted on 2026-11-04 among the 229,253 restaurants held: 10,375 carry a
// `reservation` tag (1,201 of them "no") and 360 a `reservation:website`.
// The research note that put `reservation:website` at 10,375 had asked
// PostgREST for `osm_tags->>reservation:website` unquoted, which reads the
// key as `reservation` — the quoted key is the real count.
//
// What is NOT taken from the map: `reservation=yes|required|recommended` on
// its own. That says they take bookings, not how, and "call to book" read off
// it would be two facts sitting near each other — the guess
// reservations.ts exists to refuse. Those wait for their own page to say.
//
// A map entry is a person who went there writing down what they saw. It is
// a row we hold, the same source the venue itself comes from, and it is
// recorded as `reservation_source = 'osm'` so it can be told apart from what
// the restaurant's own page said.
import type { ReservationFinding } from './reservations.ts';
import { ownBookingUrl, platformBookingUrl } from './booking-links.ts';
import { dialable } from '../discovery/phone.ts';

export interface OsmVenue {
  name?: string | null;
  website?: string | null;
  phone?: string | null;
  osm_tags?: Record<string, unknown> | null;
  countries?: string[] | null;
}

const tag = (tags: Record<string, unknown>, key: string): string =>
  String(tags[key] ?? '').split(';')[0].trim();

/**
 * How this restaurant takes bookings according to its map entry, or null
 * when the map does not settle it. Never 'unknown': an unsettled venue is a
 * null for the crawl to pick up, not an answer.
 */
export function reservationFromOsm(venue: OsmVenue): ReservationFinding | null {
  const tags = (venue.osm_tags && typeof venue.osm_tags === 'object') ? venue.osm_tags : {};
  const country = venue.countries?.[0] ?? null;
  const phone = dialable(venue.phone, country);

  // A link to the platform, from the map or as the venue's own website (a
  // few restaurants' only web presence is their OpenTable page). A link that
  // names the restaurant on the platform is the same proof it is on a page.
  for (const raw of [tag(tags, 'reservation:website'), tag(tags, 'reservation:url'), String(venue.website ?? '')]) {
    if (!raw) continue;
    const onPlatform = platformBookingUrl(raw, undefined, venue.name);
    if (onPlatform) return { method: 'third_party', platform: onPlatform.platform, url: onPlatform.url, phone };
  }

  // Their own booking page, only if it is on their own site (or a booking
  // engine) and about tables. Gee's map entry gives its brunch menu as the
  // reservation website; that is a mapper's slip, not a form.
  const own = tag(tags, 'reservation:website') || tag(tags, 'reservation:url');
  if (own) {
    const url = ownBookingUrl(own, venue.website ?? own);
    if (url && !/wait-?list/i.test(url)) return { method: 'own_form', platform: 'none', url, phone };
  }

  const value = tag(tags, 'reservation').toLowerCase();
  // A dedicated number for a table, which is one fact rather than two.
  const forTables = dialable(tag(tags, 'reservation:phone'), country);
  if (forTables && value !== 'no') return { method: 'phone', platform: 'none', url: null, phone: forTables };

  // "Mo-Th" and other free text are not an answer; only the documented values are.
  if (value === 'no') return { method: 'walk_in', platform: 'none', url: null, phone };
  return null;
}
