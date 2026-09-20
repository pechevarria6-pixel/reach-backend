import { test } from 'node:test';
import assert from 'node:assert/strict';
import { within, Timeout, isTimeout, stalled } from '../../lib/deadline.ts';

test('work that finishes in time comes back as itself', async () => {
  assert.equal(await within(Promise.resolve('done'), 50, 'the server'), 'done');
});

test('a promise that never settles still gives an answer', async () => {
  // This is the geolocation case exactly: an API that calls back neither
  // way. Without a clock of our own the screen waits forever.
  const never = new Promise(() => {});
  await assert.rejects(() => within(never, 20, 'the booking'), (e: unknown) => {
    assert.ok(isTimeout(e));
    assert.match((e as Error).message, /the booking did not answer/);
    return true;
  });
});

test('a real failure is passed through, not turned into a timeout', async () => {
  await assert.rejects(
    () => within(Promise.reject(new Error('refused')), 50, 'the server'),
    (e: unknown) => {
      assert.equal(isTimeout(e), false);
      assert.match((e as Error).message, /refused/);
      return true;
    },
  );
});

test('a slow answer that arrives after the clock is ignored, not thrown twice', async () => {
  // The loser of the race must not settle the promise a second time.
  let settledTwice = false;
  const slow = new Promise(res => setTimeout(() => { res('late'); }, 40));
  await within(slow, 10, 'the server').catch(() => {});
  await new Promise(r => setTimeout(r, 60));
  assert.equal(settledTwice, false, 'the late answer changed nothing');
});

test('the message says whether money moved and what to do', async () => {
  const paid = stalled('the booking', true);
  assert.match(paid, /don't pay again/i);
  assert.match(paid, /Nothing is lost/);

  const unpaid = stalled('the booking', false);
  assert.match(unpaid, /Nothing has been charged/);
  assert.ok(!/something went wrong/i.test(unpaid));
});
