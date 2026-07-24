const idDispenserInput = document.getElementById('idDispenser');
const APPS_SCRIPT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxWDTpn_p9OTg1uVwAM_Q2wMn4zBIdLf31UMSxUC35Bb1rOnmIOZtq1gEAbRmdtuyew/exec';
const VALID_USERNAME = '1234';
const VALID_PASSWORD = '1234';
let loggedInUser = '';
let datosRemotos = []; // Almacena historial del Google Sheet

function parseFechaMantenimiento(fecha) {
    if (!fecha) return null;
    const valor = fecha.toString().trim();
    const isoMatch = valor.match(/^\d{4}-\d{2}-\d{2}$/);
    if (isoMatch) return new Date(valor + 'T00:00:00');
    const parts = valor.split(/[\/\.-]/).map(p => p.trim());
    if (parts.length === 3) {
        let [dia, mes, ano] = parts;
        if (ano.length === 2) {
            ano = ano >= '70' ? '19' + ano : '20' + ano;
        }
        if (dia.length === 1) dia = '0' + dia;
        if (mes.length === 1) mes = '0' + mes;
        return new Date(`${ano}-${mes}-${dia}T00:00:00`);
    }
    const parsed = new Date(valor);
    return isNaN(parsed.getTime()) ? null : parsed;
}

function ordenarPorFechaDesc(registros) {
    return registros.slice().sort((a, b) => {
        const fechaA = parseFechaMantenimiento(a.fechaMantenimiento);
        const fechaB = parseFechaMantenimiento(b.fechaMantenimiento);
        if (!fechaA && !fechaB) return 0;
        if (!fechaA) return 1;
        if (!fechaB) return -1;
        return fechaB - fechaA;
    });
}

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
    intentarEnviarYa(); 
    verificarSesionGuardada(); // PERSISTENCIA
    descargarHistorialRemoto(); // CARGAR HISTORIAL DE LA NUBE
};

// PERSISTENCIA DE SESIÓN
function verificarSesionGuardada() {
    const sUser = localStorage.getItem('suragua_user');
    const sPass = localStorage.getItem('suragua_pass');
    if (sUser === VALID_USERNAME && sPass === VALID_PASSWORD) {
        loggedInUser = sUser;
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
    }
}

// DESCARGAR HISTORIAL DESDE GOOGLE SHEET
async function descargarHistorialRemoto() {
    if (!navigator.onLine) return;
    try {
        const response = await fetch(APPS_SCRIPT_WEB_APP_URL + "?action=read");
        const json = await response.json();
        if (json && json.data) {
            datosRemotos = json.data;
        }
    } catch (e) { console.error("Error al descargar historial", e); }
}

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

// Historial Diario - ACTUALIZADO PARA MOSTRAR DATOS COMPLETOS
async function renderHistorialDiario() {
    const list = document.getElementById('historyList');
    list.innerHTML = '<div style="text-align:center; padding:20px;">Cargando historial...</div>';
    
    const tx = db.transaction('historial', 'readonly');
    const local = await new Promise(res => { tx.objectStore('historial').getAll().onsuccess = (e) => res(e.target.result); });
    
    const hoy = new Date().toISOString().split('T')[0];
    const combinados = [...local, ...datosRemotos];
    
    // Filtrar por los que tengan fecha de hoy
    const filtrados = combinados.filter(r => (r.fechaMantenimiento || r.fechaCarga || "").includes(hoy));
    
    if (filtrados.length === 0) {
        list.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">No hay registros cargados hoy.</div>';
        return;
    }

    // Renderizado detallado por tipo de carga
    list.innerHTML = filtrados.reverse().map(r => {
        if (r.sheet === 'Mantenimiento') {
            return `
            <div style="padding:12px; border-bottom:2px solid #0056b3; font-size:13px; background-color: #f8f9fa; margin-bottom: 10px; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                <div style="color: #0056b3; font-weight: bold; font-size: 14px; margin-bottom: 6px; border-bottom: 1px solid #dee2e6; padding-bottom: 4px;">
                    🛠 MANTENIMIENTO - ID: ${r.idDispenser}
                </div>
                <div style="display: grid; grid-template-columns: 1fr; gap: 4px;">
                    <span><b>📍 Ubicación:</b> ${r.lugarDispenser}</span>
                    <span><b>🏢 Sector:</b> ${r.sectorDispenser}</span>
                    <span><b>👤 Operario:</b> ${r.usuario}</span>
                    <span><b>📅 Fecha:</b> ${r.fechaMantenimiento}</span>
                    <div style="margin-top:5px; padding-top:5px; border-top:1px dashed #ccc; color: #555;">
                        <b>📝 Observaciones:</b><br>${r.observacionesMantenimiento || '<i>Sin observaciones</i>'}
                    </div>
                </div>
            </div>`;
        } else {
            return `
            <div style="padding:12px; border-bottom:2px solid #28a745; font-size:13px; background-color: #f0fdf4; margin-bottom: 10px; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                <div style="color: #28a745; font-weight: bold; font-size: 14px; margin-bottom: 6px; border-bottom: 1px solid #dee2e6; padding-bottom: 4px;">
                    💧 ENTREGA DE BIDONES
                </div>
                <div style="display: grid; grid-template-columns: 1fr; gap: 4px;">
                    <span><b>📍 Lugar:</b> ${r.lugar}</span>
                    <span><b>🏢 Sector:</b> ${r.sector}</span>
                    <span><b>📦 Cant. Entregados:</b> ${r.cantidadEntregados}</span>
                    <span><b>🔄 Vacíos Retirados:</b> ${r.vaciosRetirados}</span>
                    <span><b>👤 Por:</b> ${r.usuario}</span>
                    <div style="margin-top:5px; padding-top:5px; border-top:1px dashed #ccc; color: #555;">
                        <b>📝 Observaciones:</b><br>${r.observaciones || '<i>Sin observaciones</i>'}
                    </div>
                </div>
            </div>`;
        }
    }).join('');
}

// Historial Máquinas
async function renderHistorialMaquinas(busqueda = '') {
    const list = document.getElementById('maquinasList');
    if (!busqueda) { list.innerHTML = 'Ingresa un ID para buscar...'; return; }
    
    const tx = db.transaction('historial', 'readonly');
    const local = await new Promise(res => { tx.objectStore('historial').getAll().onsuccess = (e) => res(e.target.result); });
    const combinados = [...local, ...datosRemotos];
    
    // Filtro estricto por ID
    const filtrados = combinados.filter(r => 
        r.sheet === 'Mantenimiento' && 
        r.idDispenser.toString().trim() === busqueda.toString().trim()
    );

    if (filtrados.length === 0) {
        list.innerHTML = `No se encontró historial para: ${busqueda}`;
        return;
    }

    const ordenados = ordenarPorFechaDesc(filtrados);
    list.innerHTML = ordenados.map(r => `
        <div style="padding:10px; border-bottom:1px solid #ddd; font-size:12px; background:#f9f9f9; margin-bottom:5px;">
            <b>📅 Fecha: ${r.fechaMantenimiento}</b><br>
            📍 Ubicación: ${r.lugarDispenser} | Sector: ${r.sectorDispenser}<br>
            👤 Operario: ${r.usuario}<br>
            📝 Observaciones: ${r.observacionesMantenimiento || 'Sin observaciones'}
        </div>`).join('');
}

// Login con URL Param
document.getElementById('loginForm').onsubmit = (e) => {
    e.preventDefault();
    const u = document.getElementById('username').value;
    const p = document.getElementById('password').value;
    if (u === VALID_USERNAME && p === VALID_PASSWORD) {
        loggedInUser = VALID_USERNAME;
        localStorage.setItem('suragua_user', u); // PERSISTENCIA
        localStorage.setItem('suragua_pass', p); // PERSISTENCIA
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
document.getElementById('btnHistorialMaquinas').onclick = () => { descargarHistorialRemoto(); showScreen('historyMaquinasScreen'); };
document.getElementById('searchMaquina').oninput = (e) => renderHistorialMaquinas(e.target.value);
document.getElementById('backFromHistory').onclick = () => showScreen('optionsScreen');
document.getElementById('backFromMaquinas').onclick = () => showScreen('optionsScreen');
document.getElementById('btnLogout').onclick = () => {
    localStorage.clear();
    location.href = location.pathname;
};

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

// Submits - PREVENCIÓN DE DUPLICADOS
document.getElementById('mantenimientoForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    if(btn.disabled) return; 

    const id = idDispenserInput.value;
    const fechaActual = document.getElementById('fechaMantenimiento').value;
    
    // Validación 10 días
    const tx = db.transaction('historial', 'readonly');
    const local = await new Promise(res => { tx.objectStore('historial').getAll().onsuccess = (e) => res(e.target.result); });
    const combinados = [...local, ...datosRemotos];
    const duplicado = combinados.find(r => {
        if(r.sheet === 'Mantenimiento' && r.idDispenser.toString() === id.toString()) {
            const diff = (new Date(fechaActual) - new Date(r.fechaMantenimiento)) / (1000*60*60*24);
            return diff >= 0 && diff < 10;
        }
        return false;
    });

    if(duplicado) { mostrarAlerta(`La máquina ${id} ya fue cargada el ${duplicado.fechaMantenimiento}.`); return; }

    btn.disabled = true; // BLOQUEO PARA GOOGLE SHEET
    btn.innerText = "Guardando...";

    const datos = {
        sheet: 'Mantenimiento', usuario: loggedInUser, idDispenser: id,
        fechaMantenimiento: fechaActual,
        lugarDispenser: document.getElementById('lugarDispenser').value,
        sectorDispenser: document.getElementById('sectorDispenser').value,
        observacionesMantenimiento: document.getElementById('observacionesMantenimiento').value
    };

    await guardarLocal(datos);
    mostrarAlerta("Guardado correctamente.");
    btn.disabled = false;
    btn.innerText = "Guardar Datos Mantenimiento";
    showScreen('optionsScreen');
};

document.getElementById('bidonesForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    if(btn.disabled) return;
    btn.disabled = true;
    btn.innerText = "Guardando...";

    const datos = {
        sheet: 'Entregas', usuario: loggedInUser,
        cantidadEntregados: document.getElementById('cantidadEntregados').value,
        vaciosRetirados: document.getElementById('vaciosRetirados').value,
        lugar: document.getElementById('lugar').value,
        sector: document.getElementById('sector').value,
        observaciones: document.getElementById('observacionesBidones').value
    };
    await guardarLocal(datos);
    btn.disabled = false;
    btn.innerText = "Guardar Datos Bidones";
    showScreen('optionsScreen');
};

async function guardarLocal(datos) {
    const tx = db.transaction(['pendientes', 'historial'], 'readwrite');
    tx.objectStore('pendientes').add(datos);
    tx.objectStore('historial').add(datos);
    
    intentarEnviarYa();

    if ('serviceWorker' in navigator && 'SyncManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        reg.sync.register('sync-datos');
    }
}
window.addEventListener('online', intentarEnviarYa);