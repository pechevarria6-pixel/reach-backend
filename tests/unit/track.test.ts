import { test } from 'node:test';
import assert from 'node:assert/strict';
import { track, scrubProps, isEventName, EVENT_NAMES, BROWSER_EVENT_NAMES } from '../../lib/track.ts';

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
  // 17 before the onboarding quiz v3, whose section 8 adds eleven, and nine
  // more for the checkout spec of 2026-09-25.
  assert.equal(EVENT_NAMES.length, 37);
  for (const n of ['quiz_started', 'quiz_screen_viewed', 'quiz_screen_skipped', 'quiz_result_viewed',
    'quiz_dial_adjusted', 'quiz_shared', 'quiz_share_opened', 'quiz_share_joined',
    'drip_shown', 'drip_answered', 'drip_dismissed', 'quiz_completed']) assert.equal(isEventName(n), true, n);
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

test('an id in the props bag survives the scrub', () => {
  // plan_deleted cannot name its plan in the plan_id column: that column is
  // `references plans(id) on delete set null`, and by the time the event is
  // true the row is gone, so the insert is refused with 23503. Reproduced
  // against the real database — it had never once been recorded.
  //
  // The id therefore travels in props, which has no foreign key. A uuid is 36
  // characters and the cap here is 40, which is close enough that lowering the
  // cap would silently empty this event rather than fail anywhere visible.
  const kept = scrubProps({ plan: 'cd6a7512-257c-43d7-841f-d1500a589b75', cancelled_quotes: 2 });
  assert.equal(kept.plan, 'cd6a7512-257c-43d7-841f-d1500a589b75');
  assert.equal(kept.cancelled_quotes, 2);
});

test('the props bag still refuses anything about a person', () => {
  // The reason the cap exists. Widening it for the uuid above must not become
  // a way for prose to get in.
  const kept = scrubProps({ plan: 'p1', name: 'Peter', email: 'a@b.c', note: 'hi' });
  assert.deepEqual(Object.keys(kept), ['plan']);
});

// The checkout spec's names, added in one change. A screen fires each of them,
// so each must be both a name and one the browser may send — a name in only
// one list is a button whose tap is answered 400 and never counted.
const CHECKOUT_EVENTS = [
  'checkout_state_shown', 'checkout_cta_tapped', 'slot_unfilled',
  'itinerary_item_dropped_location', 'itinerary_item_swapped',
  'next_trip_started_from_close', 'settle_up_link_opened',
  'settle_up_marked_paid', 'celebration_shown',
];

test('every checkout event is a name and may come from a browser', () => {
  const browser = new Set<string>(BROWSER_EVENT_NAMES);
  for (const n of CHECKOUT_EVENTS) {
    assert.equal(isEventName(n), true, `${n} is not in EVENT_NAMES`);
    assert.equal(browser.has(n), true, `${n} is not in the browser list`);
  }
});

test('the browser may only send names that exist, and never the money-truth ones', () => {
  for (const n of BROWSER_EVENT_NAMES) assert.equal(isEventName(n), true, n);
  // Stripe says when a contribution succeeded, not a screen.
  for (const n of ['contribution_succeeded', 'plan_fully_funded', 'booking_confirmed']) {
    assert.equal(BROWSER_EVENT_NAMES.includes(n as never), false, n);
  }
});

test('the route reads its allowlist from the same list', async () => {
  const { readFileSync } = await import('node:fs');
  const route = readFileSync(new URL('../../app/api/track/route.ts', import.meta.url), 'utf8');
  assert.match(route, /new Set<EventName>\(BROWSER_EVENT_NAMES\)/);
});

test('a settle-up event keeps its app and amount and loses anything personal', () => {
  const out = scrubProps({ app: 'venmo', amount_cents: 4200, handle_note: 'Cabo trip', recipient_name: 'Sam' });
  assert.deepEqual(out, { app: 'venmo', amount_cents: 4200 });
});
