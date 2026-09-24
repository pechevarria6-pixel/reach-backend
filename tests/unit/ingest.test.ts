// The weekly map load, driven with a handful of made-up features and a fake
// database instead of a four-hundred-megabyte download.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  interestsFor, osmiumFilters, rowsFor, dedupeRows, shapeBatches, goneVenues,
  trustworthyRun, looksLikePbf, countPerSeed, ingestRegion, earlierDownloadBefore, runVerdict, seedsCovering, MAX_FAILED_ROWS,
  type MapFeature, type IngestDb, type DbResult,
} from '../../lib/discovery/ingest.ts';
import { mappableKinds, kindFor, QUIZ_CUISINES } from '../../lib/discovery/taste.ts';
import { matchesSelector, tagsFor } from '../../lib/discovery/osm.ts';
import type { Seed } from '../../lib/discovery/regions.ts';
import { GeofabrikMap, countriesAt, regionsForTown } from '../../lib/discovery/geofabrik.ts';
import { callingCountries } from '../../lib/discovery/phone.ts';
import { acrossTheBorder } from '../../lib/discovery/real-places.ts';

const REGION = 'north-america/us/north-carolina';
const RALEIGH: Seed = { name: 'Raleigh', lat: 35.7796, lng: -78.6382, region: REGION, radius_miles: 30, source: 'plan' };
const SEEN = '2026-09-28T06:17:00.000Z';

const feature = (id: number, tags: Record<string, string>, at: [number, number] = [-78.639, 35.779], type = 'node'): MapFeature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: at },
  properties: { '@type': type, '@id': id, ...tags },
});

/** Tags that satisfy one Overpass selector, e.g. `amenity=bar][live_music~"yes|regular",i`. */
function tagsSatisfying(selector: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const part of selector.split('][')) {
    const pattern = /^([^=~]+)~"(.*)",i$/.exec(part);
    if (pattern) { tags[pattern[1]] = `${pattern[2].split('|')[0]}`; continue; }
    if (!part.includes('=')) { tags[part] = 'Something'; continue; }
    const [k, v] = part.split('=');
    tags[k] = v;
  }
  return tags;
}

// ── Tag → kind parity with the sweep ──────────────────────────────────

test('every place the sweep would file under a kind, the load files under the same kind', () => {
  const kinds = [...mappableKinds(), ...QUIZ_CUISINES.map(c => kindFor(`${c} restaurants`))];
  let checked = 0;
  for (const k of kinds) {
    for (const sel of tagsFor(k.key)) {
      const tags: Record<string, string> = { name: 'Somewhere', website: 'https://somewhere.example', ...tagsSatisfying(sel) };
      // The sweep's own test: the selector it sends to Overpass matches.
      assert.ok(matchesSelector(sel, tags), `${sel} should match its own tags`);
      // The load files it under the same words — unless it is lodging, which
      // is only ever lodging.
      const filed = interestsFor(tags);
      if (tags.tourism && ['hotel', 'guest_house', 'hostel', 'motel', 'apartment'].includes(tags.tourism)) {
        assert.deepEqual(filed, ['places to stay'], sel);
      } else {
        assert.ok(filed.includes(k.key), `${sel} filed as ${JSON.stringify(filed)}, not "${k.key}"`);
      }
      checked++;
    }
  }
  assert.ok(checked > 40, `only ${checked} selectors checked`);
});

test('osmium keeps everything a selector could match, so nothing is lost before the rules run', () => {
  const filters = osmiumFilters();
  const kinds = [...mappableKinds(), ...QUIZ_CUISINES.map(c => kindFor(`${c} restaurants`))];
  for (const k of kinds) {
    for (const sel of tagsFor(k.key)) {
      const [key, value] = sel.split('][')[0].split('=');
      const line = filters.find(f => f.startsWith(`nwr/${key}=`));
      assert.ok(line && line.slice(`nwr/${key}=`.length).split(',').includes(value), `${sel} is not kept by osmium`);
    }
  }
  // The four the brief names, and every kind of lodging.
  const all = filters.join(' ');
  for (const v of ['bar', 'cafe', 'pub', 'restaurant']) assert.match(all, new RegExp(`amenity=[^ ]*\\b${v}\\b`));
  for (const v of ['hotel', 'guest_house', 'hostel', 'motel', 'apartment']) assert.match(all, new RegExp(`tourism=[^ ]*\\b${v}\\b`));
});

test('a cuisine is filed the way Discover looks it up', () => {
  assert.deepEqual(interestsFor({ amenity: 'restaurant', cuisine: 'thai;vietnamese' }), ['places to eat', 'thai restaurants']);
  assert.ok(interestsFor({ amenity: 'restaurant', cuisine: 'vegan' }).includes('veggie restaurants'));
});

test('a hotel with a restaurant on the same point is somewhere to sleep, not dinner', () => {
  assert.deepEqual(interestsFor({ tourism: 'hotel', amenity: 'restaurant', cuisine: 'thai' }), ['places to stay']);
});

test('an unnamed memorial is not history, a named one is', () => {
  assert.deepEqual(interestsFor({ historic: 'memorial' }), []);
  assert.deepEqual(interestsFor({ historic: 'memorial', name: 'Vietnam Veterans Memorial' }), ['museums & history']);
});

// ── The name-and-website rule ─────────────────────────────────────────

test('no website, no row; no name, no row', () => {
  assert.deepEqual(rowsFor(feature(1, { name: 'Diner', amenity: 'restaurant' }), REGION, SEEN), { skip: 'no_website' });
  assert.deepEqual(rowsFor(feature(2, { amenity: 'bar', website: 'https://x.example' }), REGION, SEEN), { skip: 'no_name' });
});

test('a website under any of its three tags counts, and becomes a link', () => {
  for (const key of ['website', 'contact:website', 'url']) {
    const out = rowsFor(feature(3, { name: 'Café Uno', amenity: 'cafe', [key]: 'cafe-uno.example' }), REGION, SEEN);
    assert.ok('rows' in out, key);
    assert.equal(out.rows[0].website, 'https://cafe-uno.example');
  }
});

test('a place far from every seed is written: the region is read whole', () => {
  // Charlotte, 130 miles from Raleigh. The circles used to throw it away, and
  // a town nobody had planned yet held nothing however much the map knew.
  const charlotte = feature(4, { name: 'Taproom', amenity: 'pub', website: 'https://t.example' }, [-80.8431, 35.2271]);
  const out = rowsFor(charlotte, REGION, SEEN);
  assert.ok('rows' in out, JSON.stringify(out));
  assert.deepEqual(out.rows.map(r => r.interest), ['pubs']);
  assert.equal(out.rows[0].region, REGION);
});

test('a caterer carries the tag and is still not a night out', () => {
  const out = rowsFor(feature(5, { name: 'Party Caterers', amenity: 'restaurant', website: 'https://c.example' }), REGION, SEEN);
  assert.deepEqual(out, { skip: 'cannot_turn_up' });
});

test('a row carries the phone as a dialable number, the hours, the street and the map\'s own town', () => {
  const out = rowsFor(feature(6, {
    name: 'Lemongrass Thai', amenity: 'restaurant', cuisine: 'thai', website: 'lemongrass.example',
    phone: '(919) 555-0101', opening_hours: 'Mo-Sa 11:00-22:00; Su off',
    'addr:housenumber': '118', 'addr:street': 'S Wilmington St', 'addr:city': 'Raleigh', fixme: 'check',
  }), REGION, SEEN);
  assert.ok('rows' in out);
  const row = out.rows[0];
  assert.match(String(row.phone), /^\+1\s?919/);
  assert.equal(row.opening_hours, 'Mo-Sa 11:00-22:00; Su off');
  assert.equal(row.street, '118 S Wilmington St');
  assert.equal(row.city, 'Raleigh');
  assert.equal(row.region, REGION);
  assert.equal(row.last_seen_at, SEEN);
  assert.equal(row.gone_at, null);
  assert.deepEqual(row.osm_tags, { cuisine: 'thai' }, 'mapping bookkeeping stays out');
  assert.equal(row.harvest_status, 'skip', 'a restaurant site is a menu, not a class list');
});

test('a place with no phone leaves the phone column out of the write entirely', () => {
  const out = rowsFor(feature(7, { name: 'Quiet Bar', amenity: 'bar', website: 'https://q.example' }), REGION, SEEN);
  assert.ok('rows' in out);
  assert.equal('phone' in out.rows[0], false);
  assert.equal('city' in out.rows[0], false, 'never the nearest seed\'s name');
});

// ── Dedupe and batching ───────────────────────────────────────────────

test('one row per place per interest, whatever osmium exported twice', () => {
  const a = { osm_type: 'way', osm_id: 1, interest: 'places to eat', n: 1 };
  const b = { osm_type: 'way', osm_id: 1, interest: 'places to eat', n: 2 };
  const c = { osm_type: 'way', osm_id: 1, interest: 'thai restaurants', n: 3 };
  const d = { osm_type: 'node', osm_id: 1, interest: 'places to eat', n: 4 };
  assert.deepEqual(dedupeRows([a, b, c, d]).map(r => r.n), [1, 3, 4]);
});

test('a batch never mixes rows with and without a phone', () => {
  const rows = [
    { osm_id: 1, name: 'a', phone: '+19195550101' },
    { osm_id: 2, name: 'b' },
    { osm_id: 3, name: 'c', phone: '+19195550103' },
    { osm_id: 4, name: 'd' },
  ];
  const batches = shapeBatches(rows, 500);
  assert.equal(batches.length, 2);
  for (const batch of batches) {
    const shapes = new Set(batch.map(r => Object.keys(r).sort().join(',')));
    assert.equal(shapes.size, 1);
  }
  assert.equal(shapeBatches(rows.filter(r => r.phone), 1).length, 2, 'chunked by size');
});

// ── When a place has gone ─────────────────────────────────────────────

const held = (id: string, seen: string | null, at = { lat: 35.78, lng: -78.64 }) => ({ id, ...at, last_seen_at: seen });

test('missed by one run is not gone; missed by two is', () => {
  const lastRun = '2026-09-21T06:17:00.000Z';
  const venues = [
    held('seen-last-week', '2026-09-21T06:30:00.000Z'),
    held('missed-twice', '2026-09-14T06:30:00.000Z'),
    held('never-seen-by-a-run', null),
    // The whole file was read, so a place far from every town was looked
    // for too, and missing twice means gone there as much as in Raleigh.
    held('far-from-every-seed', '2026-09-14T06:30:00.000Z', { lat: 35.2271, lng: -80.8431 }),
  ];
  assert.deepEqual(goneVenues(venues, lastRun), ['missed-twice', 'far-from-every-seed']);
});

test('the first run ever retires nothing', () => {
  assert.deepEqual(goneVenues([held('x', '2020-01-01T00:00:00Z')], null), []);
});

test('a run that kept under half of last time is not believed', () => {
  assert.equal(trustworthyRun(0, null), false);
  assert.equal(trustworthyRun(10, null), true);
  assert.equal(trustworthyRun(400, 1000), false);
  assert.equal(trustworthyRun(600, 1000), true);
});

test('an HTML page is not a PBF, whatever the status code said', () => {
  const pbf = new Uint8Array([0, 0, 0, 0x0d, 0x0a, 0x09, ...Buffer.from('OSMHeader'), 0x18, 0x7c]);
  assert.equal(looksLikePbf(pbf), true);
  assert.equal(looksLikePbf(new Uint8Array(Buffer.from('<!DOCTYPE html><html><head>'))), false);
});

test('places are counted once per seed, however many interests they carry', () => {
  const durham: Seed = { ...RALEIGH, name: 'Durham' };
  assert.deepEqual(countPerSeed([
    { key: 'node/1', seeds: [RALEIGH, durham] },
    { key: 'node/1', seeds: [RALEIGH] },
    { key: 'node/2', seeds: [RALEIGH] },
  ]), { Durham: 1, Raleigh: 2 });
});

test('a seed with nothing near it is counted as 0, not left out', () => {
  // "Seeds that kept nothing" is the towns whose itinerary will name no
  // venues. Leaving them out of per_seed made that count read 0 of 0.
  const moab: Seed = { ...RALEIGH, name: 'Moab' };
  assert.deepEqual(countPerSeed([{ key: 'node/1', seeds: [RALEIGH] }], [RALEIGH, moab]), { Moab: 0, Raleigh: 1 });
  assert.deepEqual(countPerSeed([], []), {}, 'no seeds at all is an empty record, which dueRegions reads as "had none"');
});

// ── A whole run, against a fake database ──────────────────────────────

type Venue = Record<string, any>;

/** Just enough PostgREST to hold venues, runs and seeds. */
function fakeDb(opts: { venues?: Venue[]; runs?: Venue[]; failName?: string } = {}) {
  const venues: Venue[] = opts.venues ?? [];
  const runs: Venue[] = opts.runs ?? [];
  const upserts: object[][] = [];
  const ok = (data: unknown): DbResult => ({ data, error: null });
  const db: IngestDb = {
    async get(path) {
      if (path.startsWith('ingest_runs')) {
        const cut = /started_at=lt\.([^&]+)/.exec(path);
        const before = cut ? decodeURIComponent(cut[1]) : null;
        const good = runs.filter(r => r.status === 'ok' && (!before || r.started_at < before)).sort((a, b) => b.started_at.localeCompare(a.started_at));
        return ok(good.slice(0, 1));
      }
      if (path.startsWith('discovery_venues')) {
        const before = decodeURIComponent(/last_seen_at=lt\.([^&]+)/.exec(path)![1]);
        const offset = Number(/offset=(\d+)/.exec(path)?.[1] ?? 0);
        const rows = venues.filter(v => v.region === REGION && v.gone_at == null && v.last_seen_at < before);
        return ok(rows.slice(offset, offset + 1000).map(v => ({ id: v.id, lat: v.lat, lng: v.lng, last_seen_at: v.last_seen_at })));
      }
      return ok([]);
    },
    async upsert(table, rows) {
      upserts.push(rows);
      const keys = rows.map((r: any) => `${r.osm_type}/${r.osm_id}/${r.interest}`);
      // Postgres's own refusal: the same row twice in one statement.
      if (new Set(keys).size !== keys.length) return { data: null, error: { code: '21000', message: 'ON CONFLICT DO UPDATE command cannot affect row a second time' } };
      if (opts.failName && rows.some((r: any) => r.name === opts.failName)) return { data: null, error: { code: '23514', message: 'violates check constraint' } };
      for (const r of rows as Venue[]) {
        const had = venues.find(v => v.osm_type === r.osm_type && v.osm_id === r.osm_id && v.interest === r.interest);
        if (had) Object.assign(had, r);
        else venues.push({ id: `v${venues.length + 1}`, ...r });
      }
      return ok(null);
    },
    async insert(table, row) {
      const id = `run${runs.length + 1}`;
      runs.push({ id, ...row });
      return ok([{ id }]);
    },
    async patch(path, body) {
      if (path.startsWith('ingest_runs')) {
        const id = decodeURIComponent(/id=eq\.([^&]+)/.exec(path)![1]);
        Object.assign(runs.find(r => r.id === id)!, body);
      } else if (path.startsWith('discovery_venues')) {
        const ids = /id=in\.\(([^)]*)\)/.exec(path)![1].split(',');
        for (const v of venues) if (ids.includes(v.id) && v.gone_at == null) Object.assign(v, body);
      }
      return ok(null);
    },
  };
  return { db, venues, runs, upserts };
}

const fixture = () => readFileSync(new URL('./fixtures/ingest/raleigh.geojsonseq', import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l) as MapFeature);
const seedsFixture = () => JSON.parse(readFileSync(new URL('./fixtures/ingest/seeds.json', import.meta.url), 'utf8')) as Seed[];

test('a run over the fixture writes each place once per interest and never the same row twice in a batch', async () => {
  const { db, venues, runs, upserts } = fakeDb();
  const report = await ingestRegion({ db, region: REGION, seeds: seedsFixture(), features: fixture(), log: () => {} });
  assert.equal(report.ok, true, report.problems.join('\n'));
  // Lemongrass (eat, thai), the hotel (stay), the opera house (theatre,
  // comedy, classical), the pottery and the Charlotte taproom, 130 miles from
  // either seed: the region is read whole. The hotel was exported twice.
  assert.equal(report.kept, 5);
  assert.equal(report.written, 8);
  assert.equal(venues.length, 8);
  assert.deepEqual(report.skipped, { no_website: 1, no_name: 1, cannot_turn_up: 1 });
  assert.deepEqual(report.perSeed, { Durham: 4, Raleigh: 4 });
  for (const batch of upserts) {
    const shapes = new Set(batch.map(r => Object.keys(r).sort().join(',')));
    assert.equal(shapes.size, 1, 'one shape per write, so nobody\'s phone is nulled');
  }
  assert.equal(runs[0].status, 'ok');
  assert.equal(runs[0].kept, 5);
  assert.deepEqual(runs[0].per_seed, { Durham: 4, Raleigh: 4 }, "the taproom is kept but near neither town");
});

test('one venue that will not store fails the whole run, names it, and retires nothing', async () => {
  const lastRun = '2026-09-21T06:17:00.000Z';
  const stale = { id: 'old', osm_type: 'node', osm_id: 999, interest: 'pubs', region: REGION, lat: 35.78, lng: -78.64, last_seen_at: '2026-09-14T06:00:00.000Z', gone_at: null };
  const { db, venues, runs } = fakeDb({
    venues: [stale],
    runs: [{ id: 'r0', region: REGION, started_at: lastRun, status: 'ok', kept: 4 }],
    failName: 'City Opera House',
  });
  const report = await ingestRegion({ db, region: REGION, seeds: seedsFixture(), features: fixture(), now: new Date(SEEN), log: () => {} });
  assert.equal(report.ok, false);
  assert.equal(report.failed, 3, 'its three interests');
  assert.ok(report.problems.some(p => p.includes('City Opera House')), report.problems.join('\n'));
  assert.equal(report.retired, 0);
  assert.equal(venues.find(v => v.id === 'old')!.gone_at, null);
  assert.equal(runs.find(r => r.id !== 'r0')!.status, 'failed');
});

test('a good run marks gone what two runs missed, and a returning place is live again', async () => {
  const lastRun = '2026-09-21T06:17:00.000Z';
  const venues = [
    // Missed last week and this week: gone.
    { id: 'closed', osm_type: 'node', osm_id: 900, interest: 'pubs', region: REGION, lat: 35.78, lng: -78.64, last_seen_at: '2026-09-14T06:30:00.000Z', gone_at: null },
    // Seen last week, missed this week: stays.
    { id: 'blip', osm_type: 'node', osm_id: 901, interest: 'pubs', region: REGION, lat: 35.78, lng: -78.64, last_seen_at: '2026-09-21T06:30:00.000Z', gone_at: null },
    // Marked gone once, back on the map this week.
    { id: 'back', osm_type: 'node', osm_id: 101, interest: 'places to eat', region: REGION, lat: 35.779, lng: -78.639, website: 'https://lemongrass.example', last_seen_at: '2026-09-07T06:30:00.000Z', gone_at: '2026-09-14T06:17:00.000Z' },
  ];
  const { db } = fakeDb({ venues, runs: [{ id: 'r0', region: REGION, started_at: lastRun, status: 'ok', kept: 4 }] });
  const report = await ingestRegion({ db, region: REGION, seeds: seedsFixture(), features: fixture(), now: new Date(SEEN), log: () => {} });
  assert.equal(report.ok, true, report.problems.join('\n'));
  assert.equal(report.retired, 1);
  assert.equal(venues.find(v => v.id === 'closed')!.gone_at, SEEN);
  assert.equal(venues.find(v => v.id === 'blip')!.gone_at, null);
  assert.equal(venues.find(v => v.id === 'back')!.gone_at, null);
  assert.equal(venues.length > 3, true, 'nothing deleted, new places added');
});

test('a download that lost most of the state retires nothing and is not counted as good', async () => {
  const lastRun = '2026-09-21T06:17:00.000Z';
  const venues = [{ id: 'closed', osm_type: 'node', osm_id: 900, interest: 'pubs', region: REGION, lat: 35.78, lng: -78.64, last_seen_at: '2026-09-14T06:30:00.000Z', gone_at: null }];
  const { db, runs } = fakeDb({ venues, runs: [{ id: 'r0', region: REGION, started_at: lastRun, status: 'ok', kept: 5000 }] });
  const report = await ingestRegion({ db, region: REGION, seeds: seedsFixture(), features: fixture(), now: new Date(SEEN), log: () => {} });
  assert.equal(report.ok, false);
  assert.equal(report.retired, 0);
  assert.equal(venues[0].gone_at, null);
  assert.equal(runs.find(r => r.id !== 'r0')!.status, 'failed');
});

test('a re-run on the same week\'s download does not count as a second miss', async () => {
  // Monday's run at 06:17 kept everything but Corner Pub, which a mapper had
  // mid-edit. Its last sighting is last Monday's run. "Re-run all jobs" at
  // noon reads the same cached extract: measuring from this morning would
  // retire it on one download.
  const lastWeek = '2026-09-21T06:17:00.000Z';
  const thisMorning = SEEN;
  const noon = '2026-09-28T12:00:00.000Z';
  const venues = [
    { id: 'pub', osm_type: 'node', osm_id: 900, interest: 'pubs', region: REGION, lat: 35.78, lng: -78.64, last_seen_at: lastWeek, gone_at: null },
  ];
  const { db } = fakeDb({ venues, runs: [
    { id: 'r0', region: REGION, started_at: lastWeek, status: 'ok', kept: 4 },
    { id: 'r1', region: REGION, started_at: thisMorning, status: 'ok', kept: 4 },
  ] });
  const report = await ingestRegion({ db, region: REGION, seeds: seedsFixture(), features: fixture(), now: new Date(noon), log: () => {} });
  assert.equal(report.ok, true, report.problems.join('\n'));
  assert.equal(report.retired, 0);
  assert.equal(venues[0].gone_at, null);

  // Next Monday it is still missing: two downloads, and it goes.
  const nextWeek = '2026-10-05T06:17:00.000Z';
  const again = await ingestRegion({ db, region: REGION, seeds: seedsFixture(), features: fixture(), now: new Date(nextWeek), log: () => {} });
  assert.equal(again.retired, 1);
  assert.equal(venues[0].gone_at, nextWeek);
});

test('the earlier download is the good run at least six days back', () => {
  assert.equal(earlierDownloadBefore('2026-09-28T06:17:00.000Z'), '2026-09-22T06:17:00.000Z');
});

test('a region that honestly holds nothing is a good run, week after week', async () => {
  // A small territory whose mappers recorded no websites.
  const { db, runs } = fakeDb();
  const nothing = () => fixture().filter(f => !f.properties?.website && !f.properties?.url && !f.properties?.['contact:website']);
  const first = await ingestRegion({ db, region: REGION, seeds: [], features: nothing(), now: new Date('2026-09-21T06:17:00.000Z'), log: () => {} });
  assert.equal(first.ok, true, first.problems.join('\n'));
  assert.equal(first.kept, 0);
  assert.equal(runs[0].status, 'ok');
  const second = await ingestRegion({ db, region: REGION, seeds: [], features: nothing(), now: new Date(SEEN), log: () => {} });
  assert.equal(second.ok, true, 'and again the next week, rather than red every Monday');
  assert.equal(second.retired, 0);
});

test('a region nobody has planned a trip to is read whole, and says it had no seeds', async () => {
  const { db, venues, runs } = fakeDb();
  const report = await ingestRegion({ db, region: REGION, seeds: [], features: fixture(), log: () => {} });
  assert.equal(report.ok, true, report.problems.join('\n'));
  assert.equal(report.kept, 5);
  assert.equal(venues.length, 8);
  assert.deepEqual(runs[0].per_seed, {}, 'empty, so a first seed later makes the region due');
});

test('rows are written as the export streams, never the same row twice across batches', async () => {
  // Batches of one, flushed every four rows: the hotel osmium exported twice
  // arrives in a later flush than its twin would have, and must not be sent
  // again — a second write of the row is harmless, but the dedupe has to
  // hold across flushes, not only inside one.
  const { db, upserts } = fakeDb();
  const report = await ingestRegion({ db, region: REGION, seeds: seedsFixture(), features: fixture(), batchSize: 1, log: () => {} });
  assert.equal(report.ok, true, report.problems.join('\n'));
  const keys = upserts.flat().map((r: any) => `${r.osm_type}/${r.osm_id}/${r.interest}`);
  assert.equal(keys.length, 8);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(upserts.length >= 8, 'written in many small writes, not one at the end');
});

test('a database that refuses everything stops the run after MAX_FAILED_ROWS rather than asking row by row all day', async () => {
  const many = Array.from({ length: 1500 }, (_, i) => feature(10_000 + i, { name: `Bar ${i}`, amenity: 'bar', website: `https://b${i}.example` }));
  let calls = 0;
  const db: IngestDb = {
    get: async () => ({ data: [], error: null }),
    insert: async () => ({ data: [{ id: 'run1' }], error: null }),
    patch: async () => ({ data: null, error: null }),
    upsert: async () => { calls++; return { data: null, error: { code: '503', message: 'unavailable' } }; },
  };
  const report = await ingestRegion({ db, region: REGION, seeds: [], features: many, batchSize: 100, log: () => {} });
  assert.equal(report.ok, false);
  assert.equal(report.failed, 1500, 'every row that was not written is counted as failed');
  assert.equal(report.written, 0);
  assert.ok(calls <= MAX_FAILED_ROWS + 2, `${calls} upserts for a database that said no`);
  assert.ok(report.problems.some(p => /stopped writing/.test(p)));
});

test('nothing kept after a run that kept something is a broken download, whatever --accept-drop says', () => {
  assert.deepEqual(runVerdict(0, null), { good: true, mayRetire: false });
  assert.deepEqual(runVerdict(0, 0), { good: true, mayRetire: false });
  assert.deepEqual(runVerdict(0, 400), { good: false, mayRetire: false });
  assert.deepEqual(runVerdict(0, 400, true), { good: false, mayRetire: false });
  assert.deepEqual(runVerdict(300, 400), { good: true, mayRetire: true });
  assert.deepEqual(runVerdict(100, 400), { good: false, mayRetire: false });
  assert.deepEqual(runVerdict(100, 400, true), { good: true, mayRetire: true });
  // A good run that saw nothing is no evidence of what was there.
  assert.deepEqual(runVerdict(50, 0), { good: true, mayRetire: false });
});

test('the circle a seed is read around is thirty miles unless the row says otherwise', () => {
  const noRadius: Seed = { name: 'Raleigh', lat: 35.7796, lng: -78.6382, region: REGION, source: 'plan' };
  const north = (miles: number) => ({ lat: 35.7796 + miles / 69, lng: -78.6382 });
  assert.equal(seedsCovering(north(29), [noRadius]).length, 1);
  assert.equal(seedsCovering(north(31), [noRadius]).length, 0);
});

// ── Which country a border venue is in ────────────────────────────────

const gbox = (w: number, s: number, e: number, n: number) => ({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
const gpbf = (p: string) => ({ pbf: `https://download.geofabrik.de/${p}-latest.osm.pbf` });

// As Geofabrik cuts them: Mexico's polygon reaches north over the line (San
// Luis, AZ is inside it), Arizona's and California's stop at it.
const BORDER_US_MX = new GeofabrikMap({ features: [
  { properties: { id: 'north-america' }, geometry: gbox(-170, 5, -50, 85) },
  { properties: { id: 'us', 'iso3166-1:alpha2': ['US'], urls: gpbf('north-america/us') }, geometry: gbox(-125, 32.4, -66, 50) },
  // Arizona's southern edge runs down from the Colorado at San Luis to Nogales.
  { properties: { id: 'arizona', urls: gpbf('north-america/us/arizona') }, geometry: { type: 'Polygon', coordinates: [[[-114.82, 32.48], [-111.07, 31.33], [-109.04, 31.33], [-109.04, 37], [-114.82, 37], [-114.82, 32.48]]] } },
  { properties: { id: 'california', urls: gpbf('north-america/us/california') }, geometry: gbox(-124.5, 32.53, -114.13, 42) },
  { properties: { id: 'mexico', 'iso3166-1:alpha2': ['MX'], urls: gpbf('north-america/mexico') }, geometry: gbox(-118.5, 14, -86, 32.72) },
] }, ['north-america/us/arizona', 'north-america/us/california', 'north-america/mexico']);

// As Geofabrik cuts them on the Oder, measured against index-v1.json on
// 2026-09-24: Poland's Lubuskie reaches west over the whole of central
// Frankfurt (Oder) and is the smaller file; Brandenburg reaches east over
// Słubice. The Oder runs at about 14.56 here.
const ODER = new GeofabrikMap({ features: [
  { properties: { id: 'europe' }, geometry: gbox(-30, 30, 50, 75) },
  { properties: { id: 'germany', 'iso3166-1:alpha2': ['DE'], urls: gpbf('europe/germany') }, geometry: gbox(5.8, 47.2, 14.62, 55.1) },
  { properties: { id: 'brandenburg', urls: gpbf('europe/germany/brandenburg') }, geometry: gbox(11.2, 51.3, 14.62, 53.6) },
  { properties: { id: 'poland', 'iso3166-1:alpha2': ['PL'], urls: gpbf('europe/poland') }, geometry: gbox(14.5, 49, 24.2, 54.9) },
  { properties: { id: 'lubuskie', urls: gpbf('europe/poland/lubuskie') }, geometry: gbox(14.5, 51.35, 16.45, 53.15) },
] });
const BB = 'europe/germany/brandenburg', LB = 'europe/poland/lubuskie';

test('the polygons alone cannot place central Frankfurt (Oder): the smallest file that holds it is Poland\'s', () => {
  // The fact the rule has to live with, not a rule to follow: the old one did.
  assert.equal(ODER.regionAt(52.3417, 14.5540), LB);
  // With the geocoder's country, the town is seeded in its own country's file.
  assert.equal(ODER.regionAt(52.3417, 14.5540, 'DE'), BB);
  assert.equal(ODER.regionAt(52.3417, 14.5540, 'de'), BB);
  assert.equal(ODER.regionAt(52.35, 14.58, 'PL'), LB, 'Słubice, in Poland');
  const town = regionsForTown(ODER, { lat: 52.3417, lng: 14.5540 }, [{ lat: 52.3, lng: 14.3 }, { lat: 52.35, lng: 14.9 }], 'de');
  assert.equal(town.regions[0], BB, 'Frankfurt (Oder)\'s own file is Brandenburg');
  assert.ok(!town.regions.includes(LB) && town.abroad.includes(LB));
});

test('a venue in the overlap is placed by its own tags, and by nothing else', () => {
  const fromBB = countriesAt(ODER, BB), fromLB = countriesAt(ODER, LB);
  const rathaus = { lat: 52.3417, lng: 14.5540 };
  for (const read of [fromBB, fromLB]) {
    assert.deepEqual(read(rathaus, { 'addr:country': 'DE' }), ['DE']);
    assert.deepEqual(read(rathaus, { phone: '+49 335 5520' }), ['DE']);
    assert.deepEqual(read(rathaus, { 'contact:phone': '0049 335 552 0' }), ['DE']);
    assert.deepEqual(read({ lat: 52.35, lng: 14.58 }, { phone: '+48 95 758 2000' }), ['PL'], 'Słubice');
    // Nothing on the feature says which side: both, never a guess.
    assert.deepEqual(read(rathaus, {}), ['DE', 'PL']);
    assert.deepEqual(read(rathaus, { phone: '0335 5520' }), ['DE', 'PL'], 'a national number says nothing');
    assert.deepEqual(read(rathaus, { 'addr:country': 'FR' }), ['DE', 'PL'], 'a country neither file holds is no answer');
  }
  // Away from the border there is no question to ask.
  assert.deepEqual(fromBB({ lat: 52.52, lng: 13.40 }, { 'addr:country': 'PL' }), ['DE'], 'Berlin');
  assert.deepEqual(fromLB({ lat: 52.73, lng: 15.24 }, {}), ['PL'], 'Gorzów');
});

test('Frankfurt (Oder) keeps its own venues whichever file is loaded last, and Słubice\'s stay in Poland', async () => {
  const site = { website: 'https://example.com' };
  const rathaus = feature(601, { name: 'Ratskeller', amenity: 'restaurant', ...site }, [14.5540, 52.3417]);
  const hbf = feature(602, { name: 'Bahnhofsgrill', amenity: 'restaurant', 'addr:country': 'DE', ...site }, [14.5462, 52.3364]);
  const slubice = feature(603, { name: 'Bar Przystań', amenity: 'restaurant', phone: '+48 95 758 2000', ...site }, [14.58, 52.35]);
  const both = [rathaus, hbf, slubice]; // each file holds all three
  for (const order of [[BB, LB], [LB, BB]]) {
    const { db, venues } = fakeDb();
    for (const region of order) {
      const report = await ingestRegion({ db, region, seeds: [], features: both, now: new Date(SEEN), log: () => {}, countriesAt: countriesAt(ODER, region) });
      assert.equal(report.ok, true, report.problems.join('\n'));
      assert.equal(report.kept, 3, `${region} writes every place it holds; none waits on another country's load`);
    }
    const row = (id: number) => venues.find(v => v.osm_id === id)!;
    assert.deepEqual(row(601).countries, ['DE', 'PL'], `order ${order.join(' → ')}`);
    assert.deepEqual(row(602).countries, ['DE']);
    assert.deepEqual(row(603).countries, ['PL']);
    // A Frankfurt (Oder) trip: the geocoder says "de".
    assert.equal(acrossTheBorder(row(601).region, 'DE', row(601).countries), false, 'the Ratskeller is kept, whatever file wrote it last');
    assert.equal(acrossTheBorder(row(602).region, 'DE', row(602).countries), false);
    assert.equal(acrossTheBorder(row(603).region, 'DE', row(603).countries), true, 'Słubice is across the river');
    assert.equal(acrossTheBorder(row(601).region, 'PL', row(601).countries), false, 'and a Słubice trip is not told the Ratskeller is not there');
  }
});

test('the last file loaded does not decide a border venue\'s country: San Luis, AZ in Mexico\'s extract', async () => {
  const AZ = 'north-america/us/arizona', MX = 'north-america/mexico', CA = 'north-america/us/california';
  const site = { website: 'https://example.com' };
  const sanLuisAZ = feature(501, { name: 'Taqueria San Luis', amenity: 'restaurant', phone: '+1 928 627 0000', ...site }, [-114.782, 32.487]);
  const sanLuisRC = feature(502, { name: 'Mariscos del Rio', amenity: 'restaurant', phone: '+52 653 534 0000', ...site }, [-114.77, 32.456]);
  const sanYsidro = feature(503, { name: 'Border Diner', amenity: 'restaurant', 'addr:country': 'US', ...site }, [-117.0296, 32.5427]);
  const tijuana = feature(504, { name: 'Tacos Tijuana', amenity: 'restaurant', ...site }, [-117.0382, 32.3149]);
  // California's extract carries Tijuana too, past its own polygon (a way
  // that crosses the line): a file that does not hold a point is no candidate.
  const loads = { [AZ]: [sanLuisAZ, sanLuisRC], [MX]: [sanLuisAZ, sanLuisRC, sanYsidro, tijuana], [CA]: [sanYsidro, tijuana] };
  assert.deepEqual(countriesAt(BORDER_US_MX, CA)({ lat: 32.3149, lng: -117.0382 }), ['MX'], 'Tijuana read from California\'s file');
  assert.deepEqual(countriesAt(BORDER_US_MX, MX)({ lat: 32.3149, lng: -117.0382 }), ['MX'], 'and from Mexico\'s');

  for (const order of [[AZ, MX, CA], [MX, CA, AZ], [CA, AZ, MX]]) {
    const { db, venues } = fakeDb();
    for (const region of order) {
      const report = await ingestRegion({
        db, region, seeds: [], features: loads[region as keyof typeof loads], now: new Date(SEEN), log: () => {},
        countriesAt: countriesAt(BORDER_US_MX, region),
      });
      assert.equal(report.ok, true, report.problems.join('\n'));
    }
    const row = (id: number) => venues.find(v => v.osm_id === id)!;
    assert.deepEqual(row(501).countries, ['US'], `order ${order.join(' → ')}`);
    assert.deepEqual(row(502).countries, ['MX'], 'San Luis Río Colorado is Mexico\'s');
    assert.deepEqual(row(503).countries, ['US']);
    assert.deepEqual(row(504).countries, ['MX'], 'Tijuana is in no US file: no question to ask');
    assert.equal(acrossTheBorder(row(501).region, 'US', row(501).countries), false, 'kept on a Yuma trip');
    assert.equal(acrossTheBorder(row(502).region, 'US', row(502).countries), true);
    assert.equal(acrossTheBorder(row(504).region, 'US', row(504).countries), true, 'never on a San Diego trip');
  }
});

test('a point shared by two files of one country has no question to ask', () => {
  const map = new GeofabrikMap({ features: [
    { properties: { id: 'us', 'iso3166-1:alpha2': ['US'], urls: gpbf('north-america/us') }, geometry: gbox(-125, 24, -66, 50) },
    { properties: { id: 'north-carolina', urls: gpbf('north-america/us/north-carolina') }, geometry: gbox(-84.3, 33.8, -75.4, 36.6) },
    { properties: { id: 'virginia', urls: gpbf('north-america/us/virginia') }, geometry: gbox(-83.7, 36.5, -75.2, 39.5) },
  ] }, ['north-america/us/north-carolina', 'north-america/us/virginia']);
  const fromNC = countriesAt(map, 'north-america/us/north-carolina');
  assert.deepEqual(fromNC({ lat: 36.55, lng: -79 }), ['US'], 'Virginia holds it too; either way it is in the US');
  assert.deepEqual(fromNC({ lat: 35.78, lng: -78.64 }, { 'addr:country': 'CA' }), ['US']);
});

test('a number says which side only when its code is one side\'s alone', () => {
  assert.deepEqual(callingCountries('+49 335 5520', ['DE', 'PL']), ['DE']);
  assert.deepEqual(callingCountries('0048 95 758 2000', ['DE', 'PL']), ['PL']);
  assert.deepEqual(callingCountries('+1 313 555 0100', ['US', 'CA']).sort(), ['CA', 'US'], 'Detroit and Windsor share +1');
  assert.deepEqual(callingCountries('+1 809 555 0100', ['US', 'DO', 'HT']), ['DO'], 'an area code of its own beats +1');
  assert.deepEqual(callingCountries('+509 2222 0000', ['HT', 'DO']), ['HT']);
  assert.deepEqual(callingCountries('(335) 5520', ['DE', 'PL']), [], 'national format');
  assert.deepEqual(callingCountries('+49 1', ['DE']), [], 'too short to be a number');
  assert.deepEqual(callingCountries('+33 1 23 45 67 89', ['DE', 'PL']), []);
});

test('a row\'s own countries decide the border check, in the geocoder\'s names', () => {
  // Filed under Poland's file, but the map says Germany.
  assert.equal(acrossTheBorder(LB, 'DE', ['DE']), false);
  assert.equal(acrossTheBorder(BB, 'DE', ['PL']), true);
  assert.equal(acrossTheBorder(LB, 'DE', ['DE', 'PL']), false);
  assert.equal(acrossTheBorder(LB, 'FR', ['DE', 'PL']), true);
  // Hong Kong is "cn" to Nominatim, Guam "us", French Guiana "fr".
  assert.equal(acrossTheBorder('asia/china/guangdong', 'CN', ['HK']), false);
  assert.equal(acrossTheBorder('australia-oceania/american-oceania', 'US', ['GU']), false);
  assert.equal(acrossTheBorder('europe/france/guyane', 'FR', ['GF']), false);
  // Rows the load has not rewritten yet: the region, as before.
  assert.equal(acrossTheBorder('north-america/mexico', 'US', null), true);
  assert.equal(acrossTheBorder('north-america/mexico', 'US', []), true);
  assert.equal(acrossTheBorder(null, 'US', null), false);
});
