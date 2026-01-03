const idDispenserInput = document.getElementById('idDispenser');
const APPS_SCRIPT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzbjhRNjUE9mPQA0mZubSp374dS0WJlWTTdQ5Oqqc-Rok5rocJrdq9wZ8qnQTczZo8f/exec';
const VALID_USERNAME = '1234';
const VALID_PASSWORD = '1234';
let loggedInUser = '';

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            console.log("Servidor de fondo listo.");
        });
    });
}

let db;
const request = indexedDB.open('SuraguaDB', 1);
request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains('pendientes')) db.createObjectStore('pendientes', { autoIncrement: true });
};
request.onsuccess = (e) => { 
    db = e.target.result; 
    intentarSincronizarYa(); // Al abrir, si hay señal, manda todo
};

// --- FUNCIÓN DE ENVÍO ULTRA RÁPIDO ---
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

    console.log("Internet detectado. Enviando ráfaga de datos...");

    // Enviamos todos en paralelo para que sea instantáneo
    await Promise.all(registros.map(async (reg) => {
        const formData = new FormData();
        for (const key in reg.d) formData.append(key, reg.d[key]);
        try {
            const res = await fetch(APPS_SCRIPT_WEB_APP_URL, { method: 'POST', body: formData, mode: 'no-cors' });
            // 'no-cors' hace que el envío sea más rápido porque no espera la respuesta completa del servidor
            const delTx = db.transaction('pendientes', 'readwrite');
            delTx.objectStore('pendientes').delete(reg.k);
        } catch (e) {
            console.error("Error en envío rápido", e);
        }
    }));
}

// Escuchar el cambio de offline a online para disparar el envío al segundo
window.addEventListener('online', intentarSincronizarYa);

// --- GUARDADO LOCAL ---
async function guardarLocal(datos) {
    const tx = db.transaction('pendientes', 'readwrite');
    tx.objectStore('pendientes').add(datos);
    
    if (navigator.onLine) {
        intentarSincronizarYa(); // Si hay internet, no espera al fondo, manda YA.
    } else if ('serviceWorker' in navigator && 'SyncManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        reg.sync.register('sync-datos');
    }
}

// Navegación y Login (Igual que antes)
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const user = document.getElementById('username').value.toUpperCase();
    const pass = document.getElementById('password').value;
    if (user === VALID_USERNAME && pass === VALID_PASSWORD) {
        loggedInUser = user;
        const urlParams = new URLSearchParams(window.location.search);
        const idQR = urlParams.get('idDispenser');
        if (idQR) {
            idDispenserInput.value = idQR;
            idDispenserInput.readOnly = true;
            idDispenserInput.style.backgroundColor = "#e9ecef";
            showScreen('mantenimientoScreen');
        } else {
            idDispenserInput.readOnly = false;
            idDispenserInput.style.backgroundColor = "#ffffff";
            showScreen('optionsScreen');
        }
    } else {
        document.getElementById('loginMessage').textContent = 'Error de login';
    }
});

document.getElementById('btnMantenimiento').onclick = () => {
    document.getElementById('mantenimientoForm').reset();
    idDispenserInput.value = "";
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
    e.target.reset();
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
    e.target.reset();
    document.getElementById('mantenimientoMessage').textContent = 'Guardado. Sincronizando...';
    setTimeout(() => { document.getElementById('mantenimientoMessage').textContent = ''; showScreen('optionsScreen'); }, 1500);
});