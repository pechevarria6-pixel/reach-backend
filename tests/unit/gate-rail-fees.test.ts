// Run with: npm run test:unit
//
// Pilot gate A3 / directive P6: what Stripe kept, read from the balance
// transaction and stored per contribution — never computed from a rate card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { balanceTransactionId, feeOf, feeOfCharge, recordFee } from '../../lib/rail/fees.ts';

test('the fee comes from the balance transaction, and only when it is there to read', () => {
  assert.equal(feeOf({ fee: 500, currency: 'usd' }), 500, 'a bank debit at the $5 cap');
  assert.equal(feeOf({ fee: 320 }), 320);
  assert.equal(feeOf({ fee: 0 }), 0, 'a fee of nothing is a fact, not a gap');
  assert.equal(feeOf('txn_123'), null, 'a bare id is not a fee');
  assert.equal(feeOf(null), null);
  assert.equal(feeOf({ fee: -1 }), null);
  assert.equal(feeOfCharge({ balance_transaction: { fee: 815 } }), 815);
  assert.equal(feeOfCharge({ balance_transaction: 'txn_9' }), null);
  assert.equal(balanceTransactionId({ balance_transaction: 'txn_9' }), 'txn_9');
  assert.equal(balanceTransactionId({ balance_transaction: { fee: 1 } }), null);
});

function fakeDb(error: { code?: string; message?: string } | null) {
  const writes: Record<string, unknown>[] = [];
  return {
    writes,
    from() {
      const q: any = {
        update(p: Record<string, unknown>) { writes.push(p); return q; },
        eq() { return q; },
        then(res: (v: unknown) => unknown) { return Promise.resolve({ error }).then(res); },
      };
      return q;
    },
  };
}

test('the fee is written onto the contribution, and a missing column never fails the caller', async () => {
  const ok = fakeDb(null);
  assert.equal(await recordFee(ok, 'pi_1', 500), 'written');
  assert.deepEqual(ok.writes, [{ stripe_fee_cents: 500 }]);
  assert.equal(await recordFee(fakeDb({ code: 'PGRST204', message: "Could not find the 'stripe_fee_cents' column" }), 'pi_1', 500), 'no_column');
  assert.equal(await recordFee(fakeDb({ code: '42703' }), 'pi_1', 500), 'no_column');
  const none = fakeDb(null);
  assert.equal(await recordFee(none, 'pi_1', null), 'skipped');
  assert.equal(none.writes.length, 0, 'no fee read, nothing written');
});

test('the webhook and confirm both record it', () => {
  const hook = readFileSync('app/api/webhooks/stripe/route.ts', 'utf8');
  assert.match(hook, /case 'charge\.succeeded':[\s\S]{0,1200}recordFee\(supabase, intentId, fee\)/);
  assert.match(hook, /recordFee\(supabase, intent\.id, feeOfCharge\(fresh\?\.latest_charge as never\)\)/);
  assert.match(hook, /expand: \['latest_charge\.balance_transaction'\]/);
  const confirm = readFileSync('app/api/plans/[planId]/funding/confirm/route.ts', 'utf8');
  assert.match(confirm, /expand\[\]=latest_charge\.balance_transaction/);
  assert.match(confirm, /recordFee\(ctx\.db, paymentIntentId, feeOfCharge\(pi\.latest_charge\)\)/);
});
