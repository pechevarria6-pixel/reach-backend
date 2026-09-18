// ─── Hotels via LiteAPI (https://docs.liteapi.travel) ────────────────────
// NATIVE booking. Sandbox: get a free key at liteapi.travel, set
// LITEAPI_KEY in Vercel (sandbox keys start "sand_"). Flow:
//   1. /hotels/rates  → rates for a hotel/city (quote)
//   2. /rates/prebook → lock a rate, returns prebookId
//   3. /rates/book    → commit, returns confirmation
import { BookingProvider, BookingItemRequest, BookingItemResult, isConfigured } from '../types';

const BASE = process.env.LITEAPI_BASE || 'https://api.liteapi.travel/v3.0';
const KEY = () => process.env.LITEAPI_KEY || '';

async function liteFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': KEY(),
      ...(init?.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.description || json?.message || `LiteAPI ${res.status}`);
  return json;
}

export const liteApiHotels: BookingProvider = {
  vertical: 'hotel',
  name: 'liteapi',

  async quote(req: BookingItemRequest): Promise<BookingItemResult> {
    if (!isConfigured('LITEAPI_KEY')) {
      return { vertical: 'hotel', mode: 'native', status: 'failed', provider: 'liteapi', error: 'LITEAPI_KEY not set' };
    }
    const h = req.hotel!;
    const body: Record<string, unknown> = {
      checkin: h.checkin,
      checkout: h.checkout,
      currency: 'USD',
      guestNationality: 'US',
      // Occupancy, not identity. Named travellers arrive at approval; at quote
      // time a plan may have nobody listed yet, and asking for zero adults —
      // or reading .length off an array that is not there — is how this
      // failed. Two to a room is the assumption a hotel would make.
      occupancies: Array.from({ length: Math.max(1, h.rooms || 1) }, () => ({
        adults: Math.max(1, Math.ceil((req.travelers?.length || (h.rooms || 1) * 2) / Math.max(1, h.rooms || 1))),
      })),
    };
    // LiteAPI: "you must search by either country code, latitude and
    // longitude, placeId, lastUpdatedAt, IATA code, or hotelIds". A city name
    // on its own is refused, which is what the first end-to-end run hit.
    if (h.hotelId) body.hotelIds = [h.hotelId];
    else if (h.city && h.countryCode) { body.cityName = h.city; body.countryCode = h.countryCode; }

    const data = await liteFetch('/hotels/rates', { method: 'POST', body: JSON.stringify(body) });
    // The offer and the rate live at different levels, and prebook wants the
    // offer. Asked LiteAPI directly rather than guessing a third time: the
    // roomType carries offerId, and the rate underneath carries rateId,
    // pricing and the cancellation policy. Sending the rate's id was refused
    // as "invalid offerId" — it is a real identifier for a different thing.
    const roomType = data?.data?.[0]?.roomTypes?.[0];
    const first = roomType?.rates?.[0];
    if (!first) {
      return { vertical: 'hotel', mode: 'native', status: 'failed', provider: 'liteapi', error: 'No rates available' };
    }
    const amount = first?.retailRate?.total?.[0]?.amount;
    return {
      vertical: 'hotel',
      mode: 'native',
      status: 'quoted',
      provider: 'liteapi',
      // What prebook is given. The rate's own id is kept in `raw` for the
      // record, but it is not what books a room.
      providerRef: roomType?.offerId || first.offerId || first.rateId,
      priceCents: amount ? Math.round(Number(amount) * 100) : undefined,
      currency: first?.retailRate?.total?.[0]?.currency || 'USD',
      detail: `${data.data[0]?.hotelId || h.city} · ${h.checkin} → ${h.checkout}`,
      raw: first,
    };
  },

  async book(req: BookingItemRequest): Promise<BookingItemResult> {
    if (!isConfigured('LITEAPI_KEY')) {
      return { vertical: 'hotel', mode: 'native', status: 'failed', provider: 'liteapi', error: 'LITEAPI_KEY not set' };
    }
    const h = req.hotel!;
    // Need an offer — quote first if the caller didn't supply one.
    let offerId = h.rateId;
    if (!offerId) {
      const q = await this.quote(req);
      if (q.status !== 'quoted' || !q.providerRef) return q;
      offerId = q.providerRef;
    }

    // Somebody has to be staying in the room. With no travellers named this
    // used to read .firstName off undefined and throw; the honest answer is
    // that a hotel cannot be booked for nobody.
    const lead = req.travelers?.[0];
    if (!lead || !lead.firstName || !lead.lastName) {
      return {
        vertical: 'hotel', mode: 'native', status: 'failed', provider: 'liteapi',
        error: 'We need the name of whoever the room is under before this can be booked.',
      };
    }

    // Step 1: prebook locks price and availability. The field is offerId in
    // v3 — sending rateId returned "Field validation for 'OfferID' failed on
    // the 'required' tag", which is what stopped the first end-to-end run at
    // the last step. Both names are sent so either version is satisfied.
    const pre = await liteFetch('/rates/prebook', {
      method: 'POST',
      body: JSON.stringify({ usePaymentSdk: false, offerId, rateId: offerId }),
    });
    const prebookId = pre?.data?.prebookId;
    if (!prebookId) {
      return { vertical: 'hotel', mode: 'native', status: 'failed', provider: 'liteapi', error: 'Prebook failed', raw: pre };
    }

    // Step 2: commit
    const booked = await liteFetch('/rates/book', {
      method: 'POST',
      body: JSON.stringify({
        prebookId,
        holder: { firstName: lead.firstName, lastName: lead.lastName, email: lead.email },
        payment: { method: 'ACC_CREDIT_CARD' }, // sandbox: account credit; production: wallet/deposit
        guests: req.travelers.map((t, i) => ({
          occupancyNumber: i + 1, firstName: t.firstName, lastName: t.lastName, email: t.email,
        })),
      }),
    });
    const conf = booked?.data;
    return {
      vertical: 'hotel',
      mode: 'native',
      status: conf?.bookingId ? 'confirmed' : 'failed',
      provider: 'liteapi',
      providerRef: conf?.bookingId || conf?.confirmationNumber,
      priceCents: conf?.price ? Math.round(Number(conf.price) * 100) : undefined,
      currency: conf?.currency || 'USD',
      detail: conf?.hotel?.name ? `${conf.hotel.name} confirmed` : 'Hotel booking confirmed',
      raw: conf,
    };
  },
};
