import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carriedOverOnRebuild, afterRebuild, awayMissing, afterAwayRebuild } from '../../lib/itinerary-rebuild.ts';

// A trip as the generate path builds it: the three fixed lines, then the days.
const TRIP = [
  { time: 'Before you go', type: 'flight',     title: 'Round-trip flights',    booking_mode: 'reach' },
  { time: 'Before you go', type: 'hotel',      title: 'Downtown Moab',         booking_mode: 'reach' },
  { time: 'Before you go', type: 'transport',  title: 'Airport transfers',     booking_mode: 'reach' },
  { time: 'Day 1 · Evening',   type: 'restaurant', title: "Dinner at Pasta Jay's", booking_mode: 'ahead' },
  { time: 'Day 2 · Morning',   type: 'activity',   title: 'Dead Horse Point',     booking_mode: 'walk_in' },
];
const FRESH = [
  { time: 'Day 1 · Evening', type: 'restaurant', title: 'Dinner at Antica Forma', booking_mode: 'ahead' },
  { time: 'Day 2 · Morning', type: 'activity',   title: 'Arches at first light',  booking_mode: 'walk_in' },
];

test('rebuilding the days does not unbook the trip', () => {
  // THE test. Saving an itinerary replaces it, so anything a rebuild drops is
  // deleted — and dropping these three deletes everything Reach can book.
  const after = afterRebuild(TRIP, FRESH);
  const bookable = after.filter(i => i.booking_mode === 'reach');
  assert.equal(bookable.length, 3, 'the trip stopped being bookable');
  assert.deepEqual(bookable.map(i => i.type), ['flight', 'hotel', 'transport']);
});

test('the flight comes before the first morning', () => {
  // Same order the generate path produces, so the two cannot look different.
  const after = afterRebuild(TRIP, FRESH);
  assert.equal(after[0].type, 'flight');
  assert.equal(after[3].title, 'Dinner at Antica Forma');
  assert.equal(after.length, 5);
});

test('the old days are gone — that is what a rebuild is', () => {
  const after = afterRebuild(TRIP, FRESH);
  assert.ok(!after.some(i => i.title === "Dinner at Pasta Jay's"));
  assert.ok(!after.some(i => i.title === 'Dead Horse Point'));
});

test('a restaurant is never carried over, whatever its slot says', () => {
  // Keyed on slot AND type. Either alone is looser than it needs to be.
  const odd = [{ time: 'Before you go', type: 'restaurant', title: 'A dinner mislabelled' }];
  assert.equal(carriedOverOnRebuild(odd).length, 0);
});

test('a flight in a day slot is not a fixed cost line', () => {
  const odd = [{ time: 'Day 3 · Morning', type: 'flight', title: 'A scenic flight over the canyon' }];
  assert.equal(carriedOverOnRebuild(odd).length, 0);
});

test('a trip that never had them is not given any', () => {
  // A night out has no flights and no stay, and inventing them would be the
  // opposite mistake.
  assert.deepEqual(carriedOverOnRebuild(FRESH), []);
  assert.equal(afterRebuild([], FRESH).length, 2);
  assert.equal(afterRebuild(null, FRESH).length, 2);
});

// ─── An away plan rebuilt keeps getting there and a bed (Task 6a) ────────
const RESTORE = [
  { time: 'Before you go', type: 'flight',    title: 'Round-trip flights to GJT' },
  { time: 'Before you go', type: 'transport', title: 'Rental car from Grand Junction Regional (GJT)' },
  { time: 'Before you go', type: 'hotel',     title: 'Somewhere to stay · 13 nights' },
];

test('Moab, rebuilt after it had lost its flight and its stay, gets both back', () => {
  // The damage in the table: thirty-nine lines, not one of them bookable.
  assert.deepEqual(awayMissing(FRESH, { nights: 13 }), ['transport', 'lodging']);
  const after = afterAwayRebuild(FRESH, FRESH, RESTORE, { nights: 13 });
  assert.deepEqual(after.slice(0, 3).map(i => i.type), ['flight', 'transport', 'hotel']);
  assert.equal(after.length, FRESH.length + 3);
});

test('a plan that has both is rebuilt exactly as before — nothing doubled', () => {
  assert.deepEqual(awayMissing(TRIP, { nights: 7 }), []);
  assert.deepEqual(afterAwayRebuild(TRIP, FRESH, RESTORE, { nights: 7 }), afterRebuild(TRIP, FRESH));
});

test('only the missing one comes back, and a car is never added beside one it kept', () => {
  const noBed = TRIP.filter(i => i.type !== 'hotel');
  const after = afterAwayRebuild(noBed, FRESH, RESTORE, { nights: 7 });
  assert.equal(after.filter(i => i.type === 'hotel').length, 1);
  assert.equal(after.filter(i => i.type === 'flight').length, 1);
  assert.equal(after.filter(i => i.type === 'transport').length, 1, 'the transfer it kept, and no second car');
  const noFlight = TRIP.filter(i => i.type !== 'flight');
  const back = afterAwayRebuild(noFlight, FRESH, RESTORE, { nights: 7 });
  assert.equal(back.filter(i => i.type === 'flight').length, 1);
  assert.equal(back.filter(i => i.type === 'transport').length, 1);
});

test('a day trip needs no bed', () => {
  assert.deepEqual(awayMissing([TRIP[0]], { nights: 0 }), []);
});
