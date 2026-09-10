// ─── Remaining four verticals in one module ──────────────────────────────
import { BookingProvider, BookingItemRequest, BookingItemResult, isConfigured } from '../types';

// ═══ FLIGHTS — Kiwi.com Tequila (native) ═════════════════════════════════
// Apply at tequila.kiwi.com (approval is typically days, not months).
// Set TEQUILA_API_KEY. Flow: /v2/search → quote; /v2/booking → save_booking
// then confirm_payment (Kiwi is merchant of record — they charge the card
// via their Zooz flow; in sandbox, confirm is simulated).
const KIWI = 'https://api.tequila.kiwi.com';

export const kiwiFlights: BookingProvider = {
  vertical: 'flight',
  name: 'kiwi',

  async quote(req): Promise<BookingItemResult> {
    if (!isConfigured('TEQUILA_API_KEY')) {
      return { vertical: 'flight', mode: 'native', status: 'failed', provider: 'kiwi', error: 'TEQUILA_API_KEY not set — apply at tequila.kiwi.com' };
    }
    const f = req.flight!;
    const toKiwiDate = (d: string) => d.split('-').reverse().join('/'); // YYYY-MM-DD → DD/MM/YYYY
    const params = new URLSearchParams({
      fly_from: f.origin, fly_to: f.destination,
      date_from: toKiwiDate(f.departDate), date_to: toKiwiDate(f.departDate),
      adults: String(req.travelers.length),
      curr: 'USD', limit: '5', selected_cabins: f.cabin || 'M',
      ...(f.returnDate ? { return_from: toKiwiDate(f.returnDate), return_to: toKiwiDate(f.returnDate) } : {}),
    });
    const res = await fetch(`${KIWI}/v2/search?${params}`, { headers: { apikey: process.env.TEQUILA_API_KEY! } });
    const json = await res.json();
    const best = json?.data?.[0];
    if (!best) return { vertical: 'flight', mode: 'native', status: 'failed', provider: 'kiwi', error: 'No flights found' };
    return {
      vertical: 'flight', mode: 'native', status: 'quoted', provider: 'kiwi',
      providerRef: best.booking_token,
      priceCents: Math.round(best.price * 100), currency: 'USD',
      detail: `${best.cityFrom} → ${best.cityTo} · ${best.airlines?.join('/')} · $${best.price}`,
      // flightIdent is what /api/plans/[planId]/live queries AeroAPI with.
      // Kiwi returns the operating carrier and number on the first leg.
      raw: {
        id: best.id,
        route: best.route?.length,
        flightIdent: best.route?.[0]
          ? `${best.route[0].airline || ''}${best.route[0].flight_no || ''}` || null
          : null,
      },
    };
  },

  async book(req): Promise<BookingItemResult> {
    const q = await this.quote(req);
    if (q.status !== 'quoted' || !q.providerRef) return q;
    const body = {
      booking_token: q.providerRef,
      passengers: req.travelers.map(t => ({
        name: t.firstName, surname: t.lastName, email: t.email,
        birthday: t.dateOfBirth || '1990-01-01',
        category: 'adult', title: 'mr',
      })),
      lang: 'en', locale: 'en', currency: 'usd',
    };
    const res = await fetch(`${KIWI}/v2/booking/save_booking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: process.env.TEQUILA_API_KEY! },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json?.booking_id) {
      return { vertical: 'flight', mode: 'native', status: 'failed', provider: 'kiwi', error: json?.message || 'save_booking failed', raw: json };
    }
    // Payment confirm (sandbox keys auto-approve; production uses Kiwi's payment flow)
    await fetch(`${KIWI}/v2/booking/confirm_payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: process.env.TEQUILA_API_KEY! },
      body: JSON.stringify({ booking_id: json.booking_id, transaction_id: json.transaction_id }),
    }).catch(() => null);
    return {
      vertical: 'flight', mode: 'native', status: 'confirmed', provider: 'kiwi',
      providerRef: String(json.booking_id),
      priceCents: q.priceCents, currency: 'USD',
      detail: q.detail,
      raw: {
        booking_id: json.booking_id,
        flightIdent: (q.raw as { flightIdent?: string } | undefined)?.flightIdent || null,
      },
    };
  },
};

// ═══ ACTIVITIES — Viator Partner API (native) ════════════════════════════
// Apply at partnerresources.viator.com (Merchant tier books natively).
// Set VIATOR_API_KEY.
const VIATOR = 'https://api.viator.com/partner';

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
        paxMix: [{ ageBand: 'ADULT', numberOfTravelers: req.travelers.length }],
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
      detail: `${a.productCode} on ${a.date} · ${req.travelers.length} travelers`, raw: opt,
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
        paxMix: [{ ageBand: 'ADULT', numberOfTravelers: req.travelers.length }],
        communication: { email: lead.email, phone: lead.phone || '' },
        bookerInfo: { firstName: lead.firstName, lastName: lead.lastName },
        partnerBookingRef: `reach_${req.planId}_${Date.now()}`,
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
export const conciergeRestaurants: BookingProvider = {
  vertical: 'restaurant',
  name: 'concierge',

  async quote(req): Promise<BookingItemResult> {
    const r = req.restaurant!;
    return {
      vertical: 'restaurant', mode: 'concierge', status: 'quoted', provider: 'concierge',
      detail: `${r.name}, ${r.city} · ${r.date} ${r.time} · party of ${r.partySize}`,
      redirectUrl: r.externalUrl,
    };
  },

  async book(req): Promise<BookingItemResult> {
    const r = req.restaurant!;
    return {
      vertical: 'restaurant', mode: 'concierge', status: 'pending', provider: 'concierge',
      providerRef: `CNC-${Date.now().toString(36).toUpperCase()}`,
      detail: `Reservation request: ${r.name}, ${r.city} · ${r.date} ${r.time} · party of ${r.partySize}${r.notes ? ` · "${r.notes}"` : ''}`,
      redirectUrl: r.externalUrl,
    };
  },
};
