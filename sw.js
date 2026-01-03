const CACHE_NAME = 'suragua-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './assets/img/fondo13.png',
  './assets/img/freepik__upload__37400.png'
];

// Instalar y cachear recursos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Estrategia: Primero buscar en Cache, si no, ir a la red
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});