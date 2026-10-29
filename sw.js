importScripts('./data.js?v=206');
const CACHE_NAME = 'suragua-v206';
const ASSETS = ['./', './index.html', './manifest.json', './style.css?v=201', './data.js?v=206', './script.js?v=205', './assets/img/fondo13.png', './assets/img/freepik__upload__37400.png', './assets/img/fono34.png.png'];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(
        keys.filter(key => key.startsWith('suragua-') && key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
    event.respondWith(caches.match(event.request).then(cached =>
        cached || (event.request.mode === 'navigate'
            ? fetch(event.request).catch(() => caches.match('./index.html'))
            : fetch(event.request))));
});
self.addEventListener('sync', event => {
    if (event.tag !== 'sync-datos') return;
    event.waitUntil((async () => {
        const db = await SuraguaData.open();
        try {
            await SuraguaData.sync(db);
        } finally {
            db.close();
            const clients = await self.clients.matchAll();
            clients.forEach(client => client.postMessage({ type: 'sync-updated' }));
        }
    })());
});
