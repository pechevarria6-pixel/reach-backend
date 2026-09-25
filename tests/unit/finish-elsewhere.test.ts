import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  originOf, byDepartureAirport, departureWhy, travelDetails, iataOf,
  originsFor, nearestAirportFor, MAX_NEAREST_LOOKUPS,
} from '../../lib/airports.ts';
import {
  failuresByLine, nothingFound, nearbyDates, nearbyAsk, TRY_NEARBY_DATES,
} from '../../lib/booking/failures.ts';
import {
  bookingFacts, confirmationInput, confirmationColumnMissing, BOOKING_COLUMNS,
} from '../../lib/contracts/booking.ts';

// ─── Where each traveller flies from ────────────────────────────────────

const sam = { userId: 'u-sam', name: 'Sam' };
const alex = { userId: 'u-alex', name: 'Alex' };
const jo = { userId: 'u-jo', name: 'Jo' };

test('a saved airport is a choice; one worked out from the city says so', () => {
  assert.deepEqual(originOf({ ...sam, homeCity: 'Oakland, California', homeAirport: 'sfo' }),
    { ...sam, airport: 'SFO', source: 'saved', derived: false });
  assert.deepEqual(originOf({ ...sam, homeCity: 'Pittsburgh, Pennsylvania' }),
    { ...sam, airport: 'PIT', source: 'city', derived: true });
});

test('a city the table does not know falls back to the nearest airport, labelled as derived', () => {
  const o = originOf({ ...jo, homeCity: 'Asheville, North Carolina' }, 'avl');
  assert.equal(o.airport, 'AVL');
  assert.equal(o.source, 'nearest');
  assert.equal(o.derived, true, 'worked out, not chosen — the screen has to say so');
  // A lookup that found nothing is not an airport.
  assert.equal(originOf({ ...jo, homeCity: 'Asheville' }, null).airport, null);
  assert.equal(originOf({ ...jo, homeCity: 'Asheville' }, 'not an airport').airport, null);
  assert.equal(iataOf('RDU '), 'RDU');
  assert.equal(iataOf('RD'), null);
});

test('one flight booking per departure airport, most people first', () => {
  const split = byDepartureAirport([
    originOf({ ...jo, homeAirport: 'RDU' }),
    originOf({ ...sam, homeCity: 'Pittsburgh, PA' }),
    originOf({ ...alex, homeAirport: 'PIT' }),
  ]);
  assert.deepEqual(split.groups.map(g => [g.airport, g.userIds]), [['PIT', ['u-sam', 'u-alex']], ['RDU', ['u-jo']]]);
  assert.deepEqual(split.groups[0].derivedFor, ['u-sam'], 'Sam never chose PIT');
  assert.deepEqual(split.unknown, []);
});

test('everybody from one airport is one booking, and nothing is skipped', () => {
  const split = byDepartureAirport([originOf({ ...sam, homeAirport: 'PIT' }), originOf({ ...alex, homeCity: 'Pittsburgh' })]);
  assert.equal(departureWhy(split, 'u-sam'), null);
});

test('several airports are named, each with who leaves from it — never the organiser\'s for everybody', () => {
  const split = byDepartureAirport([
    originOf({ ...sam, homeAirport: 'PIT' }), originOf({ ...alex, homeAirport: 'PIT' }), originOf({ ...jo, homeAirport: 'RDU' }),
  ]);
  const why = departureWhy(split, 'u-sam') ?? '';
  assert.match(why, /you and Alex fly from PIT and Jo flies from RDU/);
  assert.match(why, /one per airport/);
  assert.doesNotMatch(why, /will book|we'll book|booked/i, 'offers a search, promises nothing');
});

test('an unknown airport asks the one person who can fix it', () => {
  const mine = byDepartureAirport([originOf({ ...sam, homeAirport: 'PIT' }), originOf({ ...alex })]);
  assert.equal(departureWhy(mine, 'u-alex'), 'add your home airport in Profile and we can price this flight');
  const theirs = departureWhy(mine, 'u-sam') ?? '';
  assert.match(theirs, /where Alex flies from/);
  // Checkout turns "home airport" into a button to the reader's own Profile.
  assert.doesNotMatch(theirs, /home airport/i, 'Sam cannot fix Alex\'s airport from Sam\'s Profile');
});

// ─── Readiness, per member ──────────────────────────────────────────────

test('readiness says ready or needs details for each member, airport included on a trip that flies', () => {
  const ready = { userId: 'u-sam', name: 'Sam', ready: true, missing: [] as string[] };
  const noAirport = travelDetails(ready, { flies: true, originsRead: true, origin: originOf({ ...sam }) });
  assert.equal(noAirport.status, 'needs_details');
  assert.deepEqual(noAirport.needs, ['home airport']);

  const placed = travelDetails(ready, { flies: true, originsRead: true, origin: originOf({ ...sam, homeCity: 'Pittsburgh' }) });
  assert.equal(placed.status, 'ready');
  assert.deepEqual(placed.origin, { airport: 'PIT', derived: true, source: 'city' });

  const noDob = travelDetails({ ...ready, ready: false, missing: ['date of birth'] },
    { flies: true, originsRead: true, origin: originOf({ ...sam, homeAirport: 'PIT' }) });
  assert.equal(noDob.status, 'needs_details');
  assert.deepEqual(noDob.needs, ['date of birth']);
});

test('a night out never asks for an airport, and a failed read is not somebody\'s missing detail', () => {
  const ready = { userId: 'u-sam', name: 'Sam', ready: true, missing: [] as string[] };
  const dinner = travelDetails(ready, { flies: false, originsRead: false, origin: null });
  assert.equal(dinner.status, 'ready');
  assert.equal('origin' in dinner, false);
  assert.equal('needs' in dinner, false);
  const unread = travelDetails(ready, { flies: true, originsRead: false, origin: null });
  assert.equal(unread.status, 'ready');
});

test('a plan with no flight asks nobody for the fields a ticket is issued against', () => {
  // Sam never gave a date of birth or gender: that holds up a flight, not a dinner.
  const noDob = { userId: 'u-sam', name: 'Sam', ready: false, missing: ['date of birth', 'gender'] };
  const dinner = travelDetails(noDob, { flies: false, originsRead: false, origin: null });
  assert.equal(dinner.status, 'ready', 'a dinner and a bar need nobody\'s date of birth');
  assert.equal('needs' in dinner, false);
  const flight = travelDetails(noDob, { flies: true, originsRead: true, origin: originOf({ ...sam, homeAirport: 'PIT' }) });
  assert.equal(flight.status, 'needs_details', 'the same gap still holds up a flight');
});

// ─── A lookup that failed is ours, not their missing airport ───────────

test('a nearest-airport lookup that failed or was never asked is unread, not a missing airport', async () => {
  const people = ['Boone, NC', 'Blowing Rock, NC', 'Banner Elk, NC', 'Valle Crucis, NC', 'Sugar Grove, NC', 'Todd, NC']
    .map((homeCity, i) => ({ userId: `u-${i}`, name: `P${i}`, homeCity }));
  let calls = 0;
  const out = await originsFor(people, async () => { calls++; return 'TRI'; });
  assert.equal(calls, MAX_NEAREST_LOOKUPS);
  assert.deepEqual(out.slice(0, 4).map(o => o.airport), ['TRI', 'TRI', 'TRI', 'TRI']);
  assert.deepEqual(out.slice(4).map(o => [o.airport, o.unread]), [[null, true], [null, true]], 'past the cap is not asked, not absent');

  // One city asked once, however many live there.
  let same = 0;
  const town = await originsFor([1, 2, 3, 4, 5, 6].map(i => ({ userId: `u-${i}`, name: `P${i}`, homeCity: 'Boone, NC' })),
    async () => { same++; return 'TRI'; });
  assert.equal(same, 1);
  assert.equal(town.every(o => o.airport === 'TRI'), true);

  const [timedOut] = await originsFor([{ ...jo, homeCity: 'Boone, NC' }], async () => 'failed');
  assert.equal(timedOut.unread, true);
  const [threw] = await originsFor([{ ...jo, homeCity: 'Boone, NC' }], async () => { throw new Error('timeout'); });
  assert.equal(threw.unread, true);
  const [nowhere] = await originsFor([{ ...jo, homeCity: 'Nowhere' }], async () => null);
  assert.equal(nowhere.unread, undefined, 'a lookup that answered "nothing near" is a real gap');

  const split = byDepartureAirport([originOf({ ...sam, homeAirport: 'PIT' }), timedOut]);
  assert.deepEqual(split.unknown, []);
  assert.deepEqual(split.unread.map(o => o.userId), ['u-jo']);
  const why = departureWhy(split, 'u-sam') ?? '';
  assert.match(why, /couldn't work out where Jo flies from/);
  assert.doesNotMatch(why, /Profile|home airport/i, 'nobody is sent to fix what is ours');
  const mine = departureWhy(split, 'u-jo') ?? '';
  assert.doesNotMatch(mine, /add your home airport/i);

  const ready = { userId: 'u-jo', name: 'Jo', ready: true, missing: [] as string[] };
  const t = travelDetails(ready, { flies: true, originsRead: true, origin: timedOut });
  assert.equal(t.status, 'ready');
  assert.deepEqual(t.needs, []);
  assert.equal(t.origin?.unread, true);
});

test('nearestAirportFor tells "nothing near" from "could not ask"', async () => {
  const pt = { lat: 36.2, lng: -81.7 };
  const ok = (async () => new Response('{}', { status: 200 })) as typeof fetch;
  const bad = (async () => new Response('', { status: 503 })) as typeof fetch;
  const duffel = async (_p: unknown, _r?: number, f?: typeof fetch) => {
    await f!('https://x');
    return [];
  };
  const base = { locate: async () => pt, airports: duffel, keyed: true };
  assert.equal(await nearestAirportFor('Boone', { ...base, fetchImpl: ok }), null);
  assert.equal(await nearestAirportFor('Boone', { ...base, fetchImpl: bad }), 'failed', 'a Duffel 5xx is not "no airport"');
  assert.equal(await nearestAirportFor('Boone', { ...base, keyed: false, fetchImpl: ok }), 'failed', 'no key, never asked');
  assert.equal(await nearestAirportFor('Boone', { ...base, locate: async () => 'failed' as const, fetchImpl: ok }), 'failed');
  assert.equal(await nearestAirportFor('Boone', { ...base, locate: async () => null, fetchImpl: ok }), null);
  assert.equal(await nearestAirportFor('Boone', { ...base, fetchImpl: ((async () => { throw new Error('net'); }) as unknown as typeof fetch) }), 'failed');
  assert.equal(await nearestAirportFor('Boone', { ...base, airports: async () => [{ iata: 'TRI' }], fetchImpl: ok }), 'TRI');
});

// ─── Nothing for these dates ────────────────────────────────────────────

test('a search that found nothing is told apart from one that broke', () => {
  assert.equal(nothingFound('flight', 'No flights found for those dates.'), true);
  assert.equal(nothingFound('flight', 'No other flights found for those dates.'), true);
  assert.equal(nothingFound('hotel', 'No rates available'), true);
  assert.equal(nothingFound('hotel', 'No other hotels have rooms for those dates.'), true);
  // One pinned hotel with no rooms wants another hotel, not other dates.
  assert.equal(nothingFound('hotel', 'That hotel has no rooms left for these dates.'), false);
  assert.equal(nothingFound('flight', 'The flights you chose are no longer on sale — pick another from the options.'), false);
  assert.equal(nothingFound('flight', 'DUFFEL_API_KEY is not set — the flight lane is switched off.'), false);
});

test('nearby dates keep the trip\'s length, nearest first, and none in the past', () => {
  assert.deepEqual(nearbyDates('2026-10-10', '2026-10-13', '2026-09-25'), [
    { start: '2026-10-09', end: '2026-10-12' },
    { start: '2026-10-11', end: '2026-10-14' },
    { start: '2026-10-08', end: '2026-10-11' },
    { start: '2026-10-12', end: '2026-10-15' },
  ]);
  // Tomorrow's trip cannot move two days back.
  const soon = nearbyDates('2026-09-26', '2026-09-27', '2026-09-25');
  assert.ok(soon.every(w => w.start >= '2026-09-25'));
  assert.deepEqual(soon[0], { start: '2026-09-25', end: '2026-09-26' });
  // Across a month end.
  assert.deepEqual(nearbyDates('2026-10-31', '2026-11-01', '2026-09-25', 1), [{ start: '2026-10-30', end: '2026-10-31' }]);
  assert.deepEqual(nearbyDates(null, null, '2026-09-25'), []);
});

test('the line is kept with a nearby-dates reason, and the copy offers a search', () => {
  const requests = [
    { itineraryItemId: 'f1', title: 'Flights to PVR', vertical: 'flight' },
    { itineraryItemId: 'h1', title: '3 nights in PVR', vertical: 'hotel' },
    { itineraryItemId: 'a1', title: 'Kayak', vertical: 'activity' },
  ];
  const results = [
    { status: 'failed', error: 'No flights found for those dates.', itineraryItemId: 'f1' },
    { status: 'failed', error: 'No rates available', itineraryItemId: 'h1', stillPriced: true },
    { status: 'failed', error: 'Not available on that date', itineraryItemId: 'a1' },
  ];
  const out = failuresByLine(requests, results, { start: '2026-10-10', end: '2026-10-13', today: '2026-09-25' });
  assert.equal(out[0].reason, TRY_NEARBY_DATES);
  assert.equal(out[0].ask, "We couldn't find a flight for these dates — try nearby dates?");
  assert.equal(out[0].nearby?.length, 4);
  assert.equal(out[1].reason, undefined, 'still in the total at its old price — not missing');
  assert.equal(out[2].reason, undefined);
  assert.match(nearbyAsk('hotel'), /room for these dates — try nearby dates\?$/);
  for (const ask of [nearbyAsk('flight'), nearbyAsk('hotel')]) assert.doesNotMatch(ask, /we('ll| will) find|guarantee/i);
});

// ─── "I've got it" ──────────────────────────────────────────────────────

test('a confirmation number is kept as typed, and none at all is a fine answer', () => {
  assert.deepEqual(confirmationInput('  ABC 123 '), { ok: true, value: 'ABC 123' });
  assert.deepEqual(confirmationInput(''), { ok: true, value: null });
  assert.deepEqual(confirmationInput(undefined), { ok: true, value: null });
  assert.deepEqual(confirmationInput(null), { ok: true, value: null });
  assert.equal(confirmationInput('x'.repeat(101)).ok, false);
  assert.equal(confirmationInput(12345).ok, false);
  assert.equal(confirmationInput('AB\u0000C').ok, false);
});

test('the missing column is told apart from a refusal of what was typed', () => {
  assert.equal(confirmationColumnMissing({ code: '42703', message: 'column bookings.confirmation_number does not exist' }), true);
  assert.equal(confirmationColumnMissing({ code: 'PGRST204', message: "Could not find the 'confirmation_number' column" }), true);
  assert.equal(confirmationColumnMissing({ code: '23514', message: 'violates check constraint "bookings_confirmation_number_shape"' }), false,
    'dropping the number over a CHECK would lose it silently');
  assert.equal(confirmationColumnMissing(null), false);
});

test('the number reaches the screen, and is not in the narrow column list before the migration', () => {
  const f = bookingFacts({ id: 'b1', mode: 'redirect', status: 'confirmed', confirmation_number: ' TM-88 ' });
  assert.equal(f.confirmationNumber, 'TM-88');
  assert.equal(bookingFacts({ id: 'b2' }).confirmationNumber, null, 'absent before the migration');
  // A select naming it would fail the whole read with 42703 until the owner runs the file.
  assert.ok(!BOOKING_COLUMNS.includes('confirmation_number'));
});

// ─── The routes keep their contract ─────────────────────────────────────

const bookable = readFileSync(new URL('../../app/api/plans/[planId]/bookable/route.ts', import.meta.url), 'utf8');
const confirmation = readFileSync(new URL('../../app/api/bookings/[id]/confirmation/route.ts', import.meta.url), 'utf8');
const readiness = readFileSync(new URL('../../app/api/plans/[planId]/readiness/route.ts', import.meta.url), 'utf8');

test('bookable prices flights from each traveller\'s airport, not the organiser\'s', () => {
  assert.doesNotMatch(bookable, /select\('home_airport'\)\.eq\('id', ctx\.user\.id\)/,
    'the organiser\'s airport is not everybody\'s');
  assert.match(bookable, /travellerOrigins\(ctx\.db, ctx\.plan\)/);
  assert.match(bookable, /departureWhy\(departure, ctx\.user\.id\)/);
});

test('bookable logs slot_unfilled for a search that found nothing', () => {
  assert.match(bookable, /f\.reason !== TRY_NEARBY_DATES/);
  assert.match(bookable, /track\(ctx\.db, 'slot_unfilled'/);
});

test('"I\'ve got it" still works before the column exists', () => {
  assert.match(confirmation, /confirmationColumnMissing\(res\.error\)/);
  assert.match(confirmation, /res = await write\(base\)/);
  assert.match(confirmation, /reachBuys\(booking\)/, 'Reach\'s own purchases are never marked done by somebody saying so');
});

test('readiness gives every member a status', () => {
  assert.match(readiness, /travelDetails\(t, /);
});

test('bookable reads a failed lookup as ours to retry', () => {
  assert.match(bookable, /departure\.unread\.length \? 'origins_unread'/);
});
