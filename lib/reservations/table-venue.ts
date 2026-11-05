// ─── What a table's venue facts may come from ───────────────────────────
// The platform a table is booked on, its id there (carried in the booking
// link tableProviderFor reads), the hand-off link and the number to ring.
//
// Each of them came from a lookup by name near the trip, at /bookable and
// again at reserve time — so a chain's other branch, the same name a few
// miles off, could supply the OpenTable or Yelp id, and Reach would book a
// table at the wrong address under the person's name. They now come only
// from the exact row the line cites (lib/discovery/held-venue.ts
// heldVenueByRef), or from the line's own fields, which name the place the
// line is about. A platform named on the booking row by an earlier name
// lookup is not trusted: no cited row, no instant booking — the person is
// handed the line's own link or number instead, which is the honest answer.
//
// Pure, with relative imports, so the rule is tested where it is decided.
import { reservationUrl, usableStoredUrl, type Platform } from '../booking/reservations.ts';

const PLATFORMS = new Set(['resy', 'opentable', 'tock', 'sevenrooms', 'yelp', 'thefork']);

export interface CitedVenue {
  reservation_platform: string | null;
  reservation_url: string | null;
  phone: string | null;
  website?: string | null;
}

export interface VenueFacts {
  platform: Platform;
  /** The links an instant booking may read a platform id from: the cited row's, and nothing else. */
  urls: (string | null)[];
  reserveUrl: string | null;
  phone: string | null;
  /**
   * Their own homepage, held apart from reserveUrl: a homepage says nothing
   * about whether they take tables online, so it is offered as "their
   * website", never "Book on their site".
   */
  website: string | null;
}

/** An http(s) address we can link to, or null. A homepage: nothing more is claimed of it. */
function homepage(u: unknown): string | null {
  const raw = String(u ?? '').trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try { new URL(raw); return raw; } catch { return null; }
}

export function tableVenueFacts(input: {
  /** The row the line cites, by id — never one found by name. */
  venue: CitedVenue | null;
  line: { venue_website?: string | null; venue_phone?: string | null } | null;
  /** The booking's request, for a row with no line left: its stored number only. */
  stored: { phone?: string | null } | null;
  restaurant: string; city: string | null; date: string | null; time: string | null; partySize: number;
}): VenueFacts {
  const { venue, line } = input;
  const held = String(venue?.reservation_platform ?? '');
  const platform = (PLATFORMS.has(held) ? held : 'none') as Platform;
  const known = venue?.reservation_url ?? null;
  const reserveUrl = reservationUrl(platform, {
    name: input.restaurant, city: input.city, date: input.date, time: input.time, partySize: input.partySize, knownUrl: known,
  })
    ?? usableStoredUrl('none', known)
    // The line's own site, only where it is itself a booking page.
    ?? usableStoredUrl('none', line?.venue_website ?? null)
    ?? null;
  // The cited row's homepage, or the line's own, as the menu row gave it.
  const website = homepage(venue?.website) ?? homepage(line?.venue_website);
  return {
    platform,
    urls: venue ? [venue.reservation_url ?? null] : [],
    reserveUrl,
    website: website && website !== reserveUrl ? website : null,
    phone: venue?.phone ?? line?.venue_phone ?? (line ? null : input.stored?.phone ?? null),
  };
}
