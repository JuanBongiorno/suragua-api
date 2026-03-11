const idDispenserInput = document.getElementById('idDispenser');
const APPS_SCRIPT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzbjhRNjUE9mPQA0mZubSp374dS0WJlWTTdQ5Oqqc-Rok5rocJrdq9wZ8qnQTczZo8f/exec';
const VALID_USERNAME = '1234';
const VALID_PASSWORD = '1234';
let loggedInUser = '';

// Service Worker
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
request.onsuccess = (e) => { 
    db = e.target.result; 
    intentarEnviarYa(); // Intentar enviar lo pendiente al abrir
};

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

// Envío Inmediato
async function intentarEnviarYa() {
    if (!navigator.onLine || !db) return;
    
    const tx = db.transaction('pendientes', 'readwrite');
    const store = tx.objectStore('pendientes');
    const registros = await new Promise(res => {
        const req = store.getAll();
        const keysReq = store.getAllKeys();
        req.onsuccess = () => keysReq.onsuccess = () => res(req.result.map((d, i) => ({ k: keysReq.result[i], d })));
    });

    for (let reg of registros) {
        const formData = new FormData();
        for (const key in reg.d) formData.append(key, reg.d[key]);

        try {
            await fetch(APPS_SCRIPT_WEB_APP_URL, { method: 'POST', body: formData, mode: 'no-cors' });
            const delTx = db.transaction('pendientes', 'readwrite');
            await delTx.objectStore('pendientes').delete(reg.k);
            console.log("Sincronizado con éxito");
        } catch (e) {
            console.error("Fallo de envío inmediato", e);
        }
    }
}

// Historial Diario
async function renderHistorialDiario() {
    const list = document.getElementById('historyList');
    list.innerHTML = 'Cargando...';
    const tx = db.transaction('historial', 'readonly');
    const todos = await new Promise(res => { tx.objectStore('historial').getAll().onsuccess = (e) => res(e.target.result); });
    const hoy = new Date().toISOString().split('T')[0];
    const filtrados = todos.filter(r => (r.fechaMantenimiento || hoy) === hoy);
    list.innerHTML = filtrados.length ? filtrados.reverse().map(r => `<div style="padding:8px; border-bottom:1px solid #ddd;"><strong>${r.sheet === 'Mantenimiento' ? '🛠 Mant.' : '💧 Bid.'}</strong> - ${r.idDispenser || r.lugar}</div>`).join('') : 'No hay registros hoy.';
}

// Historial Máquinas
async function renderHistorialMaquinas(busqueda = '') {
    const list = document.getElementById('maquinasList');
    const tx = db.transaction('historial', 'readonly');
    const todos = await new Promise(res => { tx.objectStore('historial').getAll().onsuccess = (e) => res(e.target.result); });
    const mants = {};
    todos.forEach(r => { if(r.sheet === 'Mantenimiento') mants[r.idDispenser] = r.fechaMantenimiento; });
    const filtrados = Object.keys(mants).filter(id => id.toLowerCase().includes(busqueda.toLowerCase()));
    list.innerHTML = filtrados.map(id => `<div class="machine-item" onclick="mostrarAlerta('ID: ${id} - Fecha: ${mants[id]}')"><div><strong>ID: ${id}</strong><br><small>${mants[id]}</small></div><span style="color:green">✔</span></div>`).join('') || 'Sin resultados.';
}

// Login con URL Param
document.getElementById('loginForm').onsubmit = (e) => {
    e.preventDefault();
    if (document.getElementById('username').value === VALID_USERNAME && document.getElementById('password').value === VALID_PASSWORD) {
        loggedInUser = VALID_USERNAME;
        const urlParams = new URLSearchParams(window.location.search);
        const idQR = urlParams.get('idDispenser');
        if (idQR) {
            idDispenserInput.value = idQR;
            idDispenserInput.readOnly = true;
            idDispenserInput.style.backgroundColor = "#e9ecef";
            document.getElementById('fechaMantenimiento').valueAsDate = new Date();
            showScreen('mantenimientoScreen');
        } else {
            showScreen('optionsScreen');
        }
    } else { document.getElementById('loginMessage').innerText = 'Datos incorrectos'; }
};

// Navegación
document.getElementById('btnHistorialMenu').onclick = () => { renderHistorialDiario(); showScreen('historyScreen'); };
document.getElementById('btnHistorialMaquinas').onclick = () => { renderHistorialMaquinas(); showScreen('historyMaquinasScreen'); };
document.getElementById('searchMaquina').oninput = (e) => renderHistorialMaquinas(e.target.value);
document.getElementById('backFromHistory').onclick = () => showScreen('optionsScreen');
document.getElementById('backFromMaquinas').onclick = () => showScreen('optionsScreen');
document.getElementById('btnLogout').onclick = () => location.href = location.pathname;

document.getElementById('btnMantenimiento').onclick = () => {
    document.getElementById('mantenimientoForm').reset();
    idDispenserInput.readOnly = false;
    idDispenserInput.style.backgroundColor = "#ffffff";
    document.getElementById('fechaMantenimiento').valueAsDate = new Date();
    showScreen('mantenimientoScreen');
};
document.getElementById('btnBidones').onclick = () => { document.getElementById('bidonesForm').reset(); showScreen('bidonesScreen'); };
document.getElementById('backToOptionsFromBidones').onclick = () => showScreen('optionsScreen');
document.getElementById('backToOptionsFromMantenimiento').onclick = () => showScreen('optionsScreen');

// Submits
document.getElementById('mantenimientoForm').onsubmit = async (e) => {
    e.preventDefault();
    const id = idDispenserInput.value;
    const fechaActual = document.getElementById('fechaMantenimiento').value;
    
    // Validación 10 días
    const tx = db.transaction('historial', 'readonly');
    const todos = await new Promise(res => { tx.objectStore('historial').getAll().onsuccess = (e) => res(e.target.result); });
    const duplicado = todos.find(r => {
        if(r.sheet === 'Mantenimiento' && r.idDispenser === id) {
            const diff = (new Date(fechaActual) - new Date(r.fechaMantenimiento)) / (1000*60*60*24);
            return diff >= 0 && diff < 10;
        }
        return false;
    });

    if(duplicado) { mostrarAlerta(`La máquina ${id} ya fue cargada el ${duplicado.fechaMantenimiento}.`); return; }

    const datos = {
        sheet: 'Mantenimiento', usuario: loggedInUser, idDispenser: id,
        fechaMantenimiento: fechaActual,
        lugarDispenser: document.getElementById('lugarDispenser').value,
        sectorDispenser: document.getElementById('sectorDispenser').value,
        observacionesMantenimiento: document.getElementById('observacionesMantenimiento').value
    };

    await guardarLocal(datos);
    mostrarAlerta("Guardado correctamente.");
    showScreen('optionsScreen');
};

document.getElementById('bidonesForm').onsubmit = async (e) => {
    e.preventDefault();
    const datos = {
        sheet: 'Entregas', usuario: loggedInUser,
        cantidadEntregados: document.getElementById('cantidadEntregados').value,
        vaciosRetirados: document.getElementById('vaciosRetirados').value,
        lugar: document.getElementById('lugar').value,
        sector: document.getElementById('sector').value,
        observaciones: document.getElementById('observacionesBidones').value
    };
    await guardarLocal(datos);
    showScreen('optionsScreen');
};

async function guardarLocal(datos) {
    const tx = db.transaction(['pendientes', 'historial'], 'readwrite');
    tx.objectStore('pendientes').add(datos);
    tx.objectStore('historial').add(datos);
    
    intentarEnviarYa(); // Intentar enviar apenas se guarda

    if ('serviceWorker' in navigator && 'SyncManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        reg.sync.register('sync-datos');
    }
}
window.addEventListener('online', intentarEnviarYa);