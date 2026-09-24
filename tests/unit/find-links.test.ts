import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLinks } from '../../lib/find-links.ts';

test('an unnamed dinner gets a table search and a map search, in its city', () => {
  const l = findLinks({ title: 'Look for dinner near the waterfront with a seafood focus', type: 'restaurant', city: 'St. Augustine' });
  assert.deepEqual(l.map(x => x.label), ['Find a table on OpenTable', 'Search the map']);
  assert.match(decodeURIComponent(l[1].url), /seafood/);
  assert.match(decodeURIComponent(l[1].url), /St\. Augustine/);
});

test('an unnamed class gets a tour search and a map search', () => {
  const l = findLinks({ title: 'Book a hands-on cooking class for the morning', type: 'activity', city: 'St. Augustine' });
  assert.deepEqual(l.map(x => x.label), ['Search Viator', 'Search the map']);
  assert.match(decodeURIComponent(l[0].url), /cooking class/);
});

test('nothing to search for gives nothing', () => {
  assert.deepEqual(findLinks({ title: '', type: 'restaurant', city: 'Raleigh' }), []);
});
