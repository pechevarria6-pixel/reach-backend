// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leaveDay, trimLeaveDay, departsAt } from '../../lib/leave-day.ts';
import { dropFillerDays } from '../../lib/trip-schema.ts';

test('an evening flight home leaves a morning and an afternoon, over three hours before it', () => {
  const d = leaveDay({ wanted: true, returnDeparts: '2026-12-06T19:30:00' });
  assert.deepEqual(d.parts, ['morning', 'afternoon']);
  assert.equal(d.until, '16:30');
});

test('a midday flight leaves a morning; an early one leaves nothing', () => {
  assert.deepEqual(leaveDay({ wanted: true, returnDeparts: '2026-12-06T15:00:00' }).parts, ['morning']);
  assert.equal(leaveDay({ wanted: true, returnDeparts: '2026-12-06T15:00:00' }).until, '12:00');
  assert.deepEqual(leaveDay({ wanted: true, returnDeparts: '2026-12-06T09:15:00' }).parts, []);
});

test('no flight time held: a light morning, done by eleven; switched off: nothing', () => {
  assert.deepEqual(leaveDay({ wanted: true }), { parts: ['morning'], until: '11:00', because: 'no return flight time held, so a light morning done by 11' });
  assert.deepEqual(leaveDay({ wanted: false, returnDeparts: '2026-12-06T19:30:00' }).parts, []);
});

test('departure times are read from the airport\'s own local clock, not converted', () => {
  assert.equal(departsAt('2026-12-06T03:52:00'), 3 * 60 + 52);
  assert.equal(departsAt('15:05'), 15 * 60 + 5);
  assert.equal(departsAt(null), null);
  assert.equal(departsAt('soon'), null);
});

test('the day they leave keeps only the parts they are there for, and survives the filler filter', () => {
  const slot = (plan: string) => ({ plan, cost: 0, booking: 'walk_in' });
  const day = { day: 3, title: 'Last morning', morning: slot('Coffee and a walk on the Battery'), afternoon: slot('Head home.'), evening: slot('Head home.'), cost_today: 10 };
  const trimmed = trimLeaveDay(day, { parts: ['morning'], until: '11:00', because: '' });
  assert.equal(trimmed.afternoon, null);
  assert.equal(trimmed.evening, null);
  assert.equal(dropFillerDays([trimmed as never]).length, 1, 'an empty part on purpose is not filler');
  const empty = trimLeaveDay(day, { parts: [], until: null, because: '' });
  assert.equal(dropFillerDays([empty as never]).length, 0, 'a day with nothing in it is still dropped');
});

test('the generator asks for the extra day only when one is planned, and trims it after', () => {
  const src = readFileSync('app/api/trips/generate/route.ts', 'utf8');
  assert.match(src, /leave = leaveDay\(\{ wanted: homeDay !== false, returnDeparts \}\)/);
  assert.match(src, /Write one entry for each of the \$\{nights \+ leaveCount\} days/);
  assert.match(src, /Number\(d\?\.day\) === nights \+ 1 \? trimLeaveDay\(d, leave\)/);
});

test('the plan screen offers the day they leave as a switch, on by default, and sends it', () => {
  const src = readFileSync('components/reach-app.jsx', 'utf8');
  assert.match(src, /const \[homeDay,setHomeDay\]=useState\(true\)/);
  assert.match(src, /homeDay:!oneEvening&&homeDay/);
  assert.match(src, /Plan the day \{soloTrip\?"you leave":"you all leave"\} too/);
});
