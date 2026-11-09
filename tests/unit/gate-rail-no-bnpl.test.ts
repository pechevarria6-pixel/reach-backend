// Run with: npm run test:unit
//
// Owner decision 2026-11-08: no buy-now-pay-later on any contribution, ever —
// no Klarna, Affirm, Afterpay, Cash App Pay or Zip. The fallback once sent
// automatic_payment_methods[enabled]=true and the test account's default
// configuration put a Klarna tile in the Payment Element.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONTRIBUTION_METHODS, NEVER_OFFERED, contributionIntentFields } from '../../lib/contribution-method.ts';

const BNPL = /klarna|affirm|afterpay|clearpay|cashapp|cash_app|\bzip\b/i;

test('no PaymentIntent form Reach builds asks for automatic methods or names a BNPL type', () => {
  for (const how of ['bank_first', 'card_only'] as const) {
    const f = contributionIntentFields({ amountCents: 1000, planId: 'p', userId: 'u' }, how);
    for (const [k, v] of f.entries()) {
      assert.doesNotMatch(k, /automatic_payment_methods/, `${how}: ${k}`);
      if (/^payment_method_types\[/.test(k)) {
        assert.ok((CONTRIBUTION_METHODS as readonly string[]).includes(v), `${how}: ${v} is not a contribution method`);
        assert.doesNotMatch(v, BNPL, `${how}: ${v}`);
      }
    }
    assert.ok(f.getAll('payment_method_types[0]').length === 1, `${how} names its methods explicitly`);
  }
  for (const m of NEVER_OFFERED) assert.ok(!(CONTRIBUTION_METHODS as readonly string[]).includes(m), m);
});

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

test('no server code switches on automatic payment methods or offers a BNPL type', () => {
  const offenders: string[] = [];
  for (const f of [...sources('app'), ...sources('lib')]) {
    const src = readFileSync(f, 'utf8');
    if (/automatic_payment_methods\s*(\[enabled\]|:\s*\{\s*enabled:\s*true)/.test(src.replace(/^\s*\/\/.*$/gm, ''))) offenders.push(`${f}: automatic_payment_methods`);
    if (/payment_method_types[\s\S]{0,120}['"](klarna|affirm|afterpay_clearpay|cashapp|zip)['"]/.test(src)) offenders.push(`${f}: names a BNPL type`);
  }
  assert.deepEqual(offenders, []);
});
