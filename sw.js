// Service Worker para instalación PWA (Soporte para Laura y Pablo)
const CACHE_NAME = 'caja-ml-v2'; // Versión 2 (Para forzar actualización)

// Lista de archivos que se guardarán en el dispositivo
const urlsToCache = [
  './',
  './index.html',           // El portal trampa
  './laura.html',           // App de Caja
  './pablo.html',           // Tu App Admin
  './manifest.json',        // Icono Laura
  './manifest-pablo.json'   // Icono Pablo (Negro)
];

// 1. INSTALACIÓN: Descarga y guarda los archivos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Guardando archivos en caché...');
        return cache.addAll(urlsToCache);
      })
  );
});

// 2. RECUPERACIÓN: Sirve los archivos guardados (incluso offline)
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Si está en caché, lo devuelve. Si no, lo busca en internet.
        return response || fetch(event.request);
      })
  );
});

// 3. LIMPIEZA: Borra cachés viejos (v1) al actualizar
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Borrando caché antigua:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
