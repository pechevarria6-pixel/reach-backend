// Discover asks Ticketmaster and Yelp alongside the map. None of those
// fetches had a limit, so one provider hanging held /api/nearby to its 30s
// maxDuration and the whole screen was a 504 — the venues already read from
// our own table thrown away with it. A provider that does not answer is one
// source that did not answer.
// Run with: npm run test:unit
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ticketmaster } from '../../lib/discovery/ticketmaster.ts';
import { yelpEvents, yelpPlaces } from '../../lib/discovery/yelp.ts';

const realFetch = globalThis.fetch;
const env = { tm: process.env.TICKETMASTER_API_KEY, yelp: process.env.YELP_API_KEY };
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.TICKETMASTER_API_KEY = env.tm;
  process.env.YELP_API_KEY = env.yelp;
  if (env.tm === undefined) delete process.env.TICKETMASTER_API_KEY;
  if (env.yelp === undefined) delete process.env.YELP_API_KEY;
});

/** A provider that accepts the connection and never answers — unless the caller gives up. */
function hangingFetch() {
  globalThis.fetch = ((_url: string, init: RequestInit = {}) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')), { once: true });
  })) as typeof fetch;
}

const SEEKER = { lat: 35.18, lng: -79.39, city: 'Southern Pines', interests: ['live music'], browse: ['places to eat'], avoid: [] } as any;

test('a Ticketmaster that never answers is a source that failed, not a screen that times out', { timeout: 3000 }, async () => {
  process.env.TICKETMASTER_API_KEY = 'test';
  hangingFetch();
  const started = Date.now();
  const r = await ticketmaster(SEEKER, { timeoutMs: 50 });
  assert.equal(r.status, 'error');
  assert.deepEqual(r.findings, []);
  assert.ok(Date.now() - started < 1000);
});

test('so is a Yelp that never answers, for events and for places', { timeout: 3000 }, async () => {
  process.env.YELP_API_KEY = 'test';
  hangingFetch();
  const [events, places] = await Promise.all([yelpEvents(SEEKER, { timeoutMs: 50 }), yelpPlaces(SEEKER, { timeoutMs: 50 })]);
  assert.equal(events.status, 'error');
  assert.equal(places.status, 'error');
});
