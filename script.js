const idDispenserInput = document.getElementById('idDispenser');
const APPS_SCRIPT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzbjhRNjUE9mPQA0mZubSp374dS0WJlWTTdQ5Oqqc-Rok5rocJrdq9wZ8qnQTczZo8f/exec';

const VALID_USERNAME = '1234';
const VALID_PASSWORD = '1234';
let loggedInUser = '';

// 1. REGISTRO DEL SERVICE WORKER
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.log("Error SW", err));
    });
}

// 2. BASE DE DATOS LOCAL
let db;
const request = indexedDB.open('SuraguaDB', 1);
request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains('pendientes')) db.createObjectStore('pendientes', { autoIncrement: true });
};
request.onsuccess = (e) => { db = e.target.result; intentarSincronizar(); };

// 3. ELEMENTOS Y NAVEGACIÓN
const screens = {
    login: document.getElementById('loginScreen'),
    options: document.getElementById('optionsScreen'),
    bidones: document.getElementById('bidonesScreen'),
    mantenimiento: document.getElementById('mantenimientoScreen')
};

function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
}

// 4. LÓGICA DE LOGIN Y REDIRECCIÓN (QR vs MANUAL)
document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const user = document.getElementById('username').value.toUpperCase();
    const pass = document.getElementById('password').value;

    if (user === VALID_USERNAME && pass === VALID_PASSWORD) {
        loggedInUser = user;
        
        // Revisamos si hay un ID en la URL justo ahora
        const params = new URLSearchParams(window.location.search);
        const idQR = params.get('idDispenser');

        if (idQR) {
            // SI ESCANEÓ QR: Bloqueamos campo y vamos directo
            idDispenserInput.value = idQR;
            idDispenserInput.readOnly = true;
            idDispenserInput.style.backgroundColor = "#e9ecef"; // Gris (bloqueado)
            showScreen('mantenimiento');
        } else {
            // SI ENTRÓ NORMAL: Vamos a opciones
            showScreen('options');
        }
    } else {
        document.getElementById('loginMessage').textContent = 'Credenciales Incorrectas';
    }
});

// 5. BOTONES DEL MENÚ PRINCIPAL
document.getElementById('btnBidones').onclick = () => { 
    showScreen('bidones'); 
    document.getElementById('bidonesForm').reset(); 
};

document.getElementById('btnMantenimiento').onclick = () => { 
    // AL ENTRAR POR AQUÍ ES MANUAL: Desbloqueamos el campo SIEMPRE
    idDispenserInput.value = "";
    idDispenserInput.readOnly = false;
    idDispenserInput.style.backgroundColor = "#ffffff"; // Blanco (editable)
    idDispenserInput.placeholder = "Ingrese ID manualmente";
    
    document.getElementById('mantenimientoForm').reset(); 
    document.getElementById('fechaMantenimiento').valueAsDate = new Date();
    showScreen('mantenimiento');
};

document.getElementById('btnLogout').onclick = () => { 
    loggedInUser = ''; 
    window.location.href = window.location.pathname; // Limpia la URL y reinicia
};

document.getElementById('backToOptionsFromBidones').onclick = () => showScreen('options');
document.getElementById('backToOptionsFromMantenimiento').onclick = () => showScreen('options');

// 6. GUARDADO OFFLINE Y SINCRONIZACIÓN
function guardarLocal(datos) {
    const tx = db.transaction('pendientes', 'readwrite');
    tx.objectStore('pendientes').add(datos);
    intentarSincronizar();
}

async function intentarSincronizar() {
    if (!navigator.onLine) return;
    const tx = db.transaction('pendientes', 'readwrite');
    const store = tx.objectStore('pendientes');
    const all = await new Promise(res => {
        const req = store.getAll();
        const keys = store.getAllKeys();
        req.onsuccess = () => keys.onsuccess = () => res(req.result.map((d, i) => ({ k: keys.result[i], d })));
    });

    for (const item of all) {
        const formData = new FormData();
        for (const key in item.d) formData.append(key, item.d[key]);
        try {
            await fetch(APPS_SCRIPT_WEB_APP_URL, { method: 'POST', body: formData });
            const delTx = db.transaction('pendientes', 'readwrite');
            delTx.objectStore('pendientes').delete(item.k);
        } catch (e) { break; }
    }
}

window.addEventListener('online', intentarSincronizar);

// 7. ENVÍO DE FORMULARIOS
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
    document.getElementById('bidonesMessage').textContent = '¡Guardado! Sincronizando...';
    setTimeout(() => { showScreen('options'); document.getElementById('bidonesMessage').textContent = ''; }, 1500);
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
    document.getElementById('mantenimientoMessage').textContent = '¡Guardado! Sincronizando...';
    setTimeout(() => { showScreen('options'); document.getElementById('mantenimientoMessage').textContent = ''; }, 1500);
});