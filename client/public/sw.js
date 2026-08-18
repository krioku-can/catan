/* Catan turn notifications — keep this file at the site root. */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'Catan', body: "It's your turn", tag: 'catan', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    try { data.body = event.data.text(); } catch { /* ignore */ }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Catan', {
      body: data.body || "It's your turn",
      icon: '/icon-192.png',
      badge: '/apple-touch-icon.png',
      tag: data.tag || 'catan',
      renotify: true,
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
