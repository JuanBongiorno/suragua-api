const idDispenserInput = document.getElementById('idDispenser');
const APPS_SCRIPT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzbjhRNjUE9mPQA0mZubSp374dS0WJlWTTdQ5Oqqc-Rok5rocJrdq9wZ8qnQTczZo8f/exec';
const VALID_USERNAME = '1234';
const VALID_PASSWORD = '1234';
let loggedInUser = '';

// --- BASE DE DATOS ---
let db;
const request = indexedDB.open('SuraguaDB', 2);
request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains('pendientes')) db.createObjectStore('pendientes', { autoIncrement: true });
    if (!db.objectStoreNames.contains('historial')) db.createObjectStore('historial', { autoIncrement: true });
};
request.onsuccess = (e) => { db = e.target.result; };

// --- FUNCIÓN ALERTA PERSONALIZADA (CARTEL PC) ---
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

// --- HISTORIAL DE CARGA (RESET VISUAL DIARIO) ---
async function renderHistorialDiario() {
    const list = document.getElementById('historyList');
    list.innerHTML = 'Cargando registros de hoy...';
    const tx = db.transaction('historial', 'readonly');
    const todos = await new Promise(res => { tx.objectStore('historial').getAll().onsuccess = (e) => res(e.target.result); });

    const hoy = new Date().toISOString().split('T')[0];
    const filtrados = todos.filter(r => {
        const fechaReg = r.fechaMantenimiento || hoy; 
        return fechaReg === hoy;
    });

    list.innerHTML = filtrados.length ? filtrados.reverse().map(r => `
        <div style="border-bottom:1px solid #ddd; padding:8px;">
            <strong>${r.sheet === 'Mantenimiento' ? '🛠 Mant.' : '💧 Bidones'}</strong> - ${r.idDispenser || r.lugar}
        </div>`).join('') : 'No hay registros cargados hoy.';
}

// --- HISTORIAL DE MÁQUINAS (CHECKLIST + BUSCADOR) ---
async function renderHistorialMaquinas(query = '') {
    const list = document.getElementById('maquinasList');
    const tx = db.transaction('historial', 'readonly');
    const todos = await new Promise(res => { tx.objectStore('historial').getAll().onsuccess = (e) => res(e.target.result); });

    const mants = {};
    todos.forEach(r => { if(r.sheet === 'Mantenimiento') mants[r.idDispenser] = r.fechaMantenimiento; });

    const ids = Object.keys(mants).filter(id => id.toLowerCase().includes(query.toLowerCase()));

    list.innerHTML = ids.length ? ids.map(id => `
        <div class="machine-item" onclick="mostrarAlerta('ID ${id}: Realizado el ${mants[id]}')">
            <div><strong>ID: ${id}</strong><br><small style="color: #888;">${mants[id]}</small></div>
            <span style="color:green; font-weight:bold;">✔</span>
        </div>`).join('') : 'No se encontraron resultados.';
}

// --- EVENTOS ---
document.getElementById('loginForm').onsubmit = (e) => {
    e.preventDefault();
    if (document.getElementById('username').value === VALID_USERNAME && document.getElementById('password').value === VALID_PASSWORD) {
        loggedInUser = VALID_USERNAME;
        showScreen('optionsScreen');
    } else { document.getElementById('loginMessage').innerText = 'Datos incorrectos'; }
};

document.getElementById('btnHistorialMenu').onclick = () => { renderHistorialDiario(); showScreen('historyScreen'); };
document.getElementById('btnHistorialMaquinas').onclick = () => { renderHistorialMaquinas(); showScreen('historyMaquinasScreen'); };
document.getElementById('searchMaquina').oninput = (e) => renderHistorialMaquinas(e.target.value);
document.getElementById('backFromHistory').onclick = () => showScreen('optionsScreen');
document.getElementById('backFromMaquinas').onclick = () => showScreen('optionsScreen');
document.getElementById('btnLogout').onclick = () => location.reload();

document.getElementById('btnMantenimiento').onclick = () => {
    document.getElementById('mantenimientoForm').reset();
    document.getElementById('fechaMantenimiento').valueAsDate = new Date();
    showScreen('mantenimientoScreen');
};
document.getElementById('btnBidones').onclick = () => {
    document.getElementById('bidonesForm').reset();
    showScreen('bidonesScreen');
};
document.getElementById('backToOptionsFromBidones').onclick = () => showScreen('optionsScreen');
document.getElementById('backToOptionsFromMantenimiento').onclick = () => showScreen('optionsScreen');

// --- SUBMIT MANTENIMIENTO CON BLOQUEO DE 10 DÍAS ---
document.getElementById('mantenimientoForm').onsubmit = async (e) => {
    e.preventDefault();
    const id = idDispenserInput.value;
    const fechaActual = new Date(document.getElementById('fechaMantenimiento').value);

    const tx = db.transaction('historial', 'readonly');
    const store = tx.objectStore('historial');
    const todos = await new Promise(res => { store.getAll().onsuccess = (e) => res(e.target.result); });

    const repetido = todos.find(r => {
        if (r.sheet === 'Mantenimiento' && r.idDispenser === id) {
            const fRef = new Date(r.fechaMantenimiento);
            const diff = (fechaActual - fRef) / (1000*60*60*24);
            return diff >= 0 && diff < 10;
        }
        return false;
    });

    if (repetido) {
        mostrarAlerta(`El mantenimiento a la máquina ${id} ya se realizó el día ${repetido.fechaMantenimiento}.`);
        return;
    }

    guardarLocal({
        sheet: 'Mantenimiento', usuario: loggedInUser, idDispenser: id,
        fechaMantenimiento: document.getElementById('fechaMantenimiento').value,
        lugarDispenser: document.getElementById('lugarDispenser').value,
        sectorDispenser: document.getElementById('sectorDispenser').value,
        observacionesMantenimiento: document.getElementById('observacionesMantenimiento').value
    });
    mostrarAlerta("Guardado con éxito.");
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

function guardarLocal(datos) {
    const tx = db.transaction(['pendientes', 'historial'], 'readwrite');
    tx.objectStore('pendientes').add(datos);
    tx.objectStore('historial').add(datos);
}

// Registro de Service Worker forzado
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(reg => {
        reg.update(); // Obliga a buscar cambios en el servidor
    });
}