import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookedClaim, bookedWording } from '../../lib/checkout.ts';

test('a redirected table is not a booked table', () => {
  // Reach handed them to Resy. Whether there was a table is known to exactly
  // one person and it is not us — there is a "did you get it?" prompt on
  // this same screen, so claiming it is booked contradicts the screen.
  assert.equal(bookedClaim([{ status: 'redirected' }]), 'paid_only');
});

test('nothing settled is money in and nothing else', () => {
  assert.equal(bookedClaim([]), 'paid_only');
  assert.equal(bookedClaim([{ status: 'quoted' }, { status: 'awaiting_approval' }]), 'paid_only');
});

test('every settled row confirmed is the only thing that earns the claim', () => {
  assert.equal(bookedClaim([{ status: 'confirmed' }, { status: 'confirmed' }]), 'all_booked');
  assert.match(bookedWording('all_booked').title, /all booked/);
});

test('one confirmed among others is said as partly, not as all', () => {
  assert.equal(bookedClaim([{ status: 'confirmed' }, { status: 'redirected' }]), 'partly_booked');
  assert.equal(bookedClaim([{ status: 'confirmed' }, { status: 'pending' }]), 'partly_booked');
});

test('failed and cancelled rows do not hold the claim back', () => {
  // A hotel that failed is not a thing still being waited on.
  assert.equal(bookedClaim([{ status: 'confirmed' }, { status: 'failed' }, { status: 'cancelled' }]), 'all_booked');
});

test('every wording says what is true of that state', () => {
  assert.match(bookedWording('paid_only').sub, /Nothing is booked yet/);
  assert.match(bookedWording('partly_booked').sub, /waiting on/);
});
