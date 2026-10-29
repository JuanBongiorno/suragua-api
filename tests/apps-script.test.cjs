const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function server(acquired = true) {
    const rows = { Mantenimiento: [Array(12).fill('header')], Entregas: [Array(8).fill('header')] };
    rows.Mantenimiento[0][8] = 'idReportes';
    rows.Entregas[0][7] = '';
    let releases = 0;
    const context = vm.createContext({
        console: { error() {} },
        LockService: { getScriptLock: () => ({ tryLock: () => acquired, releaseLock: () => releases++ }) },
        ContentService: {
            MimeType: { JSON: 'json' },
            createTextOutput: text => ({ setMimeType: () => JSON.parse(text) })
        },
        SpreadsheetApp: {
            flush() {},
            getActiveSpreadsheet: () => ({
                getSheetByName: name => rows[name] && ({
                    getLastRow: () => rows[name].length,
                    getDataRange: () => ({ getDisplayValues: () => rows[name] }),
                    getRange: (r, c, count = 1) => ({
                        getDisplayValues: () => rows[name].slice(r - 1, r - 1 + count).map(row => [row[c - 1]]),
                        getValue: () => rows[name][r - 1][c - 1],
                        setValue: value => { rows[name][r - 1][c - 1] = value; }
                    }),
                    appendRow: row => rows[name].push(row)
                })
            })
        }
    });
    vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '..', 'apps-script.gs'), 'utf8'), context);
    return { context, rows, releases: () => releases };
}
const report = { sheet: 'Mantenimiento', idReportes: 'test-uuid', idDispenser: '804',
    fechaMantenimiento: '2026-10-29', lugarDispenser: 'Planta', sectorDispenser: 'A', tecnico: 'TEST' };

test('maintenance is confirmed only after append and retries do not duplicate', () => {
    const { context: c, rows } = server();
    assert.equal(c.doGet({ parameter: { action: 'status', ...report } }).confirmed, false);
    assert.equal(c.doPost({ parameter: report }).ok, true);
    assert.equal(c.doGet({ parameter: { action: 'status', ...report } }).confirmed, true);
    assert.equal(c.doPost({ parameter: report }).duplicate, true);
    assert.equal(rows.Mantenimiento.length, 2);
    assert.equal(c.doGet({ parameter: { action: 'read' } }).data[0].idReportes, 'test-uuid');
});
test('deliveries keep existing columns and add ID in H', () => {
    const { context: c, rows } = server();
    const p = { sheet: 'Entregas', idReportes: 'delivery', cantidadEntregados: '0',
        vaciosRetirados: '2', lugar: 'Planta', sector: 'B' };
    assert.equal(c.doPost({ parameter: p }).ok, true);
    assert.equal(rows.Entregas[1][7], 'delivery');
    assert.equal(c.doPost({ parameter: p }).duplicate, true);
    assert.equal(rows.Entregas.length, 2);
});
test('lock timeout does not append or release an unowned lock', () => {
    const s = server(false);
    assert.equal(s.context.doPost({ parameter: report }).ok, false);
    assert.equal(s.rows.Mantenimiento.length, 1);
    assert.equal(s.releases(), 0);
});
test('invalid input returns explicit error without append', () => {
    const { context: c, rows } = server();
    assert.equal(c.doPost({ parameter: { ...report, lugarDispenser: '' } }).ok, false);
    assert.equal(rows.Mantenimiento.length, 1);
    assert.ok(c.doGet({ parameter: { action: 'status', sheet: 'invalid', idReportes: 'x' } }).error);
});
test('occupied delivery ID column is not overwritten', () => {
    const { context: c, rows } = server();
    rows.Entregas[0][7] = 'Otra columna';
    const p = { sheet: 'Entregas', idReportes: 'delivery', cantidadEntregados: '1',
        vaciosRetirados: '0', lugar: 'Planta', sector: 'A' };
    assert.equal(c.doPost({ parameter: p }).ok, false);
    assert.equal(rows.Entregas.length, 1);
    assert.equal(rows.Entregas[0][7], 'Otra columna');
});
test('maintenance history does not require a deliveries sheet', () => {
    const { context: c, rows } = server();
    delete rows.Entregas;
    assert.equal(c.doPost({ parameter: report }).ok, true);
    const response = c.doGet({ parameter: { action: 'read' } });
    assert.equal(response.error, undefined);
    assert.equal(response.data.length, 1);
    assert.equal(response.data[0].idReportes, report.idReportes);
});
