// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleScore } from '../../lib/booking/providers/viator-search.ts';

test('a product carrying the line\'s words scores high', () => {
  assert.equal(titleScore('brewery tour', "Durham's Best Brewery Tour Trinity Neighborhood"), 1);
  assert.equal(titleScore('walking tour', 'Durham African-American Historic Walking Tour'), 1);
});

test('a different activity sharing a word does not', () => {
  // The failure this guards: booking a sunset cruise because the line said
  // "walk by the sea".
  assert.ok(titleScore('kayak tour of the bay', 'Sunset Cruise on the Bay') < 0.5);
  assert.ok(titleScore('pottery class', 'Craft Beer Walking Tour') < 0.5);
});

test('filler words are not what a match is made of', () => {
  // "tour", "the", "of" carry no meaning; without stripping them a title
  // could score on those alone.
  assert.equal(titleScore('the tour of a day', 'Anything At All'), 0);
});

test('nothing in, nothing claimed', () => {
  assert.equal(titleScore('', 'Some Tour'), 0);
  assert.equal(titleScore('brewery tour', ''), 0);
});
