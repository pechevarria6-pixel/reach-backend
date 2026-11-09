// Run with: npm run test:unit
// Directive P1: a share is offered as a bank debit first, card one tap away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contributionIntentFields, bankNotEnabled, methodOf, recordMethod } from '../../lib/contribution-method.ts';

test('a contribution offers the bank first and the card second, verified through the bank', () => {
  const f = contributionIntentFields({ amountCents: 12345, planId: 'p1', userId: 'u1' }, 'bank_first');
  assert.equal(f.get('payment_method_types[0]'), 'us_bank_account');
  assert.equal(f.get('payment_method_types[1]'), 'card');
  assert.equal(f.get('payment_method_options[us_bank_account][verification_method]'), 'automatic');
  assert.equal(f.get('automatic_payment_methods[enabled]'), null, 'explicit types, not the account default');
  assert.equal(f.get('metadata[kind]'), 'reach_contribution');
  assert.equal(f.get('amount'), '12345');
});

test('the fallback is the card alone, and only a "bank not switched on" refusal falls back', () => {
  const f = contributionIntentFields({ amountCents: 500, planId: 'p', userId: 'u' }, 'card_only');
  assert.equal(f.get('automatic_payment_methods[enabled]'), null, 'never the account default — it offered Klarna');
  assert.deepEqual(f.getAll('payment_method_types[0]'), ['card']);
  assert.equal(f.get('payment_method_types[1]'), null);
  assert.ok(bankNotEnabled({ param: 'payment_method_types', message: 'The payment method type "us_bank_account" is invalid. Please ensure the provided type is activated in your dashboard.' }));
  assert.ok(!bankNotEnabled({ message: 'Invalid API Key provided' }), 'a key problem is not a reason to try another method');
  assert.ok(!bankNotEnabled({ code: 'amount_too_small', message: 'Amount must be at least $0.50' }));
  assert.ok(!bankNotEnabled(null));
});

test('the method that paid is read from the charge, then the method, never guessed from two offered', () => {
  assert.equal(methodOf({ latest_charge: { payment_method_details: { type: 'us_bank_account' } } }), 'us_bank_account');
  assert.equal(methodOf({ payment_method: { type: 'card' } }), 'card');
  assert.equal(methodOf({ payment_method: { type: 'cashapp' } }), 'other');
  assert.equal(methodOf({ payment_method_types: ['us_bank_account', 'card'] }), null);
  assert.equal(methodOf({ payment_method_types: ['card'] }), 'card');
  assert.equal(methodOf(null), null);
});

test('recording the method never fails a payment, including before the column exists', async () => {
  const missing = { from: () => ({ update: () => ({ eq: async () => ({ error: { code: '42703', message: 'column contributions.payment_method does not exist' } }) }) }) };
  await recordMethod(missing, 'pi_1', 'card');
  const throws = { from: () => { throw new Error('boom'); } };
  await recordMethod(throws, 'pi_1', 'card');
  let wrote: unknown = null;
  const ok = { from: () => ({ update: (row: unknown) => { wrote = row; return { eq: async () => ({ error: null }) }; } }) };
  await recordMethod(ok, 'pi_1', 'us_bank_account');
  assert.deepEqual(wrote, { payment_method: 'us_bank_account' });
});

test('a clearing bank payment is "on its way" — recorded, not approved, and never "not recorded"', () => {
  const confirm = readFileSync('app/api/plans/[planId]/funding/confirm/route.ts', 'utf8');
  assert.match(confirm, /if \(pi\.status === 'processing'\) \{[\s\S]*?return NextResponse\.json\(\{ ok: true, clearing: true \}\);/);
  const app = readFileSync('components/reach-app.jsx', 'utf8');
  assert.match(app, /elements\.create\("payment",\{paymentMethodOrder:\["us_bank_account","card"\]\}\)/);
  assert.match(app, /if\(cj\.clearing\|\|paymentIntent\?\.status==="processing"\)\{\s*\n\s*await refresh\(\);\s*\n\s*setPhase\("clearing"\);/);
  const funding = readFileSync('app/api/plans/[planId]/funding/route.ts', 'utf8');
  assert.match(funding, /let stripeRes = await createIntent\('bank_first'\);/);
  assert.match(funding, /if \(!stripeRes\.ok && bankNotEnabled\(pi\?\.error\)\)/);
});
