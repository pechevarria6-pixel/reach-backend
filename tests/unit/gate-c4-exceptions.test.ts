// Run with: npm run test:unit
// Directive C4: concierge is an exception queue with a count and an SLA, in ops only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exceptionQueue, SLA_HOURS } from '../../lib/ops/exceptions.ts';

const now = new Date('2026-11-08T12:00:00Z');
const row = (over: Record<string, unknown>) => ({ id: 'x', plan_id: 'p', vertical: 'restaurant', status: 'pending', mode: 'concierge', provider: 'concierge', created_at: '2026-11-08T11:00:00Z', ...over }) as never;

test('only pending concierge rows count, and the 2-hour SLA is measured', () => {
  const q = exceptionQueue([
    row({ id: 'a' }),
    row({ id: 'b', created_at: '2026-11-08T08:00:00Z' }),
    row({ id: 'c', status: 'cancelled' }),
    row({ id: 'd', mode: 'redirect', provider: 'opentable' }),
  ], now);
  assert.equal(q.open, 2);
  assert.equal(q.breachedSla, 1);
  assert.equal(q.slaHours, SLA_HOURS);
  assert.equal(q.oldestHours, 4);
  assert.equal(q.rows[0].id, 'b');
});

test('ops only: the route is secret-gated and nothing in member UI calls it', () => {
  assert.match(readFileSync('app/api/ops/exceptions/route.ts', 'utf8'), /if \(!authorised\(req\)\) return NextResponse\.json\(\{ error: 'Not authorised' \}, \{ status: 401 \}\)/);
  assert.doesNotMatch(readFileSync('components/reach-app.jsx', 'utf8'), /\/api\/ops\/exceptions/);
});
