// cachedEvents against a fake table: a class at a venue the weekly map loads
// have retired is not on, and an unmigrated database still reads.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cachedEvents } from '../../lib/discovery/cache.ts';

type Row = Record<string, any>;
const RALEIGH = { lat: 35.7796, lng: -78.6382 };
const venue = (name: string, gone_at: string | null) => ({ name, lat: RALEIGH.lat, lng: RALEIGH.lng, city: 'Raleigh', street: null, gone_at });
const cls = (id: number, title: string, v: Row): Row => ({
  id, title, starts_on: null, when_text: 'Wednesdays 7pm', price_text: null, booking_url: `https://${id}.example`,
  interest: 'pottery & crafts', source: 'harvest', venue_name: null, lat: null, lng: null, city: null,
  stale_after: '2099-01-01T00:00:00Z', discovery_venues: v,
});

/** Enough supabase-js for cachedEvents: embedded-column filters and nothing clever. */
function fakeDb(events: Row[], opts: { noGoneAt?: boolean } = {}) {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let error: { code: string; message: string } | null = null;
    const get = (r: Row, c: string) => c.includes('.') ? (r[c.split('.')[0]] ?? {})[c.split('.')[1]] : r[c];
    const b: any = {
      select() { return b; },
      eq(c: string, v: unknown) { filters.push(r => get(r, c) === v); return b; },
      neq(c: string, v: unknown) { filters.push(r => get(r, c) !== v); return b; },
      in(c: string, vs: unknown[]) { filters.push(r => vs.includes(get(r, c))); return b; },
      gt() { return b; }, gte() { return b; }, lte() { return b; }, or() { return b; }, order() { return b; },
      is(c: string) {
        if (/gone_at/.test(c) && opts.noGoneAt) error = { code: '42703', message: 'column discovery_venues.gone_at does not exist' };
        filters.push(r => get(r, c) == null);
        return b;
      },
      limit() { return b; },
      then(resolve: (v: unknown) => void) {
        if (error) return resolve({ data: null, error });
        return resolve({ data: table === 'discovery_events' ? events.filter(r => filters.every(f => f(r))) : [], error: null });
      },
    };
    return b;
  };
  return { from } as any;
}

const SEEKER = { ...RALEIGH, city: 'Raleigh', interests: ['pottery & crafts'], avoid: [] };

test('a class at a venue the map loads have retired is not shown', async () => {
  const events = [
    cls(1, 'Wheel throwing taster', venue('Open Studio', null)),
    cls(2, 'Glaze night', venue('Closed Studio', '2026-09-21T06:17:00Z')),
  ];
  const res = await cachedEvents(fakeDb(events), SEEKER as never);
  assert.equal(res.status, 'ok');
  assert.deepEqual(res.findings.map(f => f.title), ['Wheel throwing taster']);
});

test('before gone_at exists, harvested classes still read', async () => {
  const events = [cls(1, 'Wheel throwing taster', venue('Open Studio', null))];
  const res = await cachedEvents(fakeDb(events, { noGoneAt: true }), SEEKER as never);
  assert.equal(res.status, 'ok');
  assert.deepEqual(res.findings.map(f => f.title), ['Wheel throwing taster']);
});
