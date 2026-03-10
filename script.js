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
const request = indexedDB.open('SuraguaDB', 2);

request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains('pendientes')) db.createObjectStore('pendientes', { autoIncrement: true });
    if (!db.objectStoreNames.contains('historial')) db.createObjectStore('historial', { autoIncrement: true });
};

request.onsuccess = (e) => { 
    db = e.target.result; 
    intentarSincronizarYa();
};

// --- FUNCIONES DE ALERTA ---
function mostrarAlerta(mensaje) {
    document.getElementById('alertMessage').textContent = mensaje;
    document.getElementById('customAlert').style.display = 'flex';
}
document.getElementById('closeAlert').onclick = () => document.getElementById('customAlert').style.display = 'none';
document.getElementById('btnCerrarAlerta').onclick = () => document.getElementById('customAlert').style.display = 'none';

// --- NAVEGACIÓN ---
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// --- HISTORIAL DE CARGA (RESET DIARIO A LAS 00) ---
async function renderHistorial() {
    const list = document.getElementById('historyList');
    list.innerHTML = 'Cargando registros de hoy...';
    
    const tx = db.transaction('historial', 'readonly');
    const store = tx.objectStore('historial');
    const todos = await new Promise(res => {
        const req = store.getAll();
        req.onsuccess = () => res(req.result);
    });

    // Filtramos para que solo muestre lo que se cargó hoy (Reset diario visual)
    const hoy = new Date().toISOString().split('T')[0];
    const registrosHoy = todos.filter(reg => {
        // Si no tiene fecha de mantenimiento, asumimos que es una entrega de hoy
        const fechaReg = reg.fechaMantenimiento || hoy; 
        return fechaReg === hoy;
    });

    if (registrosHoy.length === 0) {
        list.innerHTML = 'No hay registros cargados hoy.';
        return;
    }

    list.innerHTML = registrosHoy.reverse().map(reg => {
        const esMantenimiento = reg.sheet === 'Mantenimiento';
        return `
            <div class="history-item">
                <strong>${esMantenimiento ? '🛠 Mant.' : '💧 Bidones'}</strong> - ${reg.idDispenser || 'Entrega'}<br>
                <small>${reg.lugarDispenser || reg.lugar} (${reg.sectorDispenser || reg.sector})</small>
            </div>
        `;
    }).join('');
}

// --- HISTORIAL DE MÁQUINAS (CHECKLIST + BUSCADOR) ---
async function renderHistorialMaquinas(filtro = '') {
    const list = document.getElementById('maquinasList');
    const tx = db.transaction('historial', 'readonly');
    const store = tx.objectStore('historial');
    const todos = await new Promise(res => {
        const req = store.getAll();
        req.onsuccess = () => res(req.result);
    });

    // Obtenemos solo los mantenimientos y nos quedamos con el último por cada ID
    const ultimosMantenimientos = {};
    todos.forEach(reg => {
        if (reg.sheet === 'Mantenimiento') {
            ultimosMantenimientos[reg.idDispenser] = reg.fechaMantenimiento;
        }
    });

    const ids = Object.keys(ultimosMantenimientos).filter(id => id.toLowerCase().includes(filtro.toLowerCase()));

    if (ids.length === 0) {
        list.innerHTML = 'No hay máquinas registradas.';
        return;
    }

    list.innerHTML = ids.map(id => `
        <div class="machine-item" onclick="mostrarAlerta('Mantenimiento realizado el: ${ultimosMantenimientos[id]}')">
            <div class="machine-info">
                <strong>ID Dispensador: ${id}</strong>
                <small>Fecha: ${ultimosMantenimientos[id]}</small>
            </div>
            <span class="check-done">✔</span>
        </div>
    `).join('');
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

// Botones de Menú
document.getElementById('btnHistorialMenu').onclick = () => { renderHistorial(); showScreen('historyScreen'); };
document.getElementById('btnHistorialMaquinas').onclick = () => { renderHistorialMaquinas(); showScreen('historyMaquinasScreen'); };
document.getElementById('searchMaquina').oninput = (e) => renderHistorialMaquinas(e.target.value);

document.getElementById('backFromHistory').onclick = () => showScreen('optionsScreen');
document.getElementById('backFromMaquinas').onclick = () => showScreen('optionsScreen');

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

// --- SUBMITS CON VALIDACIÓN DE 10 DÍAS ---
document.getElementById('mantenimientoForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const idActual = idDispenserInput.value;
    const fechaSeleccionada = new Date(document.getElementById('fechaMantenimiento').value);

    // Validar en el historial local si existe este ID en los últimos 10 días
    const tx = db.transaction('historial', 'readonly');
    const store = tx.objectStore('historial');
    const todos = await new Promise(res => {
        const r = store.getAll();
        r.onsuccess = () => res(r.result);
    });

    const coincidencia = todos.find(reg => {
        if (reg.sheet === 'Mantenimiento' && reg.idDispenser === idActual) {
            const fechaReg = new Date(reg.fechaMantenimiento);
            const diferenciaDias = (fechaSeleccionada - fechaReg) / (1000 * 60 * 60 * 24);
            return diferenciaDias >= 0 && diferenciaDias < 10;
        }
        return false;
    });

    if (coincidencia) {
        mostrarAlerta(`El mantenimiento a la máquina ${idActual} ya se realizó el día ${coincidencia.fechaMantenimiento}.`);
        return;
    }

    guardarLocal({
        sheet: 'Mantenimiento', usuario: loggedInUser,
        idDispenser: idActual,
        fechaMantenimiento: document.getElementById('fechaMantenimiento').value,
        lugarDispenser: document.getElementById('lugarDispenser').value,
        sectorDispenser: document.getElementById('sectorDispenser').value,
        observacionesMantenimiento: document.getElementById('observacionesMantenimiento').value
    });
    document.getElementById('mantenimientoMessage').textContent = 'Guardado. Sincronizando...';
    setTimeout(() => { document.getElementById('mantenimientoMessage').textContent = ''; showScreen('optionsScreen'); }, 1500);
});

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

// --- FUNCIONES CORE (Sincronización) ---
async function guardarLocal(datos) {
    const tx = db.transaction(['pendientes', 'historial'], 'readwrite');
    tx.objectStore('pendientes').add(datos);
    tx.objectStore('historial').add(datos);
    if (navigator.onLine) intentarSincronizarYa();
}

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
    for (let reg of registros) {
        const formData = new FormData();
        for (const key in reg.d) formData.append(key, reg.d[key]);
        try {
            await fetch(APPS_SCRIPT_WEB_APP_URL, { method: 'POST', body: formData, mode: 'no-cors' });
            const delTx = db.transaction('pendientes', 'readwrite');
            delTx.objectStore('pendientes').delete(reg.k);
        } catch (e) { console.error("Error envío", e); }
    }
}
window.addEventListener('online', intentarSincronizarYa);