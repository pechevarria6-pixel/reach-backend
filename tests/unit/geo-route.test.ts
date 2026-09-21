import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whereFrom } from '../../lib/discovery/where.ts';

// The routing decision in /api/geo, isolated. A search request carries only
// `q`; a reverse lookup carries a point. Getting that backwards sent every
// search to Null Island and returned nothing, always.

const asks = (qs: string) => whereFrom(new URLSearchParams(qs));

test('a search request is not mistaken for a point', () => {
  // This is the whole bug. `Number(null)` is 0 and `Number.isFinite(0)` is
  // true, so reading lat/lng with Number() made every q-only request look
  // like a reverse lookup at 0,0 — a spot in the Gulf of Guinea.
  assert.equal(asks('q=Raleigh&limit=6'), null);
  assert.equal(asks('q=Raleigh%2C%20North%20Carolina'), null);
  assert.equal(asks('limit=1&q=Moab'), null);
});

test('a real point is read as one', () => {
  assert.deepEqual(asks('lat=35.7804&lng=-78.6391'), { lat: 35.7804, lng: -78.6391 });
});

test('half a point is no point', () => {
  // A dropped parameter must not become a coordinate of zero.
  assert.equal(asks('lat=35.7804'), null);
  assert.equal(asks('lng=-78.6391'), null);
  assert.equal(asks('lat=&lng='), null);
  assert.equal(asks('lat=abc&lng=def'), null);
});

test('Null Island is refused even when asked for explicitly', () => {
  assert.equal(asks('lat=0&lng=0'), null);
});
