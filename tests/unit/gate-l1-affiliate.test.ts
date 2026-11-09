// Run with: npm run test:unit
// Directive L1: Vrbo / Expedia links carry the affiliate ID once it exists, and never an invented tag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withExpediaAffiliate, expediaAffiliate } from '../../lib/booking/affiliate.ts';
import { vrboSearchUrl } from '../../lib/rentals.ts';

const env = { EXPEDIA_AFFILIATE_ID: 'abc123', EXPEDIA_AFFILIATE_PARAM: 'affcid' };

test('no tag until the owner has set both the ID and its parameter', () => {
  assert.equal(expediaAffiliate({}), null);
  assert.equal(expediaAffiliate({ EXPEDIA_AFFILIATE_ID: 'abc123' }), null);
  assert.equal(withExpediaAffiliate('https://www.vrbo.com/search?destination=X', {}), 'https://www.vrbo.com/search?destination=X');
});

test('Expedia Group hosts get the tag; nobody else does', () => {
  assert.match(withExpediaAffiliate('https://www.vrbo.com/search?destination=X', env), /affcid=abc123/);
  assert.match(withExpediaAffiliate('https://www.expedia.com/Hotel-Search', env), /affcid=abc123/);
  assert.equal(withExpediaAffiliate('https://www.airbnb.com/s/X/homes', env), 'https://www.airbnb.com/s/X/homes');
  assert.equal(withExpediaAffiliate('not a url', env), 'not a url');
  assert.equal(expediaAffiliate({ EXPEDIA_AFFILIATE_ID: 'x', EXPEDIA_AFFILIATE_PARAM: 'a b' }), null, 'a malformed parameter is ignored');
});

test('the Vrbo search link goes through it', () => {
  const before = { ...process.env };
  process.env.EXPEDIA_AFFILIATE_ID = 'abc123'; process.env.EXPEDIA_AFFILIATE_PARAM = 'affcid';
  try { assert.match(vrboSearchUrl({ location: 'Charleston, SC' } as never) ?? '', /affcid=abc123/); }
  finally { process.env = before; }
});
