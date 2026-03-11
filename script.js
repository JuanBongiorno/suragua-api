const idDispenserInput = document.getElementById('idDispenser');
const APPS_SCRIPT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzbjhRNjUE9mPQA0mZubSp374dS0WJlWTTdQ5Oqqc-Rok5rocJrdq9wZ8qnQTczZo8f/exec';
const VALID_USERNAME = '1234';
const VALID_PASSWORD = '1234';
let loggedInUser = '';

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(reg => reg.update());
    });
}

// Base de Datos IndexedDB
let db;
const request = indexedDB.open('SuraguaDB', 2);
request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains('pendientes')) db.createObjectStore('pendientes', { autoIncrement: true });
    if (!db.objectStoreNames.contains('historial')) db.createObjectStore('historial', { autoIncrement: true });
};
request.onsuccess = (e) => { db = e.target.result; };

// Alerta Personalizada
function mostrarAlerta(msj) {
    document.getElementById('alertMessage').innerText = msj;
    document.getElementById('customAlert').style.display = 'flex';
}
document.getElementById('closeAlert').onclick = () => document.getElementById('customAlert').style.display = 'none';
document.getElementById('btnCerrarAlerta').onclick = () => document.getElementById('customAlert').style.display = 'none';

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// Historial Diario (Filtra solo Hoy)
async function renderHistorialDiario() {
    const list = document.getElementById('historyList');
    list.innerHTML = 'Cargando registros...';
    const tx = db.transaction('historial', 'readonly');
    const todos = await new Promise(res => { tx.objectStore('historial').getAll().onsuccess = (e) => res(e.target.result); });
    const hoy = new Date().toISOString().split('T')[0];
    const filtrados = todos.filter(r => (r.fechaMantenimiento || hoy) === hoy);
    list.innerHTML = filtrados.length ? filtrados.reverse().map(r => `<div style="padding:5px; border-bottom:1px solid #ddd;"><strong>${r.sheet === 'Mantenimiento' ? '🛠 Mant.' : '💧 Bid.'}</strong> - ${r.idDispenser || r.lugar}</div>`).join('') : 'No hay registros de hoy.';
}

// Historial Máquinas (Buscador)
async function renderHistorialMaquinas(busqueda = '') {
    const list = document.getElementById('maquinasList');
    const tx = db.transaction('historial', 'readonly');
    const todos = await new Promise(res => { tx.objectStore('historial').getAll().onsuccess = (e) => res(e.target.result); });
    const mants = {};
    todos.forEach(r => { if(r.sheet === 'Mantenimiento') mants[r.idDispenser] = r.fechaMantenimiento; });
    const filtrados = Object.keys(mants).filter(id => id.toLowerCase().includes(busqueda.toLowerCase()));
    list.innerHTML = filtrados.map(id => `<div class="machine-item" onclick="mostrarAlerta('ID: ${id} - Realizado el ${mants[id]}')"><div><strong>ID: ${id}</strong><br><small>${mants[id]}</small></div><span style="color:green">✔</span></div>`).join('') || 'Sin resultados.';
}

// LOGIN Y LÓGICA DE URL PARAMETERS (?idDispenser=XXX)
document.getElementById('loginForm').onsubmit = (e) => {
    e.preventDefault();
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;

    if (user === VALID_USERNAME && pass === VALID_PASSWORD) {
        loggedInUser = user;
        
        // RECUPERAMOS EL ID DEL DISPENSER DE LA URL
        const urlParams = new URLSearchParams(window.location.search);
        const idQR = urlParams.get('idDispenser');

        if (idQR) {
            idDispenserInput.value = idQR;
            idDispenserInput.readOnly = true;
            idDispenserInput.style.backgroundColor = "#e9ecef"; // Color gris para indicar bloqueado
            document.getElementById('fechaMantenimiento').valueAsDate = new Date();
            showScreen('mantenimientoScreen');
        } else {
            showScreen('optionsScreen');
        }
    } else {
        document.getElementById('loginMessage').innerText = 'Datos incorrectos';
    }
};

// Eventos de Navegación
document.getElementById('btnHistorialMenu').onclick = () => { renderHistorialDiario(); showScreen('historyScreen'); };
document.getElementById('btnHistorialMaquinas').onclick = () => { renderHistorialMaquinas(); showScreen('historyMaquinasScreen'); };
document.getElementById('searchMaquina').oninput = (e) => renderHistorialMaquinas(e.target.value);
document.getElementById('backFromHistory').onclick = () => showScreen('optionsScreen');
document.getElementById('backFromMaquinas').onclick = () => showScreen('optionsScreen');
document.getElementById('btnLogout').onclick = () => location.href = location.pathname; // Limpia la URL al cerrar sesión

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
document.getElementById('backToOptionsFromBidones').onclick = () => showScreen('optionsScreen');
document.getElementById('backToOptionsFromMantenimiento').onclick = () => showScreen('optionsScreen');

// Submit Mantenimiento (Validación 10 días)
document.getElementById('mantenimientoForm').onsubmit = async (e) => {
    e.preventDefault();
    const id = idDispenserInput.value;
    const fechaActual = new Date(document.getElementById('fechaMantenimiento').value);
    
    const tx = db.transaction('historial', 'readonly');
    const store = tx.objectStore('historial');
    const todos = await new Promise(res => { store.getAll().onsuccess = (e) => res(e.target.result); });
    
    const duplicado = todos.find(r => {
        if(r.sheet === 'Mantenimiento' && r.idDispenser === id) {
            const fRef = new Date(r.fechaMantenimiento);
            const diff = (fechaActual - fRef) / (1000*60*60*24);
            return diff >= 0 && diff < 10;
        }
        return false;
    });

    if(duplicado) { 
        mostrarAlerta(`Máquina ${id} ya tiene mantenimiento del día ${duplicado.fechaMantenimiento}. Debe esperar 10 días.`); 
        return; 
    }

    guardarLocal({
        sheet: 'Mantenimiento', usuario: loggedInUser, idDispenser: id,
        fechaMantenimiento: document.getElementById('fechaMantenimiento').value,
        lugarDispenser: document.getElementById('lugarDispenser').value,
        sectorDispenser: document.getElementById('sectorDispenser').value,
        observacionesMantenimiento: document.getElementById('observacionesMantenimiento').value
    });
    mostrarAlerta("Guardado correctamente. Sincronizando...");
    showScreen('optionsScreen');
};

document.getElementById('bidonesForm').onsubmit = (e) => {
    e.preventDefault();
    guardarLocal({
        sheet: 'Entregas', usuario: loggedInUser,
        cantidadEntregados: document.getElementById('cantidadEntregados').value,
        vaciosRetirados: document.getElementById('vaciosRetirados').value,
        lugar: document.getElementById('lugar').value,
        sector: document.getElementById('sector').value,
        observaciones: document.getElementById('observacionesBidones').value
    });
    showScreen('optionsScreen');
};

async function guardarLocal(datos) {
    const tx = db.transaction(['pendientes', 'historial'], 'readwrite');
    tx.objectStore('pendientes').add(datos);
    tx.objectStore('historial').add(datos);
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        reg.sync.register('sync-datos');
    }
}