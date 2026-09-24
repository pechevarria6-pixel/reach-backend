// The world list: the most visited cities and the Seven Wonders' towns, and
// the Geofabrik files each is read from.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLD_DESTINATIONS, WONDER_SITES, worldDestination, siteBase, siteTown } from '../../lib/discovery/world-destinations.ts';
import { WORLD_REGIONS, WORLD_REGION_MB } from '../../lib/discovery/world-regions.generated.ts';
import {
  knownRegions, legacyRegions, regionFor, geofabrikUrl, worldSeeds, worldTownFor, dedupeSeeds, SEED_RADIUS_MILES,
} from '../../lib/discovery/regions.ts';
import { haversineMiles } from '../../lib/discovery/distance.ts';

/** How far the itinerary menu reads around a plan's city (real-places.ts RINGS_MILES). */
const MENU_MILES = 25;

test("the cities are Euromonitor's top fifty, in its order, and nothing else is ranked", () => {
  const ranked = WORLD_DESTINATIONS.filter(d => d.rank != null);
  assert.deepEqual(ranked.map(d => d.rank), Array.from({ length: 50 }, (_, i) => i + 1));
  // Spot checks against the source table (2019 edition, 2018 arrivals).
  const at = (n: number) => ranked.find(d => d.rank === n)!.name;
  assert.equal(at(1), 'Hong Kong');
  assert.equal(at(2), 'Bangkok');
  assert.equal(at(26), 'Agra');
  assert.equal(at(40), 'Cancún');
  assert.equal(at(50), 'Dublin');
});

test('every entry is a real point with a country, and none is at Null Island', () => {
  for (const d of WORLD_DESTINATIONS) {
    assert.match(d.country, /^[A-Z]{2}$/, d.name);
    assert.ok(Number.isFinite(d.lat) && Math.abs(d.lat) <= 90, d.name);
    assert.ok(Number.isFinite(d.lng) && Math.abs(d.lng) <= 180, d.name);
    assert.ok(Math.abs(d.lat) > 0.5 || Math.abs(d.lng) > 0.5, `${d.name} is at Null Island`);
  }
});

test('each town is in the list once per country', () => {
  const keys = WORLD_DESTINATIONS.map(d => `${d.name.toLowerCase()}|${d.country}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('all seven New Wonders and the Great Pyramid have a town to sleep in', () => {
  const sites = new Set(WORLD_DESTINATIONS.map(d => d.site).filter(Boolean));
  for (const wonder of ['Chichén Itzá', 'Christ the Redeemer', 'Colosseum', 'Machu Picchu', 'Petra', 'Taj Mahal', 'Great Pyramid of Giza']) {
    assert.ok(sites.has(wonder), wonder);
  }
  assert.ok([...sites].some(s => String(s).startsWith('Great Wall of China')), 'Great Wall');
  for (const s of sites) assert.ok(WONDER_SITES[s as string], `${s} has no point to measure from`);
});

test('every wonder is within the menu of at least one of its towns, so a trip there can name what is at it', () => {
  const bySite = new Map<string, number[]>();
  for (const d of WORLD_DESTINATIONS) {
    if (!d.site) continue;
    const key = d.site.replace(/ \(.*\)$/, '');
    const site = WONDER_SITES[d.site];
    bySite.set(key, [...(bySite.get(key) ?? []), haversineMiles(d, site)]);
  }
  for (const [site, miles] of bySite) {
    assert.ok(Math.min(...miles) <= MENU_MILES, `${site}: nearest town is ${Math.min(...miles).toFixed(1)} miles away`);
  }
  // The two towns that are not beside their wonder are there for a reason:
  // Cusco is Machu Picchu's airport, fifty miles off; Beijing is the city.
  const cusco = WORLD_DESTINATIONS.find(d => d.name === 'Cusco')!;
  assert.ok(haversineMiles(cusco, WONDER_SITES['Machu Picchu']) > MENU_MILES);
});

test('every destination was matched to Geofabrik files, the town’s own first', () => {
  for (const d of WORLD_DESTINATIONS) {
    const regions = WORLD_REGIONS[d.name];
    assert.ok(regions?.length, `${d.name} has no region — run scripts/ingest/world-regions.mjs`);
    assert.equal(new Set(regions).size, regions.length, `${d.name} names a file twice`);
  }
  assert.deepEqual(Object.keys(WORLD_REGIONS).sort(), WORLD_DESTINATIONS.map(d => d.name).sort(), 'no region for a town that left the list');
});

// Ingest and the itinerary menu both filter by distance alone, so every file
// a world seed reads is a file whose venues can be named as "nearby". A
// circle that crosses a border must not read the far side: Petra's reaches
// the Israeli Arava across a closed border, Singapore's reaches Batam across
// a ferry and a passport, Hong Kong's reaches Guangdong and a mainland visa.
test("a world seed reads only its own country's files, whatever its circle crosses", () => {
  const abroad: Record<string, RegExp> = {
    'Wadi Musa': /^asia\/israel-and-palestine$/,
    'Singapore': /^asia\/indonesia\//,
    'Johor Bahru': /^asia\/indonesia\//,
    'Hong Kong': /^asia\/china\/(?!hong-kong$)/,
    'Macau': /^asia\/china\/(?!macau$)/,
    'Shenzhen': /^asia\/china\/(hong-kong|macau)$/,
    'Seoul': /^asia\/north-korea$/,
    'Vienna': /^europe\/(slovakia|hungary|czech-republic)/,
  };
  for (const [town, far] of Object.entries(abroad)) {
    for (const r of WORLD_REGIONS[town]) assert.doesNotMatch(r, far, `${town} reads ${r}, across a border`);
  }
  // In general: every file after the first sits beside it in the same country.
  for (const d of WORLD_DESTINATIONS) {
    const [centre, ...rest] = WORLD_REGIONS[d.name];
    const country = centre.split('/').slice(0, -1).join('/');
    for (const r of rest) {
      assert.ok(country.includes('/') && r.startsWith(`${country}/`), `${d.name}: ${r} is not in ${centre}'s country`);
    }
  }
});

test('a world region is a file, never a continent, an overlay, or a country Geofabrik splits', () => {
  const all = new Set(Object.values(WORLD_REGIONS).flat());
  for (const r of all) {
    assert.match(geofabrikUrl(r), /^https:\/\/download\.geofabrik\.de\/[a-z-]+(\/[a-z-]+)+-latest\.osm\.pbf$/, r);
    assert.doesNotMatch(r, /^(north-america\/us|europe\/(france|germany|italy|spain)|asia\/(india|japan|china|indonesia)|south-america\/brazil|russia)$/, `${r} is a whole split country`);
    assert.doesNotMatch(r, /\/(us-(northeast|midwest|south|west|pacific)|alps|dach|britain-and-ireland|great-britain)$/, `${r} is an overlay`);
    assert.notEqual(r, 'asia/north-korea', 'nothing across the DMZ is somewhere to go');
  }
  // The big countries are read by the piece that holds the town.
  assert.deepEqual(WORLD_REGIONS['Paris'][0], 'europe/france/ile-de-france');
  assert.deepEqual(WORLD_REGIONS['Tokyo'][0], 'asia/japan/kanto');
  assert.deepEqual(WORLD_REGIONS['Rome'][0], 'europe/italy/centro');
  assert.deepEqual(WORLD_REGIONS['Rio de Janeiro'][0], 'south-america/brazil/sudeste');
  assert.deepEqual(WORLD_REGIONS['Agra'][0], 'asia/india/central-zone');
  assert.deepEqual(WORLD_REGIONS['Beijing'][0], 'asia/china/beijing');
  assert.deepEqual(WORLD_REGIONS['Wadi Musa'][0], 'asia/jordan');
  assert.deepEqual(WORLD_REGIONS['Cusco'], ['south-america/peru']);
});

test('where regions.ts already files a country, the world list uses the same file', () => {
  const legacy = new Set(legacyRegions());
  for (const d of WORLD_DESTINATIONS.filter(x => ['US', 'GB', 'MX'].includes(x.country))) {
    assert.ok(legacy.has(WORLD_REGIONS[d.name][0]), `${d.name}: ${WORLD_REGIONS[d.name][0]}`);
  }
  assert.deepEqual(WORLD_REGIONS['Los Angeles'], ['north-america/us/california'], 'not Southern California beside it');
  assert.deepEqual(WORLD_REGIONS['London'], ['europe/united-kingdom/england'], 'not Greater London beside it');
  assert.equal(WORLD_REGIONS['Cancún'][0], regionFor({ countryCode: 'mx' }));
});

test('every world region is one the workflow will accept, and the old ones still are', () => {
  const known = new Set(knownRegions());
  for (const r of Object.values(WORLD_REGIONS).flat()) assert.ok(known.has(r), r);
  for (const r of legacyRegions()) assert.ok(known.has(r), r);
  assert.ok(known.has('north-america/us/north-carolina'));
  // regionFor itself still guesses nothing new.
  assert.equal(regionFor({ countryCode: 'fr', subdivision: 'FR-IDF' }), null);
});

test('each file was sized when it was matched, and only the two known giants are over a gigabyte', () => {
  for (const r of new Set(Object.values(WORLD_REGIONS).flat())) {
    assert.ok(Number.isFinite(WORLD_REGION_MB[r]) && WORLD_REGION_MB[r] > 0, `${r} has no size`);
  }
  const big = Object.entries(WORLD_REGION_MB).filter(([, mb]) => mb > 1000).map(([r]) => r).sort();
  assert.deepEqual(big, ['europe/united-kingdom/england', 'north-america/us/california']);
});

test('the world list becomes one seed per town per file, from its own coordinates', () => {
  const seeds = worldSeeds();
  const expected = Object.values(WORLD_REGIONS).reduce((n, r) => n + r.length, 0);
  assert.equal(seeds.length, expected);
  assert.ok(seeds.every(s => s.source === 'world'));
  const wadi = seeds.filter(s => s.name === 'Wadi Musa');
  assert.deepEqual(wadi.map(s => s.region), WORLD_REGIONS['Wadi Musa']);
  assert.ok(wadi.every(s => s.lat === 30.3222 && s.lng === 35.4792));
  assert.equal(dedupeSeeds(seeds).length, seeds.length, 'no two world seeds collide');
});

test("a plan's Cancun and the world list's Cancún are one row: the plan's spelling, both sources", () => {
  const plan = { name: 'Cancun', lat: 21.17, lng: -86.85, region: 'north-america/mexico', source: 'plan' };
  const rows = dedupeSeeds([plan, ...worldSeeds().filter(s => s.name === 'Cancún')]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Cancun');
  assert.equal(rows[0].source, 'plan,world');
});

test('a placed plan joins a world town only where it is: Paris, France, not Paris, Texas', () => {
  assert.equal(worldTownFor({ name: 'Paris', lat: 48.86, lng: 2.34 })?.country, 'FR');
  assert.equal(worldTownFor({ name: 'Paris', lat: 33.66, lng: -95.56 }), null);
  assert.equal(worldTownFor({ name: 'Paris', lat: null, lng: null }), null);
});

test("a plan's city finds its world town by name and country, and a namesake is not it", () => {
  assert.equal(worldDestination('Valladolid', 'MX')?.site, 'Chichén Itzá');
  assert.equal(worldDestination('Valladolid', 'ES'), null, 'the Spanish one is somewhere else');
  assert.equal(worldDestination('Cusco, Peru', 'PE')?.name, 'Cusco');
  assert.equal(worldDestination('cancun', null)?.name, 'Cancún', 'accents and case folded');
  assert.equal(worldDestination('PISTE', 'mx')?.name, 'Pisté');
  assert.equal(worldDestination('Fayetteville', 'US'), null);
  assert.equal(worldDestination('', 'US'), null);
});

test('a world seed reads as far around its town as every other seed', () => {
  assert.equal(SEED_RADIUS_MILES, 30, 'world-regions.mjs probed thirty-mile circles; re-run it if this changes');
});

test('a plan to a wonder is a plan to the towns people sleep in to see it', () => {
  const names = (city: string, cc?: string) => siteBase(city, cc).map(d => d.name).sort();
  assert.deepEqual(names('Machu Picchu'), ['Aguas Calientes', 'Cusco']);
  assert.deepEqual(names('Petra, Jordan'), ['Wadi Musa']);
  assert.deepEqual(names('Chichen Itza', 'MX'), ['Pisté', 'Valladolid']);
  assert.deepEqual(names('Chichén Itzá'), ['Pisté', 'Valladolid'], 'accents folded');
  assert.deepEqual(names('Taj Mahal'), ['Agra']);
  assert.deepEqual(names('Colosseum'), ['Rome']);
  assert.deepEqual(names('Christ the Redeemer'), ['Rio de Janeiro']);
  assert.deepEqual(names('Great Wall'), ['Beijing', 'Huairou']);
  assert.deepEqual(names('Pyramids of Giza'), ['Giza']);
});

test('a site name is not guessed where the country says otherwise, and a town is not a site', () => {
  assert.deepEqual(siteBase('Petra', 'GR'), [], 'Petra, GR is a village on Lesbos');
  assert.deepEqual(siteBase('Paris', 'FR'), []);
  assert.deepEqual(siteBase('Rome'), [], 'the town itself goes to the geocoder and the world list as before');
  assert.deepEqual(siteBase(''), []);
});

test('a menu for a wonder is read around the base town nearest it', () => {
  assert.equal(siteTown('Machu Picchu')?.name, 'Aguas Calientes', 'at its foot, not Cusco fifty miles off');
  assert.equal(siteTown('Great Wall of China')?.name, 'Huairou', 'beside Mutianyu, not central Beijing');
  assert.equal(siteTown('Chichen Itza')?.name, 'Pisté');
  assert.equal(siteTown('Petra')?.name, 'Wadi Musa');
  assert.equal(siteTown('Lisbon'), null);
});
