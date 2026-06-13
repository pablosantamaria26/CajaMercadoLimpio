// Service Worker — Caja Mercado Limpio
const CACHE_NAME = 'caja-ml-v25-optimistic-ui';

const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './pablo.html',
  './manifest-pablo.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(r => r || fetch(event.request))
  );
});

// ── PUSH NOTIFICATIONS ──────────────────────────────────────────────
// Para activar push desde GAS necesitás:
//   1. Generar claves VAPID: npx web-push generate-vapid-keys
//   2. Guardar la suscripción del usuario en un endpoint (ej: Cloudflare Worker)
//   3. Desde GAS, llamar ese endpoint con el payload cuando llega una rendición
//
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) {}

  const title   = data.title   || '🏪 Mercado Limpio';
  const body    = data.body    || 'Nueva notificación';
  const options = {
    body,
    icon:    data.icon    || 'https://cdn-icons-png.flaticon.com/512/9703/9703596.png',
    badge:   data.badge   || 'https://cdn-icons-png.flaticon.com/512/9703/9703596.png',
    data:    data,
    vibrate: [200, 100, 200],
    tag:     data.tag || 'ml-notif',
    renotify: true
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const pablo = list.find(c => c.url.includes('pablo.html'));
      if (pablo) return pablo.focus();
      return clients.openWindow('./pablo.html');
    })
  );
});
