// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { away, farEnough, nightsBetween, pointOf, AWAY_KM } from '../../lib/away.ts';

const DC = { lat: 38.9072, lng: -77.0369 };
const BALTIMORE = { lat: 39.2904, lng: -76.6122 };   // ~56 km
const RICHMOND = { lat: 37.5407, lng: -77.436 };     // ~155 km
const ARLINGTON = { lat: 38.8816, lng: -77.091 };    // across the river

test('a night out is never away, however far and however long', () => {
  const r = away({ mode: 'night', startDate: '2026-10-03', endDate: '2026-10-05', home: DC, destination: RICHMOND });
  assert.equal(r.away, false);
  assert.equal(r.reason, 'night_out');
});

test('one night or more is away, even across the river', () => {
  const r = away({ mode: 'trip', startDate: '2026-10-03', endDate: '2026-10-04', home: DC, destination: ARLINGTON });
  assert.equal(r.away, true);
  assert.equal(r.reason, 'overnight');
  assert.equal(r.nights, 1);
});

test('80 km or more is away, even for a day', () => {
  const r = away({ mode: 'trip', startDate: '2026-10-03', endDate: '2026-10-03', home: DC, destination: RICHMOND });
  assert.equal(r.away, true);
  assert.equal(r.reason, 'distance');
  assert.ok((r.km as number) > 140 && (r.km as number) < 170, String(r.km));
});

test('a day trip under 80 km is local', () => {
  const r = away({ mode: 'trip', startDate: '2026-10-03', endDate: '2026-10-03', home: DC, destination: BALTIMORE });
  assert.equal(r.away, false);
  assert.equal(r.reason, 'local');
  assert.ok((r.km as number) < AWAY_KM);
});

test('the threshold is inclusive: 80 km itself is away', () => {
  assert.equal(farEnough(80), true);
  assert.equal(farEnough(79.99), false);
  assert.equal(farEnough(NaN), false);
  // And away() asks the same question: about 81 km and about 79 km due north.
  const home = { lat: 10, lng: 20 };
  const north = (km: number) => ({ lat: 10 + km / 111.195, lng: 20 });
  const day = { startDate: '2026-10-03', endDate: '2026-10-03', home };
  assert.equal(away({ ...day, destination: north(80.5) }).away, true);
  assert.equal(away({ ...day, destination: north(79.5) }).away, false);
});

test('with no nights and no distance we can measure, the answer is unknown, not local', () => {
  // "Local" would drop the flight and the hotel on a guess.
  assert.equal(away({ startDate: '2026-10-03', endDate: '2026-10-03', home: null, destination: RICHMOND }).away, null);
  assert.equal(away({ startDate: '2026-10-03', home: DC, destination: BALTIMORE }).away, null, 'no end date: could be a week');
  assert.equal(away({}).reason, 'unknown');
});

test('Null Island is not somewhere anybody lives', () => {
  assert.equal(pointOf({ lat: 0, lng: 0 }), null);
  assert.equal(pointOf({ lat: NaN, lng: 1 }), null);
  assert.equal(pointOf({ lat: 91, lng: 1 }), null);
  assert.equal(pointOf({ lat: '38' as never, lng: -77 }), null);
  const r = away({ startDate: '2026-10-03', endDate: '2026-10-03', home: { lat: 0, lng: 0 }, destination: RICHMOND });
  assert.equal(r.km, null);
  assert.equal(r.away, null);
});

test('nights are counted as dates, wherever the server is', () => {
  const was = process.env.TZ;
  try {
    for (const tz of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
      process.env.TZ = tz;
      assert.equal(nightsBetween('2026-10-31', '2026-11-02'), 2, tz); // across the US clock change
      assert.equal(nightsBetween('2026-10-03', '2026-10-03'), 0, tz);
    }
  } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
  assert.equal(nightsBetween('2026-10-05', '2026-10-03'), null, 'an end before the start is a typo');
  assert.equal(nightsBetween('2026-02-30', '2026-03-02'), null);
  assert.equal(nightsBetween('2026-10-03T00:00:00+00:00', '2026-10-06'), 3, 'a timestamp is still its day');
});
