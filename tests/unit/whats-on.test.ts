import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whatsOn, daysWithSomethingOn } from '../../lib/discovery/whats-on.ts';

// 2026-09-22 is a Tuesday.
const TODAY = '2026-09-22';
const EVENTS = [
  { id: 'quiz', title: 'Pub Trivia Night', every_weekday: 3, venue_name: 'Red Bear' },
  { id: 'folk', title: 'International Folk Festival Parade', starts_on: '2026-09-26' },
  { id: 'gig',  title: 'THE MATCHES', starts_on: '2026-09-25' },
  { id: 'kara', title: 'Karaoke', every_weekday: 4, venue_name: 'The Lemon Tree' },
];

test('a weekly thing lands on every one of its days', () => {
  const week = whatsOn(EVENTS, TODAY, 14);
  const quizDays = week.filter(d => d.events.some(e => e.id === 'quiz')).map(d => d.day);
  // Wednesdays: the 23rd and the 30th.
  assert.deepEqual(quizDays, ['2026-09-23', '2026-09-30']);
});

test('a one-off lands on its date and nowhere else', () => {
  const week = whatsOn(EVENTS, TODAY, 14);
  const gigDays = week.filter(d => d.events.some(e => e.id === 'gig')).map(d => d.day);
  assert.deepEqual(gigDays, ['2026-09-25']);
});

test('a weekly thing is marked as one, so a screen can say "every week"', () => {
  const week = whatsOn(EVENTS, TODAY, 7);
  const wed = week.find(d => d.day === '2026-09-23');
  assert.equal(wed?.events.find(e => e.id === 'quiz')?.recurring, true);
  const fri = week.find(d => d.day === '2026-09-25');
  assert.equal(fri?.events.find(e => e.id === 'gig')?.recurring, false);
});

test('a quiet day is kept, and says nothing is on', () => {
  // Skipping it would tell somebody there is no Tuesday, rather than that
  // there is nothing on it. "Nothing on" is a true and useful answer.
  const week = whatsOn(EVENTS, TODAY, 7);
  assert.equal(week.length, 7);
  const today = week[0];
  assert.equal(today.day, TODAY);
  assert.equal(today.events.length, 0);
  // Wednesday's quiz, Thursday's karaoke, Friday's gig, Saturday's parade.
  // This said three at first, having forgotten the weekly karaoke — the
  // exact thing the roll-up exists to stop anybody forgetting.
  assert.equal(daysWithSomethingOn(week), 4);
});

test('an event with no day at all never appears', () => {
  // There is nowhere to put it, and putting it somewhere would be inventing
  // a date — which is the thing the parser it came from refuses to do.
  const week = whatsOn([{ id: 'x', title: 'By appointment', when_text: 'by appointment' }], TODAY, 7);
  assert.equal(daysWithSomethingOn(week), 0);
});

test('a weekly thing that also has a date is treated as the date', () => {
  // Both set is a contradiction in the row; the specific one wins.
  const week = whatsOn([{ id: 'both', title: 'One night only', starts_on: '2026-09-25', every_weekday: 3 }], TODAY, 14);
  const days = week.filter(d => d.events.length).map(d => d.day);
  assert.deepEqual(days, ['2026-09-25']);
});

test('nothing in, nothing out', () => {
  assert.deepEqual(whatsOn([], TODAY, 0), []);
  assert.deepEqual(whatsOn(null, TODAY, 3).map(d => d.events.length), [0, 0, 0]);
  assert.deepEqual(whatsOn(EVENTS, 'not-a-date'), []);
});
