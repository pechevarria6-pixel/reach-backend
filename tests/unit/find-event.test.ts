import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actWords, titleMatches, eventFacts } from '../../lib/discovery/find-event.ts';

test('the act is found in words nobody capitalised', () => {
  // "milk carton kids" is lower case and three words long. No
  // capitalisation rule finds it, which is why this reads words instead.
  assert.deepEqual(actWords('milk carton kids concert in dc'), ['milk', 'carton', 'kids']);
  assert.deepEqual(actWords('Marlon Wayans show in Raleigh'), ['marlon', 'wayans']);
});

test('everything describing the outing is dropped', () => {
  assert.deepEqual(actWords('going to see Wilco with my buddy for his birthday'), ['wilco']);
});

test('one shared word matches half a listings page', () => {
  assert.equal(titleMatches('The Kids Are Alright', ['milk', 'carton', 'kids']), false);
  assert.equal(titleMatches('The Milk Carton Kids', ['milk', 'carton', 'kids']), true);
});

test('a single word is never enough to claim a match', () => {
  // A one-word act finds nothing, and that is the safe direction: not found
  // means the evening is planned without claiming a specific show, and a
  // wrong venue is the bug this whole module exists to stop.
  assert.equal(titleMatches('Wilco', ['wilco']), false);
});

test('the facts given to generation are read off a row and nothing else', () => {
  const said = eventFacts({
    title: 'The Milk Carton Kids', venue: '9:30 CLUB', city: 'Washington',
    startsOn: '2026-09-21', url: 'https://www.ticketmaster.com/event/abc', source: 'cache',
  });
  assert.match(said, /9:30 CLUB, Washington/);
  assert.match(said, /2026-09-21/);
  // The instruction that matters: nothing about the room, the crowd or the
  // running time, because none of it is known.
  assert.match(said, /Do not rename the venue/);
  assert.match(said, /none of that is known/);
});

test('an event with no venue says nothing about a venue', () => {
  const said = eventFacts({ title: 'A Gig', venue: null, city: null, startsOn: null, url: null, source: 'cache' });
  assert.ok(!/Where:/.test(said));
  assert.ok(!/Date:/.test(said));
});
