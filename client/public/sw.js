/*
 * Service worker: shows "your move" notifications pushed by the game server, even when the game
 * isn't open, and brings the game back up when one is tapped.
 * (Plain JS in public/ so it is served unbundled at /sw.js, the scope it needs.)
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let msg;
  try {
    msg = event.data.json();
  } catch {
    msg = { title: 'Xiangqi', body: 'Something happened in your game.', tag: 'xiangqi', url: '/' };
  }

  event.waitUntil(
    (async () => {
      // Already looking at the game? The page updates itself, so no need to buzz.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (windows.some((w) => w.focused && w.visibilityState === 'visible')) return;

      await self.registration.showNotification(msg.title, {
        body: msg.body,
        tag: msg.tag,
        renotify: true,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        vibrate: [120, 60, 120],
        data: { url: msg.url },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin);
  const code = url.searchParams.get('resume');

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        if (code) existing.postMessage({ type: 'resume', code });
        return;
      }
      await self.clients.openWindow(url.href);
    })(),
  );
});
