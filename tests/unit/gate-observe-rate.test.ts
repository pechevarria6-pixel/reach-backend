// Pilot gate A5: /api/trips/generate is limited per group as well as per
// person, and the group limit is out of reach of a real group planning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupAllowance, groupTooOften, GROUP_PER_HOUR, GROUP_ACTIONS } from '../../lib/observe/group-rate.ts';
import { PER_HOUR, REBUILDS_PER_HOUR } from '../../lib/rate-limit.ts';

const ROUTE = readFileSync(new URL('../../app/api/trips/generate/route.ts', import.meta.url), 'utf8');

/** A PostgREST builder that records its filters and answers `rows`. */
function fake(rows: { created_at: string }[] | null, error: unknown = null) {
  const calls: [string, unknown[]][] = [];
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'gte', 'order']) {
    q[m] = (...args: unknown[]) => { calls.push([m, args]); return q; };
  }
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows, error }).then(ok);
  return { db: { from: (t: string) => { calls.push(['from', [t]]); return q; } } as never, calls };
}

const now = new Date('2026-11-08T18:00:00Z');
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

test('a group under the limit is allowed', async () => {
  const { db } = fake(Array.from({ length: GROUP_PER_HOUR - 1 }, (_, i) => ({ created_at: minsAgo(50 - i % 50) })));
  const a = await groupAllowance(db, 'g1', GROUP_PER_HOUR, now);
  assert.equal(a.allowed, true);
});

test('a group at the limit is refused, and told when it frees up', async () => {
  const { db } = fake([{ created_at: minsAgo(45) }, ...Array.from({ length: GROUP_PER_HOUR - 1 }, () => ({ created_at: minsAgo(5) }))]);
  const a = await groupAllowance(db, 'g1', GROUP_PER_HOUR, now);
  assert.equal(a.allowed, false);
  assert.equal(a.retryAfterMinutes, 15);
  assert.match(groupTooOften(a), /15 minutes/);
});

test('it counts this group, both kinds of generation, in the last hour', async () => {
  const { db, calls } = fake([]);
  await groupAllowance(db, 'g-42', GROUP_PER_HOUR, now);
  assert.deepEqual(calls.find(c => c[0] === 'from')?.[1], ['audit_logs']);
  assert.ok(calls.some(c => c[0] === 'eq' && c[1][0] === 'resource_id' && c[1][1] === 'g-42'));
  assert.ok(calls.some(c => c[0] === 'eq' && c[1][0] === 'resource' && c[1][1] === 'groups'));
  const inCall = calls.find(c => c[0] === 'in');
  assert.deepEqual(inCall?.[1], ['action', [...GROUP_ACTIONS]]);
  assert.ok(calls.some(c => c[0] === 'gte' && c[1][1] === minsAgo(60)));
});

test('a counter it cannot read allows rather than refuses', async () => {
  const { db } = fake(null, { code: '57014' });
  assert.equal((await groupAllowance(db, 'g1', GROUP_PER_HOUR, now)).allowed, true);
});

test('a person on their own can never reach the group limit', () => {
  // Their own two allowances added together stay under it, so the group
  // refusal cannot be the one a solo planner sees.
  assert.ok(PER_HOUR + REBUILDS_PER_HOUR < GROUP_PER_HOUR);
});

test('the refusal speaks for nobody and uses none of the back-office words', () => {
  const words = groupTooOften({ allowed: false, used: 60, limit: 60, retryAfterMinutes: 30 });
  assert.doesNotMatch(words, /everyone|your group|the others/i);
  assert.doesNotMatch(words, /funding gate|quote drift|propose|fulfillment|concierge|lane|agent|bot\b/i);
});

test('the route checks the group before the attempt is written', () => {
  const check = ROUTE.indexOf('await groupAllowance(supabase, String(groupId))');
  const write = ROUTE.indexOf("from('audit_logs').insert(");
  const person = ROUTE.indexOf('const rate = await allowance(');
  assert.ok(person > 0 && check > person, 'the group check follows the per-person one');
  assert.ok(write > check, 'a refused request must not count against anybody');
  assert.match(ROUTE.slice(check, write), /status: 429/);
});
