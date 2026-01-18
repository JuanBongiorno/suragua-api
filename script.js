const idDispenserInput = document.getElementById('idDispenser');
const APPS_SCRIPT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzbjhRNjUE9mPQA0mZubSp374dS0WJlWTTdQ5Oqqc-Rok5rocJrdq9wZ8qnQTczZo8f/exec';
const VALID_USERNAME = '1234';
const VALID_PASSWORD = '1234';
let loggedInUser = '';

// Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(reg => console.log("SW listo."));
    });
}

// --- BASE DE DATOS (IndexedDB) ---
let db;
const request = indexedDB.open('SuraguaDB', 2); // Versión 2 para historial

request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains('pendientes')) db.createObjectStore('pendientes', { autoIncrement: true });
    // Almacén permanente para el historial del teléfono
    if (!db.objectStoreNames.contains('historial')) db.createObjectStore('historial', { autoIncrement: true });
};

request.onsuccess = (e) => { 
    db = e.target.result; 
    intentarSincronizarYa();
};

// --- SINCRONIZACIÓN ---
async function intentarSincronizarYa() {
    if (!navigator.onLine || !db) return;
    const tx = db.transaction('pendientes', 'readwrite');
    const store = tx.objectStore('pendientes');
    const registros = await new Promise(res => {
        const req = store.getAll();
        const keysReq = store.getAllKeys();
        req.onsuccess = () => keysReq.onsuccess = () => res(req.result.map((d, i) => ({ k: keysReq.result[i], d })));
    });
    if (registros.length === 0) return;
    await Promise.all(registros.map(async (reg) => {
        const formData = new FormData();
        for (const key in reg.d) formData.append(key, reg.d[key]);
        try {
            await fetch(APPS_SCRIPT_WEB_APP_URL, { method: 'POST', body: formData, mode: 'no-cors' });
            const delTx = db.transaction('pendientes', 'readwrite');
            delTx.objectStore('pendientes').delete(reg.k);
        } catch (e) { console.error("Error envío", e); }
    }));
}
window.addEventListener('online', intentarSincronizarYa);

// --- GUARDADO LOCAL ---
async function guardarLocal(datos) {
    const tx = db.transaction(['pendientes', 'historial'], 'readwrite');
    tx.objectStore('pendientes').add(datos);
    tx.objectStore('historial').add(datos); // Copia permanente para historial
    
    if (navigator.onLine) {
        intentarSincronizarYa();
    } else if ('serviceWorker' in navigator && 'SyncManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        reg.sync.register('sync-datos');
    }
}

// --- NAVEGACIÓN ---
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// --- LÓGICA DE HISTORIAL ---
async function renderHistorial() {
    const list = document.getElementById('historyList');
    list.innerHTML = 'Cargando registros locales...';
    
    const tx = db.transaction('historial', 'readonly');
    const store = tx.objectStore('historial');
    const todos = await new Promise(res => {
        const req = store.getAll();
        req.onsuccess = () => res(req.result);
    });

    if (todos.length === 0) {
        list.innerHTML = 'No hay registros cargados aún.';
        return;
    }

    // Mostramos los últimos primero
    list.innerHTML = todos.reverse().map(reg => {
        const esMantenimiento = reg.sheet === 'Mantenimiento';
        return `
            <div class="history-item">
                <strong>${esMantenimiento ? '🛠 Mantenimiento' : '💧 Entrega Bidones'}</strong><br>
                <span class="hist-label">Fecha/ID:</span> ${reg.fechaMantenimiento || 'Hoy'} - ${reg.idDispenser || 'N/A'}<br>
                <span class="hist-label">Ubicación:</span> ${reg.lugarDispenser || reg.lugar} (${reg.sectorDispenser || reg.sector})<br>
                <span class="hist-label">Obs:</span> ${reg.observacionesMantenimiento || reg.observaciones || '-' }
            </div>
        `;
    }).join('');
}

// --- EVENTOS ---
document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const user = document.getElementById('username').value.toUpperCase();
    const pass = document.getElementById('password').value;
    if (user === VALID_USERNAME && pass === VALID_PASSWORD) {
        loggedInUser = user;
        const idQR = new URLSearchParams(window.location.search).get('idDispenser');
        if (idQR) {
            idDispenserInput.value = idQR;
            idDispenserInput.readOnly = true;
            idDispenserInput.style.backgroundColor = "#e9ecef";
            showScreen('mantenimientoScreen');
        } else {
            showScreen('optionsScreen');
        }
    } else { document.getElementById('loginMessage').textContent = 'Error de login'; }
});

// Botones Historial (Los dos botones hacen lo mismo)
document.getElementById('btnHistorialMenu').onclick = () => { renderHistorial(); showScreen('historyScreen'); };
document.getElementById('btnHistorialForm').onclick = () => { renderHistorial(); showScreen('historyScreen'); };
document.getElementById('backFromHistory').onclick = () => {
    // Si venimos de mantenimiento, volvemos allí, si no al menú
    if (document.getElementById('mantenimientoForm').idDispenser.value !== "") showScreen('mantenimientoScreen');
    else showScreen('optionsScreen');
};

document.getElementById('btnMantenimiento').onclick = () => {
    document.getElementById('mantenimientoForm').reset();
    idDispenserInput.readOnly = false;
    idDispenserInput.style.backgroundColor = "#ffffff";
    document.getElementById('fechaMantenimiento').valueAsDate = new Date();
    showScreen('mantenimientoScreen');
};
document.getElementById('btnBidones').onclick = () => {
    document.getElementById('bidonesForm').reset();
    showScreen('bidonesScreen');
};
document.getElementById('btnLogout').onclick = () => { window.location.href = window.location.pathname; };
document.getElementById('backToOptionsFromBidones').onclick = () => showScreen('optionsScreen');
document.getElementById('backToOptionsFromMantenimiento').onclick = () => showScreen('optionsScreen');

// Submits
document.getElementById('bidonesForm').addEventListener('submit', (e) => {
    e.preventDefault();
    guardarLocal({
        sheet: 'Entregas', usuario: loggedInUser,
        cantidadEntregados: document.getElementById('cantidadEntregados').value,
        vaciosRetirados: document.getElementById('vaciosRetirados').value,
        lugar: document.getElementById('lugar').value,
        sector: document.getElementById('sector').value,
        observaciones: document.getElementById('observacionesBidones').value
    });
    document.getElementById('bidonesMessage').textContent = 'Guardado. Sincronizando...';
    setTimeout(() => { document.getElementById('bidonesMessage').textContent = ''; showScreen('optionsScreen'); }, 1500);
});

document.getElementById('mantenimientoForm').addEventListener('submit', (e) => {
    e.preventDefault();
    guardarLocal({
        sheet: 'Mantenimiento', usuario: loggedInUser,
        idDispenser: idDispenserInput.value,
        fechaMantenimiento: document.getElementById('fechaMantenimiento').value,
        lugarDispenser: document.getElementById('lugarDispenser').value,
        sectorDispenser: document.getElementById('sectorDispenser').value,
        observacionesMantenimiento: document.getElementById('observacionesMantenimiento').value
    });
    document.getElementById('mantenimientoMessage').textContent = 'Guardado. Sincronizando...';
    setTimeout(() => { document.getElementById('mantenimientoMessage').textContent = ''; showScreen('optionsScreen'); }, 1500);
});