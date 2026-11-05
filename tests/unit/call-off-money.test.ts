// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stopPaymentsInFlight } from '../../lib/call-off-money.ts';
import type { CancelOutcome } from '../../lib/stripe-intents.ts';

type Row = Record<string, unknown>;

function fakeDb(rows: Row[], opts: { failRead?: boolean } = {}) {
  return {
    from(table: string) {
      assert.equal(table, 'contributions');
      const preds: ((r: Row) => boolean)[] = [];
      let patch: Row | null = null;
      const q: any = {
        select() { return q; },
        update(p: Row) { patch = p; return q; },
        eq(c: string, v: unknown) { preds.push(r => r[c] === v); return q; },
        in(c: string, vs: unknown[]) { preds.push(r => vs.includes(r[c])); return q; },
        then(res: (v: unknown) => unknown) {
          if (opts.failRead && !patch) return Promise.resolve({ data: null, error: { code: 'XX000' } }).then(res);
          const hit = rows.filter(r => preds.every(p => p(r)));
          if (patch) for (const r of hit) Object.assign(r, patch);
          return Promise.resolve({ data: hit, error: null }).then(res);
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const stripe = (states: Record<string, CancelOutcome>) => {
  const asked: string[] = [];
  return { asked, cancel: async (id: string) => { asked.push(id); return states[id] ?? 'unknown'; } };
};

test('a bank payment still clearing stops the call-off', async () => {
  const rows = [{ id: 'c1', plan_id: 'p1', status: 'pending', stripe_payment_intent: 'pi_ach' }];
  const s = stripe({ pi_ach: 'moving' });
  assert.deepEqual(await stopPaymentsInFlight(fakeDb(rows), 'p1', s.cancel), { ok: false, reason: 'moving' });
  assert.equal(rows[0].status, 'pending');
});

test('a payment Stripe could not be asked about stops it too', async () => {
  const rows = [{ id: 'c1', plan_id: 'p1', status: 'pending', stripe_payment_intent: 'pi_x' }];
  const out = await stopPaymentsInFlight(fakeDb(rows), 'p1', stripe({ pi_x: 'unknown' }).cancel);
  assert.equal(out.ok, false);
});

test('a payment started and never paid is cancelled at Stripe and written off, and the call-off goes ahead', async () => {
  const rows = [
    { id: 'c1', plan_id: 'p1', status: 'pending', stripe_payment_intent: 'pi_open' },
    { id: 'c2', plan_id: 'p1', status: 'succeeded', stripe_payment_intent: 'pi_done' },
    { id: 'c3', plan_id: 'p2', status: 'pending', stripe_payment_intent: 'pi_other' },
  ];
  const s = stripe({ pi_open: 'canceled' });
  assert.deepEqual(await stopPaymentsInFlight(fakeDb(rows), 'p1', s.cancel), { ok: true });
  assert.deepEqual(s.asked, ['pi_open']);
  assert.deepEqual(rows.map(r => r.status), ['failed', 'succeeded', 'pending']);
});

test('a read that fails is not read as nothing in flight', async () => {
  const out = await stopPaymentsInFlight(fakeDb([], { failRead: true }), 'p1', stripe({}).cancel);
  assert.deepEqual(out, { ok: false, reason: 'read_failed' });
});

test('calling a plan off stops payments in flight before it writes', () => {
  const src = readFileSync('app/api/plans/[planId]/route.ts', 'utf8');
  const stop = src.indexOf('await stopPaymentsInFlight(supabase, params.planId)');
  const write = src.indexOf("if (callingOff) q = q.neq('status', 'cancelled');");
  assert.ok(stop > 0, 'the call-off must stop payments in flight');
  assert.ok(stop < write, 'and before the plan is written cancelled');
  // Deleting one too, before the row goes.
  const del = src.indexOf('export async function DELETE');
  const stopDel = src.indexOf('await stopPaymentsInFlight(supabase, params.planId)', del);
  const gone = src.indexOf(".from('plans').delete()", del);
  assert.ok(del > 0 && stopDel > del && stopDel < gone, 'a delete must stop payments in flight before the plan goes');
});

test('a declined share whose form is still open is cancelled at Stripe too, and stays off', async () => {
  const rows = [{ id: 'c1', plan_id: 'p1', status: 'failed', stripe_payment_intent: 'pi_declined' }];
  const s = stripe({ pi_declined: 'canceled' });
  const out = await stopPaymentsInFlight(fakeDb(rows), 'p1', s.cancel);
  assert.deepEqual(out, { ok: true });
  assert.deepEqual(s.asked, ['pi_declined']);
  assert.equal(rows[0].status, 'failed');
});

test('a declined share paid since with another card stops the call-off', async () => {
  const rows = [{ id: 'c1', plan_id: 'p1', status: 'failed', stripe_payment_intent: 'pi_retry' }];
  const s = stripe({ pi_retry: 'moving' });
  const out = await stopPaymentsInFlight(fakeDb(rows), 'p1', s.cancel);
  assert.deepEqual(out, { ok: false, reason: 'moving' });
});

test('a called-off or finished trip refuses a new payment before Stripe is asked', () => {
  const src = readFileSync(new URL('../../app/api/plans/[planId]/funding/route.ts', import.meta.url), 'utf8');
  const post = src.slice(src.indexOf('export async function POST'));
  const gate = post.indexOf("planStatus === 'cancelled' || planStatus === 'completed'");
  assert.ok(gate > 0, 'POST checks the plan status');
  assert.ok(gate < post.indexOf('STRIPE_SECRET_KEY'), 'before anything else');
});
