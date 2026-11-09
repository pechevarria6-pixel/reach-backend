// Run with: npm run test:unit
// UX F08-01 (S1): the Budget tab and checkout must give one person one total.
// Maya's trip: the flight ($54.86) and hotel ($914.38) are quoted on their
// booking rows but carry no cost_cents on the line, plus ~$117 spent on the
// day, against a $900 budget. Budget said "$117 … $783 under"; checkout said
// "$69.24 over". The truth is $969.24 through Reach + ~$117, ~$186 over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { budgetSplit, budgetLine, lineCosts } from '../../lib/budget.ts';

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const lines = [
  { id: 'f', title: 'Flight', booking_mode: 'reach', cost_cents: null },
  { id: 'h', title: 'Hotel', booking_mode: 'reach', cost_cents: 0 },
  { id: 'd1', title: 'Dinner', booking_mode: 'self', cost_cents: 6000 },
  { id: 'd2', title: 'Museum', booking_mode: 'self', cost_cents: 5700 },
  { id: 'x', title: 'Spa', booking_mode: 'reach', cost_cents: null },
];
const bookings = [
  { id: 'bf', itinerary_item_id: 'f', status: 'quoted' },
  { id: 'bh', itinerary_item_id: 'h', status: 'quoted' },
];
const share = [
  { ref: 'bf', imIn: true, priceCents: 5486, myCents: 5486, inCount: 1 },
  { ref: 'bh', imIn: true, priceCents: 91438, myCents: 91438, inCount: 1 },
];

test('a line priced only on its booking row is in the total, not "priced at booking"', () => {
  const costs = lineCosts(lines, bookings, share, 1);
  const s = budgetSplit(lines, costs, new Set(), 1);
  assert.equal(s.fixedTotal, 96924, 'what checkout charges: $969.24');
  assert.equal(s.varTotal, 11700);
  assert.deepEqual(s.unpriced.map(l => l.id), ['x'], 'only the line with no price anywhere');
  assert.equal(budgetLine(s, 900, money), 'Through Reach $969.24 · On the day ~$117.00 · about $186.24 over your $900.');
});

test('nothing is priced on a guess: with no rows, an unpriced Reach line stays unpriced', () => {
  const s = budgetSplit(lines, lineCosts(lines, [], [], 1), new Set(), 1);
  assert.deepEqual(s.unpriced.map(l => l.id), ['f', 'h', 'x']);
  assert.equal(s.fixedTotal, 0);
  assert.equal(budgetLine(s, 900, money), 'On the day ~$117.00 · about $783.00 under your $900.');
});

test('a line you came off counts for the group, not for you', () => {
  const off = [{ ...share[0], imIn: false, myCents: 0, inCount: 1 }, share[1]];
  const costs = lineCosts(lines, bookings, off, 2);
  const s = budgetSplit(lines, costs, new Set(['f']), 2);
  assert.deepEqual(s.notYours.map(l => l.id), ['f']);
  assert.equal(s.fixedTotal, 91438);
  assert.equal(s.altogether, 5486 + 91438 + 11700 * 2);
});

test('no budget, no sentence; never "Booked" before anything is', () => {
  assert.equal(budgetLine({ fixedTotal: 1, varTotal: 1 }, 0, money), null);
  const src = readFileSync('lib/budget.ts', 'utf8');
  assert.equal(/`Booked through Reach/.test(src), false);
});

test('the Budget tab reads the split, not the line alone', () => {
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  assert.match(app, /const split=budgetSplit\(items,costs,youreOff,heads\);/);
  assert.match(app, /\{budgetLine\(split,plan\.budget,money\)\}/);
  assert.equal(/items\.filter\(i=>i\.booking_mode==="reach"&&!\(i\.cost_cents>0\)\)/.test(app), false, 'the old line-only unpriced filter is gone');
});
