import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  kindOf, activePlanIn, staleActiveIn, refusalCode, refusalBody, refusalCopy, readActive, earliestToday,
  type ActiveCandidate,
} from '../../lib/one-active.ts';

const today = '2026-09-25';
const plan = (over: Partial<ActiveCandidate>): ActiveCandidate => ({
  id: 'p', type: 'trip', status: 'planning', destination_style: null,
  start_date: '2026-10-10', end_date: '2026-10-12', created_at: '2026-09-20T10:00:00Z', ...over,
});

// ─── The two kinds ──────────────────────────────────────────────────────

test('a dinner and a concert are nights out; a trip and a weekend are trips', () => {
  assert.equal(kindOf('restaurant'), 'night');
  assert.equal(kindOf('concert'), 'night');
  assert.equal(kindOf('trip'), 'trip');
  assert.equal(kindOf('weekend'), 'trip');
  assert.equal(kindOf(null), 'trip');
});

test('the index builds its kind the same way the route does', () => {
  // sql/one-active-plan-2026-09-25.sql holds the line under concurrency; if
  // its CASE and kindOf disagree, the check and the index enforce different
  // rules and one of them refuses a plan the other allowed.
  const sql = readFileSync(new URL('../../sql/one-active-plan-2026-09-25.sql', import.meta.url), 'utf8');
  const index = /create unique index plans_one_active[\s\S]*?where status in \(([^)]*)\)/i.exec(sql);
  assert.ok(index, 'plans_one_active is in the file');
  const nights = /case when type in \(([^)]*)\) then 'night' else 'trip' end/i.exec(index[0]);
  assert.ok(nights, 'the index reads the kind from type');
  const nightTypes = nights[1].split(',').map(s => s.trim().replace(/'/g, ''));
  for (const t of ['trip', 'restaurant', 'concert', 'weekend']) {
    assert.equal(nightTypes.includes(t) ? 'night' : 'trip', kindOf(t), t);
  }
  const statuses = index[1].split(',').map(s => s.trim().replace(/'/g, ''));
  assert.deepEqual(statuses, ['planning', 'voting']);
});

// ─── What is in the way ─────────────────────────────────────────────────

test('a trip being planned blocks a second trip, and a weekend away counts as one', () => {
  assert.equal(activePlanIn([plan({ id: 'first' })], { type: 'trip', today })?.id, 'first');
  assert.equal(activePlanIn([plan({ id: 'first', type: 'weekend' })], { type: 'trip', today })?.id, 'first');
});

test('a night out is never blocked by a trip, nor a trip by a night out', () => {
  assert.equal(activePlanIn([plan({ id: 'trip' })], { type: 'restaurant', today }), null);
  assert.equal(activePlanIn([plan({ id: 'dinner', type: 'restaurant' })], { type: 'trip', today }), null);
  assert.equal(activePlanIn([plan({ id: 'dinner', type: 'restaurant' })], { type: 'concert', today })?.id, 'dinner');
});

test('decided or undecided, voting or planning, it is in the way — past planning it is not', () => {
  assert.equal(activePlanIn([plan({ id: 'v', status: 'voting', destination_style: 'undecided' })], { type: 'trip', today })?.id, 'v');
  for (const status of ['approved', 'booked', 'completed', 'cancelled']) {
    assert.equal(activePlanIn([plan({ status })], { type: 'trip', today }), null, status);
  }
});

test('one whose dates have passed is not in the way; an undated one still is', () => {
  const over = plan({ id: 'over', start_date: '2026-09-01', end_date: '2026-09-03' });
  assert.equal(activePlanIn([over], { type: 'trip', today }), null);
  assert.equal(activePlanIn([plan({ id: 'undated', start_date: null, end_date: null })], { type: 'trip', today })?.id, 'undated');
});

test('the plan being reopened is not in its own way', () => {
  assert.equal(activePlanIn([plan({ id: 'me' })], { type: 'trip', today, except: 'me' }), null);
});

test('the oldest is the one offered', () => {
  const plans = [plan({ id: 'newer', created_at: '2026-09-22' }), plan({ id: 'older', created_at: '2026-09-21' })];
  assert.equal(activePlanIn(plans, { type: 'trip', today })?.id, 'older');
});

// ─── Closing what has passed ────────────────────────────────────────────

test('a stale undecided trip is cancelled; a stale decided night out is completed, because it happened', () => {
  const plans = [
    plan({ id: 'never-picked', destination_style: 'undecided', start_date: '2026-09-01', end_date: null }),
    plan({ id: 'still-on' }),
  ];
  assert.deepEqual(staleActiveIn(plans, { type: 'trip', today }), [{ id: 'never-picked', closeAs: 'cancelled' }]);
  const dinner = plan({ id: 'dinner', type: 'restaurant', start_date: '2026-09-19', end_date: null });
  assert.deepEqual(staleActiveIn([dinner], { type: 'restaurant', today }), [{ id: 'dinner', closeAs: 'completed' }]);
  // Only its own kind.
  assert.deepEqual(staleActiveIn([dinner], { type: 'trip', today }), []);
});

test('"today" is the earliest calendar day anywhere, so nothing still on somewhere is closed', () => {
  // 06:00 UTC on the 26th is still the 25th at UTC-12.
  assert.equal(earliestToday(new Date('2026-09-26T06:00:00Z')), '2026-09-25');
});

// ─── The answer ─────────────────────────────────────────────────────────

test('two undecided group trips keep the old answer the client already opens', () => {
  const waiting = plan({ destination_style: 'undecided' });
  assert.equal(refusalCode({ type: 'trip', undecided: true }, waiting), 'already_waiting');
  assert.equal(refusalCode({ type: 'trip', undecided: false }, waiting), 'one_active');
  assert.equal(refusalCode({ type: 'trip', undecided: true }, plan({})), 'one_active');
  // A weekend meeting an undecided trip: same kind, not the case the old code named.
  assert.equal(refusalCode({ type: 'weekend', undecided: true }, waiting), 'one_active');
});

test('the 409 names the plan to open and its kind', () => {
  const body = refusalBody(plan({ id: 'first', title: 'Lisbon' }), { type: 'weekend', undecided: false, solo: false });
  assert.deepEqual(
    { code: body.code, planId: body.planId, kind: body.kind },
    { code: 'one_active', planId: 'first', kind: 'trip' },
  );
  assert.match(body.error, /Lisbon/);
});

test('the copy speaks to one person when the group is one person, and promises nothing', () => {
  assert.equal(refusalCopy('night', { title: 'Tacos', solo: true }), "You're already planning a night out: Tacos. Here it is.");
  assert.equal(refusalCopy('trip', {}), 'This group is already planning a trip. Here it is.');
  assert.doesNotMatch(refusalCopy('trip', { title: 'x' }), /call (it|that one) off|cancel/i);
});

// ─── Reading ────────────────────────────────────────────────────────────

function dbAnswering(answer: { data?: unknown[]; error?: { code: string } }) {
  const seen: [string, unknown][] = [];
  const chain = {
    select() { return chain; },
    eq(c: string, v: unknown) { seen.push([c, v]); return chain; },
    in(c: string, v: unknown) { seen.push([c, v]); return Promise.resolve({ data: answer.data ?? [], error: answer.error ?? null }); },
  };
  return { db: { from: () => chain } as never, seen };
}

test('a read that fails is nothing in the way — the index holds the line, not a guess', async () => {
  const { db } = dbAnswering({ error: { code: '57014' } });
  assert.deepEqual(await readActive(db, 'g1', { type: 'trip', today }), { live: null, stale: [] });
});

test('the read is this group, in planning or voting', async () => {
  const { db, seen } = dbAnswering({ data: [{ id: 'a', type: 'trip', status: 'planning', start_date: null, end_date: null, created_at: '1' }] });
  const r = await readActive(db, 'g1', { type: 'trip', today });
  assert.equal(r.live?.id, 'a');
  assert.deepEqual(seen, [['group_id', 'g1'], ['status', ['planning', 'voting']]]);
});
