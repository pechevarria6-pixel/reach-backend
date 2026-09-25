// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, tripDay, rowWhen, clockOf, fold, escapeText, type IcsEvent } from '../../lib/ics.ts';
import { today } from '../../lib/calendar.ts';

// Half past eight on the third in New York, which the server calls the fourth.
const EVENING_ET = new Date('2026-10-04T00:30:00Z');

const lines = (ics: string) => ics.split('\r\n');
const only = (ics: string, prop: string) => lines(ics).filter(l => l.startsWith(prop));

function withTz<T>(tz: string, fn: () => T): T {
  const was = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
}

test('a dinner at half past eight on the third stays on the third, at 8pm Eastern', () => {
  // The clock has rolled over in UTC; the plan's own date has not.
  assert.equal(EVENING_ET.toISOString().slice(0, 10), '2026-10-04');
  const ics = buildIcs([
    { uid: 'p1-dinner', title: 'Dinner', date: '2026-10-03', time: '8:30 PM' },
    { uid: 'p1-walk', title: 'Walk the waterfront', date: '2026-10-03', time: 'Evening' },
  ], { name: 'Cabo', now: EVENING_ET });

  assert.deepEqual(only(ics, 'DTSTART'), [
    'DTSTART:20261003T203000',          // floating: half past eight where the trip is
    'DTSTART;VALUE=DATE:20261003',      // no time we can read → all day, on its own date
  ]);
  assert.ok(!only(ics, 'DTSTART').some(l => l.includes('20261004')), 'nothing slid onto the fourth');
  assert.ok(only(ics, 'DTEND').includes('DTEND;VALUE=DATE:20261004'), 'all-day end is exclusive');
  assert.ok(ics.includes('DTSTAMP:20261004T003000Z'), 'the stamp is the instant, in UTC');
});

test('the same file whichever zone the server runs in', () => {
  const events: IcsEvent[] = [
    { uid: 'a', title: 'Dinner', date: '2026-10-03', time: '20:30' },
    { uid: 'b', title: 'Beach day', date: '2026-10-03' },
  ];
  const utc = withTz('UTC', () => buildIcs(events, { name: 'Trip', now: EVENING_ET }));
  const ny = withTz('America/New_York', () => buildIcs(events, { name: 'Trip', now: EVENING_ET }));
  const tokyo = withTz('Asia/Tokyo', () => buildIcs(events, { name: 'Trip', now: EVENING_ET }));
  assert.equal(ny, utc);
  assert.equal(tokyo, utc);
});

test('a flight with an offset is its exact instant', () => {
  // 20:30 in New York on the third is 00:30 UTC on the fourth — the same
  // moment, which the calendar will show on the third for anyone in Eastern.
  const ics = buildIcs([{
    uid: 'f1', title: 'JFK → SJD', date: '2026-10-03',
    time: '2026-10-03T20:30:00-04:00', end: '2026-10-03T23:55:00-06:00',
  }], { name: 'Cabo', now: EVENING_ET });
  assert.deepEqual(only(ics, 'DTSTART'), ['DTSTART:20261004T003000Z']);
  assert.deepEqual(only(ics, 'DTEND'), ['DTEND:20261004T055500Z']);
});

test('day N is counted on the calendar, not the clock', () => {
  for (const tz of ['UTC', 'America/New_York', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    withTz(tz, () => {
      assert.equal(tripDay('2026-10-03', 1), '2026-10-03', tz);
      assert.equal(tripDay('2026-10-03', 3), '2026-10-05', tz);
      // Across the clocks going back in the US on 1 November.
      assert.equal(tripDay('2026-10-31', 3), '2026-11-02', tz);
      assert.equal(tripDay('2026-12-31', 2), '2027-01-01', tz);
    });
  }
});

test('a night out tonight uses the local today, never the UTC one', () => {
  // How a caller should get "tonight": the person's own calendar day.
  const tonight = withTz('America/New_York', () => today(EVENING_ET));
  assert.equal(tonight, '2026-10-03');
  const when = rowWhen('The main event', tonight);
  assert.deepEqual(when, { date: '2026-10-03', time: null });
});

test("an itinerary row's day and time are read, and a vague time is not invented", () => {
  assert.deepEqual(rowWhen('Day 3 · 7:30 PM', '2026-10-03'), { date: '2026-10-05', time: '7:30 PM' });
  assert.deepEqual(rowWhen('Day 1 · Morning', '2026-10-03'), { date: '2026-10-03', time: null });
  assert.deepEqual(rowWhen('Day 2', '2026-10-03'), { date: '2026-10-04', time: null });
  assert.equal(rowWhen('Day 2 · Noon', null), null, 'no start date, no date');
  assert.equal(rowWhen('Day 0', '2026-10-03'), null);
});

test('a row that starts with a day number is on that day, however it is written', () => {
  // Hand-added items have a free "Time / Day" box; none of these is day 1.
  assert.deepEqual(rowWhen('Day 3 at 7pm', '2026-10-01'), { date: '2026-10-03', time: '7pm' });
  assert.deepEqual(rowWhen('day 3 · evening', '2026-10-01'), { date: '2026-10-03', time: null });
  assert.deepEqual(rowWhen('Day 3 7:30 PM', '2026-10-01'), { date: '2026-10-03', time: '7:30 PM' });
  assert.deepEqual(rowWhen('DAY 12 - 19:30', '2026-10-01'), { date: '2026-10-12', time: '19:30' });
  assert.deepEqual(rowWhen('Day 3 evening drinks', '2026-10-01'), { date: '2026-10-03', time: null });
  assert.deepEqual(rowWhen('Day3', '2026-10-01'), { date: '2026-10-03', time: null });
  // A day number that names no day of the trip is no date, not day 1.
  assert.equal(rowWhen('day 0 at 7pm', '2026-10-01'), null);
  // Not a day number: stays on the start date.
  assert.deepEqual(rowWhen('Daytime walk', '2026-10-01'), { date: '2026-10-01', time: null });
});

test('only real clock times are times', () => {
  assert.deepEqual(clockOf('19:30'), { h: 19, m: 30 });
  assert.deepEqual(clockOf('7pm'), { h: 19, m: 0 });
  assert.deepEqual(clockOf('12:15 am'), { h: 0, m: 15 });
  assert.deepEqual(clockOf('12 PM'), { h: 12, m: 0 });
  for (const bad of ['Morning', '25:00', '13pm', '7:75 PM', '', null, 7]) assert.equal(clockOf(bad), null, String(bad));
});

test('a late night ends on the next date, and no end is invented', () => {
  const ics = buildIcs([
    { uid: 'bar', title: 'Late bar', date: '2026-10-03', time: '10:00 PM', end: '1:00 AM' },
    { uid: 'gig', title: 'Gig', date: '2026-10-03', time: '8:00 PM' },
  ], { name: 'Night', now: EVENING_ET });
  const ends = only(ics, 'DTEND');
  assert.deepEqual(ends, ['DTEND:20261004T010000']);
});

test('an event with no real date is left out rather than put on another day', () => {
  const ics = buildIcs([
    { uid: 'x', title: 'Nowhere', date: '2026-02-30' },
    { uid: 'y', title: '', date: '2026-10-03' },
    { uid: 'z', title: 'Fine', date: '2026-10-03' },
  ], { name: 'T', now: EVENING_ET });
  assert.equal(only(ics, 'BEGIN:VEVENT').length, 1);
  assert.ok(ics.includes('SUMMARY:Fine'));
});

test('text is escaped and long lines fold without splitting a character', () => {
  assert.equal(escapeText('Tacos, beer; a\\b\nnext'), 'Tacos\\, beer\\; a\\\\b\\nnext');
  const long = 'DESCRIPTION:' + 'Café '.repeat(30);
  const folded = fold(long);
  const enc = new TextEncoder();
  for (const part of folded.split('\r\n')) assert.ok(enc.encode(part).length <= 75, part);
  assert.equal(folded.split('\r\n').map((p, i) => (i ? p.slice(1) : p)).join(''), long);
  assert.ok(!folded.includes('�'));
});

test('the file is a calendar: CRLF, wrapped, a URL only when it is one', () => {
  const ics = buildIcs([{ uid: 'u', title: 'Museum', date: '2026-10-04', url: 'javascript:alert(1)', location: '1 Main St, Cabo' }], { name: 'Cabo trip', now: EVENING_ET });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!ics.includes('URL:'));
  assert.ok(ics.includes('LOCATION:1 Main St\\, Cabo'));
  assert.ok(ics.includes('UID:u@alcanzar.io'));
});
