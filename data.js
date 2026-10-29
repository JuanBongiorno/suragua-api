/* Shared by the page and the service worker. */
const SuraguaData = (() => {
    const url = 'https://script.google.com/macros/s/AKfycbxmyhy14gG4WjT43SurVX1GpRagCrO3AKfTXYd24-eiG3MkLL65wt4iQ7RwjREXYwD5/exec';
    const done = tx => new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Transaccion cancelada'));
    });
    const result = request => new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    function open() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('SuraguaDB', 3);
            request.onupgradeneeded = () => {
                const db = request.result;
                for (const name of ['pendientes', 'historial']) {
                    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('remoto')) db.createObjectStore('remoto');
            };
            request.onsuccess = () => {
                request.result.onversionchange = () => request.result.close();
                resolve(request.result);
            };
            request.onerror = () => reject(request.error);
            request.onblocked = () => console.error('Cierre las otras pestanas para actualizar la base local.');
        });
    }
    async function all(db, name) {
        return result(db.transaction(name).objectStore(name).getAll());
    }
    async function snapshot(db) {
        const tx = db.transaction('pendientes');
        const store = tx.objectStore('pendientes');
        const [values, keys] = await Promise.all([result(store.getAll()), result(store.getAllKeys())]);
        return values.map((value, i) => ({ key: keys[i], value }));
    }
    async function migrate(db) {
        const tx = db.transaction(['pendientes', 'historial'], 'readwrite');
        const completion = done(tx);
        const pending = tx.objectStore('pendientes');
        const history = tx.objectStore('historial');
        const assigned = new Set();
        const historyRequest = history.getAll();
        const keysRequest = history.getAllKeys();
        keysRequest.onsuccess = () => {
            const cursorRequest = pending.openCursor();
            cursorRequest.onsuccess = () => {
                const cursor = cursorRequest.result;
                if (!cursor) return;
                const value = cursor.value;
                if (!value.idReportes) {
                    const signature = JSON.stringify(value);
                    value.idReportes = crypto.randomUUID();
                    cursor.update(value);
                    const index = historyRequest.result.findIndex((r, i) =>
                        !assigned.has(i) && !r.idReportes && JSON.stringify(r) === signature);
                    if (index !== -1) {
                        assigned.add(index);
                        history.put({ ...historyRequest.result[index], idReportes: value.idReportes }, keysRequest.result[index]);
                    }
                }
                cursor.continue();
            };
        };
        await completion;
    }
    async function read(query) {
        const response = await fetch(url + '?' + new URLSearchParams({ ...query, _: Date.now() }), {
            cache: 'no-store', signal: AbortSignal.timeout(20000)
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const json = await response.json();
        if (json.error) throw new Error(json.error);
        return json;
    }
    async function download(db) {
        const json = await read({ action: 'read' });
        if (!Array.isArray(json.data)) throw new Error('Historial remoto invalido');
        const cached = { data: json.data, updatedAt: new Date().toISOString() };
        const tx = db.transaction('remoto', 'readwrite');
        const completion = done(tx);
        tx.objectStore('remoto').put(cached, 'historial');
        await completion;
        return cached;
    }
    async function cached(db) {
        return result(db.transaction('remoto').objectStore('remoto').get('historial'));
    }
    let active;
    function sync(db) {
        if (active) return active;
        const run = async () => {
            await migrate(db);
            const reports = await snapshot(db);
            const failures = [];
            for (const { key, value } of reports) {
                try {
                    // A previous attempt may already have reached Sheets.
                    let receipt = await read({ action: 'status', sheet: value.sheet, idReportes: value.idReportes });
                    if (typeof receipt.confirmed !== 'boolean') throw new Error('Actualice Google Apps Script para confirmar los envios.');
                    if (!receipt.confirmed) {
                        const body = new FormData();
                        for (const [k, v] of Object.entries(value)) body.append(k, v);
                        await fetch(url, { method: 'POST', body, mode: 'no-cors', signal: AbortSignal.timeout(20000) });
                        receipt = await read({ action: 'status', sheet: value.sheet, idReportes: value.idReportes });
                    }
                    if (receipt.confirmed !== true || receipt.idReportes !== value.idReportes) {
                        throw new Error('Google Sheets no confirmo el reporte ' + value.idReportes);
                    }
                    const tx = db.transaction('pendientes', 'readwrite');
                    const completion = done(tx);
                    tx.objectStore('pendientes').delete(key);
                    await completion;
                } catch (error) {
                    console.error('Reporte pendiente de envio:', value.idReportes, error);
                    failures.push(error.message);
                }
            }
            if (failures.length) throw new Error(failures[0]);
        };
        active = (navigator.locks
            ? navigator.locks.request('suragua-sync', run)
            : run()).finally(() => { active = null; });
        return active;
    }
    return { open, all, snapshot, migrate, read, download, cached, sync, done };
})();
