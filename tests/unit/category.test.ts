import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usableCategory, visibleCategories, categoryGroup, groupPills } from '../../lib/discovery/category.ts';

test('each provider’s word for the same thing is one pill', () => {
  assert.equal(categoryGroup('Music'), 'Music');
  assert.equal(categoryGroup('Live music'), 'Music');
  assert.equal(categoryGroup('Sport'), 'Sport');
  assert.equal(categoryGroup('Sports'), 'Sport');
  assert.equal(categoryGroup('Arts & Theatre'), 'Arts & stage');
  assert.equal(categoryGroup('Film & theatre'), 'Arts & stage');
  assert.equal(categoryGroup('Museums & history'), 'Arts & stage');
  assert.equal(categoryGroup('Places to eat'), 'Food & drink');
  assert.equal(categoryGroup('Markets & food halls'), 'Food & drink');
  assert.equal(categoryGroup('Gardens & parks'), 'Outdoors');
  assert.equal(categoryGroup('Event'), 'Other');
  assert.equal(categoryGroup('Miscellaneous'), 'Other');
  assert.equal(categoryGroup('Trivia & board games'), 'Other');
  assert.equal(categoryGroup('Undefined'), 'Other');
});

test('at most six pills, most first, Other last, no "Sport" beside "Sports"', () => {
  const items = [
    ...['Sport', 'Sports', 'Sports'].map(category => ({ category })),
    ...['Music', 'Live music', 'Music', 'Music'].map(category => ({ category })),
    ...['Event', 'Miscellaneous', 'Event', 'Event', 'Event'].map(category => ({ category })),
    { category: 'Outdoors' },
  ];
  const pills = groupPills(items);
  assert.deepEqual(pills.map(p => p.group), ['Music', 'Sport', 'Outdoors', 'Other']);
  assert.deepEqual(pills.map(p => p.count), [4, 3, 1, 5]);
  assert.ok(pills.length <= 6);
});

test('a provider saying "we do not know" is not a category', () => {
  // The real value, from Ticketmaster, that put an "Undefined" pill on
  // Discover between "Sports" and "Wine tasting".
  assert.equal(usableCategory('Undefined'), null);
  assert.equal(usableCategory('undefined'), null);
  assert.equal(usableCategory('null'), null);
  assert.equal(usableCategory('  '), null);
  assert.equal(usableCategory(undefined), null);
  assert.equal(usableCategory(null), null);
});

test('a real category survives exactly as written', () => {
  assert.equal(usableCategory('Arts & Theatre'), 'Arts & Theatre');
  assert.equal(usableCategory(' Live music '), 'Live music');
});

test('pills are the categories that have something behind them', () => {
  const items = [
    { category: 'Music' }, { category: 'Music' },
    { category: 'Undefined' },          // the offender
    { category: 'Arts & Theatre' },
    { category: '' }, { category: null },
  ];
  assert.deepEqual(visibleCategories(items), ['Arts & Theatre', 'Music']);
});

test('no items means no pills, and nothing thrown', () => {
  assert.deepEqual(visibleCategories([]), []);
  assert.deepEqual(visibleCategories(undefined as never), []);
});

test('a category is only dropped when it is machine noise', () => {
  // The pill is navigation. Dropping a real label makes those things harder
  // to find, so only values that are plainly a null-turned-string go.
  assert.equal(usableCategory('Other'), 'Other');
  assert.equal(usableCategory('Unknown'), 'Unknown');
  assert.equal(usableCategory('Miscellaneous'), 'Miscellaneous');
});

test('dropping a pill never drops the thing itself', () => {
  // Discover shows every item under "All" and filters only when a pill is
  // chosen, so an item whose category we will not name is still reachable.
  const items = [
    { category: 'Undefined', title: 'Deric Cahill' },
    { category: 'Music', title: 'Ian Asher' },
  ];
  assert.deepEqual(visibleCategories(items), ['Music']);
  // The guard says nothing about which items exist — that is the caller's
  // list, untouched.
  assert.equal(items.length, 2);
});
