// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evenSplit, shareFor, settleUp } from '../../lib/money.ts';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

test('evenSplit always sums to the total', () => {
  const cases: [number, number][] = [
    [10000, 3], [1, 4], [99999, 7], [0, 5], [12345, 6], [2, 3], [7, 7],
  ];
  for (const [total, heads] of cases) {
    assert.equal(sum(evenSplit(total, heads)), total, `${total} across ${heads}`);
  }
});

test('evenSplit shares differ by at most one cent', () => {
  const shares = evenSplit(10000, 3);
  assert.equal(Math.max(...shares) - Math.min(...shares), 1);
  assert.deepEqual(shares, [3334, 3333, 3333]);
});

test('evenSplit tolerates nonsense input instead of throwing', () => {
  assert.deepEqual(evenSplit(0, 0), [0]);
  assert.deepEqual(evenSplit(-500, 2), [0, 0]);
  assert.equal(sum(evenSplit(100.6, 3)), 101); // rounded to whole cents first
});

test('shareFor is zero for someone outside the group', () => {
  const members = ['a', 'b', 'c'];
  assert.equal(shareFor(10000, members, 'zz'), 0);
  assert.equal(sum(members.map(m => shareFor(10000, members, m))), 10000);
});

test('shareFor is stable for a given member ordering', () => {
  const members = ['a', 'b', 'c'];
  const first = members.map(m => shareFor(10000, members, m));
  const second = members.map(m => shareFor(10000, members, m));
  assert.deepEqual(first, second);
});

test('settleUp clears every balance', () => {
  const net = { a: 15832 + 834, b: -834, c: -15832 };
  const transfers = settleUp(net);
  const applied = { ...net };
  for (const t of transfers) {
    applied[t.from as keyof typeof applied] += t.amountCents;
    applied[t.to as keyof typeof applied] -= t.amountCents;
  }
  assert.ok(Object.values(applied).every(v => v === 0), JSON.stringify(applied));
});

test('settleUp never asks anyone to pay themselves', () => {
  const transfers = settleUp({ a: 500, b: -500 });
  assert.ok(transfers.every(t => t.from !== t.to));
  assert.deepEqual(transfers, [{ from: 'b', to: 'a', amountCents: 500 }]);
});

test('settleUp on an already-square ledger does nothing', () => {
  assert.deepEqual(settleUp({ a: 0, b: 0 }), []);
});

test('a whole trip nets to zero end to end', () => {
  // a books a $100 hotel for everyone; b buys a $49.99 dinner for b and c;
  // a and b have already contributed $200 and $100 toward the trip.
  const members = ['a', 'b', 'c'];
  const net: Record<string, number> = { a: 0, b: 0, c: 0 };
  const add = (id: string, c: number) => { net[id] += c; };

  add('a', 10000);
  evenSplit(10000, 3).forEach((s, i) => add(members[i], -s));
  add('b', 4999);
  evenSplit(4999, 2).forEach((s, i) => add(['b', 'c'][i], -s));

  const contributions = [{ userId: 'a', cents: 20000 }, { userId: 'b', cents: 10000 }];
  const target = sum(contributions.map(c => c.cents));
  evenSplit(target, members.length).forEach((s, i) => add(members[i], -s));
  for (const c of contributions) add(c.userId, c.cents);

  assert.equal(sum(Object.values(net)), 0);

  const applied = { ...net };
  for (const t of settleUp(net)) {
    applied[t.from] += t.amountCents;
    applied[t.to] -= t.amountCents;
  }
  assert.ok(Object.values(applied).every(v => v === 0), JSON.stringify(applied));
});

// ── Sitting things out ───────────────────────────────────────────────────
import {
  sharesWithSkips, planShares, apportion, canSkip, shareFor as evenShareFor,
} from '../../lib/money.ts';

test('one of three sitting out a $300 dinner moves their share to the other two', () => {
  const shares = sharesWithSkips([{ ref: 'dinner', priceCents: 30000 }], ['ana', 'ben', 'cam'], [{ ref: 'dinner', userId: 'cam' }]);
  assert.deepEqual(shares, { ana: 15000, ben: 15000, cam: 0 });
});

test('shares always add up to exactly what the bookings cost', () => {
  const items = [{ ref: 'a', priceCents: 10001 }, { ref: 'b', priceCents: 333 }, { ref: 'c', priceCents: 50000 }];
  const members = ['m1', 'm2', 'm3', 'm4'];
  const skips = [{ ref: 'a', userId: 'm2' }, { ref: 'c', userId: 'm1' }, { ref: 'c', userId: 'm4' }];
  const shares = sharesWithSkips(items, members, skips);
  assert.equal(Object.values(shares).reduce((s, c) => s + c, 0), 60334);
});

test('with nobody sitting anything out, shares are exactly the split people already paid under', () => {
  // Two $1 bookings among three people: split item by item this would be
  // 68/66/66, but anyone who paid under the old whole-trip split paid 67/67/66.
  const members = ['ana', 'ben', 'cam'];
  const shares = planShares([{ id: 'x', price_cents: 100 }, { id: 'y', price_cents: 100 }], 0, members);
  for (const id of members) assert.equal(shares[id], evenShareFor(200, members, id));
});

test('a booking everybody sat out is still paid for, by everybody', () => {
  const members = ['ana', 'ben'];
  const shares = sharesWithSkips([{ ref: 'show', priceCents: 9000 }], members,
    [{ ref: 'show', userId: 'ana' }, { ref: 'show', userId: 'ben' }]);
  assert.deepEqual(shares, { ana: 4500, ben: 4500 });
});

test('before anything is priced, a share is an even split of the budget', () => {
  assert.deepEqual(planShares([], 30000, ['ana', 'ben', 'cam']), { ana: 10000, ben: 10000, cam: 10000 });
});

test('checkout charges exactly the share the plan screen shows', () => {
  // The funding route and the participation route both call planShares with
  // the plan's bookings, members and skips. Same inputs, same number.
  const bookings = [{ id: 'hotel', price_cents: 90000 }, { id: 'dinner', price_cents: 30000 }];
  const members = ['ana', 'ben', 'cam'];
  const skips = [{ ref: 'dinner', userId: 'cam' }];
  const charged = planShares(bookings, 0, members, skips);
  const shown = sharesWithSkips(bookings.map(b => ({ ref: b.id, priceCents: b.price_cents })), members, skips);
  assert.deepEqual(charged, shown);
  assert.equal(charged.cam, 30000);
  assert.equal(charged.ana + charged.ben + charged.cam, 120000);
});

test('only activities, events and restaurants can be sat out', () => {
  for (const v of ['activity', 'event', 'restaurant']) assert.equal(canSkip(v), true);
  for (const v of ['flight', 'hotel', '', null, undefined]) assert.equal(canSkip(v), false);
});

test('apportioning collected money adds up exactly and follows the shares', () => {
  const out = apportion(10000, [15000, 15000, 0]);
  assert.deepEqual(out, [5000, 5000, 0]);
  const odd = apportion(1001, [1, 1, 1]);
  assert.equal(odd.reduce((s, c) => s + c, 0), 1001);
  assert.deepEqual(apportion(300, [0, 0, 0]), [100, 100, 100]);
  assert.deepEqual(apportion(500, []), []);
});

// ── Settling up ─────────────────────────────────────────────────────────
import {
  applySettlements, settleLines, viewerLines, payeesOf, checkSettlement,
  settlementMoveRefused, settlementKey, type Settlement,
} from '../../lib/money.ts';

const paid = (from: string, to: string, cents: number, id = `${from}${to}${cents}`): Settlement =>
  ({ id, from_user_id: from, to_user_id: to, amount_cents: cents, status: 'paid', method: 'venmo' });
const pending = (from: string, to: string, cents: number, id = `p-${from}${to}`): Settlement =>
  ({ id, from_user_id: from, to_user_id: to, amount_cents: cents, status: 'pending', method: 'venmo', created_at: '2026-09-25T12:00:00Z' });

test('a settlement marked paid feeds back into the balances and closes the line', () => {
  const net = { sam: 4200, alex: -4200 };
  assert.deepEqual(settleLines(net, []).map(l => [l.from, l.to, l.amountCents]), [['alex', 'sam', 4200]]);
  const after = applySettlements(net, [paid('alex', 'sam', 4200)]);
  assert.deepEqual(after, { sam: 0, alex: 0 });
  assert.deepEqual(settleLines(net, [paid('alex', 'sam', 4200)]), []);
});

test('a part payment leaves the rest owed, on the same pair', () => {
  const lines = settleLines({ sam: 4200, alex: -4200 }, [paid('alex', 'sam', 1200)]);
  assert.deepEqual(lines.map(l => [l.from, l.to, l.amountCents]), [['alex', 'sam', 3000]]);
});

test('pending and cancelled settlements move nothing', () => {
  const net = { sam: 4200, alex: -4200 };
  const cancelled = { ...paid('alex', 'sam', 4200), status: 'cancelled' };
  assert.deepEqual(applySettlements(net, [pending('alex', 'sam', 4200), cancelled]), net);
  const [line] = settleLines(net, [pending('alex', 'sam', 4200)]);
  assert.equal(line.amountCents, 4200, 'a "Sent on Venmo?" is not money arrived');
  assert.equal(line.pending?.id, 'p-alexsam', 'both sides see the pending claim on the line');
});

test('a pending claim whose line has gone is still shown, so the payee can answer it', () => {
  const lines = settleLines({ sam: 0, alex: 0 }, [pending('alex', 'sam', 4200)]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].amountCents, 0);
  assert.equal(lines[0].pending?.amountCents, 4200);
});

test('a person only gets the handle of someone they owe', () => {
  // Alex and Jo both owe Sam. Everybody has handles.
  const net = { sam: 6000, alex: -4200, jo: -1800 };
  const lines = settleLines(net, []);
  const handles = {
    sam: { venmo: 'sam-lee-1', cashtag: 'samlee', zelle: 'sam@example.com' },
    alex: { venmo: 'alex-p-22', cashtag: 'alexp', zelle: 'alex@example.com' },
    jo: { venmo: 'jo-jo-333', cashtag: 'jojo', zelle: 'jo@example.com' },
  };

  const alex = viewerLines('alex', lines, handles, 'Cabo trip');
  assert.deepEqual(alex.map(l => [l.direction, l.with, l.amountCents]), [['you_owe', 'sam', 4200]]);
  assert.equal(alex[0].pay?.venmo?.app, 'venmo://paycharge?txn=pay&recipients=sam-lee-1&amount=42.00&note=Cabo%20trip');
  assert.equal(alex[0].pay?.cashApp, 'https://cash.app/$samlee/42.00');
  assert.equal(alex[0].pay?.zelle?.value, 'sam@example.com');
  // Nothing of Jo's reaches Alex: Jo's line is not Alex's, and Alex does not owe Jo.
  assert.doesNotMatch(JSON.stringify(alex), /jo-jo|jojo|jo@example/);

  // Sam is owed by both and pays nobody: no pay links, and none of their handles.
  const sam = viewerLines('sam', lines, handles, 'Cabo trip');
  assert.deepEqual(sam.map(l => [l.direction, l.with]), [['owed_to_you', 'alex'], ['owed_to_you', 'jo']]);
  assert.ok(sam.every(l => l.pay === null));
  assert.doesNotMatch(JSON.stringify(sam), /alex-p|alexp|alex@example|jo-jo|jojo|jo@example/);

  assert.deepEqual(payeesOf('sam', lines), []);
  assert.deepEqual(payeesOf('alex', lines), ['sam']);
});

test('a payee with no handle gives a line with no links, not a broken one', () => {
  const lines = settleLines({ sam: 4200, alex: -4200 }, []);
  const [line] = viewerLines('alex', lines, {}, 'Cabo trip');
  assert.equal(line.pay, null);
  const [junk] = viewerLines('alex', lines, { sam: { venmo: '@x', cashtag: '', zelle: 'nope' } }, 'Cabo trip');
  assert.deepEqual(junk.pay, { venmo: null, cashApp: null, zelle: null });
});

test('nothing is recorded for more than is still owed, so a stale second tap is refused', () => {
  const net = { sam: 4200, alex: -4200 };
  assert.equal(checkSettlement(settleLines(net, []), 'alex', 'sam', 4200), null);
  assert.equal(checkSettlement(settleLines(net, []), 'alex', 'sam', 1000), null, 'a part payment is fine');
  assert.deepEqual(checkSettlement(settleLines(net, []), 'alex', 'sam', 5000), { reason: 'more_than_owed', owedCents: 4200 });
  assert.deepEqual(checkSettlement(settleLines(net, []), 'sam', 'alex', 100), { reason: 'nothing_owed', owedCents: 0 });
  // Sam marked it received; Alex's screen still shows the line and Alex taps "Mark as paid".
  const after = settleLines(net, [paid('alex', 'sam', 4200)]);
  assert.deepEqual(checkSettlement(after, 'alex', 'sam', 4200), { reason: 'nothing_owed', owedCents: 0 });
});

test('either side closes a pending one; only the payee can undo a paid one', () => {
  const p = { from_user_id: 'alex', to_user_id: 'sam', status: 'pending' };
  assert.equal(settlementMoveRefused(p, 'alex', 'paid'), null);
  assert.equal(settlementMoveRefused(p, 'sam', 'paid'), null);
  assert.equal(settlementMoveRefused(p, 'alex', 'cancelled'), null);
  assert.equal(settlementMoveRefused(p, 'jo', 'paid'), 'not_yours');
  const done = { ...p, status: 'paid' };
  assert.equal(settlementMoveRefused(done, 'alex', 'paid'), null, 'a repeat is not a change');
  assert.equal(settlementMoveRefused(done, 'alex', 'cancelled'), 'only_payee_can_undo');
  assert.equal(settlementMoveRefused(done, 'sam', 'cancelled'), null);
  assert.equal(settlementMoveRefused({ ...p, status: 'cancelled' }, 'alex', 'paid'), 'closed');
});

test('an idempotency key is scoped to the plan and the person, and junk is refused', () => {
  assert.equal(settlementKey('plan1', 'alex', 'line-abc-123'), 'settle:plan1:alex:line-abc-123');
  assert.notEqual(settlementKey('plan1', 'alex', 'line-abc-123'), settlementKey('plan1', 'sam', 'line-abc-123'));
  assert.notEqual(settlementKey('plan1', 'alex', 'line-abc-123'), settlementKey('plan2', 'alex', 'line-abc-123'));
  for (const bad of [undefined, null, '', 'short', 42, 'has spaces in it', 'x'.repeat(101)]) {
    assert.equal(settlementKey('plan1', 'alex', bad), null, String(bad));
  }
});
