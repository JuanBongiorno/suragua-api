const idDispenserInput = document.getElementById('idDispenser');
const APPS_SCRIPT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzbjhRNjUE9mPQA0mZubSp374dS0WJlWTTdQ5Oqqc-Rok5rocJrdq9wZ8qnQTczZo8f/exec';

const VALID_USERNAME = '1234';
const VALID_PASSWORD = '1234';
let loggedInUser = '';
let vinoDeQR = false; // Variable para saber si bloquear el ID o no

// 1. REGISTRO DEL SERVICE WORKER (Para trabajar sin internet)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.log("Error SW", err));
    });
}

// 2. BASE DE DATOS LOCAL (IndexedDB)
let db;
const request = indexedDB.open('SuraguaDB', 1);
request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains('pendientes')) db.createObjectStore('pendientes', { autoIncrement: true });
};
request.onsuccess = (e) => { db = e.target.result; intentarSincronizar(); };

// 3. ELEMENTOS
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

// 4. LÓGICA DE DETECCIÓN DE QR
function detectarQR() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('idDispenser');
    if (id) {
        localStorage.setItem('tempDispenserId', id);
        vinoDeQR = true;
    } else {
        vinoDeQR = false;
    }
}
detectarQR();

// 5. LOGIN
document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const user = document.getElementById('username').value.toUpperCase();
    const pass = document.getElementById('password').value;

    if (user === VALID_USERNAME && pass === VALID_PASSWORD) {
        loggedInUser = user;
        const tempId = localStorage.getItem('tempDispenserId');
        
        if (tempId && vinoDeQR) {
            // SI VIENE DE QR: Pone el ID y lo bloquea
            idDispenserInput.value = tempId;
            idDispenserInput.readOnly = true;
            idDispenserInput.style.backgroundColor = "#e9ecef"; // Color gris de bloqueado
            showScreen('mantenimiento');
            localStorage.removeItem('tempDispenserId');
        } else {
            // SI ENTRA NORMAL: Va a opciones
            showScreen('options');
        }
    } else {
        document.getElementById('loginMessage').textContent = 'Credenciales Incorrectas';
    }
});

// 6. BOTONES NAVEGACIÓN
document.getElementById('btnBidones').onclick = () => { 
    showScreen('bidones'); 
    document.getElementById('bidonesForm').reset(); 
};

document.getElementById('btnMantenimiento').onclick = () => { 
    showScreen('mantenimiento'); 
    document.getElementById('mantenimientoForm').reset(); 
    document.getElementById('fechaMantenimiento').valueAsDate = new Date();
    
    // Si entró normal (sin QR), nos aseguramos de que el campo sea editable
    if (!vinoDeQR) {
        idDispenserInput.value = "";
        idDispenserInput.readOnly = false;
        idDispenserInput.style.backgroundColor = "#ffffff"; // Color blanco editable
        idDispenserInput.placeholder = "Escribe el ID manualmente";
    }
};

document.getElementById('btnLogout').onclick = () => { 
    loggedInUser = ''; 
    vinoDeQR = false; // Resetear estado al cerrar sesión
    showScreen('login'); 
};

document.getElementById('backToOptionsFromBidones').onclick = () => showScreen('options');
document.getElementById('backToOptionsFromMantenimiento').onclick = () => showScreen('options');

// 7. FUNCIONES DE GUARDADO RÁPIDO (OFFLINE)
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

// 8. ENVÍO DE FORMULARIOS
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
    document.getElementById('bidonesMessage').textContent = '¡Guardado! Sincronizando en segundo plano...';
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
    document.getElementById('mantenimientoMessage').textContent = '¡Guardado! Sincronizando en segundo plano...';
    setTimeout(() => { showScreen('options'); document.getElementById('mantenimientoMessage').textContent = ''; }, 1500);
});