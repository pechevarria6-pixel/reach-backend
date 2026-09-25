// Run with: npm run test:unit
// lib/ledger.ts against a stand-in database: what the ledger reads, and what
// it does when the settlements table is not there yet or will not answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLedger, settleNote } from '../../lib/ledger.ts';

type Answer = { data: unknown; error: { code?: string; message?: string } | null };

/** Every query on a table resolves to its answer, whatever was chained. */
function fakeDb(tables: Record<string, Answer>) {
  return {
    from(table: string) {
      const answer = tables[table] ?? { data: [], error: null };
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'neq', 'not', 'in', 'or', 'order']) q[m] = () => q;
      q.then = (ok: (a: Answer) => unknown) => Promise.resolve(answer).then(ok);
      return q;
    },
  } as never;
}

const plan = { id: 'plan1', group_id: 'g1', budget_cents: 0, destination_city: 'Cabo' };
const members = (...ids: string[]) => ({ data: ids.map(user_id => ({ user_id })), error: null });
// Sam paid a $84 dinner for Sam and Alex.
const dinner = { data: [{ paid_by: 'sam', amount_cents: 8400, split_between: ['sam', 'alex'] }], error: null };

test('a trip of one is solo, and has nothing to settle', async () => {
  const l = await loadLedger(fakeDb({
    group_members: members('sam'),
    expenses: { data: [{ paid_by: 'sam', amount_cents: 8400, split_between: ['sam'] }], error: null },
  }), plan);
  assert.equal(l.solo, true);
  assert.deepEqual(l.lines, []);
});

test('a group of two owes what the expenses say', async () => {
  const l = await loadLedger(fakeDb({ group_members: members('sam', 'alex'), expenses: dinner }), plan);
  assert.equal(l.solo, false);
  assert.equal(l.settlementsAvailable, true);
  assert.deepEqual(l.lines.map(x => [x.from, x.to, x.amountCents]), [['alex', 'sam', 4200]]);
});

test('a settlement marked paid clears the line it paid', async () => {
  const l = await loadLedger(fakeDb({
    group_members: members('sam', 'alex'),
    expenses: dinner,
    settlements: { data: [{ id: 's1', from_user_id: 'alex', to_user_id: 'sam', amount_cents: 4200, status: 'paid' }], error: null },
  }), plan);
  assert.deepEqual(l.lines, []);
  assert.deepEqual(l.netBalances, { sam: 0, alex: 0 });
  assert.deepEqual(l.baseBalances, { sam: 4200, alex: -4200 });
});

test('before the migration the lines still show, and nothing can be marked paid', async () => {
  const l = await loadLedger(fakeDb({
    group_members: members('sam', 'alex'),
    expenses: dinner,
    settlements: { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.settlements' in the schema cache" } },
  }), plan);
  assert.equal(l.settlementsAvailable, false);
  assert.equal(l.lines.length, 1);
});

test('a settlements read that fails is an error, never "nobody has paid"', async () => {
  await assert.rejects(loadLedger(fakeDb({
    group_members: members('sam', 'alex'),
    expenses: dinner,
    settlements: { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } },
  }), plan));
});

test('the note says what the money was for', () => {
  assert.equal(settleNote({ destination_city: 'Cabo' }), 'Cabo trip');
  assert.equal(settleNote({ title: 'Dinner at Lupe', type: 'restaurant', destination_city: 'Austin' }), 'Dinner at Lupe');
  assert.equal(settleNote({ type: 'restaurant', destination_city: 'Austin' }), 'Austin night out');
  assert.equal(settleNote({ title: 'Girls trip' }), 'Girls trip');
  assert.equal(settleNote({}), 'Reach');
});
