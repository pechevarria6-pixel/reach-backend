import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usableCategory, visibleCategories } from '../../lib/discovery/category.ts';

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
