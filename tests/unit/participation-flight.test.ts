// Run with: npm run test:unit
//
// "I'll drive / already have a flight" (owner decision 8): somebody comes
// off the group's flight until anybody pays, and while the flight is only
// proposed. The hotel is never one to sit out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canOptOut, optOutRefusal, lastOut, joinedLate, whoIsOff, flightNow } from '../../lib/participation.ts';
import { awayEstimate, awayLines } from '../../lib/away-lines.ts';
import { partyFor } from '../../lib/booking/resize.ts';
import { sharesWithSkips } from '../../lib/money.ts';

test('a flight can be sat out; somewhere to stay cannot', () => {
  for (const v of ['activity', 'event', 'restaurant', 'flight']) assert.equal(canOptOut(v), true, v);
  for (const v of ['hotel', '', null, undefined, 'transport']) assert.equal(canOptOut(v), false, String(v));
});

test('a proposed flight, nobody paid: the driver comes off', () => {
  assert.equal(optOutRefusal({ vertical: 'flight', status: 'awaiting_approval', anyonePaid: false }), null);
});

test('once anybody pays, nobody comes off the flight', () => {
  const r = optOutRefusal({ vertical: 'flight', status: 'awaiting_approval', anyonePaid: true });
  assert.equal(r?.status, 409);
  assert.match(r!.error, /already paid/);
});

test('a bought seat is somebody\'s seat', () => {
  for (const status of ['pending', 'confirmed', 'booking']) {
    const r = optOutRefusal({ vertical: 'flight', status, anyonePaid: false });
    assert.equal(r?.status, 409, status);
    assert.doesNotMatch(r!.error, /held/, 'nothing is "held" about a bought seat');
  }
});

test('a flight held back with Hold holds nobody\'s seat, so a driver can still come off', () => {
  // 'quoted' is the group waiting on the fare: out of every total, priced
  // again for whoever is flying when it is let go.
  assert.equal(optOutRefusal({ vertical: 'flight', status: 'quoted', anyonePaid: false }), null);
  assert.equal(optOutRefusal({ vertical: 'flight', status: 'quoted', anyonePaid: true })?.status, 409);
});

test('the hotel is refused whatever the state', () => {
  const r = optOutRefusal({ vertical: 'hotel', status: 'awaiting_approval', anyonePaid: false });
  assert.equal(r?.status, 400);
  assert.doesNotMatch(r!.error, /getting there/, 'getting there can be sat out now — the copy must not say it cannot');
});

test('a dinner is still governed only by payment', () => {
  assert.equal(optOutRefusal({ vertical: 'restaurant', status: 'confirmed', anyonePaid: false }), null);
  assert.equal(optOutRefusal({ vertical: 'restaurant', status: 'confirmed', anyonePaid: true })?.status, 409);
});

test('the last person off a flight takes the flight off the plan; a dinner keeps its last one', () => {
  assert.deepEqual(lastOut('flight'), { action: 'drop_flight' });
  const dinner = lastOut('restaurant');
  assert.equal(dinner.action, 'refuse');
  assert.match((dinner as { error: string }).error, /in for this one/);
});

test('everybody driving gets the no-flight line, never a fare for nobody', () => {
  const est = awayEstimate({ tier: 'on_budget', total_per_person: 1500, costs: { flights: { per_person: 400 }, accommodation: { per_person: 600 } } }, { nights: 3 });
  const lines = awayLines(est, { town: 'Asheville', party: 2, driving: 2, solo: false });
  assert.equal(lines.some(l => l.type === 'flight'), false);
  assert.equal(lines[0].title, 'Everyone is driving or already has a flight');
  assert.equal(lines[0].booking_mode, null);
});

test('kept off by joining late is not driving', () => {
  const joined = '2026-10-01T12:00:00.000Z';
  assert.equal(joinedLate({ at: '2026-10-01T11:59:59.500Z' }, joined), true, 'written before the membership row');
  assert.equal(joinedLate({ at: '2026-10-02T09:00:00.000Z' }, joined), false, 'chosen by a member');
  assert.equal(joinedLate({ at: null }, joined), false);
  assert.equal(joinedLate({ at: '2026-10-01T11:00:00Z' }, null), false);

  const members = ['a', 'b', 'c', 'd'];
  const joins = new Map([['a', '2026-09-01T00:00:00Z'], ['b', '2026-09-01T00:00:00Z'], ['c', '2026-09-01T00:00:00Z'], ['d', joined]]);
  const skips = [
    { ref: 'f1', userId: 'c', at: '2026-09-20T00:00:00Z' },  // drives
    { ref: 'f1', userId: 'd', at: '2026-10-01T11:59:59Z' },  // joined after the seats were bought
  ];
  assert.deepEqual(whoIsOff([{ id: 'f1', status: 'confirmed' }], skips, members, joins), { driving: 1, late: 1 });

  const est = awayEstimate({ tier: 'on_budget', total_per_person: 1500, costs: { flights: { per_person: 400 }, accommodation: { per_person: 600 } } }, { nights: 3 });
  const flight = awayLines(est, { town: 'Lisbon', party: 4, driving: 1, joinedLate: 1, solo: false }).find(l => l.type === 'flight')!;
  assert.equal(flight.flying, 2);
  assert.equal(flight.party_cents, 80000);
  assert.match(flight.subtitle, /2 flying, 1 driving or already booked, 1 joined after the seats were booked/);
});

test('a flight dropped because nobody was on it still says everybody drives; any other cancelled one is nothing', () => {
  const members = ['a', 'b'];
  const everyone = [{ ref: 'f1', userId: 'a', at: '2026-10-05T00:00:00Z' }, { ref: 'f1', userId: 'b', at: '2026-10-05T00:00:01Z' }];
  assert.deepEqual(whoIsOff([{ id: 'f1', status: 'cancelled' }], everyone, members), { driving: 2, late: 0 });
  assert.deepEqual(whoIsOff([{ id: 'f1', status: 'cancelled' }], everyone.slice(0, 1), members), { driving: 0, late: 0 });
  assert.deepEqual(whoIsOff([{ id: 'f1', status: 'failed' }], everyone, members), { driving: 0, late: 0 });
});

test('a flyer is shown the quote\'s own per-seat fare for the seats flying now, marked', () => {
  const four = { vertical: 'flight', status: 'awaiting_approval', price_cents: 120000, request_payload: { party: 4, flight: { seats: 4 } } };
  const r = flightNow(four, 3);
  assert.deepEqual(r, { priceCents: 90000, repriced: true }, '$300 a seat for three, not $1,200 split three ways');
  assert.deepEqual(flightNow(four, 4), { priceCents: 120000, repriced: false });
  assert.deepEqual(flightNow({ ...four, status: 'confirmed' }, 3), { priceCents: 120000, repriced: false }, 'a bought fare is what was paid');
  assert.deepEqual(flightNow({ vertical: 'restaurant', status: 'awaiting_approval', price_cents: 5000 }, 3), { priceCents: 5000, repriced: false });
});

test('a driver off the flight shrinks its party and its split', () => {
  const members = ['a', 'b', 'c', 'd'];
  const skips = [{ ref: 'f1', userId: 'd' }];
  assert.equal(partyFor(4, members, skips, 'f1'), 3);
  const shares = sharesWithSkips([{ ref: 'f1', priceCents: 90000 }], members, skips);
  assert.deepEqual(shares, { a: 30000, b: 30000, c: 30000, d: 0 });
});

test('the route asks the shared rule, not its own list', () => {
  const src = readFileSync(new URL('../../app/api/plans/[planId]/participation/route.ts', import.meta.url), 'utf8');
  assert.match(src, /optOutRefusal\(/);
  assert.match(src, /canOptOut\(b\.vertical\)/);
  assert.doesNotMatch(src, /canSkip\(/);
});

test('the route drops a flight nobody is on, and decides it on what was written', () => {
  const src = readFileSync(new URL('../../app/api/plans/[planId]/participation/route.ts', import.meta.url), 'utf8');
  assert.match(src, /lastOut\(booking\.vertical\)/);
  assert.match(src, /dropFlight\(/);
  assert.match(src, /const after = await readSkips/);
  assert.match(src, /\.eq\('id', booking\.id\)\.eq\('status', booking\.status\)/, 'cancelled only as it was read');
  assert.match(src, /flightNow\(/);
});

test('nobody is told they are driving for having joined late, nor "joined late" for driving', () => {
  const app = readFileSync(new URL('../../components/reach-app.jsx', import.meta.url), 'utf8');
  assert.match(app, /it\.joinedLate\?"You joined after these seats were booked/);
  const funding = readFileSync(new URL('../../app/api/plans/[planId]/funding/route.ts', import.meta.url), 'utf8');
  assert.match(funding, /notOnBooked\(seatsAndRooms, keptOff, memberIds\)/);
  assert.match(funding, /joinedLate\(s, joins\.get\(s\.userId\)\)/);
  const gen = readFileSync(new URL('../../app/api/trips/generate/route.ts', import.meta.url), 'utf8');
  assert.match(gen, /joinedLate: off\.late/);
});
