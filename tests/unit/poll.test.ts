import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollWhileVisible } from '../../lib/poll.ts';

function fakeEnv(state = 'visible') {
  let tick: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const doc = { visibilityState: state, addEventListener: (_: string, f: () => void) => listeners.add(f), removeEventListener: (_: string, f: () => void) => listeners.delete(f) };
  const timers = { setInterval: (f: () => void) => { tick = f; return 1; }, clearInterval: () => { tick = null; } };
  return { doc, timers, tick: () => tick?.(), show: (s: string) => { doc.visibilityState = s; for (const f of listeners) f(); }, listening: () => listeners.size, running: () => !!tick };
}
const flush = () => new Promise(r => setImmediate(r));

test('polls on start and on each tick while visible', async () => {
  const env = fakeEnv(); let n = 0;
  pollWhileVisible(() => { n++; }, 1000, env); await flush();
  env.tick(); await flush(); env.tick(); await flush();
  assert.equal(n, 3);
});

test('a hidden tab does not poll, and catches up once when shown', async () => {
  const env = fakeEnv('hidden'); let n = 0;
  pollWhileVisible(() => { n++; }, 1000, env); await flush();
  env.tick(); env.tick(); await flush();
  assert.equal(n, 0);
  env.show('visible'); await flush();
  assert.equal(n, 1);
});

test('never two at once: a tick while the last load is out is skipped', async () => {
  const env = fakeEnv(); let n = 0; let release!: () => void;
  pollWhileVisible(() => { n++; return new Promise<void>(r => { release = r; }); }, 1000, env); await flush();
  env.tick(); env.tick(); await flush();
  assert.equal(n, 1);
  release(); await flush(); env.tick(); await flush();
  assert.equal(n, 2);
});

test('a load that says stop ends the poll for good', async () => {
  const env = fakeEnv(); let n = 0;
  pollWhileVisible(() => { n++; return 'stop'; }, 1000, env); await flush();
  env.tick(); env.show('visible'); await flush();
  assert.equal(n, 1);
  assert.equal(env.running(), false);
  assert.equal(env.listening(), 0);
});

test('the returned stop ends it too', async () => {
  const env = fakeEnv(); let n = 0;
  const stop = pollWhileVisible(() => { n++; }, 1000, env); await flush();
  stop(); env.tick(); await flush();
  assert.equal(n, 1);
});

test('the app polls only through pollWhileVisible — no bare setInterval reaching the server', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../components/reach-app.jsx', import.meta.url), 'utf8');
  const bare = [...src.matchAll(/setInterval\(([^;]*)/g)].map(m => m[1]);
  // The one allowed: the itinerary loader's progress clock, which never fetches.
  assert.deepEqual(bare.filter(b => !/setSecs\(s=>s\+1\)/.test(b)), []);
});
