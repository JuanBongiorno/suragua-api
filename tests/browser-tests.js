// Run only on tests/local-server.cjs, in the app page, after loading this script.
async function runSuraguaBrowserTests() {
    const control = await fetch('/__test');
    if (!control.ok || !Array.isArray((await control.json()).reports)) {
        throw new Error('Use exclusivamente el simulador local.');
    }
    await dbReady;
    const results = [];
    function check(condition, name) {
        if (!condition) throw new Error(name);
        results.push(name);
    }
    async function configure(options) {
        await fetch('/__test', { method: 'POST', body: JSON.stringify(options) });
    }
    const suffix = crypto.randomUUID();
    const record = {
        sheet: 'Mantenimiento', idDispenser: 'TEST-' + suffix, fechaMantenimiento: '2026-01-01',
        lugarDispenser: 'Original', sectorDispenser: 'A', observacionesMantenimiento: 'Anterior'
    };
    await configure({ fail: true });
    await guardarLocal({ ...record });
    await intentarEnviarYa();
    const pending = (await SuraguaData.all(db, 'pendientes')).find(r => r.idDispenser === record.idDispenser);
    check(!!pending?.idReportes, 'UUID persisted while server fails');
    await configure({ hideReceipt: true });
    await intentarEnviarYa();
    check((await SuraguaData.all(db, 'pendientes')).some(r => r.idReportes === pending.idReportes),
        'Unconfirmed report retained');
    await configure({});
    await Promise.all([intentarEnviarYa(), intentarEnviarYa()]);
    check(!(await SuraguaData.all(db, 'pendientes')).some(r => r.idReportes === pending.idReportes),
        'Confirmed report removed from queue');
    const state = await (await fetch('/__test')).json();
    check(state.reports.filter(r => r.idReportes === pending.idReportes).length === 1,
        'Concurrent retries produce one server row');
    const legacy = { ...record, idDispenser: 'LEGACY-' + suffix };
    const tx = db.transaction(['historial', 'pendientes'], 'readwrite');
    const completion = SuraguaData.done(tx);
    tx.objectStore('historial').add(legacy);
    tx.objectStore('pendientes').add(legacy);
    await completion;
    await SuraguaData.migrate(db);
    const migrated = (await SuraguaData.all(db, 'pendientes')).find(r => r.idDispenser === legacy.idDispenser);
    const history = (await SuraguaData.all(db, 'historial')).find(r => r.idDispenser === legacy.idDispenser);
    check(!!migrated.idReportes && migrated.idReportes === history.idReportes,
        'Legacy queue and history receive same persistent UUID');
    await SuraguaData.migrate(db);
    check((await SuraguaData.all(db, 'pendientes')).find(r => r.idDispenser === legacy.idDispenser).idReportes === migrated.idReportes,
        'Migration is idempotent');
    await intentarEnviarYa();
    idDispenserInput.value = record.idDispenser;
    await precargarMaquina();
    check(document.getElementById('lugarDispenser').value === 'Original', 'Known ID prefilled');
    check(!document.getElementById('ultimoMantenimiento').hidden, 'Last maintenance available');
    idDispenserInput.value = 'UNKNOWN-' + suffix;
    await precargarMaquina();
    check(!document.getElementById('lugarDispenser').value && document.getElementById('ultimoMantenimiento').hidden,
        'Unknown ID clears stale machine data');
    const sameDay = ordenarPorFechaDesc([
        { fechaMantenimiento: '2026-01-01', fechaCarga: '01/01/2026 10:00:00' },
        { fechaMantenimiento: '2026-01-01', fechaCarga: '01/01/2026 11:00:00' }
    ]);
    check(sameDay[0].fechaCarga.endsWith('11:00:00'), 'Same-day visits sorted by timestamp');
    return results;
}
