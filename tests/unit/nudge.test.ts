import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimNudge, releaseNudge, NUDGE_ACTION } from '../../lib/nudge.ts';

// A small stand-in for the audit_logs table: enough of the query builder for
// what claimNudge asks of it, over rows held in memory.
function fakeDb(rows: Array<{ id: string; action: string; resource_id: string; created_at: string }> = []) {
  let n = 0;
  const db = {
    rows,
    from() {
      return {
        select() {
          const filters: Array<(r: any) => boolean> = [];
          const q: any = {
            eq(col: string, v: unknown) { filters.push(r => r[col] === v); return q; },
            gte(col: string, v: string) { filters.push(r => r[col] >= v); return q; },
            order() { return q; },
            then(ok: (v: unknown) => void) {
              const data = rows.filter(r => filters.every(f => f(r)))
                .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
              ok({ data, error: null });
            },
          };
          return q;
        },
        insert(row: any) {
          const made = { id: `z${++n}`, created_at: db.now, ...row };
          rows.push(made);
          return { select: () => ({ single: async () => ({ data: { id: made.id }, error: null }) }) };
        },
        delete() {
          return { eq: async (_: string, id: string) => {
            const i = rows.findIndex(r => r.id === id);
            if (i >= 0) rows.splice(i, 1);
            return { error: null };
          } };
        },
      };
    },
    now: '2026-09-23T12:00:00.000Z',
  };
  return db;
}

const at = (iso: string) => new Date(iso);

test('the first nudge for a trip goes, and a second inside the minute is refused', async () => {
  const db = fakeDb();
  const first = await claimNudge(db as never, 'plan-1', 'u1', at('2026-09-23T12:00:00.000Z'));
  assert.equal(first.allowed, true);
  assert.ok(first.claimId);

  db.now = '2026-09-23T12:00:20.000Z';
  const again = await claimNudge(db as never, 'plan-1', 'u2', at('2026-09-23T12:00:20.000Z'));
  assert.equal(again.allowed, false);
  assert.equal(again.retryAfterSeconds, 40);
  // A refused press is not left on the record to push the minute along.
  assert.equal(db.rows.filter(r => r.action === NUDGE_ACTION).length, 1);
});

test('after the minute it can go again, and another trip is never held up', async () => {
  const db = fakeDb();
  await claimNudge(db as never, 'plan-1', 'u1', at('2026-09-23T12:00:00.000Z'));
  db.now = '2026-09-23T12:00:05.000Z';
  assert.equal((await claimNudge(db as never, 'plan-2', 'u1', at('2026-09-23T12:00:05.000Z'))).allowed, true);
  db.now = '2026-09-23T12:01:01.000Z';
  assert.equal((await claimNudge(db as never, 'plan-1', 'u1', at('2026-09-23T12:01:01.000Z'))).allowed, true);
});

test('two presses in the same instant send once', async () => {
  // The second request's read raced the first's write: it saw nothing, wrote
  // its own claim, and must then find the older one and stand down.
  const db = fakeDb([{ id: 'a0', action: NUDGE_ACTION, resource_id: 'plan-1', created_at: '2026-09-23T11:59:59.999Z' }]);
  const realFrom = db.from.bind(db);
  let reads = 0;
  (db as any).from = () => {
    const t = realFrom();
    const sel = t.select;
    t.select = () => {
      const q = sel();
      const then = q.then;
      // Hide the other claim from the first read only.
      q.then = (ok: any) => (reads++ === 0 ? ok({ data: [], error: null }) : then(ok));
      return q;
    };
    return t;
  };
  const r = await claimNudge(db as never, 'plan-1', 'u2', at('2026-09-23T12:00:00.000Z'));
  assert.equal(r.allowed, false);
  assert.deepEqual(db.rows.map(x => x.id), ['a0']);
});

test('a nudge that sent nothing gives the minute back', async () => {
  const db = fakeDb();
  const c = await claimNudge(db as never, 'plan-1', 'u1', at('2026-09-23T12:00:00.000Z'));
  await releaseNudge(db as never, c.claimId);
  assert.equal(db.rows.length, 0);
  assert.equal((await claimNudge(db as never, 'plan-1', 'u1', at('2026-09-23T12:00:02.000Z'))).allowed, true);
});
