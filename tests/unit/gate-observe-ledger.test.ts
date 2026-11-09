// Business model §3 "zero post-trip IOUs": the ledger is read once after a
// trip's last day — in the trip's own zone — and recorded once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastDayOf, isOver, ledgerSummary, recordLedgersAtTripEnd, type EndingPlan } from '../../lib/observe/ledger-at-end.ts';

const plan = (over: Partial<EndingPlan> = {}): EndingPlan => ({
  id: 'p1', group_id: 'g1', start_date: '2026-11-06', end_date: '2026-11-08',
  destination_lng: -74, status: 'booked', ...over,
});

test('the last day is the end date, or the start for a night out', () => {
  assert.equal(lastDayOf(plan()), '2026-11-08');
  assert.equal(lastDayOf(plan({ end_date: null })), '2026-11-06');
  // An end before the start is a typo.
  assert.equal(lastDayOf(plan({ end_date: '2026-11-01' })), '2026-11-06');
  assert.equal(lastDayOf(plan({ start_date: null, end_date: null })), null);
});

test('a trip is not over on the evening of its last day in New York', () => {
  // 9pm on the 8th in New York is already the 9th in Greenwich.
  const nineInTheEvening = new Date('2026-11-09T02:00:00Z');
  assert.equal(isOver(plan(), nineInTheEvening), false);
  assert.equal(isOver(plan(), new Date('2026-11-09T12:00:00Z')), true);
});

test('only open lines with money in them count', () => {
  const s = ledgerSummary({
    members: ['a', 'b', 'c'], solo: false,
    lines: [
      { from: 'a', to: 'b', amountCents: 1250, pending: null },
      { from: 'c', to: 'b', amountCents: 0, pending: null },
    ],
  } as never);
  assert.deepEqual(s, { open_lines: 1, open_cents: 1250, members: 3, solo: false });
});

/** Answers each table's select with fixed rows; records inserted events. */
function fakeDb(tables: Record<string, unknown[]>) {
  const inserted: Record<string, unknown>[] = [];
  const builder = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'gte', 'lte']) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok);
    return q;
  };
  return {
    inserted,
    db: {
      from: (t: string) => ({
        ...builder(tables[t] ?? []),
        insert: (row: Record<string, unknown>) => { inserted.push(row); return Promise.resolve({ error: null }); },
      }),
    } as never,
  };
}

test('an ended trip is recorded once, with counts only', async () => {
  const { db, inserted } = fakeDb({ plans: [plan()], events: [] });
  const load = async () => ({ members: ['a', 'b'], solo: false, lines: [{ from: 'a', to: 'b', amountCents: 900, pending: null }] });
  const r = await recordLedgersAtTripEnd(db, new Date('2026-11-09T15:00:00Z'), load as never);
  assert.deepEqual(r, { checked: 1, recorded: 1, skipped: 0, failed: 0 });
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].name, 'ledger_at_trip_end');
  assert.equal(inserted[0].plan_id, 'p1');
  const props = inserted[0].props as Record<string, unknown>;
  assert.equal(props.open_lines, 1);
  assert.equal(props.open_cents, 900);
  // Who owes whom never reaches the table.
  assert.doesNotMatch(JSON.stringify(props), /"a"|"b"/);
});

test('a trip already recorded is skipped, and one still running is not read', async () => {
  const running = plan({ id: 'p2', end_date: '2026-11-12' });
  const { db, inserted } = fakeDb({ plans: [plan(), running], events: [{ plan_id: 'p1' }] });
  let loads = 0;
  const load = async () => { loads++; return { members: [], solo: true, lines: [] }; };
  const r = await recordLedgersAtTripEnd(db, new Date('2026-11-09T15:00:00Z'), load as never);
  assert.equal(loads, 0);
  assert.equal(inserted.length, 0);
  assert.deepEqual(r, { checked: 1, recorded: 0, skipped: 1, failed: 0 });
});

test('one unreadable ledger does not stop the others', async () => {
  const { db, inserted } = fakeDb({ plans: [plan(), plan({ id: 'p3' })], events: [] });
  const load = async (_db: unknown, p: EndingPlan) => {
    if (p.id === 'p1') throw new Error('Could not read who has paid whom');
    return { members: ['a'], solo: true, lines: [] };
  };
  const r = await recordLedgersAtTripEnd(db, new Date('2026-11-09T15:00:00Z'), load as never);
  assert.equal(r.failed, 1);
  assert.equal(r.recorded, 1);
  assert.equal(inserted.length, 1);
});
