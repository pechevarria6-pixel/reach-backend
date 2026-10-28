// Run with: npm run test:unit
//
// "I'll drive / already have a flight" (owner decision 8): somebody comes
// off the group's flight until anybody pays, and while the flight is only
// proposed. The hotel is never one to sit out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canOptOut, optOutRefusal, lastOut, joinedLate, whoIsOff, flightNow, memberJoins,
  droppedFlight, offEveryFlight, wouldDropFlight, DROP_WARNING,
} from '../../lib/participation.ts';
import { linesYoureOff } from '../../lib/budget.ts';
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
  assert.deepEqual(whoIsOff([{ id: 'f1', status: 'confirmed' }], skips, members, joins), { driving: 1, late: 1, nobodyFlying: false });

  const est = awayEstimate({ tier: 'on_budget', total_per_person: 1500, costs: { flights: { per_person: 400 }, accommodation: { per_person: 600 } } }, { nights: 3 });
  const flight = awayLines(est, { town: 'Lisbon', party: 4, driving: 1, joinedLate: 1, solo: false }).find(l => l.type === 'flight')!;
  assert.equal(flight.flying, 2);
  assert.equal(flight.party_cents, 80000);
  assert.match(flight.subtitle, /2 flying, 1 driving or already booked, 1 joined after the seats were booked/);
});

const DROPPED = (from = 'awaiting_approval') => ({
  id: 'f1', status: 'cancelled',
  request_payload: { party: 2, nobody_flying: { from, item_id: 'l1', line: { type: 'flight', title: 'Round-trip flights' }, removed: [], at: '2026-10-05T00:00:02Z' } },
});

test('a flight taken off because nobody was on it is known by its own record, not by who has a row on it', () => {
  const members = ['a', 'b'];
  const everyone = [{ ref: 'f1', userId: 'a', at: '2026-10-05T00:00:00Z' }, { ref: 'f1', userId: 'b', at: '2026-10-05T00:00:01Z' }];
  assert.deepEqual(whoIsOff([DROPPED()], everyone, members), { driving: 2, late: 0, nobodyFlying: true });
  // (a) two drivers at once: the loser's row was taken back. Still off.
  assert.equal(whoIsOff([DROPPED()], everyone.slice(0, 1), members).nobodyFlying, true);
  // (b) a fourth friend joined after: no row on the cancelled booking. Still
  // off — and not counted as driving, which they never said.
  const four = whoIsOff([DROPPED()], everyone, [...members, 'c']);
  assert.equal(four.nobodyFlying, true, 'a rebuild must not put a flight back for everybody');
  assert.equal(four.driving, 2);
  // Any other cancelled or failed flight is nothing to be on.
  assert.deepEqual(whoIsOff([{ id: 'f1', status: 'cancelled' }], everyone, members), { driving: 0, late: 0, nobodyFlying: false });
  assert.deepEqual(whoIsOff([{ id: 'f1', status: 'failed' }], everyone, members), { driving: 0, late: 0, nobodyFlying: false });
  // A flight still on beside one taken off decides who flies.
  assert.deepEqual(whoIsOff([DROPPED(), { id: 'f2', status: 'awaiting_approval' }], [], members), { driving: 0, late: 0, nobodyFlying: false });
});

test('the record says what to reopen to, and only a cancelled flight carries one', () => {
  assert.equal(droppedFlight(DROPPED('quoted'))?.from, 'quoted');
  assert.equal(droppedFlight(DROPPED())?.item_id, 'l1');
  assert.equal(droppedFlight({ ...DROPPED(), status: 'awaiting_approval' }), null);
  assert.equal(droppedFlight({ status: 'cancelled', request_payload: { party: 2 } }), null);
  assert.equal(droppedFlight({ ...DROPPED(), vertical: 'hotel' }), null);
  assert.equal(droppedFlight({ ...DROPPED('confirmed') })?.from, 'awaiting_approval', 'never reopened as bought');
});

test('the last one off is asked first, and only the last one', () => {
  const members = ['a', 'b', 'c'];
  assert.equal(wouldDropFlight('flight', members, new Set(['a', 'b'])), false);
  assert.equal(wouldDropFlight('flight', members, new Set(['a', 'b', 'c'])), true);
  assert.equal(wouldDropFlight('restaurant', members, new Set(members)), false);
  assert.equal(wouldDropFlight('flight', [], new Set()), false);
  assert.match(DROP_WARNING, /for everyone/);
  assert.match(DROP_WARNING, /I.m flying/, 'and the way back is said with it');
});

test('who is off every flight: drivers, and everybody once the flight is off', () => {
  const members = ['a', 'b', 'c'];
  const flights = [{ id: 'f1', status: 'awaiting_approval' }, { id: 'f2', status: 'awaiting_approval' }];
  const skips = [{ ref: 'f1', userId: 'a' }, { ref: 'f2', userId: 'a' }, { ref: 'f1', userId: 'b' }];
  assert.deepEqual([...offEveryFlight(flights, skips, members)], ['a'], 'b is still on the flight from the other airport');
  assert.deepEqual([...offEveryFlight([], skips, members)], [], 'no flight: nobody is anything');
  assert.deepEqual([...offEveryFlight([DROPPED()], [], members)].sort(), members);
  assert.deepEqual([...offEveryFlight([{ id: 'f1', status: 'failed' }], skips, members)], []);
});

test('when members joined cannot be read, it says so — never an empty map', async () => {
  const db = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { code: '57014' } }) }) }) };
  const err = console.error; console.error = () => {};
  try {
    await assert.rejects(memberJoins(db as never, 'g1'), /could not read when members joined/i);
  } finally { console.error = err; }
  const ok = { from: () => ({ select: () => ({ eq: async () => ({ data: [{ user_id: 'a', joined_at: '2026-09-01T00:00:00Z' }], error: null }) }) }) };
  assert.equal((await memberJoins(ok as never, 'g1')).get('a'), '2026-09-01T00:00:00Z');
});

test('the Budget tab leaves out what you are not in for', () => {
  const bookings = [
    { id: 'f1', itinerary_item_id: 'l-flight', status: 'awaiting_approval' },
    { id: 'h1', itinerary_item_id: 'l-hotel', status: 'awaiting_approval' },
    { id: 'old', itinerary_item_id: 'l-old', status: 'cancelled' },
  ];
  const items = [{ ref: 'f1', imIn: false }, { ref: 'h1', imIn: true }, { ref: 'old', imIn: false, dropped: true }];
  assert.deepEqual([...linesYoureOff(bookings, items)], ['l-flight']);
  assert.deepEqual([...linesYoureOff(bookings, null)], [], 'unknown is nothing taken out');
  const app = readFileSync(new URL('../../components/reach-app.jsx', import.meta.url), 'utf8');
  assert.match(app, /const youreOff=linesYoureOff\(planBookings,share\?\.items\)/);
  assert.match(app, /booking_mode==="reach"&&i\.cost_cents>0&&!youreOff\.has\(String\(i\.id\)\)\)/);
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
  assert.match(src, /nobody_flying: record/, 'the drop is recorded on the booking');
  assert.match(src, /if \(now && droppedFlight\(now\)\) return \{ ok: true/, 'the second of two last flyers is answered, not refused');
  assert.match(src, /wouldDropFlight\(booking\.vertical, memberIds, out\) && !confirm/, 'asked before the write');
  assert.match(src, /wouldDropFlight\(booking\.vertical, memberIds, offNow\) && !confirm/, 'and again after, for two at once');
  assert.match(src, /reopenFlight\(/, '"I\'m flying" puts it back');
  assert.match(src, /flightOnlyLine\(r\)/, 'the car and transfers come off with it');
  assert.match(src, /\.eq\('vertical', 'flight'\)\.eq\('status', 'cancelled'\)/, 'and it is still listed, for the way back');
  assert.match(src, /memberJoins\(ctx\.db, String\(ctx\.plan\.group_id\)\)\.catch\(\(\) => null\)/);
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

test('readiness, the quote and /bookable ask nothing of somebody off every flight', () => {
  const es = readFileSync(new URL('../../lib/essentials-server.ts', import.meta.url), 'utf8');
  assert.match(es, /const flyers = marked\.filter\(t => t\.flying\)/);
  assert.match(es, /ready: flyers\.every\(t => t\.ready\), blocking: blockingMessage\(flyers\)/);
  for (const f of ['../../app/api/plans/[planId]/readiness/route.ts', '../../app/api/bookings/route.ts', '../../app/api/plans/[planId]/bookable/route.ts']) {
    assert.match(readFileSync(new URL(f, import.meta.url), 'utf8'), /await notFlyingIds\(/, f);
  }
  const app = readFileSync(new URL('../../components/reach-app.jsx', import.meta.url), 'utf8');
  assert.match(app, /if\(!r\|\|r\.flying===false\)return null;/, 'no "Needs details" beside a driver');
});
