import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bookingFacts, bookingFactsFrom, BOOKING_COLUMNS, BOOKING_FACTS_THAT_MUST_SURVIVE,
} from '../../lib/contracts/booking.ts';
import { itemTitle } from '../../lib/checkout.ts';

// A real row: a restaurant Reach cannot book, handed off with a number to
// ring. This is the shape that has lost facts twice.
const ROW = {
  id: '22222222-2222-2222-2222-222222222222',
  vertical: 'restaurant',
  status: 'redirected',
  provider: 'resy',
  mode: 'redirect',
  provider_ref: null,
  redirect_url: 'https://resy.com/cities/dc/rasika',
  price_cents: 9000,
  currency: 'USD',
  detail: 'Dinner at Rasika',
  response_payload: {
    note: 'Resy holds this table for 15 minutes once you pick a time.',
    phone: '+1 202-637-1222',
  },
  itinerary_item_id: '33333333-3333-3333-3333-333333333333',
};

test('every fact survives the row → screen crossing', () => {
  const f = bookingFacts(ROW);
  for (const { fact, costs } of BOOKING_FACTS_THAT_MUST_SURVIVE) {
    assert.notEqual(f[fact], null, `${String(fact)} was dropped — that is ${costs}`);
    assert.notEqual(f[fact], undefined, `${String(fact)} was dropped — that is ${costs}`);
  }
});

test('the phone and the note come out of the payload, not off the row', () => {
  // Both live one level down in `response_payload`, which is exactly why a
  // narrow select drops them without touching anything that looks like a
  // mapper. The phone is the whole answer for a restaurant on no platform.
  const f = bookingFacts(ROW);
  assert.equal(f.phone, '+1 202-637-1222');
  assert.match(f.note ?? '', /15 minutes/);
});

test('the column list carries every fact the mapper reads', () => {
  // The live instance of this bug: /api/bookings read eleven columns to check
  // for duplicates and handed the twin straight back to the caller. It did
  // not read `response_payload`, so pressing "Book everything" twice
  // described the second one with no phone number and no note.
  for (const { row } of BOOKING_FACTS_THAT_MUST_SURVIVE) {
    assert.ok(BOOKING_COLUMNS.includes(String(row)), `${String(row)} missing from BOOKING_COLUMNS`);
  }
  assert.ok(BOOKING_COLUMNS.includes('response_payload'), 'the phone and the note live in response_payload');
});

test('the screen can still name the thing after it crosses the contract', () => {
  // Caught while wiring this: the checkout mapper passes each row to
  // `itemTitle`, which reads `detail`. Leaving `detail` out of the facts
  // would have printed "Trip item (details coming)" over every line on the
  // screen where somebody decides to pay — the exact bug this file exists to
  // stop, committed in the act of stopping it. So the contract is tested
  // against the function that actually consumes it, not on its own.
  assert.equal(itemTitle(bookingFacts(ROW) as never), 'Dinner at Rasika');
  // And the old shape, which is still in the table.
  const legacy = bookingFacts({ ...ROW, detail: { title: 'Dinner at Rasika' } });
  assert.equal(itemTitle(legacy as never), 'Dinner at Rasika');
});

test('a redirected booking keeps the address it is finished at', () => {
  // "Finish on their site" with nothing to tap, shipped once already.
  assert.equal(bookingFacts(ROW).href, 'https://resy.com/cities/dc/rasika');
});

test('a row with no payload is fine, not a crash', () => {
  const f = bookingFacts({ ...ROW, response_payload: null });
  assert.equal(f.phone, null);
  assert.equal(f.note, null);
  assert.equal(f.href, ROW.redirect_url);
});

test('a price that arrives as a string is still a price', () => {
  // PostgREST hands numeric columns back as strings. Refusing the row would
  // drop it from the list while `checkoutState` — which runs on the raw rows
  // before this does — still counts it in the total. A bill with a line
  // missing is worse than either failure on its own.
  assert.equal(bookingFacts({ ...ROW, price_cents: '9000' }).priceCents, 9000);
});

test('currency is never blank, because it is printed next to a number', () => {
  assert.equal(bookingFacts({ ...ROW, currency: null }).currency, 'USD');
});

test('one bad row does not take the pay screen down with it', () => {
  const rows = bookingFactsFrom([ROW, { vertical: 'flight' }, { ...ROW, id: 'x' }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].id, 'x');
});

test('bookingFactsFrom survives a route that answered with something else', () => {
  // `fresh=(j&&(j.bookings||j))||[]` on the checkout screen: when the route
  // 500s, `j` is `{error}` and this receives an object, not a list.
  assert.deepEqual(bookingFactsFrom({ error: 'nope' }), []);
  assert.deepEqual(bookingFactsFrom(null), []);
});
