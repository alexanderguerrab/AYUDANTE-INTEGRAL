// ===============================================================
//  RESPALDO DE DATOS
//  · respaldoUsuario: todo lo del propio usuario (nunca datos de otros).
//  · respaldoAdmin: tablas de la plataforma (usuarios, suscripciones, pagos, configuración).
//    Por privacidad NO incluye los presupuestos, clientes ni finanzas de otros usuarios.
// ===============================================================
import { db } from './db.js';
import { ok } from './util.js';

const LOTE_PRESUPUESTOS = 200;
const MAX_BYTES_RESPUESTA = 2.5 * 1024 * 1024;   // Vercel limita la respuesta a ~4,5 MB: los presupuestos viajan por tandas

// Quita columnas internas (uid, orden) de cada fila
const limpiar = filas => (filas || []).map(f => { const o = { ...f }; delete o.uid; delete o.orden; return o; });
// La contraseña de aplicación de Gmail (cifrada) nunca sale en el respaldo
const sinSecretos = d => { const o = { ...d }; delete o.gmailClave; return o; };
const leer = (tabla, uid, orden) => db().from(tabla).select('*').eq('uid', uid).order(orden || 'orden').then(ok).then(limpiar);

export async function respaldoUsuario(ctx, p) {
  const uid = ctx.uid;
  const desde = Math.max(0, parseInt(p && p.desde, 10) || 0);
  const salida = {};

  if (desde === 0) {
    const [usuario, perfil, clientes, ingresos, gastos, porCobrar, porPagar, proveedores, herramientas, prestamos, citas, estado, pagos] = await Promise.all([
      db().from('usuarios').select('nombre, especialidad, correo, telefono, estado, rol, fecha_registro').eq('uid', uid).maybeSingle().then(ok),
      db().from('perfiles').select('datos').eq('uid', uid).maybeSingle().then(ok),
      leer('clientes', uid, 'fecha_registro'), leer('ingresos', uid), leer('gastos', uid), leer('por_cobrar', uid), leer('por_pagar', uid),
      leer('proveedores', uid), leer('herramientas', uid), leer('prestamos', uid), leer('citas', uid),
      db().from('suscripcion_estado').select('*').eq('uid', uid).maybeSingle().then(ok),
      db().from('pagos').select('*').eq('uid', uid).order('id').then(ok).then(limpiar)
    ]);
    Object.assign(salida, {
      version: 1, tipo: 'usuario', generado: new Date().toISOString(),
      usuario: usuario || {}, perfil: sinSecretos((perfil && perfil.datos) || {}),
      clientes, ingresos, gastos, porCobrar, porPagar, proveedores, herramientas, prestamos, citas,
      suscripcion: estado ? limpiar([estado])[0] : null, pagosSuscripcion: pagos
    });
  }

  // Presupuestos con su detalle completo, por tandas (el navegador pide la siguiente con "desde")
  const lote = ok(await db().from('presupuestos').select('numero, fecha, cliente, total_usd, total_bs, contacto, detalle')
    .eq('uid', uid).gt('numero', desde).order('numero').limit(LOTE_PRESUPUESTOS));
  const tanda = []; let bytes = 0;
  for (const r of lote) {
    const n = JSON.stringify(r).length;
    if (tanda.length && bytes + n > MAX_BYTES_RESPUESTA) break;
    tanda.push(r); bytes += n;
  }
  salida.presupuestos = tanda;
  salida.siguiente = (tanda.length && (tanda.length < lote.length || lote.length === LOTE_PRESUPUESTOS)) ? tanda[tanda.length - 1].numero : null;
  return salida;
}

export async function respaldoAdmin() {
  const [usuarios, suscripciones, pagos, estados, config] = await Promise.all([
    db().from('usuarios').select('uid, nombre, especialidad, correo, telefono, estado, rol, fecha_registro').order('orden').then(ok),
    db().from('control_saas').select('*').order('orden').then(ok).then(limpiar),
    db().from('pagos').select('*').order('id').then(ok),
    db().from('suscripcion_estado').select('*').then(ok),
    db().from('app_config').select('clave, valor').order('clave').then(ok)
  ]);
  return {
    version: 1, tipo: 'plataforma', generado: new Date().toISOString(),
    usuarios, suscripciones, pagos, estadoSuscripciones: estados,
    configuracion: config.filter(f => f.clave !== 'CORREOS_DIA')   // incluye las plantillas de cobro (COBRO_*) y los ajustes de la app
  };
}
