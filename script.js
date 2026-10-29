const idDispenserInput = document.getElementById('idDispenser');

// Configuración de usuarios y credenciales
const USUARIOS_VALIDOS = {
    'GAMBOA': '94992028',
    'HERLEIN': '39273339'
};

const USE_SERVICE_WORKER_SYNC = 'serviceWorker' in navigator && 'SyncManager' in window;
let loggedInUser = '';
let datosRemotos = []; // Almacena historial del Google Sheet
let ultimaSincronizacion = '';
let machineLookup = 0;
let remoteDownload;
let remoteDownloadedAt = 0;
let remoteDownloadFailed = false;

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
    const conHora = valor.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (conHora) {
        const [, dia, mes, ano, hora, minuto, segundo = '00'] = conHora;
        return crearFecha(`${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}T${hora.padStart(2, '0')}:${minuto}:${segundo}`);
    }

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
        return fechaB.getTime() - fechaA.getTime() ||
            (parseFechaMantenimiento(b.fechaCarga)?.getTime() || 0) -
            (parseFechaMantenimiento(a.fechaCarga)?.getTime() || 0);
    });
}

// Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(reg => reg.update())
            .catch(error => { console.error(error); mostrarAlerta('No se pudo preparar el modo sin conexion.'); });
    });
}

// Base de Datos IndexedDB
let db;
const dbReady = SuraguaData.open().then(async database => {
    db = database;
    await SuraguaData.migrate(db);
    const cache = await SuraguaData.cached(db);
    datosRemotos = cache ? cache.data : [];
    ultimaSincronizacion = cache ? cache.updatedAt : '';
    verificarSesionGuardada();
    await actualizarEstadoEnvios();
    if (navigator.onLine) {
        intentarEnviarYa();
        descargarHistorialRemoto();
    }
    return db;
});
dbReady.catch(error => {
    console.error('Error de base local', error);
    mostrarAlerta('No se pudo abrir el almacenamiento local. No cierre ni borre los datos de la app.');
});

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
            precargarMaquina();
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
    if (remoteDownload) return remoteDownload;
    remoteDownload = (async () => {
        try {
            const cache = await SuraguaData.download(db);
            datosRemotos = cache.data;
            ultimaSincronizacion = cache.updatedAt;
            remoteDownloadedAt = Date.now();
            remoteDownloadFailed = false;
        } catch (e) {
            remoteDownloadFailed = true;
            console.error("Error al descargar historial", e);
            document.getElementById('machineStatus').textContent = 'No se pudo actualizar el historial. Se usaran los datos guardados en este dispositivo.';
        } finally {
            remoteDownload = null;
        }
    })();
    return remoteDownload;
}

function normalizarId(id) { return String(id || '').trim(); }

function combinarHistorial(local) {
    const ids = new Set();
    return [...local, ...datosRemotos].filter(registro => {
        if (!registro.idReportes) return true;
        if (ids.has(registro.idReportes)) return false;
        ids.add(registro.idReportes);
        return true;
    });
}

async function precargarMaquina(actualizarRemoto = true) {
    const lookup = ++machineLookup;
    const id = normalizarId(idDispenserInput.value);
    const details = document.getElementById('ultimoMantenimiento');
    const status = document.getElementById('machineStatus');
    details.hidden = true;
    details.open = false;
    document.getElementById('lugarDispenser').value = '';
    document.getElementById('sectorDispenser').value = '';
    status.textContent = id ? 'Buscando datos guardados...' : '';
    if (!id) return;
    try {
        await dbReady;
        const local = await SuraguaData.all(db, 'historial');
        if (lookup !== machineLookup || id !== normalizarId(idDispenserInput.value)) return;
        const registros = ordenarPorFechaDesc([...local, ...datosRemotos].filter(r =>
            r.sheet === 'Mantenimiento' && normalizarId(r.idDispenser) === id));
        const ultimo = registros[0];
        const referencia = ultimaSincronizacion
            ? ' Historial descargado: ' + new Date(ultimaSincronizacion).toLocaleString()
            : ' Sin historial remoto descargado.';
        status.textContent = (navigator.onLine ? '' : 'Sin conexion. ') +
            (remoteDownloadFailed ? 'No se pudo actualizar el historial. ' : '') +
            (ultimo ? 'Datos guardados de esta maquina.' : 'Sin datos guardados para este ID; complete la ubicacion y el sector.') + referencia;
        if (ultimo) {
            document.getElementById('lugarDispenser').value = ultimo.lugarDispenser || '';
            document.getElementById('sectorDispenser').value = ultimo.sectorDispenser || '';
            document.getElementById('ultimoMantenimientoInfo').textContent =
                `Fecha: ${ultimo.fechaMantenimiento || ultimo.fechaCarga}\nTecnico: ${ultimo.tecnico || '-'}\nUbicacion: ${ultimo.lugarDispenser || '-'}\nSector: ${ultimo.sectorDispenser || '-'}\nObservaciones: ${ultimo.observacionesMantenimiento || 'Sin observaciones'}`;
            details.hidden = false;
        }
        if (actualizarRemoto && navigator.onLine && Date.now() - remoteDownloadedAt > 30000) {
            await descargarHistorialRemoto();
            if (lookup === machineLookup) await precargarMaquina(false);
        }
    } catch (error) {
        console.error(error);
        status.textContent = 'No se pudieron consultar los datos locales de la maquina.';
    }
}
idDispenserInput.addEventListener('input', () => {
    precargarMaquina();
});
for (const id of ['lugarDispenser', 'sectorDispenser']) {
    document.getElementById(id).addEventListener('input', () => { ++machineLookup; });
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
    let errorMessage = '';
    try {
        await SuraguaData.sync(db);
    } catch (error) {
        console.error(error);
        errorMessage = ' No se pudo confirmar el envio: ' + error.message;
        await registrarReintento();
    }
    await actualizarEstadoEnvios(errorMessage);
}

async function registrarReintento() {
    if (!USE_SERVICE_WORKER_SYNC) return;
    try {
        const reg = await navigator.serviceWorker.ready;
        await reg.sync.register('sync-datos');
    } catch (error) { console.error('No se pudo programar el reintento', error); }
}

async function actualizarEstadoEnvios(errorMessage = '') {
    try {
        const pendientes = await SuraguaData.all(db, 'pendientes');
        document.getElementById('syncStatus').textContent = pendientes.length
            ? `${pendientes.length} reporte(s) guardado(s) en dispositivo, pendiente(s) de confirmacion en Google Sheets.${errorMessage}`
            : 'Sin reportes pendientes. Los reportes con ID enviados fueron confirmados en Google Sheets.';
    } catch (error) {
        console.error(error);
        document.getElementById('syncStatus').textContent = 'No se pudo consultar el estado de los envios.';
    }
}
document.getElementById('btnSync').onclick = () => {
    if (!navigator.onLine) {
        mostrarAlerta('Sin conexion. Los reportes siguen guardados en este dispositivo.');
        return;
    }
    intentarEnviarYa();
};
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', event => {
        if (event.data.type === 'sync-updated' && db) actualizarEstadoEnvios();
    });
}
setInterval(() => { if (db && navigator.onLine) intentarEnviarYa(); }, 30000);

// Historial Diario - ACTUALIZADO PARA MOSTRAR DATOS COMPLETOS
async function renderHistorialDiario() {
    const list = document.getElementById('historyList');
    list.innerHTML = '<div style="text-align:center; padding:20px;">Cargando historial...</div>';
    
    const local = await SuraguaData.all(db, 'historial');
    
    const hoy = new Date().toISOString().split('T')[0];
    const combinados = combinarHistorial(local);
    
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
    
    const local = await SuraguaData.all(db, 'historial');
    const combinados = combinarHistorial(local);
    
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
            precargarMaquina();
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
    localStorage.removeItem('suragua_user');
    localStorage.removeItem('suragua_pass');
    location.href = location.pathname;
};

document.getElementById('btnMantenimiento').onclick = () => {
    document.getElementById('mantenimientoForm').reset();
    actualizarCamposTecnico();
    idDispenserInput.readOnly = false;
    idDispenserInput.style.backgroundColor = "#ffffff";
    document.getElementById('fechaMantenimiento').valueAsDate = new Date();
    showScreen('mantenimientoScreen');
    precargarMaquina();
};
document.getElementById('btnBidones').onclick = () => { document.getElementById('bidonesForm').reset(); showScreen('bidonesScreen'); };
document.getElementById('backToOptionsFromBidones').onclick = () => showScreen('optionsScreen');
document.getElementById('backToOptionsFromMantenimiento').onclick = () => showScreen('optionsScreen');

// Submits - PREVENCIÓN DE DUPLICADOS
document.getElementById('mantenimientoForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    if(btn.disabled) return; 
    btn.disabled = true;
    try {
        await dbReady;
        const id = normalizarId(idDispenserInput.value);
        const fechaActual = document.getElementById('fechaMantenimiento').value;
        const local = await SuraguaData.all(db, 'historial');
        const combinados = combinarHistorial(local);
        const fechaActualDate = parseFechaMantenimiento(fechaActual);
        const duplicado = combinados.find(r => {
            if (r.sheet === 'Mantenimiento' && normalizarId(r.idDispenser) === id) {
                const fechaRegistro = parseFechaMantenimiento(r.fechaMantenimiento);
                if (!fechaRegistro || !fechaActualDate) return false;
                const diff = (fechaActualDate - fechaRegistro) / (1000*60*60*24);
                return diff >= 0 && diff < 10;
            }
            return false;
        });
        if (duplicado) {
            mostrarAlerta(`La máquina ${id} ya fue cargada el ${duplicado.fechaMantenimiento}.`);
            return;
        }
        btn.innerText = "Guardando...";
        const datos = {
            sheet: 'Mantenimiento',
            usuario: document.getElementById('usuarioMantenimiento').value,
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
        mostrarAlerta("Guardado en este dispositivo. Consulte el estado de envio para confirmar su llegada a Google Sheets.");
        showScreen('optionsScreen');
    } catch (error) {
        console.error(error);
        mostrarAlerta('No se pudo guardar el mantenimiento en el dispositivo. No cierre el formulario e intente nuevamente.');
    } finally {
        btn.disabled = false;
        btn.innerText = "Guardar Datos Mantenimiento";
    }
};

document.getElementById('bidonesForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    if(btn.disabled) return;
    btn.disabled = true;
    btn.innerText = "Guardando...";
    try {
        await dbReady;
        const datos = {
            sheet: 'Entregas', usuario: loggedInUser,
            cantidadEntregados: document.getElementById('cantidadEntregados').value,
            vaciosRetirados: document.getElementById('vaciosRetirados').value,
            lugar: document.getElementById('lugar').value,
            sector: document.getElementById('sector').value,
            observaciones: document.getElementById('observacionesBidones').value
        };
        await guardarLocal(datos);
        mostrarAlerta('Guardado en este dispositivo. Consulte el estado de envio.');
        showScreen('optionsScreen');
    } catch (error) {
        console.error(error);
        mostrarAlerta('No se pudo guardar la entrega en el dispositivo. Intente nuevamente sin cerrar el formulario.');
    } finally {
        btn.disabled = false;
        btn.innerText = "Guardar Datos Bidones";
    }
};

async function guardarLocal(datos) {
    datos.idReportes = crypto.randomUUID();
    datos.fechaCarga = new Date().toISOString();
    const tx = db.transaction(['pendientes', 'historial'], 'readwrite');
    tx.objectStore('pendientes').add(datos);
    tx.objectStore('historial').add(datos);
    await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
    
    await actualizarEstadoEnvios();
    if (navigator.onLine) {
        intentarEnviarYa();
    } else if (USE_SERVICE_WORKER_SYNC) {
        registrarReintento();
    }
}
window.addEventListener('online', () => {
    if (!db) return;
    intentarEnviarYa();
    descargarHistorialRemoto();
});
window.addEventListener('offline', () => { if (db) actualizarEstadoEnvios(); });