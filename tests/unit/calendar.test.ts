// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSections, planDay, daysAway, today, dayWhere, groupSchedule, byName } from '../../lib/calendar.ts';

// Half past eight on the sixteenth in New York, which the server calls the
// seventeenth. Every evening in the Americas looks like this.
const EVENING = new Date('2026-09-17T00:30:00Z');

test('the server asks what day it is where the person is', () => {
  assert.equal(EVENING.toISOString().slice(0, 10), '2026-09-17');
  assert.equal(dayWhere(-74.0, EVENING), '2026-09-16', 'New York');
  assert.equal(dayWhere(-66.1, EVENING), '2026-09-16', 'San Juan');
  assert.equal(dayWhere(-118.2, EVENING), '2026-09-16', 'Los Angeles');
  // Where it really is the seventeenth, it says so.
  assert.equal(dayWhere(0, EVENING), '2026-09-17', 'London');
  assert.equal(dayWhere(139.7, EVENING), '2026-09-17', 'Tokyo, already morning');
});

test('tonight survives the filter that drops what has been and gone', () => {
  // The filter in cachedEvents, and the reason it needed the seeker's own day.
  const tonight = '2026-09-16';
  assert.ok(tonight >= dayWhere(-66.1, EVENING), 'kept for somebody in San Juan');
  assert.ok(!(tonight >= EVENING.toISOString().slice(0, 10)), 'the UTC day threw it away');
});

test('a longitude nobody could be at falls back rather than throwing', () => {
  for (const bad of [null, undefined, NaN, 'west', Infinity, 9999]) {
    assert.match(dayWhere(bad as never, EVENING), /^\d{4}-\d{2}-\d{2}$/, String(bad));
  }
});

const plan = (id: string, startDate: string | null, endDate?: string | null) =>
  ({ id, startDate, endDate: endDate === undefined ? startDate : endDate });

const TODAY = '2026-09-16';

test('the next thing is first, because it is the one being decided', () => {
  const [upcoming] = planSections([
    plan('october', '2026-10-09'),
    plan('tomorrow', '2026-09-17'),
    plan('december', '2026-12-01'),
  ], TODAY);
  assert.equal(upcoming.key, 'upcoming');
  assert.deepEqual(upcoming.plans.map(p => p.id), ['tomorrow', 'october', 'december']);
});

test('a plan nobody dated is never given a date to sort it by', () => {
  const sections = planSections([
    plan('dated', '2026-09-20'),
    plan('undated', null),
  ], TODAY);
  const undated = sections.find(s => s.key === 'undated');
  assert.deepEqual(undated?.plans.map(p => p.id), ['undated']);
  // It is its own section rather than sorted to the top or the bottom of the rest.
  assert.equal(sections.find(s => s.key === 'upcoming')?.plans.length, 1);
});

test('a trip is still coming up while you are on it', () => {
  // Started Monday, ends Friday, and today is Wednesday.
  const sections = planSections([plan('inProgress', '2026-09-14', '2026-09-18')], TODAY);
  assert.equal(sections[0].key, 'upcoming');
});

test('a night out is over the day after it happened', () => {
  const sections = planSections([plan('lastNight', '2026-09-15')], TODAY);
  assert.equal(sections[0].key, 'past');
});

test('what is behind you reads most recent first', () => {
  const [past] = planSections([
    plan('ages', '2026-01-04'),
    plan('lastWeek', '2026-09-09'),
    plan('spring', '2026-04-02'),
  ], TODAY);
  assert.deepEqual(past.plans.map(p => p.id), ['lastWeek', 'spring', 'ages']);
});

test('empty sections are not shown at all', () => {
  const sections = planSections([plan('soon', '2026-09-20')], TODAY);
  assert.deepEqual(sections.map(s => s.key), ['upcoming']);
});

test('nonsense in a date field is treated as no date, not as a crash', () => {
  for (const bad of ['Dates TBD', '', 'tonight', '2026-13-45', null, undefined, 42]) {
    assert.equal(planDay({ startDate: bad } as never), null, String(bad));
  }
  assert.deepEqual(planSections([], TODAY), []);
});

test('how far away is said the way a person says it', () => {
  assert.equal(daysAway(plan('a', '2026-09-16'), TODAY), 'Today');
  assert.equal(daysAway(plan('b', '2026-09-17'), TODAY), 'Tomorrow');
  assert.equal(daysAway(plan('c', '2026-09-19'), TODAY), 'In 3 days');
  assert.equal(daysAway(plan('d', '2026-09-24'), TODAY), 'Next week');
  assert.equal(daysAway(plan('e', '2026-09-15'), TODAY), 'Yesterday');
  // Far away in either direction says nothing rather than something useless.
  assert.equal(daysAway(plan('f', '2026-12-01'), TODAY), null);
  assert.equal(daysAway(plan('g', null), TODAY), null);
});

test('today is the day where the person is, not the day in Greenwich', () => {
  // Half past eight on the sixteenth, in New York. The same instant is already
  // the seventeenth in UTC, and reading it that way filed tonight's plan under
  // "Been and gone" while its owner was still putting their coat on.
  const instant = new Date('2026-09-17T00:30:00Z');
  assert.equal(instant.toISOString().slice(0, 10), '2026-09-17');
  const newYorkClock = { getFullYear: () => 2026, getMonth: () => 8, getDate: () => 16 } as unknown as Date;
  assert.equal(today(newYorkClock), '2026-09-16');

  // And in whatever zone the tests themselves run in, it reads off the local
  // calendar rather than the UTC one.
  assert.equal(today(new Date(2026, 0, 5, 23, 45)), '2026-01-05');
});

test('a single-digit month and day are padded, so dates still compare as text', () => {
  assert.equal(today(new Date(2026, 2, 7, 12, 0)), '2026-03-07');
  // planSections and daysAway compare these with >= and localeCompare, so an
  // unpadded "2026-3-7" would sort after "2026-12-01" and land in the past.
  assert.ok(today(new Date(2026, 2, 7)) < '2026-12-01');
});

test('an evening plan is still coming up all evening', () => {
  // The whole point: at 20:30 New York time on the sixteenth, a night out
  // booked for the sixteenth must still be ahead of you.
  const nightOut = plan('tonight', '2026-09-16');
  const theirToday = '2026-09-16'; // what today() returns on that clock
  assert.equal(planSections([nightOut], theirToday)[0].key, 'upcoming');
  assert.equal(daysAway(nightOut, theirToday), 'Today');
  // Read as UTC it was already over, which is the bug this guards.
  assert.equal(planSections([nightOut], '2026-09-17')[0].key, 'past');
});

const group = (name: string, ...dates: (string | null)[]) =>
  ({ id: name, name, plans: dates.map((d, i) => plan(`${name}-${i}`, d)) });

test('the schedule gathers what is next out of every group', () => {
  const schedule = groupSchedule([
    group('Ski Trip Crew', '2026-12-01'),
    group('dinner', '2026-09-17'),
    group('Beach', '2026-10-09'),
  ], TODAY);
  assert.deepEqual(schedule.map(r => r.group.name), ['dinner', 'Beach', 'Ski Trip Crew']);
  // Each row knows which group it belongs to, so the screen can say.
  assert.equal(schedule[0].plan.id, 'dinner-0');
  assert.equal(schedule[0].day, '2026-09-17');
});

test('a group with several plans contributes each of them separately', () => {
  const schedule = groupSchedule([group('solo', '2026-12-01', '2026-09-18')], TODAY);
  assert.deepEqual(schedule.map(r => r.day), ['2026-09-18', '2026-12-01']);
});

test('the schedule is what is ahead, not a history', () => {
  const schedule = groupSchedule([
    group('over', '2026-09-09'),
    group('ahead', '2026-11-02'),
    group('undated', null),
  ], TODAY);
  assert.deepEqual(schedule.map(r => r.group.name), ['ahead']);
});

test('a trip you are on is the nearest thing there is', () => {
  const schedule = groupSchedule([
    group('startsTomorrow', '2026-09-17'),
    { id: 'onNow', name: 'onNow', plans: [plan('running', '2026-09-14', '2026-09-18')] },
  ], TODAY);
  assert.deepEqual(schedule.map(r => r.group.name), ['onNow', 'startsTomorrow']);
});

test('the schedule is capped, so one busy group cannot fill the screen', () => {
  const busy = group('busy', ...Array.from({ length: 20 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`));
  assert.equal(groupSchedule([busy], TODAY).length, 8);
  assert.equal(groupSchedule([busy], TODAY, 3).length, 3);
});

test('the schedule copes with junk rather than throwing', () => {
  const schedule = groupSchedule([
    { id: 'noPlansKey', name: 'a' },
    { id: 'nullPlans', name: 'b', plans: null as never },
    { id: 'real', name: 'c', plans: [plan('y', '2026-09-18')] },
  ], TODAY);
  assert.deepEqual(schedule.map(r => r.group.name), ['c']);
  assert.deepEqual(groupSchedule([], TODAY), []);
});

test('groups are listed by name, the way somebody looks one up', () => {
  const names = (gs: { name: string }[]) => [...gs].sort(byName).map(g => g.name);
  // Case is not a sort order anybody means: "beach" belongs beside "Beach".
  assert.deepEqual(names([{ name: 'dinner' }, { name: 'Beach' }, { name: 'apple' }]),
    ['apple', 'Beach', 'dinner']);
  // Numbers read as numbers, so Trip 2 is not filed after Trip 10.
  assert.deepEqual(names([{ name: 'Trip 10' }, { name: 'Trip 2' }]), ['Trip 2', 'Trip 10']);
});

test('a group nobody named sorts last rather than to the top', () => {
  const sorted = [{ name: '' }, { name: 'Beach' }, {}, { name: '   ' }].sort(byName);
  assert.equal((sorted[0] as { name: string }).name, 'Beach');
  assert.equal(sorted.length, 4);
});

test('a trip you are on says it is on, not when it started', () => {
  // Started Monday, ends Friday, today is Wednesday. "Yesterday" under a
  // heading that reads "Coming up" contradicts itself.
  assert.equal(daysAway(plan('inProgress', '2026-09-14', '2026-09-18'), TODAY), 'On now');
  // A trip starting today still reads Today.
  assert.equal(daysAway(plan('startsToday', TODAY, '2026-09-20'), TODAY), 'Today');
  // One that finished yesterday reads from its last day, not its first:
  // "6 days ago" described nothing anybody cares about.
  assert.equal(daysAway(plan('over', '2026-09-10', '2026-09-15'), TODAY), 'Yesterday');
  // Long over, and there is nothing worth saying.
  assert.equal(daysAway(plan('longOver', '2026-01-02', '2026-01-09'), TODAY), null);
});
