// ─── FLIGHTS — Duffel (native) ───────────────────────────────────────────
// Written against one real offer request rather than the documentation,
// because three times now the documentation has not been the thing that
// runs: an offerId that lived on the room type and not the rate, a
// `travelers` array that was undefined, a search that matched on one shared
// word. /api/health/providers?sample=duffel is what printed the shape below,
// and it is worth re-running whenever this file stops working.
//
//   POST /air/offer_requests?return_offers=true  → offers, priced, held
//   POST /air/orders                             → the ticket
//
// Two things about Duffel that the types do not tell you:
//   * total_amount is a decimal STRING ("240.84"), not a number
//   * an offer expires, often within the hour, and a group takes longer than
//     that to agree on anything — so book() re-requests rather than trusting
//     a stored price. What it re-requests is pinned: the same flights on the
//     same fare terms (lib/booking/pin.ts), or nothing
import type { BookingProvider, BookingItemRequest, BookingItemResult, CancelResult } from '../types.ts';
import { commitFetch, overMax, OutcomeUnknown } from '../types.ts';
import {
  amountToCents, offerExpired, duffelGender, toDuffelPassenger,
  describeOffer, flightIdent, describeConditions, departed, offerKey, offerOption, isOrderId, airlineSite, type DuffelPassenger,
} from '../duffel-map.ts';
import { headcount } from '../party.ts';

/**
 * Seats: the party the flight is for. It was `travelers.length`, and nobody
 * is named when a trip is priced, so every group's fare was for one seat.
 */
function seatsFor(req: BookingItemRequest): number {
  return headcount({ party: req.party ?? req.flight?.seats, travelers: req.travelers });
}

const BASE = process.env.DUFFEL_BASE || 'https://api.duffel.com';
const VERSION = 'v2';

function headers() {
  return {
    Authorization: `Bearer ${process.env.DUFFEL_API_KEY}`,
    'Duffel-Version': VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/** A live token is the one credential here that can spend real money. */
function liveToken(): boolean {
  return (process.env.DUFFEL_API_KEY ?? '').startsWith('duffel_live_');
}

function fail(error: string, raw?: unknown): BookingItemResult {
  return { vertical: 'flight', mode: 'native', status: 'failed', provider: 'duffel', error, raw };
}

/**
 * Duffel's errors are an array of objects with a title and a message. The
 * message is the useful half; the raw array can quote the request back,
 * including passenger details, so only the titles travel to a screen.
 */
function duffelError(json: unknown): string {
  const errors = (json as { errors?: { title?: string; message?: string }[] } | null)?.errors;
  if (!Array.isArray(errors) || !errors.length) return 'The airline refused this booking.';
  return errors.map(e => e.message || e.title).filter(Boolean).join('; ').slice(0, 200);
}

type Offer = {
  id: string;
  total_amount?: string;
  total_currency?: string;
  expires_at?: string;
  owner?: { name?: string; conditions_of_carriage_url?: string | null };
  passengers?: { id: string }[];
  slices?: unknown[];
  // What you are actually agreeing to. A real offer came back saying changes
  // were not allowed and a refund cost $40 — which is the sort of thing a
  // group should be told before it pays, not after somebody's plans change.
  conditions?: {
    change_before_departure?: { allowed?: boolean; penalty_amount?: string | null; penalty_currency?: string | null };
    refund_before_departure?: { allowed?: boolean; penalty_amount?: string | null; penalty_currency?: string | null };
  };
  payment_requirements?: {
    requires_instant_payment?: boolean;
    payment_required_by?: string | null;
    price_guarantee_expires_at?: string | null;
  };
};

/**
 * The airport a destination means, or nothing.
 *
 * A plan stores "Moab, Utah, USA" and an airline sells between IATA codes.
 * Duffel's own place lookup is asked rather than a table in this repo,
 * because codes get reassigned and airports open.
 *
 * Two things a real lookup showed, both of which matter:
 *   "Moab, Utah, USA"  → nothing at all. Plenty of good trips are to places
 *                        you drive to, and the honest answer is no flight.
 *   "Raleigh"          → RDU, and then BKW, which is Raleigh County in West
 *                        Virginia. First-by-relevance is right, and a
 *                        destination this ambiguous is why we never silently
 *                        pick the second.
 */
const airportCache = new Map<string, AirportHit | null>();

/** The code a place resolved to, and where Duffel says it is, when it says. */
export interface AirportHit { iata: string; lat: number | null; lng: number | null }

export async function resolveAirport(place: string): Promise<string | null> {
  return (await resolveAirportAt(place))?.iata ?? null;
}

/**
 * resolveAirport with the airport's own coordinates, so a caller that knows
 * where the town is can check the answer is anywhere near it. A name search
 * matches names: "Valladolid" is a city in Yucatán and an airport in Spain,
 * and "Aguas Calientes" is one space away from Aguascalientes, Mexico.
 */
export async function resolveAirportAt(place: string, fetchImpl: typeof fetch = fetch): Promise<AirportHit | null> {
  const query = (place || '').trim();
  if (!query) return null;
  if (airportCache.has(query)) return airportCache.get(query) ?? null;
  if (!process.env.DUFFEL_API_KEY) return null;

  let found: AirportHit | null = null;
  try {
    const res = await fetchImpl(
      `${BASE}/places/suggestions?query=${encodeURIComponent(query)}`,
      { headers: headers(), signal: AbortSignal.timeout(8000) },
    );
    if (res.ok) {
      const json = await res.json().catch(() => null);
      type Place = { type?: string; iata_code?: string; latitude?: number | null; longitude?: number | null; airports?: Place[] };
      const places = (json?.data ?? []) as Place[];
      // An airport is sellable as itself. A city is sellable by its own code
      // when it has one — that is how "all airports in London" is bought.
      const hit = places.find(p => p.type === 'airport' && p.iata_code)
        ?? places.find(p => p.iata_code);
      const code = hit?.iata_code ?? hit?.airports?.[0]?.iata_code ?? null;
      const at = [hit, hit?.airports?.[0]].find(p => Number.isFinite(p?.latitude) && Number.isFinite(p?.longitude));
      if (code) found = { iata: code, lat: at ? Number(at.latitude) : null, lng: at ? Number(at.longitude) : null };
    } else {
      console.error('[duffel] place lookup failed', { status: res.status });
    }
  } catch (e) {
    console.error('[duffel] place lookup unreachable', e instanceof Error ? e.message : String(e));
  }

  airportCache.set(query, found);
  return found;
}

/** An airport near somewhere, and how far it is as the crow flies. */
export interface Gateway { iata: string; name: string; miles: number }

/**
 * The airports nearest a point, closest first.
 *
 * For a town no airline sells to. "Moab, Utah" has no airport of its own in
 * Duffel's catalogue, and the answer used to be "this one looks like a
 * drive" — handing the hardest part of the journey back to the traveller.
 * Reach finds the nearest airports and puts a rental car on top of the
 * flight instead.
 *
 * Duffel's place lookup takes a point and a radius in metres (checked
 * against its reference, 2026-09-22). Distance is worked out here from the
 * coordinates it returns, not trusted to its ordering.
 */
export async function nearestAirports(
  point: { lat: number; lng: number },
  radiusMiles = 180,
  fetchImpl: typeof fetch = fetch,
): Promise<Gateway[]> {
  if (!process.env.DUFFEL_API_KEY) return [];
  const rad = Math.round(radiusMiles * 1609.34);
  try {
    const res = await fetchImpl(
      `${BASE}/places/suggestions?lat=${point.lat}&lng=${point.lng}&rad=${rad}`,
      { headers: headers(), signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) {
      console.error('[duffel] nearby airport lookup failed', { status: res.status });
      return [];
    }
    const json = await res.json().catch(() => null);
    const places = (json?.data ?? []) as {
      type?: string; iata_code?: string; name?: string; latitude?: number; longitude?: number;
    }[];
    const toRad = (d: number) => (d * Math.PI) / 180;
    const miles = (lat: number, lng: number) => {
      const dLat = toRad(lat - point.lat), dLng = toRad(lng - point.lng);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(point.lat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
      return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };
    return places
      .filter(p => p.type === 'airport' && p.iata_code && Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
      .map(p => ({ iata: p.iata_code as string, name: p.name || p.iata_code as string, miles: Math.round(miles(p.latitude as number, p.longitude as number)) }))
      .sort((a, b) => a.miles - b.miles);
  } catch (e) {
    console.error('[duffel] nearby airport lookup unreachable', e instanceof Error ? e.message : String(e));
    return [];
  }
}

/** One search, every offer, cheapest first. Duffel does not promise an order. */
async function searchOffers(f: NonNullable<BookingItemRequest['flight']>, seats: number) {
  const res = await fetch(`${BASE}/air/offer_requests?return_offers=true`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      data: {
        slices: [
          { origin: f.origin, destination: f.destination, departure_date: f.departDate },
          ...(f.returnDate
            ? [{ origin: f.destination, destination: f.origin, departure_date: f.returnDate }]
            : []),
        ],
        // One seat per traveller. Duffel prices per passenger object, so the
        // count here is what makes a total for the whole group.
        passengers: Array.from({ length: Math.max(1, seats) }, () => ({ type: 'adult' })),
        cabin_class: f.cabin === 'C' ? 'business' : f.cabin === 'F' ? 'first'
          : f.cabin === 'W' ? 'premium_economy' : 'economy',
      },
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) return { error: duffelError(json), offers: [] as Offer[] };
  const offers: Offer[] = json?.data?.offers ?? [];
  if (!offers.length) return { error: 'No flights found for those dates.', offers };
  return {
    error: null,
    offers: [...offers].sort(
      (a, b) => (amountToCents(a.total_amount) ?? Infinity) - (amountToCents(b.total_amount) ?? Infinity)),
  };
}

/**
 * The offer a quote is for: the flights somebody chose, if they chose, and
 * otherwise the cheapest. A chosen flight that is no longer on sale is said
 * plainly rather than swapped for a different one behind their back.
 *
 * The same flights are often sold on several fares — a basic one that cannot
 * be changed, a standard one that can. When the fare terms shown are pinned
 * (lib/booking/pin.ts), only an offer on exactly those terms will do: the
 * cheapest of those flights could be the basic fare the group never agreed
 * to. Pure, so a test can hold it to that.
 */
export function pickOffer<O extends { conditions?: Offer['conditions']; slices?: unknown[] }>(
  offers: O[], f: Pick<NonNullable<BookingItemRequest['flight']>, 'offerKey' | 'fareTerms'>,
): { error: string | null; offer: O | null } {
  if (!offers.length) return { error: 'No flights found.', offer: null };
  if (!f.offerKey) return { error: null, offer: offers[0] };
  const same = offers.filter(o => offerKey(o as Parameters<typeof offerKey>[0]) === f.offerKey);
  if (!same.length) return { error: 'The flights you chose are no longer on sale — pick another from the options.', offer: null };
  const shown = (f.fareTerms ?? []).filter(t => typeof t === 'string' && t.trim());
  if (!shown.length) return { error: null, offer: same[0] };
  const onTerms = same.find(o => describeConditions(o.conditions).join(' | ') === shown.join(' | '));
  if (!onTerms) {
    return { error: 'Those flights are no longer on sale on the fare you were shown — pick another from the options.', offer: null };
  }
  return { error: null, offer: onTerms };
}

async function cheapestOffer(f: NonNullable<BookingItemRequest['flight']>, seats: number) {
  const { error, offers } = await searchOffers(f, seats);
  if (error || !offers.length) return { error: error ?? 'No flights found.', offer: null as Offer | null };
  return pickOffer(offers, f);
}

/** Distinct flights for these dates, cheapest first — for choosing a different one. */
export async function flightOptions(req: BookingItemRequest, limit = 6) {
  const f = req.flight;
  if (!process.env.DUFFEL_API_KEY || !f) return { error: 'Flights are switched off.', options: [] };
  if (departed(f.departDate)) return { error: "This trip's dates have already passed.", options: [] };
  const { error, offers } = await searchOffers({ ...f, offerKey: undefined, fareTerms: undefined }, seatsFor(req));
  const seen = new Set<string>();
  const options = [];
  for (const o of offers) {
    const opt = offerOption(o as Parameters<typeof offerOption>[0]);
    if (!opt.key || seen.has(opt.key) || opt.priceCents === null) continue;
    seen.add(opt.key);
    options.push(opt);
    if (options.length >= limit) break;
  }
  return { error: options.length ? null : (error ?? 'No other flights found for those dates.'), options };
}

export const duffelFlights: BookingProvider = {
  vertical: 'flight',
  name: 'duffel',

  async quote(req): Promise<BookingItemResult> {
    if (!process.env.DUFFEL_API_KEY) {
      return fail('DUFFEL_API_KEY is not set — the flight lane is switched off.');
    }
    const f = req.flight;
    if (!f?.origin || !f?.destination || !f?.departDate) {
      return fail('A flight needs a departure airport, an arrival airport and a date.');
    }
    // Nobody sells a seat on a flight that has gone. Asking anyway earns
    // "Field 'departure_date' must be after 2026-09-17", which is a sentence
    // written for whoever wrote the API and not for whoever reads this app.
    if (departed(f.departDate)) {
      return fail("This trip's dates have already passed — pick new ones and we can price the flights.");
    }

    const { error, offer } = await cheapestOffer(f, seatsFor(req));
    if (error || !offer) return fail(error ?? 'No flights found.');

    const cents = amountToCents(offer.total_amount);
    if (cents === null) {
      // A flight with no readable price must not reach a checkout screen as
      // free. Better to fail loudly here than to charge nothing.
      console.error('[duffel] offer had no readable price', { offer: offer.id });
      return fail('The airline returned a price we could not read.');
    }

    return {
      vertical: 'flight', mode: 'native', status: 'quoted', provider: 'duffel',
      providerRef: offer.id,
      priceCents: cents,
      currency: offer.total_currency || 'USD',
      detail: describeOffer(offer as Parameters<typeof describeOffer>[0]),
      raw: {
        offerId: offer.id,
        // Held, and not for long. Stored so book() can tell a lapsed price
        // from a rejected one. A real offer held its price for about half an
        // hour while guaranteeing it for two days — they are different clocks
        // and this is the one that stops you booking.
        expiresAt: offer.expires_at ?? null,
        priceGuaranteedUntil: offer.payment_requirements?.price_guarantee_expires_at ?? null,
        passengerIds: (offer.passengers ?? []).map(p => p.id),
        flightIdent: flightIdent(offer as Parameters<typeof flightIdent>[0]),
        // Every flight number, both ways — what approval books.
        offerKey: offerKey(offer as Parameters<typeof offerKey>[0]),
        option: offerOption(offer as Parameters<typeof offerOption>[0]),
        // Shown before anyone pays a share towards it.
        conditions: describeConditions(offer.conditions),
        // Where this airline sells its own tickets, for a flight Reach cannot
        // buy — see airlineHandoff. From the airline's own page, never a guess.
        airlineSite: airlineSite(offer.owner?.conditions_of_carriage_url),
      },
    };
  },

  async book(req): Promise<BookingItemResult> {
    if (!process.env.DUFFEL_API_KEY) {
      return fail('DUFFEL_API_KEY is not set — the flight lane is switched off.');
    }
    // Every traveller must be real before an airline is asked for a ticket.
    // The readiness gate in /api/bookings should have caught this already;
    // this is the second lock, because the first one is a different file.
    if (!req.travelers?.length) {
      return fail('Nobody is named on this flight yet.');
    }

    const q = await this.quote(req);
    if (q.status !== 'quoted' || !q.providerRef) return q;

    // Never more than the group paid in. This prices the offer again, and
    // used to pay whatever came back: a fare that rose in the seconds after
    // approval checked it was paid for by Reach, with nobody told.
    if (overMax(q.priceCents, req.maxPriceCents)) {
      return fail(`The fare went up to $${((q.priceCents ?? 0) / 100).toFixed(2)} while this was being booked, which is more than the group paid in for it. Nothing was bought — check the new price and book it again.`);
    }

    const raw = q.raw as { expiresAt?: string | null; passengerIds?: string[] } | undefined;
    if (offerExpired(raw?.expiresAt)) {
      // Should not happen — the quote was made a moment ago — but an offer
      // that lapses between the two calls must not be paid for.
      return fail("That fare's offer lapsed while it was being booked, so nothing was bought. Price it again for a current fare.");
    }

    const passengerIds = raw?.passengerIds ?? [];
    // Exactly one seat per traveller. Fewer leaves somebody at the gate; more
    // is a seat bought for nobody, and Duffel refuses an order that does not
    // name every passenger the offer was priced for.
    if (passengerIds.length !== req.travelers.length) {
      return fail(`The fare was for ${passengerIds.length} ${passengerIds.length === 1 ? 'seat' : 'seats'} and ${req.travelers.length} ${req.travelers.length === 1 ? 'person is' : 'people are'} going — price it again for everyone.`);
    }

    const passengers: DuffelPassenger[] = [];
    let markerNotCarried = false;
    for (const [i, t] of req.travelers.entries()) {
      const who = [t.firstName, t.lastName].filter(Boolean).join(' ') || 'A traveller';
      const mapped = toDuffelPassenger(
        passengerIds[i],
        {
          firstName: t.firstName, lastName: t.lastName,
          dateOfBirth: t.dateOfBirth, gender: (t as { gender?: string }).gender,
          email: t.email, phone: t.phone,
        },
        who,
      );
      if (mapped.ok === false) {
        // A blank on a form is theirs to fill in, and saying which one is
        // the useful thing to do.
        if (mapped.problem !== 'gender') return fail(mapped.why);
        // An X marker is not a blank. The passport is right and the
        // automated channel is what is narrow: Duffel takes m or f and
        // nothing else.
        markerNotCarried = true;
        continue;
      }
      passengers.push(mapped.passenger);
    }

    // This used to come back as a 'pending' concierge booking carrying the
    // fare, so the group paid for a seat that no process anywhere would
    // book. /api/bookings now hands such a flight to the airline's own site
    // when it is quoted, with no price on it, so this is only reached when a
    // marker changed after the quote. Nobody is named: the response is read
    // by the whole group, and a passport marker is not theirs to learn here.
    if (markerNotCarried) {
      return fail("Automatic booking only carries a male or female passport marker, so Reach can't buy this flight. Book it with the airline directly — nothing was bought here.");
    }

    if (liveToken()) {
      // Belt and braces. A live Duffel token means this call buys a real
      // ticket with real money, and nothing in this session is meant to.
      console.error('[duffel] refused to create an order on a live token');
      return fail('Refusing to issue a real ticket: the Duffel key is in live mode.');
    }

    // The one call that buys a ticket. A timeout or a 5xx from here may
    // still have made the order, and is thrown as such (commitFetch).
    const res = await commitFetch(`${BASE}/air/orders`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        data: {
          type: 'instant',
          selected_offers: [q.providerRef],
          passengers,
          payments: [{
            type: 'balance',
            amount: ((q.priceCents ?? 0) / 100).toFixed(2),
            currency: q.currency || 'USD',
          }],
        },
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      // The titles only. Duffel echoes the request in its error payload, and
      // that request has everybody's date of birth in it.
      console.error('[duffel] order refused', { status: res.status });
      return fail(duffelError(json));
    }

    const order = json?.data;
    // Accepted, and no order we can read: the ticket may well be issued.
    if (!order?.id) throw new OutcomeUnknown('Duffel accepted the order and its answer could not be read.');
    return {
      vertical: 'flight', mode: 'native', status: 'confirmed', provider: 'duffel',
      providerRef: order?.booking_reference || order?.id,
      priceCents: amountToCents(order?.total_amount) ?? q.priceCents,
      currency: order?.total_currency || q.currency || 'USD',
      detail: q.detail,
      raw: {
        orderId: order?.id ?? null,
        bookingReference: order?.booking_reference ?? null,
        flightIdent: (q.raw as { flightIdent?: string | null })?.flightIdent ?? null,
      },
    };
  },
};

export { duffelGender };

// ─── Undoing one ─────────────────────────────────────────────────────────
// Reach could book a flight and had no way to unbook it. The provider
// interface was quote and book, nothing else, for every lane — so a
// duplicate order created by a double-tap could only be tidied by marking a
// row cancelled in our own table, which changes nothing at the airline. The
// row said cancelled and the seat was still bought.
//
// Duffel does this in two steps and they are the right two. Creating a
// cancellation tells you what would actually come back — airlines refund a
// fraction, or nothing at all, depending on the fare — and confirming is a
// separate call. Nobody should cancel a flight without being told first what
// it costs them.
export async function cancelDuffelOrder(
  orderRef: string,
  opts: { confirm?: boolean } = {},
): Promise<CancelResult> {
  if (!process.env.DUFFEL_API_KEY) {
    return { status: 'failed', error: 'Flights are not configured for this deployment.' };
  }
  // An airline booking reference is not an order id, and Duffel answers one
  // with "does not exist" — a sentence that reads like a fact about the
  // order and is only a fact about the request.
  if (!isOrderId(orderRef)) {
    return { status: 'failed', error: "That isn't an order number the airline system knows." };
  }

  try {
    // Step one: what would this cost. Safe to call, changes nothing.
    const asked = await fetch(`${BASE}/air/order_cancellations`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ data: { order_id: orderRef } }),
      signal: AbortSignal.timeout(20000),
    });
    const quoted = await asked.json().catch(() => ({}));
    if (!asked.ok) {
      console.error('[duffel] could not price the cancellation', { order: orderRef, status: asked.status });
      return { status: 'failed', error: duffelError(quoted) ?? 'That booking could not be cancelled.', raw: quoted };
    }

    const d = quoted?.data ?? {};
    const refundCents = Math.round(Number(d.refund_amount ?? 0) * 100);
    const currency = String(d.refund_currency ?? 'USD');

    if (!opts.confirm) {
      return { status: 'quoted', refundCents, currency, cancellationRef: d.id, raw: quoted };
    }

    // Step two, and only when asked for by name.
    const done = await fetch(`${BASE}/air/order_cancellations/${d.id}/actions/confirm`, {
      method: 'POST',
      headers: headers(),
      signal: AbortSignal.timeout(20000),
    });
    const result = await done.json().catch(() => ({}));
    if (!done.ok) {
      // The money is the thing here: a cancellation that half-happened is
      // worth shouting about, because the row and the airline now disagree.
      console.error('[duffel] the cancellation was priced and then refused', {
        order: orderRef, cancellation: d.id, status: done.status,
      });
      return { status: 'failed', error: duffelError(result) ?? 'That booking could not be cancelled.', raw: result };
    }

    return { status: 'cancelled', refundCents, currency, cancellationRef: d.id, raw: result };
  } catch (err) {
    console.error('[duffel] cancellation call failed', err instanceof Error ? err.message : 'failed');
    return { status: 'failed', error: 'Could not reach the airline just now — nothing was cancelled.' };
  }
}
