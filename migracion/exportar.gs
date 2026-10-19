/**
 * ==========================================================
 *  EXPORTAR A SUPABASE · se pega como archivo NUEVO en el Apps Script actual
 *  (Extensiones > Apps Script > "+" > Script > nombre: Exportar) y se ejecuta con el botón ▶.
 *
 *  Qué hace:
 *   · Crea en tu Drive la carpeta «Exportacion Supabase».
 *   · central.json → usuarios (DB_Perfiles), CONTROL_SAAS, FINANZAS_PAGOS, FINANZAS_ESTADO,
 *                     SCRIPTS DE COBRO y ajustes de la app.
 *   · usuario_<UID>.json → por cada cliente: Historial, Base_Clientes, Perfil, finanzas,
 *                     proveedores, herramientas, agenda y sus imágenes (logo y QR).
 *  Si se acerca el límite de 6 minutos se detiene sola: vuelve a ejecutar exportarParaSupabase()
 *  y continúa donde quedó (no repite los usuarios ya exportados).
 *  Cuando el registro diga «EXPORTACIÓN COMPLETA», descarga la carpeta (clic derecho > Descargar).
 * ==========================================================
 */
function exportarParaSupabase() {
  const inicio = Date.now();
  const LIMITE_MS = 5 * 60 * 1000;
  const tz = Session.getScriptTimeZone();
  const carpeta = carpetaExportacion_();

  // Deja la hoja central al día antes de exportar (migraciones pendientes e IDs de CONTROL_SAAS)
  dbPerfiles_();
  migrarControlSaaSV2();
  migrarControlSaaSV3();
  invalidarCacheControl();
  leerFilasControl(getHojaControl());

  const central = central_();
  const db = central.getSheetByName('DB_Perfiles');
  const usuarios = leerHojaExp_(db, 2, DB_NCOLS, tz);

  // ---------- central.json (se rehace cada vez: es pequeño) ----------
  const hojaScripts = obtenerHojaScripts();
  const props = PropertiesService.getScriptProperties();
  const datosCentral = {
    version: 1,
    exportado: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    zonaHoraria: tz,
    adminUid: ADMIN_UID,
    centralId: central.getId(),
    usuarios: usuarios,
    control: leerHojaExp_(getHojaControl(), CONTROL_PRIMERA_FILA, CONTROL_COLS, tz),
    pagos: leerHojaExp_(getHojaPagos(), 2, 11, tz),
    estado: leerHojaExp_(getHojaEstado(), 2, 4, tz),
    scriptsCobro: { s0: hojaScripts.getRange('B6').getValue(), s7: hojaScripts.getRange('B14').getValue(), s15: hojaScripts.getRange('B22').getValue() },
    ajustes: {
      SOPORTE_EMAIL: props.getProperty('SOPORTE_EMAIL') || '',
      SOPORTE_WA: props.getProperty('SOPORTE_WA') || '',
      GOOGLE_CLIENT_ID: props.getProperty('GOOGLE_CLIENT_ID') || '',
      COBRO_ALIAS: props.getProperty('COBRO_ALIAS') || '',
      COBRO_NOMBRE: props.getProperty('COBRO_NOMBRE') || ''
    }
  };
  guardarJsonExp_(carpeta, 'central.json', datosCentral);
  Logger.log('central.json listo: ' + usuarios.valores.length + ' usuarios.');

  // ---------- un archivo por usuario ----------
  const yaExportados = {};
  const archivos = carpeta.getFiles();
  while (archivos.hasNext()) yaExportados[archivos.next().getName()] = true;

  let hechos = 0, pendientes = 0;
  const lista = usuarios.valores.map((f, i) => ({ uid: String(f[DB_COL.UID - 1] || ''), hoja: String(usuarios.visibles[i][DB_COL.HOJA - 1] || '') }))
    .filter(u => u.uid);
  if (!lista.some(u => u.uid === ADMIN_UID)) lista.push({ uid: ADMIN_UID, hoja: central.getId() });

  for (let i = 0; i < lista.length; i++) {
    const u = lista[i];
    const nombre = 'usuario_' + u.uid + '.json';
    if (yaExportados[nombre]) continue;
    if (Date.now() - inicio > LIMITE_MS) { pendientes = lista.length - i; break; }
    const sheetId = u.uid === ADMIN_UID ? central.getId() : u.hoja;
    if (!sheetId) { guardarJsonExp_(carpeta, nombre, { uid: u.uid, sinHoja: true }); hechos++; continue; }
    let ss;
    try { ss = SpreadsheetApp.openById(sheetId); }
    catch (e) { Logger.log('No pude abrir la hoja de ' + u.uid + ': ' + e.message); guardarJsonExp_(carpeta, nombre, { uid: u.uid, error: String(e.message) }); hechos++; continue; }
    guardarJsonExp_(carpeta, nombre, exportarUsuario_(u.uid, ss, tz));
    hechos++;
    Logger.log('Exportado ' + u.uid + ' (' + (i + 1) + '/' + lista.length + ')');
  }

  if (pendientes) Logger.log('Faltan ' + pendientes + ' usuarios. VUELVE A EJECUTAR exportarParaSupabase() para continuar.');
  else Logger.log('EXPORTACIÓN COMPLETA (' + hechos + ' usuarios en esta ejecución). Descarga la carpeta: ' + carpeta.getUrl());
}

function exportarUsuario_(uid, ss, tz) {
  const hoja = n => ss.getSheetByName(n);
  const out = { uid: uid, sheetId: ss.getId(), tablas: {}, imagenes: {} };
  const h = hoja(CONFIG.HOJA_HISTORIAL);
  out.historial = h ? leerHojaExp_(h, 2, 7, tz) : null;
  const c = hoja(CONFIG.HOJA_CLIENTES);
  out.clientes = c ? leerHojaExp_(c, 2, 6, tz) : null;
  const p = hoja('Perfil');
  out.perfil = p ? leerHojaExp_(p, 2, 2, tz) : null;
  Object.keys(ESQUEMAS).forEach(k => {
    const t = hoja(ESQUEMAS[k].hoja);
    out.tablas[k] = t ? leerHojaExp_(t, 2, ESQUEMAS[k].cols.length, tz) : null;
  });

  // Imágenes propias del perfil (logo y QR) guardadas en Drive
  if (out.perfil) {
    let ids = [];
    out.perfil.valores.forEach(r => { if (r[0] === 'imagenes') { try { ids = JSON.parse(r[1] || '[]'); } catch (e) { ids = []; } } });
    (Array.isArray(ids) ? ids : []).forEach(id => {
      try {
        const blob = DriveApp.getFileById(id).getBlob();
        out.imagenes[id] = { mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
      } catch (e) { Logger.log('Imagen ' + id + ' de ' + uid + ' no disponible: ' + e.message); }
    });
  }
  return out;
}

// Devuelve { valores, visibles } desde la fila `desde`, con las fechas como texto ISO en la zona horaria del script
function leerHojaExp_(h, desde, ncols, tz) {
  const n = h.getLastRow();
  if (n < desde) return { valores: [], visibles: [] };
  const rango = h.getRange(desde, 1, n - desde + 1, Math.min(ncols, h.getMaxColumns()));
  const valores = rango.getValues().map(f => f.map(v => v instanceof Date ? Utilities.formatDate(v, tz, "yyyy-MM-dd'T'HH:mm:ssXXX") : v));
  return { valores: valores, visibles: rango.getDisplayValues() };
}

function guardarJsonExp_(carpeta, nombre, datos) {
  const previos = carpeta.getFilesByName(nombre);
  while (previos.hasNext()) previos.next().setTrashed(true);
  carpeta.createFile(Utilities.newBlob(JSON.stringify(datos), 'application/json', nombre));
}

function carpetaExportacion_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('EXPORT_FOLDER_ID');
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* se crea otra */ } }
  const f = DriveApp.createFolder('Exportacion Supabase');
  props.setProperty('EXPORT_FOLDER_ID', f.getId());
  return f;
}
