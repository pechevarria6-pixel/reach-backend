// ─── Whole-house rentals: deep links, nothing else ───────────────────────
// Reach does not book these and does not pretend to. Airbnb and Vrbo have no
// partner API we can use, and scraping either — directly or through one of the
// paid "Airbnb API" services — is off the table: it breaks their terms, it
// breaks without warning, and it would put invented prices in front of people
// who are about to spend real money.
//
// So this builds a search link carrying everything the plan already knows —
// where, which nights, how many people — and the person books on the site
// itself. A link whose parameters have drifted still lands on that site's own
// search, which is a worse answer than a prefilled one and a much better
// answer than a wrong one.

export type RentalSearch = {
  /** Town or city, as a person would type it. */
  location: string;
  /** ISO YYYY-MM-DD. Both or neither: a one-sided range prefills nothing. */
  checkin?: string | null;
  checkout?: string | null;
  adults?: number | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A usable pair of nights, or nothing. */
function nights(checkin?: string | null, checkout?: string | null): [string, string] | null {
  if (typeof checkin !== 'string' || typeof checkout !== 'string') return null;
  if (!ISO.test(checkin) || !ISO.test(checkout)) return null;
  // A checkout on or before the arrival is a typo, and sending it would land
  // on an error page rather than a search.
  if (checkout <= checkin) return null;
  return [checkin, checkout];
}

/** Both sites cap a party size long before this; 16 is Airbnb's own ceiling. */
function party(adults?: number | null): number | null {
  if (typeof adults !== 'number' || !Number.isFinite(adults)) return null;
  const n = Math.round(adults);
  return n >= 1 ? Math.min(n, 16) : null;
}

function place(location: string): string | null {
  const trimmed = (location || '').trim();
  return trimmed ? trimmed.slice(0, 120) : null;
}

/**
 * Airbnb's own search path: /s/<place>/homes, with the dates and party size
 * as query parameters. The place sits in the path, so it is encoded as a path
 * segment — a comma in "Aberdeen, NC" is legal there and reads correctly.
 */
export function airbnbSearchUrl(search: RentalSearch): string | null {
  const where = place(search.location);
  if (!where) return null;
  const url = new URL(`https://www.airbnb.com/s/${encodeURIComponent(where)}/homes`);
  const when = nights(search.checkin, search.checkout);
  if (when) {
    url.searchParams.set('checkin', when[0]);
    url.searchParams.set('checkout', when[1]);
  }
  const people = party(search.adults);
  if (people) url.searchParams.set('adults', String(people));
  return url.toString();
}

/**
 * Vrbo keeps everything in the query string. Its date parameters have been
 * renamed more than once, so both the current pair and the older one are sent:
 * the site ignores what it does not recognise, and a stale client still lands
 * on a prefilled search rather than the homepage.
 */
export function vrboSearchUrl(search: RentalSearch): string | null {
  const where = place(search.location);
  if (!where) return null;
  const url = new URL('https://www.vrbo.com/search');
  url.searchParams.set('destination', where);
  const when = nights(search.checkin, search.checkout);
  if (when) {
    url.searchParams.set('startDate', when[0]);
    url.searchParams.set('endDate', when[1]);
    url.searchParams.set('d1', when[0]);
    url.searchParams.set('d2', when[1]);
  }
  const people = party(search.adults);
  if (people) url.searchParams.set('adults', String(people));
  return url.toString();
}

/** Both links for one plan, for the lodging card. */
export function rentalLinks(search: RentalSearch) {
  const airbnb = airbnbSearchUrl(search);
  const vrbo = vrboSearchUrl(search);
  if (!airbnb && !vrbo) return [];
  return [
    airbnb && { provider: 'Airbnb', url: airbnb },
    vrbo && { provider: 'Vrbo', url: vrbo },
  ].filter(Boolean) as { provider: string; url: string }[];
}

/**
 * When a whole house is worth suggesting at all. Five people is where hotel
 * rooms start multiplying and a kitchen starts mattering; below that the
 * card is noise on a screen that already has hotels on it.
 */
export const RENTAL_GROUP_SIZE = 5;

export function shouldOfferRentals(travellers: number, asked = false): boolean {
  return asked || (Number.isFinite(travellers) && travellers >= RENTAL_GROUP_SIZE);
}
