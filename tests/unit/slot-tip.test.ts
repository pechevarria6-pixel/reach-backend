import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isJourney } from '../../lib/travel-slot.ts';
import { typeForKind, itemNote, rowFromItem, itemFromRow } from '../../lib/contracts/itinerary-item.ts';

// f979c880, "A weekend in Washington", Day 1, as the generator now answers
// it: each slot with its own tip and the kind of the row it cited. The day
// still has a title and, from an older generation, a day-level tip — the
// two things that used to be printed under the morning and evening rows.
const DAY = {
  day: 1,
  title: 'The Mall on foot',
  insider_tip: 'The monuments near the Mall are spread further apart than the map suggests on foot.',
  cost_today: 90,
  morning: { plan: 'Walk the National Mall from the Capitol end.', kind: 'park', tip: 'Start at the Capitol end so the sun is behind you.' },
  afternoon: { plan: 'The Renwick Gallery.', kind: 'museum' },
  evening: { plan: 'End the night at SPIN.', kind: 'bar', place_ref: 'p12', venue: 'SPIN' },
};

// The row builders as the screen runs them, read out of the component so
// this tests the code that ships rather than a copy of it.
function builders(): { itineraryRows: (days: unknown[], nightOut?: boolean) => Record<string, unknown>[] } {
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  const from = app.indexOf('const asSlot=');
  const to = app.indexOf('// Returning null from a screen');
  assert.ok(from > 0 && to > from, 'slotRow and itineraryRows moved; point this test at them');
  const src = app.slice(from, to);
  return new Function('isJourney', 'typeForKind', `${src}; return { itineraryRows };`)(isJourney, typeForKind);
}

test('a day\'s title and tip are never printed under its morning or evening row', () => {
  const rows = builders().itineraryRows([DAY]);
  assert.equal(rows.length, 3);
  const [morning, afternoon, evening] = rows;
  assert.equal(morning.sub, 'Start at the Capitol end so the sun is behind you.', 'the slot\'s own tip');
  assert.equal(afternoon.sub, '', 'no tip, no line');
  assert.equal(evening.sub, '', 'SPIN is not captioned with advice about the monuments');
  for (const r of rows) {
    assert.ok(!String(r.sub).includes('monuments'), 'the day tip landed on a row');
    assert.notEqual(r.sub, DAY.title, 'the day title landed on a row');
  }
});

test('the type is what the cited place is, not where it sits in the day', () => {
  const [morning, afternoon, evening] = builders().itineraryRows([DAY]);
  assert.equal(evening.type, 'activity', 'a bar is not a restaurant');
  assert.equal(afternoon.type, 'activity');
  assert.equal(morning.type, 'activity');
  const dinner = builders().itineraryRows([{ ...DAY, evening: { plan: 'Dinner at Oyamel.', kind: 'restaurant' } }])[2];
  assert.equal(dinner.type, 'restaurant');
  // Nothing says what it is: the position still decides, as it did.
  const bare = builders().itineraryRows([{ ...DAY, evening: { plan: 'Dinner somewhere near the hotel.' } }])[2];
  assert.equal(bare.type, 'restaurant');
  // A ticket and the journey home outrank the kind.
  const gig = builders().itineraryRows([{ ...DAY, evening: { plan: 'See the band at 9:30 CLUB.', kind: 'nightclub', ticket_url: 'https://www.ticketmaster.com/e/1' } }])[2];
  assert.equal(gig.type, 'event');
  const home = builders().itineraryRows([{ ...DAY, evening: { plan: 'Fly home.', kind: 'restaurant' } }])[2];
  assert.equal(home.type, 'transport');
});

test('typeForKind files somewhere to eat as a restaurant and everything else as somewhere to go', () => {
  for (const k of ['restaurant', 'cafe', 'fast_food', 'places to eat', 'italian restaurants', 'markets & food halls', 'bakery']) {
    assert.equal(typeForKind(k), 'restaurant', k);
  }
  for (const k of ['bar', 'pub', 'cocktail bars', 'breweries', 'wine tasting', 'museum', 'museums & history', 'nightclub', 'park', 'supermarket']) {
    assert.equal(typeForKind(k), 'activity', k);
  }
  for (const k of [null, undefined, '', '  ', 3]) assert.equal(typeForKind(k), null);
});

test('a slot\'s tip survives the write and the reload, and an old day note on a row is not shown', () => {
  const [morning] = builders().itineraryRows([DAY]);
  const back = itemFromRow(rowFromItem(morning, 0) as Record<string, unknown>);
  assert.equal(back.sub, DAY.morning.tip, 'the tip is the subtitle, which has a column');
  assert.equal(rowFromItem({ title: 'x', tip: 'Go early.' }, 0).subtitle, 'Go early.', 'a tip handed over by name is kept');
  // What f979c880's SPIN row holds today.
  assert.equal(itemNote(`💡 ${DAY.insider_tip}`), '');
  assert.equal(itemNote('Start at the Capitol end.'), 'Start at the Capitol end.');
  assert.equal(itemNote(null), '');
  // A tip the model itself opened with a 💡 is kept, not hidden with the old ones.
  const marked = builders().itineraryRows([{ ...DAY, afternoon: { plan: 'The Renwick.', kind: 'museum', tip: '💡 Upstairs first.' } }])[1];
  assert.equal(itemNote(marked.sub), 'Upstairs first.');
});

test('the itinerary tab prints the note through itemNote', () => {
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  assert.ok(app.includes('<div className="it-sb">{itemNote(item.sub)}</div>'));
  assert.ok(!app.includes('<div className="it-sb">{item.sub}</div>'));
});
