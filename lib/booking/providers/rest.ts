// ─── Remaining four verticals in one module ──────────────────────────────
import { type BookingProvider, type BookingItemRequest, type BookingItemResult, isConfigured } from '../types.ts';
import { reservationUrl, type Platform } from '../reservations.ts';
import { headcount } from '../party.ts';

// Flights are Duffel's (lib/booking/providers/flights.duffel.ts). The Kiwi
// integration that lived here was switched off, and still what approval
// called: it sent no passengers, and invented a birthday and a
// "mr" for anybody it did not know. Deleted rather than kept dormant, so
// nothing can route to it again.

// ═══ ACTIVITIES — Viator Partner API (native) ════════════════════════════
// Apply at partnerresources.viator.com (Merchant tier books natively).
// Set VIATOR_API_KEY.
// Sandbox and production are different hosts, and a sandbox key on the
// production host is rejected as if it were invalid — which is what
// "unknown: key present; no free check to call" was hiding.
const VIATOR = process.env.VIATOR_BASE || 'https://api.sandbox.viator.com/partner';

export const viatorActivities: BookingProvider = {
  vertical: 'activity',
  name: 'viator',

  async quote(req): Promise<BookingItemResult> {
    if (!isConfigured('VIATOR_API_KEY')) {
      return { vertical: 'activity', mode: 'native', status: 'failed', provider: 'viator', error: 'VIATOR_API_KEY not set' };
    }
    const a = req.activity!;
    const res = await fetch(`${VIATOR}/availability/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'exp-api-key': process.env.VIATOR_API_KEY!, 'Accept': 'application/json;version=2.0' },
      body: JSON.stringify({
        productCode: a.productCode, travelDate: a.date,
        // The party, not whoever is named: nobody is at quote time, and an
        // activity priced for one person is not the price for four.
        paxMix: [{ ageBand: 'ADULT', numberOfTravelers: headcount(req) }],
      }),
    });
    const json = await res.json();
    const opt = json?.bookableItems?.[0];
    if (!opt?.available) return { vertical: 'activity', mode: 'native', status: 'failed', provider: 'viator', error: 'Not available on that date' };
    const total = opt?.totalPrice?.price?.recommendedRetailPrice;
    return {
      vertical: 'activity', mode: 'native', status: 'quoted', provider: 'viator',
      providerRef: opt.optionCode || a.productCode,
      priceCents: total ? Math.round(total * 100) : undefined, currency: 'USD',
      detail: `${a.productCode} on ${a.date} · ${headcount(req)} ${headcount(req) === 1 ? 'traveller' : 'travellers'}`, raw: opt,
    };
  },

  async book(req): Promise<BookingItemResult> {
    const q = await this.quote(req);
    if (q.status !== 'quoted') return q;
    const a = req.activity!;
    const lead = req.travelers[0];
    const res = await fetch(`${VIATOR}/bookings/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'exp-api-key': process.env.VIATOR_API_KEY!, 'Accept': 'application/json;version=2.0' },
      body: JSON.stringify({
        productCode: a.productCode, optionCode: q.providerRef, travelDate: a.date,
        paxMix: [{ ageBand: 'ADULT', numberOfTravelers: headcount(req) }],
        communication: { email: lead.email, phone: lead.phone || '' },
        bookerInfo: { firstName: lead.firstName, lastName: lead.lastName },
        // Our booking's id where there is one, so Viator's record points back at
        // the row that asked for it.
        partnerBookingRef: req.reference ? `reach_${req.reference}` : `reach_${req.planId}_${Date.now()}`,
      }),
    });
    const json = await res.json();
    const ref = json?.bookingRef || json?.bookingReference;
    return {
      vertical: 'activity', mode: 'native',
      status: ref ? 'confirmed' : 'failed', provider: 'viator',
      providerRef: ref, priceCents: q.priceCents, currency: 'USD',
      detail: q.detail, raw: json, error: ref ? undefined : (json?.message || 'Booking failed'),
    };
  },
};

// ═══ EVENTS — Ticketmaster Discovery (redirect) ══════════════════════════
// Discovery API is open (developer.ticketmaster.com). PURCHASE is
// invite-only, so fulfillment is a prefilled redirect + affiliate tag.
// Set TICKETMASTER_API_KEY (free).
export const ticketmasterEvents: BookingProvider = {
  vertical: 'event',
  name: 'ticketmaster',

  async quote(req): Promise<BookingItemResult> {
    if (!isConfigured('TICKETMASTER_API_KEY')) {
      return { vertical: 'event', mode: 'redirect', status: 'failed', provider: 'ticketmaster', error: 'TICKETMASTER_API_KEY not set' };
    }
    const e = req.event!;
    const res = await fetch(`https://app.ticketmaster.com/discovery/v2/events/${e.eventId}.json?apikey=${process.env.TICKETMASTER_API_KEY}`);
    const json = await res.json();
    if (!json?.url) return { vertical: 'event', mode: 'redirect', status: 'failed', provider: 'ticketmaster', error: 'Event not found' };
    const min = json?.priceRanges?.[0]?.min;
    return {
      vertical: 'event', mode: 'redirect', status: 'quoted', provider: 'ticketmaster',
      redirectUrl: json.url,
      priceCents: min ? Math.round(min * 100 * e.quantity) : undefined, currency: 'USD',
      detail: `${json.name} · ${json?.dates?.start?.localDate || ''} · ${e.quantity} tickets`,
      raw: { id: json.id, venue: json?._embedded?.venues?.[0]?.name },
    };
  },

  async book(req): Promise<BookingItemResult> {
    const q = await this.quote(req);
    if (q.status !== 'quoted') return q;
    return { ...q, status: 'redirected', detail: `${q.detail} — complete purchase on Ticketmaster` };
  },
};

// ═══ RESTAURANTS — Concierge queue ═══════════════════════════════════════
// No open reservation API exists (OpenTable/Resy are closed partnerships).
// Fulfillment: the request is stored as a concierge ticket (status
// 'pending'); ops confirms it and PATCHes status → 'confirmed' with the
// reservation name/number. When a real API lands, swap book() internals —
// the interface and the frontend don't change.
/**
 * The name of the place, and the city only when we know it. A trip with no
 * destination stored left "Desert Bistro, " with a comma and nothing after
 * it on somebody's checkout screen.
 */
function tableLabel(r: { name: string; city?: string }): string {
  const name = (r.name || '').trim() || 'Reservation';
  const city = (r.city || '').trim();
  return city ? `${name}, ${city}` : name;
}

export const tableReservations: BookingProvider = {
  vertical: 'restaurant',
  name: 'redirect',

  // Reach does not take the table. The member does, on their own account and
  // their own card, because that is where their card's dining benefits live:
  // Amex opens doors on Resy, Chase on OpenTable. A reservation made by us on
  // our card throws all of that away, and a queue of requests waiting on a
  // person here is slower than the two taps it takes them.
  //
  // This replaces the concierge queue. Nothing waits on Reach staff.
  //
  // `detail` is the line a person reads, so it is the name of the place and
  // nothing else. It used to be the whole request concatenated, which on a
  // real trip produced a dinner captioned with a tip about a sunrise hike.
  async quote(req): Promise<BookingItemResult> {
    const r = req.restaurant!;
    const platform = (r.platform ?? 'none') as Platform;
    const url = reservationUrl(platform, {
      name: r.name, city: r.city, date: r.date, time: r.time,
      partySize: headcount({ party: req.party ?? r.partySize, travelers: req.travelers }), knownUrl: r.externalUrl,
    });

    return {
      vertical: 'restaurant',
      // A table is held, not sold: nothing is charged today, so this must not
      // land in the group's funding target. Tock deposits are the exception
      // and are settled in the ledger, not collected up front.
      mode: 'redirect',
      status: 'quoted',
      provider: url ? platform : 'none',
      detail: tableLabel(r),
      redirectUrl: url ?? undefined,
      priceCents: 0,
      raw: { platform, date: r.date, time: r.time, partySize: headcount({ party: req.party ?? r.partySize, travelers: req.travelers }), phone: r.phone ?? null },
    };
  },

  // Nothing is "booked" by us. The row is created so the trip knows the table
  // is wanted, and it sits waiting for the member to say they got it.
  async book(req): Promise<BookingItemResult> {
    const quoted = await this.quote(req);
    return {
      ...quoted,
      // Handed over, not confirmed. Only the person who booked it can say
      // whether there was a table, and there is a button for exactly that.
      status: quoted.redirectUrl ? 'redirected' : 'pending',
      providerRef: `RES-${Date.now().toString(36).toUpperCase()}`,
    };
  },
};

/** Kept so old rows written by the retired queue still resolve. */
export const conciergeRestaurants = tableReservations;
