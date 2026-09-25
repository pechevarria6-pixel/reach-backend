import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinQuestion, pinColumns, pinPlan, pinMoves, tripsMap, columnsMissing, type MapPlan } from '../../lib/trip-map.ts';
import { locatePlanOrFail } from '../../lib/discovery/geocode.ts';

// ─── A geocoder and a database that only do what the test says ─────────

const MOAB = [{
  lat: '38.5738', lon: '-109.5462', display_name: 'Moab, Grand County, Utah, United States',
  class: 'boundary', type: 'administrative',
  address: { town: 'Moab', state: 'Utah', country: 'United States', country_code: 'us' },
}];

function geocoder(answers: Record<string, unknown[] | number>) {
  const asked: string[] = [];
  const impl = (async (url: string) => {
    const q = new URL(url).searchParams.get('q') ?? '';
    asked.push(q);
    const a = answers[q] ?? [];
    if (typeof a === 'number') return new Response('busy', { status: a });
    return new Response(JSON.stringify(a), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, asked };
}

/** Records every update and every filter on it; answers as told. */
function fakeDb(answer: { data?: unknown[] | null; error?: { code?: string; message?: string } | null } = {}) {
  const writes: { values: Record<string, unknown>; filters: [string, string, unknown][] }[] = [];
  const db = {
    from(table: string) {
      assert.equal(table, 'plans');
      return {
        update(values: Record<string, unknown>) {
          const w = { values, filters: [] as [string, string, unknown][] };
          writes.push(w);
          const chain = {
            eq(c: string, v: unknown) { w.filters.push(['eq', c, v]); return chain; },
            is(c: string, v: unknown) { w.filters.push(['is', c, v]); return chain; },
            async select() { return { data: answer.data ?? [{ id: 'p1' }], error: answer.error ?? null }; },
          };
          return chain;
        },
      };
    },
  };
  return { db: db as never, writes };
}

const trip = { id: 'p1', title: 'Moab, Utah, USA', type: 'trip', destination_city: 'Moab', destination_country: 'US', destination_style: null };

// ─── What is asked ──────────────────────────────────────────────────────

test('a group trip still deciding where to go is not put on the map', () => {
  assert.equal(pinQuestion({ id: 'p', title: 'Where next?', type: 'trip', destination_style: 'undecided' }), null);
});

test('a night out is found by its city only, never by its title', () => {
  assert.equal(pinQuestion({ id: 'p', title: 'Friday drinks', type: 'restaurant' }), null);
  assert.deepEqual(pinQuestion({ id: 'p', title: 'Friday drinks', type: 'restaurant', destination_city: 'Austin' }), { titleFallback: false });
  assert.deepEqual(pinQuestion({ id: 'p', title: 'Moab, Utah', type: 'trip' }), { titleFallback: true });
});

test('a night out with a city that is not found does not fall back to its title', async () => {
  const g = geocoder({ 'Friday drinks': MOAB });
  const r = await locatePlanOrFail({ title: 'Friday drinks', destination_city: 'Nowhereville' }, g.impl, { titleFallback: false });
  assert.equal(r, null);
  assert.deepEqual(g.asked, ['Nowhereville']);
});

test('a lookup that never got an answer is "failed", not "nowhere" — even when the title then finds nothing', async () => {
  const g = geocoder({ 'Moab, US': 503, 'Moab trip': [] });
  assert.equal(await locatePlanOrFail({ title: 'Moab trip', destination_city: 'Moab', destination_country: 'US' }, g.impl), 'failed');
});

// ─── What is stored ─────────────────────────────────────────────────────

test('a found town is stored with its state and country, guarded on the destination it was looked up for', async () => {
  const g = geocoder({ 'Moab, US': MOAB });
  const { db, writes } = fakeDb();
  const r = await pinPlan(db, trip, g.impl);
  assert.equal(r.outcome, 'stored');
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].values, { destination_lat: 38.5738, destination_lng: -109.5462, destination_label: 'Moab, Utah, United States' });
  assert.deepEqual(writes[0].filters, [['eq', 'id', 'p1'], ['eq', 'destination_city', 'Moab'], ['eq', 'title', 'Moab, Utah, USA']]);
});

test('a failed lookup stores nothing at all', async () => {
  const g = geocoder({ 'Moab, US': 503, 'Moab, Utah, USA': 503 });
  const { db, writes } = fakeDb();
  assert.equal((await pinPlan(db, trip, g.impl)).outcome, 'failed');
  assert.equal(writes.length, 0);
});

test('a place that is not a town stores nothing either', async () => {
  const canal = [{ lat: '30.1', lon: '52.2', display_name: 'Test canal', class: 'waterway', type: 'canal' }];
  const g = geocoder({ Test: canal });
  const { db, writes } = fakeDb();
  assert.equal((await pinPlan(db, { id: 'p', title: 'Test', type: 'trip' }, g.impl)).outcome, 'not_found');
  assert.equal(writes.length, 0);
});

test('a trip moved elsewhere while the geocoder answered keeps no pin for the old town', async () => {
  const g = geocoder({ 'Moab, US': MOAB });
  const { db } = fakeDb({ data: [] });
  assert.equal((await pinPlan(db, trip, g.impl)).outcome, 'moved');
});

test('a database without the columns yet is told apart from a broken write', async () => {
  const g = geocoder({ 'Moab, US': MOAB });
  const missing = fakeDb({ error: { code: 'PGRST204', message: "Could not find the 'destination_lat' column of 'plans'" } });
  assert.equal((await pinPlan(missing.db, trip, g.impl)).outcome, 'not_migrated');
  const broken = fakeDb({ error: { code: '23514', message: 'violates check constraint' } });
  assert.equal((await pinPlan(broken.db, trip, g.impl)).outcome, 'write_failed');
  assert.equal(columnsMissing({ code: '42703', message: 'column plans.destination_lat does not exist' }), true);
  assert.equal(columnsMissing({ code: '42501' }), false);
});

test('0,0 and out-of-range points are never a pin', () => {
  assert.equal(pinColumns({ lat: 0, lng: 0, name: 'x', from: 'x' }), null);
  assert.equal(pinColumns({ lat: 91, lng: 10, name: 'x', from: 'x' }), null);
  assert.equal(pinColumns({ lat: NaN, lng: 10, name: 'x', from: 'x' }), null);
  assert.deepEqual(pinColumns({ lat: 1, lng: 2, name: 'Town', from: 'x' }), { destination_lat: 1, destination_lng: 2, destination_label: 'Town' });
});

// ─── When a pin moves ───────────────────────────────────────────────────

test('a new city, a new country or a pick moves the pin; a rename of a trip with a city does not', () => {
  const before = { title: 'Moab', destination_city: 'Moab', destination_country: 'US', destination_style: null };
  assert.equal(pinMoves(before, { destination_city: 'Denver' }), true);
  assert.equal(pinMoves(before, { destination_country: 'CA' }), true);
  assert.equal(pinMoves(before, { title: 'Moab with the cousins' }), false);
  assert.equal(pinMoves(before, { destination_city: 'moab ' }), false);
  assert.equal(pinMoves({ title: 'Where next?', destination_style: 'undecided' }, { destination_style: null, destination_city: 'Lisbon' }), true);
  // Pinned from its title, so a new title is a new place.
  assert.equal(pinMoves({ title: 'Moab, Utah', destination_city: null }, { title: 'Denver, Colorado' }), true);
});

// ─── The map's two lists ────────────────────────────────────────────────

const NOW = new Date('2026-09-25T18:00:00Z');
const pinned = (over: Partial<MapPlan>): MapPlan => ({
  id: 'p', group_id: 'g1', title: 'Moab', type: 'trip', status: 'planning',
  start_date: '2026-10-10', end_date: '2026-10-12',
  destination_lat: '38.5738', destination_lng: '-109.5462', destination_label: 'Moab, Utah, United States',
  ...over,
});

test('a plan from a group I am not in never reaches my map', () => {
  const m = tripsMap([pinned({ id: 'mine' }), pinned({ id: 'theirs', group_id: 'g2' })], { myGroups: ['g1'], confirmedPlans: [], now: NOW });
  assert.deepEqual(m.upcoming.map(p => p.planId), ['mine']);
  assert.equal(m.past.length, 0);
});

test('past is over by its dates AND something was confirmed — looking at a trip is not going on it', () => {
  const plans = [
    pinned({ id: 'went', start_date: '2026-08-01', end_date: '2026-08-03' }),
    pinned({ id: 'looked', start_date: '2026-08-01', end_date: '2026-08-03' }),
  ];
  const m = tripsMap(plans, { myGroups: ['g1'], confirmedPlans: ['went'], now: NOW });
  assert.deepEqual(m.past.map(p => p.planId), ['went']);
  assert.equal(m.upcoming.length, 0);
});

test('over is judged by the day at the destination, not the UTC day', () => {
  // 03:00 UTC on the 26th is still the evening of the 25th in Los Angeles.
  const late = new Date('2026-09-26T03:00:00Z');
  const la = pinned({ id: 'la', type: 'restaurant', start_date: '2026-09-25', end_date: null, destination_lat: 34.05, destination_lng: -118.24 });
  const m = tripsMap([la], { myGroups: ['g1'], confirmedPlans: ['la'], now: late });
  assert.deepEqual(m.upcoming.map(p => p.planId), ['la']);
  assert.equal(m.past.length, 0);
});

test('a called-off plan, a plan with no point and a missing coordinate are not pins', () => {
  const plans = [
    pinned({ id: 'off', status: 'cancelled' }),
    pinned({ id: 'nowhere', destination_lat: null, destination_lng: null }),
    pinned({ id: 'half', destination_lng: '' }),
    pinned({ id: 'unnamed', destination_label: '' }),
  ];
  const m = tripsMap(plans, { myGroups: ['g1'], confirmedPlans: ['off'], now: NOW });
  assert.equal(m.upcoming.length + m.past.length, 0);
});

test('a pin says what the client draws: id, label, point, dates and the kind of plan', () => {
  const m = tripsMap([pinned({ id: 'x', type: 'concert' })], { myGroups: ['g1'], confirmedPlans: [], now: NOW });
  assert.deepEqual(m.upcoming[0], {
    planId: 'x', label: 'Moab, Utah, United States', lat: 38.5738, lng: -109.5462,
    dates: { start: '2026-10-10', end: '2026-10-12' }, emoji: '🎵',
  });
});

test('upcoming soonest first, past most recent first, undated plans still coming', () => {
  const plans = [
    pinned({ id: 'later', start_date: '2026-12-01', end_date: '2026-12-02' }),
    pinned({ id: 'soon', start_date: '2026-10-01', end_date: '2026-10-02' }),
    pinned({ id: 'undated', start_date: null, end_date: null }),
    pinned({ id: 'old', start_date: '2025-06-01', end_date: '2025-06-02' }),
    pinned({ id: 'recent', start_date: '2026-09-01', end_date: '2026-09-02' }),
  ];
  const m = tripsMap(plans, { myGroups: ['g1'], confirmedPlans: ['old', 'recent'], now: NOW });
  assert.deepEqual(m.upcoming.map(p => p.planId), ['soon', 'later', 'undated']);
  assert.deepEqual(m.past.map(p => p.planId), ['recent', 'old']);
});

test('a borough is labelled by its own name, not the city around it', async () => {
  // Nominatim, live, 2026-09-25: Brooklyn is a boundary whose address.city
  // is New York. Reading city first gave a Brooklyn trip Manhattan's label.
  const BROOKLYN = [{
    lat: '40.6526', lon: '-73.9497', name: 'Brooklyn',
    display_name: 'Brooklyn, Kings County, New York, United States',
    class: 'boundary', type: 'administrative',
    address: { suburb: 'Brooklyn', city: 'New York', state: 'New York', country: 'United States', country_code: 'us' },
  }];
  const { impl } = geocoder({ 'Brooklyn, US': BROOKLYN });
  const found = await locatePlanOrFail({ destination_city: 'Brooklyn', destination_country: 'US' }, impl);
  assert.ok(found && found !== 'failed');
  assert.equal(found.label, 'Brooklyn, New York, United States');
  // And without `name`, the display name's first part is the place, still.
  const { impl: bare } = geocoder({ 'Brooklyn, US': [{ ...BROOKLYN[0], name: undefined }] });
  const again = await locatePlanOrFail({ destination_city: 'Brooklyn', destination_country: 'US' }, bare);
  assert.ok(again && again !== 'failed');
  assert.equal(again.label, 'Brooklyn, New York, United States');
});
