// Run with: npm run test:unit
//
// Pilot gate A3 / directive P2 and P5: a contribution's states, which Stripe
// news may move it, and what approval says when the money is not all in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CLEARING, IN_FLIGHT, clearingCents, clearingCount, contributionMove, isInFlight, notFundedMessage, statusNotAllowedYet,
} from '../../lib/rail/contribution-state.ts';
import { recordContributionDisputed, recordContributionFailed, recordContributionMove } from '../../lib/contribution-events.ts';
import { netCollectedCents } from '../../lib/booking/approval.ts';

type Row = Record<string, unknown>;

/** A table that applies eq / in / neq the way PostgREST does, and can refuse a status. */
function fakeDb(rows: Row[], opts: { refuseStatus?: string } = {}) {
  return {
    from() {
      const preds: ((r: Row) => boolean)[] = [];
      let patch: Row | null = null;
      const run = () => {
        if (patch && opts.refuseStatus && patch.status === opts.refuseStatus) {
          return { data: null, error: { code: '23514', message: 'new row violates check constraint "contributions_status_check"' } };
        }
        const hit = rows.filter(r => preds.every(p => p(r)));
        if (patch) for (const r of hit) Object.assign(r, patch);
        return { data: hit.map(r => ({ id: r.id })), error: null };
      };
      const q: any = {
        update(p: Row) { patch = p; return q; },
        eq(c: string, v: unknown) { preds.push(r => r[c] === v); return q; },
        in(c: string, vs: unknown[]) { preds.push(r => vs.includes(r[c])); return q; },
        select() { return q; },
        then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

test('a bank debit on its way is in flight, and is never counted as money held', () => {
  for (const s of ['pending', 'processing', 'pending_settlement']) assert.ok(isInFlight(s), s);
  for (const s of ['succeeded', 'failed', 'refunded']) assert.ok(!isInFlight(s), s);
  const contribs = [
    { status: 'succeeded', amount_cents: 5000, user_id: 'a' },
    { status: 'processing', amount_cents: 3000, user_id: 'b' },
    { status: 'pending_settlement', amount_cents: 1000, user_id: 'b' },
    { status: 'pending', amount_cents: 700, user_id: 'c' },
  ];
  assert.equal(netCollectedCents(contribs), 5000, 'only succeeded is held');
  assert.equal(clearingCents(contribs), 4000);
  assert.equal(clearingCents(contribs, 'b'), 4000);
  assert.equal(clearingCents(contribs, 'a'), 0);
  assert.equal(clearingCount(contribs), 2);
  assert.deepEqual([...IN_FLIGHT].sort(), ['pending', ...CLEARING].sort());
});

test('processing moves only a payment Stripe still calls processing', () => {
  assert.deepEqual(contributionMove('processing', 'processing'), { to: 'processing', from: ['pending', 'failed'] });
  // A resent "processing" after the money landed or bounced is history.
  assert.equal(contributionMove('processing', 'succeeded'), null);
  assert.equal(contributionMove('processing', 'requires_payment_method'), null);
  // Stripe not asked: only out of pending.
  assert.deepEqual(contributionMove('processing', null), { to: 'processing', from: ['pending'] });
});

test('a late decline never fails a payment that is moving or has landed', async () => {
  for (const now of ['succeeded', 'processing']) {
    const rows = [{ id: 'c1', stripe_payment_intent: 'pi_1', status: now === 'succeeded' ? 'succeeded' : 'processing' }];
    await recordContributionFailed(fakeDb(rows), 'pi_1', now);
    assert.equal(rows[0].status, now === 'succeeded' ? 'succeeded' : 'processing', now);
  }
});

test('a late decline on a row still reading pending, after Stripe took the money, leaves it pending', async () => {
  // The success webhook has not landed yet. Failed here, funding would see
  // nothing in flight and start a second payment for a share already paid.
  for (const now of ['succeeded', 'processing']) {
    assert.equal(contributionMove('failed', now), null, now);
    const rows = [{ id: 'c1', stripe_payment_intent: 'pi_1', status: 'pending' }];
    await recordContributionFailed(fakeDb(rows), 'pi_1', now);
    assert.equal(rows[0].status, 'pending', now);
  }
});

test('a bank debit returned after it cleared is failed, and the plan stops counting it', async () => {
  const rows = [
    { id: 'c1', stripe_payment_intent: 'pi_1', status: 'succeeded', amount_cents: 5000 },
    { id: 'c2', stripe_payment_intent: 'pi_2', status: 'succeeded', amount_cents: 5000 },
  ];
  const before = netCollectedCents(rows);
  const { data } = await recordContributionFailed(fakeDb(rows), 'pi_1', 'requires_payment_method');
  assert.deepEqual(data.map(r => r.id), ['c1']);
  assert.equal(rows[0].status, 'failed');
  assert.equal(netCollectedCents(rows), before - 5000);
});

test('a bank debit that fails while clearing is failed', async () => {
  const rows = [{ id: 'c1', stripe_payment_intent: 'pi_1', status: 'processing' }];
  await recordContributionFailed(fakeDb(rows), 'pi_1', 'requires_payment_method');
  assert.equal(rows[0].status, 'failed');
});

test('a refunded share is never failed, whatever Stripe says', async () => {
  for (const now of ['requires_payment_method', 'canceled', null]) {
    const rows = [{ id: 'c1', stripe_payment_intent: 'pi_1', status: 'refunded' }];
    await recordContributionFailed(fakeDb(rows), 'pi_1', now);
    assert.equal(rows[0].status, 'refunded', String(now));
  }
});

test('not knowing what Stripe says fails only a payment that never started moving', () => {
  assert.deepEqual(contributionMove('failed', null), { to: 'failed', from: ['pending'] });
  assert.deepEqual(contributionMove('failed', 'requires_action'), { to: 'failed', from: ['pending'] });
});

test('before the migration the table refuses processing, and the row stays pending without an error', async () => {
  const rows = [{ id: 'c1', stripe_payment_intent: 'pi_1', status: 'pending', user_id: 'u' }];
  const move = contributionMove('processing', 'processing')!;
  const out = await recordContributionMove(fakeDb(rows, { refuseStatus: 'processing' }), 'pi_1', move, 'u');
  assert.equal(out.error, null);
  assert.equal(rows[0].status, 'pending');
  assert.ok(isInFlight(rows[0].status), 'still in flight to every reader');
  assert.ok(statusNotAllowedYet({ code: '23514' }));
  assert.ok(!statusNotAllowedYet({ code: '42501' }));
});

test('confirming moves only this person\'s row', async () => {
  const rows = [
    { id: 'c1', stripe_payment_intent: 'pi_1', status: 'pending', user_id: 'me' },
    { id: 'c2', stripe_payment_intent: 'pi_1', status: 'pending', user_id: 'other' },
  ];
  await recordContributionMove(fakeDb(rows), 'pi_1', contributionMove('processing', 'processing')!, 'me');
  assert.deepEqual(rows.map(r => r.status), ['processing', 'pending']);
});

test('a dispute takes the share off, from anything that had or was getting the money', async () => {
  for (const status of ['succeeded', 'processing', 'pending']) {
    const rows = [{ id: 'c1', stripe_payment_intent: 'pi_1', status, amount_cents: 5000 }];
    const { data } = await recordContributionDisputed(fakeDb(rows), 'pi_1');
    assert.equal(rows[0].status, 'refunded', status);
    assert.equal(data.length, 1);
    assert.equal(netCollectedCents(rows), 0);
  }
  const failed = [{ id: 'c1', stripe_payment_intent: 'pi_1', status: 'failed' }];
  await recordContributionDisputed(fakeDb(failed), 'pi_1');
  assert.equal(failed[0].status, 'failed', 'nothing to take back');
});

test('402 says "still clearing" when money on its way covers it, and "not paid" when it does not', () => {
  const wait = notFundedMessage(5000, { cents: 5000, count: 1 });
  assert.equal(wait.clearing, true);
  assert.match(wait.error, /A payment is still clearing/);
  assert.match(wait.error, /Nothing was booked/);
  const few = notFundedMessage(5000, { cents: 8000, count: 3 });
  assert.match(few.error, /A few payments are still clearing/);
  const both = notFundedMessage(5000, { cents: 2000, count: 1 });
  assert.equal(both.clearing, true);
  assert.match(both.error, /isn't paid in yet, and a payment is still clearing/);
  const chase = notFundedMessage(5000, { cents: 0, count: 0 });
  assert.equal(chase.clearing, false);
  assert.match(chase.error, /doesn't cover this yet/);
  assert.doesNotMatch(chase.error, /clearing/);
});

test('the routes read these: funding never starts a second payment over one clearing, approval words its 402 from them', () => {
  const funding = readFileSync('app/api/plans/[planId]/funding/route.ts', 'utf8');
  assert.match(funding, /c\.user_id === ctx\.user\.id && isInFlight\(c\.status\)/);
  assert.doesNotMatch(funding, /c\.status === 'pending',/);
  assert.match(funding, /clearingCents: clearingCents\(contributions\)/);
  const approve = readFileSync('app/api/bookings/[id]/approve/route.ts', 'utf8');
  assert.match(approve, /notFundedMessage\(funding\.shortfallCents, onItsWay\)/);
  const confirm = readFileSync('app/api/plans/[planId]/funding/confirm/route.ts', 'utf8');
  assert.match(confirm, /if \(pi\.status === 'processing'\) \{[\s\S]{0,300}recordContributionMove\(ctx\.db, paymentIntentId, move, ctx\.user\.id\)/);
  const hook = readFileSync('app/api/webhooks/stripe/route.ts', 'utf8');
  assert.match(hook, /case 'payment_intent\.processing':/);
  assert.match(hook, /contributionMove\('processing', fresh\?\.status \?\? null\)/);
  assert.match(hook, /if \(!fresh\) \{[\s\S]{0,200}return NextResponse\.json\(\{ error: 'could not read the payment' \}, \{ status: 500 \}\)/);
});
