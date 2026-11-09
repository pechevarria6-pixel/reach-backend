// Run with: npm run test:unit
//
// Pilot gate A3 / directives P3 and P4: only what Reach buys is collected.
// A plan of things people book themselves has nothing to pay through Reach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fundingTarget, guessBudgetCents, NOTHING_THROUGH_REACH } from '../../lib/rail/funding-target.ts';
import { planShares } from '../../lib/money.ts';

const ticket = { id: 't1', price_cents: 18000, mode: 'redirect', provider: 'ticketmaster', vertical: 'event' };
const table = { id: 'r1', price_cents: null, mode: 'redirect', provider: 'redirect', vertical: 'restaurant' };
const airbnb = { id: 'a1', price_cents: 60000, mode: 'redirect', provider: 'airbnb', vertical: 'hotel' };
const hotel = { id: 'h1', price_cents: 40000, mode: 'native', provider: 'liteapi', vertical: 'hotel' };
const flight = { id: 'f1', price_cents: 30000, mode: 'native', provider: 'duffel', vertical: 'flight' };

test('a plan with only redirect items has a $0 target and no payment step', () => {
  const t = fundingTarget([ticket, table, airbnb]);
  assert.equal(t.targetCents, 0);
  assert.equal(t.fundingNeeded, false);
  assert.equal(t.nothingThroughReach, true);
  assert.equal(t.selfPaidCents, 78000, 'still shown as the trip\'s cost, paid elsewhere');
  assert.deepEqual(t.charged, []);
});

test('a mixed plan funds only the native subtotal, and says what is paid elsewhere', () => {
  const t = fundingTarget([ticket, hotel, flight, table]);
  assert.equal(t.targetCents, 70000);
  assert.equal(t.selfPaidCents, 18000);
  assert.equal(t.fundingNeeded, true);
  assert.equal(t.nothingThroughReach, false);
  assert.deepEqual(t.charged.map(r => r.id), ['h1', 'f1']);
});

test('nothing on the plan yet is "still pricing", not "nothing through Reach"', () => {
  const t = fundingTarget([]);
  assert.equal(t.nothingThroughReach, false);
  assert.equal(t.fundingNeeded, false);
});

test('a table Reach books on a platform costs nothing and is not in the target', () => {
  const t = fundingTarget([{ id: 'o1', price_cents: 0, mode: 'native', provider: 'opentable' }]);
  assert.equal(t.targetCents, 0);
  assert.equal(t.nothingThroughReach, true);
});

test('no share is guessed from the budget for a plan that owes Reach nothing', () => {
  const members = ['a', 'b'];
  const redirectOnly = fundingTarget([ticket, airbnb]);
  const guess = guessBudgetCents(redirectOnly, 0, 80000);
  assert.equal(guess, 0);
  assert.deepEqual(planShares(redirectOnly.charged, guess, members), { a: 0, b: 0 });
  // A plan with nothing on it yet still shows the budget as its guess.
  assert.equal(guessBudgetCents(fundingTarget([]), 0, 80000), 80000);
  // And once money is in, never.
  assert.equal(guessBudgetCents(fundingTarget([]), 100, 80000), 0);
});

test('funding reads the target from here, says so for a redirect-only plan, and never "still pricing" over one', () => {
  const src = readFileSync('app/api/plans/[planId]/funding/route.ts', 'utf8');
  assert.match(src, /const target = fundingTarget\(rows\)/);
  assert.match(src, /guessBudgetCents\(target, collectedCents, budgetCents\)/);
  assert.match(src, /status\.targetCents <= 0 && status\.nothingThroughReach[\s\S]{0,300}NOTHING_THROUGH_REACH/);
  assert.match(NOTHING_THROUGH_REACH, /Nothing has been charged/);
});

test('approval holds only what Reach buys to the money (P4): a ticket handed over never waits for the pot', () => {
  const src = readFileSync('app/api/bookings/[id]/approve/route.ts', 'utf8');
  assert.match(src, /if \(movesMoney && funding\.targetCents > 0 && !funding\.funded\)/);
  assert.match(src, /const movesMoney = booking\.vertical !== 'restaurant' && reachBuys\(booking\)/);
});
