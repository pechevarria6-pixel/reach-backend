import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { claimOnce, claimOnceOutcome } from '../../lib/everyone-in.ts';

// A stand-in for audit_logs that answers each call on a later tick, the way
// the network does, so two requests started together interleave: both reads
// land before either insert. That is a double tap, and the case a
// read-then-write check gets wrong.
// `uuidColumn`: audit_logs.resource_id typed uuid, as the live table may be
// (sql/core-schema.sql was written down after the fact). Postgres then
// refuses any other value there, on read and on write, with 22P02.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type AuditRow = { id: string; action: string; resource_id: string; metadata?: Record<string, unknown>; created_at: number };
function fakeAudit(opts: { failRead?: boolean; failInsert?: boolean; uuidColumn?: boolean } = {}) {
  const rows: AuditRow[] = [];
  let seq = 0;
  const later = <T>(v: T) => new Promise<T>(r => setTimeout(() => r(v), 0));
  const bad = (v: unknown) => opts.uuidColumn && !UUID.test(String(v));
  const refused = { data: null, error: { code: '22P02' } };
  const field = (r: AuditRow, col: string) => {
    const [c, k] = col.split('->>');
    return k === undefined ? (r as Record<string, unknown>)[c] : r.metadata?.[k];
  };
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
          if (bad(filters.resource_id)) return later(refused);
          const hit = rows
            .filter(r => Object.entries(filters).every(([c, v]) => field(r, c) === v))
            .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
            .slice(0, n).map(r => ({ id: r.id }));
          return later({ data: hit, error: null });
        },
        insert(row: { action: string; resource_id: string; metadata?: Record<string, unknown> }) {
          return {
            select() {
              return {
                single() {
                  if (opts.failInsert) return later({ data: null, error: { code: '23503' } });
                  if (bad(row.resource_id)) return later(refused);
                  const id = `row-${String(++seq).padStart(3, '0')}`;
                  rows.push({ id, action: row.action, resource_id: row.resource_id, metadata: row.metadata, created_at: seq });
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

// The live run on 2026-11-05: B cast the last vote on a Charleston trip and
// the organiser was never told "Everyone has voted". The claim was keyed
// '<plan>:votes' in a column that holds uuids, so it was refused, read as
// 'error', and the announcement went to nobody. The celebration's
// '<plan>:<person>' key had the same fault.
test('a keyed claim holds where audit_logs.resource_id only takes a uuid', async () => {
  const plan = '190b7d21-5acd-4234-8381-8e38fff8ad08';
  const org = '0adf73af-e5ba-4135-88fd-8aa2a53f20fc';
  const b = '74314b48-1f1c-47f7-80f6-b36297587472';
  const { db } = fakeAudit({ uuidColumn: true });
  assert.equal(await claimOnceOutcome(db, plan, b, 'everyone_voted', `${plan}:votes`), 'first');
  assert.equal(await claimOnceOutcome(db, plan, org, 'everyone_voted', `${plan}:votes`), 'taken');
  // A new set of ideas is a new announcement.
  assert.equal(await claimOnceOutcome(db, plan, b, 'everyone_voted', `${plan}:set-2`), 'first');
  // Per person, on the same plan.
  assert.equal(await claimOnceOutcome(db, plan, org, 'celebrated_booked', `${plan}:${org}`), 'first');
  assert.equal(await claimOnceOutcome(db, plan, b, 'celebrated_booked', `${plan}:${b}`), 'first');
  assert.equal(await claimOnceOutcome(db, plan, b, 'celebrated_booked', `${plan}:${b}`), 'taken');
  // The plain per-plan claim is unchanged.
  assert.equal(await claimOnceOutcome(db, plan, b), 'first');
  assert.equal(await claimOnceOutcome(db, plan, org), 'taken');
});
