// The restaurant a booking line names, found near the trip and nowhere else.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { heldVenueNear, likeExactly } from '../../lib/discovery/held-venue.ts';

type Row = Record<string, any>;
const RALEIGH = { lat: 35.7796, lng: -78.6382 };
const COLUMBUS = { lat: 39.9612, lng: -82.9988 };

/** Enough of supabase-js for one venue lookup: ILIKE as Postgres reads it, boxes, gone_at. */
function fakeDb(rows: Row[], opts: { noGoneAt?: boolean; noRegion?: boolean } = {}) {
  const from = () => {
    const filters: Array<(r: Row) => boolean> = [];
    let error: { code: string; message: string } | null = null;
    let limit = Infinity;
    const b: any = {
      select(cols: string) {
        if (opts.noRegion && /\bregion\b/.test(cols)) error = { code: '42703', message: 'column discovery_venues.region does not exist' };
        return b;
      },
      ilike(c: string, pattern: string) {
        // PostgREST reads * as %, then LIKE with backslash escapes.
        let re = '';
        for (let i = 0; i < pattern.length; i++) {
          const ch = pattern[i];
          if (ch === '\\') { re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
          re += ch === '%' || ch === '*' ? '.*' : ch === '_' ? '.' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
        const rx = new RegExp(`^${re}$`, 'i');
        filters.push(r => rx.test(String(r[c])));
        return b;
      },
      neq(c: string, v: unknown) { filters.push(r => r[c] !== v); return b; },
      gte(c: string, v: number) { filters.push(r => r[c] >= v); return b; },
      lte(c: string, v: number) { filters.push(r => r[c] <= v); return b; },
      is(c: string) {
        if (c === 'gone_at' && opts.noGoneAt) error = { code: '42703', message: 'column discovery_venues.gone_at does not exist' };
        filters.push(r => r[c] == null);
        return b;
      },
      limit(n: number) { limit = n; return b; },
      then(resolve: (v: unknown) => void) {
        if (error) return resolve({ data: null, error });
        return resolve({ data: rows.filter(r => filters.every(f => f(r))).slice(0, limit), error: null });
      },
    };
    return b;
  };
  return { from } as any;
}

const row = (name: string, at: { lat: number; lng: number }, over: Row = {}): Row => ({
  name, ...at, interest: 'places to eat', gone_at: null,
  reservation_platform: null, reservation_url: null, phone: null, ...over,
});

test('the same name in another state is not this trip\'s restaurant', async () => {
  // Stored first, the way an unordered name-only lookup would have found it.
  const db = fakeDb([
    row('The Crown', COLUMBUS, { phone: '+16145550100' }),
    row('The Crown', { lat: RALEIGH.lat + 0.01, lng: RALEIGH.lng }, { phone: '+19195550100' }),
  ]);
  const { venue } = await heldVenueNear(db, 'The Crown', RALEIGH);
  assert.equal(venue?.phone, '+19195550100');
  const nothingHere = await heldVenueNear(fakeDb([row('The Crown', COLUMBUS, { phone: '+16145550100' })]), 'The Crown', RALEIGH);
  assert.equal(nothingHere.venue, null, 'no number is better than a number in Ohio');
});

test('a trip we cannot place looks nothing up', async () => {
  const { venue } = await heldVenueNear(fakeDb([row('The Crown', RALEIGH, { phone: '+19195550100' })]), 'The Crown', null);
  assert.equal(venue, null);
});

test('a venue the map loads have retired is not somewhere to ring; before the migration nothing is retired', async () => {
  const gone = [row('Closed Grill', RALEIGH, { phone: '+19195550111', gone_at: '2026-09-21T06:17:00Z' })];
  assert.equal((await heldVenueNear(fakeDb(gone), 'Closed Grill', RALEIGH)).venue, null);
  const unmigrated = [row('Open Grill', RALEIGH, { phone: '+19195550112' })];
  assert.equal((await heldVenueNear(fakeDb(unmigrated, { noGoneAt: true }), 'Open Grill', RALEIGH)).venue?.phone, '+19195550112');
});

test('a wildcard in a name matches only itself', async () => {
  assert.equal(likeExactly('100% Burger'), '100\\% Burger');
  assert.equal(likeExactly('Bar_One'), 'Bar\\_One');
  const db = fakeDb([row('100 Burgers Galore', RALEIGH, { phone: '+19195550113' }), row('Bar One', RALEIGH, { phone: '+19195550114' })]);
  assert.equal((await heldVenueNear(db, '100% Burger', RALEIGH)).venue, null);
  assert.equal((await heldVenueNear(db, 'Bar_One', RALEIGH)).venue, null);
  assert.equal((await heldVenueNear(db, 'bar one', RALEIGH)).venue?.phone, '+19195550114', 'case aside, the same name');
});

test('a hotel is never a restaurant\'s front desk', async () => {
  const db = fakeDb([row('The Umstead', RALEIGH, { interest: 'places to stay', phone: '+19195550115' })]);
  assert.equal((await heldVenueNear(db, 'The Umstead', RALEIGH)).venue, null);
});

test('a namesake across the border is not this trip\'s restaurant: El Paso and Ciudad Juárez', async () => {
  const EL_PASO = { lat: 31.7619, lng: -106.485 };
  // Downtown Juárez is nearer the point El Paso geocodes to than the El Paso branch is.
  const juarez = row('Starbucks', { lat: 31.745, lng: -106.485 }, { phone: '+526561234567', reservation_url: 'https://example.mx/reservar', region: 'north-america/mexico' });
  const elPaso = row('Starbucks', { lat: 31.80, lng: -106.43 }, { phone: '+19155550100', region: 'north-america/us/texas' });
  const db = fakeDb([juarez, elPaso]);
  for (const country of ['us', 'US']) {
    const { venue } = await heldVenueNear(db, 'Starbucks', EL_PASO, { country });
    assert.equal(venue?.phone, '+19155550100', 'the El Paso branch, not the +52 number');
    assert.equal(venue?.reservation_url, null, 'not the Mexican booking page');
  }
  assert.equal((await heldVenueNear(fakeDb([juarez]), 'Starbucks', EL_PASO, { country: 'us' })).venue, null, 'only Juárez held: nothing, not a number across the river');
  // And the other way: a Juárez trip is not handed the El Paso branch.
  assert.equal((await heldVenueNear(db, 'Starbucks', { lat: 31.69, lng: -106.42 }, { country: 'mx' })).venue?.phone, '+526561234567');
});

test('the border check drops only what it is sure of', async () => {
  const EL_PASO = { lat: 31.7619, lng: -106.485 };
  const juarez = row('Starbucks', { lat: 31.745, lng: -106.485 }, { phone: '+526561234567', region: 'north-america/mexico' });
  assert.equal((await heldVenueNear(fakeDb([juarez]), 'Starbucks', EL_PASO)).venue?.phone, '+526561234567', 'no trip country, no guess');
  const swept = row('Starbucks', { lat: 31.745, lng: -106.485 }, { phone: '+19155550199', region: null });
  assert.equal((await heldVenueNear(fakeDb([swept]), 'Starbucks', EL_PASO, { country: 'us' })).venue?.phone, '+19155550199', 'a sweep row has no region and is kept');
  // Before the migration there is no region column: read as before.
  assert.equal((await heldVenueNear(fakeDb([swept], { noRegion: true }), 'Starbucks', EL_PASO, { country: 'us' })).venue?.phone, '+19155550199');
});

test('the booking screen hands the lookup the trip\'s country', () => {
  const route = readFileSync('app/api/plans/[planId]/bookable/route.ts', 'utf8');
  const calls = route.match(/heldVenueNear\([^;]*\)/g) ?? [];
  assert.ok(calls.length > 0, 'the route still looks venues up');
  for (const call of calls) assert.match(call, /country:/, `no country passed: ${call}`);
  assert.match(route, /at\?\.countryCode/, 'the geocoder\'s code, as the menu uses it');
});
