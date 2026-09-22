import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemTitle, dedupe, checkoutState, hasOwnName } from '../../lib/checkout.ts';

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
  // The "Reservation request:" prefix is how the row was stored, not what
  // the place is called, so it is not part of the name.
  assert.equal(itemTitle(SCREENSHOT[0]), 'seafood dinner at the marina');
  // The actual defect: detail is a string, so .title and .name were both
  // undefined and every row fell through to the enum.
  assert.notEqual(itemTitle(SCREENSHOT[0]), 'restaurant');
});

test('older rows that stored an object still read correctly', () => {
  assert.equal(itemTitle({ vertical: 'hotel', detail: { title: 'Best Western Raleigh' } }), 'Best Western Raleigh');
  assert.equal(itemTitle({ vertical: 'hotel', detail: { name: 'Hotel Vallarta' } }), 'Hotel Vallarta');
});

test('a row with no name is described, never called "details coming"', () => {
  // Eleven rows in the table have no detail — mostly flights that failed
  // before a provider named one — and "Trip item (details coming)" promised
  // details that were never coming. A placeholder does not reach a screen.
  assert.equal(itemTitle({ vertical: 'restaurant', detail: null }), 'A table');
  assert.equal(itemTitle({ vertical: 'flight', detail: '   ' }), 'A flight');
  assert.equal(itemTitle({ vertical: 'hotel', detail: null }), 'Somewhere to stay');
  // A vertical nobody has written a noun for is still not a placeholder.
  assert.equal(itemTitle({ vertical: 'something-new', detail: null }), 'Part of this trip');
});

test('the itinerary line names the booking when the provider did not', () => {
  // The hotel booking that failed on Puerto Vallarta has no detail and does
  // have a line: it is "7 nights in Puerto Vallarta", whatever came back.
  assert.equal(
    itemTitle({ vertical: 'hotel', detail: null }, '7 nights in Puerto Vallarta'),
    '7 nights in Puerto Vallarta',
  );
  // And a real detail still wins over the fallback.
  assert.equal(itemTitle({ vertical: 'hotel', detail: 'Best Western' }, 'a line'), 'Best Western');
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
  // Still "pricing", and rightly: these are tables somebody is arranging,
  // and a price does arrive once they are confirmed. That is different from
  // a plan where nothing is chargeable and nothing is being arranged, which
  // waits for a quote that is never coming — see below.
  assert.equal(s.nothingToCharge, false);
  assert.equal(s.blockedCopy, "We're still pricing this — check back soon.");
  assert.equal(s.conciergeNote, '+ a few things we price once they are confirmed');
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
  assert.equal(s.conciergeNote, '+ a few things we price once they are confirmed');
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

test('a failed booking never joins the total, and now holds the button', () => {
  // This asserted canPay === true. The owner's rule is that nobody should
  // confirm a broken plan, so a failure holds the button until it is either
  // fixed or knowingly skipped. The total is unchanged: a failed booking was
  // never money anybody owed.
  const rows = [
    { vertical: 'hotel', detail: 'Best Western', price_cents: 33401, provider: 'liteapi', itinerary_item_id: 'h1' },
    { vertical: 'flight', detail: 'This trip dates have passed', price_cents: null, provider: 'duffel', status: 'failed', itinerary_item_id: 'f1' },
  ];
  const s = checkoutState(rows);
  assert.equal(s.canPay, false);
  assert.equal(s.totalCents, 33401);

  // And never a trap. That flight cannot be booked at any price — the trip
  // has started — so without a way past it the hotel could never be paid for
  // either.
  const past = checkoutState(rows, { ignoreBroken: true });
  assert.equal(past.canPay, true);
  assert.equal(past.totalCents, 33401);
});

test('an empty trip cannot be paid for', () => {
  const s = checkoutState([]);
  assert.equal(s.canPay, false);
  assert.equal(s.totalCents, 0);
});

test('rows written before the label was shortened still read as a name', () => {
  // Verbatim from production on the Moab trip: the whole request in one
  // string, including a tip about a sunrise hike under a dinner booking.
  const legacy = 'Reservation request: Seafood dinner at the chef\'s counter at Desert Bistro,  · 2026-09-17 Day 3 · Evening · party of 2 · "Mesa Arch at sunrise means a crowd of photographers shoulder to shoulder."';
  assert.equal(
    itemTitle({ vertical: 'restaurant', detail: legacy }),
    "Seafood dinner at the chef's counter at Desert Bistro",
  );
});

test('a name that happens to contain no separator is left alone', () => {
  assert.equal(itemTitle({ vertical: 'hotel', detail: 'Best Western Raleigh' }), 'Best Western Raleigh');
  // The new short label, which already has the shape we want.
  assert.equal(itemTitle({ vertical: 'restaurant', detail: 'Desert Bistro, Moab' }), 'Desert Bistro, Moab');
});

test('a line that failed and was then booked shows the booking', () => {
  // The unique index means one row per line, so a retry arrives as a second
  // row. Keeping the first would have shown the failure and hidden the fare.
  const rows = [
    { vertical: 'flight', detail: 'dates have passed', status: 'failed', price_cents: null, itinerary_item_id: 'f1' },
    { vertical: 'flight', detail: 'American Airlines · RDU → PVR', status: 'awaiting_approval', price_cents: 23663, itinerary_item_id: 'f1' },
  ];
  const s = checkoutState(rows);
  assert.equal(s.rows.length, 1);
  assert.equal(s.rows[0].status, 'awaiting_approval');
  assert.equal(s.totalCents, 23663);
});

test('a superseded attempt is not listed at all', () => {
  const s = checkoutState([
    { vertical: 'flight', detail: 'an older try', status: 'cancelled', price_cents: null },
    { vertical: 'hotel', detail: 'Best Western', status: 'confirmed', price_cents: 33401, itinerary_item_id: 'h1' },
  ]);
  assert.equal(s.rows.length, 1);
  assert.equal(s.totalCents, 33401);
  assert.equal(s.canPay, true);
});

test('a flight a person books is still a flight the group pays for', () => {
  // Booked by hand because the automated channel will not carry an X
  // passport marker. It has a real fare and the group owes it — excluding
  // it by provider showed a total of nothing and refused a real payment.
  const s = checkoutState([
    { vertical: 'flight', detail: 'American Airlines · RDU → PVR', price_cents: 23663,
      provider: 'concierge', mode: 'concierge', status: 'pending', itinerary_item_id: 'f1' },
  ]);
  assert.equal(s.totalCents, 23663);
  assert.equal(s.canPay, true);
  assert.equal(s.conciergeNote, null, 'it has a price, so nothing is priced later');
});

test('a table somebody rings up about is still not a purchase', () => {
  const s = checkoutState([
    { vertical: 'hotel', detail: 'Best Western', price_cents: 33401, provider: 'liteapi', itinerary_item_id: 'h1' },
    { vertical: 'restaurant', detail: 'Desert Bistro', price_cents: null,
      provider: 'concierge', mode: 'concierge', status: 'pending', itinerary_item_id: 'r1' },
  ]);
  assert.equal(s.totalCents, 33401, 'the dinner is settled at the venue');
  assert.equal(s.canPay, true);
  assert.equal(s.conciergeNote, '+ a few things we price once they are confirmed');
});

// ─── A plan can be finished without Reach taking any money ──────────────

test('nothing chargeable is not the same as nothing priced yet', () => {
  // The concert case. The ticket is bought from the seller, the bar is a
  // walk-in, and no quote is ever coming. This read "We're still pricing
  // this — check back soon" over a permanently dead button.
  const state = checkoutState([]);
  assert.equal(state.nothingToCharge, true);
  assert.equal(state.canPay, false);
  assert.match(state.blockedCopy ?? '', /yours to book/);
  assert.doesNotMatch(state.blockedCopy ?? '', /still pricing/);
});

test('something chargeable and unpriced still says we are pricing it', () => {
  // The opposite case, where waiting IS the right answer.
  const state = checkoutState([
    { id: 'a', vertical: 'hotel', mode: 'native', status: 'quoted', price_cents: null },
  ] as never);
  assert.equal(state.nothingToCharge, false);
  assert.equal(state.canPay, false);
  assert.match(state.blockedCopy ?? '', /still pricing/);
});

test('a priced row still pays as before', () => {
  const state = checkoutState([
    { id: 'a', vertical: 'hotel', mode: 'native', status: 'quoted', price_cents: 12000 },
  ] as never);
  assert.equal(state.nothingToCharge, false);
  assert.equal(state.canPay, true);
  assert.equal(state.blockedCopy, null);
});

test('a failed booking keeps the pay button shut', () => {
  // charged() drops failed rows, so they were invisible to canPay: a plan
  // whose flight could not be booked still offered "Looks good" over a total
  // that quietly excluded it. Somebody confirms a trip they believe is whole
  // and finds out later that a piece of it never happened.
  const state = checkoutState([
    { vertical: 'hotel',  detail: 'Two nights in Moab', price_cents: 33401, status: 'confirmed' },
    { vertical: 'flight', detail: 'RDU → SLC',          price_cents: 21200, status: 'failed' },
  ]);
  assert.equal(state.canPay, false);
  assert.equal(state.broken.length, 1);
  assert.match(state.blockedCopy ?? '', /couldn't be made/i);
  assert.match(state.blockedCopy ?? '', /carry on without it/i);
});

test('the failed row is still listed, only the button is shut', () => {
  // Hiding it would be worse: the row carries the provider's reason, and
  // that reason is the only way anybody knows what to do next.
  const state = checkoutState([
    { vertical: 'hotel',  detail: 'Two nights in Moab', price_cents: 33401, status: 'confirmed' },
    { vertical: 'flight', detail: 'RDU → SLC',          price_cents: 21200, status: 'failed' },
  ]);
  assert.equal(state.rows.length, 2);
});

test('once nothing has failed the button opens again', () => {
  const state = checkoutState([
    { vertical: 'hotel', detail: 'Two nights in Moab', price_cents: 33401, status: 'confirmed' },
  ]);
  assert.equal(state.canPay, true);
  assert.equal(state.blockedCopy, null);
});

test('two failures are counted, not pluralised wrongly', () => {
  const state = checkoutState([
    { vertical: 'hotel',  detail: 'A stay',  price_cents: 1000, status: 'confirmed' },
    { vertical: 'flight', detail: 'A seat',  price_cents: 2000, status: 'failed' },
    { vertical: 'activity', detail: 'A tour', price_cents: 3000, status: 'failed' },
  ]);
  assert.match(state.blockedCopy ?? '', /2 bookings couldn't be made/i);
});

test('whether a row is named is a fact about the row, not about the copy', () => {
  // dedupe used to ask "is the title the placeholder string?". Renaming the
  // placeholder would then have merged two unnamed rows into one and dropped
  // somebody's booking — which is what the test above exists to prevent, and
  // what renaming it nearly did.
  assert.equal(hasOwnName({ vertical: 'activity', detail: null }), false);
  assert.equal(hasOwnName({ vertical: 'activity', detail: '  ' }), false);
  assert.equal(hasOwnName({ vertical: 'activity', detail: 'Pottery class' }), true);
  assert.equal(hasOwnName({ vertical: 'hotel', detail: { name: 'Best Western' } }), true);
});
