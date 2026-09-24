// Recommended trips on Home: ranked from what we hold, never from nothing.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickTrips, candidatesFrom, tally, vetoedRow, clearsFloor, bandFor, estimate, tierOf,
  partyTier, plannedKeys, leaningOf, notATown, heldLine, matchedLine, whoFor, isAbroad,
  isPlanned, whereName, uncheckedLine, LONG_FLIGHT_MILES,
  FLOOR, type Candidate, type Holdings, type Person,
} from '../../lib/recommendations/trip-picks.ts';
import { TripPickSchema, picksFrom, seedFromPick } from '../../lib/contracts/trip-pick.ts';

// Raleigh, and towns at known distances from it.
const RALEIGH = { lat: 35.7804, lng: -78.6391 };
const town = (name: string, lat: number, lng: number, country: string | null = 'US', extra: Partial<Candidate> = {}): Candidate =>
  ({ key: `${name.toLowerCase()}|${country ?? ''}`, name, country, label: name, lat, lng, ...extra });

const raleigh = town('Raleigh', 35.7804, -78.6391);
const asheville = town('Asheville', 35.5951, -82.5515);       // ~220 miles
const charlotte = town('Charlotte', 35.2271, -80.8431);       // ~130 miles
const seattle = town('Seattle', 47.6062, -122.3321);          // ~2,360 miles
const paris = town('Paris', 48.8566, 2.3522, 'FR', { rank: 6 });
const ghost = town('Nowhere', 36.0, -79.9);                   // ~70 miles, holds nothing

/** Holdings from "interest|kind" → n. */
const held = (counts: Record<string, number>, floor = false): Holdings => ({ counts, floor });
const city = (n = 1): Holdings => held({
  'places to eat|restaurant': 200 * n, 'live music|music venue': 12 * n, 'live music|nightclub': 20 * n,
  'breweries|brewery': 15 * n, 'museums & history|museum': 10 * n, 'outdoors|park': 30 * n,
  'nightclubs|nightclub': 6 * n, 'seafood restaurants|restaurant': 9 * n,
});

const person = (over: Partial<Person> = {}): Person => ({
  home: RALEIGH, homeCountry: 'US', homeAirport: 'RDU',
  me: { favorite_activities: ['Live music', 'Breweries'], cuisines: [], no_way_jose: [], budget_range: '$100 – $200' },
  group: null,
  planned: { trips: new Map(), nights: new Map() },
  dismissed: new Set(),
  ...over,
});

const all = [raleigh, asheville, charlotte, seattle, paris, ghost];
const holdingsFor = (over: Record<string, Holdings | undefined> = {}) => new Map<string, Holdings>(Object.entries({
  [raleigh.key]: city(3), [asheville.key]: city(1), [charlotte.key]: city(1),
  [seattle.key]: city(2), [paris.key]: city(2), [ghost.key]: held({}),
  ...over,
}).filter(([, v]) => v) as Array<[string, Holdings]>);

// ── Grounding ────────────────────────────────────────────────────────────

test('a town with no verified places never appears', () => {
  const { picks } = pickTrips(all, holdingsFor(), person(), { max: 10 });
  assert.ok(picks.length > 0);
  assert.ok(!picks.some(p => p.destination.city === 'Nowhere'));
  // Nor does one we could not count at all.
  const { picks: uncounted } = pickTrips(all, holdingsFor({ [asheville.key]: undefined }), person(), { max: 10 });
  assert.ok(!uncounted.some(p => p.destination.city === 'Asheville'));
});

test('a town under the floor is not put forward, however well it matches', () => {
  const thin = held({ 'places to eat|restaurant': 2, 'live music|music venue': 40 });
  assert.equal(clearsFloor(tally(thin, [], false)), false);
  const { picks } = pickTrips(all, holdingsFor({ [asheville.key]: thin }), person(), { max: 10 });
  assert.ok(!picks.some(p => p.destination.city === 'Asheville'));
  assert.ok(FLOOR.total >= 1 && FLOOR.food >= 1);
});

test('every count on a card is a count we hold', () => {
  const { picks } = pickTrips(all, holdingsFor(), person(), { max: 10 });
  const ash = picks.find(p => p.destination.city === 'Asheville')!;
  // 200 + 9 seafood = 209 places to eat; 32 live-music rows; 15 breweries.
  assert.match(ash.held, /^209 places to eat/);
  assert.match(ash.held, /32 live-music venues/);
  assert.match(ash.held, /we've checked$/);
});

test('a count that stopped at the page limit says it is a floor', () => {
  const line = heldLine(tally(held({ 'places to eat|restaurant': 5000, 'live music|bar': 40 }, true), [], false), ['live music']);
  assert.match(line, /5,000\+ places to eat/);
  assert.match(line, /40\+ live-music venues/);
});

test('an estimate is labelled as one and is a range', () => {
  const { picks } = pickTrips(all, holdingsFor(), person(), { max: 10 });
  for (const p of picks) {
    assert.match(p.cost.label, /^Estimate/);
    assert.match(p.cost.label, /Nothing is priced yet/);
    assert.ok(p.cost.low > 0 && p.cost.high > p.cost.low, p.title);
  }
});

// ── Vetoes ───────────────────────────────────────────────────────────────

test('a vetoed kind never drives a pick', () => {
  // Only one town has breweries, and it has nothing else they like.
  const brewTown = town('Brewville', 35.0, -80.0);
  const brews = held({ 'places to eat|restaurant': 30, 'breweries|brewery': 400 });
  const plain = held({ 'places to eat|restaurant': 30, 'museums & history|museum': 2 });
  const plainTown = town('Plainfield', 35.3, -80.2);
  const lover = person({ me: { favorite_activities: ['Breweries'], no_way_jose: [] } });
  const sober = person({ me: { favorite_activities: ['Breweries'], drink_style: 'Not drinking', no_way_jose: [] } });
  const cands = [raleigh, brewTown, plainTown];
  const hs = new Map([[raleigh.key, city(1)], [brewTown.key, brews], [plainTown.key, plain]]);

  const liked = pickTrips(cands, hs, lover).picks.find(p => p.band === 'weekend')!;
  assert.equal(liked.destination.city, 'Brewville');

  const out = pickTrips(cands, hs, sober).picks.filter(p => p.band === 'weekend');
  for (const p of out) {
    assert.doesNotMatch(`${p.held} ${p.matched ?? ''}`, /brew/i, 'no line leans on the bars');
  }
  const brew = out.find(p => p.destination.city === 'Brewville');
  if (brew) assert.match(brew.leftOut ?? '', /not drinking/);
});

test("somebody else's veto in the group counts too, and is said without naming them", () => {
  const g = { id: 'g1', name: 'Beach Crew', members: [{ no_way_jose: ['Clubs'] }] };
  const { picks } = pickTrips(all, holdingsFor(), person({ group: g }), { max: 10 });
  const ash = picks.find(p => p.destination.city === 'Asheville')!;
  // The twenty nightclubs filed as live music are gone; the twelve rooms stay.
  assert.match(ash.held, /12 live-music venues/);
  assert.equal(ash.leftOut, 'No nightclubs — somebody in the group ruled them out.');
});

test('the words of a row are checked against the veto', () => {
  assert.equal(vetoedRow('seafood restaurants', 'restaurant', ['Seafood'], false), true);
  assert.equal(vetoedRow('live music', 'nightclub', ['Clubs'], false), true);
  assert.equal(vetoedRow('live music', 'music venue', ['Clubs'], false), false);
  assert.equal(vetoedRow('breweries', 'brewery', [], true), true);
  assert.equal(vetoedRow('museums & history', 'museum', ['Cold weather', 'Big crowds'], false), false);
});

test('a town whose name is itself a veto is not offered', () => {
  const { picks } = pickTrips(all, holdingsFor(), person({ me: { favorite_activities: ['Live music'], no_way_jose: ['custom:Asheville'] } }), { max: 10 });
  assert.ok(!picks.some(p => p.destination.city === 'Asheville'));
});

// ── Solo and group copy ──────────────────────────────────────────────────

test('solo copy speaks to one person', () => {
  const { picks } = pickTrips(all, holdingsFor(), person(), { max: 10 });
  for (const p of picks) {
    assert.equal(p.who, 'For you');
    assert.equal(p.cost.each, false, 'no "each" when there is one of you');
    const said = [p.title, p.who, p.held, p.matched, p.leftOut, p.cost.label, p.cta].join(' ');
    assert.doesNotMatch(said, /\beveryone\b|\bgroup\b|\bof you\b|\bothers\b/i, said);
    if (p.matched) assert.match(p.matched, /^You said you're into /);
  }
});

test('group copy names the group and how many, and never one member', () => {
  const g = { id: 'g1', name: 'Beach Crew', members: [{ favorite_activities: ['Museums & history'] }, {}, {}] };
  const { picks } = pickTrips(all, holdingsFor(), person({ group: g }), { max: 10 });
  assert.ok(picks.length);
  for (const p of picks) {
    assert.equal(p.who, 'Beach Crew · four of you');
    assert.equal(p.cost.each, true);
    assert.equal(p.groupId, 'g1');
    if (p.matched) assert.match(p.matched, /up in your group's answers\.$/);
  }
  assert.equal(whoFor(null), 'For you');
  assert.equal(matchedLine(['live music'], true), "Live music comes up in your group's answers.");
  assert.equal(matchedLine(['breweries'], true), "Breweries come up in your group's answers.");
  assert.equal(matchedLine(['live music', 'breweries'], false), "You said you're into live music and breweries.");
});

// ── Ranking ──────────────────────────────────────────────────────────────

test('a mix: the night out near home, a drive, a flight', () => {
  const { picks } = pickTrips(all, holdingsFor(), person());
  assert.deepEqual(picks.slice(0, 3).map(p => p.band), ['night', 'weekend', 'away']);
  const [night, weekend, away] = picks;
  assert.equal(night.destination.city, 'Raleigh');
  assert.equal(night.planType, 'restaurant');
  assert.equal(night.nights, 0);
  assert.equal(weekend.planType, 'weekend');
  assert.equal(weekend.nights, 2);
  assert.equal(away.planType, 'trip');
  assert.match(away.howFar, /a flight from RDU/);
  assert.match(weekend.howFar, /hours? by car$/);
});

test('the same rows give the same cards', () => {
  const a = pickTrips(all, holdingsFor(), person(), { max: 5 });
  const b = pickTrips([...all].reverse(), holdingsFor(), person(), { max: 5 });
  assert.deepEqual(a, b);
});

test('what they like decides between two towns', () => {
  const museums = town('Museumton', 35.2, -80.5);
  const music = town('Musicville', 35.3, -80.4);
  const hs = new Map([
    [raleigh.key, city(1)],
    [museums.key, held({ 'places to eat|restaurant': 50, 'museums & history|museum': 60 })],
    [music.key, held({ 'places to eat|restaurant': 50, 'live music|music venue': 60 })],
  ]);
  const fan = (a: string) => person({ me: { favorite_activities: [a], no_way_jose: [] } });
  const weekendFor = (a: string) => pickTrips([raleigh, museums, music], hs, fan(a)).picks.find(p => p.band === 'weekend')!.destination.city;
  assert.equal(weekendFor('Museums & history'), 'Museumton');
  assert.equal(weekendFor('Live music'), 'Musicville');
});

test('quiz v3 is read when present, and v2 answers stand in when not', () => {
  assert.deepEqual(leaningOf({ traveler_profile: { primary: 'taster', secondary: null, dials: { crowd: 20, pace: 50 }, unanswered: ['pace'] } }),
    { primary: 'taster', secondary: null, dials: { crowd: 20 } });
  assert.equal(leaningOf({ favorite_activities: ['Museums & history', 'Art & galleries', 'Breweries'] }).primary, 'storyteller');
  assert.equal(leaningOf({ traveler_profile: { primary: 'nonsense' } }).primary, null);
});

test('nothing already planned or dismissed is repeated', () => {
  const base = pickTrips(all, holdingsFor(), person(), { max: 10 }).picks.map(p => p.destination.city);
  assert.ok(base.includes('Asheville') && base.includes('Seattle'));
  const planned = plannedKeys([
    { destination_city: 'Asheville, NC', status: 'planning', type: 'weekend' },
    { destination_city: 'Charlotte', status: 'cancelled', type: 'weekend' },
  ], '2026-09-24');
  const { picks } = pickTrips(all, holdingsFor(), person({ planned, dismissed: new Set([seattle.key]) }), { max: 10 });
  const cities = picks.map(p => p.destination.city);
  assert.ok(!cities.includes('Asheville'), 'planned');
  assert.ok(!cities.includes('Seattle'), 'dismissed');
  assert.ok(cities.includes('Charlotte'), 'a cancelled plan is not a plan');
});

test('a night out in the home town survives a trip there, but not another night out already coming', () => {
  const p = plannedKeys([
    { destination_city: 'Raleigh', status: 'planning', type: 'weekend' },
    { destination_city: 'Durham', status: 'planning', type: 'restaurant', start_date: '2026-10-01' },
    { destination_city: 'Cary', status: 'planning', type: 'restaurant', start_date: '2026-09-01' },
  ], '2026-09-24');
  assert.ok(p.trips.has('raleigh') && !p.nights.has('raleigh'));
  assert.ok(p.nights.has('durham'));
  assert.ok(!p.nights.has('cary'), 'an evening that has happened is not in the way of another');
  const { picks } = pickTrips(all, holdingsFor(), person({ planned: p }));
  assert.equal(picks[0].destination.city, 'Raleigh');
});

test('everything dismissed says so, rather than that nothing is held', () => {
  const r = pickTrips(all, holdingsFor(), person({ dismissed: new Set(all.map(c => c.key)) }));
  assert.equal(r.picks.length, 0);
  assert.equal(r.reason, 'all_dismissed');
  assert.equal(pickTrips(all, holdingsFor(), person({ home: null })).reason, 'no_location');
  assert.equal(pickTrips([ghost], holdingsFor(), person()).reason, 'nothing_held');
});

// ── Budget and money ─────────────────────────────────────────────────────

test('the budget chips are read as the quiz saves them', () => {
  assert.equal(tierOf('Under $50'), 'under50');
  assert.equal(tierOf('$50 – $100'), '50to100');
  assert.equal(tierOf('$100 – $200'), '100to200');
  assert.equal(tierOf('$200 – $400'), '200to400');
  assert.equal(tierOf('$400+'), 'over400');
  assert.equal(tierOf('Depends entirely'), null);
  assert.equal(partyTier({ me: { budget_range: '$200 – $400' }, group: { id: 'g', name: 'g', members: [{ budget_range: 'Under $50' }] } }), 'under50');
});

test('a tight budget is not shown a week in Paris', () => {
  const rich = pickTrips(all, holdingsFor({ [seattle.key]: undefined }), person({ me: { favorite_activities: ['Live music'], budget_range: '$400+' } }), { max: 10 });
  assert.ok(rich.picks.some(p => p.destination.city === 'Paris'));
  const tight = pickTrips(all, holdingsFor({ [seattle.key]: undefined }), person({ me: { favorite_activities: ['Live music'], budget_range: 'Under $50' } }), { max: 10 });
  assert.ok(!tight.picks.some(p => p.destination.city === 'Paris'));
  assert.ok(estimate({ band: 'away', miles: 4000, nights: 7, party: 1, tier: 'under50', abroad: true }).low > 900);
});

test('Puerto Rico is a domestic flight from the mainland', () => {
  assert.equal(isAbroad({ country: 'PR' }, { homeCountry: 'US' }, 1400), false);
  assert.equal(isAbroad({ country: 'FR' }, { homeCountry: 'US' }, 4000), true);
});

// ── Candidates ───────────────────────────────────────────────────────────

test('counties, states, codes and blanks are not towns', () => {
  for (const n of ['Hoke County', 'Cumberland County', 'Puerto Rico', 'North Carolina', 'ABE', 'null', '', null]) {
    assert.equal(notATown(n as string), true, String(n));
  }
  for (const n of ['Raleigh', 'Washington', 'Aberdeen', 'St. Augustine']) assert.equal(notATown(n), false, n);
});

test('one suggestion per place, however many sources name it', () => {
  const c = candidatesFrom({
    world: [{ name: 'Paris', country: 'FR', lat: 48.8566, lng: 2.3522, rank: 6 }],
    seeds: [
      { name: 'Paris', lat: 48.8566, lng: 2.3522, region: 'europe/france/ile-de-france' },
      { name: 'Aberdeen', lat: 35.1315, lng: -79.4295, region: 'north-america/us/north-carolina' },
      { name: 'Southern Pines', lat: 35.1740, lng: -79.3923, region: 'north-america/us/north-carolina' },
      { name: 'Hoke County', lat: 35.0, lng: -79.2, region: 'north-america/us/north-carolina' },
      { name: 'San Juan', lat: 18.4655, lng: -66.1057, region: 'north-america/us/puerto-rico' },
    ],
    areas: [
      { city: 'Southern Pines, NC', lat: 35.2, lng: -79.4 },
      { city: 'Raleigh', lat: 35.8, lng: -78.6 },
    ],
  });
  const names = c.map(x => x.name);
  assert.deepEqual(names.filter(n => n === 'Paris'), ['Paris']);
  assert.ok(names.includes('Aberdeen'));
  assert.ok(!names.includes('Southern Pines'), 'the same box as Aberdeen');
  assert.ok(!names.includes('Hoke County'));
  assert.equal(c.find(x => x.name === 'Aberdeen')!.label, 'Aberdeen, North Carolina');
  assert.equal(c.find(x => x.name === 'San Juan')!.country, 'PR');
  assert.equal(c.find(x => x.name === 'Paris')!.label, 'Paris, France');
});

test('bands: home, a drive, a flight — and nothing in between', () => {
  assert.equal(bandFor(4), 'night');
  assert.equal(bandFor(35), null);
  assert.equal(bandFor(120), 'weekend');
  assert.equal(bandFor(900), 'away');
});

// ── The contract ─────────────────────────────────────────────────────────

test('every card matches the contract the Home screen reads with', () => {
  const g = { id: 'g1', name: 'Beach Crew', members: [{ no_way_jose: ['Clubs'] }] };
  for (const who of [person(), person({ group: g })]) {
    const { picks, reason } = pickTrips(all, holdingsFor(), who, { max: 5 });
    for (const p of picks) assert.ok(TripPickSchema.safeParse(p).success, p.title);
    const round = picksFrom(JSON.parse(JSON.stringify({ picks, reason, from: 'Raleigh' })));
    assert.deepEqual(round.picks, picks, 'nothing dropped between the route and the card');
    assert.equal(round.from, 'Raleigh');
  }
  // A malformed card is left out rather than drawn with a hole in it.
  const bad = picksFrom({ picks: [{ ref: 'trip:x' }], reason: null });
  assert.equal(bad.picks.length, 0);
});

test('the plan starts pointed at the town, with its kind, length and group', () => {
  const g = { id: 'g1', name: 'Beach Crew', members: [{}] };
  const away = pickTrips(all, holdingsFor(), person({ group: g })).picks.find(p => p.band === 'away')!;
  const seed = seedFromPick(away);
  assert.equal(seed.planType, 'trip');
  assert.equal(seed.where.city, away.destination.city);
  assert.equal(seed.where.country, away.destination.country);
  assert.equal(seed.nights, away.nights);
  assert.equal(seed.groupId, 'g1');
  assert.ok(!('startDate' in seed), 'dates are theirs to choose');
});

// ── Review findings, 2026-09-24 ──────────────────────────────────────────

test('a no-go we cannot check is said plainly, never passed over', () => {
  // The Raleigh user's own answers: cold weather and clubs.
  const g = { id: 'g1', name: 'Ali and Pete', members: [{ no_way_jose: ['Cold weather', 'Clubs'] }] };
  const { picks } = pickTrips(all, holdingsFor(), person({ group: g }), { max: 10 });
  const away = picks.filter(p => p.band !== 'night');
  assert.ok(away.length);
  for (const p of away) {
    assert.equal(p.unchecked, "Somebody in the group ruled out cold weather. Reach doesn't hold weather data yet, so trips away aren't checked for it.", p.title);
  }
  // The night out is the town they live in; nothing to warn about.
  assert.equal(picks.find(p => p.band === 'night')!.unchecked, null);
  // Solo, and two at once.
  assert.equal(uncheckedLine(['Cold weather', 'Big crowds'], false),
    "You ruled out cold weather and big crowds. Reach doesn't hold weather or crowd data yet, so trips away aren't checked for them.");
  // A no-go we can check is not listed as unchecked.
  assert.equal(uncheckedLine(['Clubs', 'Camping', 'Early mornings'], false), null);
  const none = pickTrips(all, holdingsFor(), person(), { max: 10 }).picks;
  assert.ok(none.every(p => p.unchecked === null));
});

test('long flights are checked from the distance, and the card says so', () => {
  const averse = person({ me: { favorite_activities: ['Live music'], no_way_jose: ['Long flights'] } });
  const { picks } = pickTrips(all, holdingsFor(), averse, { max: 10 });
  assert.ok(!picks.some(p => p.band === 'away' && p.miles > LONG_FLIGHT_MILES), 'Seattle and Paris are long flights');
  const near = town('Miami', 25.7617, -80.1918); // ~700 miles
  const r = pickTrips([...all, near], holdingsFor({ [near.key]: city(1) }), averse, { max: 10 });
  const miami = r.picks.find(p => p.destination.city === 'Miami')!;
  assert.equal(miami.band, 'away');
  assert.match(miami.leftOut ?? '', /Kept under 1,500 miles, since you ruled out long flights\./);
});

test('a folded town is named for where you live, and the counts say whose they are', () => {
  const c = candidatesFrom({
    world: [],
    seeds: [
      { name: 'Aberdeen', lat: 35.1315, lng: -79.4295, region: 'north-america/us/north-carolina' },
      { name: 'Southern Pines', lat: 35.1740, lng: -79.3923, region: 'north-america/us/north-carolina' },
    ],
    areas: [],
  });
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].aliases?.map(a => a.name), ['Southern Pines']);
  const hs = new Map([[c[0].key, city(1)]]);
  // Somebody at home in Southern Pines.
  const local = person({ home: { lat: 35.1740, lng: -79.3923 } });
  const night = pickTrips(c, hs, local).picks.find(p => p.band === 'night')!;
  assert.equal(night.title, 'A night out in Southern Pines');
  assert.equal(night.howFar, 'Where you are');
  assert.equal(night.destination.city, 'Southern Pines, North Carolina');
  assert.match(night.held, /we've checked around Southern Pines and Aberdeen$/);
  // From Raleigh, it keeps the first name and still says the box is shared.
  const weekend = pickTrips(c, hs, person()).picks.find(p => p.band === 'weekend')!;
  assert.equal(weekend.title, 'A weekend in Aberdeen');
  assert.match(weekend.held, /around Aberdeen and Southern Pines$/);
});

test('a plan elsewhere with the same name does not hide a town', () => {
  const portlandOR = { name: 'Portland', label: 'Portland, Oregon', lat: 45.5, lng: -122.7 };
  const aberdeenNC = { name: 'Aberdeen', label: 'Aberdeen, North Carolina', lat: 35.13, lng: -79.43 };
  const p = plannedKeys([
    { destination_city: 'Portland, ME', destination_country: 'US', status: 'planning', type: 'weekend' },
    { destination_city: 'Aberdeen', destination_country: 'GB', status: 'planning', type: 'trip' },
    { destination_city: 'Southern Pines, NC', destination_country: 'US', status: 'planning', type: 'weekend' },
  ], '2026-09-24');
  assert.equal(isPlanned(p.trips, portlandOR, 'US'), false, 'Maine is not Oregon');
  assert.equal(isPlanned(p.trips, { ...portlandOR, label: 'Portland, Maine' }, 'US'), true);
  assert.equal(isPlanned(p.trips, aberdeenNC, 'US'), false, 'Scotland is not North Carolina');
  // A plan under a folded town's name hides the card for the same box.
  const c = candidatesFrom({
    world: [],
    seeds: [
      { name: 'Aberdeen', lat: 35.1315, lng: -79.4295, region: 'north-america/us/north-carolina' },
      { name: 'Southern Pines', lat: 35.1740, lng: -79.3923, region: 'north-america/us/north-carolina' },
    ],
    areas: [],
  });
  const hs = new Map([[c[0].key, city(1)]]);
  assert.ok(pickTrips(c, hs, person()).picks.some(x => x.band === 'weekend'));
  assert.ok(!pickTrips(c, hs, person({ planned: p })).picks.some(x => x.band === 'weekend'));
});

test("the plan's Where carries the state, so it is geocoded where the card counted", () => {
  assert.equal(whereName({ name: 'Aberdeen', label: 'Aberdeen, North Carolina', lat: 0, lng: 0 }, 'US'), 'Aberdeen, North Carolina');
  assert.equal(whereName({ name: 'Paris', label: 'Paris, France', lat: 0, lng: 0 }, 'FR'), 'Paris');
  assert.equal(whereName({ name: 'Southern Pines', label: 'Southern Pines, NC', lat: 0, lng: 0 }, 'US'), 'Southern Pines, NC');
  assert.equal(whereName({ name: 'Raleigh', label: 'Raleigh', lat: 0, lng: 0 }, 'US'), 'Raleigh');
  const [c] = candidatesFrom({ world: [], seeds: [{ name: 'Aberdeen', lat: 35.1315, lng: -79.4295, region: 'north-america/us/north-carolina' }], areas: [] });
  const pick = pickTrips([c], new Map([[c.key, city(1)]]), person()).picks[0];
  assert.equal(seedFromPick(pick).where.city, 'Aberdeen, North Carolina');
});

test('dance schools are called dance studios, not places to dance', () => {
  const line = heldLine(tally(held({ 'places to eat|restaurant': 40, 'dancing|dancing school': 11 }), [], false), ['dancing']);
  assert.match(line, /11 dance studios/);
  assert.doesNotMatch(line, /places to dance/);
});

test('a card has room for a photo and draws without one', () => {
  const [p] = pickTrips(all, holdingsFor(), person()).picks;
  assert.equal(p.photo, null);
  const withPhoto = { ...p, photo: { url: 'https://example.org/a.jpg', alt: 'Raleigh skyline', credit: 'Somebody, CC BY-SA' } };
  assert.ok(TripPickSchema.safeParse(withPhoto).success);
  const { photo: _gone, ...without } = p;
  assert.ok(TripPickSchema.safeParse(without).success, 'optional, for a route that has not filled it');
});

test('a blended v3 profile is read through the scorer\'s own parser', () => {
  const l = leaningOf({ traveler_profile: { primary: 'taster', secondary: 'storyteller', dials: { pace: 40, novelty: 70, energy: 55, crowd: 30 }, unanswered: [] } });
  assert.deepEqual(l, { primary: 'taster', secondary: 'storyteller', dials: { pace: 40, novelty: 70, energy: 55, crowd: 30 } });
  // "A bit of everything" is a profile, not a missing one.
  assert.deepEqual(leaningOf({ traveler_profile: { primary: null, secondary: null, dials: {}, unanswered: ['pace', 'novelty', 'energy', 'crowd'] }, favorite_activities: ['Breweries'] }),
    { primary: null, secondary: null, dials: {} });
});
