// ==========================================================
//  IMPORTAR A SUPABASE los JSON que genera exportar.gs
//  Uso:
//    1. Descarga la carpeta «Exportacion Supabase» de Drive y descomprímela en migracion/datos/
//    2. Crea el archivo .env (copia de .env.example) con SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
//    3. npm run importar              (o: node --env-file=.env migracion/importar.mjs <carpeta>)
//  Se puede repetir: las tablas del panel se reemplazan y los datos de cada usuario se borran y se vuelven a cargar.
//  Hazlo ANTES de abrir la app nueva a los clientes (lo que se haya cargado en Supabase después se pisaría).
// ==========================================================
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const carpeta = process.argv[2] || 'migracion/datos';
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (archivo .env).'); process.exit(1); }
if (!existsSync(join(carpeta, 'central.json'))) { console.error('No encuentro ' + join(carpeta, 'central.json')); process.exit(1); }

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BUCKET = 'imagenes';

// ---------- utilidades ----------
const ok = ({ data, error }, que) => { if (error) throw new Error((que ? que + ': ' : '') + error.message); return data; };
const leer = f => JSON.parse(readFileSync(join(carpeta, f), 'utf8'));
const s = v => (v === null || v === undefined) ? '' : String(v).trim();
const num = v => { const n = parseFloat(String(v).replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : 0; };
const ent = v => Math.round(num(v));
// "2026-10-18T00:00:00-04:00" o "2026-10-18" → "2026-10-18"; lo demás → null
const fecha = v => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(v)); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
// marca de tiempo con zona horaria (las fechas vienen formateadas con su desfase)
const instante = v => { const t = s(v); if (!/^\d{4}-\d{2}-\d{2}T/.test(t)) return null; const d = new Date(t); return isNaN(d) ? null : d.toISOString(); };
const numeroEntero = v => parseInt(String(v).replace(/\D/g, ''), 10) || 0;

async function insertarPorLotes(tabla, filas, opciones) {
  for (let i = 0; i < filas.length; i += 500) {
    const lote = filas.slice(i, i + 500);
    ok(opciones ? await sb.from(tabla).upsert(lote, opciones) : await sb.from(tabla).insert(lote), tabla);
  }
}

// Columnas de cada pestaña en el MISMO orden que ESQUEMAS del Apps Script → columna en Supabase
const ESQ = {
  ingresos: ['ingresos', ['id', 'fecha:d', 'cliente', 'presupuesto', 'concepto', 'monto:n', 'metodo', 'notas', 'creado']],
  gastos: ['gastos', ['id', 'fecha:d', 'categoria', 'descripcion', 'proveedor', 'monto:n', 'metodo', 'notas', 'creado']],
  porCobrar: ['por_cobrar', ['id', 'fecha:d', 'cliente', 'presupuesto', 'concepto', 'monto:n', 'vence:d', 'estado', 'fecha_cobro:d', 'notas', 'creado', 'rec0', 'rec7', 'rec15']],
  proveedores: ['proveedores', ['id', 'nombre', 'rif', 'telefono', 'correo', 'direccion', 'notas', 'creado']],
  porPagar: ['por_pagar', ['id', 'fecha:d', 'proveedor', 'categoria', 'descripcion', 'monto:n', 'vence:d', 'estado', 'fecha_pago:d', 'notas', 'creado']],
  inventario: ['herramientas', ['id', 'nombre', 'marca', 'categoria', 'cantidad:i', 'estado', 'ubicacion', 'valor:n', 'notas', 'creado']],
  prestamos: ['prestamos', ['id', 'herramienta_id', 'herramienta', 'cantidad:i', 'persona', 'telefono', 'fecha_prestamo:d', 'fecha_prevista:d', 'estado', 'fecha_devolucion:d', 'notas', 'creado']],
  citas: ['citas', ['id', 'fecha:d', 'hora', 'duracion:i', 'cliente', 'telefono', 'servicio', 'direccion', 'estado', 'notas', 'creado']]
};
const TABLAS_USUARIO = ['presupuestos', 'clientes', ...Object.values(ESQ).map(e => e[0])];

// ==========================================================
//  1. HOJA CENTRAL
// ==========================================================
const central = leer('central.json');
console.log('Exportación del ' + central.exportado + ' · zona horaria ' + central.zonaHoraria);

// --- usuarios (DB_Perfiles: UID, NOMBRE, ESPECIALIDAD, ESTATUS, CORREO, HOJA_ID, TELEFONO, FECHA REGISTRO, ROL)
const usuarios = [];
const vistos = new Set();
central.usuarios.valores.forEach((f, i) => {
  const uid = s(f[0]);
  if (!uid || vistos.has(uid)) return;
  vistos.add(uid);
  const vis = central.usuarios.visibles[i];
  usuarios.push({
    uid, nombre: s(f[1]), especialidad: s(f[2]), estado: s(f[3]) || 'Autorizado', correo: s(f[4]), hoja_id: s(f[5]),
    telefono: s(vis[6]), fecha_registro: instante(f[7]), rol: s(f[8]) || 'Cliente'
  });
});
if (!vistos.has(central.adminUid)) usuarios.push({ uid: central.adminUid, estado: 'Autorizado', rol: 'Administrador', fecha_registro: new Date().toISOString() });
await insertarPorLotes('usuarios', usuarios, { onConflict: 'uid' });
console.log('usuarios:', usuarios.length);

// --- CONTROL_SAAS (A plan · B correo · C monto · D cobrado · E f.susc · F f.pago · G/H/I avisos · J comprobante · M método · N tipo · O id)
ok(await sb.from('control_saas').delete().neq('id', ''), 'control_saas');
const ids = new Set();
const control = central.control.valores.filter(f => [0, 1, 2, 4, 5, 9, 12].some(k => s(f[k]) !== '')).map(f => {
  let id = s(f[14]);
  if (!id || ids.has(id)) id = crypto.randomUUID();
  ids.add(id);
  return {
    id, plan: s(f[0]), correo: s(f[1]), monto: num(f[2]), cobrado: f[3] === true || s(f[3]).toUpperCase() === 'TRUE',
    fecha_suscripcion: fecha(f[4]), fecha_pago: fecha(f[5]), aviso_hoy: s(f[6]), aviso_7d: s(f[7]), aviso_15d: s(f[8]),
    comprobante_url: s(f[9]), metodo_pago: s(f[12]), tipo_suscripcion: s(f[13]) === 'Anual' ? 'Anual' : 'Mensual'
  };
});
await insertarPorLotes('control_saas', control);
console.log('control_saas:', control.length);

// --- FINANZAS_PAGOS (UID, NOMBRE, FECHA, MES, AÑO, PLAN, MÉTODO, COMPROBANTE, COSTO, CONTROL_ID, CORREO)
ok(await sb.from('pagos').delete().gte('id', 0), 'pagos');
const pagos = central.pagos.valores.filter(f => s(f[0]) || s(f[10]) || s(f[2])).map(f => ({
  uid: s(f[0]), nombre: s(f[1]), fecha_pago: fecha(f[2]), mes: s(f[3]).toUpperCase(), anio: ent(f[4]) || null, plan: s(f[5]),
  metodo: s(f[6]), comprobante: s(f[7]), costo: num(f[8]), control_id: s(f[9]), correo: s(f[10])
}));
await insertarPorLotes('pagos', pagos);
console.log('pagos:', pagos.length);

// --- FINANZAS_ESTADO (UID, FECHA BASE, PLAN, PRÓXIMO PAGO)
ok(await sb.from('suscripcion_estado').delete().neq('uid', ''), 'suscripcion_estado');
const estados = new Map();
central.estado.valores.forEach(f => { if (s(f[0])) estados.set(s(f[0]), { uid: s(f[0]), fecha_base: fecha(f[1]), plan: s(f[2]), proximo_pago: fecha(f[3]) }); });
await insertarPorLotes('suscripcion_estado', [...estados.values()]);
console.log('suscripcion_estado:', estados.size);

// --- ajustes y scripts de cobro del administrador
const ajustes = Object.entries(central.ajustes).filter(([, v]) => s(v)).map(([clave, valor]) => ({ clave, valor: s(valor) }));
const sc = central.scriptsCobro || {};
ajustes.push({ clave: 'COBRO_S0', valor: s(sc.s0) }, { clave: 'COBRO_S7', valor: s(sc.s7) }, { clave: 'COBRO_S15', valor: s(sc.s15) });
await insertarPorLotes('app_config', ajustes, { onConflict: 'clave' });
console.log('app_config:', ajustes.length);

// ==========================================================
//  2. DATOS DE CADA USUARIO
// ==========================================================
const archivos = readdirSync(carpeta).filter(f => /^usuario_.+\.json$/.test(f));
let conErrores = 0;
for (const archivo of archivos) {
  const u = leer(archivo);
  if (u.sinHoja) continue;
  if (u.error) { console.warn('⚠ ' + u.uid + ': la hoja no se pudo abrir al exportar (' + u.error + ')'); conErrores++; continue; }
  const uid = u.uid;
  try {
    if (!vistos.has(uid)) ok(await sb.from('usuarios').upsert({ uid, estado: 'Pendiente' }, { onConflict: 'uid', ignoreDuplicates: true }), 'usuarios');
    for (const t of TABLAS_USUARIO) ok(await sb.from(t).delete().eq('uid', uid), t);
    const resumen = [];

    // --- imágenes de Drive → Supabase Storage ("uid/<idDrive>.<ext>")
    const nuevoId = {};
    for (const [idDrive, img] of Object.entries(u.imagenes || {})) {
      const mime = /png/.test(img.mime) ? 'image/png' : /webp/.test(img.mime) ? 'image/webp' : 'image/jpeg';
      const ruta = `${uid}/${idDrive}.${mime.split('/')[1].replace('jpeg', 'jpg')}`;
      const r = await sb.storage.from(BUCKET).upload(ruta, Buffer.from(img.base64, 'base64'), { contentType: mime, upsert: true });
      if (r.error) console.warn('  imagen ' + idDrive + ': ' + r.error.message);
      else nuevoId[idDrive] = ruta;
    }
    const mapear = id => nuevoId[id] || id;

    // --- perfil (clave / valor)
    if (u.perfil) {
      const datos = {};
      u.perfil.valores.forEach(([k, v]) => { if (s(k)) datos[s(k)] = v === null || v === undefined ? '' : String(v); });
      if (datos.logoId) datos.logoId = mapear(datos.logoId);
      try { datos.imagenes = JSON.stringify((JSON.parse(datos.imagenes || '[]') || []).map(mapear)); } catch (e) { datos.imagenes = '[]'; }
      try { datos.metodos = JSON.stringify((JSON.parse(datos.metodos || '[]') || []).map(m => Object.assign({}, m, { qrId: m.qrId ? mapear(m.qrId) : '' }))); } catch (e) { /* se deja igual */ }
      ok(await sb.from('perfiles').upsert({ uid, datos }), 'perfiles');
      resumen.push('perfil');
    }

    // --- Historial (Nº, Fecha, Cliente, Total $, Total Bs, Teléfono, Detalle)
    if (u.historial) {
      const porNumero = new Map();
      u.historial.valores.forEach((f, i) => {
        const numero = numeroEntero(f[0]);
        if (!numero) return;
        let detalle = null;
        if (typeof f[6] === 'string' && f[6].charAt(0) === '{') { try { detalle = JSON.parse(f[6]); } catch (e) { detalle = null; } }
        // Sheets guardó el teléfono como número (sin el 0 inicial): el detalle lo conserva completo
        const contacto = detalle ? s(detalle.tipoContacto === 'rif' ? detalle.rif : detalle.telefono) : s(u.historial.visibles[i][5]);
        porNumero.set(numero, { uid, numero, fecha: instante(f[1]) || new Date().toISOString(), cliente: s(f[2]),
          total_usd: num(f[3]), total_bs: num(f[4]), contacto, detalle });
      });
      await insertarPorLotes('presupuestos', [...porNumero.values()]);
      resumen.push(porNumero.size + ' presupuestos');
    }

    // --- Base_Clientes (Fecha, Nombre, RIF, Teléfono, Correo, Dirección): texto tal como se veía en la hoja
    if (u.clientes) {
      const filas = u.clientes.visibles.map((v, i) => ({ v, f: u.clientes.valores[i] })).filter(x => s(x.v[1])).map(({ v, f }) => ({
        uid, fecha_registro: instante(f[0]) || new Date().toISOString(), nombre: s(v[1]), rif: s(v[2]), telefono: s(v[3]), correo: s(v[4]), direccion: s(v[5])
      }));
      await insertarPorLotes('clientes', filas);
      resumen.push(filas.length + ' clientes');
    }

    // --- tablas de finanzas, proveedores, herramientas y agenda
    for (const [clave, [tabla, columnas]] of Object.entries(ESQ)) {
      const datos = u.tablas && u.tablas[clave];
      if (!datos) continue;
      const porId = new Map();
      datos.valores.forEach((f, i) => {
        if (s(f[0]) === '') return;
        const vis = datos.visibles[i];
        const o = { uid };
        columnas.forEach((c, k) => {
          const [col, tipo] = c.split(':');
          if (tipo === 'd') o[col] = fecha(f[k]);
          else if (tipo === 'n') o[col] = num(f[k]);
          else if (tipo === 'i') o[col] = ent(f[k]);
          else o[col] = s(vis[k] !== undefined ? vis[k] : f[k]);
        });
        if (tabla === 'citas' && !o.duracion) o.duracion = 60;
        porId.set(o.id, o);
      });
      await insertarPorLotes(tabla, [...porId.values()]);
      if (porId.size) resumen.push(porId.size + ' ' + tabla);
    }
    console.log('✔ ' + uid + ': ' + (resumen.join(', ') || 'sin datos'));
  } catch (e) {
    conErrores++;
    console.error('✖ ' + uid + ': ' + e.message);
  }
}

console.log('\nImportación terminada. Usuarios con datos: ' + archivos.length + (conErrores ? ' · CON ERRORES: ' + conErrores + ' (revisa arriba)' : ' · sin errores'));
