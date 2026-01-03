const CACHE_NAME = 'suragua-v5';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './assets/img/fondo13.png',
  './assets/img/freepik__upload__37400.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then(res => res || fetch(e.request)));
});