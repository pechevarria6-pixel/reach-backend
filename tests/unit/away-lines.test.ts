// Checkout spec Task 6a: an away plan always carries getting there and a
// bed for every night — on the option card's estimate and in the itinerary
// — and the three tiers differ in how they travel and sleep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TIER_TRAVEL, TIERS, awayPromptBlock, awayGaps, awayCorrection, awayEstimate, awayLines, rowOf,
  flightsForTier, hotelsForTier, flightFits,
} from '../../lib/away-lines.ts';
import { TripAttachments } from '../../lib/trip-schema.ts';

const option = (over: Record<string, any> = {}) => ({
  destination: 'Lisbon, Portugal', city: 'Lisbon', tier: 'on_budget', total_per_person: 2000,
  costs: {
    flights: { per_person: 700, details: 'Daytime, one stop' },
    accommodation: { per_person: 700, details: 'Mid-range, 7 nights', example: 'Alfama' },
    ground_transport: { per_person: 100, details: 'Metro' },
    food_drink: { per_person: 300, details: '' }, activities: { per_person: 150, details: '' }, misc: { per_person: 50, details: '' },
  },
  ...over,
});

test('the three tiers differ in the class of stay and the timing of the flight', () => {
  const stays = new Set(TIERS.map(t => TIER_TRAVEL[t].stay));
  const flights = new Set(TIERS.map(t => TIER_TRAVEL[t].flight));
  assert.equal(stays.size, 3, 'three classes of stay');
  assert.equal(flights.size, 3, 'three kinds of flight');
  const block = awayPromptBlock({ nights: 7, from: 'Raleigh (RDU)' });
  for (const t of TIERS) {
    assert.ok(block.includes(TIER_TRAVEL[t].stayLabel), `the prompt says ${t}'s stay`);
    assert.ok(block.includes(TIER_TRAVEL[t].flightLabel), `the prompt says ${t}'s flights`);
  }
  assert.match(block, /all 7 nights/);
  assert.match(block, /never a\s+named hotel/i, 'the area, never a hotel nobody checked');
});

test('an option that prices no flight or no bed is caught, and the retry names what is missing', () => {
  const gaps = awayGaps([
    option(),
    option({ destination: 'Porto', tier: 'saver', costs: { ...option().costs, flights: { per_person: 0, details: '' } } }),
    option({ destination: 'Faro', tier: 'stretch', costs: { ...option().costs, accommodation: { per_person: 0, details: '', example: '' } } }),
  ], 7);
  assert.deepEqual(gaps.map(g => [g.destination, g.missing]), [['Porto', ['transport']], ['Faro', ['lodging']]]);
  const note = awayCorrection(gaps, 7);
  assert.match(note, /Porto \(saver\): costs\.flights\.per_person was 0/);
  assert.match(note, /Faro \(stretch\): costs\.accommodation\.per_person was 0 for 7 nights/);
  assert.deepEqual(awayGaps([option({ costs: { ...option().costs, accommodation: { per_person: 0, details: '', example: '' } } })], 0), [],
    'a day trip has no night to sleep');
});

test('the card estimate says what it does not know rather than reading as everything', () => {
  const est = awayEstimate(option({ costs: { ...option().costs, flights: { per_person: 0, details: '' } } }), { nights: 7 });
  assert.equal(est.estimate, true);
  assert.equal(est.transport.per_person, null, 'not 0 — nobody estimated it');
  assert.deepEqual(est.unpriced, ['transport']);
  assert.equal(est.lodging?.nights, 7);
  assert.equal(est.lodging?.per_night, 100);
  assert.equal(est.lodging?.stay, 'mid');
});

test('somebody driving pays the trip without the flight', () => {
  const est = awayEstimate(option(), { nights: 7 });
  assert.equal(est.per_person, 2000);
  assert.equal(est.per_person_if_driving, 1300);
});

test('a town with no airport of its own: the nearest one and a rental car from it', () => {
  const gateway = { iata: 'GJT', name: 'Grand Junction Regional', miles: 97 };
  const est = awayEstimate(option({ destination: 'Moab', city: 'Moab' }), { nights: 4, gateway });
  assert.equal(est.transport.kind, 'flight_and_car');
  assert.equal(est.car?.from.iata, 'GJT');
  const lines = awayLines(est, { town: 'Moab', start: '2026-11-02', end: '2026-11-06', party: 3, solo: false });
  const car = lines.find(l => l.type === 'transport');
  assert.ok(car, 'the car is a line');
  assert.equal(car!.venue_website, 'https://www.kayak.com/cars/GJT/2026-11-02/2026-11-06');
  assert.equal(car!.booking_mode, 'ahead', 'Reach books no cars');
  assert.match(lines.find(l => l.type === 'flight')!.title, /GJT/);
});

test('the itinerary always opens with a flight and a bed for every night, even unpriced', () => {
  const bare = option({ costs: { flights: { per_person: 0, details: '' }, accommodation: { per_person: 0, details: '', example: '' } } });
  const lines = awayLines(awayEstimate(bare, { nights: 5 }), { town: 'Lisbon', start: '2026-11-02', end: '2026-11-07', party: 2, solo: false });
  const flight = lines.find(l => l.type === 'flight');
  const bed = lines.find(l => l.type === 'hotel');
  assert.ok(flight && bed, 'neither is dropped for having no price');
  assert.equal(flight!.cost_cents, null);
  assert.match(flight!.subtitle, /Not estimated yet/);
  assert.equal(bed!.nights, 5);
  assert.equal(bed!.checkin, '2026-11-02');
  assert.equal(bed!.checkout, '2026-11-07', 'check-out the last day: every night covered');
  assert.match(bed!.title, /5 nights/);
  assert.ok(lines.every(l => l.estimate === true && l.scheduled_time === 'Before you go'));
});

test('a priced line is labelled an estimate, and no stay is named as a booked hotel', () => {
  const lines = awayLines(awayEstimate(option(), { nights: 7 }), { town: 'Lisbon', start: '2026-11-02', end: '2026-11-09', party: 2, solo: false });
  for (const l of lines) assert.match(l.subtitle, /Estimate/);
  const bed = lines.find(l => l.type === 'hotel')!;
  assert.equal(bed.title, 'Somewhere to stay · 7 nights');
  assert.match(bed.subtitle, /around Alfama/);
  assert.equal(bed.cost_cents, 70000);
});

test('a driver comes off the flight; the flight stays on the plan', () => {
  const est = awayEstimate(option(), { nights: 3 });
  const lines = awayLines(est, { town: 'Lisbon', party: 4, driving: 1, solo: false });
  const flight = lines.find(l => l.type === 'flight')!;
  assert.equal(flight.flying, 3);
  assert.equal(flight.driving, 1);
  assert.match(flight.subtitle, /3 flying, 1 driving/);
  assert.equal(flight.party_cents, 70000 * 3, 'the party pays three flights, not four');
  const row = rowOf(flight) as Record<string, unknown>;
  assert.equal(row.flying, 3, 'who is flying reaches the client row');
  assert.equal(row.driving, 1);
  assert.equal(row.party_cents, 210000);
});

test('nobody flying: the line says so and is no flight anybody is charged or quoted for', () => {
  const est = awayEstimate(option(), { nights: 3 });
  const all = awayLines(est, { town: 'Lisbon', party: 2, driving: 2, solo: false });
  assert.equal(all.filter(l => l.type === 'flight').length, 0, "type 'flight' is what the bookable route quotes");
  const said = all.find(l => /driving/.test(l.title))!;
  assert.ok(said, 'the line is there to say so');
  assert.match(said.title, /Everyone is driving/);
  assert.equal(said.cost_cents, 0);
  assert.equal(said.booking_mode, null, 'nothing to book: not counted as a step');
  assert.equal(said.payment_note, null, 'never "Booked through Reach"');
  const solo = awayLines(est, { town: 'Lisbon', party: 1, driving: 1, solo: true });
  const mine = solo.find(l => /driving/.test(l.title))!;
  assert.match(mine.title, /^You're driving/);
  for (const l of solo) assert.doesNotMatch(`${l.title} ${l.subtitle} ${l.payment_note ?? ''}`, /everyone|group/i, 'one person, spoken to as one');
});

test('a car or transfers Reach never prices does not promise a live price at Lock it in', () => {
  const gateway = { iata: 'GJT', name: 'Grand Junction Regional', miles: 97 };
  for (const ground of [100, 0]) {
    const est = awayEstimate(option({ costs: { ...option().costs, ground_transport: { per_person: ground, details: '' } } }), { nights: 4, gateway });
    const car = awayLines(est, { town: 'Moab', start: '2026-11-02', end: '2026-11-06', party: 2, solo: false }).find(l => l.type === 'transport')!;
    assert.doesNotMatch(car.subtitle, /Lock it in/, `the car at ${ground}`);
    assert.match(car.subtitle, ground ? /Estimate/ : /Not estimated/);
  }
  const transfers = awayLines(awayEstimate(option(), { nights: 4 }), { town: 'Lisbon', party: 2, solo: false }).find(l => l.title === 'Airport transfers')!;
  assert.ok(transfers);
  assert.doesNotMatch(transfers.subtitle, /Lock it in/);
  assert.match(transfers.subtitle, /Estimate/);
});

test('somewhere a drive away gets the road, not a flight', () => {
  // New York to Philadelphia, a day trip: away by distance, never by air.
  const day = option({ destination: 'Philadelphia', city: 'Philadelphia', total_per_person: 300,
    costs: { flights: { per_person: 0, details: '' }, ground_transport: { per_person: 60, details: 'Amtrak round trip' }, food_drink: { per_person: 120, details: '' } } });
  const est = awayEstimate(day, { nights: 0, km: 130 });
  assert.equal(est.transport.kind, 'ground');
  assert.equal(est.transport.per_person, 60);
  assert.deepEqual(est.unpriced, [], 'a drive priced by road is not a gap');
  const lines = awayLines(est, { town: 'Philadelphia', start: '2026-11-02', end: '2026-11-02', party: 2, solo: false });
  assert.equal(lines.filter(l => l.type === 'flight').length, 0, 'no flight Reach would go and quote');
  const there = lines.find(l => l.type === 'transport')!;
  assert.equal(there.title, 'Getting there and back');
  assert.equal(there.booking_mode, 'ahead');
  assert.doesNotMatch(there.subtitle, /Lock it in/);
  assert.equal(lines.length, 1, 'no transfers line doubling the same money');
  // A flight the model priced for a drive is off the plan and off the figure.
  const flown = awayEstimate(option({ total_per_person: 1000, costs: { ...option().costs, flights: { per_person: 200, details: '' } } }), { nights: 2, km: 150 });
  assert.equal(flown.transport.kind, 'ground');
  assert.equal(flown.per_person, 800);
  // Unknown distance is never "near".
  assert.equal(awayEstimate(option(), { nights: 2, km: null }).transport.kind, 'flight');
  assert.equal(awayEstimate(option(), { nights: 2, km: 5000 }).transport.kind, 'flight');
});

test('an option that rightly priced the drive is not sent back for a flight', () => {
  const drive = option({ destination: 'Asheville', costs: { ...option().costs, flights: { per_person: 0, details: '' }, ground_transport: { per_person: 80, details: 'Drive' } } });
  assert.deepEqual(awayGaps([drive], 2, () => true), []);
  const nothing = option({ destination: 'Asheville', tier: 'saver', costs: { ...option().costs, flights: { per_person: 0, details: '' }, ground_transport: { per_person: 0, details: '' } } });
  const gaps = awayGaps([nothing], 2, () => true);
  assert.deepEqual(gaps.map(g => g.missing), [['transport']]);
  assert.match(awayCorrection(gaps, 2), /drive away and costs\.ground_transport\.per_person was 0/);
  assert.deepEqual(awayGaps([drive], 2).map(g => g.missing), [['transport']], 'far, or not measured: the flight is still owed');
  const block = awayPromptBlock({ nights: 2, from: 'Raleigh (RDU)' });
  assert.match(block, /drive or take the train/);
  assert.doesNotMatch(block, /round trip from Raleigh \(RDU\) for one person\. Never 0\./, 'never 0 only for somewhere you fly to');
});

test('alone, the lines speak to one person', () => {
  const lines = awayLines(awayEstimate(option(), { nights: 3 }), { town: 'Lisbon', party: 1, solo: true });
  for (const l of lines) assert.doesNotMatch(`${l.subtitle} ${l.payment_note ?? ''}`, /group|everyone|each of you/i);
});

test('the rows are the shape the client saves', () => {
  const [flight] = awayLines(awayEstimate(option(), { nights: 3 }), { town: 'Lisbon', party: 2, solo: false });
  const row = rowOf(flight);
  assert.equal(row.time, 'Before you go');
  assert.equal(row.type, 'flight');
  assert.equal(row.sub, flight.subtitle);
});

test('live flights are ranked by the tier: a stretch is not shown the cheapest red-eye first', () => {
  const offers = [
    { key: 'a', priceCents: 30000, out: { departs: '2026-11-02T05:50:00', stops: 1 }, back: { departs: '2026-11-09T22:10:00', stops: 1 } },
    { key: 'b', priceCents: 52000, out: { departs: '2026-11-02T10:15:00', stops: 0 }, back: { departs: '2026-11-09T14:00:00', stops: 0 } },
    { key: 'c', priceCents: 41000, out: { departs: '2026-11-02T09:00:00', stops: 1 }, back: { departs: '2026-11-09T12:30:00', stops: 1 } },
  ];
  assert.deepEqual(flightsForTier(offers, 'saver').map(o => o.key), ['a', 'c', 'b']);
  assert.deepEqual(flightsForTier(offers, 'on_budget').map(o => o.key), ['b', 'c', 'a'], 'daytime, one stop at most: fewest stops first');
  assert.deepEqual(flightsForTier(offers, 'stretch').map(o => o.key), ['b', 'c', 'a']);
  assert.equal(flightFits(offers[0], 'on_budget'), false, 'a 5:50am departure is not daytime');
  assert.equal(flightsForTier(offers, 'stretch')[0].fitsTier, true);
});

test('live hotels are ranked by the class of stay', () => {
  const hotels = [
    { key: 'h1', priceCents: 40000, stars: 2 },
    { key: 'h2', priceCents: 90000, stars: 4 },
    { key: 'h3', priceCents: 60000, stars: 3 },
    { key: 'h4', priceCents: 55000 },
  ];
  assert.deepEqual(hotelsForTier(hotels, 'saver').map(h => h.key), ['h1', 'h4', 'h3']);
  assert.deepEqual(hotelsForTier(hotels, 'on_budget').map(h => h.key), ['h3', 'h2', 'h1'], 'an unrated hotel does not pass for three stars');
  assert.deepEqual(hotelsForTier(hotels, 'stretch').map(h => h.key)[0], 'h2');
});

test('the estimate the route attaches is part of the written-down shape of an idea', () => {
  const est = awayEstimate(option(), { nights: 7 });
  assert.ok(TripAttachments.shape.away.safeParse(est).success);
  assert.ok(TripAttachments.shape.away.safeParse(null).success, 'null on a night out');
});

test('the options route asks for both lines, retries a gap, and attaches the estimate', () => {
  const src = readFileSync(new URL('../../app/api/trips/generate/route.ts', import.meta.url), 'utf8');
  assert.match(src, /\$\{nights >= 1 \? awayPromptBlock\(/, 'the away block is in the options prompt');
  assert.match(src, /const gaps = awayGaps\(trips, nights, await nearOnes\(trips\)\);/, 'a flight left at 0 for a drive is not a gap');
  assert.match(src, /awayEstimate\(trip, \{ nights: Math\.max\(0, nights\), gateway: landed\?\.gateway \?\? null, km \}\)/, 'the card knows how far it is');
  assert.match(src, /awayEstimate\(\{ \.\.\.tripSource, costs: costs \?\? \{\} \}, \{ nights: Math\.max\(0, nights\), gateway, km \}\)/, 'and so do the days');
  assert.match(src, /awayCorrection\(gaps, nights\)/, 'the retry names what was missing');
  assert.match(src, /\.away = isAway === true\s*\? awayEstimate\(trip,/);
  // The days come back with their lines, built on the server.
  assert.match(src, /const awayPart = await awayForDays\(\);/);
  assert.match(src, /\.\.\.awayPart,/);
});
