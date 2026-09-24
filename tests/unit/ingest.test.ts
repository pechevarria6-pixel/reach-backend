// The weekly map load, driven with a handful of made-up features and a fake
// database instead of a four-hundred-megabyte download.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  interestsFor, osmiumFilters, rowsFor, dedupeRows, shapeBatches, goneVenues,
  trustworthyRun, looksLikePbf, countPerSeed, ingestRegion,
  type MapFeature, type IngestDb, type DbResult,
} from '../../lib/discovery/ingest.ts';
import { mappableKinds, kindFor, QUIZ_CUISINES } from '../../lib/discovery/taste.ts';
import { matchesSelector, tagsFor } from '../../lib/discovery/osm.ts';
import type { Seed } from '../../lib/discovery/regions.ts';

const REGION = 'north-america/us/north-carolina';
const RALEIGH: Seed = { name: 'Raleigh', lat: 35.7796, lng: -78.6382, region: REGION, radius_miles: 100, source: 'plan' };
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
  assert.deepEqual(rowsFor(feature(1, { name: 'Diner', amenity: 'restaurant' }), [RALEIGH], REGION, SEEN), { skip: 'no_website' });
  assert.deepEqual(rowsFor(feature(2, { amenity: 'bar', website: 'https://x.example' }), [RALEIGH], REGION, SEEN), { skip: 'no_name' });
});

test('a website under any of its three tags counts, and becomes a link', () => {
  for (const key of ['website', 'contact:website', 'url']) {
    const out = rowsFor(feature(3, { name: 'Café Uno', amenity: 'cafe', [key]: 'cafe-uno.example' }), [RALEIGH], REGION, SEEN);
    assert.ok('rows' in out, key);
    assert.equal(out.rows[0].website, 'https://cafe-uno.example');
  }
});

test('outside every seed circle is not written', () => {
  const charlotte = feature(4, { name: 'Taproom', amenity: 'pub', website: 'https://t.example' }, [-80.8431, 35.2271]);
  assert.deepEqual(rowsFor(charlotte, [RALEIGH], REGION, SEEN), { skip: 'outside' });
});

test('a caterer carries the tag and is still not a night out', () => {
  const out = rowsFor(feature(5, { name: 'Party Caterers', amenity: 'restaurant', website: 'https://c.example' }), [RALEIGH], REGION, SEEN);
  assert.deepEqual(out, { skip: 'cannot_turn_up' });
});

test('a row carries the phone as a dialable number, the hours, the street and the map\'s own town', () => {
  const out = rowsFor(feature(6, {
    name: 'Lemongrass Thai', amenity: 'restaurant', cuisine: 'thai', website: 'lemongrass.example',
    phone: '(919) 555-0101', opening_hours: 'Mo-Sa 11:00-22:00; Su off',
    'addr:housenumber': '118', 'addr:street': 'S Wilmington St', 'addr:city': 'Raleigh', fixme: 'check',
  }), [RALEIGH], REGION, SEEN);
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
  const out = rowsFor(feature(7, { name: 'Quiet Bar', amenity: 'bar', website: 'https://q.example' }), [RALEIGH], REGION, SEEN);
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
    held('outside-every-circle', '2026-09-14T06:30:00.000Z', { lat: 35.2271, lng: -80.8431 }),
  ];
  assert.deepEqual(goneVenues(venues, lastRun, [RALEIGH]), ['missed-twice']);
});

test('the first run ever retires nothing', () => {
  assert.deepEqual(goneVenues([held('x', '2020-01-01T00:00:00Z')], null, [RALEIGH]), []);
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
        const good = runs.filter(r => r.status === 'ok').sort((a, b) => b.started_at.localeCompare(a.started_at));
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
  // comedy, classical) and the pottery; the hotel was exported twice.
  assert.equal(report.kept, 4);
  assert.equal(report.written, 7);
  assert.equal(venues.length, 7);
  assert.deepEqual(report.skipped, { no_website: 1, no_name: 1, outside: 1, cannot_turn_up: 1 });
  assert.deepEqual(report.perSeed, { Durham: 4, Raleigh: 4 });
  for (const batch of upserts) {
    const shapes = new Set(batch.map(r => Object.keys(r).sort().join(',')));
    assert.equal(shapes.size, 1, 'one shape per write, so nobody\'s phone is nulled');
  }
  assert.equal(runs[0].status, 'ok');
  assert.equal(runs[0].kept, 4);
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
