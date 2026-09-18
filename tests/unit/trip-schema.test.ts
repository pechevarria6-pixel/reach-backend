// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TripsSchema, ItinerarySchema, TRIPS_JSON_SCHEMA, ITINERARY_JSON_SCHEMA,
  parseModelJSON,
} from '../../lib/trip-schema.ts';

// The JSON Schema constrains what the model generates; the zod schema
// validates what comes back. They are written by hand, so the real risk is
// that one gains a field and the other doesn't — every trip then fails
// validation and the whole feature returns 502.
function jsonSchemaKeys(node: any): string[] {
  return Object.keys(node.properties ?? {}).sort();
}

test('trip JSON Schema and zod schema describe the same fields', () => {
  const item = (TRIPS_JSON_SCHEMA as any).properties.trips.items;
  const zodKeys = Object.keys((TripsSchema.shape.trips.element as any).shape).sort();
  assert.deepEqual(jsonSchemaKeys(item), zodKeys);
});

test('every trip field is required in the JSON Schema', () => {
  // zod treats all of these as required, so an optional field on the wire
  // would validate as missing and fail.
  const item = (TRIPS_JSON_SCHEMA as any).properties.trips.items;
  assert.deepEqual([...item.required].sort(), jsonSchemaKeys(item));
});

test('cost breakdown fields agree, including accommodation.example', () => {
  const costs = (TRIPS_JSON_SCHEMA as any).properties.trips.items.properties.costs;
  const zodCosts = Object.keys((TripsSchema.shape.trips.element as any).shape.costs.shape).sort();
  assert.deepEqual(jsonSchemaKeys(costs), zodCosts);
  // The card renders the example hotel or area, not the details line.
  assert.ok(costs.properties.accommodation.properties.example, 'accommodation.example must exist');
});

test('itinerary JSON Schema and zod schema agree', () => {
  const item = (ITINERARY_JSON_SCHEMA as any).properties.itinerary.items;
  const zodKeys = Object.keys((ItinerarySchema.shape.itinerary.element as any).shape).sort();
  assert.deepEqual(jsonSchemaKeys(item), zodKeys);
  assert.deepEqual([...item.required].sort(), zodKeys);
});

test('price diversity is enforced by the schema, not just the prompt', () => {
  const item = (TRIPS_JSON_SCHEMA as any).properties.trips.items;
  assert.deepEqual(item.properties.tier.enum, ['saver', 'on_budget', 'stretch']);
});

test('the trips array carries no minItems, which the API rejects', () => {
  // "For 'array' type, 'minItems' values other than 0 or 1 are not supported"
  // — a 400 on every request, which took trip generation down completely.
  const trips = (TRIPS_JSON_SCHEMA as any).properties.trips;
  assert.equal(trips.minItems, undefined);
  assert.equal(trips.maxItems, undefined);
});

test('no array anywhere in either schema sets an unsupported minItems', () => {
  const walk = (node: any, path: string): string[] => {
    if (!node || typeof node !== 'object') return [];
    const bad: string[] = [];
    if (node.type === 'array' && node.minItems != null && node.minItems > 1) {
      bad.push(`${path}.minItems=${node.minItems}`);
    }
    for (const [k, v] of Object.entries(node)) bad.push(...walk(v, `${path}.${k}`));
    return bad;
  };
  assert.deepEqual(walk(TRIPS_JSON_SCHEMA, 'trips'), []);
  assert.deepEqual(walk(ITINERARY_JSON_SCHEMA, 'itinerary'), []);
});

// ── parseModelJSON: the guard every model response goes through ───────────
// Every event carries its own cost now, so the budget screen can itemise.
const slot = (plan: string, booking = 'walk_in', payment = 'Cards accepted', cost = 20) =>
  ({ plan, cost, booking, payment });

const validDay = {
  day: 1, title: 'Arrival',
  morning: slot('Walk the old town'),
  afternoon: slot('Museum', 'ahead', 'Cards only, book a timed entry'),
  evening: slot('Dinner at Casa Luis', 'reach', 'Cash only'),
  cost_today: 85, insider_tip: 'Go before noon',
};

test('valid output parses and validates', () => {
  const out = parseModelJSON(JSON.stringify({ itinerary: [validDay] }), ItinerarySchema, 'test');
  assert.equal(out?.itinerary.length, 1);
  assert.equal(out?.itinerary[0].title, 'Arrival');
});

test('malformed JSON returns null rather than throwing', () => {
  assert.equal(parseModelJSON('{"itinerary": [', ItinerarySchema, 'test'), null);
  assert.equal(parseModelJSON('', ItinerarySchema, 'test'), null);
  assert.equal(parseModelJSON('Here is your trip!', ItinerarySchema, 'test'), null);
});

test('every slot carries how you get in and what they take', () => {
  // Reach books what it can; for everything else the traveller has to be told
  // before they arrive, not at the door.
  const out = parseModelJSON(JSON.stringify({ itinerary: [validDay] }), ItinerarySchema, 'test');
  const day = out!.itinerary[0];
  assert.equal(day.evening.booking, 'reach');
  assert.equal(day.evening.payment, 'Cash only');
  assert.equal(day.afternoon.booking, 'ahead');
});

test('a slot without a cost is rejected — the budget screen itemises every event', () => {
  const bad = { ...validDay, evening: { plan: 'Dinner', booking: 'reach', payment: 'Cash only' } };
  assert.equal(parseModelJSON(JSON.stringify({ itinerary: [bad] }), ItinerarySchema, 'test'), null);
});

test('a free event costs zero, which is not the same as unknown', () => {
  const free = { ...validDay, morning: slot('Walk the old town', 'walk_in', 'Free', 0) };
  const out = parseModelJSON(JSON.stringify({ itinerary: [free] }), ItinerarySchema, 'test');
  assert.equal(out?.itinerary[0].morning.cost, 0);
});

test('a slot missing its payment note is rejected, not quietly dropped', () => {
  const bad = { ...validDay, morning: { plan: 'Walk', cost: 0, booking: 'walk_in' } };
  assert.equal(parseModelJSON(JSON.stringify({ itinerary: [bad] }), ItinerarySchema, 'test'), null);
});

test('booking mode is constrained to the three real cases', () => {
  const bad = { ...validDay, morning: slot('Walk', 'maybe') };
  assert.equal(parseModelJSON(JSON.stringify({ itinerary: [bad] }), ItinerarySchema, 'test'), null);
});

test('well-formed JSON of the wrong shape returns null', () => {
  // This is the case a bare JSON.parse would wave through, handing the UI an
  // object with no itinerary and no error.
  assert.equal(parseModelJSON('{"itinerary":[{"day":"one"}]}', ItinerarySchema, 'test'), null);
  assert.equal(parseModelJSON('{"trips":[]}', ItinerarySchema, 'test'), null);
});

// ── normalizeTrips: what a live generation actually returned ──────────────
import { normalizeTrips, reconcileCosts } from '../../lib/trip-schema.ts';

const costs = (f: number, a: number, g: number, fd: number, ac: number, m: number) => ({
  flights: { per_person: f, details: '' },
  accommodation: { per_person: a, details: '', example: '' },
  ground_transport: { per_person: g, details: '' },
  food_drink: { per_person: fd, details: '' },
  activities: { per_person: ac, details: '' },
  misc: { per_person: m, details: '' },
});

test('cost lines are scaled to match the headline total', () => {
  // The real case: $2,380 headline, parts adding to $1,800.
  const trip = { destination: 'Algarve', tier: 'saver', total_per_person: 2380,
                 costs: costs(500, 600, 200, 300, 150, 50) };
  const out = reconcileCosts(trip);
  const sum = Object.values(out.costs).reduce((a, c) => a + c.per_person, 0);
  assert.equal(sum, 2380, 'the breakdown must add up to what the card shows');
});

test('reconciling never invents a negative line', () => {
  const trip = { destination: 'X', tier: 'saver', total_per_person: 10,
                 costs: costs(500, 600, 200, 300, 150, 50) };
  const out = reconcileCosts(trip);
  for (const [k, c] of Object.entries(out.costs)) {
    assert.ok(c.per_person >= 0, `${k} went negative`);
  }
});

test('a trip whose parts already sum correctly is left alone', () => {
  const trip = { destination: 'Y', tier: 'saver', total_per_person: 1800,
                 costs: costs(500, 600, 200, 300, 150, 50) };
  assert.deepEqual(reconcileCosts(trip), trip);
});

test('a repeated destination is dropped, whatever its id', () => {
  const mk = (destination: string, tier: string) =>
    ({ destination, tier, total_per_person: 1800, costs: costs(500, 600, 200, 300, 150, 50) });
  const out = normalizeTrips([mk('Algarve', 'saver'), mk('Corsica', 'on_budget'),
                              mk('Croatian Coast', 'stretch'), mk('croatian coast', 'stretch')]);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map(t => t.destination), ['Algarve', 'Corsica', 'Croatian Coast']);
});

test('trimming to three keeps one of each tier', () => {
  const mk = (destination: string, tier: string) =>
    ({ destination, tier, total_per_person: 1800, costs: costs(500, 600, 200, 300, 150, 50) });
  const out = normalizeTrips([mk('A', 'saver'), mk('B', 'saver'), mk('C', 'saver'),
                              mk('D', 'on_budget'), mk('E', 'stretch')]);
  assert.deepEqual([...out.map(t => t.tier)].sort(), ['on_budget', 'saver', 'stretch']);
});

test('fewer than three is passed through rather than padded', () => {
  const mk = (destination: string, tier: string) =>
    ({ destination, tier, total_per_person: 1800, costs: costs(500, 600, 200, 300, 150, 50) });
  assert.equal(normalizeTrips([mk('A', 'saver'), mk('B', 'stretch')]).length, 2);
});

// ── Filler ────────────────────────────────────────────────────────────────
import { isFiller, dropFillerDays } from '../../lib/trip-schema.ts';

test('the filler a model writes to satisfy a required field is caught', () => {
  // "placeholder" reached a live itinerary on Day 5 of a real trip.
  for (const v of ['placeholder', 'TBD', 'n/a', 'N/A', 'Activity', 'Free time', '', '   ', '-', 'Lunch'])
    assert.equal(isFiller(v), true, `${JSON.stringify(v)} should be filler`);
});

test('a real plan is never mistaken for filler', () => {
  for (const v of ['Dinner at the bar at Coyaba Restaurant', 'Snorkel off Grace Bay Beach',
                   'Walk Chalk Sound National Park', 'Pastéis de Belém'])
    assert.equal(isFiller(v), false, `${JSON.stringify(v)} is a real plan`);
});

test('a day containing filler is dropped, not saved as a hole', () => {
  const real = (n: number) => ({ day: n, morning: { plan: 'Walk the old town' },
    afternoon: { plan: 'Museu Calouste Gulbenkian' }, evening: { plan: 'Dinner at Ramiro' } });
  const holed = { day: 5, morning: { plan: 'Grand Turk day trip' },
    afternoon: { plan: 'placeholder' }, evening: { plan: 'placeholder' } };
  const out = dropFillerDays([real(1), holed, real(2)]);
  assert.equal(out.length, 2);
  assert.ok(!out.some(d => d.day === 5));
});

test('dropFillerDays copes with the older flat shape', () => {
  const out = dropFillerDays([
    { day: 1, morning: 'Walk the old town', afternoon: 'Museum visit', evening: 'Dinner at Ramiro' },
    { day: 2, morning: 'placeholder', afternoon: 'Museum', evening: 'Dinner' },
  ] as any);
  assert.equal(out.length, 1);
});

test('when the group has chosen the place, three options there all survive', () => {
  // Deduping on destination is right when the model repeats itself and wrong
  // when all three are meant to be the same town at three budgets — it threw
  // two away and showed somebody a single "choice".
  const atOnePlace = [
    { id: '1', destination: 'Breckenridge, USA', tier: 'saver', total_per_person: 1300, costs: {} },
    { id: '2', destination: 'Breckenridge, USA', tier: 'on_budget', total_per_person: 2000, costs: {} },
    { id: '3', destination: 'Breckenridge, USA', tier: 'stretch', total_per_person: 2600, costs: {} },
  ];
  assert.equal(normalizeTrips(atOnePlace, true).length, 3);
  // And the old behaviour is untouched when the destination is the choice.
  assert.equal(normalizeTrips(atOnePlace).length, 1);
});
