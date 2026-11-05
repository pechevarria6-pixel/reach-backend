// The day-before weather ping: only for a line we hold, only when the cached
// forecast spoils it, once per line per day, never to somebody muted.
// The forecast is the real NWS answer for Seattle recorded 2026-11-05, which
// has rain likely (80%) on the afternoon of the 6th.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dueWeatherPings, linesForTomorrow, runPings, type PingPlan, type PingLine, type WeatherPingInput } from '../../lib/pings.ts';
import { parseNwsHourly, forecastDays, type Parsed } from '../../lib/forecast.ts';
import type { HeldDay, PlaceForecast } from '../../lib/forecast-store.ts';
import { alternativesFor } from '../../lib/itinerary-alternatives.ts';

const parsed = parseNwsHourly(JSON.parse(readFileSync(new URL('./fixtures/forecast/nws-hourly-seattle.json', import.meta.url), 'utf8')), 'America/Los_Angeles') as Parsed;
// Seattle, -122.33°, is UTC-8 by longitude: 14:00 on the 5th there.
const NOW = new Date('2026-11-05T22:00:00Z');
const SEATTLE = { lat: 47.61, lng: -122.33 };
const days: HeldDay[] = forecastDays(parsed, SEATTLE, NOW).map(d => ({ ...d, fetchedAt: '2026-11-05T16:18:00.000Z' }));
const FRI = days.find(d => d.date === '2026-11-06') as HeldDay;

const LINE = '6f1c0a52-3b7e-4c1d-9a55-0d2b8e7f4a10';
const MUSEUM = '7a2d1b63-4c8f-4d2e-8b66-1e3c9f805b21';
const plan = (over: Partial<PingPlan> = {}): PingPlan => ({
  id: 'p1', group_id: 'g1', title: 'Seattle weekend', type: 'trip', status: 'booked',
  start_date: '2026-11-06', end_date: '2026-11-08', solo_mode: false, created_by: 'ana',
  destination_lng: -122.33, destination_lat: 47.61, destination_country: 'US', ...over,
});
const hike: PingLine = { id: LINE, type: 'activity', title: 'Discovery Park loop trail', scheduled_time: 'Day 1 · Afternoon', is_confirmed: false };
const museum: PingLine = { id: MUSEUM, type: 'activity', title: 'Seattle Art Museum', scheduled_time: 'Day 1 · Afternoon', is_confirmed: false };
const input = (over: Partial<WeatherPingInput> = {}): WeatherPingInput => ({
  plan: plan(), memberIds: ['ana', 'ben'], lines: [hike], bookings: [], optOuts: new Map(),
  tomorrow: FRI, kinds: new Map([[LINE, 'park'], [MUSEUM, 'museum']]), ...over,
});

test('rain likely tomorrow afternoon on an outdoor line: one ping each, to Change on that line', () => {
  const due = dueWeatherPings(input(), NOW);
  assert.equal(due.length, 2);
  const [a] = due;
  assert.equal(a.kind, 'weather');
  assert.equal(a.localDay, '2026-11-05');
  assert.equal(a.note.title, 'Rain likely tomorrow afternoon (80%)');
  assert.match(String(a.note.body), /^“Discovery Park loop trail” is outdoors\. Want to look at an indoor swap for the group\? Forecast data from weather\.gov/);
  assert.equal(a.note.url, `/home?group=g1&plan=p1&change=${LINE}`);
  // Claimed per line, inside ping_log's slug rule.
  assert.equal(a.claimKind, `weather_${LINE.replace(/-/g, '')}`);
  assert.match(String(a.claimKind), /^[a-z][a-z0-9_]{1,47}$/);
});

test('a trip of one is spoken to as one', () => {
  const due = dueWeatherPings(input({ plan: plan({ solo_mode: true }), memberIds: ['ana'] }), NOW);
  assert.equal(due.length, 1);
  assert.match(String(due[0].note.body), /is outdoors\. Want an indoor swap\?/);
  assert.doesNotMatch(String(due[0].note.body), /group/);
});

test('indoors, another part of the day, another day, or no forecast: nothing', () => {
  assert.equal(dueWeatherPings(input({ lines: [museum] }), NOW).length, 0);
  assert.equal(dueWeatherPings(input({ lines: [{ ...hike, scheduled_time: 'Day 1 · Morning' }] }), NOW).length, 0);
  assert.equal(dueWeatherPings(input({ lines: [{ ...hike, scheduled_time: 'Day 2 · Afternoon' }] }), NOW).length, 0);
  assert.equal(dueWeatherPings(input({ tomorrow: null }), NOW).length, 0);
  // A forecast for some other day is not tomorrow's.
  assert.equal(dueWeatherPings(input({ tomorrow: days.find(d => d.date === '2026-11-07') as HeldDay }), NOW).length, 0);
});

test('only inside the window, on the trip\'s clock', () => {
  // 09:00 in Seattle.
  assert.equal(dueWeatherPings(input(), new Date('2026-11-05T17:00:00Z')).length, 0);
  assert.equal(linesForTomorrow(plan(), [hike], new Date('2026-11-05T17:00:00Z')), null);
  // A plan with no point on the map has no clock, and no ping.
  assert.equal(dueWeatherPings(input({ plan: plan({ destination_lng: null }) }), NOW).length, 0);
});

test('a line with no venue is judged on its words; a line we cannot place is not a hike', () => {
  const walk: PingLine = { ...hike, title: 'Hike the Rattlesnake Ledge trail' };
  assert.equal(dueWeatherPings(input({ lines: [walk], kinds: new Map() }), NOW).length, 2);
  const vague: PingLine = { ...hike, title: 'Free afternoon' };
  assert.equal(dueWeatherPings(input({ lines: [vague], kinds: new Map() }), NOW).length, 0);
});

test('a booked outdoor line is not offered a swap it cannot have', () => {
  const due = dueWeatherPings(input({ bookings: [{ id: 'b1', itinerary_item_id: LINE, status: 'confirmed', vertical: 'activity', mode: 'native' }] }), NOW);
  assert.match(String(due[0].note.body), /It is booked, so check with them before you go\./);
  assert.doesNotMatch(String(due[0].note.body), /swap/);
});

test('somebody sitting the line out is not told about it', () => {
  const bookings = [{ id: 'b1', itinerary_item_id: LINE, status: 'confirmed', vertical: 'activity', mode: 'native' }];
  const due = dueWeatherPings(input({ bookings, optOuts: new Map([['b1', new Set(['ben'])]]) }), NOW);
  assert.deepEqual(due.map(d => d.userId), ['ana']);
});

// ── the run: claimed per line, once a day, muted plans left alone ──

type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  const claimed = new Set<string>();
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let pending: { op: 'insert' | 'update'; rows: unknown } | null = null;
    const result = async () => {
      if (pending?.op === 'insert' && table === 'ping_log') {
        const r = pending.rows as Row;
        const key = `${r.plan_id}|${r.user_id}|${r.kind}|${r.local_day}`;
        if (claimed.has(key)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        claimed.add(key);
        return { data: { id: key }, error: null };
      }
      if (pending) return { data: null, error: null };
      return { data: (tables[table] ?? []).filter(r => filters.every(f => f(r))), error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q, not: () => q, lte: () => q, gte: () => q, or: () => q, limit: () => q, order: () => q,
      eq: (c: string, v: unknown) => { filters.push(r => r[c] === v); return q; },
      in: (c: string, vs: unknown[]) => { filters.push(r => vs.includes(r[c])); return q; },
      insert: (rows: unknown) => { pending = { op: 'insert', rows }; return q; },
      update: (rows: unknown) => { pending = { op: 'update', rows }; return q; },
      single: () => result(), maybeSingle: () => result(),
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => result().then(ok, bad),
    };
    return q;
  };
  return { db: { from } as never, claimed };
}
const world = (extra: Partial<Record<string, Row[]>> = {}) => ({
  plans: [plan() as unknown as Row],
  group_members: [{ group_id: 'g1', user_id: 'ana' }, { group_id: 'g1', user_id: 'ben' }],
  itinerary_items: [{ ...hike, plan_id: 'p1', venue_ref: 'v1' }, { ...museum, plan_id: 'p1', venue_ref: 'v2' }],
  discovery_venues: [{ id: 'v1', kind: 'park' }, { id: 'v2', kind: 'museum' }],
  bookings: [], item_optouts: [], plan_notification_mutes: [], push_subscriptions: [],
  ...extra,
});
const forecast = (asked: string[]) => async (_db: unknown, _at: unknown, want: { dates: string[] }): Promise<PlaceForecast> => {
  asked.push(...want.dates);
  return { available: true, days: days.filter(d => want.dates.includes(d.date)) };
};

test('the run: each person once for the hike, nothing for the museum, nothing on a second run', async () => {
  const { db, claimed } = fakeDb(world());
  const asked: string[] = [];
  const first = await runPings(db, { now: NOW, send: null, aero: null, forecast: forecast(asked) });
  assert.equal(first.sent.weather, 2);
  assert.deepEqual(asked, ['2026-11-06']);
  assert.ok([...claimed].every(k => k.includes(`weather_${LINE.replace(/-/g, '')}`)));
  const second = await runPings(db, { now: new Date(NOW.getTime() + 3_600_000), send: null, aero: null, forecast: forecast(asked) });
  assert.equal(second.sent.weather ?? 0, 0);
  assert.equal(second.already, 2);
});

test('the run: somebody who muted the plan hears nothing', async () => {
  const { db } = fakeDb(world({ plan_notification_mutes: [{ plan_id: 'p1', user_id: 'ben' }] }));
  const r = await runPings(db, { now: NOW, send: null, aero: null, forecast: forecast([]) });
  assert.equal(r.sent.weather, 1);
  assert.equal(r.muted, 1);
});

test('the run: no forecast held, no ping, and the skip is counted', async () => {
  const { db } = fakeDb(world());
  const r = await runPings(db, { now: NOW, send: null, aero: null, forecast: async () => ({ available: true, days: [] }) });
  assert.equal(r.sent.weather ?? 0, 0);
  assert.equal(r.skipped.weather_no_forecast, 1);
});

// ── Change, after the ping ──

test('Change on a rained-off park offers somewhere with a roof, never another park', () => {
  const places = [
    { ref: 'p1', name: 'Discovery Park', kind: 'park', interest: null, url: null, city: 'Seattle', source: 'osm', lat: 47.66, lng: -122.41 },
    { ref: 'p2', name: 'Volunteer Park', kind: 'park', interest: null, url: null, city: 'Seattle', source: 'osm', lat: 47.63, lng: -122.31 },
    { ref: 'p3', name: 'Seattle Art Museum', kind: 'museum', interest: null, url: null, city: 'Seattle', source: 'osm', lat: 47.61, lng: -122.34 },
  ];
  const line = { id: 'l1', type: 'activity', title: 'Discovery Park loop', scheduled_time: 'Day 1 · Afternoon', venue_name: 'Discovery Park' };
  const dry = alternativesFor({ line, lines: [line], places, nightOut: false, startDate: '2026-11-06' });
  assert.ok(dry.status === 'ok' && dry.alternatives[0].name === 'Volunteer Park');
  const wet = alternativesFor({ line, lines: [line], places, nightOut: false, startDate: '2026-11-06', preferIndoor: true });
  assert.ok(wet.status === 'ok');
  assert.deepEqual(wet.alternatives.map(a => a.name), ['Seattle Art Museum']);
});
