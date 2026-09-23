// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  refundOutcome, netPaidCents, collectedCents, refundColumnPresent, planRefund,
  keptBookings, spentThenCancelled, refusal, refundIdempotencyKey, afterStripeRefund,
  isMissingColumn, isMissingTable, paidFailureNotice, paymentRefundCents, goneCents,
  claimAtStripe, liveRefundedCents, refundReply, refundRequestBody,
  type ContributionRow, type RefundClaim,
} from '../../lib/refunds.ts';
import { fundingOf, netCollectedCents } from '../../lib/booking/approval.ts';

const claim = (contribution: string, amount: number, status: string, extra: Partial<RefundClaim> = {}): RefundClaim => ({
  id: `k_${contribution}`, contribution_id: contribution, status, amount_cents: amount,
  refunded_before_cents: 0, attempt: 1, ...extra,
});

const paid = (id: string, user: string, cents: number, extra: Partial<ContributionRow> = {}): ContributionRow => ({
  id, user_id: user, status: 'succeeded', amount_cents: cents,
  stripe_payment_intent: `pi_${id}`, created_at: `2026-09-2${id.length}T10:00:00Z`, ...extra,
});

// ── What a refund does to a contribution ────────────────────────────────

test('a full refund stops the contribution counting', () => {
  assert.deepEqual(refundOutcome(5000, 5000), { status: 'refunded', refundedCents: 5000, partial: false });
});

test('over-refunding is still a refund, and is clamped to the payment', () => {
  // The column's check constraint refuses more than amount_cents, and a
  // refused write in the webhook means Stripe retrying for days.
  assert.deepEqual(refundOutcome(5000, 5100), { status: 'refunded', refundedCents: 5000, partial: false });
});

test('a partial refund keeps counting, less what went back', () => {
  const out = refundOutcome(5000, 500);
  assert.deepEqual(out, { status: 'succeeded', refundedCents: 500, partial: true });
  assert.equal(netPaidCents({ status: out.status, amount_cents: 5000, refunded_cents: out.refundedCents }), 4500);
});

test('nonsense in does not produce a refund', () => {
  assert.equal(refundOutcome(0, 0).status, 'succeeded');
  assert.equal(refundOutcome(NaN as unknown as number, NaN as unknown as number).status, 'succeeded');
});

// ── The funding total ───────────────────────────────────────────────────

test('money handed back never counts towards the target', () => {
  const rows = [
    paid('a', 'u1', 10000, { refunded_cents: 2500 }),
    paid('b', 'u2', 10000),
    paid('c', 'u3', 10000, { status: 'refunded', refunded_cents: 10000 }),
    paid('d', 'u4', 10000, { status: 'pending' }),
  ];
  assert.equal(collectedCents(rows), 17500);
});

test('before the migration, a missing refunded_cents column is nothing refunded', () => {
  const before = [{ id: 'a', user_id: 'u1', status: 'succeeded', amount_cents: 10000 }];
  assert.equal(collectedCents(before), 10000);
  assert.equal(refundColumnPresent(before), false);
  assert.equal(refundColumnPresent([{ ...before[0], refunded_cents: 0 }]), true);
});

// ── Which bookings still hold a payer's money ───────────────────────────

test('failed, held and cancelled-before-booking hold nothing; live and paid-out ones do', () => {
  const rows = [
    { id: 1, status: 'confirmed', price_cents: 100 },
    { id: 2, status: 'awaiting_approval', price_cents: 100 },
    { id: 3, status: 'failed', price_cents: 100, approved_at: '2026-09-20', error: 'No rates available' },
    { id: 4, status: 'quoted', price_cents: 100 },
    { id: 5, status: 'cancelled', price_cents: 100 },
    // Failed, then cancelled by /bookable to try again: the error stays.
    { id: 6, status: 'cancelled', price_cents: 100, approved_at: '2026-09-20', error: 'No rates available' },
    // Booked at the airline, then cancelled: the fare was paid out.
    { id: 7, status: 'cancelled', price_cents: 100, approved_at: '2026-09-20', error: null },
  ];
  assert.deepEqual(keptBookings(rows).map(b => b.id), [1, 2, 7]);
  assert.equal(spentThenCancelled(rows[6]), true);
  assert.equal(spentThenCancelled(rows[5]), false);
});

// ── How much one person gets back ───────────────────────────────────────

test('Moab: everything failed, so the whole payment goes back', () => {
  const out = planRefund({
    userId: 'u1', memberIds: ['u1'],
    bookings: [
      { id: 'h', status: 'failed', price_cents: 120000, approved_at: '2026-09-20', error: 'No rates available' },
      { id: 'f', status: 'cancelled', price_cents: 27400 },
    ],
    contributions: [paid('c1', 'u1', 147400)],
  });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.refundableCents, 147400);
  assert.deepEqual(out.pieces.map(p => [p.contributionId, p.cents]), [['c1', 147400]]);
});

test('paid minus their share of what is still being paid for', () => {
  // Two people, $300 each paid against $600 of bookings. The $200 hotel
  // failed, so $400 is still live: $200 each kept, $100 each back.
  const out = planRefund({
    userId: 'u1', memberIds: ['u1', 'u2'],
    bookings: [
      { id: 'f', status: 'confirmed', price_cents: 40000 },
      { id: 'h', status: 'failed', price_cents: 20000, error: 'sold out' },
    ],
    contributions: [paid('c1', 'u1', 30000), paid('c2', 'u2', 30000)],
  });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.paidCents, 30000);
  assert.equal(out.keptCents, 20000);
  assert.equal(out.refundableCents, 10000);
  // Only their own payment is touched.
  assert.deepEqual(out.pieces.map(p => p.contributionId), ['c1']);
});

test('somebody sitting out the dinner keeps nothing back for it', () => {
  const out = planRefund({
    userId: 'u2', memberIds: ['u1', 'u2'],
    skips: [{ ref: 'dinner', userId: 'u2' }],
    bookings: [
      { id: 'dinner', status: 'confirmed', price_cents: 10000 },
      { id: 'hotel', status: 'failed', price_cents: 20000, error: 'x' },
    ],
    // u1 has paid for the dinner they are going to.
    contributions: [paid('c1', 'u1', 10000), paid('c2', 'u2', 10000)],
  });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.keptCents, 0);
  assert.equal(out.refundableCents, 10000);
});

test('…but while their money is the only money paying for that dinner, it stays', () => {
  // Nobody else has paid, so u2's 10000 is what the plan would pay the
  // restaurant with. Their share is nothing; the plan's spare is nothing too.
  const out = planRefund({
    userId: 'u2', memberIds: ['u1', 'u2'],
    skips: [{ ref: 'dinner', userId: 'u2' }],
    bookings: [{ id: 'dinner', status: 'confirmed', price_cents: 10000 }],
    contributions: [paid('c2', 'u2', 10000)],
  });
  assert.equal(out.why, 'covering_others');
});

test('a refund never makes a funded plan unfunded', () => {
  // After each person takes back what planRefund offers, what is left still
  // covers every booking the funding target counts.
  const members = ['u1', 'u2', 'u3'];
  const bookings = [
    { id: 'f', status: 'confirmed', price_cents: 33334 },
    { id: 'a', status: 'awaiting_approval', price_cents: 10001 },
    { id: 'h', status: 'failed', price_cents: 50000, error: 'x' },
  ];
  const contributions = [paid('c1', 'u1', 31112), paid('c2', 'u2', 31112), paid('c3', 'u3', 31111)];
  let left = 0;
  for (const u of members) {
    const out = planRefund({ userId: u, memberIds: members, bookings, contributions });
    left += out.paidCents - (out.ok ? out.refundableCents : 0);
  }
  assert.equal(left, 33334 + 10001);
});

test('the newest payment goes back first, each up to what it still holds', () => {
  const out = planRefund({
    userId: 'u1', memberIds: ['u1'],
    bookings: [{ id: 'f', status: 'confirmed', price_cents: 5000 }],
    contributions: [
      { ...paid('old', 'u1', 10000), created_at: '2026-09-01T00:00:00Z' },
      { ...paid('new', 'u1', 3000, { refunded_cents: 1000 }), created_at: '2026-09-10T00:00:00Z' },
    ],
  });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  // Paid 13000 − 1000 back = 12000, keeps 5000, so 7000 goes: 2000 from new, 5000 from old.
  assert.deepEqual(out.pieces.map(p => [p.contributionId, p.cents, p.refundedBefore]), [['new', 2000, 1000], ['old', 5000, 0]]);
});

test('only somebody who paid can take money back', () => {
  const out = planRefund({
    userId: 'u2', memberIds: ['u1', 'u2'], bookings: [],
    contributions: [paid('c1', 'u1', 10000), paid('c2', 'u2', 10000, { status: 'pending' })],
  });
  assert.deepEqual([out.ok, !out.ok && out.why], [false, 'not_payer']);
  assert.equal(refusal('not_payer', { paidCents: 0, keptCents: 0 }).status, 403);
});

test('a payment already back in full is already_refunded, not not_payer', () => {
  const out = planRefund({
    userId: 'u1', memberIds: ['u1'], bookings: [],
    contributions: [paid('c1', 'u1', 10000, { status: 'refunded', refunded_cents: 10000 })],
  });
  assert.equal(!out.ok && out.why, 'already_refunded');
  assert.equal(refusal('already_refunded', { paidCents: 0, keptCents: 0 }).status, 409);
});

test('a payment with a refund still going through is not refunded twice', () => {
  const out = planRefund({
    userId: 'u1', memberIds: ['u1'], bookings: [],
    contributions: [paid('c1', 'u1', 10000)],
    claims: [claim('c1', 10000, 'claimed')],
  });
  assert.equal(!out.ok && out.why, 'in_progress');
  // And it is not described as refunded: it is going through, and says so.
  assert.doesNotMatch(refusal('in_progress', { paidCents: 0, keptCents: 0 }).error, /has already been refunded/);
});

test('everything paid is covering live bookings: nothing refundable, 409', () => {
  const out = planRefund({
    userId: 'u1', memberIds: ['u1'],
    bookings: [{ id: 'f', status: 'confirmed', price_cents: 10000 }],
    contributions: [paid('c1', 'u1', 10000)],
  });
  assert.equal(!out.ok && out.why, 'nothing_refundable');
  const r = refusal('nothing_refundable', { paidCents: 10000, keptCents: 10000 });
  assert.equal(r.status, 409);
  assert.match(r.error, /\$100\.00/);
});

test('before the migration, the route refuses and says where to go instead', () => {
  const r = refusal('needs_migration', { paidCents: 10000, keptCents: 4000 });
  assert.equal(r.status, 503);
  assert.match(r.error, /nothing has been refunded/i);
  assert.match(r.error, /hello@alcanzar\.io/);
});

test('a payment with no Stripe intent cannot be refunded through Stripe', () => {
  const out = planRefund({
    userId: 'u1', memberIds: ['u1'], bookings: [],
    contributions: [paid('c1', 'u1', 10000, { stripe_payment_intent: null })],
  });
  assert.equal(!out.ok && out.why, 'nothing_refundable');
});

// ── Talking to Stripe ───────────────────────────────────────────────────

test('one idempotency key per payment per attempt, and never the same for two', () => {
  assert.equal(refundIdempotencyKey('abc'), refundIdempotencyKey('abc'));
  assert.notEqual(refundIdempotencyKey('abc'), refundIdempotencyKey('abd'));
  // The first attempt keeps the original key; a retry after a refusal must
  // not, or Stripe hands back the old refusal for 24 hours.
  assert.equal(refundIdempotencyKey('abc', 1), refundIdempotencyKey('abc'));
  assert.notEqual(refundIdempotencyKey('abc', 2), refundIdempotencyKey('abc', 1));
  assert.notEqual(refundIdempotencyKey('abc', 3), refundIdempotencyKey('abc', 2));
});

test('only a refund that is going through is written on the contribution', () => {
  const piece = { cents: 2000, refundedBefore: 1000, amountCents: 3000 };
  assert.deepEqual(afterStripeRefund(piece, 'succeeded'), { counts: true, outcome: { status: 'refunded', refundedCents: 3000, partial: false } });
  assert.equal(afterStripeRefund(piece, 'pending').counts, true);
  for (const s of ['failed', 'canceled', 'requires_action']) {
    assert.deepEqual(afterStripeRefund(piece, s), { counts: false, outcome: null });
  }
});

test('the migration-not-run errors are recognised, and others are not', () => {
  assert.equal(isMissingColumn({ code: 'PGRST204', message: "Could not find the 'refunded_cents' column" }), true);
  assert.equal(isMissingColumn({ code: '42703', message: 'column contributions.refunded_cents does not exist' }), true);
  assert.equal(isMissingColumn({ code: '23514', message: 'violates check constraint' }), false);
  assert.equal(isMissingTable({ code: 'PGRST205', message: "Could not find the table 'public.refunds'" }), true);
  assert.equal(isMissingTable({ code: '42P01', message: 'relation "public.refunds" does not exist' }), true);
  assert.equal(isMissingTable({ code: '23505', message: 'duplicate key' }), false);
  assert.equal(isMissingTable(null), false);
});

// ── Telling the owner ───────────────────────────────────────────────────

test('a failure after payment is reported with the money at stake', () => {
  const n = paidFailureNotice({
    planId: 'p1', planTitle: 'Moab', bookingId: 'b1', what: 'hotel',
    reason: 'No rates available', collectedCents: 147400,
  });
  assert.ok(n);
  assert.match(n!.subject, /\$1474\.00/);
  assert.ok(n!.lines.some(l => /No rates available/.test(l)));
});

test('a failure before anybody paid is not an alert', () => {
  assert.equal(paidFailureNotice({ planId: 'p1', bookingId: 'b1', collectedCents: 0 }), null);
});

test('the owner alert describes only a way to refund that exists', () => {
  // There is no refund button in the app, and the route refunds only the
  // caller's own payments, so the owner cannot use it for anybody.
  const n = paidFailureNotice({ planId: 'p1', bookingId: 'b1', collectedCents: 100 })!;
  const text = n.lines.join(' ');
  assert.doesNotMatch(text, /funding\/refund|POST /);
  assert.doesNotMatch(text, /can take back/);
  assert.match(text, /Stripe dashboard/);
  assert.match(text, /webhook records it/);
});

// ── Review fixes (2026-09-23) ───────────────────────────────────────────

test('a claimed refund counts as gone before the payment row says so: no over-refund', () => {
  // The reviewer's case. Paid 10000 then 3000, a 5000 booking, owed back
  // 8000. The first request claims the newer payment; a second reads in the
  // gap before refunded_cents is written. It used to plan 8000 more from the
  // older payment — 11000 in all.
  const contributions = [
    { ...paid('old', 'u1', 10000), created_at: '2026-09-01T00:00:00Z' },
    { ...paid('new', 'u1', 3000), created_at: '2026-09-10T00:00:00Z' },
  ];
  const bookings = [{ id: 'f', status: 'confirmed', price_cents: 5000 }];
  const first = planRefund({ userId: 'u1', memberIds: ['u1'], bookings, contributions });
  assert.deepEqual(first.pieces.map(p => [p.contributionId, p.cents]), [['new', 3000], ['old', 5000]]);

  for (const status of ['claimed', 'pending', 'requires_action', 'succeeded']) {
    const second = planRefund({
      userId: 'u1', memberIds: ['u1'], bookings, contributions,
      claims: [claim('new', 3000, status)],
    });
    const total = 3000 + second.pieces.reduce((s, p) => s + p.cents, 0);
    assert.equal(total, 8000, `a ${status} claim on the newer payment`);
  }
  // A refused one is not money gone.
  const afterRefusal = planRefund({
    userId: 'u1', memberIds: ['u1'], bookings, contributions,
    claims: [claim('new', 3000, 'failed')],
  });
  assert.equal(afterRefusal.refundableCents, 8000);
});

test('what has gone is the larger of the payment row and the claim', () => {
  const c = paid('c', 'u1', 10000, { refunded_cents: 2000 });
  assert.equal(goneCents(c, claim('c', 3000, 'claimed', { refunded_before_cents: 2000 })), 5000);
  // The webhook got there first with a dashboard refund on top.
  assert.equal(goneCents({ ...c, refunded_cents: 7000 }, claim('c', 3000, 'succeeded', { refunded_before_cents: 2000 })), 7000);
  assert.equal(goneCents(c, claim('c', 3000, 'failed', { refunded_before_cents: 2000 })), 2000);
  assert.equal(goneCents(c, claim('c', 99999, 'claimed')), 10000);
});

test('an overpayer cannot take back money already paid to a provider', () => {
  // u1 paid the whole 10000 booking, u2 has paid nothing. u1's "share" is
  // 5000, but the plan holds nothing beyond the booking: nothing goes back.
  const bookings = [{ id: 'f', status: 'confirmed', price_cents: 10000 }];
  const out = planRefund({
    userId: 'u1', memberIds: ['u1', 'u2'], bookings,
    contributions: [paid('c1', 'u1', 10000)],
  });
  assert.equal(out.ok, false);
  assert.equal(out.why, 'covering_others');
  assert.equal(out.refundableCents, 0);
  const r = refusal('covering_others', out);
  assert.equal(r.status, 409);
  assert.match(r.error, /Nothing has been refunded/);
  // Once u2 pays in, the spare is real and u1 can have it.
  const later = planRefund({
    userId: 'u1', memberIds: ['u1', 'u2'], bookings,
    contributions: [paid('c1', 'u1', 10000), paid('c2', 'u2', 3000)],
  });
  assert.equal(later.ok && later.refundableCents, 3000);
});

test('whatever order people refund in, the plan still holds every booking Reach is paying for', () => {
  // Unequal payments, a skip, a later joiner, a failed booking and a held
  // one; each person takes back what they are offered, in turn, with the
  // earlier refunds recorded. What is left always covers the kept bookings.
  let seed = 7;
  const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let run = 0; run < 200; run++) {
    const members = ['u1', 'u2', 'u3', 'u4'].slice(0, 2 + rand(3));
    const bookings = [
      { id: 'f', status: 'confirmed', price_cents: 1000 + rand(40000) },
      { id: 'h', status: 'awaiting_approval', price_cents: 1000 + rand(40000) },
      { id: 'x', status: 'failed', price_cents: 1000 + rand(40000), error: 'x' },
      { id: 't', status: 'redirected', mode: 'redirect', price_cents: 1000 + rand(40000) },
    ];
    const skips = rand(2) ? [{ ref: 'h', userId: members[0] }] : [];
    let contributions = members.filter(() => rand(4) > 0).map((u, i) => paid(`c${i}${u}`, u, rand(60000)));
    const spent = 0 + bookings.filter(b => ['confirmed', 'awaiting_approval'].includes(b.status)).reduce((s, b) => s + b.price_cents, 0);
    const heldBefore = collectedCents(contributions);
    for (const u of members) {
      const out = planRefund({ userId: u, memberIds: members, skips, bookings, contributions });
      if (!out.ok) continue;
      contributions = contributions.map(c => {
        const piece = out.pieces.find(p => p.contributionId === c.id);
        return piece ? { ...c, refunded_cents: (c.refunded_cents ?? 0) + piece.cents } : c;
      });
    }
    const left = collectedCents(contributions);
    assert.ok(left >= Math.min(spent, heldBefore), `run ${run}: ${left} left against ${spent} spent`);
  }
});

test('money for a redirect is not kept back: Reach never spends it', () => {
  // A Ticketmaster seat the person buys on Ticketmaster. Funding and
  // approval leave it out (reachBuys); so does a refund.
  const out = planRefund({
    userId: 'u1', memberIds: ['u1'],
    bookings: [
      { id: 't', status: 'redirected', mode: 'redirect', provider: 'ticketmaster', price_cents: 8000 },
      { id: 'r', status: 'pending', mode: 'concierge', price_cents: 3000 },
      { id: 'h', status: 'confirmed', mode: 'api', provider: 'liteapi', price_cents: 5000 },
    ],
    contributions: [paid('c1', 'u1', 16000)],
  });
  assert.equal(out.keptCents, 5000);
  assert.equal(out.ok && out.refundableCents, 11000);
  assert.deepEqual(keptBookings([
    { id: 'a', status: 'redirected', mode: 'redirect' },
    { id: 'b', status: 'cancelled', mode: 'redirect', approved_at: 'x', error: null },
    { id: 'c', status: 'cancelled', approved_at: 'x', error: null },
  ]).map(b => b.id), ['c']);
});

test('a refused refund can be asked for again, as a new attempt with a new key', () => {
  const out = planRefund({
    userId: 'u1', memberIds: ['u1'], bookings: [],
    contributions: [paid('c1', 'u1', 10000)],
    claims: [claim('c1', 10000, 'failed', { attempt: 1 })],
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.pieces.map(p => [p.claimId, p.attempt, p.cents]), [['k_c1', 2, 10000]]);
});

test('after a part refund settles, more can go back later from the same payment', () => {
  // Another booking failed after the first refund: the payment is refunded
  // again, on top of what already went.
  const out = planRefund({
    userId: 'u1', memberIds: ['u1'],
    bookings: [{ id: 'f', status: 'confirmed', price_cents: 2000 }],
    contributions: [paid('c1', 'u1', 10000, { refunded_cents: 3000 })],
    claims: [claim('c1', 3000, 'succeeded', { attempt: 1 })],
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.pieces.map(p => [p.attempt, p.refundedBefore, p.cents]), [[2, 3000, 5000]]);
});

test('a claim whose answer was lost is matched to its refund at Stripe, or marked failed', () => {
  const k = claim('c1', 5000, 'claimed', { id: 'k1', attempt: 2 });
  const stripe = [
    { id: 're_old', status: 'failed', amount: 5000, metadata: { refund_claim_id: 'k1', attempt: '1' } },
    { id: 're_new', status: 'succeeded', amount: 5000, metadata: { refund_claim_id: 'k1', attempt: '2' } },
    { id: 're_other', status: 'succeeded', amount: 100, metadata: {} },
  ];
  assert.deepEqual(claimAtStripe(k, stripe), { status: 'succeeded', stripeRefundId: 're_new', amountCents: 5000 });
  assert.deepEqual(claimAtStripe(k, stripe.slice(0, 1)), { status: 'failed', stripeRefundId: null, amountCents: null });
  // The body carries what the match reads.
  const body = refundRequestBody({ planId: 'p', userId: 'u1', claimId: 'k1', attempt: 2, piece: { contributionId: 'c1', paymentIntent: 'pi_1', cents: 5000 } });
  assert.equal(body['metadata[refund_claim_id]'], 'k1');
  assert.equal(body['metadata[attempt]'], '2');
  assert.equal(body.amount, '5000');
});

test('a refund that failed at the card network is money the payment holds again', () => {
  assert.equal(liveRefundedCents([
    { amount: 3000, status: 'succeeded' }, { amount: 2000, status: 'failed' },
    { amount: 500, status: 'canceled' }, { amount: 1000, status: 'pending' },
  ]), 4000);
  assert.deepEqual(refundOutcome(10000, liveRefundedCents([{ amount: 10000, status: 'failed' }])),
    { status: 'succeeded', refundedCents: 0, partial: false });
});

test('the answer says only what happened', () => {
  const figures = { paidCents: 10000, keptCents: 0 };
  const refused = refundReply([{ kind: 'refused', cents: 10000, reason: 'charge_disputed' }], figures);
  assert.equal(refused.status, 502);
  assert.match(String(refused.body.error), /Nothing has been refunded/);
  assert.match(String(refused.body.error), /refused/);
  assert.match(String(refused.body.error), /ask again/);
  assert.doesNotMatch(String(refused.body.error), /going through|5–10 business days/);

  const unknown = refundReply([{ kind: 'unknown', cents: 10000 }], figures);
  assert.equal(unknown.status, 502);
  assert.match(String(unknown.body.error), /can't tell yet/);

  const part = refundReply([
    { kind: 'going', cents: 6000, stripeStatus: 'succeeded' },
    { kind: 'refused', cents: 4000, reason: 'x' },
  ], figures);
  assert.equal(part.status, 200);
  assert.equal(part.body.status, 'partial');
  assert.equal(part.body.refundedCents, 6000);
  assert.match(String(part.body.message), /\$60\.00 is on its way/);
  assert.match(String(part.body.message), /\$40\.00/);

  const action = refundReply([{ kind: 'needs_action', cents: 10000 }], figures);
  assert.equal(action.body.status, 'requires_action');
  assert.equal(action.body.refundedCents, 0);
  assert.match(String(action.body.message), /Nothing has gone back yet/);
  assert.match(String(action.body.message), /hello@alcanzar\.io/);

  const ours = refundReply([{ kind: 'not_started', cents: 10000 }], figures);
  assert.equal(ours.status, 500);
  assert.doesNotMatch(String(ours.body.error), /Stripe refused/);

  const done = refundReply([{ kind: 'going', cents: 10000, stripeStatus: 'pending' }], figures);
  assert.deepEqual([done.status, done.body.status], [200, 'pending']);
});

test('the payment history shows a part refund, not just a whole one', () => {
  assert.equal(paymentRefundCents({ status: 'succeeded', amount_cents: 10000, refunded_cents: 2500 }), 2500);
  assert.equal(paymentRefundCents({ status: 'refunded', amount_cents: 10000, refunded_cents: 10000 }), 10000);
  // Before the migration a whole refund is said only by the status.
  assert.equal(paymentRefundCents({ status: 'refunded', amount_cents: 10000 }), 10000);
  assert.equal(paymentRefundCents({ status: 'succeeded', amount_cents: 10000 }), 0);
});

test('refunds, funding and approval count collected money the same way', () => {
  const rows = [
    paid('a', 'u1', 10000, { refunded_cents: 4000 }),
    paid('b', 'u2', 5000),
    paid('c', 'u3', 5000, { status: 'refunded', refunded_cents: 5000 }),
  ];
  assert.equal(collectedCents(rows), netCollectedCents(rows));
  // The reviewer's case: a 1000 plan, 400 refunded, a 400 replacement added.
  // Approval must see 600, not 1000.
  const f = fundingOf([{ price_cents: 600 }, { price_cents: 400 }], [paid('p', 'u1', 1000, { refunded_cents: 400 })]);
  assert.equal(f.collectedCents, 600);
  assert.equal(f.funded, false);
});
