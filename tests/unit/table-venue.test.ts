// A table's platform id comes from the exact venue row its line cites —
// never from a row found by name near the trip, which a chain's other branch
// also is. Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heldVenueByRef, venueRefOf } from '../../lib/discovery/held-venue.ts';
import { tableVenueFacts } from '../../lib/reservations/table-venue.ts';

const REF = '3f2b1c9e-8d7a-4c6b-9e5f-0a1b2c3d4e5f';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
type Row = Record<string, any>;

/** Enough of supabase-js for one read by id: eq, is, maybeSingle — and a record of every filter asked. */
function fakeDb(rows: Row[], opts: { noGoneAt?: boolean } = {}) {
  const asked: Array<[string, string, unknown]> = [];
  const db: any = {
    from(table: string) {
      assert.equal(table, 'discovery_venues');
      const filters: Array<(r: Row) => boolean> = [];
      let error: { code: string; message: string } | null = null;
      const b: any = {
        select() { return b; },
        eq(c: string, v: unknown) { asked.push(['eq', c, v]); filters.push(r => r[c] === v); return b; },
        is(c: string, v: unknown) {
          asked.push(['is', c, v]);
          if (opts.noGoneAt && c === 'gone_at') error = { code: '42703', message: 'column discovery_venues.gone_at does not exist' };
          filters.push(r => (r[c] ?? null) === v); return b;
        },
        ilike(c: string, v: unknown) { asked.push(['ilike', c, v]); return b; },
        async maybeSingle() {
          if (error) return { data: null, error };
          return { data: rows.find(r => filters.every(f => f(r))) ?? null, error: null };
        },
      };
      return b;
    },
  };
  return { db, asked };
}

const luigisHere = { id: REF, name: "Luigi's", lng: -78.64, reservation_platform: 'opentable', reservation_url: 'https://www.opentable.com/r/luigis-raleigh?rid=4821', phone: '+19195550100', opening_hours: 'Mo-Su 11:00-22:00', gone_at: null };
const luigisThere = { ...luigisHere, id: OTHER, reservation_url: 'https://www.opentable.com/r/luigis-cary?rid=9999', phone: '+19195550199' };

test('the venue is read by the id the line cites, and nothing is looked up by name', async () => {
  const { db, asked } = fakeDb([luigisThere, luigisHere]);
  const { venue } = await heldVenueByRef(db, REF);
  assert.equal(venue?.id, REF);
  assert.equal(venue?.reservation_url, luigisHere.reservation_url, 'this branch, not the other one');
  assert.ok(asked.some(([k, c, v]) => k === 'eq' && c === 'id' && v === REF));
  assert.ok(!asked.some(([k]) => k === 'ilike'), 'no name lookup');
});

test('no ref, a ref that is not an id, or a row the map has lost: no venue, and no read', async () => {
  for (const ref of [null, undefined, '', "Luigi's", 'v:1a2b3c4d', 'p4']) {
    const { db, asked } = fakeDb([luigisHere]);
    assert.equal((await heldVenueByRef(db, ref)).venue, null, String(ref));
    assert.equal(asked.length, 0, `nothing read for ${String(ref)}`);
  }
  const gone = fakeDb([{ ...luigisHere, gone_at: '2026-10-01T00:00:00Z' }]);
  assert.equal((await heldVenueByRef(gone.db, REF)).venue, null, 'a place two loads did not find is not one to book');
  // Before gone_at exists, the row is read without it.
  const early = fakeDb([luigisHere], { noGoneAt: true });
  assert.equal((await heldVenueByRef(early.db, REF)).venue?.id, REF);
  assert.equal(venueRefOf(REF.toUpperCase()), REF);
});

const base = { restaurant: "Luigi's", city: 'Raleigh', date: '2026-11-07', time: '19:30', partySize: 4 };

test('the platform id can only come from the cited row', () => {
  const cited = tableVenueFacts({ ...base, venue: luigisHere, line: { venue_phone: null }, stored: null });
  assert.equal(cited.platform, 'opentable');
  assert.deepEqual(cited.urls, [luigisHere.reservation_url]);
  assert.equal(cited.phone, '+19195550100');

  // No cited row: whatever an earlier name lookup wrote on the booking row is
  // not a platform id. Nothing to book instantly; the line's own number stays.
  const none = tableVenueFacts({ ...base, venue: null, line: { venue_phone: '+19195550123' }, stored: { phone: '+19195550199' } });
  assert.equal(none.platform, 'none');
  assert.deepEqual(none.urls, [], 'no link an instant booking could read an id from');
  assert.equal(none.phone, '+19195550123', "the line's own number, not the other branch's");
  assert.equal(none.reserveUrl, null);

  // A row with no line left keeps the number it stored, and still no platform.
  const loose = tableVenueFacts({ ...base, venue: null, line: null, stored: { phone: '+19195550199' } });
  assert.equal(loose.phone, '+19195550199');
  assert.deepEqual(loose.urls, []);
});
