import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceLabel } from '../../lib/discovery/price-label.ts';

test('nothing known is not "at the door"', () => {
  assert.equal(priceLabel({}).line, 'Price not listed');
  assert.doesNotMatch(priceLabel({}).line, /door/i);
});
test('a price is shown as they wrote it, and not called all-in', () => {
  const p = priceLabel({ price: '$15 adv / $20 dos' });
  assert.equal(p.line, '$15 adv / $20 dos');
  assert.equal(p.note, 'as listed');
});
test('where to find it, when we know where', () => {
  assert.equal(priceLabel({ provider: 'ticketmaster' }).line, 'Price on Ticketmaster');
  assert.equal(priceLabel({ url: 'https://example.com' }).line, 'Price on their site');
});
