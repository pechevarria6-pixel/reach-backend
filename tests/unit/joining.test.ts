// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  latecomerOptOuts, isSoloCount, bringAlongNote, tripHolds, notOnBooked, beforeJoining, afterJoining,
} from '../../lib/joining.ts';
import { claimInvitesFor } from '../../lib/invites.ts';
import { planShares } from '../../lib/money.ts';
import { planReadiness } from '../../lib/plan-readiness.ts';

// ── The pure parts ───────────────────────────────────────────────────────

test('a newcomer is kept off what is bought, once each', () => {
  const rows = latecomerOptOuts([
    { id: 'b1', plan_id: 'p1', status: 'confirmed' },
    { id: 'b1', plan_id: 'p1', status: 'confirmed' },
    { id: 'b3', plan_id: 'p2', status: 'pending' },
  ], 'u-new');
  assert.deepEqual(rows, [
    { plan_id: 'p1', item_ref: 'b1', user_id: 'u-new' },
    { plan_id: 'p2', item_ref: 'b3', user_id: 'u-new' },
  ], 'a repeated row would make Postgres refuse the whole upsert');
});

test('a proposal or a hold is not bought: the newcomer is on it, to be re-priced', () => {
  // The review's case: a three-person group opens checkout, a fourth joins.
  // Kept off the proposal, the fourth could never be put back on the flight
  // or the hotel — those cannot be sat out, so they cannot be sat back in.
  const unbought = [
    { id: 'flight', plan_id: 'p1', status: 'awaiting_approval' },
    { id: 'hotel', plan_id: 'p1', status: 'quoted' },
    { id: 'link', plan_id: 'p1', status: 'redirected' },
  ];
  assert.deepEqual(latecomerOptOuts(unbought, 'u-new'), []);
  // Unless somebody has paid into that plan: what they paid against is the
  // total, and it does not move.
  assert.deepEqual(latecomerOptOuts(unbought, 'u-new', new Set(['p1'])).map(r => r.item_ref), ['flight', 'hotel', 'link']);
  assert.deepEqual(latecomerOptOuts(unbought, 'u-new', new Set(['p2'])), [], 'only the plan that was paid into');
});

test('failed and cancelled bookings are nobody’s, so nobody is kept off them', () => {
  const rows = latecomerOptOuts([
    { id: 'b1', plan_id: 'p1', status: 'failed' },
    { id: 'b2', plan_id: 'p1', status: 'cancelled' },
  ], 'u-new');
  assert.deepEqual(rows, []);
  assert.deepEqual(latecomerOptOuts([{ id: 'b1', plan_id: 'p1' }], ''), [], 'no user, nothing to write');
});

test('one person is solo, two is a group', () => {
  assert.equal(isSoloCount(0), true);
  assert.equal(isSoloCount(1), true);
  assert.equal(isSoloCount(2), false);
  assert.equal(isSoloCount(Number.NaN), true, 'a count we could not read is not a group');
});

test('what somebody who joins late owes for what was already booked: nothing', () => {
  // The bug this exists for: a room booked and paid for one person, and the
  // moment a second joined, funding halved it between them.
  const bookings = [{ id: 'hotel', price_cents: 40000 }];
  const before = planShares(bookings, 0, ['u-solo']);
  const skips = latecomerOptOuts([{ id: 'hotel', plan_id: 'p1', status: 'confirmed' }], 'u-new')
    .map(r => ({ ref: r.item_ref, userId: r.user_id }));
  const after = planShares(bookings, 0, ['u-solo', 'u-new'], skips);
  assert.equal(after['u-solo'], before['u-solo'], 'the person who paid pays exactly what they paid');
  assert.equal(after['u-new'], 0, 'the newcomer is not charged for a room that is not theirs');
});

test('the note never lets an invite read as a booking, and promises nothing Reach does not do', () => {
  const none = { bought: false, unbought: false, paidCents: 0 };
  const quiet = bringAlongNote(none);
  assert.match(quiet, /until they join/);
  assert.doesNotMatch(quiet, /everyone/i, 'singular while it is still one person');

  const proposed = bringAlongNote({ ...none, unbought: true });
  assert.match(proposed, /Nothing's bought yet/);
  assert.match(proposed, /priced for everyone going the next time checkout opens/);

  const booked = bringAlongNote({ ...none, bought: true });
  assert.match(booked, /stays yours alone/);
  assert.match(booked, /can't add someone to a booking it has already made/);
  assert.match(booked, /directly with the airline or hotel/, 'somewhere they can actually get a seat');
  assert.doesNotMatch(booked, /priced for everyone/, 'nothing unbought, nothing re-priced');
  assert.match(bringAlongNote({ ...none, bought: true, unbought: true }), /priced for everyone going/);

  const paid = bringAlongNote({ ...none, unbought: true, paidCents: 123450 });
  assert.match(paid, /You've paid \$1,234\.50/);
  assert.match(paid, /priced for you alone/);
  assert.doesNotMatch(paid, /priced for everyone/, 'a paid trip is not re-sized');

  // The group screen, which cannot see bookings or payments.
  const unknown = bringAlongNote({ ...none, known: false });
  assert.match(unknown, /can't add someone to a booking/);
  assert.match(unknown, /paid towards/);

  // The promise the review found: nothing books "anything for them" separately.
  for (const s of [quiet, proposed, booked, paid, unknown]) {
    assert.doesNotMatch(s, /booked separately/);
  }
});

test('what a trip holds, from the rows the plan screen already has', () => {
  assert.deepEqual(tripHolds([], 0), { bought: false, unbought: false, paidCents: 0 });
  assert.deepEqual(tripHolds([{ status: 'confirmed', vertical: 'restaurant' }], 0).bought, true);
  assert.equal(tripHolds([{ status: 'pending', vertical: 'flight' }], 0).bought, true);
  assert.equal(tripHolds([{ status: 'redirected', vertical: 'event' }], 0).bought, false, 'a link out is not bought through Reach');
  assert.equal(tripHolds([{ status: 'quoted', vertical: 'hotel' }], 0).unbought, true);
  assert.equal(tripHolds([{ status: 'awaiting_approval', vertical: 'restaurant' }], 0).unbought, false,
    'only flights and rooms are re-sized, so only they are promised it');
  assert.equal(tripHolds([{ status: 'failed', vertical: 'flight' }], 0).unbought, false);
  assert.equal(tripHolds(null, 4999.6).paidCents, 5000);
});

test('who is not on a flight or hotel already bought, and nothing a person chose to sit out', () => {
  const bookings = [
    { id: 'f1', vertical: 'flight' }, { id: 'h1', vertical: 'hotel' }, { id: 'd1', vertical: 'restaurant' },
  ];
  const skips = [
    { ref: 'f1', userId: 'u-new' }, { ref: 'h1', userId: 'u-new' }, { ref: 'f1', userId: 'u-new' },
    { ref: 'd1', userId: 'u-solo' },
    { ref: 'h1', userId: 'u-gone' },
  ];
  assert.deepEqual(notOnBooked(bookings, skips, ['u-solo', 'u-new']), { 'u-new': ['flight', 'hotel'] });
  assert.deepEqual(notOnBooked(bookings, [], ['u-solo']), {});
  assert.deepEqual(notOnBooked(null, null, []), {});
});

// ── Against a stand-in for the database ──────────────────────────────────
// Only the chained calls lib/joining.ts and lib/invites.ts make. Every table
// is an array of rows and every filter is an equality or a membership test.
type Row = Record<string, any>;
function makeDb(tables: Record<string, Row[]>, fail: Record<string, { code: string }> = {}) {
  const t = (name: string) => (tables[name] ??= []);
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: 'select' | 'update' = 'select';
    let patch: Row = {};
    const matching = () => t(table).filter(r => filters.every(f => f(r)));
    const result = () => {
      if (fail[table]) return { data: null, error: fail[table] };
      if (op === 'update') {
        const hit = matching();
        hit.forEach(r => Object.assign(r, patch));
        return { data: hit, error: null };
      }
      return { data: matching(), error: null };
    };
    const b: any = {
      select() { return b; },
      eq(col: string, val: any) { filters.push(r => r[col] === val); return b; },
      in(col: string, vals: any[]) { filters.push(r => vals.includes(r[col])); return b; },
      maybeSingle() { const r = result(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }); },
      update(p: Row) { op = 'update'; patch = p; return b; },
      insert(row: Row) {
        if (fail[table]) return Promise.resolve({ error: fail[table] });
        t(table).push(...(Array.isArray(row) ? row : [row]));
        return Promise.resolve({ error: null });
      },
      upsert(rows: Row[]) {
        if (fail[table]) return Promise.resolve({ error: fail[table] });
        for (const row of rows) {
          const dup = t(table).some(r => r.plan_id === row.plan_id && r.item_ref === row.item_ref && r.user_id === row.user_id);
          if (!dup) t(table).push(row);
        }
        return Promise.resolve({ error: null });
      },
      then(resolve: any, reject: any) { return Promise.resolve(result()).then(resolve, reject); },
    };
    return b;
  };
  return { from } as any;
}

function soloTrip() {
  return {
    group_members: [{ group_id: 'g1', user_id: 'u-solo', role: 'admin' }],
    plans: [
      { id: 'p1', group_id: 'g1', solo_mode: true },
      { id: 'p2', group_id: 'g1', solo_mode: true },
      { id: 'px', group_id: 'g-other', solo_mode: true },
    ],
    bookings: [
      { id: 'hotel', plan_id: 'p1', status: 'confirmed' },
      { id: 'dinner', plan_id: 'p1', status: 'failed' },
      { id: 'elsewhere', plan_id: 'px', status: 'confirmed' },
    ],
    item_optouts: [] as Row[],
  };
}

test('a second person joining ends solo mode on that group’s plans, and only those', async () => {
  const tables = soloTrip();
  const db = makeDb(tables);
  tables.group_members.push({ group_id: 'g1', user_id: 'u-new', role: 'member' });
  const { soloEnded } = await afterJoining(db, 'g1');
  assert.equal(soloEnded, 2);
  assert.deepEqual(tables.plans.map(p => [p.id, p.solo_mode]), [['p1', false], ['p2', false], ['px', true]]);
});

test('a group still of one stays solo', async () => {
  const tables = soloTrip();
  const { soloEnded } = await afterJoining(makeDb(tables), 'g1');
  assert.equal(soloEnded, 0);
  assert.ok(tables.plans.every(p => p.solo_mode === true));
});

test('a count that could not be read changes nothing', async () => {
  const tables = soloTrip();
  const { soloEnded } = await afterJoining(makeDb(tables, { group_members: { code: 'XX000' } }), 'g1');
  assert.equal(soloEnded, 0);
  assert.ok(tables.plans.every(p => p.solo_mode === true));
});

test('before joining, the newcomer is kept off what this group already holds', async () => {
  const tables = soloTrip();
  const out = await beforeJoining(makeDb(tables), 'g1', 'u-new');
  assert.deepEqual(out, { ok: true, satOut: 1 });
  assert.deepEqual(tables.item_optouts, [{ plan_id: 'p1', item_ref: 'hotel', user_id: 'u-new' }],
    'not the failed dinner, and nothing from somebody else’s group');
});

test('a proposal is left for the newcomer to be priced onto, until somebody pays', async () => {
  const tables = soloTrip();
  tables.bookings.push({ id: 'flight', plan_id: 'p2', status: 'awaiting_approval' });
  tables.bookings.push({ id: 'room', plan_id: 'p2', status: 'quoted' });
  const out = await beforeJoining(makeDb(tables), 'g1', 'u-new');
  assert.deepEqual(out, { ok: true, satOut: 1 });
  assert.deepEqual(tables.item_optouts.map(r => r.item_ref), ['hotel'], 'only the confirmed room');

  const paidFor: Record<string, Row[]> = { ...soloTrip(), contributions: [{ plan_id: 'p2', status: 'succeeded' }] };
  paidFor.bookings.push({ id: 'flight', plan_id: 'p2', status: 'awaiting_approval' });
  await beforeJoining(makeDb(paidFor), 'g1', 'u-new');
  assert.deepEqual(paidFor.item_optouts.map(r => r.item_ref).sort(), ['flight', 'hotel'],
    'paid into: the total they paid against does not move');

  const refunded: Record<string, Row[]> = { ...soloTrip(), contributions: [{ plan_id: 'p2', status: 'refunded' }] };
  refunded.bookings.push({ id: 'flight', plan_id: 'p2', status: 'awaiting_approval' });
  await beforeJoining(makeDb(refunded), 'g1', 'u-new');
  assert.deepEqual(refunded.item_optouts.map(r => r.item_ref), ['hotel'], 'only money that landed counts as paid');
});

test('payments that cannot be read stop the join rather than guessing', async () => {
  const out = await beforeJoining(makeDb(soloTrip(), { contributions: { code: 'XX000' } }), 'g1', 'u-new');
  assert.equal(out.ok, false);
});

test('if that cannot be written, the join is refused rather than re-pricing a paid booking', async () => {
  const out = await beforeJoining(makeDb(soloTrip(), { item_optouts: { code: '42501' } }), 'g1', 'u-new');
  assert.equal(out.ok, false);
});

test('a deployment without the opt-out table still lets people join', async () => {
  const out = await beforeJoining(makeDb(soloTrip(), { item_optouts: { code: 'PGRST205' } }), 'g1', 'u-new');
  assert.deepEqual(out, { ok: true, satOut: 0 });
});

test('claiming an invite to a solo trip makes it a group trip without touching the booking', async () => {
  const tables: Record<string, Row[]> = {
    ...soloTrip(),
    group_invites: [{
      id: 'i1', group_id: 'g1', email: 'bob@example.com', role: 'member', status: 'pending',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }],
    analytics_events: [],
  };
  const res = await claimInvitesFor(makeDb(tables), 'u-bob', 'bob@example.com');
  assert.deepEqual(res.joined, ['g1']);
  assert.equal(tables.group_members.length, 2);
  assert.ok(tables.plans.filter(p => p.group_id === 'g1').every(p => p.solo_mode === false));
  assert.deepEqual(tables.item_optouts.map(r => [r.item_ref, r.user_id]), [['hotel', 'u-bob']]);
});

test('a plan still flagged solo asks whoever has since joined', async () => {
  const tables: Record<string, Row[]> = {
    group_members: [
      { group_id: 'g1', user_id: 'u-solo', users: { id: 'u-solo', name: 'Ana Ruiz' } },
      { group_id: 'g1', user_id: 'u-new', users: { id: 'u-new', name: 'Bob Lee' } },
    ],
    plan_preferences: [{ plan_id: 'p1', user_id: 'u-solo', submitted_at: '2026-09-20T10:00:00Z' }],
  };
  // The flag is stale on purpose: the write that clears it is not what the
  // rule rests on.
  const r = await planReadiness(makeDb(tables), 'p1', 'g1', true);
  assert.equal(r.solo, false);
  assert.equal(r.allReady, false);
  assert.deepEqual(r.waitingOn, ['Bob']);

  tables.group_members.pop();
  const alone = await planReadiness(makeDb(tables), 'p1', 'g1', true);
  assert.equal(alone.solo, true, 'still one person, still nobody to wait for');
  assert.equal(alone.allReady, true);
});

test('an invite that cannot be claimed cleanly stays pending for next time', async () => {
  const tables: Record<string, Row[]> = {
    ...soloTrip(),
    group_invites: [{
      id: 'i1', group_id: 'g1', email: 'bob@example.com', role: 'member', status: 'pending',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }],
  };
  const res = await claimInvitesFor(makeDb(tables, { bookings: { code: 'XX000' } }), 'u-bob', 'bob@example.com');
  assert.deepEqual(res.joined, []);
  assert.equal(tables.group_members.length, 1, 'not let in on a share of somebody else’s booking');
  assert.equal(tables.group_invites[0].status, 'pending');
  assert.ok(tables.plans.every(p => p.solo_mode === true));
});
