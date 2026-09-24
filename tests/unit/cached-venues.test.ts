// Discover's venues, once the weekly map load has filled a city.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cachedVenues } from '../../lib/discovery/cache.ts';

type Row = Record<string, any>;
const CENTRE = { lat: 35.7796, lng: -78.6382 };
let n = 1;
const venue = (name: string, interest: string, miles: number, over: Row = {}): Row => ({
  osm_type: 'node', osm_id: n++, name, interest, kind: interest === 'museums & history' ? 'museum' : 'restaurant',
  lat: CENTRE.lat + miles / 69, lng: CENTRE.lng, city: 'Raleigh', website: `https://${n}.example`, street: null,
  image_url: null, gone_at: null, ...over,
});

/** supabase-js as cachedVenues uses it: in, a box, gone_at, a limit, rows in table order. */
function fakeDb(rows: Row[], opts: { noGoneAt?: boolean } = {}) {
  const from = () => {
    const filters: Array<(r: Row) => boolean> = [];
    let limit = Infinity;
    let error: { code: string; message: string } | null = null;
    const b: any = {
      select() { return b; },
      in(c: string, vs: unknown[]) { filters.push(r => vs.includes(r[c])); return b; },
      gte(c: string, v: number) { filters.push(r => r[c] >= v); return b; },
      lte(c: string, v: number) { filters.push(r => r[c] <= v); return b; },
      is(c: string) {
        if (c === 'gone_at' && opts.noGoneAt) error = { code: '42703', message: 'column discovery_venues.gone_at does not exist' };
        filters.push(r => r[c] == null);
        return b;
      },
      limit(k: number) { limit = k; return b; },
      then(resolve: (v: unknown) => void) {
        if (error) return resolve({ data: null, error });
        return resolve({ data: rows.filter(r => filters.every(f => f(r))).slice(0, limit), error: null });
      },
    };
    return b;
  };
  return { from } as any;
}

const SEEKER = { ...CENTRE, city: 'Raleigh', interests: ['museums & history'], browse: ['places to eat'], avoid: [] };

test('a city full of restaurants cannot crowd out the one museum somebody likes', async () => {
  // Stored first: what a single capped, unordered read of the box handed back.
  const eat = Array.from({ length: 800 }, (_, i) => venue(`Diner ${i}`, 'places to eat', (i % 14) + 0.5));
  const museum = venue('City Museum', 'museums & history', 9);
  const { findings, status } = await cachedVenues(fakeDb([...eat, museum]), SEEKER);
  assert.equal(status, 'ok');
  assert.ok(findings.some(f => f.title === 'City Museum'), 'read on its own, not after three hundred diners');
  assert.equal(findings[0].title, 'City Museum', 'theirs first');
});

test('the nearest of a kind are read before the far ones', async () => {
  const far = Array.from({ length: 400 }, (_, i) => venue(`Far Diner ${i}`, 'places to eat', 12));
  const near = Array.from({ length: 4 }, (_, i) => venue(`Near Diner ${i}`, 'places to eat', 0.5 + i / 10));
  const { findings } = await cachedVenues(fakeDb([...far, ...near]), SEEKER);
  assert.deepEqual(findings.filter(f => f.category === 'Places to eat').map(f => f.title),
    ['Near Diner 0', 'Near Diner 1', 'Near Diner 2', 'Near Diner 3']);
});

test('a gone place is not a card; before the migration, the read is the old one', async () => {
  const rows = [venue('Open Museum', 'museums & history', 1), venue('Shut Museum', 'museums & history', 1, { gone_at: '2026-09-21T06:17:00Z' })];
  assert.deepEqual((await cachedVenues(fakeDb(rows), SEEKER)).findings.map(f => f.title), ['Open Museum']);
  const unmigrated = [venue('Open Museum', 'museums & history', 1)];
  assert.deepEqual((await cachedVenues(fakeDb(unmigrated, { noGoneAt: true }), SEEKER)).findings.map(f => f.title), ['Open Museum']);
});
