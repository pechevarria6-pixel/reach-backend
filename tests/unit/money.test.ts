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
