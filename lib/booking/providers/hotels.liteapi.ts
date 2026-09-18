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
    const first = data?.data?.[0]?.roomTypes?.[0]?.rates?.[0];
    if (!first) {
      return { vertical: 'hotel', mode: 'native', status: 'failed', provider: 'liteapi', error: 'No rates available' };
    }
    const amount = first?.retailRate?.total?.[0]?.amount;
    return {
      vertical: 'hotel',
      mode: 'native',
      status: 'quoted',
      provider: 'liteapi',
      providerRef: first.rateId,
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
    // Need a rateId — quote first if the caller didn't supply one
    let rateId = h.rateId;
    if (!rateId) {
      const q = await this.quote(req);
      if (q.status !== 'quoted' || !q.providerRef) return q;
      rateId = q.providerRef;
    }

    // Step 1: prebook locks price + availability
    const pre = await liteFetch('/rates/prebook', {
      method: 'POST',
      body: JSON.stringify({ usePaymentSdk: false, rateId }),
    });
    const prebookId = pre?.data?.prebookId;
    if (!prebookId) {
      return { vertical: 'hotel', mode: 'native', status: 'failed', provider: 'liteapi', error: 'Prebook failed', raw: pre };
    }

    // Step 2: commit
    const lead = req.travelers[0];
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
