// Run with: npm run test:unit
// UX F19-02 (S1): a cold open with no signal was a blank white page, and the
// trip wallet the worker was meant to keep for "a desk in an airport with no
// Wi-Fi" was never fetched by anything, so never kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { walletsToKeep, OFFLINE_MAX_TRIPS } from '../../lib/offline-trips.ts';

const SW = readFileSync('public/sw.js', 'utf8');
const PAGE = readFileSync('public/offline.html', 'utf8');
const APP = readFileSync('components/reach-app.jsx', 'utf8');
const MW = readFileSync('middleware.ts', 'utf8');

const plan = (id: string, startDate: string | null, endDate: string | null = startDate, status = 'confirmed') =>
  ({ id, startDate, endDate, status });

test('keeps the trips about to happen or under way, soonest first', () => {
  const groups = [
    { plans: [plan('later', '2026-12-20'), plan('soon', '2026-11-25', '2026-11-28'), plan('now', '2026-11-20', '2026-11-24')] },
    { plans: [plan('over', '2026-11-01', '2026-11-05'), plan('far', '2027-03-01'), plan('undated', null)] },
    { plans: [plan('off', '2026-11-26', '2026-11-27', 'cancelled'), plan('p1763000000000', '2026-11-23'), plan('soon', '2026-11-25')] },
  ];
  assert.deepEqual(walletsToKeep(groups, '2026-11-22'), ['now', 'soon', 'later']);
});

test('the last day of a trip still counts; the day after does not', () => {
  const g = [{ plans: [plan('t', '2026-11-18', '2026-11-22')] }];
  assert.deepEqual(walletsToKeep(g, '2026-11-22'), ['t']);
  assert.deepEqual(walletsToKeep(g, '2026-11-23'), []);
});

test('capped, and nothing on a bad date or no groups', () => {
  const many = [{ plans: Array.from({ length: 9 }, (_, i) => plan(`t${i}`, `2026-11-2${i}`)) }];
  assert.equal(walletsToKeep(many, '2026-11-20').length, OFFLINE_MAX_TRIPS);
  assert.deepEqual(walletsToKeep(many, 'not a date'), []);
  assert.deepEqual(walletsToKeep(null, '2026-11-20'), []);
});

test('the worker shows the offline page only when the network cannot be reached', () => {
  assert.match(SW, /const OFFLINE_PAGE = '\/offline\.html';/);
  assert.match(SW, /cache\.addAll\(SHELL/, 'precached at install');
  const page = SW.slice(SW.indexOf('async function page('), SW.indexOf("self.addEventListener('fetch'"));
  assert.match(page, /return await fetch\(request\);\s*\} catch \(e\) \{/, 'network first; a 500 or redirect is a real answer');
  assert.match(SW, /request\.mode !== 'navigate'/, 'pages only, never API or assets');
  assert.match(SW, /n !== WALLET_CACHE && n !== SHELL_CACHE/, 'activate keeps both caches');
  assert.equal(/cache\.put\(request/.test(page), false, 'a signed-in page is never cached');
});

test('the offline page says what it is and how old it is, and writes no HTML from the cache', () => {
  assert.match(PAGE, /You're offline/);
  assert.match(PAGE, /Here's what you have saved\./);
  assert.match(PAGE, /may have changed since/);
  assert.match(PAGE, /caches\.open\('reach-wallet-v1'\)/);
  assert.match(PAGE, /not checked by Reach/, 'a typed-in number is labelled as one');
  assert.equal(/innerHTML/.test(PAGE), false);
  // Static files skip the sign-in middleware, or the fallback would be a redirect.
  assert.match(MW, /html\?\|css/);
});

test('the app registers the worker and fetches the wallets it keeps', () => {
  assert.match(APP, /const ids=walletsToKeep\(groups,today\(\)\);/);
  assert.match(APP, /await registerServiceWorker\(\)/);
  assert.match(APP, /fetch\(`\/api\/plans\/\$\{encodeURIComponent\(id\)\}\/wallet`\)/);
  assert.match(APP, /if\(groupsLoading\|\|groupsError\|\|typeof window==="undefined"\)return;/);
});
