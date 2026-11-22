// Run with: npm run test:unit
// lib/destination-select.ts — the selector's own rules, one at a time.
// The concentration tripwire (the study's method) is
// tests/unit/destination-tripwire.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickThree, tierFor, score, haversineKm, strictestCrowd, topKShare, widened, SELECT_CONFIG,
  type Candidate, type GroupContext,
} from '../../lib/destination-select.ts';

const c = (id: string, o: Partial<Candidate> = {}): Candidate => ({
  id, name: id, region: null, lat: null, lng: null, popularity: null, crowdThisMonth: null,
  servedLast30d: 0, pricedPerPersonCents: 50000, travelMinutes: 120, tags: ['surf'], verifiedVenueCount: 40, ...o,
});
const g = (o: Partial<GroupContext> = {}): GroupContext => ({
  budgetPerPersonCents: 100000, tagWeights: { surf: 1 }, crowdTolerance: 'fine',
  excludedIds: new Set(), maxTravelMinutes: null, ...o,
});

test('tiers by price against the budget; over 1.2× is never offered; unknowns are undefined, not cheap', () => {
  assert.equal(tierFor(c('a', { pricedPerPersonCents: 80000 }), g()), 'saver');
  assert.equal(tierFor(c('a', { pricedPerPersonCents: 100000 }), g()), 'fair');
  assert.equal(tierFor(c('a', { pricedPerPersonCents: 120000 }), g()), 'stretch');
  assert.equal(tierFor(c('a', { pricedPerPersonCents: 120001 }), g()), null);
  assert.equal(tierFor(c('a', { pricedPerPersonCents: null }), g()), undefined);
  assert.equal(tierFor(c('a'), g({ budgetPerPersonCents: 0 })), undefined, 'no budget is no guardrail, not a division by zero');
});

test('one pick per tier where possible', () => {
  const all = [
    c('s', { pricedPerPersonCents: 60000, lat: 35, lng: -79 }),
    c('f', { pricedPerPersonCents: 95000, lat: 30, lng: -90 }),
    c('t', { pricedPerPersonCents: 115000, lat: 40, lng: -105 }),
  ];
  assert.deepEqual(pickThree(all, g()).map(p => [p.tier, p.candidate.id]), [['saver', 's'], ['fair', 'f'], ['stretch', 't']]);
});

test('spread: within 150 km is a neighbour; region decides only when coordinates are missing', () => {
  // Southern Pines and Aberdeen are ~10 km apart: one of them.
  const near = [c('sp', { lat: 35.17, lng: -79.39, region: 'NC' }), c('ab', { lat: 35.13, lng: -79.43, region: 'NC' })];
  assert.equal(pickThree(near, g()).length, 1);
  // Asheville and Wilmington share a state but are ~400 km apart: both.
  const far = [c('av', { lat: 35.6, lng: -82.55, region: 'NC' }), c('wi', { lat: 34.23, lng: -77.94, region: 'NC' })];
  assert.equal(haversineKm({ lat: 35.6, lng: -82.55 }, { lat: 34.23, lng: -77.94 }) > 150, true);
  assert.equal(pickThree(far, g()).length, 2);
  // No coordinates: the shared region is all we can see.
  assert.equal(pickThree([c('x', { region: 'NC' }), c('y', { region: 'NC' })], g()).length, 1);
});

test('at most one headline destination', () => {
  const all = [c('h1', { popularity: 0.9, lat: 25, lng: -80 }), c('h2', { popularity: 0.85, lat: 40, lng: -74 })];
  assert.equal(pickThree(all, g()).length, 1);
});

test('a pick traces to something said; excluded, thin and too-far are never returned', () => {
  assert.deepEqual(pickThree([c('a', { tags: ['ski'] })], g()), [], 'no matching tag, no pick');
  assert.deepEqual(pickThree([c('a')], g({ excludedIds: new Set(['a']) })), []);
  assert.deepEqual(pickThree([c('a', { verifiedVenueCount: 4 })], g()), []);
  assert.deepEqual(pickThree([c('a', { travelMinutes: 600 })], g({ maxTravelMinutes: 300 })), []);
  assert.equal(pickThree([c('a', { travelMinutes: null })], g({ maxTravelMinutes: 300 })).length, 1, 'unknown is not too far');
});

test('popularity, exposure and crowds move the score; unknowns move nothing', () => {
  const base = score(c('a'), g()).score;
  assert.ok(score(c('a', { popularity: 0.9 }), g()).score < base);
  assert.equal(score(c('a', { popularity: null }), g()).score, base);
  assert.ok(score(c('a', { servedLast30d: 50 }), g()).score < base);
  assert.ok(score(c('a', { crowdThisMonth: 0.9 }), g({ crowdTolerance: 'avoid' })).score < base);
  assert.equal(score(c('a', { crowdThisMonth: null }), g({ crowdTolerance: 'avoid' })).score, base);
  assert.deepEqual(score(c('a', { crowdThisMonth: 0.2 }), g({ crowdTolerance: 'avoid' })).reasons, ['tag:surf', 'evidence:quiet-this-month']);
  assert.ok(!score(c('a', { crowdThisMonth: null }), g({ crowdTolerance: 'avoid' })).reasons.includes('evidence:quiet-this-month'),
    'no figure, no "quiet" claim');
});

test('an unpriced place can fill an empty slot, with no tier until it is priced', () => {
  const picks = pickThree([c('p', { pricedPerPersonCents: 70000, lat: 35, lng: -79 }), c('u', { pricedPerPersonCents: null, lat: 30, lng: -90 })], g());
  assert.deepEqual(picks.map(p => [p.tier, p.candidate.id]), [['saver', 'p'], [null, 'u']]);
});

test('the strictest member decides crowds; widening relaxes travel, then spread, never tags', () => {
  assert.equal(strictestCrowd(['love', 'avoid', 'fine']), 'avoid');
  assert.equal(strictestCrowd(['love', 'fine']), 'fine');
  assert.equal(strictestCrowd([null, undefined]), 'fine');
  const w1 = widened(g({ maxTravelMinutes: 200 }), SELECT_CONFIG, 1);
  assert.equal(w1.g.maxTravelMinutes, null);
  assert.equal(w1.cfg.minSpreadKm, 150);
  const w2 = widened(g({ maxTravelMinutes: 200 }), SELECT_CONFIG, 2);
  assert.equal(w2.cfg.minSpreadKm, 75);
  assert.deepEqual(w2.g.tagWeights, { surf: 1 });
});

test('topKShare', () => {
  assert.equal(topKShare([]), 0);
  assert.equal(topKShare(['a', 'a', 'b', 'c'], 1), 0.5);
  assert.equal(topKShare(['a', 'b'], 5), 1);
});
