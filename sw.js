// Service Worker — Caja Mercado Limpio
const CACHE_NAME = 'caja-ml-v67';

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
      Promise.all(names.filter(n => n.startsWith("caja-ml-") && n !== CACHE_NAME).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Los guardados (POST) van directo a la red, sin pasar por el service worker:
  // así un envío con keepalive puede terminar aunque se bloquee el celular.
  if (event.request.method !== 'GET') return;
  // 19/11/2026: las PÁGINAS (laura.html, pablo.html, index.html) van primero a la red, con 3 s de espera, y recién si falla
  // se sirve la copia guardada. Antes eran cache-first: una página publicada no llegaba hasta un Ctrl+F5 o un cambio de versión.
  // Lo demás (íconos, manifest) sigue cache-first.
  const esPagina = event.request.mode === 'navigate' || (event.request.headers.get('accept') || '').includes('text/html');
  if (esPagina && new URL(event.request.url).origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const fresca = await Promise.race([fetch(event.request), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 3000))]);
        if (fresca && fresca.ok) cache.put(event.request, fresca.clone());
        return fresca;
      } catch (e) {
        const guardada = await cache.match(event.request);
        return guardada || fetch(event.request);
      }
    })());
    return;
  }
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
