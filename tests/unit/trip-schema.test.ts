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
const validDay = {
  day: 1, title: 'Arrival', morning: 'Walk the old town', afternoon: 'Museum',
  evening: 'Dinner at Casa Luis', cost_today: 85, insider_tip: 'Go before noon',
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

test('well-formed JSON of the wrong shape returns null', () => {
  // This is the case a bare JSON.parse would wave through, handing the UI an
  // object with no itinerary and no error.
  assert.equal(parseModelJSON('{"itinerary":[{"day":"one"}]}', ItinerarySchema, 'test'), null);
  assert.equal(parseModelJSON('{"trips":[]}', ItinerarySchema, 'test'), null);
});
