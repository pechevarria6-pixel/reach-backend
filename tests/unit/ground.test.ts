import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carRentalUrl, rentalLine } from '../../lib/ground.ts';

test('the verified Kayak shape, at the airport and on the trip dates', () => {
  assert.equal(carRentalUrl('GJT', '2026-11-02', '2026-11-09'), 'https://www.kayak.com/cars/GJT/2026-11-02/2026-11-09');
});

test('nothing is built from a bad code or backwards dates', () => {
  assert.equal(carRentalUrl('gjt', '2026-11-02', '2026-11-09'), null);
  assert.equal(carRentalUrl('GJT', '2026-11-09', '2026-11-02'), null);
  assert.equal(carRentalUrl('GJT', 'Nov 2', '2026-11-09'), null);
});

test('the line says how far, and that the miles are straight-line', () => {
  const l = rentalLine({ iata: 'GJT', name: 'Grand Junction Regional', miles: 97 }, 'Moab', '2026-11-02', '2026-11-09');
  assert.equal(l?.booking_mode, 'ahead');
  assert.match(l?.subtitle ?? '', /about 97 miles away as the crow flies/);
});
