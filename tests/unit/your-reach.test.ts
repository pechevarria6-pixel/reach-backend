// Run with: npm run test:unit
// Part B: "Your Reach" — trips taken, places, days since each group last
// travelled together, all counted from plans and never estimated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { yourReach, sinceWords } from '../../lib/your-reach.ts';

const TODAY = '2026-11-22';
const groups = [
  { id: 'g1', name: 'Uni friends', plans: [
    { status: 'completed', startDate: '2026-10-01', endDate: '2026-10-04', destinationCity: 'Asheville' },
    { status: 'booked', startDate: '2026-11-10', endDate: '2026-11-12', destination: 'Charleston, SC' },
    { status: 'booked', startDate: '2026-12-04', endDate: '2026-12-06', destinationCity: 'Charleston' }, // not over
    { status: 'cancelled', startDate: '2026-09-01', endDate: '2026-09-03', destinationCity: 'Miami' },
    { status: 'voting', startDate: '2026-08-01', endDate: '2026-08-02', destinationCity: 'Denver' }, // never booked
  ] },
  { id: 'g2', name: 'Family', plans: [{ status: 'completed', startDate: '2026-06-20', endDate: null, destinationCity: 'asheville' }] },
  { id: 'g3', name: 'Work', plans: [] },
];

test('only trips that were booked and are over count', () => {
  const r = yourReach(groups, TODAY);
  assert.equal(r.tripsTaken, 3);
  assert.equal(r.places, 2, 'Asheville twice is one place');
});

test('days since each group last travelled, from the last trip\'s end; none is said as none', () => {
  const r = yourReach(groups, TODAY);
  assert.deepEqual(r.groups.map(g => [g.name, g.daysSince]), [['Uni friends', 10], ['Family', 155], ['Work', null]]);
  assert.equal(sinceWords(10), '10 days since your last trip');
  assert.equal(sinceWords(1), '1 day since your last trip');
  assert.equal(sinceWords(null), 'No trip together yet');
});

test('a trip ending today is not over yet, and a bad date counts nothing', () => {
  assert.equal(yourReach([{ id: 'g', name: 'g', plans: [{ status: 'booked', endDate: TODAY }] }], TODAY).tripsTaken, 0);
  assert.deepEqual(yourReach(groups, 'soon'), { tripsTaken: 0, places: 0, groups: [] });
});

test('the card is on Profile and hides until there is a trip', () => {
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  assert.match(app, /const r=yourReach\(groups,today\(\)\);\s*if\(!r\.tripsTaken\)return null;/);
});
