// ─── Hotels via LiteAPI (https://docs.liteapi.travel) ────────────────────
// NATIVE booking. Sandbox: get a free key at liteapi.travel, set
// LITEAPI_KEY in Vercel (sandbox keys start "sand_"). Flow:
//   1. /hotels/rates  → rates for a hotel/city (quote)
//   2. /rates/prebook → lock a rate, returns prebookId
//   3. /rates/book    → commit, returns confirmation
import { type BookingProvider, type BookingItemRequest, type BookingItemResult, isConfigured, commitFetch, overMax, OutcomeUnknown } from '../types.ts';
import { headcount, occupancies } from '../party.ts';

/**
 * Who is in which room: the party spread across the rooms, three people in
 * two rooms being two and one. A quote from before `party` existed, with
 * nobody named, is priced at two to a room as it always was.
 */
function occupancyOf(req: BookingItemRequest) {
  const rooms = Math.max(1, req.hotel?.rooms || 1);
  return occupancies(headcount(req, rooms * 2), rooms);
}

type Money = { amount?: number | string; currency?: string };
type LiteRate = Record<string, unknown> & {
  name?: string; offerId?: string; rateId?: string; boardName?: string; occupancyNumber?: number | string;
  retailRate?: { total?: Money[] };
};
type LiteRoomType = { offerId?: string; offerRetailRate?: Money; rates?: LiteRate[] };

/**
 * What the whole offer costs — every room in it.
 *
 * The quote read `rates[0].retailRate.total`, and in LiteAPI v3 `rates` holds
 * one rate per occupancy: rates[0] is the first room only. The offerId that
 * prebook is given books every room, so a group of three in two rooms paid
 * for one room and Reach bought two. The offer's own total is
 * `offerRetailRate`; without it, one rate per occupancy is added up. A room
 * with no price we can read makes the whole offer unpriced — a total missing
 * a room is the same bug again.
 */
export function offerTotal(roomType: LiteRoomType | null | undefined, rooms: number): { cents: number; currency: string } | null {
  if (!roomType) return null;
  const cents = (m: Money | undefined) => {
    const n = Number(m?.amount);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
  };
  const offer = cents(roomType.offerRetailRate);
  if (offer !== null) return { cents: offer, currency: roomType.offerRetailRate?.currency || 'USD' };

  const rates = roomType.rates ?? [];
  const perRoom = new Map<number, LiteRate>();
  for (const r of rates) {
    const n = Number(r.occupancyNumber);
    if (Number.isFinite(n) && n >= 1 && !perRoom.has(n)) perRoom.set(n, r);
  }
  const want = Math.max(1, Math.floor(rooms || 1));
  // Rates that do not say which room they are for can only be trusted for a
  // single room.
  const picked = perRoom.size ? [...perRoom.values()] : want === 1 ? rates.slice(0, 1) : [];
  if (picked.length < want) return null;
  let total = 0;
  for (const r of picked) {
    const c = cents(r.retailRate?.total?.[0]);
    if (c === null) return null;
    total += c;
  }
  return total > 0 ? { cents: total, currency: picked[0].retailRate?.total?.[0]?.currency || 'USD' } : null;
}

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

/** liteFetch for the one call that books: an unanswered order is not a refused one. */
async function liteCommit(path: string, init: RequestInit) {
  const res = await commitFetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY(), ...(init.headers || {}) },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.description || json?.message || `LiteAPI ${res.status}`);
  // Accepted, and nothing we can read: the room may well be booked.
  if (json === null) throw new OutcomeUnknown('LiteAPI accepted the booking and its answer could not be read.');
  return json;
}

/** A hotel's name and the things somebody choosing it looks at. Null if LiteAPI will not say. */
export interface HotelSummary { id: string; name: string; stars?: number; address?: string; photo?: string }
async function hotelDetails(hotelId: string): Promise<HotelSummary | null> {
  try {
    const info = (await liteFetch(`/data/hotel?hotelId=${encodeURIComponent(hotelId)}&timeout=4`))?.data;
    if (!info?.name) return null;
    return {
      id: hotelId,
      name: String(info.name),
      stars: Number.isFinite(Number(info.starRating)) && Number(info.starRating) > 0 ? Number(info.starRating) : undefined,
      address: [info.address, info.city].filter(Boolean).join(', ') || undefined,
      photo: info.main_photo || info.thumbnail || undefined,
    };
  } catch (e) {
    console.error('[liteapi] hotel details unavailable', { hotelId, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

const titleCase = (t: unknown) => typeof t === 'string'
  ? t.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : null;

/**
 * Other hotels for the same dates, cheapest first, each by name — for
 * somebody who wants a different place to stay than the one Reach picked.
 * Only hotels LiteAPI will actually sell a room in for these dates; a name
 * we cannot find is left out rather than shown as a code.
 */
export async function hotelOptions(req: BookingItemRequest, limit = 6) {
  if (!isConfigured('LITEAPI_KEY')) return { error: 'Hotels are switched off.', options: [] };
  const h = req.hotel;
  if (!h?.city || !h.countryCode) return { error: 'This trip has no destination saved.', options: [] };
  let data;
  try {
    data = await liteFetch('/hotels/rates', { method: 'POST', body: JSON.stringify({
      checkin: h.checkin, checkout: h.checkout, currency: 'USD', guestNationality: 'US',
      occupancies: occupancyOf(req),
      cityName: h.city, countryCode: h.countryCode,
    }) });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not search hotels.', options: [] };
  }
  const rooms = occupancyOf(req).length;
  const priced = ((data?.data ?? []) as { hotelId?: string; roomTypes?: LiteRoomType[] }[])
    .map(x => {
      const rt = x.roomTypes?.[0]; const r = rt?.rates?.[0];
      // Every room, as the quote prices it — an option cheaper by a room is
      // not cheaper.
      const total = offerTotal(rt, rooms);
      return x.hotelId && total ? {
        hotelId: x.hotelId, priceCents: total.cents,
        room: titleCase(r?.name), board: r?.boardName || null,
      } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.priceCents - b.priceCents)
    .slice(0, limit * 2);
  const named = await Promise.all(priced.map(async p => {
    const d = await hotelDetails(p.hotelId);
    return d ? { ...p, ...d, key: p.hotelId } : null;
  }));
  const options = named.filter((x): x is NonNullable<typeof x> => !!x).slice(0, limit);
  return { error: options.length ? null : 'No other hotels have rooms for those dates.', options };
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
      // Occupancy, not identity: the party this is for, spread across the
      // rooms. It was `travelers.length`, which is nobody at quote time, so
      // every room was priced at two whatever the group was.
      occupancies: occupancyOf(req),
    };
    // LiteAPI: "you must search by either country code, latitude and
    // longitude, placeId, lastUpdatedAt, IATA code, or hotelIds". A city name
    // on its own is refused, which is what the first end-to-end run hit.
    if (h.hotelId) body.hotelIds = [h.hotelId];
    else if (h.city && h.countryCode) { body.cityName = h.city; body.countryCode = h.countryCode; }

    const data = await liteFetch('/hotels/rates', { method: 'POST', body: JSON.stringify(body) });
    // The hotel that was priced, and no other. A pinned hotel with no rates is
    // unavailable; it is never quietly swapped for whichever hotel came first.
    const hotels = (data?.data ?? []) as { hotelId?: string; roomTypes?: LiteRoomType[] }[];
    const match = h.hotelId ? hotels.find(x => x.hotelId === h.hotelId) : hotels[0];
    if (h.hotelId && !match) {
      return { vertical: 'hotel', mode: 'native', status: 'failed', provider: 'liteapi', error: 'That hotel has no rooms left for these dates.' };
    }
    // The offer and the rate live at different levels, and prebook wants the
    // offer. Asked LiteAPI directly rather than guessing a third time: the
    // roomType carries offerId, and the rate underneath carries rateId,
    // pricing and the cancellation policy. Sending the rate's id was refused
    // as "invalid offerId" — it is a real identifier for a different thing.
    const roomType = match?.roomTypes?.[0];
    const first = roomType?.rates?.[0];
    if (!first) {
      return { vertical: 'hotel', mode: 'native', status: 'failed', provider: 'liteapi', error: 'No rates available' };
    }
    const total = offerTotal(roomType, (body.occupancies as unknown[]).length);
    if (!total) {
      // A price that leaves out a room is not a price for this stay.
      return { vertical: 'hotel', mode: 'native', status: 'failed', provider: 'liteapi', error: 'The hotel did not give a price for every room.' };
    }

    // Which hotel this is, by name. The quote used to describe itself as
    // "lp81ecd · 2026-11-02 → 2026-11-09" — LiteAPI's id — so the trip's
    // place to stay was a code nobody could recognise or look up. The rates
    // answer carries only the id; /data/hotel carries the rest. A failed
    // lookup costs the name, never the quote.
    const hotelId: string | undefined = match?.hotelId;
    const hotel = hotelId ? await hotelDetails(hotelId) : null;
    const room = titleCase(first?.name);
    return {
      vertical: 'hotel',
      mode: 'native',
      status: 'quoted',
      provider: 'liteapi',
      // What prebook is given. The rate's own id is kept in `raw` for the
      // record, but it is not what books a room.
      providerRef: roomType?.offerId || first.offerId || first.rateId,
      priceCents: total.cents,
      currency: total.currency,
      detail: hotel
        ? [hotel.name, hotel.stars ? `${hotel.stars}★` : null, room, `${h.checkin} → ${h.checkout}`].filter(Boolean).join(' · ')
        : `A hotel in ${h.city} · ${h.checkin} → ${h.checkout}`,
      // hotelId travels with the quote so approval books this hotel, not
      // whichever one a fresh city-wide search happens to return first.
      raw: { ...first, ...(hotelId ? { hotelId } : {}), ...(hotel ? { hotel } : {}) },
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
    // Prebook is where LiteAPI settles the price it will charge. Above what
    // the group paid in, nothing is booked: the difference would be Reach's.
    const held = Number(pre?.data?.price);
    const heldCents = Number.isFinite(held) && held > 0 ? Math.round(held * 100) : null;
    if (overMax(heldCents, req.maxPriceCents)) {
      return {
        vertical: 'hotel', mode: 'native', status: 'failed', provider: 'liteapi',
        error: `The hotel's price went up to $${((heldCents ?? 0) / 100).toFixed(2)} while this was being booked, which is more than the group paid in for it. Nothing was booked — check the new price and book it again.`,
      };
    }

    // Step 2: commit — the call that buys the room. A timeout or a 5xx from
    // here may still have made the booking, and is thrown as such.
    const booked = await liteCommit('/rates/book', {
      method: 'POST',
      body: JSON.stringify({
        prebookId,
        holder: { firstName: lead.firstName, lastName: lead.lastName, email: lead.email },
        payment: { method: 'ACC_CREDIT_CARD' }, // sandbox: account credit; production: wallet/deposit
        // Our booking's own id, so an order LiteAPI holds can always be
        // traced to the row that asked for it — including one whose answer
        // never reached us.
        ...(req.reference ? { clientReference: req.reference } : {}),
        // One named guest per room. occupancyNumber is the room, not the
        // person: numbering every traveller named a fourth room in a
        // booking of two.
        guests: occupancyOf(req).map((_, room) => {
          const t = req.travelers[room] ?? lead;
          return { occupancyNumber: room + 1, firstName: t.firstName, lastName: t.lastName, email: t.email };
        }),
      }),
    });
    const conf = booked?.data;
    if (!conf?.bookingId) {
      return {
        vertical: 'hotel', mode: 'native', status: 'failed', provider: 'liteapi',
        error: 'The hotel did not confirm the booking.', raw: conf,
      };
    }
    return {
      vertical: 'hotel',
      mode: 'native',
      status: 'confirmed',
      provider: 'liteapi',
      providerRef: conf.bookingId || conf.confirmationNumber,
      priceCents: conf.price ? Math.round(Number(conf.price) * 100) : undefined,
      currency: conf.currency || 'USD',
      detail: conf.hotel?.name ? `${conf.hotel.name} confirmed` : 'Hotel booking confirmed',
      raw: conf,
    };
  },
};
