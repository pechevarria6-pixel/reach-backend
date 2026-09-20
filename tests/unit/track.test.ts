import { test } from 'node:test';
import assert from 'node:assert/strict';
import { track, scrubProps, isEventName, EVENT_NAMES } from '../../lib/track.ts';

function db(error: unknown = null, onInsert?: (row: Record<string, unknown>) => void) {
  return {
    from: () => ({
      insert: (row: Record<string, unknown>) => { onInsert?.(row); return Promise.resolve({ error }); },
    }),
  } as never;
}

test('a thrown tracker would take down the booking it describes', async () => {
  // Instrumentation earns none of the product's reliability budget.
  const exploding = { from: () => { throw new Error('boom'); } } as never;
  await assert.doesNotReject(() => track(exploding, 'booking_created'));
});

test('a missing table is a quiet no-op, not an outage', async () => {
  const missing = { code: 'PGRST205', message: "Could not find the table 'public.events'" };
  await assert.doesNotReject(() => track(db(missing), 'plan_created'));
});

test('money always travels, so GMV is summable from events alone', async () => {
  let row: Record<string, unknown> | null = null;
  await track(db(null, r => { row = r; }), 'contribution_succeeded', { props: { amount_cents: 33401 } });
  assert.equal((row as never as { props: Record<string, unknown> }).props.amount_cents, 33401);
});

test('nothing a person typed reaches the table', async () => {
  // A props bag is exactly where somebody eventually puts an email "just for
  // debugging", so it is stripped here rather than trusted at every caller.
  const out = scrubProps({
    email: 'someone@example.com',
    name: 'Peter',
    phone: '919 832 6090',
    title: "Dinner at Poole's",
    blurb: 'ski trip with the boys',
    amount_cents: 500,
    vertical: 'restaurant',
    solo: true,
  });
  assert.deepEqual(out, { amount_cents: 500, vertical: 'restaurant', solo: true });
});

test('a long string is prose, and prose is never a property', () => {
  const out = scrubProps({ reason: 'x'.repeat(41), verdict: 'done' });
  assert.deepEqual(out, { verdict: 'done' });
});

test('only the listed names may be written', () => {
  assert.equal(isEventName('booking_confirmed'), true);
  assert.equal(isEventName('something_i_invented'), false);
  assert.equal(EVENT_NAMES.length, 16);
});

test('the ids it was given are the ids it records', async () => {
  let row: Record<string, unknown> | null = null;
  await track(db(null, r => { row = r; }), 'vote_cast', { userId: 'u1', groupId: 'g1', planId: 'p1' });
  const r = row as never as Record<string, unknown>;
  assert.equal(r.user_id, 'u1');
  assert.equal(r.group_id, 'g1');
  assert.equal(r.plan_id, 'p1');
});

test('an anonymous moment is recorded with no user, not skipped', async () => {
  // An invitation opened is the first step of the loop and there is nobody
  // to attribute it to yet.
  let row: Record<string, unknown> | null = null;
  await track(db(null, r => { row = r; }), 'invite_link_opened', { groupId: 'g1' });
  assert.equal((row as never as Record<string, unknown>).user_id, null);
});
