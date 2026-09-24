import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  itemFromRow, itemsFromRows, rowFromItem, FACTS_THAT_MUST_SURVIVE, ITEM_COLUMNS,
} from '../../lib/contracts/itinerary-item.ts';

// A real row, as the concert plan actually holds it.
const ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  scheduled_time: 'The main event',
  title: 'See The Milk Carton Kids live at 9:30 CLUB.',
  subtitle: '',
  type: 'event',
  confirmation_number: null,
  is_confirmed: true,
  cost_cents: 5500,
  booking_mode: 'ahead',
  payment_note: null,
  because: null,
  venue_website: 'https://www.ticketmaster.com/the-milk-carton-kids-washington-district-of-columbia-09-21-2026/event/15006491BC1DB29B',
  venue_name: '9:30 CLUB',
  venue_phone: null,
  venue_note: 'Pub Trivia Night — every Wednesday Night at 7 PM',
  venue_note_credit: 'https://www.redbear.beer/',
  // The act's picture from the listing that sold the ticket.
  venue_image_url: 'https://s1.ticketm.net/dam/a/1b2/milk-carton-kids_RETINA_PORTRAIT_16_9.jpg',
  venue_image_credit: 'Ticketmaster',
  venue_image_of: 'The Milk Carton Kids',
  sort_order: 1,
};

test('every fact survives the round trip', () => {
  // THE test. Six bugs in one day were a fact that made it into the row and
  // not onto the screen — each one generated right, stored right, returned
  // right, and dropped by a hand-written field list on the way out.
  const item = itemFromRow(ROW);
  const back = rowFromItem(item as unknown as Record<string, unknown>, 1);

  for (const { row, item: itemKey } of FACTS_THAT_MUST_SURVIVE) {
    const original = (ROW as Record<string, unknown>)[row];
    if (original === null || original === undefined) continue;
    assert.equal((item as unknown as Record<string, unknown>)[itemKey], original,
      `${String(itemKey)} was dropped turning a row into a screen item`);
    assert.equal(back[row], original,
      `${String(row)} was dropped turning a screen item back into a row`);
  }
});

test('the ticket url specifically — the one that shipped broken', () => {
  const item = itemFromRow(ROW);
  assert.equal(item.venue_website, ROW.venue_website);
  assert.equal(item.venue_name, '9:30 CLUB');
  // And back again, because the PUT dropped it too until it was fixed.
  assert.equal(rowFromItem(item as unknown as Record<string, unknown>, 0).venue_website, ROW.venue_website);
});

test('what is on survives, which is what makes a plan worth sharing', () => {
  const item = itemFromRow(ROW);
  assert.match(item.venue_note ?? '', /every Wednesday Night at 7 PM/);
  assert.equal(rowFromItem(item as unknown as Record<string, unknown>, 0).venue_note, ROW.venue_note);
});

test('confirmed without a reference number is still confirmed', () => {
  // A ticket bought from the seller: the traveller has it and we hold no
  // number for it. Reading is_confirmed off "does a confirmation number
  // exist" was right for a hotel Reach booked and wrong for this.
  const row = rowFromItem({ title: 'x', filled: true }, 0);
  assert.equal(row.is_confirmed, true);
  assert.equal(row.confirmation_number, null);
});

test('the column list carries every fact the mapper reads', () => {
  // A narrow select is how a fact disappears without anybody touching the
  // mapper: it looks like an optimisation and empties a screen.
  for (const { row } of FACTS_THAT_MUST_SURVIVE) {
    assert.ok(ITEM_COLUMNS.includes(String(row)), `${String(row)} missing from ITEM_COLUMNS`);
  }
});

test('a row missing its title is refused, not quietly blanked', () => {
  assert.throws(() => itemFromRow({ scheduled_time: 'Morning' } as never));
});

test('one bad row does not take the whole trip down with it', () => {
  // itemFromRow throws by design — loud is right on a server and behind a
  // test. On a screen it would white-screen somebody's trip over one old
  // row, which is a worse failure than the one it guards against.
  const items = itemsFromRows([ROW, { scheduled_time: 'Morning' }, { ...ROW, title: 'Day two' }]);
  assert.equal(items.length, 2);
  assert.equal(items[1].title, 'Day two');
});

import { honestMode } from '../../lib/contracts/itinerary-item.ts';
test('a restaurant is never saved as something Reach books', () => {
  assert.equal(honestMode('restaurant', 'reach'), 'ahead');
  assert.equal(honestMode('event', 'reach'), 'ahead');
  assert.equal(honestMode('transport', 'reach'), 'ahead');
  assert.equal(honestMode('hotel', 'reach'), 'reach');
  assert.equal(honestMode('restaurant', 'walk_in'), 'walk_in');
  assert.equal(honestMode('activity', null), null);
});
