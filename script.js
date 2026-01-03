const idDispenserInput = document.getElementById('idDispenser');
const APPS_SCRIPT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzbjhRNjUE9mPQA0mZubSp374dS0WJlWTTdQ5Oqqc-Rok5rocJrdq9wZ8qnQTczZo8f/exec';

const VALID_USERNAME = '1234';
const VALID_PASSWORD = '1234';
let loggedInUser = '';

// 1. REGISTRO DE SERVICE WORKER PARA MODO OFFLINE
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js');
    });
}

// 2. BASE DE DATOS LOCAL (INDEXED DB)
let db;
const request = indexedDB.open('SuraguaOfflineDB', 1);
request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains('pendientes')) {
        db.createObjectStore('pendientes', { autoIncrement: true });
    }
};
request.onsuccess = (e) => {
    db = e.target.result;
    intentarSincronizar();
};

// 3. FUNCIONES DE PANTALLA
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

// 4. LÓGICA DE LOGIN (DETECCIÓN DE QR O MANUAL)
document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const user = document.getElementById('username').value.toUpperCase();
    const pass = document.getElementById('password').value;

    if (user === VALID_USERNAME && pass === VALID_PASSWORD) {
        loggedInUser = user;
        
        // Revisar si existe ID en la URL (Escaneo de QR)
        const urlParams = new URLSearchParams(window.location.search);
        const idQR = urlParams.get('idDispenser');

        if (idQR) {
            // SI ES QR: Bloquear campo y cargar ID
            idDispenserInput.value = idQR;
            idDispenserInput.readOnly = true;
            idDispenserInput.style.backgroundColor = "#e9ecef"; // Gris
            showScreen('mantenimientoScreen');
        } else {
            // SI ES NORMAL: Ir al menú
            showScreen('optionsScreen');
        }
    } else {
        document.getElementById('loginMessage').textContent = 'Usuario o contraseña incorrectos.';
    }
});

// 5. BOTONES DE NAVEGACIÓN
document.getElementById('btnMantenimiento').onclick = () => {
    // Si entra por el botón del menú, SIEMPRE se desbloquea para manual
    idDispenserInput.value = "";
    idDispenserInput.readOnly = false;
    idDispenserInput.style.backgroundColor = "#ffffff"; // Blanco
    idDispenserInput.placeholder = "Ingrese ID manual";
    
    document.getElementById('mantenimientoForm').reset();
    document.getElementById('fechaMantenimiento').valueAsDate = new Date();
    showScreen('mantenimientoScreen');
};

document.getElementById('btnBidones').onclick = () => {
    document.getElementById('bidonesForm').reset();
    showScreen('bidonesScreen');
};

document.getElementById('btnLogout').onclick = () => {
    // Recarga la página limpia para cerrar sesión
    window.location.href = window.location.pathname;
};

document.getElementById('backToOptionsFromBidones').onclick = () => showScreen('optionsScreen');
document.getElementById('backToOptionsFromMantenimiento').onclick = () => showScreen('optionsScreen');

// 6. GESTIÓN DE DATOS OFFLINE
function guardarLocal(datos) {
    const tx = db.transaction('pendientes', 'readwrite');
    tx.objectStore('pendientes').add(datos);
    intentarSincronizar();
}

async function intentarSincronizar() {
    if (!navigator.onLine || !db) return;

    const tx = db.transaction('pendientes', 'readwrite');
    const store = tx.objectStore('pendientes');
    const todos = await new Promise(res => {
        const req = store.getAll();
        const keys = store.getAllKeys();
        req.onsuccess = () => keys.onsuccess = () => res(req.result.map((d, i) => ({ k: keys.result[i], d })));
    });

    for (const item of todos) {
        const formData = new FormData();
        for (const key in item.d) formData.append(key, item.d[key]);

        try {
            const response = await fetch(APPS_SCRIPT_WEB_APP_URL, { method: 'POST', body: formData });
            if (response.ok) {
                const delTx = db.transaction('pendientes', 'readwrite');
                delTx.objectStore('pendientes').delete(item.k);
            }
        } catch (error) { break; }
    }
}

window.addEventListener('online', intentarSincronizar);

// 7. ENVÍO DE FORMULARIOS (MÁXIMA VELOCIDAD)
document.getElementById('bidonesForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const datos = {
        sheet: 'Entregas',
        usuario: loggedInUser,
        cantidadEntregados: document.getElementById('cantidadEntregados').value,
        vaciosRetirados: document.getElementById('vaciosRetirados').value,
        lugar: document.getElementById('lugar').value,
        sector: document.getElementById('sector').value,
        observaciones: document.getElementById('observacionesBidones').value
    };
    guardarLocal(datos);
    document.getElementById('bidonesMessage').textContent = 'Guardado con éxito (Sincronizando...)';
    setTimeout(() => { showScreen('optionsScreen'); document.getElementById('bidonesMessage').textContent = ''; }, 1500);
});

document.getElementById('mantenimientoForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const datos = {
        sheet: 'Mantenimiento',
        usuario: loggedInUser,
        idDispenser: idDispenserInput.value,
        fechaMantenimiento: document.getElementById('fechaMantenimiento').value,
        lugarDispenser: document.getElementById('lugarDispenser').value,
        sectorDispenser: document.getElementById('sectorDispenser').value,
        observacionesMantenimiento: document.getElementById('observacionesMantenimiento').value
    };
    guardarLocal(datos);
    document.getElementById('mantenimientoMessage').textContent = 'Guardado con éxito (Sincronizando...)';
    setTimeout(() => { showScreen('optionsScreen'); document.getElementById('mantenimientoMessage').textContent = ''; }, 1500);
});