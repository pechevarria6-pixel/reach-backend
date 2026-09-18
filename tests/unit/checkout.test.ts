import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemTitle, dedupe, checkoutState } from '../../lib/checkout.ts';

// The three rows behind the 18 September screenshot, as they sit in the
// database: three different reservations, one vertical, no prices.
const SCREENSHOT = [
  { id: '1', vertical: 'restaurant', provider: 'concierge', mode: 'concierge', status: 'pending',
    detail: 'Reservation request: seafood dinner at the marina', price_cents: null, itinerary_item_id: 'a' },
  { id: '2', vertical: 'restaurant', provider: 'concierge', mode: 'concierge', status: 'pending',
    detail: 'Reservation request: Canyonlands by night', price_cents: null, itinerary_item_id: 'b' },
  { id: '3', vertical: 'restaurant', provider: 'concierge', mode: 'concierge', status: 'pending',
    detail: 'Reservation request: final seafood dinner', price_cents: null, itinerary_item_id: 'c' },
];

test('a row is named by what was booked, never by its category', () => {
  assert.equal(itemTitle(SCREENSHOT[0]), 'Reservation request: seafood dinner at the marina');
  // The actual defect: detail is a string, so .title and .name were both
  // undefined and every row fell through to the enum.
  assert.notEqual(itemTitle(SCREENSHOT[0]), 'restaurant');
});

test('older rows that stored an object still read correctly', () => {
  assert.equal(itemTitle({ vertical: 'hotel', detail: { title: 'Best Western Raleigh' } }), 'Best Western Raleigh');
  assert.equal(itemTitle({ vertical: 'hotel', detail: { name: 'Hotel Vallarta' } }), 'Hotel Vallarta');
});

test('a row with no name says so instead of printing the enum', () => {
  assert.equal(itemTitle({ vertical: 'restaurant', detail: null }), 'Trip item (details coming)');
  assert.equal(itemTitle({ vertical: 'restaurant', detail: '   ' }), 'Trip item (details coming)');
});

test('three different dinners are three rows, not one', () => {
  // The trap: collapsing on what the broken screen displayed — all three
  // read "restaurant" — would have dropped two of somebody's dinners.
  assert.equal(dedupe(SCREENSHOT).length, 3);
});

test('the same itinerary line booked twice collapses to one', () => {
  const twice = [
    { vertical: 'hotel', detail: 'Best Western', price_cents: 33401, itinerary_item_id: 'h1' },
    { vertical: 'hotel', detail: 'Best Western', price_cents: 33401, itinerary_item_id: 'h1' },
  ];
  assert.equal(dedupe(twice).length, 1);
});

test('two rows with no name are two rows', () => {
  // Merging them would be guessing that one unnamed thing is another.
  const unnamed = [
    { vertical: 'activity', detail: null, price_cents: 1000 },
    { vertical: 'activity', detail: null, price_cents: 2000 },
  ];
  assert.equal(dedupe(unnamed).length, 2);
});

test('nothing priced means nobody can pay', () => {
  const s = checkoutState(SCREENSHOT);
  assert.equal(s.totalCents, 0);
  // The screenshot had this button live at $0.
  assert.equal(s.canPay, false);
  assert.equal(s.blockedCopy, "We're still pricing this — check back soon.");
  assert.equal(s.conciergeNote, '+ concierge items priced after confirmation');
});

test('a priced trip pays, and concierge extras do not block it', () => {
  const s = checkoutState([
    ...SCREENSHOT,
    { vertical: 'hotel', detail: 'Best Western Raleigh', price_cents: 33401, itinerary_item_id: 'h1', provider: 'liteapi' },
  ]);
  assert.equal(s.totalCents, 33401);
  assert.equal(s.canPay, true);
  assert.equal(s.blockedCopy, null);
  // Still said, because those dinners are happening and are not in the total.
  assert.equal(s.conciergeNote, '+ concierge items priced after confirmation');
});

test('a charged row with no price stops the payment', () => {
  // The row is going on the trip and its cost is not in the number on the
  // screen. Charging the total shown would be charging the wrong amount.
  const s = checkoutState([
    { vertical: 'hotel', detail: 'Best Western', price_cents: 33401, provider: 'liteapi', itinerary_item_id: 'h1' },
    { vertical: 'flight', detail: 'AA10 RDU → PVR', price_cents: null, provider: 'duffel', itinerary_item_id: 'f1' },
  ]);
  assert.equal(s.canPay, false);
  assert.equal(s.blockedCopy, "We're still pricing this — check back soon.");
});

test('a failed booking is not something to pay for', () => {
  const s = checkoutState([
    { vertical: 'hotel', detail: 'Best Western', price_cents: 33401, provider: 'liteapi', itinerary_item_id: 'h1' },
    { vertical: 'flight', detail: 'This trip dates have passed', price_cents: null, provider: 'duffel', status: 'failed', itinerary_item_id: 'f1' },
  ]);
  // The failed flight neither blocks the payment nor joins the total.
  assert.equal(s.canPay, true);
  assert.equal(s.totalCents, 33401);
});

test('an empty trip cannot be paid for', () => {
  const s = checkoutState([]);
  assert.equal(s.canPay, false);
  assert.equal(s.totalCents, 0);
});
