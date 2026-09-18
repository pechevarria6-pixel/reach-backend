// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airbnbSearchUrl, vrboSearchUrl, rentalLinks, shouldOfferRentals } from '../../lib/rentals.ts';

const plan = { location: 'Aberdeen, NC', checkin: '2026-10-09', checkout: '2026-10-12', adults: 6 };

test('a full plan prefills both searches', () => {
  // Verified against the live site: this Airbnb URL returns 200 and the page
  // comes back carrying the town and the dates.
  assert.equal(
    airbnbSearchUrl(plan),
    'https://www.airbnb.com/s/Aberdeen%2C%20NC/homes?checkin=2026-10-09&checkout=2026-10-12&adults=6',
  );
  const vrbo = vrboSearchUrl(plan) as string;
  assert.match(vrbo, /^https:\/\/www\.vrbo\.com\/search\?/);
  assert.match(vrbo, /destination=Aberdeen%2C\+NC/);
  // Both spellings of the date parameters, because Vrbo has renamed them and
  // the unknown one is ignored rather than breaking the search.
  assert.match(vrbo, /startDate=2026-10-09&endDate=2026-10-12/);
  assert.match(vrbo, /d1=2026-10-09&d2=2026-10-12/);
});

test('half a date range prefills no dates at all', () => {
  // A checkout with no checkin lands on an error page rather than a search.
  const url = airbnbSearchUrl({ location: 'Aberdeen, NC', checkout: '2026-10-12', adults: 4 }) as string;
  assert.doesNotMatch(url, /checkout/);
  assert.match(url, /adults=4/);
});

test('a backwards range is dropped, not sent', () => {
  const url = airbnbSearchUrl({ location: 'X', checkin: '2026-10-12', checkout: '2026-10-09' }) as string;
  assert.doesNotMatch(url, /checkin|checkout/);
});

test('a party is at least one person and never above the site ceiling', () => {
  assert.match(airbnbSearchUrl({ location: 'X', adults: 40 }) as string, /adults=16/);
  assert.doesNotMatch(airbnbSearchUrl({ location: 'X', adults: 0 }) as string, /adults/);
  assert.doesNotMatch(airbnbSearchUrl({ location: 'X', adults: NaN }) as string, /adults/);
});

test('no town means no link, rather than a link to nowhere', () => {
  assert.equal(airbnbSearchUrl({ location: '   ' }), null);
  assert.equal(vrboSearchUrl({ location: '' }), null);
  assert.deepEqual(rentalLinks({ location: '' }), []);
});

test('a whole house is offered to a group big enough to want one', () => {
  assert.equal(shouldOfferRentals(4), false);
  assert.equal(shouldOfferRentals(5), true);
  // Or to anybody who asked for one, whatever the size.
  assert.equal(shouldOfferRentals(2, true), true);
});

test('both links come back for the card', () => {
  const links = rentalLinks(plan);
  assert.deepEqual(links.map(l => l.provider), ['Airbnb', 'Vrbo']);
});
