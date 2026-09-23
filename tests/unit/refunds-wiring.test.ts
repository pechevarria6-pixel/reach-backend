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

test('the funding total, the ledger and the funded announcement all count net of refunds', () => {
  assert.match(read('app/api/plans/[planId]/funding/route.ts'), /sumCollected\(/);
  assert.match(read('app/api/plans/[planId]/ledger/route.ts'), /netPaidCents\(/);
  assert.match(read('app/api/webhooks/stripe/route.ts'), /sumCollected\(/);
});

test('the webhook records refunded_cents from the charge', () => {
  assert.match(read('app/api/webhooks/stripe/route.ts'), /refunded_cents:\s*outcome\.refundedCents/);
});

test('a refunded contribution is never marked succeeded again', () => {
  for (const f of ['app/api/webhooks/stripe/route.ts', 'app/api/plans/[planId]/funding/confirm/route.ts']) {
    assert.match(read(f), /status:\s*'succeeded'[\s\S]{0,200}\.neq\('status',\s*'refunded'\)/, f);
  }
});

test('the refund route claims the payment before it asks Stripe', () => {
  const src = read('app/api/plans/[planId]/funding/refund/route.ts');
  const claim = src.indexOf(".from('refunds').insert(");
  const stripe = src.indexOf('api.stripe.com/v1/refunds');
  assert.ok(claim > 0 && stripe > 0 && claim < stripe, 'the refunds row must be written before Stripe is called');
  assert.match(src, /'Idempotency-Key':\s*refundIdempotencyKey\(/);
});
