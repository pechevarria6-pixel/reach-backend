// Run with: npm run test:unit
// Destination diversity, Task 3: what the group said becomes tags; code picks
// the places; the model writes about those places only; its answer is read
// back and priced against the guardrail; what was offered is counted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  tagsInWords, tagWeightsFrom, groupContextFrom, fixedPlacesBlock, readBackPlaces,
  tierPriced, fewerWords, tagsFromCounts,
} from '../../lib/destination-context.ts';
import { pickThree, type Candidate } from '../../lib/destination-select.ts';

const ROUTE = readFileSync('app/api/trips/generate/route.ts', 'utf8');
const CANDIDATES = readFileSync('lib/destination-candidates.ts', 'utf8');
const APP = readFileSync('components/reach-app.jsx', 'utf8');

test('a blurb becomes venue interests we hold — never "beach" or "ski", which no venue says', () => {
  assert.deepEqual(tagsInWords('Breweries and a bit of hiking, maybe live music'), ['live music', 'outdoors', 'breweries']);
  assert.deepEqual(tagsInWords('ski trip with the boys'), []);
  assert.deepEqual(tagsInWords('beach week'), []);
  assert.deepEqual(tagsInWords(''), []);
});

test('each member counts once; what the trip is for leads; generic interests say nothing', () => {
  const w = tagWeightsFrom({
    members: [
      { favorite_activities: ['Live music', 'Breweries'], cuisines: ['Italian'] },
      { favorite_activities: ['Breweries'] },
    ],
    goal: 'somewhere with good museums',
    tripTypes: ['nature'],
  });
  assert.equal(w['breweries'], 1);
  assert.equal(w['live music'], 0.5);
  assert.equal(w['italian restaurants'], 0.25);
  assert.equal(w['museums & history'], 2);
  assert.equal(w['outdoors'], 2);
  assert.equal(w['places to eat'], undefined);
});

test('the strictest member decides crowds, and no budget is no budget', () => {
  const g = groupContextFrom({ members: [{ crowd_tolerance: 'love' }, { crowd_tolerance: 'avoid' }], budgetPerPersonDollars: null });
  assert.equal(g.crowdTolerance, 'avoid');
  assert.equal(g.budgetPerPersonCents, 0);
  assert.equal(groupContextFrom({ members: [], budgetPerPersonDollars: 900 }).budgetPerPersonCents, 90000);
});

test('a candidate\'s tags are what its venues hold, three or more, minus the generic', () => {
  assert.deepEqual(tagsFromCounts({ 'places to eat': 400, breweries: 12, jazz: 2, outdoors: 3 }), ['breweries', 'outdoors']);
});

const cand = (id: string, name: string, o: Partial<Candidate> = {}): Candidate => ({
  id, name, region: 'NC', lat: null, lng: null, popularity: null, crowdThisMonth: null, servedLast30d: 0,
  pricedPerPersonCents: null, travelMinutes: null, tags: ['breweries'], verifiedVenueCount: 200, ...o,
});

test('the prompt names the chosen places, fixes the count, and forbids the unsupported claims', () => {
  const picks = pickThree([cand('a', 'Asheville', { lat: 35.6, lng: -82.55 }), cand('w', 'Wilmington', { lat: 34.23, lng: -77.94 })],
    groupContextFrom({ members: [{ favorite_activities: ['Breweries'] }], budgetPerPersonDollars: 900 }));
  const block = fixedPlacesBlock(picks);
  assert.match(block, /Write exactly 2 options/);
  assert.match(block, /1\. Asheville, NC — city "Asheville"/);
  assert.match(block, /Do not add a place, swap one, or rename one/);
  assert.match(block, /hidden gem/);
});

test('read-back: a place code did not choose is a stray and goes; each pick keeps one option, in pick order', () => {
  const picks = pickThree([cand('a', 'Asheville', { lat: 35.6, lng: -82.55 }), cand('w', 'Wilmington', { lat: 34.23, lng: -77.94 })],
    groupContextFrom({ members: [{ favorite_activities: ['Breweries'] }], budgetPerPersonDollars: 900 }));
  const back = readBackPlaces([
    { city: 'Santorini', destination: 'Santorini, Greece' },
    { city: 'wilmington', destination: 'Wilmington, NC' },
    { city: '', destination: 'Asheville, North Carolina' },
    { city: 'Asheville', destination: 'Asheville again' },
  ], picks);
  assert.deepEqual(back.kept.map(k => k.pick.candidate.name), picks.map(p => p.candidate.name));
  assert.deepEqual(back.strays.sort(), ['Asheville', 'Santorini'].sort());
});

test('the guardrail is applied to the model\'s own price; over 1.2× is never offered', () => {
  assert.equal(tierPriced(700, 900), 'saver');
  assert.equal(tierPriced(900, 900), 'fair');
  assert.equal(tierPriced(1080, 900), 'stretch');
  assert.equal(tierPriced(1081, 900), null);
  assert.equal(tierPriced(1500, null), undefined, 'no budget, no guardrail to apply');
  assert.equal(tierPriced('n/a', 900), undefined);
});

test('fewer than three is said plainly, and offers to widen', () => {
  assert.equal(fewerWords(3), null);
  assert.equal(fewerWords(2), 'We found two that really fit. Want us to widen the search?');
  assert.match(fewerWords(0)!, /among the places we know well yet/);
});

test('the route: behind the switch, open-ended trips only, read back, priced, counted', () => {
  assert.match(ROUTE, /process\.env\.DESTINATION_SELECT === 'on' && !isNightPlan && !fixedPlace/);
  assert.match(ROUTE, /\$\{picks \? fixedPlacesBlock\(picks\) : fixedPlace \?/);
  const back = ROUTE.indexOf('readBackPlaces(trips, picks)');
  assert.ok(back > 0 && back < ROUTE.indexOf('Getting there and a bed, on every away option'), 'read back before anything is built on the places');
  assert.match(ROUTE, /tierPriced\(\(trip as any\)\.total_per_person, effectiveBudget\)/);
  assert.match(ROUTE, /await recordServed\(supabase, servedIds\)/);
  assert.match(ROUTE, /track\(supabase, 'destination_served'/);
  assert.match(ROUTE, /users\(id,name,budget_range,climate_preference,dietary_needs,\s*favorite_activities,/);
});

test('the database half: one row per place, a missing view switches selection off, exposure is one statement', () => {
  assert.match(CANDIDATES, /destination_venue_tags not created yet/);
  assert.match(CANDIDATES, /db\.rpc\('bump_destination_exposure', \{ ids \}\)/);
  assert.match(CANDIDATES, /pricedPerPersonCents: null,/);
});

test('the screen offers the widening, and says the gap is ours, not theirs', () => {
  assert.match(APP, /function WidenOffer\(\{offer,onWiden,busy\}\)/);
  assert.match(APP, /widen:extra\.widen\|\|0/);
  assert.match(APP, />Widen the search</);
});
