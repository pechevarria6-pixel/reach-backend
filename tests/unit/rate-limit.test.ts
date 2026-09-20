import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowance, tooOften, PER_HOUR } from '../../lib/rate-limit.ts';

const NOW = new Date('2026-09-20T12:00:00Z');
const minsAgo = (n: number) => new Date(NOW.getTime() - n * 60000).toISOString();

/** A database that answers with these rows, or with an error. */
function db(rows: { created_at: string }[] | null, error: unknown = null) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte', 'order']) {
    q[m] = () => (m === 'order' ? Promise.resolve({ data: rows, error }) : q);
  }
  return { from: () => q } as never;
}

test('under the limit, it lets you through', async () => {
  const a = await allowance(db([{ created_at: minsAgo(5) }, { created_at: minsAgo(9) }]), 'u1', 'trip_generated', PER_HOUR, NOW);
  assert.equal(a.allowed, true);
  assert.equal(a.used, 2);
});

test('at the limit, it does not', async () => {
  const rows = Array.from({ length: PER_HOUR }, (_, i) => ({ created_at: minsAgo(i + 1) }));
  const a = await allowance(db(rows), 'u1', 'trip_generated', PER_HOUR, NOW);
  assert.equal(a.allowed, false);
  assert.equal(a.used, PER_HOUR);
});

test('it says when the next one frees up, from the oldest in the window', async () => {
  // The oldest was 50 minutes ago, so it leaves the hour in 10.
  const rows = Array.from({ length: PER_HOUR }, (_, i) => ({ created_at: minsAgo(50 - i) }));
  const a = await allowance(db(rows), 'u1', 'trip_generated', PER_HOUR, NOW);
  assert.equal(a.retryAfterMinutes, 10);
  assert.match(tooOften(a), /10 minutes/);
});

test('a counter it cannot read lets you through', async () => {
  // A limiter that refuses because its own count failed turns a database
  // blip into an outage of the main feature, and a loop is rarer than a blip.
  const a = await allowance(db(null, { code: 'PGRST500', message: 'boom' }), 'u1', 'trip_generated', PER_HOUR, NOW);
  assert.equal(a.allowed, true);
  assert.equal(a.used, 0);
});

test('nothing recent is nothing to wait for', async () => {
  const a = await allowance(db([]), 'u1', 'trip_generated', PER_HOUR, NOW);
  assert.equal(a.allowed, true);
  assert.equal(a.retryAfterMinutes, 0);
});

test('the message tells them what to do, not what they did wrong', async () => {
  const rows = Array.from({ length: PER_HOUR }, (_, i) => ({ created_at: minsAgo(i + 1) }));
  const said = tooOften(await allowance(db(rows), 'u1', 'trip_generated', PER_HOUR, NOW));
  assert.match(said, /carry on/);
  assert.ok(!/abuse|blocked|violation|limit exceeded/i.test(said), said);
});
