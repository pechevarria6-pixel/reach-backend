// Reach's service worker. It shows a notification Reach sends, opens the
// right screen when it is tapped, and keeps ONE thing for when there is no
// signal: the trip wallet (GET /api/plans/<id>/wallet) — the confirmation
// numbers somebody needs at a desk in an airport with no Wi-Fi.
//
// And one page: /offline.html, kept at install, shown only when a page
// cannot be reached at all (UX F19-02 — a cold open with no signal was a
// blank white page, so the wallet kept for the airport desk could not be
// reached). It holds nothing personal itself; it reads the wallet copies
// below and lists them "as of" when each was fetched. The app's own pages
// are never cached: a signed-in page is somebody's, and a stale copy of a
// trip is worse than a slow one. Every other request passes straight through.
//
// The wallet is network first: the cached copy is used only when the
// network cannot be reached, and it goes back marked `offline: true` with
// the `asOf` time the server stamped on it, so the screen says
// "as of <time>" and never passes an old copy off as the current one.
// A sign-out clears it (lib/push-client.ts clearOfflineWallet).
const WALLET_CACHE = 'reach-wallet-v1';
const WALLET_PATH = /^\/api\/plans\/[^/]+\/wallet$/;
const SHELL_CACHE = 'reach-shell-v1';
const OFFLINE_PAGE = '/offline.html';
const SHELL = [OFFLINE_PAGE, '/logo-mark.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // A failed precache must not stop the worker installing: the wallet and
    // notifications still work without the offline page.
    await cache.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))).catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  // Drop any cache that is not ours — including older versions of either.
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== WALLET_CACHE && n !== SHELL_CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

function isWallet(request) {
  if (request.method !== 'GET') return false;
  let url;
  try { url = new URL(request.url); } catch (e) { return false; }
  return url.origin === self.location.origin && WALLET_PATH.test(url.pathname);
}

async function wallet(request) {
  const cache = await caches.open(WALLET_CACHE);
  try {
    const res = await fetch(request);
    // Only a real answer replaces the kept copy: a 401 after the session
    // lapsed, or a 503, must not wipe the numbers somebody is about to need.
    if (res.ok) await cache.put(request, res.clone()).catch(() => {});
    else if (res.status === 403 || res.status === 404) await cache.delete(request).catch(() => {});
    return res;
  } catch (e) {
    const kept = await cache.match(request);
    if (!kept) throw e;
    const body = await kept.json().catch(() => null);
    if (!body) throw e;
    return new Response(JSON.stringify({ ...body, offline: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-Reach-Offline': '1' },
    });
  }
}

function isPage(request) {
  if (request.mode !== 'navigate' || request.method !== 'GET') return false;
  try { return new URL(request.url).origin === self.location.origin; } catch (e) { return false; }
}

// The network, always. Only when it cannot be reached at all — not a 500,
// not a sign-in redirect, which are real answers — is the offline page shown.
async function page(request) {
  try {
    return await fetch(request);
  } catch (e) {
    const kept = await caches.match(OFFLINE_PAGE, { cacheName: SHELL_CACHE });
    if (kept) return kept;
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  if (isWallet(event.request)) { event.respondWith(wallet(event.request)); return; }
  if (isPage(event.request)) { event.respondWith(page(event.request)); return; }
  // Anything else: not touched. No respondWith, so the browser does exactly
  // what it would with no service worker at all.
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'clear-wallet') {
    event.waitUntil(caches.delete(WALLET_CACHE));
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Reach', body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Reach', {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/home' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/home';
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { await c.navigate(url).catch(() => {}); return c.focus(); }
    }
    return clients.openWindow(url);
  })());
});
