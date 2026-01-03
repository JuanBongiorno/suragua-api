const idDispenserInput = document.getElementById('idDispenser');
const APPS_SCRIPT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzbjhRNjUE9mPQA0mZubSp374dS0WJlWTTdQ5Oqqc-Rok5rocJrdq9wZ8qnQTczZo8f/exec';

const VALID_USERNAME = '1234';
const VALID_PASSWORD = '1234';
let loggedInUser = '';

// --- REGISTRO DEL SERVICE WORKER PARA USO OFFLINE ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.log("Error registrando SW", err));
    });
}

// --- BASE DE DATOS LOCAL (IndexedDB) ---
let db;
const request = indexedDB.open('SuraguaDB', 1);
request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains('pendientes')) db.createObjectStore('pendientes', { autoIncrement: true });
};
request.onsuccess = (e) => { 
    db = e.target.result; 
    intentarSincronizar(); // Intentar enviar datos apenas abra la app
};

// --- ELEMENTOS DEL DOM ---
const loginScreen = document.getElementById('loginScreen');
const optionsScreen = document.getElementById('optionsScreen');
const bidonesScreen = document.getElementById('bidonesScreen');
const mantenimientoScreen = document.getElementById('mantenimientoScreen');
const loginForm = document.getElementById('loginForm');
const loginMessage = document.getElementById('loginMessage');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const btnBidones = document.getElementById('btnBidones');
const btnMantenimiento = document.getElementById('btnMantenimiento');
const btnLogout = document.getElementById('btnLogout');
const bidonesForm = document.getElementById('bidonesForm');
const bidonesMessage = document.getElementById('bidonesMessage');
const mantenimientoForm = document.getElementById('mantenimientoForm');
const mantenimientoMessage = document.getElementById('mantenimientoMessage');

// --- LÓGICA DE NAVEGACIÓN ---
function showScreen(screenToShow) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    screenToShow.classList.add('active');
}

function getDispenserIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('idDispenser');
}

const dispenserIdFromUrl = getDispenserIdFromUrl();
if (dispenserIdFromUrl) localStorage.setItem('tempDispenserId', dispenserIdFromUrl);

loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (usernameInput.value.toUpperCase() === VALID_USERNAME && passwordInput.value === VALID_PASSWORD) {
        loggedInUser = usernameInput.value.toUpperCase();
        const tempId = localStorage.getItem('tempDispenserId');
        if (tempId) {
            idDispenserInput.value = tempId;
            showScreen(mantenimientoScreen);
            localStorage.removeItem('tempDispenserId');
        } else {
            showScreen(optionsScreen);
        }
    } else {
        loginMessage.textContent = 'Usuario o contraseña incorrectos.';
    }
});

btnLogout.addEventListener('click', () => { loggedInUser = ''; showScreen(loginScreen); });
btnBidones.addEventListener('click', () => { showScreen(bidonesScreen); bidonesMessage.textContent = ''; bidonesForm.reset(); });
btnMantenimiento.addEventListener('click', () => {
    showScreen(mantenimientoScreen);
    mantenimientoMessage.textContent = '';
    mantenimientoForm.reset();
    document.getElementById('fechaMantenimiento').valueAsDate = new Date();
});
document.getElementById('backToOptionsFromBidones').addEventListener('click', () => showScreen(optionsScreen));
document.getElementById('backToOptionsFromMantenimiento').addEventListener('click', () => showScreen(optionsScreen));

// --- GUARDADO LOCAL RÁPIDO Y SINCRONIZACIÓN ---

async function guardarEnLocal(datos) {
    const tx = db.transaction('pendientes', 'readwrite');
    const store = tx.objectStore('pendientes');
    store.add(datos);
    intentarSincronizar(); // Intenta enviar si hay internet
}

async function intentarSincronizar() {
    if (!navigator.onLine) return;
    const tx = db.transaction('pendientes', 'readwrite');
    const store = tx.objectStore('pendientes');
    const registros = await new Promise(res => {
        const req = store.getAll();
        const reqKeys = store.getAllKeys();
        req.onsuccess = () => reqKeys.onsuccess = () => res(req.result.map((d, i) => ({ k: reqKeys.result[i], d })));
    });

    for (const reg of registros) {
        const formData = new FormData();
        for (const key in reg.d) formData.append(key, reg.d[key]);
        try {
            const res = await fetch(APPS_SCRIPT_WEB_APP_URL, { method: 'POST', body: formData });
            if (res.ok) {
                const delTx = db.transaction('pendientes', 'readwrite');
                delTx.objectStore('pendientes').delete(reg.k);
            }
        } catch (e) { break; }
    }
}

window.addEventListener('online', intentarSincronizar);

// Eventos de Formulario optimizados
bidonesForm.addEventListener('submit', (e) => {
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
    guardarEnLocal(datos);
    bidonesMessage.textContent = '¡Datos guardados localmente! Se sincronizarán automáticamente.';
    bidonesForm.reset();
    setTimeout(() => showScreen(optionsScreen), 2000);
});

mantenimientoForm.addEventListener('submit', (e) => {
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
    guardarEnLocal(datos);
    mantenimientoMessage.textContent = '¡Datos guardados localmente! Se sincronizarán automáticamente.';
    mantenimientoForm.reset();
    setTimeout(() => showScreen(optionsScreen), 2000);
});