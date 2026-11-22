// Run with: npm run test:unit
// Destination diversity, Task 6: the concentration tripwire.
//
// The study's method (Najafi and Costa, reported in the WSJ): put the same
// travel questions several times to a system and count how much of what it
// recommends is a handful of places. Here: eight fixture groups with
// different tastes and budgets, each run three times against one fixture
// catalogue. The same group must get the same picks every run; across all of
// them, the five most-served places may take at most 40% of servings. The
// build fails above it.
//
// The catalogue is built to tempt concentration: four "headline" places
// match nearly every taste, the way a model's free recall reaches for the
// same famous cities. The last test switches the popularity, headline and
// spread rules off and shows the headliners then take over — so the 40% is
// held by the rules, not by a catalogue that could not concentrate anyway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickThree, topKShare, haversineKm, SELECT_CONFIG,
  type Candidate, type GroupContext,
} from '../../lib/destination-select.ts';

const place = (id: string, region: string, lat: number, lng: number, popularity: number | null, price: number, tags: string[], venues = 120): Candidate => ({
  id, name: id, region, lat, lng, popularity, crowdThisMonth: null, servedLast30d: 0,
  pricedPerPersonCents: price * 100, travelMinutes: null, tags, verifiedVenueCount: venues,
});

// Four headliners that match almost everything, then thirty-two places that
// each match a few things, spread across the country.
const EVERYTHING = ['breweries', 'live music', 'museums & history', 'outdoors', 'cocktail bars', 'art & galleries', 'wellness', 'comedy'];
const CATALOG: Candidate[] = [
  place('new-york', 'NY', 40.71, -74.0, 0.98, 1400, EVERYTHING),
  place('las-vegas', 'NV', 36.17, -115.14, 0.95, 1000, EVERYTHING),
  place('miami', 'FL', 25.76, -80.19, 0.92, 1100, EVERYTHING),
  place('nashville', 'TN', 36.16, -86.78, 0.88, 900, EVERYTHING),
  place('asheville', 'NC', 35.6, -82.55, 0.45, 650, ['breweries', 'outdoors', 'art & galleries']),
  place('wilmington', 'NC', 34.23, -77.94, 0.3, 600, ['outdoors', 'breweries', 'museums & history']),
  place('charleston', 'SC', 32.78, -79.93, 0.6, 900, ['museums & history', 'cocktail bars', 'art & galleries']),
  place('savannah', 'GA', 32.08, -81.09, 0.5, 750, ['museums & history', 'cocktail bars', 'comedy']),
  place('denver', 'CO', 39.74, -104.99, 0.62, 850, ['breweries', 'outdoors', 'live music']),
  place('boulder', 'CO-W', 40.01, -105.27, 0.35, 900, ['outdoors', 'wellness']),
  place('austin', 'TX', 30.27, -97.74, 0.7, 800, ['live music', 'breweries', 'comedy']),
  place('san-antonio', 'TX-S', 29.42, -98.49, 0.45, 550, ['museums & history', 'live music']),
  place('new-orleans', 'LA', 29.95, -90.07, 0.75, 850, ['live music', 'cocktail bars', 'museums & history']),
  place('memphis', 'TN-W', 35.15, -90.05, 0.4, 500, ['live music', 'museums & history']),
  place('portland', 'OR', 45.52, -122.68, 0.55, 950, ['breweries', 'outdoors', 'art & galleries']),
  place('bend', 'OR-C', 44.06, -121.31, 0.25, 700, ['outdoors', 'breweries', 'wellness']),
  place('santa-fe', 'NM', 35.69, -105.94, 0.4, 800, ['art & galleries', 'wellness', 'museums & history']),
  place('sedona', 'AZ', 34.87, -111.76, 0.5, 950, ['wellness', 'outdoors']),
  place('chicago', 'IL', 41.88, -87.63, 0.78, 1000, ['comedy', 'museums & history', 'live music']),
  place('minneapolis', 'MN', 44.98, -93.27, 0.35, 700, ['comedy', 'breweries', 'art & galleries']),
  place('burlington', 'VT', 44.48, -73.21, 0.2, 650, ['outdoors', 'breweries', 'wellness']),
  place('louisville', 'KY', 38.25, -85.76, 0.3, 550, ['cocktail bars', 'museums & history', 'live music']),
  place('chattanooga', 'TN-E', 35.05, -85.31, 0.25, 500, ['outdoors', 'breweries']),
  place('providence', 'RI', 41.82, -71.41, 0.2, 650, ['art & galleries', 'museums & history', 'cocktail bars']),
  // A further twelve: a nationwide catalogue of ~36 is the least that holds
  // the tripwire (24 places gave 0.417 whatever the weights — eight groups
  // need 24 picks, and a catalogue that size has to repeat). Production holds
  // 17 today; see STATUS.md.
  place('madison', 'WI', 43.07, -89.4, 0.3, 600, ['breweries', 'live music', 'outdoors']),
  place('missoula', 'MT', 46.87, -113.99, 0.15, 750, ['outdoors', 'breweries', 'wellness']),
  place('tucson', 'AZ-S', 32.22, -110.97, 0.35, 650, ['outdoors', 'art & galleries', 'museums & history']),
  place('kansas-city', 'MO', 39.1, -94.58, 0.35, 600, ['live music', 'museums & history', 'cocktail bars']),
  place('st-louis', 'MO-E', 38.63, -90.2, 0.35, 550, ['museums & history', 'breweries', 'comedy']),
  place('pittsburgh', 'PA', 40.44, -80.0, 0.35, 600, ['museums & history', 'art & galleries', 'comedy']),
  place('richmond', 'VA', 37.54, -77.44, 0.25, 550, ['breweries', 'museums & history', 'outdoors']),
  place('durango', 'CO-S', 37.27, -107.88, 0.15, 700, ['outdoors', 'wellness']),
  place('marfa', 'TX-W', 30.31, -104.02, 0.1, 800, ['art & galleries', 'wellness']),
  place('portland-me', 'ME', 43.66, -70.26, 0.3, 750, ['breweries', 'cocktail bars', 'outdoors']),
  place('athens-ga', 'GA-N', 33.96, -83.38, 0.2, 500, ['live music', 'breweries', 'comedy']),
  place('boise', 'ID', 43.62, -116.2, 0.2, 650, ['outdoors', 'breweries', 'wellness']),
];

const group = (tags: Record<string, number>, budget: number, o: Partial<GroupContext> = {}): GroupContext => ({
  budgetPerPersonCents: budget * 100, tagWeights: tags, crowdTolerance: 'fine', excludedIds: new Set(), maxTravelMinutes: null, ...o,
});

// Eight groups: different tastes, different budgets.
const GROUPS: GroupContext[] = [
  group({ breweries: 1, outdoors: 1 }, 800),
  group({ 'live music': 1.5, comedy: 0.5 }, 900),
  group({ 'museums & history': 1, 'cocktail bars': 1 }, 1000),
  group({ wellness: 1.5, outdoors: 0.5 }, 1000),
  group({ 'art & galleries': 1, breweries: 0.5 }, 750),
  group({ comedy: 1, 'live music': 1, breweries: 0.5 }, 1100),
  group({ outdoors: 2 }, 650),
  group({ 'museums & history': 1, 'live music': 1 }, 600),
];

const RUNS = 3;
/**
 * The groups ask one after another, as they would in production, and what
 * each was offered is counted before the next asks (destination_exposure,
 * read back as servedLast30d). A group's own three runs see the same state —
 * three requests at once — so they must agree exactly. Exposure is the
 * directive's mechanism for variety; holding it at zero would test a system
 * that does not exist.
 */
const served = (cfg = SELECT_CONFIG, withExposure = true) => {
  const all: string[] = [];
  const perGroup: string[][][] = [];
  const exposure = new Map<string, number>();
  for (const g of GROUPS) {
    const catalog = CATALOG.map(c => ({ ...c, servedLast30d: withExposure ? exposure.get(c.id) ?? 0 : 0 }));
    const runs: string[][] = [];
    for (let r = 0; r < RUNS; r++) {
      const ids = pickThree(catalog, g, cfg).map(p => p.candidate.id);
      runs.push(ids);
      all.push(...ids);
    }
    for (const ids of runs) for (const id of ids) exposure.set(id, (exposure.get(id) ?? 0) + 1);
    perGroup.push(runs);
  }
  return { all, perGroup };
};

test('the same group gets the same picks, every run', () => {
  const { perGroup } = served();
  perGroup.forEach((runs, i) => {
    assert.ok(runs[0].length > 0, `group ${i} got something`);
    for (const r of runs) assert.deepEqual(r, runs[0], `group ${i} changed between runs`);
  });
});

test('across groups, the five most-served places take at most 40% (the study found ~53% for ten)', () => {
  const { all } = served();
  const share = topKShare(all, 5);
  assert.ok(share <= 0.4, `top-5 share ${share.toFixed(3)} over the 0.40 tripwire: ${JSON.stringify(Object.entries(all.reduce((m, id) => ({ ...m, [id]: (m[id] ?? 0) + 1 }), {} as Record<string, number>)).sort((a, b) => b[1] - a[1]).slice(0, 6))}`);
});

test('every set obeys spread and the one-headliner rule', () => {
  for (const g of GROUPS) {
    const picks = pickThree(CATALOG, g).map(p => p.candidate);
    for (let i = 0; i < picks.length; i++) for (let j = i + 1; j < picks.length; j++) {
      const a = picks[i], b = picks[j];
      assert.ok(haversineKm({ lat: a.lat!, lng: a.lng! }, { lat: b.lat!, lng: b.lng! }) >= SELECT_CONFIG.minSpreadKm, `${a.id} and ${b.id} are neighbours`);
    }
    assert.ok(picks.filter(c => (c.popularity ?? 0) >= SELECT_CONFIG.headline).length <= 1, 'two headliners in one set');
  }
});

test('thin data gives fewer picks, never padding', () => {
  const thin = CATALOG.slice(4, 6); // Asheville and Wilmington
  const picks = pickThree(thin, group({ breweries: 1 }, 800));
  assert.ok(picks.length <= 2);
  assert.ok(picks.every(p => p.reasons.some(r => r.startsWith('tag:'))));
});

test('without the rules, the headliners take over — the 40% is the rules\' doing', () => {
  const off = { ...SELECT_CONFIG, popularityWeight: 0, exposureWeight: 0, headline: 2, minSpreadKm: 0 };
  const share = topKShare(served(off, false).all, 5);
  const on = topKShare(served().all, 5);
  assert.ok(share > on, `rules off ${share.toFixed(3)} should concentrate more than rules on ${on.toFixed(3)}`);
  assert.ok(share > 0.4, `rules off should breach the tripwire, got ${share.toFixed(3)}`);
});
