// Run with: npm run test:unit
//
// Route files cannot be imported by the node test runner, so the parts of
// the refund work that live in routes are checked by reading them. Each of
// these is a line somebody could drop in a merge without any test of the
// pure functions noticing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(p, 'utf8');

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

test('approve tells the owner when a booking fails after payment, on both failure paths', () => {
  // One for a provider that answers `failed`, one for a provider that throws.
  const src = read('app/api/bookings/[id]/approve/route.ts');
  const calls = src.match(/reportPaidFailure\(/g) ?? [];
  assert.ok(calls.length >= 2, `expected reportPaidFailure on both failure paths, found ${calls.length}`);
});

test('nothing names refunded_cents in a select, so every read works before the migration', () => {
  // Naming a column PostgREST does not have fails the whole read. select('*')
  // returns it when it exists and omits it when it does not, and
  // lib/refunds.ts reads an absent one as nothing refunded.
  const offenders = [...sources('app'), ...sources('lib')].filter(f =>
    /\.select\(\s*['"`][^'"`]*refunded_cents/.test(read(f)));
  assert.deepEqual(offenders, []);
});

test('the funding total, the ledger, the funded announcement and approval all count net of refunds', () => {
  assert.match(read('app/api/plans/[planId]/funding/route.ts'), /netCollectedCents\(contributions\)/);
  // The ledger's sums moved into lib/ledger.ts so "Mark as paid" reads the same ones.
  assert.match(read('lib/ledger.ts'), /netPaidCents\(/);
  assert.match(read('app/api/webhooks/stripe/route.ts'), /sumCollected\(/);
  // Approval is where a counted-but-refunded dollar would be spent. It reads
  // every contribution column (so refunded_cents arrives with the migration)
  // and decides through fundingAt / fundingOf, which count net
  // (refunds.test.ts: "refunds, funding and approval count collected money
  // the same way").
  const approve = read('app/api/bookings/[id]/approve/route.ts');
  assert.match(approve, /from\('contributions'\)\.select\('\*'\)/);
  assert.match(approve, /const held = withClaims\(\(paid\.data/);
  assert.match(approve, /fundingAt\(owed, held/);
  assert.match(approve, /fundingOf\(owed, held\)/);
  assert.match(approve, /const owed = chargedRows\(/);
});

test('the webhook records refunded_cents from the charge', () => {
  assert.match(read('app/api/webhooks/stripe/route.ts'), /refunded_cents:\s*outcome\.refundedCents/);
});

test('a refunded contribution is never marked succeeded again', () => {
  for (const f of ['app/api/webhooks/stripe/route.ts', 'app/api/plans/[planId]/funding/confirm/route.ts']) {
    assert.match(read(f), /status:\s*'succeeded'[\s\S]{0,200}\.neq\('status',\s*'refunded'\)/, f);
  }
});

test('the refund route takes the plan lock, then claims the payment, then asks Stripe', () => {
  const src = read('app/api/plans/[planId]/funding/refund/route.ts');
  const lock = src.indexOf("from('refund_locks').insert(");
  const claim = src.indexOf(".from('refunds')\n        .insert(");
  // The Stripe call lives in sendClaim; the claim must come before it is called.
  const stripe = src.indexOf('results.push(await sendClaim(db, planId, stripeKey, claimId, {');
  assert.match(src, /async function sendClaim[\s\S]{0,1200}stripeCall\('https:\/\/api\.stripe\.com\/v1\/refunds', stripeKey, \{ body: request\.body, key: idempotencyKey \}\)/);
  // The claim's key reaches Stripe as its Idempotency-Key, never dropped on the way.
  assert.match(src, /const idempotencyKey = request\.key;/);
  assert.match(src, /if \(init\.key\) headers\['Idempotency-Key'\] = init\.key;/);
  assert.ok(lock > 0 && claim > 0 && stripe > 0, 'lock, claim and Stripe call must all be there');
  assert.ok(lock < claim && claim < stripe, 'the lock and the claim must be taken before Stripe is called');
  assert.match(src, /key: refundIdempotencyKey\(piece\.contributionId, piece\.attempt\)/);
  // The lock is released however the request ends.
  assert.match(src, /finally \{\s*const \{ error \} = await db\.from\('refund_locks'\)\.delete\(\)/);
});

test('the refund route never lowers what the webhook recorded', () => {
  const src = read('app/api/plans/[planId]/funding/refund/route.ts');
  assert.match(src, /refunded_cents: outcome\.refundedCents[^\n]*\n\s*\.eq\('id', contributionId\)\n\s*\.lt\('refunded_cents', outcome\.refundedCents\)/);
});

test('bookings are read with mode and provider, so only what Reach buys is kept back', () => {
  const src = read('app/api/plans/[planId]/funding/refund/route.ts');
  assert.match(src, /from\('bookings'\)\.select\('[^']*\bmode\b[^']*\bprovider\b[^']*'\)/);
});

test('the webhook: a part refund before the migration is retried, and a failed refund is put back', () => {
  const src = read('app/api/webhooks/stripe/route.ts');
  // 200 here meant Stripe never sent it again and the plan counted the money for good.
  assert.match(src, /if \(outcome\.partial\) \{[\s\S]{0,900}status: 500/);
  assert.doesNotMatch(src, /writeError = null;/);
  assert.match(src, /'charge\.refund\.updated'/);
  assert.match(src, /liveRefundedCents\(/);
});

test('the payment history reports part refunds', () => {
  const src = read('app/api/profile/route.ts');
  assert.match(src, /refund_amount_cents: paymentRefundCents\(c\)/);
});
