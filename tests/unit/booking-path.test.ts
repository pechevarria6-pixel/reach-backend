// The booking path after review: one rule for what the group is charged, the
// price a provider may take, who a solo trip is for, and a claim that notices
// a change made while approval was busy. Each test here was watched failing
// with its bug put back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reachBuys, chargedRows } from '../../lib/booking/charged.ts';
import { checkoutState } from '../../lib/checkout.ts';
import { fundingAt, onTheTrip, isSoloPlan, repriceAdvice } from '../../lib/booking/approval.ts';
import { claimBooking, finishClaim, midClaim, holdsSomething, changeRefusal } from '../../lib/booking/claim.ts';
import { staleForParty } from '../../lib/booking/party.ts';
import { lockedByPayment } from '../../lib/booking/failures.ts';
import { offerTotal, liteApiHotels } from '../../lib/booking/providers/hotels.liteapi.ts';
import { duffelFlights } from '../../lib/booking/providers/flights.duffel.ts';
import { overMax, commitFetch, isOutcomeUnknown, OutcomeUnknown } from '../../lib/booking/types.ts';
import { approveOutcome } from '../../lib/booking/approve-outcome.ts';
import { airlineSite } from '../../lib/booking/duffel-map.ts';

const read = (f: string) => readFileSync(f, 'utf8');

// ─── 1. One rule for what anybody is charged ────────────────────────────

test('Reach charges for what it buys, never a redirect or a concierge request', () => {
  assert.equal(reachBuys({ mode: 'native', provider: 'duffel' }), true);
  assert.equal(reachBuys({ mode: null, provider: 'liteapi' }), true, 'rows from before mode existed still count');
  assert.equal(reachBuys({ mode: 'redirect', provider: 'ticketmaster' }), false);
  assert.equal(reachBuys({ mode: 'redirect', provider: 'airline' }), false);
  assert.equal(reachBuys({ mode: 'concierge', provider: 'concierge' }), false);
  assert.equal(reachBuys({ mode: 'native', provider: 'concierge' }), false);
});

test('the total checkout shows is the total the server charges', () => {
  const rows = [
    { id: 'h', vertical: 'hotel', mode: 'native', provider: 'liteapi', status: 'awaiting_approval', price_cents: 40000, detail: 'Hotel Uno' },
    // A Ticketmaster seat carries a price (min × quantity) and is bought on
    // Ticketmaster: the screen leaves it out, and so must funding.
    { id: 't', vertical: 'event', mode: 'redirect', provider: 'ticketmaster', status: 'awaiting_approval', price_cents: 12000, detail: 'J. Cole' },
    { id: 'c', vertical: 'restaurant', mode: 'concierge', provider: 'concierge', status: 'pending', price_cents: 5000, detail: 'Desert Bistro' },
  ];
  const server = chargedRows(rows).reduce((s, r) => s + r.price_cents, 0);
  assert.equal(server, 40000);
  assert.equal(checkoutState(rows).totalCents, server);
});

test('every route that sums a plan\'s bookings applies the same rule', () => {
  const routes = [
    'app/api/plans/[planId]/funding/route.ts',
    'app/api/bookings/[id]/approve/route.ts',
    'app/api/plans/[planId]/ledger/route.ts',
    'app/api/plans/[planId]/notify/route.ts',
    'app/api/plans/[planId]/participation/route.ts',
    'app/api/plans/[planId]/savings/route.ts',
    'app/api/webhooks/stripe/route.ts',
  ];
  let selects = 0;
  for (const r of routes) {
    const src = read(r);
    assert.match(src, /NOT_CHARGED/, `${r} no longer filters on status`);
    assert.match(src, /chargedRows\(/, `${r} sums rows Reach does not buy`);
    // Every select of bookings next to NOT_CHARGED names the columns reachBuys reads.
    for (const m of src.matchAll(/\.select\('([^']*)'\)(?:(?!\.select\()[\s\S]){0,200}?NOT_CHARGED/g)) {
      assert.match(m[1], /\bmode\b/, `${r} selects ${m[1]} without mode`);
      assert.match(m[1], /\bprovider\b/, `${r} selects ${m[1]} without provider`);
      selects++;
    }
  }
  assert.equal(selects, routes.length, 'a charged select was not found to check');
});

// ─── 2. A handed-off flight is not priced again ─────────────────────────

test('options will not swap or price a row Reach does not buy', () => {
  assert.match(String(changeRefusal({ status: 'awaiting_approval', mode: 'redirect' })), /isn't buying/);
  assert.notEqual(changeRefusal({ status: 'awaiting_approval', mode: 'concierge' }), null);
  assert.equal(changeRefusal({ status: 'awaiting_approval', mode: 'native' }), null);
  assert.equal(changeRefusal({ status: 'quoted', mode: null }), null);
  assert.match(String(changeRefusal({ status: 'confirmed', mode: 'native' })), /already booked/);
});

test('options reads mode, writes who priced it, and hands off like the first quote', () => {
  const src = read('app/api/bookings/[id]/options/route.ts');
  assert.match(src, /select\('[^']*\bmode\b[^']*\bprovider\b/);
  assert.match(src, /changeRefusal\(booking\)/);
  assert.match(src, /provider: result\.provider,/);
  assert.match(src, /mode: result\.mode,/);
  assert.match(src, /airlineHandoff\(result, request\.flight\)/);
  assert.match(src, /atVersion\(/);
});

// ─── 3. Never above what was paid in ────────────────────────────────────

test('funding is checked with this booking at the higher of its two prices', () => {
  const rows = [{ id: 'f', price_cents: 50000 }, { id: 'h', price_cents: 50000 }];
  const paid = [{ status: 'succeeded', amount_cents: 100000 }];
  // A $20 rise is under the line nobody is asked about. Reach does not pay it.
  assert.equal(fundingAt(rows, paid, 'f', 52000).funded, false);
  assert.equal(fundingAt(rows, paid, 'f', 52000).shortfallCents, 2000);
  assert.equal(fundingAt(rows, paid, 'f', 49000).funded, true, 'a drop never raises the total');
  assert.equal(fundingAt([], paid, 'x', 1000).targetCents, 1000, 'a row missing from the list is still counted');
});

test('a provider may not charge more than approval allows', () => {
  assert.equal(overMax(52000, 50000), true);
  assert.equal(overMax(50000, 50000), false);
  assert.equal(overMax(99999, undefined), false, 'no ceiling set is never over');
});

type Seen = { url: string; body: Record<string, unknown> };
function stubFetch(answer: (url: string) => { status?: number; json: unknown } | 'throw') {
  const real = globalThis.fetch;
  const seen: Seen[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    seen.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : {} });
    const a = answer(u);
    if (a === 'throw') throw new Error('socket hang up');
    return new Response(JSON.stringify(a.json), { status: a.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { seen, restore: () => { globalThis.fetch = real; } };
}

const traveller = { firstName: 'Ada', lastName: 'Lovelace', email: 'a@example.com', phone: '+15555550100', dateOfBirth: '1990-05-01', gender: 'female' };
const flightReq = {
  vertical: 'flight' as const, planId: 'p', groupId: 'g', party: 1, travelers: [traveller],
  flight: { origin: 'RDU', destination: 'PVR', departDate: '2099-11-02' },
};
const offer = (amount: string) => ({ data: { offers: [{
  id: 'off_1', total_amount: amount, total_currency: 'USD', passengers: [{ id: 'pas_1' }],
  owner: { name: 'Duffel Airways' }, slices: [],
}] } });

test('Duffel refuses a fare that rose above the ceiling, before any order', async () => {
  process.env.DUFFEL_API_KEY = 'duffel_test_unit';
  const { seen, restore } = stubFetch(u => u.includes('/air/orders') ? { json: { data: { id: 'ord_1' } } } : { json: offer('520.00') });
  try {
    const r = await duffelFlights.book({ ...flightReq, maxPriceCents: 50000 });
    assert.equal(r.status, 'failed');
    assert.match(String(r.error), /more than the group paid in/);
    assert.equal(seen.some(s => s.url.includes('/air/orders')), false, 'an order was sent above the ceiling');
  } finally { restore(); }
});

test('LiteAPI refuses a prebook above the ceiling, before booking', async () => {
  process.env.LITEAPI_KEY = 'sand_unit';
  const { seen, restore } = stubFetch(u => u.includes('/rates/prebook')
    ? { json: { data: { prebookId: 'pb1', price: 460 } } }
    : { json: { data: { bookingId: 'B1' } } });
  try {
    const r = await liteApiHotels.book({
      vertical: 'hotel', planId: 'p', groupId: 'g', party: 2, travelers: [traveller],
      maxPriceCents: 40000,
      hotel: { hotelId: 'lp1', rateId: 'o1', city: 'Moab', countryCode: 'US', checkin: '2099-11-02', checkout: '2099-11-05', rooms: 1 },
    } as never);
    assert.equal(r.status, 'failed');
    assert.equal(seen.some(s => s.url.includes('/rates/book')), false, 'a room was booked above the ceiling');
  } finally { restore(); }
});

test('approval sets the ceiling and funds at it', () => {
  const src = read('app/api/bookings/[id]/approve/route.ts');
  assert.match(src, /checkedCents = Math\.max\(priceCents, fresh\.priceCents\)/);
  assert.match(src, /request\.maxPriceCents = checkedCents/);
  assert.match(src, /fundingAt\(owed, held, booking\.id, checkedCents\)/);
  // A small rise that leaves the plan short is written onto the row, so
  // funding's shares include it and it can be paid in — not a 402 for ever.
  const short = src.indexOf('if (rise > 0)');
  assert.ok(short > 0);
  assert.ok(src.indexOf('price_cents: checkedCents', short) > short);
  assert.ok(src.indexOf('price_cents: checkedCents', short) < src.indexOf("code: 'not_funded'", short));
});

// ─── 4. A hotel is priced for every room ────────────────────────────────

test('a hotel offer costs every room in it', () => {
  const twoRooms = {
    offerRetailRate: { amount: 700, currency: 'USD' },
    rates: [
      { occupancyNumber: 1, retailRate: { total: [{ amount: 400 }] } },
      { occupancyNumber: 2, retailRate: { total: [{ amount: 300 }] } },
    ],
  };
  assert.deepEqual(offerTotal(twoRooms, 2), { cents: 70000, currency: 'USD' });
  // Without the offer's own total, one rate per room is added up.
  assert.equal(offerTotal({ rates: twoRooms.rates }, 2)?.cents, 70000);
  // A second rate for the same room is an alternative, not another room.
  assert.equal(offerTotal({ rates: [...twoRooms.rates, { occupancyNumber: 1, retailRate: { total: [{ amount: 999 }] } }] }, 2)?.cents, 70000);
  // A room with no price leaves the whole offer unpriced.
  assert.equal(offerTotal({ rates: [twoRooms.rates[0]] }, 2), null);
  assert.equal(offerTotal({ rates: [{ retailRate: { total: [{ amount: 400 }] } }] }, 2), null);
  assert.equal(offerTotal({ rates: [{ retailRate: { total: [{ amount: 400 }] } }] }, 1)?.cents, 40000);
});

// ─── 5. A payment does not strand a failed line ─────────────────────────

test('after a payment, a failed line and a table can still be priced', () => {
  const tried = new Set(['hotel-line']);
  assert.equal(lockedByPayment({ id: 'hotel-line', type: 'hotel' }, tried), false, 'its money is already in');
  assert.equal(lockedByPayment({ id: 'dinner', type: 'restaurant' }, tried), false, 'never in the total');
  assert.equal(lockedByPayment({ id: 'gig', type: 'event' }, tried), false);
  assert.equal(lockedByPayment({ id: 'new-kayak', type: 'activity' }, tried), true, 'new money is still locked');
});

test('/bookable no longer says a failed line is "yours to book directly"', () => {
  const src = read('app/api/plans/[planId]/bookable/route.ts');
  assert.match(src, /lockedByPayment\(i, triedBefore\)/);
  assert.doesNotMatch(src, /it only covers what was on the list then/);
});

// ─── 6. A solo trip is its traveller's ──────────────────────────────────

test('a trip for one books its creator; a solo flag over a group of two books both', () => {
  const me = [{ userId: 'me' }];
  const people = [{ userId: 'me' }, { userId: 'friend' }];
  assert.deepEqual(onTheTrip({ solo_mode: true, created_by: 'me' }, me, 1), [{ userId: 'me' }]);
  assert.deepEqual(onTheTrip({ solo_mode: true, created_by: null }, me, 1), [], 'nobody guessed at');
  assert.deepEqual(onTheTrip({ solo_mode: false, created_by: 'me' }, people, 2), people);
  // Somebody joined and the flag was not cleared (afterJoining's write
  // failed). Funding splits between two, so booking for one would have the
  // newcomer pay half of a seat that is not theirs.
  assert.deepEqual(onTheTrip({ solo_mode: true, created_by: 'me' }, people, 2), people);
  // The count is the group's, before anybody sitting this one out is taken off.
  assert.deepEqual(onTheTrip({ solo_mode: true, created_by: 'me' }, [{ userId: 'friend' }], 2), [{ userId: 'friend' }]);
  assert.equal(isSoloPlan({ solo_mode: true }, 1), true);
  assert.equal(isSoloPlan({ solo_mode: true }, 2), false);
  assert.equal(isSoloPlan({ solo_mode: false }, 1), false);
});

test('quote, stale check and approval read the same people', () => {
  // partySize is 1 for a trip for one; approval must name one person, not the group.
  const participation = read('lib/participation.ts');
  assert.match(participation, /if \(isSoloPlan\(plan, count \?\? 1\)\) return 1;/);
  assert.match(read('lib/booking/reprice.ts'), /party: isSoloPlan\(plan, memberIds\.length\)/);
  assert.match(read('lib/essentials-server.ts'), /onTheTrip\(plan, everyone\.filter\(p => !out\.has\(p\.userId\)\), everyone\.length\)/);
  assert.match(read('lib/essentials-server.ts'), /const solo = !!only && !\(\(data \?\? \[\]\)\.length > 1\);/);
  const approve = read('app/api/bookings/[id]/approve/route.ts');
  assert.match(approve, /travellersFor\(db, ctx\.plan, out\)/);
  assert.doesNotMatch(approve, /bookingTravellers\(/);
  const quote = read('app/api/bookings/route.ts');
  assert.match(quote, /travellersFor\(ctx\.db, ctx\.plan\)/);
  assert.match(quote, /tripTravellerIds\(ctx\.plan\)/);
  assert.match(read('app/api/plans/[planId]/bookable/route.ts'), /tripTravellerIds\(ctx\.plan\)/);
});

// ─── 7. A handed-off flight never blocks payment ────────────────────────

test('a flight handed to the airline is never a stale quote', () => {
  const rows = [
    { id: 'a', vertical: 'flight', status: 'awaiting_approval', mode: 'redirect', request_payload: { vertical: 'flight', party: 2 } },
    { id: 'b', vertical: 'flight', status: 'awaiting_approval', mode: 'native', request_payload: { vertical: 'flight', party: 2 } },
  ];
  assert.deepEqual(staleForParty(rows, 3).map(r => r.id), ['b']);
  assert.match(read('app/api/plans/[planId]/funding/route.ts'), /select\('id, vertical, status, mode, request_payload'\)/);
});

// ─── 8. The claim notices a change made meanwhile ───────────────────────

type RowState = Record<string, unknown>;
function oneRow(row: RowState, opts: { bookingAllowed: boolean }) {
  return {
    from() {
      let patch: RowState = {};
      const filters: [string, string, unknown][] = [];
      let single = false;
      const run = () => {
        if (patch.status === 'booking' && !opts.bookingAllowed) {
          return { data: null, error: { code: '23514', message: 'violates check constraint "bookings_status_check"' } };
        }
        const hit = filters.every(([op, col, v]) => (op === 'is' ? row[col] == null && v === null : row[col] === v));
        if (!hit) return { data: [], error: null };
        Object.assign(row, patch);
        return { data: [{ ...row }], error: null };
      };
      const q = {
        update(p: RowState) { patch = p; return q; },
        eq(c: string, v: unknown) { filters.push(['eq', c, v]); return q; },
        is(c: string, v: unknown) { filters.push(['is', c, v]); return q; },
        select() { return q; },
        maybeSingle() { single = true; return q; },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          const out = run();
          const shaped = single ? { data: (out.data as RowState[] | null)?.[0] ?? null, error: out.error } : out;
          return Promise.resolve(shaped).then(res, rej);
        },
      };
      return q;
    },
  } as never;
}

test('a row changed after approval read it is not claimed', async () => {
  const row: RowState = { id: 'b1', status: 'awaiting_approval', approved_at: null, updated_at: '2026-09-23T09:00:00.000Z' };
  const db = oneRow(row, { bookingAllowed: true });
  const read = row.updated_at;
  // Somebody picked another flight while the price was being checked.
  row.updated_at = '2026-09-23T09:00:05.000Z';
  const got = await claimBooking(db, 'b1', 'u1', read, new Date('2026-09-23T09:00:06.000Z'));
  assert.equal(got.ok, false);
  assert.equal(row.status, 'awaiting_approval');
  // Read again, it claims.
  const again = await claimBooking(db, 'b1', 'u1', row.updated_at, new Date('2026-09-23T09:00:07.000Z'));
  assert.equal(again.ok, true);
});

test('before M1 the stamp says mid-booking, and an old approved_at does not lock a row', async () => {
  // Left by something older: approved_at set, a different updated_at.
  const row: RowState = { id: 'b1', status: 'awaiting_approval', approved_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-02T00:00:00.000Z' };
  assert.equal(midClaim(row), false);
  const db = oneRow(row, { bookingAllowed: false });
  const got = await claimBooking(db, 'b1', 'u1', row.updated_at, new Date('2026-09-23T10:00:00.000Z'));
  assert.equal(got.ok, true, 'a legacy approved_at refused the claim for good');
  assert.equal(got.ok && got.claim.how, 'stamp');
  // Now it reads as mid-booking to everything else.
  assert.equal(midClaim(row), true);
  assert.equal(holdsSomething(row), true, 'a trip could be deleted under a booking at the provider');
  assert.match(String(changeRefusal(row)), /booking this right now/);
  // A second approval that reads it now holds the new version, and is refused
  // by the route on midClaim before it gets here.
});

test('an unknown outcome leaves the row mid-booking', async () => {
  const row: RowState = { id: 'b1', status: 'awaiting_approval', approved_at: null, updated_at: null };
  const db = oneRow(row, { bookingAllowed: false });
  const got = await claimBooking(db, 'b1', 'u1', null, new Date('2026-09-23T10:00:00.000Z'));
  assert.ok(got.ok);
  const claim = (got as { claim: Parameters<typeof finishClaim>[2] }).claim;
  await finishClaim(db, 'b1', claim, { error: 'outcome unknown: no answer' });
  assert.equal(midClaim(row), true, 'the note must not move updated_at');
  assert.equal(row.status, 'awaiting_approval');
});

test('booking is in both delete checks', () => {
  assert.equal(holdsSomething({ status: 'booking' }), true);
  assert.equal(holdsSomething({ status: 'awaiting_approval', approved_at: null, updated_at: 'x' }), false);
  for (const r of ['app/api/groups/[id]/route.ts', 'app/api/plans/[planId]/route.ts']) {
    assert.match(read(r), /holdsSomething/, `${r} deletes under a booking in progress`);
  }
});

test('options and hold refuse a row mid-booking, and write only the version they read', () => {
  const hold = read('app/api/bookings/[id]/hold/route.ts');
  assert.match(hold, /midClaim\(booking\)/);
  assert.match(hold, /atVersion\(/);
});

// ─── 9. Sent and unanswered is not failed ───────────────────────────────

test('an order with no answer is an unknown outcome; a refusal is not', async () => {
  const off = stubFetch(() => 'throw');
  try { await assert.rejects(commitFetch('https://x/book', { method: 'POST' }), (e: unknown) => isOutcomeUnknown(e)); } finally { off.restore(); }
  const five = stubFetch(() => ({ status: 503, json: {} }));
  try { await assert.rejects(commitFetch('https://x/book', { method: 'POST' }), (e: unknown) => e instanceof OutcomeUnknown); } finally { five.restore(); }
  const no = stubFetch(() => ({ status: 422, json: { errors: [] } }));
  try { assert.equal((await commitFetch('https://x/book', { method: 'POST' })).status, 422); } finally { no.restore(); }
});

test('Duffel: an order sent and unanswered is thrown as unknown', async () => {
  process.env.DUFFEL_API_KEY = 'duffel_test_unit';
  const { restore } = stubFetch(u => u.includes('/air/orders') ? 'throw' : { json: offer('500.00') });
  try {
    await assert.rejects(duffelFlights.book({ ...flightReq, maxPriceCents: 50000 }), (e: unknown) => isOutcomeUnknown(e));
  } finally { restore(); }
});

test('approval does not mark an unknown outcome failed, and PATCH cannot unstick one', () => {
  const src = read('app/api/bookings/[id]/approve/route.ts');
  const unknown = src.indexOf('if (isOutcomeUnknown(e))');
  assert.ok(unknown > 0);
  assert.ok(unknown < src.indexOf("status: 'failed', error: msg"), 'unknown must be decided before failed');
  assert.match(src, /code: 'outcome_unknown'/);
  const patch = read('app/api/bookings/[id]/route.ts');
  assert.match(patch, /reachBuys\(booking\)/);
  assert.match(patch, /midClaim\(booking\)/);
});

// ─── 12. The screen reads the code ──────────────────────────────────────

test('each approval answer goes to its own screen', () => {
  assert.equal(approveOutcome(200, {}).kind, 'booked');
  assert.equal(approveOutcome(402, { code: 'not_funded' }).kind, 'notFunded');
  assert.equal(approveOutcome(409, { code: 'price_changed' }).kind, 'priceUp');
  assert.equal(approveOutcome(409, { code: 'party_changed' }).kind, 'reprice');
  assert.equal(approveOutcome(409, { code: 'already_in_progress' }).kind, 'busy');
  assert.equal(approveOutcome(409, { code: 'unavailable', error: 'No rooms.' }).message, 'No rooms.');
  assert.equal(approveOutcome(409, { code: 'unavailable' }).kind, 'refused', 'a 409 is not always a price rise');
  const missing = approveOutcome(400, { code: 'travellers_missing', error: 'Sam needs to add their travel details before this can be booked.' });
  assert.equal(missing.kind, 'refused');
  assert.match(String(missing.message), /Sam needs/);
  assert.equal(approveOutcome(502, { code: 'outcome_unknown' }).kind, 'unknown');
});

test('checkout branches on the code and waits longer than the server', () => {
  const src = read('components/reach-app.jsx');
  assert.match(src, /approveOutcome\(r\.status,/);
  assert.doesNotMatch(src, /if\(r\.status===409\)\{ setPhase\("priceUp"\)/, 'every 409 is "price went up" again');
  assert.doesNotMatch(src, /We'll follow up — you don't need to do anything/);
  assert.match(src, /d\.code==="stale_quotes"/);
  assert.match(src, /reprice:true/);
  const approveCall = /fetchWithin\(`\/api\/bookings\/\$\{b\.id\}\/approve`,[^\n]*?,(\d+),"the booking"\)/.exec(src);
  assert.ok(approveCall);
  const maxDuration = Number(/export const maxDuration = (\d+)/.exec(read('app/api/bookings/[id]/approve/route.ts'))?.[1]);
  assert.ok(Number(approveCall[1]) > maxDuration * 1000);
});

// ─── 13. Every refusal names a way forward that exists ──────────────────

test('the reprice advice names buttons the app has', () => {
  const app = read('components/reach-app.jsx');
  assert.ok(app.includes('"See the hotel · change it"'));
  assert.ok(app.includes('"See the flights · change them"'));
  assert.match(repriceAdvice('hotel', true), /See the hotel · change it/);
  assert.match(repriceAdvice('flight', false), /See the flights · change them/);
  assert.match(repriceAdvice('activity', true), /opening checkout again/);
  assert.doesNotMatch(repriceAdvice('activity', false), /checkout/);
  assert.doesNotMatch(read('app/api/bookings/[id]/approve/route.ts'), /Price it again from checkout/);
});

// ─── 14. Small things ───────────────────────────────────────────────────

test('a help centre or file host is not the airline\'s own site', () => {
  assert.equal(airlineSite('https://www.aa.com/i18n/conditions-of-carriage.jsp'), 'https://www.aa.com');
  assert.equal(airlineSite('https://help.ryanair.com/hc/en-gb/articles/terms'), null);
  assert.equal(airlineSite('https://d1234.cloudfront.net/coc.pdf'), null);
  assert.equal(airlineSite('https://airline.zendesk.com/hc/articles/1'), null);
  assert.equal(airlineSite('https://assets.airline.com/coc.pdf'), null);
});

test('the M2 fallback names M2', () => {
  assert.match(read('app/api/bookings/[id]/approve/route.ts'), /run M2 in \$\{M1\}/);
  const readme = read('ENGINE-README.md');
  assert.doesNotMatch(readme, /skipFundingCheck|executeNow/);
});
