const CACHE_NAME = 'suragua-vSYNC-BACKGROUND';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzbjhRNjUE9mPQA0mZubSp374dS0WJlWTTdQ5Oqqc-Rok5rocJrdq9wZ8qnQTczZo8f/exec';
const ASSETS = ['./', './index.html', './style.css', './script.js', './assets/img/fondo13.png', './assets/img/freepik__upload__37400.png'];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)))));
});

// ESTRATEGIA DE CACHE
self.addEventListener('fetch', (e) => {
    e.respondWith(caches.match(e.request).then(res => res || fetch(e.request)));
});

// --- ESTO ES LO QUE BUSCABAS: SINCRONIZACIÓN EN SEGUNDO PLANO ---
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-datos') {
        event.waitUntil(enviarDatosPendientes());
    }
});

async function enviarDatosPendientes() {
    // Abrir la base de datos desde el Service Worker
    const db = await new Promise((resolve) => {
        const request = indexedDB.open('SuraguaDB', 1);
        request.onsuccess = () => resolve(request.result);
    });

    const tx = db.transaction('pendientes', 'readonly');
    const store = tx.objectStore('pendientes');
    const registros = await new Promise(res => {
        const req = store.getAll();
        req.onsuccess = () => res(req.result);
    });

    const keys = await new Promise(res => {
        const req = store.getAllKeys();
        req.onsuccess = () => res(req.result);
    });

    for (let i = 0; i < registros.length; i++) {
        const formData = new FormData();
        for (const key in registros[i]) {
            formData.append(key, registros[i][key]);
        }

        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                const delTx = db.transaction('pendientes', 'readwrite');
                await delTx.objectStore('pendientes').delete(keys[i]);
                console.log("Dato sincronizado desde el fondo");
            }
        } catch (error) {
            console.error("Fallo envío de fondo, reintentará luego", error);
            throw error; // Al lanzar error, el navegador reintentará la sincronización más tarde
        }
    }
}