// Run with: npm run test:unit
//
// What a Stripe event may do to a contribution and its plan, against a
// stand-in table that applies the filters the way PostgREST does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { markPlanFunded, recordContributionFailed } from '../../lib/contribution-events.ts';

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  const later = <T>(v: T) => new Promise<T>(r => setTimeout(() => r(v), 0));
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const preds: ((r: Row) => boolean)[] = [];
      let patch: Row | null = null;
      let selected = false;
      const run = () => {
        const hit = rows.filter(r => preds.every(p => p(r)));
        if (patch) for (const r of hit) Object.assign(r, patch);
        return { data: selected ? hit.map(r => ({ id: r.id })) : null, error: null };
      };
      const q: any = {
        update(p: Row) { patch = p; return q; },
        eq(c: string, v: unknown) { preds.push(r => r[c] === v); return q; },
        neq(c: string, v: unknown) { preds.push(r => r[c] !== v); return q; },
        or(expr: string) {
          // Only the shape markPlanFunded sends: status.is.null,status.in.(a,b)
          const m = /^status\.is\.null,status\.in\.\(([^)]*)\)$/.exec(expr);
          assert.ok(m, `unexpected or(): ${expr}`);
          const allowed = m[1].split(',');
          preds.push(r => r.status == null || allowed.includes(String(r.status)));
          return q;
        },
        select() { selected = true; return q; },
        then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
          // Read when awaited, on a later tick, so two calls interleave.
          return later(null).then(run).then(res, rej);
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

test('a late payment_failed never turns a paid share back into an unpaid one', async () => {
  // Declined first card, second card paid on the same intent, and the
  // decline's event arrives (or is resent) after the success.
  const contributions = [{ id: 'c1', stripe_payment_intent: 'pi_1', status: 'succeeded', amount_cents: 5000 }];
  await recordContributionFailed(fakeDb({ contributions }), 'pi_1');
  assert.equal(contributions[0].status, 'succeeded');
});

test('nor a refunded one back into failed', async () => {
  const contributions = [{ id: 'c1', stripe_payment_intent: 'pi_1', status: 'refunded', amount_cents: 5000 }];
  await recordContributionFailed(fakeDb({ contributions }), 'pi_1');
  assert.equal(contributions[0].status, 'refunded');
});

test('a payment still in flight that fails is recorded failed', async () => {
  const contributions = [
    { id: 'c1', stripe_payment_intent: 'pi_1', status: 'pending', amount_cents: 5000 },
    { id: 'c2', stripe_payment_intent: 'pi_2', status: 'pending', amount_cents: 5000 },
  ];
  await recordContributionFailed(fakeDb({ contributions }), 'pi_1');
  assert.deepEqual(contributions.map(c => c.status), ['failed', 'pending']);
});

test('a funded plan still being planned is approved, and that call is the one that announces', async () => {
  for (const status of ['planning', 'voting', null]) {
    const plans = [{ id: 'p1', status }];
    const out = await markPlanFunded(fakeDb({ plans }), 'p1');
    assert.equal(out.moved, true, String(status));
    assert.equal(plans[0].status, 'approved');
  }
});

test('money landing on a called-off or finished trip never brings it back as approved', async () => {
  for (const status of ['cancelled', 'completed', 'booked', 'approved']) {
    const plans = [{ id: 'p1', status }];
    const out = await markPlanFunded(fakeDb({ plans }), 'p1');
    assert.equal(out.moved, false, status);
    assert.equal(plans[0].status, status);
  }
});

test('the last two shares landing together tell the group once', async () => {
  const db = fakeDb({ plans: [{ id: 'p1', status: 'planning' }] });
  const [a, b] = await Promise.all([markPlanFunded(db, 'p1'), markPlanFunded(db, 'p1')]);
  assert.deepEqual([a.moved, b.moved].sort(), [false, true]);
});

test('the webhook writes both through these, and announces only when it moved the plan', () => {
  const src = readFileSync('app/api/webhooks/stripe/route.ts', 'utf8');
  assert.match(src, /recordContributionFailed\(supabase, intent\.id\)/);
  assert.match(src, /const funded = await markPlanFunded\(supabase, planId\)/);
  assert.match(src, /if \(!funded\.moved\) \{[\s\S]{0,400}return;\n    \}/);
  // The read-then-write it replaced.
  assert.doesNotMatch(src, /from\('plans'\)\.update\(\{ status: 'approved' \}\)/);
});
