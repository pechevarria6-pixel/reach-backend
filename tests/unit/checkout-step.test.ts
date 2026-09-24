import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkoutState, supportMailto, refundWords, termsFor, PRICE_CHECK_WORDS, TERMS_KEPT_WORDS, namesMe, SUPPORT_EMAIL,
  type CheckoutRow, type FundingView,
} from '../../lib/checkout.ts';
import { approveOutcome, nextStepFor, stillProblems } from '../../lib/booking/approve-outcome.ts';

// ─── Which button the checkout screen offers ─────────────────────────────
// A funded plan had no Book button: approval only ran straight after a
// payment in the same visit, so coming back to a paid trip offered "Looks
// good" — a second payment — and never "Book it".

const HOTEL: CheckoutRow = { id: 'h', vertical: 'hotel', status: 'awaiting_approval', price_cents: 40000, mode: 'native', provider: 'liteapi', itinerary_item_id: 'l1' };
const FLIGHT: CheckoutRow = { id: 'f', vertical: 'flight', status: 'awaiting_approval', price_cents: 20000, mode: 'native', provider: 'duffel', itinerary_item_id: 'l2' };

const fund = (f: FundingView): FundingView => ({ memberCount: 2, targetCents: 60000, ...f });

test('a plan paid for in full, with something waiting, offers Book it', () => {
  const s = checkoutState([HOTEL, FLIGHT], {
    funding: fund({ collectedCents: 60000, funded: true, myPaidCents: 30000, myRemainingCents: 0 }),
  });
  assert.equal(s.step, 'book');
  assert.equal(s.canBook, true);
});

test('a member whose share somebody else covered can still book a funded plan', () => {
  // Approval checks the plan's money, not the presser's. Offering this
  // person a payment would take money the plan does not need.
  const s = checkoutState([HOTEL], {
    funding: fund({ targetCents: 40000, collectedCents: 40000, funded: true, myPaidCents: 0, myRemainingCents: 20000 }),
  });
  assert.equal(s.step, 'book');
});

test('nobody has paid: pay', () => {
  const s = checkoutState([HOTEL], { funding: fund({ collectedCents: 0, funded: false, myPaidCents: 0, myRemainingCents: 20000 }) });
  assert.equal(s.step, 'pay');
  assert.equal(s.canBook, false);
});

test('paid before and owing more now is a top-up, not a first payment', () => {
  const s = checkoutState([HOTEL], {
    funding: fund({ targetCents: 44000, collectedCents: 40000, funded: false, myPaidCents: 20000, myRemainingCents: 2000 }),
  });
  assert.equal(s.step, 'top_up');
});

test('my part paid and others still owing is waiting — and only then', () => {
  const s = checkoutState([HOTEL], {
    funding: fund({ targetCents: 40000, collectedCents: 20000, funded: false, myPaidCents: 20000, myRemainingCents: 0 }),
  });
  assert.equal(s.step, 'waiting');
  // A trip for one has nobody else to wait on.
  const solo = checkoutState([HOTEL], {
    funding: { memberCount: 1, targetCents: 40000, collectedCents: 20000, funded: false, myPaidCents: 20000, myRemainingCents: 0 },
  });
  assert.notEqual(solo.step, 'waiting');
});

test('a failure still holds the Book button until somebody carries on without it', () => {
  const failed: CheckoutRow = { id: 'x', vertical: 'flight', status: 'failed', itinerary_item_id: 'l3' };
  const funding = fund({ targetCents: 40000, collectedCents: 40000, funded: true, myPaidCents: 40000, myRemainingCents: 0 });
  assert.equal(checkoutState([HOTEL, failed], { funding }).step, 'blocked');
  assert.equal(checkoutState([HOTEL, failed], { funding, ignoreBroken: true }).step, 'book');
});

test('paid, nothing bought, nothing waiting: said, not "Nothing to pay"', () => {
  const failed: CheckoutRow = { id: 'x', vertical: 'hotel', status: 'failed', itinerary_item_id: 'l1' };
  const s = checkoutState([failed], {
    funding: fund({ targetCents: 0, collectedCents: 147400, funded: false, myPaidCents: 147400, myRemainingCents: 0 }),
  });
  assert.equal(s.step, 'paid_nothing_booked');
  assert.equal(s.nothingToCharge, true, 'the old screen read this and said "Nothing to pay"');
});

test('a booking with the provider right now is neither booked nor failed', () => {
  const s = checkoutState([{ ...HOTEL, status: 'booking' }], {
    funding: fund({ targetCents: 40000, collectedCents: 40000, funded: true, myPaidCents: 40000, myRemainingCents: 0 }),
  });
  assert.equal(s.step, 'in_progress');
});

test('everything bought is booked, and offers no payment', () => {
  const s = checkoutState([{ ...HOTEL, status: 'confirmed' }], {
    funding: fund({ targetCents: 40000, collectedCents: 40000, funded: true, myPaidCents: 40000, myRemainingCents: 0 }),
  });
  assert.equal(s.step, 'booked');
});

test('without funding figures the screen behaves as it did', () => {
  assert.equal(checkoutState([HOTEL]).step, 'pay');
  assert.equal(checkoutState([]).step, 'nothing');
});

// ─── Approval's answers, each with its way on ───────────────────────────

test('approval carries who is missing and both prices through', () => {
  const missing = approveOutcome(400, { code: 'travellers_missing', who: ['Sam Lee', ''], error: 'Sam Lee needs to add their travel details.' });
  assert.deepEqual(missing.who, ['Sam Lee']);
  assert.equal(nextStepFor(missing, 'flight'), 'details');
  const rise = approveOutcome(409, { code: 'price_changed', oldCents: 20000, newCents: 26000 });
  assert.equal(rise.kind, 'priceUp');
  assert.equal(rise.oldCents, 20000);
  assert.equal(rise.newCents, 26000);
});

test('each refusal has its own next step, and a provider refusal is retried by approval', () => {
  assert.equal(nextStepFor(approveOutcome(502, { code: 'provider_failed', error: 'Card declined by airline.' }), 'flight'), 'retry');
  assert.equal(nextStepFor(approveOutcome(409, { code: 'unavailable' }), 'hotel'), 'other_options');
  assert.equal(nextStepFor(approveOutcome(409, { code: 'unavailable' }), 'activity'), 'plan');
  assert.equal(nextStepFor(approveOutcome(409, { code: 'already_in_progress' }), 'hotel'), 'recheck');
  assert.equal(nextStepFor(approveOutcome(502, { code: 'outcome_unknown' }), 'hotel'), 'recheck');
  assert.equal(nextStepFor(approveOutcome(409, { code: 'changed' }), 'hotel'), 'recheck');
  // Our own 500: nothing was bought, so trying again is safe.
  assert.equal(nextStepFor(approveOutcome(500, { error: 'Could not check the payments just now.' }), 'hotel'), 'retry');
});

test('"someone else is booking this" goes once the other press has finished', () => {
  const problems = [
    { bookingId: 'a', step: 'recheck' as const },
    { bookingId: 'b', step: 'recheck' as const },
    { bookingId: 'c', step: 'retry' as const },
  ];
  const left = stillProblems(problems, [{ id: 'a', status: 'confirmed' }, { id: 'b', status: 'booking' }, { id: 'c', status: 'confirmed' }]);
  assert.deepEqual(left.map(p => p.bookingId), ['b', 'c']);
});

test('a booking the provider refused is priced again, never "tried again" into nothing', () => {
  // Approval marks a refused row failed and only runs rows still waiting, so
  // "Try again" skipped it and landed on the done screen.
  const left = stillProblems([
    { bookingId: 'f', step: 'retry' as const },
    { bookingId: 'w', step: 'retry' as const },
  ], [{ id: 'f', status: 'failed' }, { id: 'w', status: 'awaiting_approval' }]);
  assert.deepEqual(left.map(p => [p.bookingId, p.step]), [['f', 'price_again'], ['w', 'retry']]);
  const src = readFileSync('components/reach-app.jsx', 'utf8');
  assert.match(src, /p\.step==="price_again"/);
});

// ─── Only what Reach buys is Book it's to book ───────────────────────────

const TICKET: CheckoutRow = { id: 't', vertical: 'event', status: 'awaiting_approval', price_cents: 9000, mode: 'redirect', provider: 'ticketmaster', itinerary_item_id: 'l3' };

test('a night out whose only row is a seller\'s ticket has nothing to pay', () => {
  assert.equal(checkoutState([TICKET]).step, 'nothing');
  assert.equal(checkoutState([TICKET], { funding: { memberCount: 1, targetCents: 0, collectedCents: 0, funded: true, myPaidCents: 0, myRemainingCents: 0 } }).step, 'nothing');
  assert.deepEqual(checkoutState([TICKET]).waiting, []);
});

test('a paid plan never offers Book it for a ticket Reach cannot buy', () => {
  const s = checkoutState([{ ...HOTEL, status: 'confirmed' }, TICKET], {
    funding: fund({ targetCents: 40000, collectedCents: 40000, funded: true, myPaidCents: 40000, myRemainingCents: 0 }),
  });
  assert.equal(s.step, 'booked');
  assert.equal(s.canBook, false);
  // And the button's own loop asks approval for what checkout counts, no more.
  const src = readFileSync('components/reach-app.jsx', 'utf8');
  assert.match(src, /const waiting=checkoutState\(fresh\|\|\[\]\)\.waiting;/);
});

// ─── A booking that may already be bought ───────────────────────────────

test('a booking mid-claim is never offered to Book it, and past any answer is in doubt', () => {
  const t0 = '2026-09-24T12:00:00.000Z';
  const mid: CheckoutRow = { ...HOTEL, approved_at: t0, updated_at: t0 };
  const paid = { memberCount: 1, targetCents: 40000, collectedCents: 40000, funded: true, myPaidCents: 40000, myRemainingCents: 0 };
  const now = checkoutState([mid], { funding: paid, now: new Date('2026-09-24T12:00:30Z') });
  assert.equal(now.step, 'in_progress');
  assert.deepEqual(now.waiting, []);
  const later = checkoutState([mid], { funding: paid, now: new Date('2026-09-24T12:30:00Z') });
  assert.equal(later.step, 'in_doubt');
  assert.deepEqual(later.inDoubt.map(r => r.id), ['h']);
  // Approval's own note says so at once, whatever the clock.
  const unknown = checkoutState([{ ...mid, status: 'booking', error: 'outcome unknown: timed out' }], { funding: paid, now: new Date('2026-09-24T12:00:05Z') });
  assert.equal(unknown.step, 'in_doubt');
  const src = readFileSync('components/reach-app.jsx', 'utf8');
  assert.match(src, /s==="in_doubt"/);
});

// ─── Writing in, and getting money back ─────────────────────────────────

test('the email link carries the plan and the payment references', () => {
  const href = supportMailto({ planId: 'p1', planName: 'Moab', what: 'Money paid, nothing booked', payments: ['pi_1', null, 'pi_1'], bookings: ['b9'] });
  assert.ok(href.startsWith(`mailto:${SUPPORT_EMAIL}?`));
  const body = decodeURIComponent(href.split('body=')[1]);
  assert.match(body, /p1/);
  assert.match(body, /pi_1/);
  assert.equal(body.match(/pi_1/g)?.length, 1, 'a reference is written once');
  assert.match(body, /b9/);
  assert.match(decodeURIComponent(href.split('subject=')[1].split('&')[0]), /Moab/);
});

test('a refund answer is shown in the server\'s words', () => {
  assert.deepEqual(refundWords(200, { refundedCents: 5000, message: '$50.00 is on its way back.' }), { ok: true, text: '$50.00 is on its way back.' });
  assert.equal(refundWords(409, { error: 'There is nothing to give back.' }).text, 'There is nothing to give back.');
  assert.equal(refundWords(409, {}).ok, false);
  assert.match(refundWords(502, null).text, /nothing was refunded/);
});

// ─── Fare terms before the money ────────────────────────────────────────

test('a fare\'s terms are shown, and unknown terms are said as unknown', () => {
  const said = termsFor({ vertical: 'flight', mode: 'native', provider: 'duffel', status: 'awaiting_approval', conditions: ['No changes once booked', 'Non-refundable'] });
  assert.equal(said?.terms, 'No changes once booked · Non-refundable');
  const silent = termsFor({ vertical: 'flight', mode: 'native', provider: 'duffel', status: 'awaiting_approval', conditions: null });
  assert.equal(silent?.terms, "The airline hasn't said whether this fare can be changed or refunded.");
  // Not Reach's to buy, or already bought: nothing to warn about here.
  assert.equal(termsFor({ vertical: 'flight', mode: 'redirect', provider: 'airline', status: 'awaiting_approval' }), null);
  assert.equal(termsFor({ vertical: 'flight', mode: 'native', provider: 'duffel', status: 'confirmed' }), null);
  assert.equal(termsFor({ vertical: 'restaurant', status: 'awaiting_approval' }), null);
});

test('no price is said to be held: it is checked again when it is booked', () => {
  // Approval prices every fare again and Duffel's book() a third time; the
  // offer's expiry held nothing for the traveller.
  assert.doesNotMatch(PRICE_CHECK_WORDS, /held/i);
  assert.match(PRICE_CHECK_WORDS, /checked again when it's booked/);
  const t = termsFor({ vertical: 'flight', mode: 'native', status: 'awaiting_approval' });
  assert.deepEqual(Object.keys(t ?? {}), ['terms', 'kept']);
  // "Nothing is booked on other terms" only under terms approval compares.
  assert.equal(t?.kept, null);
  assert.equal(termsFor({ vertical: 'hotel', mode: 'native', status: 'awaiting_approval', conditions: ['Non-refundable'] })?.kept, TERMS_KEPT_WORDS);
  const src = readFileSync('components/reach-app.jsx', 'utf8');
  assert.doesNotMatch(src, /Price held until/);
  assert.match(src, /PRICE_CHECK_WORDS/);
});

test('the Profile button is offered to somebody the refusal names', () => {
  const members = [{ id: 'u1', name: 'Sam Lee' }, { id: 'u2', first_name: 'Ana', last_name: 'Ruiz' }];
  assert.equal(namesMe(['Sam Lee'], members, 'u1'), true);
  assert.equal(namesMe(['ana ruiz'], members, 'u2'), true, 'first and last name, as approval names them');
  assert.equal(namesMe(['Sam Lee'], members, 'u2'), false);
  assert.equal(namesMe(['Sam Lee'], members, null), false);
});

// ─── The screen is wired to all of it ───────────────────────────────────

test('checkout books a funded plan, one run at a time, and never promises a follow-up', () => {
  const src = readFileSync('components/reach-app.jsx', 'utf8');
  const start = src.indexOf('function CheckoutScreenV2(');
  const screen = src.slice(start, src.indexOf('// ============ END CHECKOUT V2', start));
  // The money goes into the step.
  assert.match(screen, /checkoutState\(bookings\|\|\[\],\{ignoreBroken:skipBroken,funding\}\)/);
  // Book it runs approval, never a payment.
  assert.match(screen, /if\(s==="book"\)return\(\s*<button disabled=\{busy\} onClick=\{\(\)=>approveAll\(false\)\}/);
  // Guarded for the whole run.
  assert.match(screen, /if\(approvingRef\.current\)return;\s*approvingRef\.current=true;/);
  assert.match(screen, /finally\{\s*approvingRef\.current=false;\s*setBusy\(false\);/);
  // Retrying a refusal approves again; it does not start a payment.
  assert.match(screen, /p\.step==="retry"&&\(\s*<button disabled=\{busy\} onClick=\{\(\)=>approveAll\(false\)\}/);
  // The refund route, and the inbox.
  assert.match(screen, /\/api\/plans\/\$\{planId\}\/funding\/refund/);
  assert.match(screen, /writeIn\(/);
  assert.doesNotMatch(screen, /we'll sort it|We'll follow up|we'll confirm/i);
  // The Profile section for missing travel details.
  assert.match(screen, /goToProfileSection\("flying"\)/);
});
