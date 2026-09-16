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
