// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSections, planDay, daysAway } from '../../lib/calendar.ts';

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
