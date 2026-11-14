// Service worker: shows the phone/computer notifications the server sends, and opens the right page when tapped.
// It doesn't cache or intercept anything else.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'New Gamers Admin', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'New Gamers Admin', {
    body: d.body || '', icon: '/icon-192.png?v=2', badge: '/icon-192.png?v=2', dir: 'rtl', lang: 'he',
    tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if (new URL(c.url).origin === self.location.origin) { await c.focus(); c.postMessage({ ngOpen: url }); return; } }
    await self.clients.openWindow(url);
  })());
});
