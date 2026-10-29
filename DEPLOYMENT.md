# Actualizacion de mantenimientos y envios

## Publicacion obligatoria del servidor

1. Hacer una copia de seguridad de la planilla y del Apps Script actual.
2. Verificar que la columna I de `Mantenimiento` sea `idReportes` y que la
   columna H de `Entregas` este libre para `idReportes`. No mover columnas existentes.
3. En Extensiones > Apps Script, reemplazar el codigo por `apps-script.gs`.
4. Implementar > Administrar implementaciones > Editar la implementacion web
   existente > Nueva version. Mantener su URL y sus permisos de acceso actuales.
5. Publicar los archivos de la app, incluyendo `data.js` y `sw.js`.
6. Cerrar otras pestanas de la app y volver a abrirla conectado para descargar
   la nueva version y el historial antes de salir sin conexion.

La consulta de historial requiere solo `Mantenimiento`, igual que la version
anterior. `Entregas` se necesita unicamente si se utiliza la carga de bidones;
si no existe, esos envios quedan pendientes y muestran un error de confirmacion.

La app conserva pendientes hasta verificar el ID en Sheets mediante
`action=status`. Si el servidor no esta actualizado, muestra un error y
mantiene los pendientes; no debe interpretarse como confirmacion.

## Comportamiento

- Cada reporte nuevo tiene un UUID. Los pendientes antiguos reciben uno al
  actualizar, sin borrar el historial ni cambiar el ID de la maquina.
- Los reintentos consultan primero el recibo y el servidor evita duplicados
  bajo bloqueo. Un reporte antiguo que ya llego sin ID pero seguia pendiente
  puede duplicarse durante la migracion: no hay identificador anterior con
  el que verificarlo automaticamente.
- Ubicacion y sector se precargan desde el ultimo mantenimiento conocido y
  pueden editarse. Las observaciones nuevas no copian las anteriores.
- La consulta del ultimo mantenimiento y el bloqueo de 10 dias usan el historial
  local y remoto guardado. Sin conexion no es posible conocer visitas de otro
  dispositivo posteriores a la ultima descarga.
- El envio se intenta al guardar, abrir la app, recuperar conexion, manualmente
  y cada 30 segundos mientras esta abierta. El envio con la app cerrada depende
  del soporte del navegador para Background Sync; reabrirla permite reintentar.
- No borrar datos del navegador ni reinstalar si hay reportes pendientes.
  Los reportes historicos borrados previamente de la cola no se reenvian
  automaticamente: requieren comparar el historial local con Sheets.

## Pruebas

Las pruebas locales no deben enviar datos a la planilla real. Usar un servidor
simulado para comprobar guardado offline, reapertura offline, precarga,
consulta, cambio de ubicacion, bloqueo de 10 dias, reintentos, fallos y
confirmacion sin duplicados. Despues de publicar Apps Script, realizar una
carga controlada autorizada y verificar su UUID en la fila de Sheets.

Pruebas del contrato del servidor: `node --test tests\apps-script.test.cjs`.

Simulador sin dependencias: `node tests\local-server.cjs`, luego abrir
`http://127.0.0.1:8765`. Reescribe la URL de Google a un endpoint local incluso
para el service worker. Usa solo datos en memoria; no publica ni escribe en Sheets.
Con la pagina del simulador abierta, ejecutar en la consola del navegador:

```js
const script = document.createElement('script');
script.src = '/tests/browser-tests.js';
script.onload = async () => console.table(await runSuraguaBrowserTests());
document.head.appendChild(script);
```

Esto prueba persistencia, recibos, reintentos, migracion y precarga.
No ejecutar contra el sitio de produccion.
Para pruebas offline reales usar el modo Offline de las herramientas del
navegador, guardar, recargar, verificar precarga y volver a Online.

El navegador integrado utilizado en las pruebas no permite programar Background
Sync. Se verifico el manejador del service worker disparando un evento de prueba
y comprobando que conserva pendientes sin recibo y los elimina tras confirmarlos.
La programacion automatica con la app cerrada debe verificarse adicionalmente
en los telefonos y navegadores utilizados por los tecnicos.
