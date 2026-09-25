// ─── npm run coverage, counted on a fixture ─────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countCoverage, parseTowns, formatTable, isChecked, addDays, PASS_AT } from '../../lib/coverage.ts';

// A town at Raleigh's latitude; one degree of latitude
// is about 69 miles, so 0.01° north is ~0.69 mi.
const AT = { lat: 35.78, lng: -78.64 };
const north = (miles: number) => ({ lat: AT.lat + miles / 69, lng: AT.lng });
const venue = (miles: number, extra: Record<string, unknown> = {}) =>
  ({ ...north(miles), name: `Place ${miles}`, website: 'https://example.com', interest: 'places to eat', gone_at: null, ...extra });

test('venues are counted into every ring they fall inside, checked ones only', () => {
  const venues = [
    venue(1), venue(1.9), venue(4), venue(11), venue(24), venue(30),
    venue(1, { website: null }),               // no website: not checked
    venue(1, { website: 'example.com' }),      // not a link we can send anybody to
    venue(1, { interest: 'places to stay' }),  // a hotel is not on the menu
    venue(1, { gone_at: '2026-09-01' }),       // marked gone
    venue(1, { name: '  ' }),
    { lat: null, lng: null, name: 'Nowhere', website: 'https://x.com' }, // not Null Island
  ];
  const r = countCoverage('Raleigh', AT, venues, [], { today: '2026-09-24' });
  assert.deepEqual(r.venues, { 2: 2, 5: 3, 12: 4, 25: 5 });
  assert.equal(r.verdict, 'THIN');
  assert.equal(isChecked(venue(1)), true);
});

test('PASS at 20 checked venues within 25 miles, THIN at 19', () => {
  const nineteen = Array.from({ length: PASS_AT - 1 }, (_, i) => venue(20 + i * 0.1));
  assert.equal(countCoverage('t', AT, nineteen, [], { today: '2026-09-24' }).verdict, 'THIN');
  assert.equal(countCoverage('t', AT, [...nineteen, venue(24.9)], [], { today: '2026-09-24' }).verdict, 'PASS');
});

test('events: dated, from today through 14 days, still fresh, within 25 miles', () => {
  const now = '2026-09-24T12:00:00Z';
  const events = [
    { ...north(3), starts_on: '2026-09-24', stale_after: '2026-10-30T00:00:00Z' },   // today
    { ...north(3), starts_on: '2026-10-08', stale_after: '2026-10-30T00:00:00Z' },   // day 14
    { ...north(3), starts_on: '2026-10-09', stale_after: '2026-10-30T00:00:00Z' },   // day 15
    { ...north(3), starts_on: '2026-09-23', stale_after: '2026-10-30T00:00:00Z' },   // yesterday
    { ...north(3), starts_on: null, stale_after: '2026-10-30T00:00:00Z' },           // weekly, undated
    { ...north(3), starts_on: '2026-09-30', stale_after: '2026-09-20T00:00:00Z' },   // expired
    { ...north(40), starts_on: '2026-09-30', stale_after: '2026-10-30T00:00:00Z' },  // too far
    { lat: null, lng: null, starts_on: '2026-09-30', stale_after: '2026-10-30T00:00:00Z', discovery_venues: north(10) }, // venue's point
    { lat: null, lng: null, starts_on: '2026-09-30', stale_after: '2026-10-30T00:00:00Z', discovery_venues: null },      // nowhere
  ];
  const r = countCoverage('t', AT, [], events, { today: '2026-09-24', now });
  assert.equal(r.events, 3);
  assert.equal(addDays('2026-09-24', 14), '2026-10-08');
});

test('the towns file: one per line, comments and blanks ignored', () => {
  assert.deepEqual(parseTowns('# header\n\nRaleigh, NC\n  Moab, UT  # for Sam\n#Fayetteville\n'), ['Raleigh, NC', 'Moab, UT']);
  const shipped = readFileSync('scripts/beta-towns.txt', 'utf8');
  assert.match(shipped, /^# /, 'starts with a comment header');
  assert.deepEqual(parseTowns(shipped), [], 'left for the owner to fill');
});

test('the table shows every ring, the events and the verdict, and a town that could not be placed', () => {
  const r = countCoverage('Raleigh, NC', AT, [venue(1)], [], { today: '2026-09-24' });
  const t = formatTable([r, { town: 'Nowhere', error: 'could not place' }]);
  assert.match(t, /≤2 mi\s+≤5 mi\s+≤12 mi\s+≤25 mi\s+Events 14d\s+Result/);
  assert.match(t, /Raleigh, NC\s+1\s+1\s+1\s+1\s+0\s+THIN/);
  assert.match(t, /Nowhere .*could not place/);
});

test('a report, not a gate: always exits 0, read-only, and not in verify', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.scripts.coverage, 'node scripts/coverage.mjs');
  assert.doesNotMatch(pkg.scripts.verify, /coverage/);
  const script = readFileSync('scripts/coverage.mjs', 'utf8');
  assert.doesNotMatch(script, /process\.exit\([^0]/);
  assert.doesNotMatch(script, /\.(insert|update|upsert|delete)\(/);
});
