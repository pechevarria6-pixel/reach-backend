// Run with: npm run test:unit
// "Mark as paid" against a stand-in database that keeps the two unique
// indexes sql/settle-up-2026-09-25.sql creates, and that lets two requests
// interleave the way two taps in the same instant do: every query yields
// before it answers, so both requests read "nothing there" before either
// writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordSettlement, moveSettlement, mySettlements } from '../../lib/settlements.ts';
import { loadLedger } from '../../lib/ledger.ts';

type Row = Record<string, any>;

function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = { settlements: [], events: [], ...seed };
  let n = 0;
  const tick = () => new Promise(r => setImmediate(r));

  function violates(t: string, row: Row, except?: Row): boolean {
    if (t !== 'settlements') return false;
    return tables.settlements.some(o => o !== except && (
      o.idempotency_key === row.idempotency_key
      || (o.status === 'pending' && row.status === 'pending' && o.plan_id === row.plan_id
          && o.from_user_id === row.from_user_id && o.to_user_id === row.to_user_id)));
  }

  function query(t: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: Row = {};
    const q: any = {
      select() { return q; },
      order() { return q; },
      eq(c: string, v: unknown) { filters.push(r => r[c] === v); return q; },
      neq(c: string, v: unknown) { filters.push(r => r[c] !== v); return q; },
      in(c: string, vs: unknown[]) { filters.push(r => vs.includes(r[c])); return q; },
      not() { return q; },
      or(expr: string) {
        const parts = expr.split(',').map(p => p.split('.eq.'));
        filters.push(r => parts.some(([c, v]) => r[c] === v));
        return q;
      },
      insert(row: Row) { op = 'insert'; payload = row; return q; },
      update(patch: Row) { op = 'update'; payload = patch; return q; },
      async run(): Promise<{ data: any; error: any }> {
        await tick();
        const rows = tables[t] ?? [];
        if (op === 'insert') {
          const row = { id: `s${++n}`, created_at: new Date(Date.now() + n).toISOString(), ...payload };
          if (violates(t, row)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          rows.push(row);
          tables[t] = rows;
          return { data: [row], error: null };
        }
        const hit = rows.filter(r => filters.every(f => f(r)));
        if (op === 'update') {
          for (const r of hit) {
            const next = { ...r, ...payload };
            if (violates(t, next, r)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
            Object.assign(r, payload);
          }
        }
        return { data: hit.map(r => ({ ...r })), error: null };
      },
      async single() { const { data, error } = await q.run(); return { data: data?.[0] ?? null, error }; },
      async maybeSingle() { const { data, error } = await q.run(); return { data: data?.[0] ?? null, error }; },
      then(ok: (a: unknown) => unknown, bad?: (e: unknown) => unknown) { return q.run().then(ok, bad); },
    };
    return q;
  }
  return { db: { from: query } as never, tables };
}

const plan = { id: 'plan1', group_id: 'g1', budget_cents: 0, destination_city: 'Cabo' };
// Sam paid an $84 dinner for Sam and Alex: Alex owes Sam $42.
function trip(extra: Record<string, Row[]> = {}) {
  return fakeDb({
    group_members: [{ group_id: 'g1', user_id: 'sam' }, { group_id: 'g1', user_id: 'alex' }],
    expenses: [{ plan_id: 'plan1', paid_by: 'sam', amount_cents: 8400, split_between: ['sam', 'alex'] }],
    ...extra,
  });
}
const paidRows = (tables: Record<string, Row[]>) => tables.settlements.filter(s => s.status === 'paid');
const markPaid = { toUserId: 'sam', amountCents: 4200, method: 'venmo', status: 'paid' };

test('a double tap on "Mark as paid" writes one payment', async () => {
  const { db, tables } = trip();
  const tap = () => recordSettlement(db, plan, 'alex', { ...markPaid, idempotencyKey: 'line-alex-sam-1' });
  const [a, b] = await Promise.all([tap(), tap()]);
  assert.deepEqual([a.status, b.status].sort(), [200, 200]);
  assert.equal(tables.settlements.length, 1);
  assert.equal(paidRows(tables).length, 1);
  const ledger = await loadLedger(db, plan);
  assert.deepEqual(ledger.lines, [], 'the payment fed back into the balances');
  assert.deepEqual(ledger.netBalances, { sam: 0, alex: 0 });
});

test('both sides marking it at once count it once, and nobody ends up owing the other', async () => {
  const { db, tables } = trip();
  await Promise.all([
    recordSettlement(db, plan, 'alex', { ...markPaid, idempotencyKey: 'alex-side-key' }),
    recordSettlement(db, plan, 'sam', { fromUserId: 'alex', amountCents: 4200, method: 'venmo', status: 'paid', idempotencyKey: 'sam-side-key' }),
  ]);
  assert.equal(paidRows(tables).length, 1, JSON.stringify(tables.settlements));
  assert.deepEqual((await loadLedger(db, plan)).netBalances, { sam: 0, alex: 0 });
});

test('a stale screen tapped after the line was paid is refused, and a retry of the same tap is not', async () => {
  const { db, tables } = trip();
  const first = await recordSettlement(db, plan, 'alex', { ...markPaid, idempotencyKey: 'line-alex-sam-1' });
  assert.equal(first.status, 200);
  const retry = await recordSettlement(db, plan, 'alex', { ...markPaid, idempotencyKey: 'line-alex-sam-1' });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.replay, true);
  const stale = await recordSettlement(db, plan, 'alex', { ...markPaid, idempotencyKey: 'line-alex-sam-2' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.reason, 'nothing_owed');
  assert.equal(tables.settlements.length, 1);
});

test('the pay button leaves one pending line for both sides, and "Mark received" closes it', async () => {
  const { db, tables } = trip();
  const venmo = { toUserId: 'sam', amountCents: 4200, method: 'venmo', status: 'pending' };
  const cash = { ...venmo, method: 'cashapp' };
  await Promise.all([
    recordSettlement(db, plan, 'alex', { ...venmo, idempotencyKey: 'tap-venmo-1' }),
    recordSettlement(db, plan, 'alex', { ...cash, idempotencyKey: 'tap-cash-1' }),
  ]);
  assert.equal(tables.settlements.length, 1, 'one "Sent on Venmo?" per pair');
  // A pending payment moves nothing: Alex still owes Sam.
  const before = await loadLedger(db, plan);
  assert.equal(before.lines[0].amountCents, 4200);
  assert.ok(before.lines[0].pending);

  // Both sides see it.
  assert.equal(((await mySettlements(db, 'plan1', 'sam')).body.settlements as Row[]).length, 1);
  assert.equal(((await mySettlements(db, 'plan1', 'alex')).body.settlements as Row[]).length, 1);

  const id = tables.settlements[0].id;
  const received = await moveSettlement(db, plan, 'sam', { id, status: 'paid' });
  assert.equal(received.status, 200);
  assert.equal(received.body.settlement && (received.body.settlement as Row).status, 'paid');
  assert.deepEqual((await loadLedger(db, plan)).lines, []);
  assert.equal(tables.events.filter(e => e.name === 'settle_up_marked_paid').length, 1);
});

test('"Mark as paid" after the pay button closes the pending one rather than adding a second', async () => {
  const { db, tables } = trip();
  await recordSettlement(db, plan, 'alex', { toUserId: 'sam', amountCents: 4200, method: 'venmo', status: 'pending', idempotencyKey: 'line-alex-sam-1' });
  const res = await recordSettlement(db, plan, 'alex', { ...markPaid, idempotencyKey: 'line-alex-sam-1' });
  assert.equal(res.status, 200);
  assert.equal(tables.settlements.length, 1);
  assert.equal(tables.settlements[0].status, 'paid');
});

test('who can do what', async () => {
  const { db, tables } = trip({
    group_members: [{ group_id: 'g1', user_id: 'sam' }, { group_id: 'g1', user_id: 'alex' }, { group_id: 'g1', user_id: 'jo' }],
  });
  const bad = await recordSettlement(db, plan, 'sam', { fromUserId: 'alex', amountCents: 4200, status: 'pending', idempotencyKey: 'line-x-1234' });
  assert.equal(bad.status, 400, 'nobody says money is on its way to themselves');
  assert.equal((await recordSettlement(db, plan, 'alex', { ...markPaid })).status, 400, 'no key, no write');
  assert.equal((await recordSettlement(db, plan, 'alex', { ...markPaid, amountCents: 99999, idempotencyKey: 'line-x-1234' })).body.reason, 'more_than_owed');
  assert.equal(tables.settlements.length, 0);

  await recordSettlement(db, plan, 'alex', { ...markPaid, idempotencyKey: 'line-alex-sam-1' });
  const id = tables.settlements[0].id;
  assert.equal((await moveSettlement(db, plan, 'jo', { id, status: 'cancelled' })).status, 404, 'not on it, not told it exists');
  assert.equal((await moveSettlement(db, plan, 'alex', { id, status: 'cancelled' })).status, 403, 'the payer cannot undo a paid one');
  assert.equal((await moveSettlement(db, plan, 'sam', { id, status: 'cancelled' })).status, 200, 'the payee can: it never arrived');
  assert.equal((await loadLedger(db, plan)).lines[0].amountCents, 4200, 'and it is owed again');
});

test('a trip of one writes nothing', async () => {
  const { db, tables } = fakeDb({
    group_members: [{ group_id: 'g1', user_id: 'sam' }],
    expenses: [{ plan_id: 'plan1', paid_by: 'sam', amount_cents: 8400, split_between: ['sam'] }],
  });
  const res = await recordSettlement(db, plan, 'sam', { toUserId: 'alex', amountCents: 100, status: 'paid', idempotencyKey: 'line-solo-1' });
  assert.equal(res.status, 409);
  assert.equal(tables.settlements.length, 0);
});
