// Reach's service worker. It does one thing: show a notification Reach
// sends, and open the right screen when it is tapped. No caching — a stale
// copy of a trip is worse than a slow one.
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
