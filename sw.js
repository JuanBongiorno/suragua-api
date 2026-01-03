const CACHE_NAME = 'suragua-vFAST-SYNC';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzbjhRNjUE9mPQA0mZubSp374dS0WJlWTTdQ5Oqqc-Rok5rocJrdq9wZ8qnQTczZo8f/exec';
const ASSETS = ['./', './index.html', './style.css', './script.js', './assets/img/fondo13.png', './assets/img/freepik__upload__37400.png'];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)))));
});

self.addEventListener('fetch', (e) => {
    e.respondWith(caches.match(e.request).then(res => res || fetch(e.request)));
});

// SINCRONIZACIÓN DE FONDO
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-datos') {
        event.waitUntil(enviarTodoYa());
    }
});

async function enviarTodoYa() {
    const db = await new Promise(resolve => {
        const req = indexedDB.open('SuraguaDB', 1);
        req.onsuccess = () => resolve(req.result);
    });

    const tx = db.transaction('pendientes', 'readonly');
    const store = tx.objectStore('pendientes');
    const registros = await new Promise(res => {
        const r = store.getAll();
        r.onsuccess = () => res(r.result);
    });
    const keys = await new Promise(res => {
        const k = store.getAllKeys();
        k.onsuccess = () => res(k.result);
    });

    // Enviar todos los pendientes en paralelo para no perder tiempo
    return Promise.all(registros.map(async (data, i) => {
        const formData = new FormData();
        for (const key in data) formData.append(key, data[key]);
        
        try {
            await fetch(APPS_SCRIPT_URL, { method: 'POST', body: formData, mode: 'no-cors' });
            const delTx = db.transaction('pendientes', 'readwrite');
            await delTx.objectStore('pendientes').delete(keys[i]);
        } catch (err) {
            console.error("Fondo falló", err);
            throw err; 
        }
    }));
}