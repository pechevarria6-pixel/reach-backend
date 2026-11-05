// The forecast cache: asked once, never before the source allows, never by
// two requests at once, and nothing at all before the table exists.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { heldForecast, forecastFor, planWeather, askNws, MAX_AGE_MS, type ForecastRow } from '../../lib/forecast-store.ts';

const raw = (name: string) => readFileSync(new URL(`./fixtures/forecast/${name}`, import.meta.url), 'utf8');
const RECORDED = new Date('2026-11-05T16:20:00Z');
const MOAB = { lat: 38.57, lng: -109.55 };
const SEATTLE = { lat: 47.61, lng: -122.33 };

type Row = Record<string, any>;

/** place_forecast as Postgres keeps it: unique on (source, lat, lng), a lease taken by a conditional update. */
function fakeDb(opts: { missing?: boolean; rows?: Row[]; climate?: Row[] } = {}) {
  const rows: Row[] = opts.rows ?? [];
  let ids = rows.length;
  const writes: Row[] = [];
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: { kind: 'insert' | 'update'; data: Row } | null = null;
    const run = async (one: boolean) => {
      if (table === 'place_climate') return { data: opts.climate ?? [], error: null };
      if (table !== 'place_forecast') return { data: null, error: { code: '42P01', message: 'no' } };
      if (opts.missing) return { data: null, error: { code: 'PGRST205', message: 'Could not find the table public.place_forecast' } };
      if (op?.kind === 'insert') {
        const d = op.data;
        if (rows.some(r => r.source === d.source && r.lat === d.lat && r.lng === d.lng)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        const r = { id: `r${++ids}`, steps: null, last_modified: null, meta: null, tz: null, fetched_at: null, expires_at: null, ...d };
        rows.push(r);
        writes.push({ insert: d });
        return { data: { ...r }, error: null };
      }
      const hit = rows.filter(r => filters.every(f => f(r)));
      if (op?.kind === 'update') {
        for (const r of hit) Object.assign(r, op.data);
        writes.push({ update: op.data, n: hit.length });
        return { data: one ? (hit[0] ? { ...hit[0] } : null) : hit.map(r => ({ ...r })), error: null };
      }
      return { data: one ? (hit[0] ? { ...hit[0] } : null) : hit.map(r => ({ ...r })), error: null };
    };
    const q: Record<string, any> = {
      select: () => q, limit: () => q,
      eq: (c: string, v: unknown) => { filters.push(r => r[c] === v); return q; },
      or: (expr: string) => {
        // lease_until.is.null,lease_until.lt."<iso>"
        const at = /lt\."([^"]+)"/.exec(expr)?.[1] as string;
        filters.push(r => r.lease_until == null || r.lease_until < at);
        return q;
      },
      insert: (d: Row) => { op = { kind: 'insert', data: d }; return q; },
      update: (d: Row) => { op = { kind: 'update', data: d }; return q; },
      single: () => run(true), maybeSingle: () => run(true),
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => run(false).then(ok, bad),
    };
    return q;
  };
  return { db: { from } as never, rows, writes };
}

/** A fetch that answers from the fixtures, and records what it was asked. */
function fakeFetch(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, headers: { ...(init.headers as Record<string, string>) } });
    return answer(url, init);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (body: string, headers: Record<string, string> = {}, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });
const MET_HEADERS = { expires: 'Thu, 05 Nov 2026 16:49:05 GMT', 'last-modified': 'Thu, 05 Nov 2026 16:17:54 GMT' };
const metOk = () => json(raw('met-moab.json'), MET_HEADERS);

test('before the migration nothing is fetched at all', async () => {
  const { db } = fakeDb({ missing: true });
  const { f, calls } = fakeFetch(metOk);
  const got = await heldForecast(db, 'met_norway', MOAB, { now: RECORDED, fetch: f });
  assert.equal(got.available, false);
  assert.equal(got.held, null);
  assert.equal(calls.length, 0);
});

test('first ask: claimed, fetched once with our User-Agent, kept with when and from where', async () => {
  const { db, rows } = fakeDb();
  const { f, calls } = fakeFetch(metOk);
  const got = await heldForecast(db, 'met_norway', MOAB, { now: RECORDED, fetch: f });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.met\.no\/weatherapi\/locationforecast\/2\.0\/complete\?lat=38\.57&lon=-109\.55$/);
  assert.equal(calls[0].headers['User-Agent'], 'Reach/1.0 (+https://alcanzar.io)');
  assert.equal(calls[0].headers['If-Modified-Since'], undefined);
  assert.equal(got.held?.source, 'met_norway');
  assert.equal(got.held?.fetchedAt, RECORDED.toISOString());
  const r = rows[0];
  assert.equal(r.status, 'ok');
  assert.equal(r.last_modified, MET_HEADERS['last-modified']);
  assert.equal(r.lease_until, null);
  // Moab is outside the Nordic model: not again for three hours, Expires or not.
  assert.equal(r.next_ask_at, new Date(RECORDED.getTime() + 3 * 3_600_000).toISOString());
});

test('until next_ask_at the row is served and the source is not asked', async () => {
  const { db } = fakeDb();
  const { f, calls } = fakeFetch(metOk);
  await heldForecast(db, 'met_norway', MOAB, { now: RECORDED, fetch: f });
  const later = new Date(RECORDED.getTime() + 2 * 3_600_000);
  const again = await heldForecast(db, 'met_norway', MOAB, { now: later, fetch: f });
  assert.equal(calls.length, 1);
  assert.equal(again.held?.fetchedAt, RECORDED.toISOString());
});

test('once due, If-Modified-Since goes with it, and a 304 keeps what is held', async () => {
  const { db, rows } = fakeDb();
  const first = fakeFetch(metOk);
  await heldForecast(db, 'met_norway', MOAB, { now: RECORDED, fetch: first.f });
  const due = new Date(RECORDED.getTime() + 3 * 3_600_000 + 1000);
  const second = fakeFetch(() => new Response(null, { status: 304, headers: { expires: 'Thu, 05 Nov 2026 20:00:00 GMT' } }));
  const got = await heldForecast(db, 'met_norway', MOAB, { now: due, fetch: second.f });
  assert.equal(second.calls[0].headers['If-Modified-Since'], MET_HEADERS['last-modified']);
  assert.ok(got.held);
  assert.equal(rows[0].fetched_at, RECORDED.toISOString());
  assert.ok(Date.parse(rows[0].next_ask_at) >= due.getTime() + 3 * 3_600_000);
});

test('a refusal backs off and keeps the forecast held', async () => {
  const { db, rows } = fakeDb();
  await heldForecast(db, 'met_norway', MOAB, { now: RECORDED, fetch: fakeFetch(metOk).f });
  const due = new Date(RECORDED.getTime() + 4 * 3_600_000);
  const throttled = fakeFetch(() => new Response('slow down', { status: 429, headers: { 'retry-after': '1800' } }));
  const got = await heldForecast(db, 'met_norway', MOAB, { now: due, fetch: throttled.f });
  assert.ok(got.held, 'the forecast held is still served');
  assert.equal(rows[0].status, 'ok');
  assert.equal(rows[0].next_ask_at, new Date(due.getTime() + 1800 * 1000).toISOString());
  assert.equal(rows[0].lease_until, null);
});

test('two requests at the same instant ask the source once', async () => {
  const { db } = fakeDb();
  let release: () => void = () => {};
  const gate = new Promise<void>(r => { release = r; });
  const { f, calls } = fakeFetch(async () => { await gate; return metOk(); });
  const a = heldForecast(db, 'met_norway', MOAB, { now: RECORDED, fetch: f });
  const b = heldForecast(db, 'met_norway', MOAB, { now: RECORDED, fetch: f });
  await new Promise(r => setTimeout(r, 300));
  release();
  await Promise.all([a, b]);
  assert.equal(calls.length, 1);
});

test('a due row whose lease somebody else holds is served as it is, not fetched again', async () => {
  const { db, rows } = fakeDb();
  await heldForecast(db, 'met_norway', MOAB, { now: RECORDED, fetch: fakeFetch(metOk).f });
  const due = new Date(RECORDED.getTime() + 4 * 3_600_000);
  rows[0].lease_until = new Date(due.getTime() + 10_000).toISOString();
  const { f, calls } = fakeFetch(metOk);
  const got = await heldForecast(db, 'met_norway', MOAB, { now: due, fetch: f });
  assert.equal(calls.length, 0);
  assert.ok(got.held);
});

test('a forecast older than MAX_AGE is not quoted', async () => {
  const { db } = fakeDb();
  await heldForecast(db, 'met_norway', MOAB, { now: RECORDED, fetch: fakeFetch(metOk).f });
  const old = new Date(RECORDED.getTime() + MAX_AGE_MS + 60_000);
  const got = await heldForecast(db, 'met_norway', MOAB, { now: old, fetch: fakeFetch(() => { throw new Error('down'); }).f });
  assert.equal(got.held, null);
});

test('nothing is fetched for dates no forecast reaches', async () => {
  const { db, writes } = fakeDb();
  const { f, calls } = fakeFetch(metOk);
  const got = await forecastFor(db, MOAB, { dates: ['2026-12-20', '2026-12-21'] }, { now: RECORDED, fetch: f });
  assert.deepEqual(got.days, []);
  assert.equal(calls.length, 0);
  assert.equal(writes.length, 0);
});

test('in the US the NWS comes first, and MET Norway fills the days it does not reach', async () => {
  const { db } = fakeDb();
  const { f, calls } = fakeFetch(url => {
    if (url.includes('/points/')) return json(raw('nws-points-seattle.json'));
    if (url.includes('/forecast/hourly')) return json(raw('nws-hourly-seattle.json'), { expires: 'Thu, 05 Nov 2026 17:18:24 GMT' });
    if (url.includes('api.met.no')) return json(raw('met-bergen.json'), MET_HEADERS);
    return new Response('', { status: 404 });
  });
  const dates = ['2026-11-06', '2026-11-12', '2026-11-13'];
  const got = await forecastFor(db, SEATTLE, { dates, country: 'US' }, { now: RECORDED, fetch: f });
  const by = new Map(got.days.map(d => [d.date, d.source]));
  assert.equal(by.get('2026-11-06'), 'nws');
  // The NWS hourly forecast stops on the 11th; the 12th and 13th are MET Norway's.
  assert.equal(by.get('2026-11-12'), 'met_norway');
  assert.match(calls[1].url, /\/forecast\/hourly\?units=si$/);
  assert.ok(calls.every(c => c.headers['User-Agent'].startsWith('Reach/1.0')));
});

test('outside the US the NWS is never asked', async () => {
  const { db } = fakeDb();
  const { f, calls } = fakeFetch(() => json(raw('met-bergen.json'), MET_HEADERS));
  await forecastFor(db, { lat: 60.39, lng: 5.32 }, { dates: ['2026-11-06'], country: 'NO' }, { now: RECORDED, fetch: f });
  assert.ok(calls.length === 1 && calls[0].url.includes('api.met.no'));
});

test('an NWS point it does not cover is remembered, and MET Norway answers instead', async () => {
  const { db, rows } = fakeDb();
  const { f } = fakeFetch(url => (url.includes('weather.gov') ? new Response('', { status: 404 }) : metOk()));
  const got = await forecastFor(db, MOAB, { dates: ['2026-11-06'] }, { now: RECORDED, fetch: f });
  assert.equal(got.days[0]?.source, 'met_norway');
  const nws = rows.find(r => r.source === 'nws') as ForecastRow;
  assert.equal(nws.status, 'not_covered');
  assert.ok(Date.parse(String(nws.next_ask_at)) > RECORDED.getTime() + 20 * 86_400_000);
});

// ── a plan's days ──

const twelve = (v: number) => Array.from({ length: 12 }, () => v);
const moabClimate = [{
  name: 'Moab', name_key: 'moab', country: 'US', lat: 38.57, lng: -109.55,
  t2m: twelve(10), t2m_range: twelve(14), precip_mm_day: twelve(0.7), rh2m: null, cloud_pct: null, wind_ms: null,
  grid_elevation_m: 1300, source: 'NASA POWER', period: '1981–2020', fetched_at: '2026-09-24T00:00:00Z',
}];
const plan = (over: Record<string, unknown> = {}) => ({
  id: 'p1', type: 'trip', start_date: '2026-11-11', end_date: '2026-11-16',
  destination_lat: 38.5733, destination_lng: -109.5498, destination_city: 'Moab', destination_country: 'US', ...over,
});
const moabFetch = () => fakeFetch(url => (url.includes('weather.gov') ? new Response('', { status: 404 }) : metOk()));

test('a plan: forecast days inside the range, usual weather past it, each labelled and credited', async () => {
  const { db } = fakeDb({ climate: moabClimate });
  const w = await planWeather(db, plan(), { now: RECORDED, fetch: moabFetch().f });
  assert.equal(w.forecastAvailable, true);
  assert.deepEqual(w.days.map(d => d.kind), ['forecast', 'forecast', 'forecast', 'usually', 'usually', 'usually']);
  const f = w.days[0];
  assert.ok(f.kind === 'forecast');
  assert.equal(f.label, 'Forecast');
  assert.equal(f.source.credit, 'Data from MET Norway');
  assert.equal(f.fetchedAt, RECORDED.toISOString());
  const u = w.days[4];
  assert.ok(u.kind === 'usually');
  assert.equal(u.label, 'Usually');
  assert.match(u.usually.line, /^Usually in November: /);
  assert.equal(u.credit, 'NASA POWER 1981–2020 averages for the area, not a forecast');
  assert.deepEqual(w.credits.map(c => c.text).sort(), ['Data from MET Norway', 'NASA POWER 1981–2020 averages for the area, not a forecast', 'Sunrise and sunset calculated from the date and place'].sort());
});

test('a plan before the migration: usual weather only, and it says why', async () => {
  const { db } = fakeDb({ missing: true, climate: moabClimate });
  const { f, calls } = moabFetch();
  const w = await planWeather(db, plan(), { now: RECORDED, fetch: f });
  assert.equal(w.forecastAvailable, false);
  assert.ok(w.days.every(d => d.kind === 'usually'));
  assert.equal(calls.length, 0);
});

test('a plan with no point and no climate says so, rather than guessing', async () => {
  const { db } = fakeDb();
  const w = await planWeather(db, plan({ destination_lat: null, destination_lng: null, destination_city: null }), { now: RECORDED });
  assert.ok(w.days.every(d => d.kind === 'none'));
  const none = await planWeather(db, plan({ start_date: null }), { now: RECORDED });
  assert.deepEqual(none.days, []);
  assert.match(String(none.reason), /no dates/);
});

test('an evening is its one date', async () => {
  const { db } = fakeDb({ climate: moabClimate });
  const w = await planWeather(db, plan({ type: 'restaurant', start_date: '2026-11-07', end_date: '2026-11-09' }), { now: RECORDED, fetch: moabFetch().f });
  assert.deepEqual(w.days.map(d => d.date), ['2026-11-07']);
});

test('the NWS grid is re-checked once a week, and the re-check restarts the week', async () => {
  const { f, calls } = fakeFetch(url => {
    if (url.includes('/points/')) return json(raw('nws-points-seattle.json'));
    return json(raw('nws-hourly-seattle.json'), { expires: 'Thu, 05 Nov 2026 17:18:24 GMT' });
  });
  const old = { hourlyUrl: 'https://api.weather.gov/gridpoints/SEW/125,68/forecast/hourly', tz: 'America/Los_Angeles', grid: 'SEW/125,68', checkedAt: '2026-10-27T16:00:00.000Z' };
  const first = await askNws(SEATTLE, old, { now: RECORDED, fetch: f });
  assert.equal(first.kind, 'ok');
  assert.equal(calls.filter(c => c.url.includes('/points/')).length, 1);
  // Same link as before — and still the week starts again from now.
  const meta = (first as { meta?: Record<string, unknown> }).meta as Record<string, unknown>;
  assert.equal(meta.checkedAt, RECORDED.toISOString());
  const later = new Date(RECORDED.getTime() + 3_600_000);
  await askNws(SEATTLE, meta, { now: later, fetch: f });
  assert.equal(calls.filter(c => c.url.includes('/points/')).length, 1, 'an hour later /points is not asked again');
  // Inside the week, the stamp it was given is kept.
  const kept = await askNws(SEATTLE, meta, { now: later, fetch: f });
  assert.equal((kept as { meta?: Record<string, unknown> }).meta?.checkedAt, RECORDED.toISOString());
});
