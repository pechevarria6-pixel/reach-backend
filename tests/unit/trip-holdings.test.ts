// Home's "Ideas for you" counts what we hold around each town before it can
// suggest one. Counting all 83 towns first took 30–76s against the live
// table, so GET /api/recommendations/trips hit its 30s limit on every call
// and the cache it was filling was never filled (2026-11-05).
// Run with: npm run test:unit
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { holdingsAt, holdingsFor, countOrder, forgetHoldings } from '../../lib/recommendations/holdings.ts';
import { candidatesFrom, notATown, type Candidate } from '../../lib/recommendations/trip-picks.ts';

type Row = { id: string; name: string; interest: string; kind: string; lat: number; lng: number; gone_at: null };

const HOME = { lat: 35.18, lng: -79.39 }; // Southern Pines
const town = (name: string, lat: number, lng: number): Candidate =>
  ({ key: `${name.toLowerCase()}|US`, name, country: 'US', label: name, lat, lng });

let n = 0;
const rowsAround = (at: { lat: number; lng: number }, count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({
    id: String(++n).padStart(8, '0'), name: `Place ${n}`, interest: i % 3 ? 'places to eat' : 'live music',
    kind: i % 3 ? 'restaurant' : 'music_venue', lat: at.lat + (i % 10) / 1000, lng: at.lng, gone_at: null,
  }));

/** supabase-js as holdingsAt uses it, each read taking `delayMs`, or never answering until aborted. */
function fakeDb(rows: Row[], opts: { delayMs?: number; hang?: boolean } = {}) {
  const calls = { reads: 0, offsets: 0 };
  const from = () => {
    const filters: Array<(r: Row) => boolean> = [];
    let limit = Infinity;
    let signal: AbortSignal | undefined;
    const b: any = {
      select() { return b; },
      gte(c: keyof Row, v: any) { filters.push(r => (r[c] as any) >= v); return b; },
      lte(c: keyof Row, v: any) { filters.push(r => (r[c] as any) <= v); return b; },
      gt(c: keyof Row, v: any) { filters.push(r => (r[c] as any) > v); return b; },
      neq(c: keyof Row, v: any) { filters.push(r => r[c] !== v); return b; },
      is(c: keyof Row) { filters.push(r => r[c] == null); return b; },
      order() { return b; },
      limit(k: number) { limit = k; return b; },
      range(a: number, z: number) { calls.offsets++; filters.push(() => true); limit = z - a + 1; b._skip = a; return b; },
      abortSignal(s: AbortSignal) { signal = s; return b; },
      then(resolve: (v: unknown) => void) {
        calls.reads++;
        const answer = () => {
          const got = rows.filter(r => filters.every(f => f(r))).sort((x, y) => x.id.localeCompare(y.id));
          resolve({ data: got.slice(b._skip ?? 0, (b._skip ?? 0) + limit), error: null });
        };
        const aborted = () => resolve({ data: null, error: { code: '20', message: 'AbortError: This operation was aborted' } });
        if (signal?.aborted) return aborted();
        signal?.addEventListener('abort', aborted, { once: true });
        if (opts.hang) return;
        const t = setTimeout(answer, opts.delayMs ?? 0);
        signal?.addEventListener('abort', () => clearTimeout(t), { once: true });
      },
    };
    return b;
  };
  return { db: { from } as any, calls };
}

const settle = (ms: number) => new Promise(r => setTimeout(r, ms));

beforeEach(() => forgetHoldings());

test('a slow count never holds Home past its budget, and the towns near them are counted first', async () => {
  const near = [town('Aberdeen', 35.13, -79.43), town('Fayetteville', 35.05, -78.88), town('Raleigh', 35.78, -78.64)];
  const far = Array.from({ length: 40 }, (_, i) => town(`Faraway ${i}`, 50 + i, 10));
  const list = [...far, ...near]; // the world list comes first in the real one
  const { db } = fakeDb([...near, ...far].flatMap(t => rowsAround(t, 30)), { delayMs: 150 });

  const started = Date.now();
  const { holdings, unread } = await holdingsFor(db, list, HOME, { budgetMs: 400, concurrency: 4 });
  const took = Date.now() - started;

  assert.ok(took < 600, `answered in ${took}ms, not after counting all ${list.length} towns`);
  assert.ok(unread > 0, 'says some towns were not counted');
  for (const t of near) assert.ok(holdings.has(t.key), `${t.name} is within a drive and was counted first`);
  await settle(400);
});

test('a town counted after the budget is kept for the next load, and a kept town is not read again', async () => {
  const list = Array.from({ length: 6 }, (_, i) => town(`Town ${i}`, 35.18 + i, -79.39));
  const { db, calls } = fakeDb(list.flatMap(t => rowsAround(t, 25)), { delayMs: 100 });

  const first = await holdingsFor(db, list, HOME, { budgetMs: 50, concurrency: 6 });
  assert.equal(first.holdings.size, 0, 'nothing landed inside 50ms');
  assert.equal(first.unread, 6);
  await settle(200); // the counts already going finish

  const readsBefore = calls.reads;
  const second = await holdingsFor(db, list, HOME, { budgetMs: 50, concurrency: 6 });
  assert.equal(second.holdings.size, 6, 'every town the first load started is kept');
  assert.equal(second.unread, 0);
  assert.equal(calls.reads, readsBefore, 'and none of them is read twice');
});

test('once every drive and enough flights are counted, Home does not wait out the budget', async () => {
  const near = [town('Aberdeen', 35.13, -79.43), town('Raleigh', 35.78, -78.64)];
  const far = Array.from({ length: 10 }, (_, i) => town(`Faraway ${i}`, 50 + i, 10));
  const { db } = fakeDb([...near, ...far].flatMap(t => rowsAround(t, 30)), { delayMs: 30 });
  const started = Date.now();
  const got = await holdingsFor(db, [...far, ...near], HOME, { budgetMs: 2000, concurrency: 4, farEnough: 2 });
  assert.ok(Date.now() - started < 1000, 'answered as soon as it had enough');
  for (const t of near) assert.ok(got.holdings.has(t.key));
  await settle(400);
});

test('a read that never answers is given up at its own limit', async () => {
  const list = [town('Aberdeen', 35.13, -79.43)];
  const { db } = fakeDb([], { hang: true });
  const started = Date.now();
  const got = await holdingsAt(db, list[0], AbortSignal.timeout(50));
  assert.equal(got, null, 'a town we could not count is not suggested');
  assert.ok(Date.now() - started < 400);
});

test('pages are read by id, never by offset, and the count is whole', async () => {
  const at = { lat: 51.51, lng: -0.13 };
  const { db, calls } = fakeDb(rowsAround(at, 2500));
  const h = await holdingsAt(db, at);
  assert.ok(h);
  assert.equal(Object.values(h!.counts).reduce((a, b) => a + b, 0), 2500, 'three pages, nothing skipped or counted twice');
  assert.equal(h!.floor, false);
  assert.equal(calls.offsets, 0, 'offset paging re-walks every earlier page on each read');
});

test('past five thousand rows the count is a floor', async () => {
  const at = { lat: 51.51, lng: -0.13 };
  const { db } = fakeDb(rowsAround(at, 6200));
  const h = await holdingsAt(db, at);
  assert.equal(Object.values(h!.counts).reduce((a, b) => a + b, 0), 5000);
  assert.equal(h!.floor, true);
});

test('within a drive comes first, nearest first; the rest keep list order', () => {
  const list = [town('Paris', 48.86, 2.35), town('Raleigh', 35.78, -78.64), town('Tokyo', 35.68, 139.77), town('Aberdeen', 35.13, -79.43)];
  assert.deepEqual(countOrder(list, HOME).map(c => c.name), ['Aberdeen', 'Raleigh', 'Paris', 'Tokyo']);
  assert.deepEqual(countOrder(list, null).map(c => c.name), list.map(c => c.name));
});

test('"Your location" is a placeholder somebody saved, not a town to suggest', () => {
  // ingest_seeds holds one (35.1, -79.0, north-carolina): Home offered "A
  // night out in Your location, North Carolina".
  for (const n of ['Your location', 'your city', 'Current location', 'My location']) assert.equal(notATown(n), true, n);
  const c = candidatesFrom({
    world: [],
    seeds: [{ name: 'Your location', lat: 35.1, lng: -79.0, region: 'north-america/us/north-carolina' }],
    areas: [],
  });
  assert.deepEqual(c, []);
});
