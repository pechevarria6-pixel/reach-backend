// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rank } from '../../lib/discovery/rank.ts';
import { notRuledOut, searchTermFor } from '../../lib/discovery/yelp.ts';
import type { Finding } from '../../lib/discovery/types.ts';

const make = (over: Partial<Finding>): Finding => ({
  id: over.id ?? 'x', title: 'Thing', meta: '', emoji: '🎫', price: null,
  dist: null, category: 'Event', url: 'https://example.com', date: null,
  venue: null, source: 'ticketmaster', because: null, ...over,
});

test('what you are into outranks what happens to be nearby', () => {
  const found = [
    make({ id: 'stadium', title: 'Stadium Show', source: 'ticketmaster' }),
    make({ id: 'wheel', title: 'Evening Wheel Throwing', source: 'yelp-places', because: 'pottery' }),
  ];
  const [first] = rank(found, ['pottery']);
  assert.equal(first.id, 'wheel');
});

test('no one source can take the whole page', () => {
  const found = [
    ...['a', 'b', 'c', 'd'].map(id => make({ id, source: 'ticketmaster' })),
    make({ id: 'p1', source: 'yelp-places', because: 'cooking' }),
    make({ id: 'p2', source: 'yelp-places', because: 'cooking' }),
  ];
  const sources = rank(found, ['cooking']).slice(0, 4).map(f => f.source);
  // Interleaved, so the second card is never the same source as the first.
  assert.notEqual(sources[0], sources[1]);
  assert.equal(new Set(sources).size, 2);
});

test('ranking keeps everything it was given', () => {
  const found = ['a', 'b', 'c', 'd', 'e'].map(id => make({ id, source: id < 'c' ? 'yelp-events' : 'ticketmaster' }));
  const ranked = rank(found, []);
  assert.equal(ranked.length, 5);
  assert.deepEqual(new Set(ranked.map(f => f.id)), new Set(['a', 'b', 'c', 'd', 'e']));
});

test('nothing in, nothing out', () => {
  assert.deepEqual(rank([], ['pottery']), []);
  assert.deepEqual(rank([make({ id: 'a' })], []).map(f => f.id), ['a']);
});

test('a hard no is a hard no, however good it looks', () => {
  assert.equal(notRuledOut('Midnight Karaoke Bar', ['karaoke']), false);
  assert.equal(notRuledOut('Pottery Studio', ['karaoke']), true);
});

test('a hard no does not match on a fragment', () => {
  // "art" must not rule out a departure lounge or a cartwheel class.
  assert.equal(notRuledOut('Departures Bar', ['art']), true);
  assert.equal(notRuledOut('Anything', ['']), true);
  assert.equal(notRuledOut('Anything', ['  ']), true);
});

test('an interest becomes something worth searching for', () => {
  // Keyed on the words the quiz saves, not its option ids.
  assert.equal(searchTermFor('Pottery & crafts'), 'pottery class');
  assert.equal(searchTermFor('Cooking'), 'cooking class');
  assert.equal(searchTermFor('Comedy'), 'comedy club');
  assert.equal(searchTermFor('Live music'), 'live music venue');
});

test('what somebody typed is searched as they typed it', () => {
  // The point of a free text box is that the answer is not on our list.
  assert.equal(searchTermFor('letterpress workshop'), 'letterpress workshop');
  assert.equal(searchTermFor('sea swimming'), 'sea swimming class');
  assert.equal(searchTermFor('  Sourdough  '), 'sourdough class');
});
