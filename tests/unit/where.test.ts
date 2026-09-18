// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coord, whereFrom } from '../../lib/discovery/where.ts';

const params = (q: string) => new URLSearchParams(q);

test('a missing parameter is missing, not zero', () => {
  // The whole bug: Number(null) === 0, and 0 passed a finite check.
  assert.equal(coord(null), null);
  assert.equal(coord(''), null);
  assert.equal(coord('   '), null);
  assert.equal(coord('nonsense'), null);
});

test('no coordinates means no location', () => {
  assert.equal(whereFrom(params('')), null);
  assert.equal(whereFrom(params('city=Aberdeen')), null, 'a city name is not a coordinate');
  assert.equal(whereFrom(params('lat=35.17')), null, 'half a position is not a position');
});

test('Null Island is not where anybody is', () => {
  assert.equal(whereFrom(params('lat=0&lng=0')), null);
  assert.equal(whereFrom(params('lat=0.001&lng=-0.002')), null);
});

test('a real place comes back intact', () => {
  assert.deepEqual(whereFrom(params('lat=35.17&lng=-79.39')), { lat: 35.17, lng: -79.39 });
  // Zero is legitimate in one axis: the equator and the meridian are real.
  assert.deepEqual(whereFrom(params('lat=0&lng=-79.39')), { lat: 0, lng: -79.39 });
});

test('impossible coordinates are refused', () => {
  assert.equal(whereFrom(params('lat=91&lng=0.5')), null);
  assert.equal(whereFrom(params('lat=35&lng=181')), null);
});
