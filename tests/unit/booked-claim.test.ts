import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookedClaim, bookedWording, type BookedClaim } from '../../lib/checkout.ts';

// What the screen after approval may say at the top. Each case is a row
// shape that has reached a real screen.

test('a redirected table is not a booked table', () => {
  // Reach handed them to Resy. Whether there was a table is known to exactly
  // one person and it is not us — there is a "did you get it?" prompt on
  // this same screen, so claiming it is booked contradicts the screen.
  assert.equal(bookedClaim([{ status: 'redirected' }]), 'paid_only');
});

test('nothing confirmed and nothing failed is not a booking of any kind', () => {
  assert.equal(bookedClaim([]), 'paid_only');
  assert.equal(bookedClaim([{ status: 'quoted' }, { status: 'awaiting_approval' }]), 'paid_only');
});

test('every row confirmed is the only thing that earns "all booked"', () => {
  assert.equal(bookedClaim([{ status: 'confirmed' }, { status: 'confirmed' }]), 'all_booked');
  assert.match(bookedWording('all_booked').title, /all booked/);
});

test('one confirmed among others still open is said as partly, not as all', () => {
  assert.equal(bookedClaim([{ status: 'confirmed' }, { status: 'redirected' }]), 'partly_booked');
  assert.equal(bookedClaim([{ status: 'confirmed' }, { status: 'pending' }]), 'partly_booked');
  // Held is not booked either: somebody chose to wait on it.
  assert.equal(bookedClaim([{ status: 'confirmed' }, { status: 'quoted' }]), 'partly_booked');
});

test('a failure beside a booking is a gap the headline owns', () => {
  // The bug: "You're all booked!" above a row reading "Couldn't book",
  // because failed rows were left out of the question altogether.
  const claim = bookedClaim([{ status: 'confirmed' }, { status: 'failed' }]);
  assert.equal(claim, 'booked_with_gaps');
  assert.doesNotMatch(bookedWording(claim).title, /all booked/i);
});

test('everything failed is "nothing was booked", never a celebration', () => {
  assert.equal(bookedClaim([{ status: 'failed' }, { status: 'failed' }]), 'nothing_booked');
  assert.match(bookedWording('nothing_booked').title, /Nothing was booked/);
});

test('a cancelled attempt is history, not a gap', () => {
  assert.equal(bookedClaim([{ status: 'confirmed' }, { status: 'cancelled' }]), 'all_booked');
});

test('a line that failed and was then booked reads as the booking', () => {
  // Read on the rows the screen lists: two rows for one itinerary line
  // collapse to the one that says more, so the old failure is not a gap.
  const rows = [
    { id: 'a', vertical: 'hotel', status: 'failed', itinerary_item_id: 'line-1' },
    { id: 'b', vertical: 'hotel', status: 'confirmed', itinerary_item_id: 'line-1' },
  ];
  assert.equal(bookedClaim(rows), 'all_booked');
});

test('two different lines, one failed, are not collapsed into the booking', () => {
  const rows = [
    { id: 'a', vertical: 'hotel', status: 'confirmed', itinerary_item_id: 'line-1' },
    { id: 'b', vertical: 'flight', status: 'failed', itinerary_item_id: 'line-2' },
  ];
  assert.equal(bookedClaim(rows), 'booked_with_gaps');
});

test('no wording promises a follow-up nothing makes', () => {
  // "we'll confirm each one with you" was the paid_only line. Nothing in the
  // app confirms anything with anybody.
  const claims: BookedClaim[] = ['all_booked', 'booked_with_gaps', 'partly_booked', 'nothing_booked', 'paid_only'];
  for (const c of claims) {
    const w = bookedWording(c);
    assert.doesNotMatch(`${w.title} ${w.sub}`, /we'll (confirm|follow|sort)/i, c);
  }
  assert.match(bookedWording('paid_only').title, /Nothing is booked yet/);
  assert.match(bookedWording('partly_booked').sub, /waiting on/);
});
