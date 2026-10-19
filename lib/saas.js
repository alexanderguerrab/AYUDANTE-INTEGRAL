// ===============================================================
//  PANEL DE ADMINISTRACIÓN · SUSCRIPCIONES Y COBROS
//  Antes: hojas CONTROL_SAAS, FINANZAS_PAGOS, FINANZAS_ESTADO y SCRIPTS DE COBRO de la hoja central.
//  Ahora: tablas control_saas, pagos, suscripcion_estado y app_config.
// ===============================================================
import { db } from './db.js';
import { MAX_ENVIOS_POR_EJECUCION } from './config.js';
import {
  ok, fallo, textoSeguro, round2, escaparHtml, limpiarTexto_, correoValido,
  hoyIso, hoy_, parseFechaIso, diasDesdeIso, sumarMesesIso, aIsoFecha
} from './util.js';
import { leerRolEstado } from './usuarios.js';
import { enviarCorreo, cuotaRestante, cuentaCorreo, aliasesCorreo } from './correo.js';

const MESES_UP = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const ETAPAS_COBRO = [
  { dias: 0, col: 'aviso_hoy', etiqueta: 'VENCIDO' },
  { dias: 7, col: 'aviso_7d', etiqueta: 'VENCIDO 7D' },
  { dias: 15, col: 'aviso_15d', etiqueta: 'VENCIDO 15D' }
];

// ---------- Ajustes sueltos (app_config) ----------
async function leerConfig(claves) {
  const filas = ok(await db().from('app_config').select('clave, valor').in('clave', claves));
  const o = {};
  filas.forEach(f => { o[f.clave] = f.valor; });
  return o;
}
async function guardarConfig(o) {
  ok(await db().from('app_config').upsert(Object.keys(o).map(k => ({ clave: k, valor: String(o[k] == null ? '' : o[k]) }))));
}

// ---------- Fechas del ciclo ----------
// Mensual: mismo día del mes siguiente · Anual: la misma fecha
const fechaPagoDeCiclo = (fsusc, tipo) => tipo === 'Anual' ? fsusc : sumarMesesIso(fsusc, 1);
function siguienteCiclo(fsusc, fpago, tipo, hoy) {
  const inicio = (tipo === 'Anual') ? sumarMesesIso(fsusc || fpago || hoy, 12) : (fpago || (fsusc ? sumarMesesIso(fsusc, 1) : hoy));
  return { fecha_suscripcion: inicio, fecha_pago: fechaPagoDeCiclo(inicio, tipo) };
}
const isoDeFila = v => v ? aIsoFecha(String(v)) : '';

// ---------- Usuarios por correo ----------
// correo (minúsculas) → { uid, nombre, correo, telefono }. Si dos cuentas declaran el mismo correo, gana la primera registrada.
async function mapaUsuarios(memo) {
  if (memo && memo.mapa) return memo.mapa;
  const filas = ok(await db().from('usuarios').select('uid, nombre, correo, telefono').order('orden'));
  const mapa = {};
  filas.forEach(u => {
    const k = String(u.correo || '').trim().toLowerCase();
    if (u.uid && k && !mapa[k]) mapa[k] = { uid: u.uid, nombre: u.nombre || '', correo: String(u.correo).trim(), telefono: u.telefono || '' };
  });
  if (memo) memo.mapa = mapa;
  return mapa;
}
async function usuarioPorCorreo(correo, memo) {
  return correo ? ((await mapaUsuarios(memo))[String(correo).trim().toLowerCase()] || null) : null;
}

// ---------- Tabla control_saas ----------
function filaControl(r) {
  return {
    id: r.id, plan: r.plan || '', correo: String(r.correo || '').trim(), monto: Number(r.monto) || 0, cobrado: r.cobrado === true,
    fecha_suscripcion: isoDeFila(r.fecha_suscripcion), fecha_pago: isoDeFila(r.fecha_pago),
    marcas: [r.aviso_hoy || '', r.aviso_7d || '', r.aviso_15d || ''],
    comprobante_url: r.comprobante_url || '', metodo_pago: r.metodo_pago || '', tipo_suscripcion: r.tipo_suscripcion === 'Anual' ? 'Anual' : 'Mensual'
  };
}
async function leerFilasControl() {
  return ok(await db().from('control_saas').select('*').order('orden')).map(filaControl);
}
async function buscarFilaControl(id) {
  const r = ok(await db().from('control_saas').select('*').eq('id', String(id || '')).maybeSingle());
  return r ? filaControl(r) : null;
}

// Vence Hoy / 7 Días / 15 Días: "ENVIADO" si ya se mandó, "VENCIDO…" si ya pasó el plazo, "" si nada.
const marcaHecha = m => m === 'ENVIADO' || m === 'OMITIDO';
function estadosVencimientoFila(f, hoy) {
  const dias = f.cobrado ? null : diasDesdeIso(f.fecha_pago, hoy);
  return ETAPAS_COBRO.map((et, i) => {
    if (marcaHecha(f.marcas[i])) return f.marcas[i];
    if (dias !== null && dias >= et.dias) return et.etiqueta;
    return '';
  });
}
// Se envía SOLO la etapa más alta que ya corresponde.
function etapaPendienteFila(f, hoy) {
  if (f.cobrado) return -1;
  const dias = diasDesdeIso(f.fecha_pago, hoy);
  if (dias === null) return -1;
  for (let i = ETAPAS_COBRO.length - 1; i >= 0; i--) {
    if (dias >= ETAPAS_COBRO[i].dias) return marcaHecha(f.marcas[i]) ? -1 : i;
  }
  return -1;
}

// Lista de clientes para el selector: se muestra el nombre y se guarda el correo.
async function listarCorreosUsuarios(memo) {
  const mapa = await mapaUsuarios(memo);
  return Object.values(mapa).map(u => ({ correo: u.correo, nombre: u.nombre, telefono: u.telefono }))
    .sort((a, b) => (a.nombre || a.correo).toLowerCase().localeCompare((b.nombre || b.correo).toLowerCase()));
}

// ---------- Acciones de la tabla ----------
export async function obtenerDatosControlSaaS(p) {
  const memo = {};
  const hoy = hoyIso(p && p.hoy);
  const filas = await leerFilasControl();
  const salida = filas.map(f => ({ id: f.id, plan: f.plan, correo: f.correo, monto: f.monto, cobrado: f.cobrado, tipo_suscripcion: f.tipo_suscripcion,
    metodo_pago: f.metodo_pago, fecha_suscripcion: f.fecha_suscripcion, fecha_pago: f.fecha_pago, comprobante_url: f.comprobante_url, estados: estadosVencimientoFila(f, hoy) }));
  return { filas: salida, correos: await listarCorreosUsuarios(memo) };
}

// Al cambiar la fecha de suscripción o el tipo se recalcula la fecha de pago; al marcar Cobrado sin fecha de pago se usa hoy.
function completarCambiosControl(fila, cambios, hoy) {
  const r = Object.assign({}, cambios);
  const cambiaCiclo = ('fecha_suscripcion' in cambios) || ('tipo_suscripcion' in cambios);
  const inicio = ('fecha_suscripcion' in cambios) ? cambios.fecha_suscripcion : (fila ? fila.fecha_suscripcion : '');
  if (cambiaCiclo && inicio && !('fecha_pago' in cambios)) {
    const tipo = cambios.tipo_suscripcion || (fila ? fila.tipo_suscripcion : '') || 'Mensual';
    r.fecha_pago = fechaPagoDeCiclo(inicio, tipo);
  }
  if (cambios.cobrado === true && !(fila && fila.fecha_pago) && !r.fecha_pago) r.fecha_pago = hoy;
  return r;
}

const CAMPOS_CONTROL = ['plan', 'correo', 'monto', 'cobrado', 'fecha_suscripcion', 'fecha_pago', 'comprobante_url', 'metodo_pago', 'tipo_suscripcion'];
function valoresControl(cambios) {
  const o = {};
  Object.keys(cambios).forEach(campo => {
    if (!CAMPOS_CONTROL.includes(campo)) return;
    const v = cambios[campo];
    if (campo === 'fecha_suscripcion' || campo === 'fecha_pago') {
      if (v) { if (!parseFechaIso(v)) fallo('Fecha inválida.'); o[campo] = aIsoFecha(String(v)); } else o[campo] = null;
    }
    else if (campo === 'cobrado') o[campo] = v === true;
    else if (campo === 'monto') o[campo] = Math.max(0, round2(parseFloat(v) || 0));
    else if (campo === 'tipo_suscripcion') o[campo] = v === 'Anual' ? 'Anual' : 'Mensual';
    else o[campo] = textoSeguro(v, campo === 'comprobante_url' ? 500 : (campo === 'metodo_pago' ? 60 : 120));
  });
  return o;
}

export async function guardarCambioControlSaaS(p) {
  const memo = {};
  const hoy = hoyIso(p.hoy);
  const previo = await buscarFilaControl(p.id);
  if (!previo) fallo('No se encontró el registro. Recarga la pantalla.');
  const cambios = completarCambiosControl(previo, p.cambios || {}, hoy);
  const valores = valoresControl(cambios);
  // al marcar cobrado o cambiar la fecha de pago se limpian los avisos enviados
  if (cambios.cobrado === true || ('fecha_pago' in cambios && (cambios.fecha_pago || '') !== previo.fecha_pago)) {
    valores.aviso_hoy = ''; valores.aviso_7d = ''; valores.aviso_15d = '';
  }
  if (Object.keys(valores).length) ok(await db().from('control_saas').update(valores).eq('id', previo.id));
  const nueva = await buscarFilaControl(previo.id);
  await sincronizarControlConFinanzas(nueva, previo, hoy, memo);
  return 'Guardado';
}

async function insertarFilaControl(o) {
  const fila = ok(await db().from('control_saas').insert({
    plan: textoSeguro(o.plan, 120), correo: textoSeguro(o.correo, 120), monto: Math.max(0, round2(Number(o.monto) || 0)), cobrado: o.cobrado === true,
    fecha_suscripcion: o.fecha_suscripcion || null, fecha_pago: o.fecha_pago || null, comprobante_url: textoSeguro(o.comprobante_url, 500),
    metodo_pago: textoSeguro(o.metodo_pago, 60), tipo_suscripcion: o.tipo_suscripcion === 'Anual' ? 'Anual' : 'Mensual'
  }).select('id').single());
  return fila.id;
}

// La fila vacía del final de la tabla: al escribir en ella se crea el registro.
export async function crearRegistroControlSaaS(p) {
  const memo = {};
  const hoy = hoyIso(p.hoy);
  const base = { plan: '', correo: '', monto: 0, cobrado: false, tipo_suscripcion: 'Mensual', metodo_pago: '', fecha_suscripcion: '', fecha_pago: '', comprobante_url: '' };
  const cambios = completarCambiosControl(null, p.cambios || {}, hoy);
  Object.assign(base, cambios);
  if (base.fecha_suscripcion && !parseFechaIso(base.fecha_suscripcion)) fallo('Fecha inválida.');
  if (base.fecha_pago && !parseFechaIso(base.fecha_pago)) fallo('Fecha inválida.');
  const id = await insertarFilaControl(base);
  await sincronizarControlConFinanzas(await buscarFilaControl(id), null, hoy, memo);
  return 'Registro creado';
}

// Renovar: el nuevo ciclo empieza donde terminó el anterior.
// El mensual se cobra al FINAL del ciclo (fecha de pago = inicio + 1 mes) y el anual al INICIO (fecha de pago = inicio).
export async function renovarControlSaaS(p) {
  const memo = {};
  const hoy = hoyIso(p.hoy);
  const f = await buscarFilaControl(p.id);
  if (!f) fallo('No se encontró el registro. Recarga la pantalla.');
  const ciclo = siguienteCiclo(f.fecha_suscripcion, f.fecha_pago, f.tipo_suscripcion, hoy);
  let nuevoMonto = f.monto;
  if (p.nuevoMonto !== null && p.nuevoMonto !== undefined && p.nuevoMonto !== '') {
    nuevoMonto = Number(p.nuevoMonto);
    if (isNaN(nuevoMonto) || nuevoMonto < 0) fallo('Monto inválido.');
  }
  // Evita renovar dos veces el mismo periodo (doble clic)
  const existe = (await leerFilasControl()).some(x =>
    x.id !== f.id && x.correo.toLowerCase() === f.correo.toLowerCase() && x.plan === f.plan && x.fecha_suscripcion === ciclo.fecha_suscripcion);
  if (existe) fallo('Ya existe un renglón para ese periodo. Edítalo en lugar de renovar de nuevo.');
  const id = await insertarFilaControl({ plan: f.plan, correo: f.correo, monto: nuevoMonto, cobrado: false, metodo_pago: f.metodo_pago,
    tipo_suscripcion: f.tipo_suscripcion, fecha_suscripcion: ciclo.fecha_suscripcion, fecha_pago: ciclo.fecha_pago });
  await sincronizarControlConFinanzas(await buscarFilaControl(id), null, hoy, memo);
  return 'Se ha generado el nuevo periodo.';
}

export async function eliminarRegistroControlSaaS(p) {
  const memo = {};
  const hoy = hoyIso(p.hoy);
  const f = await buscarFilaControl(p.id);
  if (!f) fallo('No se encontró el registro. Recarga la pantalla.');
  ok(await db().from('control_saas').delete().eq('id', f.id));
  await sincronizarControlConFinanzas(null, f, hoy, memo);
  return 'Registro eliminado';
}

// ==========================================
// SINCRONIZACIÓN CONTROL → PAGOS
//  · Marcar Cobrado crea el pago; desmarcarlo lo elimina.
//  · Se recalcula plan / próximo pago del usuario (lo que ve en "Mi Suscripción").
// ==========================================
async function pagoPorControl(controlId) {
  if (!controlId) return null;
  return ok(await db().from('pagos').select('*').eq('control_id', controlId).limit(1).maybeSingle());
}

function camposFechaPago(iso) {
  const d = parseFechaIso(iso) || parseFechaIso(hoy_());
  return { fecha_pago: d.toISOString().slice(0, 10), mes: MESES_UP[d.getUTCMonth()], anio: d.getUTCFullYear() };
}

async function insertarPagoDeControl(f, usuario) {
  ok(await db().from('pagos').insert(Object.assign(camposFechaPago(f.fecha_pago), {
    uid: usuario.uid, nombre: usuario.nombre, plan: f.tipo_suscripcion, metodo: f.metodo_pago || '', comprobante: f.comprobante_url || '',
    costo: f.monto, control_id: f.id, correo: usuario.correo
  })));
}

export async function recalcularSuscripcionSaaS(correo, memo) {
  const usuario = await usuarioPorCorreo(correo, memo);
  if (!usuario) return;
  const uid = usuario.uid;
  const filas = (await leerFilasControl()).filter(f => f.correo.toLowerCase() === usuario.correo.toLowerCase());
  const tienePagos = ok(await db().from('pagos').select('id').eq('uid', uid).limit(1)).length > 0;

  if (!filas.length && !tienePagos) { ok(await db().from('suscripcion_estado').delete().eq('uid', uid)); return; }
  let pendiente = null, ultimo = null;
  filas.forEach(f => {
    if (!f.fecha_pago) return;
    if (!f.cobrado && (!pendiente || f.fecha_pago < pendiente.fecha_pago)) pendiente = f;
    if (f.cobrado && (!ultimo || f.fecha_pago > ultimo.fecha_pago)) ultimo = f;
  });
  let plan, proximo, base;
  if (pendiente) { plan = pendiente.tipo_suscripcion; proximo = pendiente.fecha_pago; base = pendiente.fecha_suscripcion; }
  else if (ultimo) { plan = ultimo.tipo_suscripcion; proximo = sumarMesesIso(ultimo.fecha_pago, plan === 'Anual' ? 12 : 1); base = ultimo.fecha_suscripcion || ultimo.fecha_pago; }
  else return; // solo hay pagos antiguos sin filas de control: se deja como está
  ok(await db().from('suscripcion_estado').upsert({ uid, fecha_base: base || null, plan, proximo_pago: proximo }));
}

async function sincronizarControlConFinanzas(nueva, previa, hoy, memo) {
  if (!nueva) { // fila eliminada: el pago se conserva en el historial, solo se desvincula
    ok(await db().from('pagos').update({ control_id: '' }).eq('control_id', previa.id));
    await recalcularSuscripcionSaaS(previa.correo, memo);
    return;
  }
  // Si el correo todavía no está registrado el pago se guarda igual (sin UID) y se enlaza cuando el usuario se registre
  const registrado = await usuarioPorCorreo(nueva.correo, memo);
  const usuario = registrado || { uid: '', nombre: '', correo: nueva.correo };
  if (previa && previa.correo.toLowerCase() !== nueva.correo.toLowerCase()) {
    ok(await db().from('pagos').update({ uid: usuario.uid, nombre: usuario.nombre, correo: usuario.correo }).eq('control_id', nueva.id));
    if (previa.correo) await recalcularSuscripcionSaaS(previa.correo, memo);
  }
  if (nueva.cobrado) {
    const pago = await pagoPorControl(nueva.id);
    if (!pago) await insertarPagoDeControl(nueva, usuario);
    else if (previa && (previa.monto !== nueva.monto || previa.comprobante_url !== nueva.comprobante_url || previa.metodo_pago !== nueva.metodo_pago ||
      previa.fecha_pago !== nueva.fecha_pago || previa.tipo_suscripcion !== nueva.tipo_suscripcion)) {
      ok(await db().from('pagos').update(Object.assign(camposFechaPago(nueva.fecha_pago), {
        plan: nueva.tipo_suscripcion, metodo: nueva.metodo_pago || pago.metodo, comprobante: nueva.comprobante_url || pago.comprobante, costo: nueva.monto
      })).eq('id', pago.id));
    }
  } else if (previa && previa.cobrado && !nueva.cobrado) {
    ok(await db().from('pagos').delete().eq('control_id', nueva.id));
  }
  if (registrado) await recalcularSuscripcionSaaS(nueva.correo, memo);
}

// ==========================================
// MOTOR DE COBRO (correos de recordatorio a los clientes de la suscripción)
// ==========================================
const SCRIPTS_ADMIN_DEFECTO = {
  COBRO_S0: 'Hola [Nombre], tu suscripción [Proyecto] de $[Monto] vence hoy.',
  COBRO_S7: 'Hola [Nombre], tu suscripción [Proyecto] tiene 7 días de retraso.',
  COBRO_S15: 'Hola [Nombre], tu suscripción [Proyecto] ha sido suspendida.'
};

export async function obtenerScripts() {
  const c = await leerConfig(Object.keys(SCRIPTS_ADMIN_DEFECTO));
  const v = k => (c[k] !== undefined ? c[k] : SCRIPTS_ADMIN_DEFECTO[k]);
  return { s0: v('COBRO_S0'), s7: v('COBRO_S7'), s15: v('COBRO_S15') };
}

export async function actualizarScripts(s) {
  await guardarConfig({
    COBRO_S0: String(s.s0 || '').substring(0, 3000),
    COBRO_S7: String(s.s7 || '').substring(0, 3000),
    COBRO_S15: String(s.s15 || '').substring(0, 3000)
  });
  return 'Scripts guardados exitosamente';
}

const rellenarPlantillaCobro = (plantilla, d) =>
  String(plantilla).split('[Nombre]').join(d.nombre).split('[Proyecto]').join(d.proyecto).split('[Monto]').join(String(d.monto));

// Asunto sobrio (sin emojis) + texto y HTML + pie que identifica quién envía: toleran mejor los filtros anti-spam.
function construirCorreoCobro(d) {
  const concepto = String(d.concepto || 'Pendiente').replace(/[\r\n]+/g, ' ').trim().substring(0, 80);
  const firma = d.remitente || d.responderA;
  const pie = 'Recibes este mensaje de ' + firma + ' por un pago pendiente. Si ya realizaste el pago, ignora este recordatorio o responde a este correo.';
  const cuerpo = String(d.cuerpo).trim();
  const text = cuerpo + '\n\nSaludos,\n' + firma + '\n\n--\n' + pie;
  const parrafos = cuerpo.split(/\n{2,}/).map(p => '<p style="margin:0 0 14px">' + escaparHtml(p).replace(/\n/g, '<br>') + '</p>').join('');
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:560px">' + parrafos +
    '<p style="margin:18px 0 0">Saludos,<br>' + escaparHtml(firma) + '</p>' +
    '<hr style="border:none;border-top:1px solid #ddd;margin:22px 0 10px">' +
    '<p style="margin:0;font-size:12px;color:#777">' + escaparHtml(pie) + '</p></div>';
  return { subject: 'Recordatorio de pago de tu plan: ' + concepto, text, html };
}

async function obtenerConfigRemitente() {
  const c = await leerConfig(['COBRO_ALIAS', 'COBRO_NOMBRE']);
  const alias = c.COBRO_ALIAS || '';
  return { alias, nombre: c.COBRO_NOMBRE || '', direccion: alias || cuentaCorreo() };
}

export async function obtenerRemitenteCobro() {
  const c = await obtenerConfigRemitente();
  return { direccion: cuentaCorreo(), alias: c.alias, nombre: c.nombre, aliases: aliasesCorreo() };
}

export async function guardarRemitenteCobro(p) {
  let alias = String(p.alias || '').trim().toLowerCase();
  const nombre = String(p.nombre || '').replace(/["<>\r\n]/g, '').trim().substring(0, 80);
  if (alias === cuentaCorreo()) alias = '';
  if (alias && !aliasesCorreo().includes(alias)) fallo('Ese correo no está configurado como «Enviar como» en tu Gmail (agrégalo también en SMTP_ALIASES en Vercel).');
  await guardarConfig({ COBRO_ALIAS: alias, COBRO_NOMBRE: nombre });
  return 'Tus recordatorios ahora saldrán desde ' + (alias || cuentaCorreo()) + '.';
}

const esperar = ms => new Promise(r => setTimeout(r, ms));

export async function ejecutarEnvioCobroSaaS(p) {
  const memo = {};
  const hoy = hoyIso(p && p.hoy);
  const s = await obtenerScripts();
  const scripts = [s.s0, s.s7, s.s15];
  const pendientes = [];
  (await leerFilasControl()).forEach(f => { const et = etapaPendienteFila(f, hoy); if (et >= 0) pendientes.push({ f, etapa: et }); });
  if (!pendientes.length) return { mensaje: 'No hay recordatorios pendientes por enviar.', enviados: 0 };

  const rem = await obtenerConfigRemitente();
  const mapa = await mapaUsuarios(memo);
  const cuota = await cuotaRestante();
  let enviados = 0, sinCorreo = 0, sinPlantilla = 0, sinCuota = 0, restantes = 0, primero = true;
  const fallidos = [];

  for (const { f, etapa } of pendientes) {
    if (!f.correo || !correoValido(f.correo)) { sinCorreo++; continue; }
    if (!scripts[etapa]) { sinPlantilla++; continue; }
    if (enviados >= cuota) { sinCuota++; continue; }
    if (enviados >= MAX_ENVIOS_POR_EJECUCION) { restantes++; continue; }   // lote máximo por ejecución
    const u = mapa[f.correo.toLowerCase()];
    const nombre = (u && u.nombre) ? u.nombre : f.correo.split('@')[0];
    const texto = rellenarPlantillaCobro(scripts[etapa], { nombre, proyecto: f.plan || 'Suscripción', monto: f.monto });
    const correo = construirCorreoCobro({ concepto: f.plan || 'Suscripción', cuerpo: texto, remitente: rem.nombre, responderA: rem.direccion });
    if (!primero) await esperar(500); // una ráfaga idéntica se parece a spam masivo
    primero = false;
    try {
      await enviarCorreo({ to: f.correo, subject: correo.subject, text: correo.text, html: correo.html, replyTo: rem.direccion,
        name: rem.nombre || undefined, from: rem.alias || undefined });
      enviados++;
      // las etapas anteriores que nunca se enviaron quedan como OMITIDO (no se mandará un aviso viejo después)
      const marcas = { [ETAPAS_COBRO[etapa].col]: 'ENVIADO' };
      for (let k = 0; k < etapa; k++) { if (!marcaHecha(f.marcas[k])) marcas[ETAPAS_COBRO[k].col] = 'OMITIDO'; }
      ok(await db().from('control_saas').update(marcas).eq('id', f.id));
    } catch (e) { fallidos.push(f.correo + ' (' + String(e.message || e).split('\n')[0].substring(0, 200) + ')'); }
  }
  let mensaje = 'Se enviaron ' + enviados + ' recordatorios de cobro.';
  if (sinCorreo) mensaje += ' ' + sinCorreo + ' vencidos no tienen un correo válido.';
  if (sinPlantilla) mensaje += ' ' + sinPlantilla + ' no se enviaron porque su plantilla está vacía.';
  if (sinCuota) mensaje += ' ' + sinCuota + ' quedaron pendientes por el límite diario de correos.';
  if (restantes) mensaje += ' Quedan ' + restantes + ' por enviar: vuelve a ejecutar el cobro.';
  if (fallidos.length) mensaje += ' Fallaron: ' + fallidos.join('; ') + '.';
  return { mensaje, enviados };
}

// ==========================================
// REPORTES Y PANEL DE FINANZAS
// ==========================================
async function leerPagosParaReporte(memo) {
  const pagos = ok(await db().from('pagos').select('*').order('id'));
  const mapa = await mapaUsuarios(memo);
  const out = [];
  pagos.forEach(f => {
    if (!f.uid && !f.correo) return;
    const iso = isoDeFila(f.fecha_pago);
    let anio, mes;
    if (iso) { anio = Number(iso.substring(0, 4)); mes = Number(iso.substring(5, 7)) - 1; }
    else { anio = Number(f.anio); mes = MESES_UP.indexOf(String(f.mes).toUpperCase()); }
    if (!anio || mes < 0) return;
    const u = f.correo ? mapa[String(f.correo).trim().toLowerCase()] : null;
    out.push({ anio, mes, monto: Number(f.costo) || 0, cliente: String((u && u.nombre) || f.nombre || f.correo || '').trim() });
  });
  return out;
}

// Lista de cobros para el reporte del administrador (el navegador la agrupa por mes y por cliente)
export async function pagosParaReporteAdmin_() {
  return (await leerPagosParaReporte({})).map(pg => ({
    fecha: pg.anio + '-' + ('0' + (pg.mes + 1)).slice(-2) + '-01', monto: pg.monto, cliente: pg.cliente || 'Sin usuario'
  }));
}

export async function getFinanzasData() {
  const [usuariosDb, estadosDb, pagosDb] = await Promise.all([
    db().from('usuarios').select('*').order('orden').then(ok),
    db().from('suscripcion_estado').select('*').then(ok),
    db().from('pagos').select('*').order('id', { ascending: false }).limit(100).then(ok)
  ]);
  const estados = {};
  estadosDb.forEach(e => { estados[e.uid] = { plan: e.plan, proximo: isoDeFila(e.proximo_pago) }; });

  const nombres = {}, usuarios = [];
  usuariosDb.forEach(u => {
    nombres[u.uid] = { correo: u.correo || '', nombre: u.nombre || '' };
    if (leerRolEstado(u).estado !== 'Autorizado') return; // solo usuarios autorizados
    const est = estados[u.uid];
    usuarios.push({ uid: u.uid, correo: u.correo || '', nombre: u.nombre || '', plan: est ? est.plan : '', proximo: est ? est.proximo : '' });
  });
  usuarios.sort((a, b) => (a.correo || a.nombre).toLowerCase().localeCompare((b.correo || b.nombre).toLowerCase()));

  const pagos = pagosDb.filter(f => f.uid || f.correo).map(f => {   // lo más reciente arriba
    const info = nombres[f.uid] || { correo: '', nombre: '' };
    const mes = f.mes ? f.mes.charAt(0).toUpperCase() + f.mes.slice(1).toLowerCase() : '';
    return { fecha: isoDeFila(f.fecha_pago), correo: f.correo || info.correo, nombre: info.nombre || f.nombre || '',
      periodo: (mes + ' ' + (f.anio || '')).trim(), plan: f.plan, metodo: f.metodo, monto: Number(f.costo) || 0, recibo: f.comprobante };
  });
  return { usuarios, pagos };
}

// ===============================================================
//  SUSCRIPCIÓN DEL CLIENTE ("Mi suscripción")
// ===============================================================
const ddmmyyyy = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '';

export async function suscripcionDe_(uid) {
  const r = { plan: 'Sin plan', proximo: '--', estado: 'Sin registro', historial: [] };
  const [est, pagos] = await Promise.all([
    db().from('suscripcion_estado').select('*').eq('uid', uid).maybeSingle().then(ok),
    db().from('pagos').select('*').eq('uid', uid).order('id', { ascending: false }).then(ok)
  ]);
  if (est) {
    r.plan = est.plan || 'Sin plan';
    const prox = isoDeFila(est.proximo_pago);
    if (prox) {
      const hoy = hoy_();
      r.proximo = ddmmyyyy(prox);
      r.estado = prox < hoy ? 'VENCIDO' : (prox === hoy ? 'VENCE HOY' : 'AL DÍA');
    }
  }
  r.historial = pagos.map(f => ({ fecha: ddmmyyyy(isoDeFila(f.fecha_pago)), periodo: (f.mes || '') + ' ' + (f.anio || ''), plan: f.plan,
    metodo: f.metodo, recibo: f.comprobante, costo: f.costo ? String(Number(f.costo)) : '' }));
  return r;
}

// ---------------------------------------------------------------
//  AJUSTES DE LA APP (los edita el administrador desde el panel)
// ---------------------------------------------------------------
const CONFIG_APP_DEFECTO = { SOPORTE_EMAIL: 'alexanderguerra1129@gmail.com', SOPORTE_WA: '584124231008', GOOGLE_CLIENT_ID: '' };

export async function configPublica_() {
  const c = await leerConfig(Object.keys(CONFIG_APP_DEFECTO));
  return {
    soporteEmail: c.SOPORTE_EMAIL || CONFIG_APP_DEFECTO.SOPORTE_EMAIL,
    soporteWa: c.SOPORTE_WA || CONFIG_APP_DEFECTO.SOPORTE_WA,
    googleClientId: c.GOOGLE_CLIENT_ID || CONFIG_APP_DEFECTO.GOOGLE_CLIENT_ID
  };
}

export async function guardarConfigApp(d) {
  const email = limpiarTexto_(d && d.soporteEmail, 120);
  if (!correoValido(email)) fallo('El correo de soporte no es válido.');
  const wa = String((d && d.soporteWa) || '').replace(/\D/g, '');
  if (wa.length < 8 || wa.length > 15) fallo('El WhatsApp debe tener entre 8 y 15 dígitos, con el código de país (ej: 584124231008).');
  const gid = limpiarTexto_(d && d.googleClientId, 200);
  if (gid && !/^[\w.\-]+\.apps\.googleusercontent\.com$/.test(gid)) fallo('El ID de cliente de Google no es válido (debe terminar en .apps.googleusercontent.com).');
  await guardarConfig({ SOPORTE_EMAIL: email, SOPORTE_WA: wa, GOOGLE_CLIENT_ID: gid });
  return configPublica_();
}
