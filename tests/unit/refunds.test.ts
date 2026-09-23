// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  refundOutcome, netPaidCents, collectedCents, refundColumnPresent, planRefund,
  keptBookings, spentThenCancelled, refusal, refundIdempotencyKey, afterStripeRefund,
  isMissingColumn, isMissingTable, paidFailureNotice, type ContributionRow,
} from '../../lib/refunds.ts';

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
    columnPresent: false,
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
    contributions: [paid('c2', 'u2', 10000)],
  });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.keptCents, 0);
  assert.equal(out.refundableCents, 10000);
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

test('a payment with a refund already claimed is not refunded twice', () => {
  const out = planRefund({
    userId: 'u1', memberIds: ['u1'], bookings: [],
    contributions: [paid('c1', 'u1', 10000)],
    claimed: new Set(['c1']),
  });
  assert.equal(!out.ok && out.why, 'already_refunded');
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

test('before the migration, part of a payment cannot go back', () => {
  const input = {
    userId: 'u1', memberIds: ['u1'],
    bookings: [{ id: 'f', status: 'confirmed', price_cents: 4000 }],
    contributions: [paid('c1', 'u1', 10000)],
  };
  const before = planRefund({ ...input, columnPresent: false });
  assert.equal(!before.ok && before.why, 'needs_migration');
  assert.equal(refusal('needs_migration', { paidCents: 10000, keptCents: 4000 }).status, 503);
  const after = planRefund({ ...input, columnPresent: true });
  assert.equal(after.ok && after.refundableCents, 6000);
});

test('a payment with no Stripe intent cannot be refunded through Stripe', () => {
  const out = planRefund({
    userId: 'u1', memberIds: ['u1'], bookings: [],
    contributions: [paid('c1', 'u1', 10000, { stripe_payment_intent: null })],
  });
  assert.equal(!out.ok && out.why, 'nothing_refundable');
});

// ── Talking to Stripe ───────────────────────────────────────────────────

test('one idempotency key per contribution, and never the same for two', () => {
  assert.equal(refundIdempotencyKey('abc'), refundIdempotencyKey('abc'));
  assert.notEqual(refundIdempotencyKey('abc'), refundIdempotencyKey('abd'));
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
