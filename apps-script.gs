// Publish as a new version of the EXISTING web app deployment.
function respuesta(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function hojaReporte(nombre) {
  if (nombre !== 'Mantenimiento' && nombre !== 'Entregas') throw new Error('Hoja invalida');
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!hoja) throw new Error('No se encontro la hoja ' + nombre);
  return hoja;
}

function columnaId(nombre) {
  return nombre === 'Mantenimiento' ? 9 : 8;
}

function existeReporte(hoja, nombre, id) {
  if (hoja.getLastRow() < 2) return false;
  return hoja.getRange(2, columnaId(nombre), hoja.getLastRow() - 1, 1)
    .getDisplayValues().some(function(row) { return row[0] === id; });
}

function validarColumnaId(hoja, nombre) {
  var encabezado = String(hoja.getRange(1, columnaId(nombre)).getValue() || '').trim();
  if (encabezado && encabezado !== 'idReportes') {
    throw new Error('La columna de idReportes en ' + nombre + ' esta ocupada. Revise las instrucciones de publicacion.');
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var adquirido = false;
  try {
    adquirido = lock.tryLock(10000);
    if (!adquirido) throw new Error('Servidor ocupado. Reintente el envio.');
    var p = e.parameter;
    var nombre = p.sheet;
    var hoja = hojaReporte(nombre);
    validarColumnaId(hoja, nombre);
    var id = String(p.idReportes || '').trim();
    // Older installed clients can still submit without an ID during rollout.
    if (id && existeReporte(hoja, nombre, id)) {
      return respuesta({ ok: true, idReportes: id, duplicate: true });
    }
    var fila;
    if (nombre === 'Mantenimiento') {
      ['idDispenser', 'fechaMantenimiento', 'lugarDispenser', 'sectorDispenser'].forEach(function(campo) {
        if (!String(p[campo] || '').trim()) throw new Error('Falta ' + campo);
      });
      fila = [new Date(), p.usuario || '', p.idDispenser, p.fechaMantenimiento,
        p.lugarDispenser, p.sectorDispenser, p.tecnico || '',
        p.observacionesMantenimiento || '', id, p.deviceId || '', p.dispositivo || '', p.ip || ''];
    } else {
      ['cantidadEntregados', 'vaciosRetirados', 'lugar', 'sector'].forEach(function(campo) {
        if (p[campo] === undefined || String(p[campo]).trim() === '') throw new Error('Falta ' + campo);
      });
      fila = [new Date(), p.usuario || '', p.cantidadEntregados, p.vaciosRetirados,
        p.lugar, p.sector, p.observaciones || '', id];
    }
    if (!hoja.getRange(1, columnaId(nombre)).getValue()) {
      hoja.getRange(1, columnaId(nombre)).setValue('idReportes');
    }
    hoja.appendRow(fila);
    SpreadsheetApp.flush();
    return respuesta({ ok: true, idReportes: id });
  } catch (error) {
    console.error(error);
    return respuesta({ ok: false, error: error.message });
  } finally {
    if (adquirido) lock.releaseLock();
  }
}

function doGet(e) {
  try {
    var p = e.parameter;
    if (p.action === 'status') {
      var id = String(p.idReportes || '').trim();
      if (!id) throw new Error('Falta idReportes');
      var hoja = hojaReporte(p.sheet);
      validarColumnaId(hoja, p.sheet);
      return respuesta({
        idReportes: id,
        confirmed: existeReporte(hoja, p.sheet, id)
      });
    }
    if (p.action !== 'read') throw new Error('Accion invalida');
    var data = [];
    ['Mantenimiento'].forEach(function(nombre) {
      var values = hojaReporte(nombre).getDataRange().getDisplayValues();
      for (var i = 1; i < values.length; i++) {
        var r = values[i];
        if (!r.some(function(value) { return value !== ''; })) continue;
        if (nombre === 'Mantenimiento') {
          data.push({
            fechaCarga: r[0], usuario: r[1], idDispenser: r[2], fechaMantenimiento: r[3],
            lugarDispenser: r[4], sectorDispenser: r[5], tecnico: r[6],
            observacionesMantenimiento: r[7], idReportes: r[8], sheet: nombre
          });
        } else {
          data.push({
            fechaCarga: r[0], usuario: r[1], cantidadEntregados: r[2], vaciosRetirados: r[3],
            lugar: r[4], sector: r[5], observaciones: r[6], idReportes: r[7], sheet: nombre
          });
        }
      }
    });
    return respuesta({ data: data });
  } catch (error) {
    console.error(error);
    return respuesta({ error: error.message });
  }
}
