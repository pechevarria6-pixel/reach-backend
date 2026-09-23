import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  roomsFor, occupancies, headcount, quotedParty, partyChange, staleForParty,
} from '../../lib/booking/party.ts';
import { duffelFlights } from '../../lib/booking/providers/flights.duffel.ts';
import { liteApiHotels } from '../../lib/booking/providers/hotels.liteapi.ts';
import { viatorActivities, tableReservations } from '../../lib/booking/providers/rest.ts';
import type { BookingItemRequest } from '../../lib/booking/types.ts';

// Every quote was sized off `travelers.length`, and nobody is named when a
// trip is priced — so every group's flight was one seat and every activity
// one ticket. These are sized from the party now.

test('three people is three seats and two rooms', () => {
  assert.equal(headcount({ party: 3, travelers: [] }), 3);
  assert.equal(roomsFor(3), 2);
  assert.deepEqual(occupancies(3, 2), [{ adults: 2 }, { adults: 1 }]);
});

test('rooms and occupants for other parties', () => {
  assert.equal(roomsFor(1), 1);
  assert.equal(roomsFor(2), 1);
  assert.equal(roomsFor(4), 2);
  assert.equal(roomsFor(5), 3);
  assert.deepEqual(occupancies(4, 2), [{ adults: 2 }, { adults: 2 }]);
  assert.deepEqual(occupancies(5, 3), [{ adults: 2 }, { adults: 2 }, { adults: 1 }]);
  // A hotel will not sell an empty room: every room has somebody in it.
  assert.deepEqual(occupancies(1, 2), [{ adults: 1 }, { adults: 1 }]);
});

test('the party wins over whoever happens to be named', () => {
  assert.equal(headcount({ party: 4, travelers: [] }), 4);
  assert.equal(headcount({ travelers: [{}, {}] as never }), 2);
  assert.equal(headcount({ travelers: [] }), 1);
  assert.equal(headcount({ travelers: [] }, 6), 6);
});

test('what a row was priced for, in its own terms', () => {
  assert.equal(quotedParty({ vertical: 'flight', party: 3 }), 3);
  assert.equal(quotedParty({ vertical: 'flight', flight: { seats: 2 } as never }), 2);
  assert.equal(quotedParty({ vertical: 'restaurant', restaurant: { partySize: 5 } as never }), 5);
  assert.equal(quotedParty({ vertical: 'hotel', hotel: { rooms: 2 } as never }), null);
});

test('a flight is booked for exactly the seats it was priced for', () => {
  const flight = { vertical: 'flight', party: 3, flight: { seats: 3 } } as Partial<BookingItemRequest>;
  assert.equal(partyChange(flight, 3), null);
  assert.deepEqual(partyChange(flight, 2), { quoted: 3, now: 2 }, 'never fewer passengers than seats');
  assert.deepEqual(partyChange(flight, 4), { quoted: 3, now: 4 }, 'never more people than seats');
});

test('a hotel is never booked for more people than it was priced for', () => {
  const sized = { vertical: 'hotel', party: 3, hotel: { rooms: 2 } } as Partial<BookingItemRequest>;
  assert.equal(partyChange(sized, 3), null);
  assert.deepEqual(partyChange(sized, 4), { quoted: 3, now: 4 });
  // Priced before `party` existed, at two to a room.
  const legacy = { vertical: 'hotel', hotel: { rooms: 2 } } as Partial<BookingItemRequest>;
  assert.equal(partyChange(legacy, 3), null);
  assert.deepEqual(partyChange(legacy, 5), { quoted: 4, now: 5 });
});

test('an activity books whoever is on it; the re-quote judges the price', () => {
  assert.equal(partyChange({ vertical: 'activity', party: 4 }, 3), null);
});

test('quotes sized for a different party are stale, and only those', () => {
  const rows = [
    { id: 'f', vertical: 'flight', status: 'awaiting_approval', request_payload: { flight: { seats: 2 } } },
    { id: 'h', vertical: 'hotel', status: 'awaiting_approval', request_payload: { party: 3, hotel: { rooms: 2 } } },
    { id: 'old', vertical: 'hotel', status: 'awaiting_approval', request_payload: { hotel: { rooms: 1 } } },
    { id: 'done', vertical: 'flight', status: 'confirmed', request_payload: { flight: { seats: 2 } } },
    { id: 'act', vertical: 'activity', status: 'awaiting_approval', request_payload: { party: 2 } },
  ];
  assert.deepEqual(staleForParty(rows, 3).map(r => r.id), ['f']);
  assert.deepEqual(staleForParty(rows, 2).map(r => r.id), ['h']);
});

// ─── Each provider actually asks for the party ──────────────────────────

type Seen = { url: string; body: Record<string, unknown> };
function stubFetch(answer: (url: string) => unknown): { seen: Seen[]; restore: () => void } {
  const seen: Seen[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    seen.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : {} });
    return new Response(JSON.stringify(answer(u)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { seen, restore: () => { globalThis.fetch = real; } };
}

const base = { planId: 'p', groupId: 'g', travelers: [] };

test('Duffel prices three seats for a party of three', async () => {
  process.env.DUFFEL_API_KEY = 'duffel_test_unit';
  const { seen, restore } = stubFetch(() => ({ data: { offers: [{
    id: 'off_1', total_amount: '900.00', total_currency: 'USD',
    passengers: [{ id: 'pas_1' }, { id: 'pas_2' }, { id: 'pas_3' }],
    owner: { name: 'Duffel Airways' }, slices: [],
  }] } }));
  try {
    const r = await duffelFlights.quote({ ...base, vertical: 'flight', party: 3,
      flight: { origin: 'RDU', destination: 'PVR', departDate: '2099-11-02' } });
    assert.equal(r.status, 'quoted');
    const ask = seen.find(s => s.url.includes('/air/offer_requests'));
    assert.equal((ask?.body.data as { passengers: unknown[] }).passengers.length, 3);
  } finally { restore(); }
});

test('LiteAPI prices two rooms, two and one, for a party of three', async () => {
  process.env.LITEAPI_KEY = 'sand_unit';
  const { seen, restore } = stubFetch(u => u.includes('/data/hotel')
    ? { data: { name: 'Hotel Uno' } }
    // LiteAPI v3 answers one rate per occupancy, and the offer's own total.
    : { data: [{ hotelId: 'lp1', roomTypes: [{ offerId: 'o1', offerRetailRate: { amount: 700, currency: 'USD' }, rates: [
        { name: 'double', occupancyNumber: 1, retailRate: { total: [{ amount: 400, currency: 'USD' }] } },
        { name: 'double', occupancyNumber: 2, retailRate: { total: [{ amount: 300, currency: 'USD' }] } },
      ] }] }] });
  try {
    const r = await liteApiHotels.quote({ ...base, vertical: 'hotel', party: 3,
      hotel: { hotelId: 'lp1', checkin: '2099-11-02', checkout: '2099-11-05', rooms: roomsFor(3) } });
    assert.equal(r.status, 'quoted');
    // Both rooms: the offerId prebook is given books both.
    assert.equal(r.priceCents, 70000);
    const ask = seen.find(s => s.url.includes('/hotels/rates'));
    assert.deepEqual(ask?.body.occupancies, [{ adults: 2 }, { adults: 1 }]);
  } finally { restore(); }
});

test('LiteAPI never swaps the pinned hotel for another', async () => {
  process.env.LITEAPI_KEY = 'sand_unit';
  const { restore } = stubFetch(() => ({ data: [{ hotelId: 'somewhere-else', roomTypes: [{ offerId: 'o', rates: [{ retailRate: { total: [{ amount: 100 }] } }] }] }] }));
  try {
    const r = await liteApiHotels.quote({ ...base, vertical: 'hotel', party: 2,
      hotel: { hotelId: 'lp1', checkin: '2099-11-02', checkout: '2099-11-05', rooms: 1 } });
    assert.equal(r.status, 'failed');
  } finally { restore(); }
});

test('Viator prices an activity for everybody on it', async () => {
  process.env.VIATOR_API_KEY = 'unit';
  const { seen, restore } = stubFetch(() => ({ bookableItems: [{ available: true, optionCode: 'A', totalPrice: { price: { recommendedRetailPrice: 90 } } }] }));
  try {
    const r = await viatorActivities.quote({ ...base, vertical: 'activity', party: 3, activity: { productCode: 'X1', date: '2099-11-03' } });
    assert.equal(r.status, 'quoted');
    assert.deepEqual(seen[0].body.paxMix, [{ ageBand: 'ADULT', numberOfTravelers: 3 }]);
  } finally { restore(); }
});

test('a table is asked for the party', async () => {
  const r = await tableReservations.quote({ ...base, vertical: 'restaurant', party: 3,
    restaurant: { name: 'Desert Bistro', city: 'Moab', date: '2099-11-03', time: '19:00', partySize: 2 } });
  assert.equal((r.raw as { partySize: number }).partySize, 3);
});
