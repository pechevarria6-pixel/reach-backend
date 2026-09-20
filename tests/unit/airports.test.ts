import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airportForCity, townOf, departureFrom, airportMismatch } from '../../lib/airports.ts';

test('a city field holds the state too, and the lookup has to cope', () => {
  // The table was keyed on "Pittsburgh" while profiles store "Pittsburgh,
  // Pennsylvania" — the way the field asks for it — so the derivation never
  // once fired for anybody who filled it in properly.
  assert.equal(townOf('Pittsburgh, Pennsylvania'), 'pittsburgh');
  assert.equal(airportForCity('Pittsburgh, Pennsylvania'), 'PIT');
  assert.equal(airportForCity('raleigh'), 'RDU');
  assert.equal(airportForCity('Aberdeen, Scotland'), null, 'not a guess — we do not know it');
  assert.equal(airportForCity(''), null);
  assert.equal(airportForCity(null), null);
});

test('the airport follows the city when nobody has chosen one', () => {
  const d = departureFrom('Pittsburgh, Pennsylvania', null, null);
  assert.equal(d.airport, 'PIT');
  assert.equal(d.derived, true, 'worked out, not chosen — the screen can say so');
});

test('a chosen airport is not recomputed away', () => {
  // Somebody who sets this is correcting us, and a correction that GPS or a
  // lookup table quietly overrides on the next load is not a correction.
  const d = departureFrom('Oakland, California', 'SFO', null);
  assert.equal(d.airport, 'SFO');
  assert.equal(d.derived, false);
});

test('a real contradiction is reported, never resolved on somebody’s behalf', () => {
  // The actual row that started this.
  const m = airportMismatch('Pittsburgh, Pennsylvania', 'RDU');
  assert.deepEqual(m, { city: 'Pittsburgh', saved: 'RDU', expected: 'PIT' });
});

test('agreement, absence and towns we do not know are not contradictions', () => {
  assert.equal(airportMismatch('Pittsburgh, Pennsylvania', 'PIT'), null);
  assert.equal(airportMismatch('Pittsburgh, Pennsylvania', null), null);
  assert.equal(airportMismatch(null, 'RDU'), null);
  // We have no airport for Aberdeen, so we have no grounds to call RDU wrong.
  assert.equal(airportMismatch('Aberdeen, Scotland', 'RDU'), null);
});

test('case and spacing do not make two cities different', () => {
  assert.equal(airportForCity('  SALT LAKE CITY, Utah '), 'SLC');
  assert.equal(departureFrom('raleigh', 'rdu', null).airport, 'RDU');
});

test('with no home city, what was detected is used and is not overridden', () => {
  const d = departureFrom(null, null, { city: 'Raleigh', formatted: 'Raleigh, NC', airport: 'RDU' });
  assert.equal(d.city, 'Raleigh, NC');
  assert.equal(d.airport, 'RDU');
});
