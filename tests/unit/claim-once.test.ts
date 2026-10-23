import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { claimOnce, claimOnceOutcome } from '../../lib/everyone-in.ts';

// A stand-in for audit_logs that answers each call on a later tick, the way
// the network does, so two requests started together interleave: both reads
// land before either insert. That is a double tap, and the case a
// read-then-write check gets wrong.
function fakeAudit(opts: { failRead?: boolean; failInsert?: boolean } = {}) {
  const rows: { id: string; action: string; resource_id: string; created_at: number }[] = [];
  let seq = 0;
  const later = <T>(v: T) => new Promise<T>(r => setTimeout(() => r(v), 0));
  const db = {
    from(table: string) {
      assert.equal(table, 'audit_logs');
      const filters: Record<string, string> = {};
      const q = {
        select() { return q; },
        eq(col: string, v: string) { filters[col] = v; return q; },
        order() { return q; },
        limit(n: number) {
          if (opts.failRead) return later({ data: null, error: { code: 'XX000' } });
          const hit = rows
            .filter(r => r.action === filters.action && r.resource_id === filters.resource_id)
            .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
            .slice(0, n).map(r => ({ id: r.id }));
          return later({ data: hit, error: null });
        },
        insert(row: { action: string; resource_id: string }) {
          return {
            select() {
              return {
                single() {
                  if (opts.failInsert) return later({ data: null, error: { code: '23503' } });
                  const id = `row-${String(++seq).padStart(3, '0')}`;
                  rows.push({ id, action: row.action, resource_id: row.resource_id, created_at: seq });
                  return later({ data: { id }, error: null });
                },
              };
            },
          };
        },
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, rows };
}

test('a double tap: two claims at once, exactly one is first', async () => {
  const { db, rows } = fakeAudit();
  const key = 'p1:u1';
  const [a, b] = await Promise.all([
    claimOnceOutcome(db, 'p1', 'u1', 'celebrated_booked', key),
    claimOnceOutcome(db, 'p1', 'u1', 'celebrated_booked', key),
  ]);
  assert.deepEqual([a, b].sort(), ['first', 'taken']);
  assert.ok(rows.length >= 1);
});

test('after the first, every later claim is taken — a refresh, a second phone', async () => {
  const { db } = fakeAudit();
  assert.equal(await claimOnceOutcome(db, 'p1', 'u1', 'celebrated_booked', 'p1:u1'), 'first');
  assert.equal(await claimOnceOutcome(db, 'p1', 'u1', 'celebrated_booked', 'p1:u1'), 'taken');
  assert.equal(await claimOnce(db, 'p1', 'u1', 'celebrated_booked', 'p1:u1'), false);
});

test('per person: my claim does not use up yours', async () => {
  const { db } = fakeAudit();
  assert.equal(await claimOnceOutcome(db, 'p1', 'u1', 'celebrated_booked', 'p1:u1'), 'first');
  assert.equal(await claimOnceOutcome(db, 'p1', 'u2', 'celebrated_booked', 'p1:u2'), 'first');
});

test('a table that cannot be read or written is an error, not "already done"', async () => {
  assert.equal(await claimOnceOutcome(fakeAudit({ failRead: true }).db, 'p1', 'u1', 'x', 'k'), 'error');
  assert.equal(await claimOnceOutcome(fakeAudit({ failInsert: true }).db, 'p1', 'u1', 'x', 'k'), 'error');
  assert.equal(await claimOnce(fakeAudit({ failInsert: true }).db, 'p1', 'u1', 'x', 'k'), false);
});
