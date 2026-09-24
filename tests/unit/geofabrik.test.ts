// Which Geofabrik file holds a point, answered from the index's polygons —
// a handful of squares here instead of the four-megabyte index.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeofabrikMap, regionsForTown, type GeofabrikIndex } from '../../lib/discovery/geofabrik.ts';
import { GEOFABRIK_REGIONS, REGION_MB } from '../../lib/discovery/geofabrik-regions.generated.ts';
import { baseRegions, knownRegions, legacyRegions, probePoints } from '../../lib/discovery/regions.ts';

/** A lng/lat box as a GeoJSON polygon. */
const box = (w: number, s: number, e: number, n: number) => ({
  type: 'Polygon',
  coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
});
const extract = (path: string, geometry: ReturnType<typeof box>, iso?: string[]) => ({
  properties: {
    id: path.split('/').pop()!,
    ...(iso ? { 'iso3166-1:alpha2': iso } : {}),
    urls: { pbf: `https://download.geofabrik.de/${path}-latest.osm.pbf` },
  },
  geometry,
});

const INDEX: GeofabrikIndex = {
  features: [
    extract('north-america', box(-170, 5, -50, 85)),
    extract('north-america/us', box(-125, 32.5, -66, 50), ['US']),
    extract('north-america/us/north-carolina', box(-84.3, 33.8, -75.4, 36.588)),
    extract('north-america/us/virginia', box(-83.7, 36.588, -75.2, 39.5)),
    extract('north-america/us/california', box(-124.5, 32.5, -114.1, 42)),
    extract('north-america/us/california/socal', box(-121, 32.5, -114.1, 35.8)),
    extract('north-america/us-northeast', box(-80.6, 38, -60, 48)),
    extract('north-america/mexico', box(-118, 14, -86, 32.5), ['MX']),
    extract('asia', box(25, -12, 180, 82)),
    extract('asia/north-korea', box(124, 38, 131, 43), ['KP']),
    extract('asia/south-korea', box(124, 33, 131, 38), ['KR']),
    extract('asia/china', box(73, 18, 135, 54), ['CN']),
    extract('asia/china/guangdong', box(109.6, 20.2, 117.3, 25.5)),
    extract('asia/china/hong-kong', box(113.8, 22.15, 114.5, 22.56)),
  ],
};
const LEGACY = ['north-america/us/north-carolina', 'north-america/us/virginia', 'north-america/us/california', 'north-america/mexico'];
const map = new GeofabrikMap(INDEX, LEGACY);

test('a point is in the smallest file that holds it', () => {
  assert.equal(map.regionAt(35.78, -78.64), 'north-america/us/north-carolina');
  assert.equal(map.regionAt(22.3, 114.17), 'asia/china/hong-kong', 'not Guangdong, not China');
  assert.equal(map.regionAt(23.13, 113.26), 'asia/china/guangdong');
});

test('where regions.ts files a country its own way, that file wins over a smaller piece', () => {
  // San Diego is in Southern California's file too; the load reads California.
  assert.equal(map.regionAt(32.72, -117.16), 'north-america/us/california');
});

test('an overlay is never read where a country holds the point, and a continent never at all', () => {
  // Inside US Northeast and inside Virginia: Virginia.
  assert.equal(map.regionAt(38.9, -77.4), 'north-america/us/virginia');
  // Out at sea, inside only US Northeast and the continent: nothing. The
  // overlay would load every state in it a second time.
  assert.equal(map.regionAt(40, -63), null);
  // Inside only the continent.
  assert.equal(map.regionAt(60, -150), null);
});

test('inside a split country but in none of its pieces is nothing, not the whole country', () => {
  assert.equal(map.regionAt(45, -100), null);
});

test('North Korea is never read', () => {
  assert.equal(map.regionAt(39.03, 125.75), null);
});

test('a file has the countries the index gives it, or its nearest ancestor\'s, or the table\'s', () => {
  assert.deepEqual(map.countriesOf('north-america/us/north-carolina'), ['US']);
  assert.deepEqual(map.countriesOf('asia/china/guangdong'), ['CN']);
  assert.deepEqual(map.countriesOf('asia/china/hong-kong'), ['HK'], 'entered separately from China');
});

test('a town\'s circle reaches the files beside it inside its own country, never across a border', () => {
  // Near the North Carolina–Virginia line: both states are read.
  const roanokeRapids = { lat: 36.46, lng: -77.65 };
  const nc = regionsForTown(map, roanokeRapids, probePoints(roanokeRapids.lat, roanokeRapids.lng, 30), 'US');
  assert.deepEqual(nc.regions, ['north-america/us/north-carolina', 'north-america/us/virginia']);
  // San Diego's thirty miles reach Tijuana. Mexico is not read on its word.
  const sd = { lat: 32.72, lng: -117.16 };
  const out = regionsForTown(map, sd, probePoints(sd.lat, sd.lng, 30), 'US');
  assert.deepEqual(out.regions, ['north-america/us/california']);
  assert.deepEqual(out.abroad, ['north-america/mexico']);
  // Hong Kong is "cn" to Nominatim, but its own file says HK: Guangdong is abroad.
  const hk = { lat: 22.3, lng: 114.17 };
  const h = regionsForTown(map, hk, probePoints(hk.lat, hk.lng, 30), 'CN');
  assert.deepEqual(h.regions, ['asia/china/hong-kong']);
  assert.ok(h.abroad.includes('asia/china/guangdong'));
  // Seoul's circle crosses the DMZ; the north is not even "abroad", it is nothing.
  const seoul = { lat: 37.9, lng: 126.98 };
  assert.deepEqual(regionsForTown(map, seoul, probePoints(seoul.lat, seoul.lng, 30), 'KR').regions, ['asia/south-korea']);
});

test('the files the load may read are exactly the ones regionAt could pick', () => {
  assert.deepEqual(map.loadable(), [
    'asia/china/guangdong', 'asia/china/hong-kong', 'asia/south-korea',
    'north-america/mexico', 'north-america/us/california', 'north-america/us/north-carolina', 'north-america/us/virginia',
  ]);
});

// ── The committed table, written from the real index ──────────────────

test('every base region is a file the load may read, and has a size', () => {
  const known = new Set(knownRegions());
  for (const r of baseRegions()) {
    assert.ok(known.has(r), `${r} is not in geofabrik-regions.generated.ts`);
    assert.ok(Number(REGION_MB[r]) > 0, `${r} has no size`);
  }
  for (const r of legacyRegions()) assert.ok(known.has(r), r);
});

test('the committed table never offers a continent, a split country, an overlay or North Korea', () => {
  const known = new Set(knownRegions());
  for (const bad of ['europe', 'asia', 'north-america', 'north-america/us', 'europe/france', 'europe/germany',
    'north-america/us-northeast', 'europe/dach', 'europe/alps', 'asia/north-korea', 'north-america/us/california/socal']) {
    assert.equal(known.has(bad), false, bad);
  }
  // Every file has at least one country, which the menu's border check needs.
  const silent = Object.entries(GEOFABRIK_REGIONS).filter(([, cs]) => !cs.length).map(([r]) => r);
  assert.deepEqual(silent, []);
  assert.ok(known.size > 300, `only ${known.size} files: the table was cut short`);
});

// ── The index's own country codes are not trusted blind ────────────────

test('a code the index gives two unrelated files is reported, until COUNTRY_OF settles it', () => {
  const wrong = new GeofabrikMap({ features: [
    extract('australia-oceania/vanuatu', box(166, -21, 171, -13), ['VU']),
    extract('australia-oceania/tonga', box(-176, -23, -173, -15), ['VU']),
    extract('australia-oceania/marshall-islands', box(160, 4, 173, 15), ['MH']),
    extract('australia-oceania/nauru', box(166.8, -0.6, 167, -0.5), ['MH']),
    extract('north-america/us', box(-125, 32.5, -66, 50), ['US']),
    extract('north-america/us/texas', box(-107, 25, -93, 37), ['US']),
  ] });
  assert.deepEqual(wrong.sharedCodes(), [
    { code: 'MH', paths: ['australia-oceania/marshall-islands', 'australia-oceania/nauru'] },
    { code: 'VU', paths: ['australia-oceania/tonga', 'australia-oceania/vanuatu'] },
  ], 'a state inside its own country sharing the code is not a mistake');
  // The files Geofabrik got wrong on 2026-09-24 are settled in COUNTRY_OF.
  const real = new GeofabrikMap({ features: [
    extract('australia-oceania/vanuatu', box(166, -21, 171, -13), ['VU']),
    extract('australia-oceania/polynesie-francaise', box(-155, -28, -134, -7), ['VU']),
    extract('australia-oceania/american-oceania', box(144, -15, -168, 21), ['VU']),
    extract('australia-oceania/marshall-islands', box(160, 4, 173, 15), ['MH']),
    extract('australia-oceania/pitcairn-islands', box(-131, -26, -124, -23), ['MH']),
  ] });
  assert.deepEqual(real.sharedCodes(), []);
  assert.deepEqual(real.countriesOf('australia-oceania/polynesie-francaise'), ['PF']);
});

test('the committed table gives Vanuatu\'s and the Marshall Islands\' codes to them alone', () => {
  const holding = (c: string) => Object.entries(GEOFABRIK_REGIONS).filter(([, codes]) => codes.includes(c)).map(([p]) => p);
  assert.deepEqual(holding('VU'), ['australia-oceania/vanuatu']);
  assert.deepEqual(holding('MH'), ['australia-oceania/marshall-islands']);
  assert.deepEqual(GEOFABRIK_REGIONS['australia-oceania/polynesie-francaise'], ['PF']);
  assert.deepEqual(GEOFABRIK_REGIONS['australia-oceania/wallis-et-futuna'], ['WF']);
  assert.deepEqual(GEOFABRIK_REGIONS['australia-oceania/ile-de-clipperton'], ['FR']);
  assert.deepEqual(GEOFABRIK_REGIONS['australia-oceania/american-oceania'], ['AS', 'GU', 'MP', 'UM']);
  assert.deepEqual(GEOFABRIK_REGIONS['australia-oceania/tokelau'], ['TK']);
  assert.deepEqual(GEOFABRIK_REGIONS['australia-oceania/pitcairn-islands'], ['PN']);
});
