// Discover's Upcoming list: dated things on their day, weekly things once,
// grouped by day and ordered by time then distance, with nothing on it that
// its own words say is not set yet.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  upcomingSections, dayHeading, clockWords, milesOf, dateNotSet, dayRoll, capSections, rowsIn,
  type UpcomingItem,
} from '../../lib/discovery/upcoming.ts';

// Thursday 5 November 2026.
const THU = '2026-11-05';
const card = (id: string, over: Partial<UpcomingItem> = {}): UpcomingItem => ({
  id, findingId: id, title: id, venue: null, date: null, dist: '1 mi', time: null, sub: '', ...over,
});

test('a day is said the way somebody would say it, from their own day', () => {
  assert.equal(dayHeading(THU, THU, 9), 'Today');
  assert.equal(dayHeading(THU, THU, 17), 'Tonight', 'from five in the evening');
  assert.equal(dayHeading('2026-11-06', THU, 9), 'Tomorrow');
  assert.equal(dayHeading('2026-11-07', THU, 9), 'Sat 7');
  assert.equal(dayHeading('2026-11-11', THU, 9), 'Wed 11', 'the last day of the seven');
  assert.equal(dayHeading('2026-11-22', THU, 9), 'Sun, Nov 22', 'after the week, with its month');
});

test('a clock time only when the listing gave one', () => {
  assert.equal(clockWords('19:30:00'), '7:30 PM');
  assert.equal(clockWords('00:15'), '12:15 AM');
  assert.equal(clockWords('12:00'), '12:00 PM');
  assert.equal(clockWords(null), null);
  assert.equal(clockWords('TBA'), null);
  assert.equal(milesOf('12 mi'), 12);
  assert.equal(milesOf(null), null);
});

test('a listing whose own words say its date is not set is not on', () => {
  assert.equal(dateNotSet('To be held in 2027 on a to-be-determined date', THU), true);
  assert.equal(dateNotSet('Spring Gala — date TBD', THU), true);
  assert.equal(dateNotSet('Summer Festival 2027', THU), true, 'a later year, filed under this one');
  assert.equal(dateNotSet('New Year’s Eve 2026 → 2027', '2026-12-31'), false, 'its own year beside the next');
  assert.equal(dateNotSet('Joe List', THU), false);
  assert.equal(dateNotSet('Fri, Nov 6 · Venue TBC', THU), false, '"Venue TBC" is about the venue, not the day');
});

test('days in order, each by time and then nearest; nothing in the past', () => {
  const items = [
    card('late', { date: THU, time: '21:00:00', dist: '2 mi' }),
    card('early', { date: THU, time: '19:30:00', dist: '9 mi' }),
    card('near-untimed', { date: THU, dist: '1 mi' }),
    card('far-untimed', { date: THU, dist: '6 mi' }),
    card('fri', { date: '2026-11-06' }),
    card('gone', { date: '2026-11-04' }),
    card('studio'),                                   // a place, not a thing on
  ];
  const { sections, candidates } = upcomingSections(items, [], THU, 18);
  assert.deepEqual(sections.map(s => s.label), ['Tonight', 'Tomorrow']);
  assert.deepEqual(sections[0].near.map(r => r.item.id), ['early', 'late', 'near-untimed', 'far-untimed']);
  assert.equal(sections[0].near[0].when, '7:30 PM');
  assert.equal(sections[0].near[2].when, null, 'no time held, no time said');
  assert.ok(!candidates.has('studio'), 'a place is filed under Places');
});

test('a weekly thing appears once, under its next night, saying so', () => {
  const quiz = card('quiz', { findingId: 'harvest_9', title: 'Pub quiz' });
  const week = [
    { day: THU, events: [] },
    { day: '2026-11-11', events: [{ id: 'harvest_9', recurring: true }] },
    { day: '2026-11-18', events: [{ id: 'harvest_9', recurring: true }] },
  ];
  const { sections, candidates } = upcomingSections([quiz], week, THU, 9);
  const rows = sections.flatMap(s => s.near);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].day, '2026-11-11');
  assert.equal(rows[0].when, 'Every Wed');
  assert.ok(candidates.has('quiz'));
});

test('the same thing listed three times is one row; "to be determined" is absent', () => {
  const items = [
    card('a', { title: 'Holly Day Fair', venue: 'State Fairgrounds', date: THU }),
    card('b', { title: 'Holly Day Fair', venue: 'State Fairgrounds', date: THU }),
    card('c', { title: 'HOLLY DAY FAIR!', venue: 'State fairgrounds', date: THU }),
    card('tbd', { title: 'To be held in 2027 on a to-be-determined date', date: THU }),
  ];
  const { sections, candidates } = upcomingSections(items, [], THU, 9);
  assert.deepEqual(sections.flatMap(s => s.near).map(r => r.item.title), ['Holly Day Fair']);
  assert.ok(candidates.has('tbd'), 'dropped, and not then offered as a place');
});

test('far away rows sit behind "Further out", and the roll counts every row under its header', () => {
  const items = [
    card('here', { date: THU, dist: '3 mi' }),
    card('fayetteville', { date: THU, dist: '60 mi' }),
    card('unknown', { date: THU, dist: null }),
    card('later', { date: '2026-11-22' }),
  ];
  const { sections } = upcomingSections(items, [], THU, 9);
  assert.deepEqual(sections[0].near.map(r => r.item.id), ['here', 'unknown']);
  assert.deepEqual(sections[0].further.map(r => r.item.id), ['fayetteville']);
  const roll = dayRoll(sections, THU);
  assert.equal(roll.days.length, 7);
  assert.equal(roll.days[0].count, rowsIn(sections[0]));
  assert.equal(roll.days[0].count, 3);
  assert.equal(roll.days[2].count, 0, 'a quiet Saturday is drawn, with nothing on it');
  assert.equal(roll.later, 1);
  assert.equal(roll.laterDay, '2026-11-22');
});

test('"Show N more" is exactly what appears when it is tapped', () => {
  const items = Array.from({ length: 44 }, (_, i) => card(`e${i}`, { date: i < 20 ? THU : '2026-11-06' }));
  const { sections } = upcomingSections(items, [], THU, 9);
  const capped = capSections(sections, 30);
  const shown = capped.sections.reduce((n, s) => n + s.near.length, 0);
  assert.equal(shown, 30);
  assert.equal(capped.more, 14);
  assert.equal(shown + capped.more, sections.reduce((n, s) => n + s.near.length, 0));
});

test('who or where being TBA is not the date: a dated game with its opponent TBD stays on', () => {
  for (const title of ['Wolfpack vs Opponent TBD', 'Madeon with special guest TBA', 'Artist w/ Support TBA', 'ACC Championship: Teams TBD']) {
    assert.equal(dateNotSet(title, THU), false, title);
  }
  const { sections, candidates } = upcomingSections([
    card('game', { title: 'Wolfpack vs Opponent TBD', date: '2026-11-07' }),
    card('joe', { title: 'Joe List', date: '2026-11-07' }),
  ], [], THU, 9);
  assert.deepEqual(sections.flatMap(s => s.near).map(r => r.item.id), ['game', 'joe']);
  assert.ok(candidates.has('game'));
  // The date itself, said not to be set, in any of the ways listings say it.
  assert.equal(dateNotSet('Concert · Date TBA', THU), true);
  assert.equal(dateNotSet('Dates to be announced', THU), true);
  assert.equal(dateNotSet('TBA · The Pour House', THU), true, 'a when-line that is only "TBA"');
  assert.equal(dateNotSet('Doors 7pm · Time TBA', THU), false, 'a time not set is not a date not set');
});

test('a listing with no date that says it is not on yet is not offered as a place either', () => {
  const items = [
    card('broomstick', { title: 'Contemporary Broomstick Lace Workshop', sub: 'To be held in 2027 on a to-be-determined date · Raleigh Lace Museum' }),
    card('bobbin', { title: 'Bobbin Lace: The Spring 2027 class', sub: 'runs for 10 weeks (2 hours per session) · Raleigh Lace Museum' }),
    card('yelp', { title: 'Wine walk', sub: 'Date TBC · Raleigh' }),
    card('museum', { title: 'Raleigh Lace Museum', sub: 'Museum · 133 Fayetteville Street' }),
    card('fridays', { title: 'FIRST FRIDAYS DOWNTOWN RALEIGH', sub: '6-9 pm · Raleigh Lace Museum' }),
  ];
  const { sections, candidates } = upcomingSections(items, [], THU, 9);
  assert.equal(sections.length, 0);
  const places = items.filter(i => !candidates.has(i.id)).map(i => i.id);
  assert.deepEqual(places, ['museum', 'fridays']);
});

test('one fair sold as several products is one row on its day; different acts and different times are not', () => {
  const fair = (id: string, title: string, date = THU) => card(id, { title, venue: 'Crown Expo', date, dist: '54 mi' });
  const items = [
    fair('sip', 'Holly Day Fair Sip & Shop'),
    fair('thu', '2026 Holly Day Fair-Thursday'),
    fair('super', 'Holly Day Fair-Super Shopper'),
    fair('ladies', 'Holly Day Fair-Ladies Night Out', '2026-11-06'),
    fair('fri', '2026 Holly Day Fair-Friday', '2026-11-06'),
    card('smith', { title: 'Comedy Night: John Smith', venue: 'Goodnights', date: THU }),
    card('doe', { title: 'Comedy Night: Jane Doe', venue: 'Goodnights', date: THU }),
    card('mat', { title: 'The Nutcracker matinee', venue: 'Memorial Auditorium', date: THU, time: '14:00' }),
    card('eve', { title: 'The Nutcracker evening', venue: 'Memorial Auditorium', date: THU, time: '19:30' }),
    card('elsewhere', { title: 'Holly Day Fair Sip & Shop', venue: 'Somewhere else', date: THU }),
  ];
  const { sections } = upcomingSections(items, [], THU, 9);
  const day = (iso: string) => sections.find(s => s.day === iso)!;
  const ids = (iso: string) => [...day(iso).near, ...day(iso).further].map(r => r.item.id).sort();
  assert.deepEqual(ids(THU), ['doe', 'elsewhere', 'eve', 'mat', 'smith', 'thu'].sort());
  assert.deepEqual(ids('2026-11-06'), ['fri']);
});
