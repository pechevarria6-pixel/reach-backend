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
//     a stored price
import { BookingProvider, BookingItemRequest, BookingItemResult } from '../types';
import {
  amountToCents, offerExpired, duffelGender, toDuffelPassenger,
  describeOffer, flightIdent, describeConditions, departed, type DuffelPassenger,
} from '../duffel-map';

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
  owner?: { name?: string };
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
const airportCache = new Map<string, string | null>();

export async function resolveAirport(place: string): Promise<string | null> {
  const query = (place || '').trim();
  if (!query) return null;
  if (airportCache.has(query)) return airportCache.get(query) ?? null;
  if (!process.env.DUFFEL_API_KEY) return null;

  let code: string | null = null;
  try {
    const res = await fetch(
      `${BASE}/places/suggestions?query=${encodeURIComponent(query)}`,
      { headers: headers(), signal: AbortSignal.timeout(8000) },
    );
    if (res.ok) {
      const json = await res.json().catch(() => null);
      const places = (json?.data ?? []) as {
        type?: string; iata_code?: string; airports?: { iata_code?: string }[];
      }[];
      // An airport is sellable as itself. A city is sellable by its own code
      // when it has one — that is how "all airports in London" is bought.
      const hit = places.find(p => p.type === 'airport' && p.iata_code)
        ?? places.find(p => p.iata_code);
      code = hit?.iata_code ?? hit?.airports?.[0]?.iata_code ?? null;
    } else {
      console.error('[duffel] place lookup failed', { status: res.status });
    }
  } catch (e) {
    console.error('[duffel] place lookup unreachable', e instanceof Error ? e.message : String(e));
  }

  airportCache.set(query, code);
  return code;
}

/** One search. Returns the cheapest offer, which is what a quote is. */
async function cheapestOffer(f: NonNullable<BookingItemRequest['flight']>, seats: number) {
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
  if (!res.ok) return { error: duffelError(json), offer: null as Offer | null };

  const offers: Offer[] = json?.data?.offers ?? [];
  if (!offers.length) return { error: 'No flights found for those dates.', offer: null };
  // Cheapest first. Duffel does not promise an order.
  const sorted = [...offers].sort(
    (a, b) => (amountToCents(a.total_amount) ?? Infinity) - (amountToCents(b.total_amount) ?? Infinity),
  );
  return { error: null, offer: sorted[0] };
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

    const { error, offer } = await cheapestOffer(f, req.travelers?.length || 1);
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
        // Shown before anyone pays a share towards it.
        conditions: describeConditions(offer.conditions),
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

    const raw = q.raw as { expiresAt?: string | null; passengerIds?: string[] } | undefined;
    if (offerExpired(raw?.expiresAt)) {
      // Should not happen — the quote was made a moment ago — but an offer
      // that lapses between the two calls must not be paid for.
      return fail('That fare was held and has just lapsed. Search again for a current price.');
    }

    const passengerIds = raw?.passengerIds ?? [];
    if (passengerIds.length < req.travelers.length) {
      return fail('The airline offered fewer seats than there are travellers.');
    }

    const passengers: DuffelPassenger[] = [];
    const needsAPerson: string[] = [];
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
        // nothing else. Airlines do issue these tickets — through a person.
        // Failing here would mean somebody cannot fly with their friends
        // because of what is printed on their passport, which is not an
        // outcome this app is going to produce.
        needsAPerson.push(who);
        continue;
      }
      passengers.push(mapped.passenger);
    }

    if (needsAPerson.length) {
      const names = needsAPerson.length === 1
        ? needsAPerson[0]
        : `${needsAPerson.slice(0, -1).join(', ')} and ${needsAPerson[needsAPerson.length - 1]}`;
      return {
        vertical: 'flight', mode: 'concierge', status: 'pending', provider: 'concierge',
        providerRef: `CNC-${Date.now().toString(36).toUpperCase()}`,
        // The fare they were quoted, so the group's total does not move.
        priceCents: q.priceCents, currency: q.currency,
        detail: q.detail,
        // Said plainly, and without making it sound like something went
        // wrong. Nothing has: this booking is being made by a person.
        error: null,
        raw: {
          conciergeReason: 'gender-marker',
          travellers: needsAPerson,
          note: `${names} will be booked directly with the airline — automatic booking only carries male or female, and we are not putting the wrong one on a ticket.`,
          offerId: q.providerRef,
          flightIdent: (q.raw as { flightIdent?: string | null })?.flightIdent ?? null,
        },
      };
    }

    if (liveToken()) {
      // Belt and braces. A live Duffel token means this call buys a real
      // ticket with real money, and nothing in this session is meant to.
      console.error('[duffel] refused to create an order on a live token');
      return fail('Refusing to issue a real ticket: the Duffel key is in live mode.');
    }

    const res = await fetch(`${BASE}/air/orders`, {
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
