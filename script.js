const idDispenserInput = document.getElementById('idDispenser');
const APPS_SCRIPT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzbjhRNjUE9mPQA0mZubSp374dS0WJlWTTdQ5Oqqc-Rok5rocJrdq9wZ8qnQTczZo8f/exec';
const VALID_USERNAME = '1234';
const VALID_PASSWORD = '1234';
let loggedInUser = '';

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js'); });
}

let db;
const request = indexedDB.open('SuraguaDB', 1);
request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains('pendientes')) db.createObjectStore('pendientes', { autoIncrement: true });
};
request.onsuccess = (e) => { db = e.target.result; intentarSincronizar(); };

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// LOGIN Y BLOQUEO DE ID
document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const user = document.getElementById('username').value.toUpperCase();
    const pass = document.getElementById('password').value;

    if (user === VALID_USERNAME && pass === VALID_PASSWORD) {
        loggedInUser = user;
        const urlParams = new URLSearchParams(window.location.search);
        const idQR = urlParams.get('idDispenser');

        if (idQR) {
            idDispenserInput.value = idQR;
            idDispenserInput.readOnly = true;
            idDispenserInput.style.backgroundColor = "#e9ecef";
            showScreen('mantenimientoScreen');
        } else {
            idDispenserInput.readOnly = false;
            idDispenserInput.style.backgroundColor = "#ffffff";
            showScreen('optionsScreen');
        }
    } else {
        document.getElementById('loginMessage').textContent = 'Error de usuario/contraseña';
    }
});

// LIMPIEZA TOTAL AL ABRIR FORMULARIOS
document.getElementById('btnMantenimiento').onclick = () => {
    const form = document.getElementById('mantenimientoForm');
    form.reset(); // Limpia campos
    idDispenserInput.value = "";
    idDispenserInput.readOnly = false;
    idDispenserInput.style.backgroundColor = "#ffffff";
    document.getElementById('fechaMantenimiento').valueAsDate = new Date();
    document.getElementById('mantenimientoMessage').textContent = '';
    showScreen('mantenimientoScreen');
};

document.getElementById('btnBidones').onclick = () => {
    document.getElementById('bidonesForm').reset();
    document.getElementById('bidonesMessage').textContent = '';
    showScreen('bidonesScreen');
};

document.getElementById('btnLogout').onclick = () => { window.location.href = window.location.pathname; };
document.getElementById('backToOptionsFromBidones').onclick = () => showScreen('optionsScreen');
document.getElementById('backToOptionsFromMantenimiento').onclick = () => showScreen('optionsScreen');

function guardarLocal(datos) {
    const tx = db.transaction('pendientes', 'readwrite');
    tx.objectStore('pendientes').add(datos);
    intentarSincronizar();
}

async function intentarSincronizar() {
    if (!navigator.onLine || !db) return;
    const tx = db.transaction('pendientes', 'readwrite');
    const store = tx.objectStore('pendientes');
    const req = store.getAll();
    const keysReq = store.getAllKeys();
    
    req.onsuccess = () => {
        keysReq.onsuccess = async () => {
            for (let i = 0; i < req.result.length; i++) {
                const formData = new FormData();
                for (const key in req.result[i]) formData.append(key, req.result[i][key]);
                try {
                    const res = await fetch(APPS_SCRIPT_WEB_APP_URL, { method: 'POST', body: formData });
                    if (res.ok) {
                        const delTx = db.transaction('pendientes', 'readwrite');
                        delTx.objectStore('pendientes').delete(keysReq.result[i]);
                    }
                } catch (e) { break; }
            }
        };
    };
}

window.addEventListener('online', intentarSincronizar);

// ENVÍO DE BIDONES CON LIMPIEZA FORZADA
document.getElementById('bidonesForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    guardarLocal({
        sheet: 'Entregas', usuario: loggedInUser,
        cantidadEntregados: document.getElementById('cantidadEntregados').value,
        vaciosRetirados: document.getElementById('vaciosRetirados').value,
        lugar: document.getElementById('lugar').value,
        sector: document.getElementById('sector').value,
        observaciones: document.getElementById('observacionesBidones').value
    });
    
    document.getElementById('bidonesMessage').textContent = 'Datos guardados y enviando...';
    form.reset(); // LIMPIEZA INMEDIATA
    setTimeout(() => { 
        document.getElementById('bidonesMessage').textContent = '';
        showScreen('optionsScreen'); 
    }, 1500);
});

// ENVÍO DE MANTENIMIENTO CON LIMPIEZA FORZADA
document.getElementById('mantenimientoForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    guardarLocal({
        sheet: 'Mantenimiento', usuario: loggedInUser,
        idDispenser: idDispenserInput.value,
        fechaMantenimiento: document.getElementById('fechaMantenimiento').value,
        lugarDispenser: document.getElementById('lugarDispenser').value,
        sectorDispenser: document.getElementById('sectorDispenser').value,
        observacionesMantenimiento: document.getElementById('observacionesMantenimiento').value
    });
    
    document.getElementById('mantenimientoMessage').textContent = 'Datos guardados y enviando...';
    
    // LIMPIEZA INMEDIATA DE TODOS LOS CAMPOS
    form.reset(); 
    idDispenserInput.value = "";
    
    setTimeout(() => { 
        document.getElementById('mantenimientoMessage').textContent = '';
        showScreen('optionsScreen'); 
    }, 1500);
});