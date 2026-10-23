import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

// public/sw.js, run in a sandbox with a fake network and Cache API. It may
// keep the trip wallet for when there is no signal and must keep nothing
// else — a stale copy of anything else is a wrong answer with no stamp on it.

const SRC = readFileSync(resolve(import.meta.dirname, '../../public/sw.js'), 'utf8');
const ORIGIN = 'https://alcanzar.io';

function load(network: (url: string) => Promise<Response>) {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const store = new Map<string, Map<string, Response>>();
  const caches = {
    async open(name: string) {
      if (!store.has(name)) store.set(name, new Map());
      const c = store.get(name)!;
      return {
        async put(req: Request, res: Response) { c.set(req.url, res); },
        async match(req: Request) { return c.get(req.url)?.clone(); },
        async delete(req: Request) { return c.delete(req.url); },
      };
    },
    async keys() { return [...store.keys()]; },
    async delete(name: string) { return store.delete(name); },
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener(type: string, fn: (e: unknown) => void) { (listeners[type] ||= []).push(fn); },
    skipWaiting() {},
    clients: { claim: async () => {} },
    registration: { showNotification: async () => {} },
  };
  vm.runInNewContext(SRC, {
    self, caches, URL, Response, Request, JSON,
    fetch: (req: Request) => network(req.url),
    clients: { matchAll: async () => [], openWindow: async () => {} },
  });

  /** Dispatch a fetch: the response the worker answers with, or null when it leaves it alone. */
  async function request(path: string, method = 'GET'): Promise<Response | null> {
    let answer: Promise<Response> | null = null;
    const event = { request: new Request(ORIGIN + path, { method }), respondWith(p: Promise<Response>) { answer = p; } };
    for (const fn of listeners.fetch ?? []) fn(event);
    return answer ? await answer : null;
  }
  return { request, store, listeners };
}

const walletBody = { planId: 'p1', title: 'Lisbon', asOf: '2026-11-02T09:00:00.000Z', entries: [{ bookingId: 'b1' }] };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

test('nothing but the wallet is touched', async () => {
  const sw = load(async () => json({ ok: true }));
  for (const path of ['/home', '/api/plans/p1', '/api/plans/p1/itinerary', '/api/plans/p1/itinerary/ics', '/api/bookings', '/api/plans/p1/wallet/extra', '/_next/static/chunk.js']) {
    assert.equal(await sw.request(path), null, `${path} must pass straight through`);
  }
  assert.equal(await sw.request('/api/plans/p1/wallet', 'POST'), null);
  assert.equal([...sw.store.values()].reduce((n, c) => n + c.size, 0), 0, 'nothing kept');
});

test('online: the network answers, and a copy is kept', async () => {
  const sw = load(async () => json(walletBody));
  const res = await sw.request('/api/plans/p1/wallet');
  assert.deepEqual(await res!.json(), walletBody);
  assert.equal(sw.store.get('reach-wallet-v1')?.size, 1);
});

test('offline: the kept copy, marked offline, with the time it was built', async () => {
  let up = true;
  const sw = load(async () => { if (!up) throw new TypeError('Failed to fetch'); return json(walletBody); });
  await sw.request('/api/plans/p1/wallet');
  up = false;
  const res = await sw.request('/api/plans/p1/wallet');
  assert.equal(res!.headers.get('X-Reach-Offline'), '1');
  const body = await res!.json();
  assert.equal(body.offline, true);
  assert.equal(body.asOf, walletBody.asOf, 'stamped "as of" the server time, not now');
  // Another plan was never fetched: offline it is an error, not someone else's wallet.
  await assert.rejects(sw.request('/api/plans/p2/wallet'));
});

test('a refusal does not replace the kept copy; losing access removes it', async () => {
  let status = 200;
  const sw = load(async () => (status === 200 ? json(walletBody) : json({ error: 'x' }, status)));
  await sw.request('/api/plans/p1/wallet');
  status = 503;
  await sw.request('/api/plans/p1/wallet');
  assert.equal(sw.store.get('reach-wallet-v1')?.size, 1, 'a 503 keeps the numbers');
  status = 403;
  await sw.request('/api/plans/p1/wallet');
  assert.equal(sw.store.get('reach-wallet-v1')?.size, 0, 'no longer on the trip: forgotten');
});
