const idDispenserInput = document.getElementById('idDispenser');
const APPS_SCRIPT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyUWgnLwIgXV-aKysdwH_4n9Z0SwekLYzGlk1GISiAHc6L8_Y78_0CmHRe2m1Xo1t-6/exec';

// Configuración de usuarios y credenciales
const USUARIOS_VALIDOS = {
    'GAMBOA': '94998028',
    'HERLEIN': '39273339'
};

const USE_SERVICE_WORKER_SYNC = 'serviceWorker' in navigator && 'SyncManager' in window;
let loggedInUser = '';
let datosRemotos = []; // Almacena historial del Google Sheet

// Identificación automática de dispositivo e IP
let currentDeviceId = localStorage.getItem('suragua_device_id');
if (!currentDeviceId) {
    currentDeviceId = 'DEV-' + Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    localStorage.setItem('suragua_device_id', currentDeviceId);
}

function getDeviceInfo() {
    const ua = navigator.userAgent || '';
    let modelo = 'PC / Navegador';
    if (/android/i.test(ua)) {
        const match = ua.match(/Android\s+([\d\.]+);?\s*([^;]+?)\s*Build/i);
        modelo = match ? `${match[2].trim()} (Android ${match[1]})` : 'Android';
    } else if (/iphone|ipad|ipod/i.test(ua)) {
        modelo = 'iPhone / iOS';
    } else if (/windows/i.test(ua)) {
        modelo = 'Windows PC';
    }
    return modelo;
}

let currentIp = 'Sin conexión';
async function actualizarIp() {
    try {
        const res = await fetch('https://api.ipify.org?format=json');
        const data = await res.json();
        if (data && data.ip) currentIp = data.ip;
    } catch(e) {
        // En caso de offline o bloqueo
    }
}
actualizarIp();
window.addEventListener('online', actualizarIp);

// Manejo del selector de usuarios y contraseña
const usernameSelect = document.getElementById('username');
const passwordInput = document.getElementById('password');

if (usernameSelect && passwordInput) {
    usernameSelect.addEventListener('change', () => {
        if (usernameSelect.value) {
            passwordInput.disabled = false;
            passwordInput.focus();
        } else {
            passwordInput.disabled = true;
            passwordInput.value = '';
        }
    });

    // Permitir enviar con Enter en cualquier campo del formulario
    passwordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('loginForm').requestSubmit();
        }
    });
}

function parseFechaMantenimiento(fecha) {
    if (!fecha) return null;
    const valor = fecha.toString().trim();
    const crearFecha = (str) => {
        const d = new Date(str);
        return Number.isNaN(d.getTime()) ? null : d;
    };

    const isoMatch = valor.match(/^\d{4}-\d{2}-\d{2}([ T].*)?$/);
    if (isoMatch) return crearFecha(valor.replace(' ', 'T'));

    const parts = valor.split(/[\/\.-]/).map(p => p.trim());
    if (parts.length === 3) {
        let [p1, p2, p3] = parts;
        let dia, mes, ano;
        if (p1.length === 4) {
            // Formato YYYY/MM/DD o YYYY.MM.DD
            ano = p1;
            mes = p2.padStart(2, '0');
            dia = p3.padStart(2, '0');
        } else if (p3.length === 4) {
            // Formato DD/MM/YYYY o MM/DD/YYYY
            ano = p3;
            const num1 = Number(p1);
            const num2 = Number(p2);
            if (num1 > 12) {
                dia = p1.padStart(2, '0');
                mes = p2.padStart(2, '0');
            } else if (num2 > 12) {
                dia = p2.padStart(2, '0');
                mes = p1.padStart(2, '0');
            } else {
                dia = p1.padStart(2, '0');
                mes = p2.padStart(2, '0');
            }
        } else if (p3.length === 2) {
            // Formato DD/MM/YY o MM/DD/YY
            ano = p3 >= '70' ? '19' + p3 : '20' + p3;
            const num1 = Number(p1);
            const num2 = Number(p2);
            if (num1 > 12) {
                dia = p1.padStart(2, '0');
                mes = p2.padStart(2, '0');
            } else if (num2 > 12) {
                dia = p2.padStart(2, '0');
                mes = p1.padStart(2, '0');
            } else {
                dia = p1.padStart(2, '0');
                mes = p2.padStart(2, '0');
            }
        } else {
            return crearFecha(valor);
        }
        return crearFecha(`${ano}-${mes}-${dia}T00:00:00`);
    }

    return crearFecha(valor.replace(/\s+/g, 'T'));
}

function getFechaRegistro(registro) {
    const fecha = parseFechaMantenimiento(registro.fechaMantenimiento || registro.fechaCarga || '');
    return fecha;
}

function ordenarPorFechaDesc(registros) {
    return registros.slice().sort((a, b) => {
        const fechaA = getFechaRegistro(a);
        const fechaB = getFechaRegistro(b);
        if (!fechaA && !fechaB) return 0;
        if (!fechaA) return 1;
        if (!fechaB) return -1;
        return fechaB.getTime() - fechaA.getTime();
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
    if (navigator.onLine) intentarEnviarYa(); 
    verificarSesionGuardada(); // PERSISTENCIA
    descargarHistorialRemoto(); // CARGAR HISTORIAL DE LA NUBE
};

// PERSISTENCIA DE SESIÓN
function verificarSesionGuardada() {
    const sUser = localStorage.getItem('suragua_user');
    const sPass = localStorage.getItem('suragua_pass');
    if (sUser && USUARIOS_VALIDOS[sUser] && USUARIOS_VALIDOS[sUser] === sPass) {
        loggedInUser = sUser;
        actualizarCamposTecnico();
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

function actualizarCamposTecnico() {
    const tecnicoInput = document.getElementById('tecnicoMantenimiento');
    if (tecnicoInput) {
        tecnicoInput.value = loggedInUser;
    }
    const usuarioMantInput = document.getElementById('usuarioMantenimiento');
    if (usuarioMantInput) {
        usuarioMantInput.value = 'TOYOTA';
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

    const ordenados = ordenarPorFechaDesc(filtrados);

    // Renderizado detallado por tipo de carga
    list.innerHTML = ordenados.map(r => {
        if (r.sheet === 'Mantenimiento') {
            return `
            <div style="padding:12px; border-bottom:2px solid #0056b3; font-size:13px; background-color: #f8f9fa; margin-bottom: 10px; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                <div style="color: #0056b3; font-weight: bold; font-size: 14px; margin-bottom: 6px; border-bottom: 1px solid #dee2e6; padding-bottom: 4px;">
                    🛠 MANTENIMIENTO - ID: ${r.idDispenser}
                </div>
                <div style="display: grid; grid-template-columns: 1fr; gap: 4px;">
                    <span><b>📍 Ubicación:</b> ${r.lugarDispenser}</span>
                    <span><b>🏢 Sector:</b> ${r.sectorDispenser}</span>
                    <span><b>🏢 Cliente:</b> ${r.usuario || 'N/A'}</span>
                    <span><b>🔧 Técnico:</b> ${r.tecnico || 'N/A'}</span>
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
            🏢 Cliente: ${r.usuario || 'N/A'} | 🔧 Técnico: ${r.tecnico || 'N/A'}<br>
            📝 Observaciones: ${r.observacionesMantenimiento || 'Sin observaciones'}
        </div>`).join('');
}

// Login con URL Param
document.getElementById('loginForm').onsubmit = (e) => {
    e.preventDefault();
    const u = document.getElementById('username').value;
    const p = document.getElementById('password').value;
    if (u && USUARIOS_VALIDOS[u] && USUARIOS_VALIDOS[u] === p) {
        loggedInUser = u;
        localStorage.setItem('suragua_user', u); // PERSISTENCIA
        localStorage.setItem('suragua_pass', p); // PERSISTENCIA
        actualizarCamposTecnico();
        document.getElementById('loginMessage').innerText = '';
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
    } else { 
        document.getElementById('loginMessage').innerText = 'Usuario o contraseña incorrectos'; 
    }
};

// Navegación
document.getElementById('btnHistorialMenu').onclick = () => { renderHistorialDiario(); showScreen('historyScreen'); };
document.getElementById('btnHistorialMaquinas').onclick = async () => { await descargarHistorialRemoto(); showScreen('historyMaquinasScreen'); };
document.getElementById('searchMaquina').oninput = (e) => renderHistorialMaquinas(e.target.value);
document.getElementById('backFromHistory').onclick = () => showScreen('optionsScreen');
document.getElementById('backFromMaquinas').onclick = () => showScreen('optionsScreen');
document.getElementById('btnLogout').onclick = () => {
    localStorage.clear();
    location.href = location.pathname;
};

document.getElementById('btnMantenimiento').onclick = () => {
    document.getElementById('mantenimientoForm').reset();
    actualizarCamposTecnico();
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
    const fechaActualDate = parseFechaMantenimiento(fechaActual);
    const duplicado = combinados.find(r => {
        if (r.sheet === 'Mantenimiento' && r.idDispenser.toString() === id.toString()) {
            const fechaRegistro = parseFechaMantenimiento(r.fechaMantenimiento);
            if (!fechaRegistro || !fechaActualDate) return false;
            const diff = (fechaActualDate - fechaRegistro) / (1000*60*60*24);
            return diff >= 0 && diff < 10;
        }
        return false;
    });

    if(duplicado) { mostrarAlerta(`La máquina ${id} ya fue cargada el ${duplicado.fechaMantenimiento}.`); return; }

    btn.disabled = true; // BLOQUEO PARA GOOGLE SHEET
    btn.innerText = "Guardando...";

    const datos = {
        sheet: 'Mantenimiento',
        usuario: document.getElementById('usuarioMantenimiento') ? document.getElementById('usuarioMantenimiento').value : 'TOYOTA',
        tecnico: loggedInUser,
        idDispenser: id,
        fechaMantenimiento: fechaActual,
        lugarDispenser: document.getElementById('lugarDispenser').value,
        sectorDispenser: document.getElementById('sectorDispenser').value,
        observacionesMantenimiento: document.getElementById('observacionesMantenimiento').value,
        deviceId: currentDeviceId,
        dispositivo: getDeviceInfo(),
        ip: currentIp
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
    await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
    
    if (navigator.onLine) {
        intentarEnviarYa();
    } else if (USE_SERVICE_WORKER_SYNC) {
        const reg = await navigator.serviceWorker.ready;
        reg.sync.register('sync-datos');
    }
}
window.addEventListener('online', intentarEnviarYa);