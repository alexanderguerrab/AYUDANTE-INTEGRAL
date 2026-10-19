// ---------------------------------------------------------------
//  FINANZAS · PROVEEDORES · HERRAMIENTAS · AGENDA
//  Antes cada tabla era una pestaña de la hoja del cliente; ahora es una tabla con la columna uid.
//  Las fechas viajan como texto AAAA-MM-DD y cada registro tiene un ID corto único.
// ---------------------------------------------------------------
import { db } from './db.js';
import { ok, fallo, txt_, monto_, redondear_, nuevoId_, ahora_, hoy_, fechaIso_ } from './util.js';

// k = nombre en la app · c = columna en la base de datos · n = número · d = fecha
const col = (k, c, tipo) => ({ k, c: c || k, n: tipo === 'n', d: tipo === 'd' });
export const ESQUEMAS = {
  ingresos: { tabla: 'ingresos', cols: [col('id'), col('fecha', 0, 'd'), col('cliente'), col('presupuesto'), col('concepto'), col('monto', 0, 'n'), col('metodo'), col('notas'), col('creado')] },
  gastos: { tabla: 'gastos', cols: [col('id'), col('fecha', 0, 'd'), col('categoria'), col('descripcion'), col('proveedor'), col('monto', 0, 'n'), col('metodo'), col('notas'), col('creado')] },
  porCobrar: { tabla: 'por_cobrar', cols: [col('id'), col('fecha', 0, 'd'), col('cliente'), col('presupuesto'), col('concepto'), col('monto', 0, 'n'), col('vence', 0, 'd'),
    col('estado'), col('fechaCobro', 'fecha_cobro', 'd'), col('notas'), col('creado'), col('rec0'), col('rec7'), col('rec15')] },
  proveedores: { tabla: 'proveedores', cols: [col('id'), col('nombre'), col('rif'), col('telefono'), col('correo'), col('direccion'), col('notas'), col('creado')] },
  porPagar: { tabla: 'por_pagar', cols: [col('id'), col('fecha', 0, 'd'), col('proveedor'), col('categoria'), col('descripcion'), col('monto', 0, 'n'), col('vence', 0, 'd'),
    col('estado'), col('fechaPago', 'fecha_pago', 'd'), col('notas'), col('creado')] },
  inventario: { tabla: 'herramientas', cols: [col('id'), col('nombre'), col('marca'), col('categoria'), col('cantidad', 0, 'n'), col('estado'), col('ubicacion'), col('valor', 0, 'n'), col('notas'), col('creado')] },
  prestamos: { tabla: 'prestamos', cols: [col('id'), col('herramientaId', 'herramienta_id'), col('herramienta'), col('cantidad', 0, 'n'), col('persona'), col('telefono'),
    col('fechaPrestamo', 'fecha_prestamo', 'd'), col('fechaPrevista', 'fecha_prevista', 'd'), col('estado'), col('fechaDevolucion', 'fecha_devolucion', 'd'), col('notas'), col('creado')] },
  citas: { tabla: 'citas', cols: [col('id'), col('fecha', 0, 'd'), col('hora'), col('duracion', 0, 'n'), col('cliente'), col('telefono'), col('servicio'), col('direccion'), col('estado'), col('notas'), col('creado')] }
};
const ESTADOS_HERR = ['Buena', 'Regular', 'Mala', 'En reparación'];
const ESTADOS_CITA = ['Pendiente', 'Confirmada', 'Realizada', 'Cancelada'];

// ---------- Utilidades de tablas ----------
function filaAObjeto_(esq, fila) {
  const o = {};
  esq.cols.forEach(c => {
    const v = fila[c.c];
    if (c.n) o[c.k] = Number(v) || 0;
    else o[c.k] = v == null ? '' : String(v);
  });
  return o;
}

function objetoAFila_(esq, uid, obj) {
  const f = { uid };
  esq.cols.forEach(c => {
    const v = obj[c.k];
    if (c.d) f[c.c] = v ? v : null;
    else if (c.n) f[c.c] = Number(v) || 0;
    else f[c.c] = v === undefined || v === null ? '' : String(v);
  });
  return f;
}

export async function leerTabla_(esq, uid) {
  const filas = ok(await db().from(esq.tabla).select('*').eq('uid', uid).order('orden'));
  return filas.map(f => filaAObjeto_(esq, f));
}

async function leerRegistro_(esq, uid, id) {
  const f = ok(await db().from(esq.tabla).select('*').eq('uid', uid).eq('id', String(id || '')).maybeSingle());
  return f ? filaAObjeto_(esq, f) : null;
}

async function agregarFila_(esq, uid, obj) {
  ok(await db().from(esq.tabla).insert(objetoAFila_(esq, uid, obj)));
  return obj;
}

async function escribirFila_(esq, uid, obj) {
  const fila = objetoAFila_(esq, uid, obj);
  delete fila.uid; delete fila.id;
  ok(await db().from(esq.tabla).update(fila).eq('uid', uid).eq('id', obj.id));
  return obj;
}

async function borrarFila_(esq, uid, id, mensaje) {
  const borradas = ok(await db().from(esq.tabla).delete().eq('uid', uid).eq('id', String(id || '')).select('id'));
  if (!borradas.length) fallo(mensaje);
  return 'EXITO';
}

// ---------------------------------------------------------------
//  FINANZAS
// ---------------------------------------------------------------
export async function finanzasDatos(ctx) {
  const [ingresos, gastos, porCobrar, porPagar] = await Promise.all(
    [ESQUEMAS.ingresos, ESQUEMAS.gastos, ESQUEMAS.porCobrar, ESQUEMAS.porPagar].map(e => leerTabla_(e, ctx.uid)));
  return { ingresos, gastos, porCobrar, porPagar };
}

export async function guardarIngreso(ctx, r) {
  if (!r) fallo('No llegaron los datos del ingreso.');
  const reg = {
    id: nuevoId_(), fecha: fechaIso_(r.fecha, true, 'del ingreso'), cliente: txt_(r.cliente, 120), presupuesto: txt_(r.presupuesto, 20),
    concepto: txt_(r.concepto, 200), monto: monto_(r.monto), metodo: txt_(r.metodo, 40) || 'Otro', notas: txt_(r.notas, 500), creado: ahora_()
  };
  if (!reg.cliente && !reg.concepto) fallo('Escribe el cliente o el concepto del ingreso.');
  return agregarFila_(ESQUEMAS.ingresos, ctx.uid, reg);
}

export async function guardarGasto(ctx, r) {
  if (!r) fallo('No llegaron los datos del gasto.');
  const reg = {
    id: nuevoId_(), fecha: fechaIso_(r.fecha, true, 'del gasto'), categoria: txt_(r.categoria, 60) || 'Otros', descripcion: txt_(r.descripcion, 200),
    proveedor: txt_(r.proveedor, 120), monto: monto_(r.monto), metodo: txt_(r.metodo, 40) || 'Otro', notas: txt_(r.notas, 500), creado: ahora_()
  };
  if (!reg.descripcion) fallo('Escribe en qué se gastó.');
  return agregarFila_(ESQUEMAS.gastos, ctx.uid, reg);
}

export async function guardarPorCobrar(ctx, r) {
  if (!r) fallo('No llegaron los datos de la cuenta.');
  const reg = {
    id: nuevoId_(), fecha: fechaIso_(r.fecha, true, 'del trabajo'), cliente: txt_(r.cliente, 120), presupuesto: txt_(r.presupuesto, 20),
    concepto: txt_(r.concepto, 200), monto: monto_(r.monto), vence: fechaIso_(r.vence, false, 'límite de pago'),
    estado: 'Pendiente', fechaCobro: '', notas: txt_(r.notas, 500), creado: ahora_(), rec0: '', rec7: '', rec15: ''
  };
  if (!reg.cliente) fallo('Indica el cliente que debe el pago.');
  return agregarFila_(ESQUEMAS.porCobrar, ctx.uid, reg);
}

// Marca la cuenta como cobrada y crea automáticamente el ingreso correspondiente.
export async function cobrarPorCobrar(ctx, id, metodo) {
  const esq = ESQUEMAS.porCobrar;
  const c = await leerRegistro_(esq, ctx.uid, id);
  if (!c) fallo('No encuentro esa cuenta por cobrar.');
  if (c.estado === 'Cobrado') fallo('Esa cuenta ya estaba cobrada.');
  // Cambio condicionado (estado <> Cobrado): si llegan dos clics a la vez, solo uno lo logra
  const hoy = hoy_();
  const marcadas = ok(await db().from(esq.tabla).update({ estado: 'Cobrado', fecha_cobro: hoy })
    .eq('uid', ctx.uid).eq('id', c.id).neq('estado', 'Cobrado').select('id'));
  if (!marcadas.length) fallo('Esa cuenta ya estaba cobrada.');
  c.estado = 'Cobrado'; c.fechaCobro = hoy;
  const ingreso = {
    id: nuevoId_(), fecha: hoy, cliente: c.cliente, presupuesto: c.presupuesto, concepto: c.concepto || 'Cobro de cuenta pendiente',
    monto: c.monto, metodo: txt_(metodo, 40) || 'Otro', notas: 'Cobro de cuenta por cobrar' + (c.notas ? ' · ' + c.notas : ''), creado: ahora_()
  };
  try {
    await agregarFila_(ESQUEMAS.ingresos, ctx.uid, ingreso);
  } catch (e) {   // si no se pudo crear el ingreso, la cuenta vuelve a quedar pendiente
    await db().from(esq.tabla).update({ estado: 'Pendiente', fecha_cobro: null }).eq('uid', ctx.uid).eq('id', c.id);
    throw e;
  }
  return { porCobrar: c, ingreso };
}

// ---------------------------------------------------------------
//  PROVEEDORES
// ---------------------------------------------------------------
export const proveedoresDatos = ctx => leerTabla_(ESQUEMAS.proveedores, ctx.uid);

async function nombreProveedorLibre_(uid, nombre, idPropio) {
  const n = nombre.toLowerCase();
  const lista = await leerTabla_(ESQUEMAS.proveedores, uid);
  if (lista.some(x => x.id !== idPropio && x.nombre.toLowerCase() === n)) fallo('Ya existe un proveedor con ese nombre.');
}

export async function guardarProveedor(ctx, r) {
  if (!r) fallo('No llegaron los datos del proveedor.');
  const reg = { id: nuevoId_(), nombre: txt_(r.nombre, 120), rif: txt_(r.rif, 30), telefono: txt_(r.telefono, 40),
    correo: txt_(r.correo, 120), direccion: txt_(r.direccion, 200), notas: txt_(r.notas, 300), creado: ahora_() };
  if (!reg.nombre) fallo('Escribe el nombre del proveedor.');
  await nombreProveedorLibre_(ctx.uid, reg.nombre, '');
  return agregarFila_(ESQUEMAS.proveedores, ctx.uid, reg);
}

export async function actualizarProveedor(ctx, id, v) {
  if (!v) fallo('No llegaron los datos del proveedor.');
  const c = await leerRegistro_(ESQUEMAS.proveedores, ctx.uid, id);
  if (!c) fallo('No encuentro ese proveedor.');
  const nuevo = { id: c.id, nombre: txt_(v.nombre, 120), rif: txt_(v.rif, 30), telefono: txt_(v.telefono, 40),
    correo: txt_(v.correo, 120), direccion: txt_(v.direccion, 200), notas: txt_(v.notas, 300), creado: c.creado };
  if (!nuevo.nombre) fallo('El proveedor necesita un nombre.');
  await nombreProveedorLibre_(ctx.uid, nuevo.nombre, c.id);
  return escribirFila_(ESQUEMAS.proveedores, ctx.uid, nuevo);
}

export const eliminarProveedor = (ctx, id) => borrarFila_(ESQUEMAS.proveedores, ctx.uid, id, 'No encuentro ese proveedor (quizás ya fue eliminado).');

// Deudas a crédito: no cuentan como gasto hasta que se pagan (los gastos son pagos inmediatos).
export async function guardarPorPagar(ctx, r) {
  if (!r) fallo('No llegaron los datos de la cuenta por pagar.');
  const reg = {
    id: nuevoId_(), fecha: fechaIso_(r.fecha, true, 'de la compra'), proveedor: txt_(r.proveedor, 120), categoria: txt_(r.categoria, 60) || 'Otros',
    descripcion: txt_(r.descripcion, 200), monto: monto_(r.monto), vence: fechaIso_(r.vence, false, 'límite de pago'),
    estado: 'Pendiente', fechaPago: '', notas: txt_(r.notas, 500), creado: ahora_()
  };
  if (!reg.proveedor) fallo('Indica a quién le debes el pago.');
  if (!reg.descripcion) fallo('Escribe qué se compró a crédito.');
  return agregarFila_(ESQUEMAS.porPagar, ctx.uid, reg);
}

// Marca la deuda como pagada y crea automáticamente el gasto correspondiente.
export async function pagarPorPagar(ctx, id, metodo) {
  const esq = ESQUEMAS.porPagar;
  const c = await leerRegistro_(esq, ctx.uid, id);
  if (!c) fallo('No encuentro esa cuenta por pagar.');
  if (c.estado === 'Pagado') fallo('Esa cuenta ya estaba pagada.');
  const hoy = hoy_();
  const marcadas = ok(await db().from(esq.tabla).update({ estado: 'Pagado', fecha_pago: hoy })
    .eq('uid', ctx.uid).eq('id', c.id).neq('estado', 'Pagado').select('id'));
  if (!marcadas.length) fallo('Esa cuenta ya estaba pagada.');
  c.estado = 'Pagado'; c.fechaPago = hoy;
  const gasto = {
    id: nuevoId_(), fecha: hoy, categoria: c.categoria || 'Otros', descripcion: c.descripcion || 'Pago de cuenta por pagar',
    proveedor: c.proveedor, monto: c.monto, metodo: txt_(metodo, 40) || 'Otro',
    notas: 'Pago de cuenta por pagar' + (c.notas ? ' · ' + c.notas : ''), creado: ahora_()
  };
  try {
    await agregarFila_(ESQUEMAS.gastos, ctx.uid, gasto);
  } catch (e) {   // si no se pudo crear el gasto, la deuda vuelve a quedar pendiente
    await db().from(esq.tabla).update({ estado: 'Pendiente', fecha_pago: null }).eq('uid', ctx.uid).eq('id', c.id);
    throw e;
  }
  return { porPagar: c, gasto };
}

export function eliminarFinanza(ctx, tipo, id) {
  const esq = { ingreso: ESQUEMAS.ingresos, gasto: ESQUEMAS.gastos, porCobrar: ESQUEMAS.porCobrar, porPagar: ESQUEMAS.porPagar }[tipo];
  if (!esq) fallo('Tipo de registro no válido.');
  return borrarFila_(esq, ctx.uid, id, 'No encuentro ese registro (quizás ya fue eliminado).');
}

// Anota en la cuenta por cobrar que ya se envió un aviso (etapa 0 = vence hoy, 1 = vencido 7 d, 2 = vencido 15 d). Se puede repetir.
const REC_CAMPOS = ['rec0', 'rec7', 'rec15'];
export async function marcarRecordatorioCobro(ctx, id, etapa, canal) {
  const e = parseInt(etapa, 10);
  if (!(e >= 0 && e <= 2)) fallo('Etapa inválida.');
  const cn = canal === 'correo' ? 'correo' : 'wa';
  const c = await leerRegistro_(ESQUEMAS.porCobrar, ctx.uid, id);
  if (!c) fallo('No encuentro esa cuenta por cobrar.');
  c[REC_CAMPOS[e]] = hoy_() + ' ' + cn;
  return escribirFila_(ESQUEMAS.porCobrar, ctx.uid, c);
}

// ---------------------------------------------------------------
//  HERRAMIENTAS (inventario y préstamos)
// ---------------------------------------------------------------
export async function herramientasDatos(ctx) {
  const [inventario, prestamos] = await Promise.all([leerTabla_(ESQUEMAS.inventario, ctx.uid), leerTabla_(ESQUEMAS.prestamos, ctx.uid)]);
  return { inventario, prestamos };
}

async function unidadesPrestadas_(uid, herramientaId) {
  const filas = ok(await db().from('prestamos').select('cantidad').eq('uid', uid).eq('herramienta_id', herramientaId).eq('estado', 'Prestada'));
  return filas.reduce((s, p) => s + (Number(p.cantidad) || 0), 0);
}

function validarHerramienta_(v) {
  if (!v) fallo('No llegaron los datos de la herramienta.');
  const nombre = txt_(v.nombre, 120);
  if (!nombre) fallo('Falta el nombre de la herramienta.');
  const cantidad = Math.floor(Number(v.cantidad));
  if (!isFinite(cantidad) || cantidad < 1) fallo('La cantidad debe ser 1 o más.');
  const valor = Number(v.valor) || 0;
  if (valor < 0) fallo('El valor no puede ser negativo.');
  return {
    nombre, marca: txt_(v.marca, 120), categoria: txt_(v.categoria, 60) || 'Otros', cantidad,
    estado: ESTADOS_HERR.includes(v.estado) ? v.estado : 'Buena', ubicacion: txt_(v.ubicacion, 120),
    valor: redondear_(valor), notas: txt_(v.notas, 500)
  };
}

export async function guardarHerramienta(ctx, r) {
  const reg = Object.assign({ id: nuevoId_(), creado: ahora_() }, validarHerramienta_(r));
  return agregarFila_(ESQUEMAS.inventario, ctx.uid, reg);
}

export async function actualizarHerramienta(ctx, id, valores) {
  const nueva = validarHerramienta_(valores);
  const actual = await leerRegistro_(ESQUEMAS.inventario, ctx.uid, id);
  if (!actual) fallo('No encuentro esa herramienta.');
  const prestadas = await unidadesPrestadas_(ctx.uid, actual.id);
  if (nueva.cantidad < prestadas) fallo('Hay ' + prestadas + ' unidad(es) prestada(s); la cantidad no puede ser menor.');
  return escribirFila_(ESQUEMAS.inventario, ctx.uid, Object.assign({}, actual, nueva));
}

export async function eliminarHerramienta(ctx, id) {
  const h = await leerRegistro_(ESQUEMAS.inventario, ctx.uid, id);
  if (!h) fallo('No encuentro esa herramienta (quizás ya fue eliminada).');
  if (await unidadesPrestadas_(ctx.uid, h.id) > 0) fallo('Esa herramienta está en préstamo. Registra primero la devolución.');
  return borrarFila_(ESQUEMAS.inventario, ctx.uid, h.id, 'No encuentro esa herramienta (quizás ya fue eliminada).');
}

export async function prestarHerramienta(ctx, r) {
  if (!r) fallo('No llegaron los datos del préstamo.');
  const cantidad = Math.floor(Number(r.cantidad));
  if (!isFinite(cantidad) || cantidad < 1) fallo('La cantidad debe ser 1 o más.');
  const persona = txt_(r.persona, 120);
  if (!persona) fallo('Indica a quién se la prestas.');
  const fechaPrestamo = fechaIso_(r.fechaPrestamo, true, 'del préstamo');
  const fechaPrevista = fechaIso_(r.fechaPrevista, false, 'de devolución');
  if (fechaPrevista && fechaPrevista < fechaPrestamo) fallo('La devolución no puede ser antes del préstamo.');

  const herr = await leerRegistro_(ESQUEMAS.inventario, ctx.uid, r.herramientaId);
  if (!herr) fallo('No encuentro esa herramienta en el inventario.');
  if (herr.estado === 'En reparación') fallo('Esa herramienta está en reparación.');
  const disponible = herr.cantidad - await unidadesPrestadas_(ctx.uid, herr.id);
  if (cantidad > disponible) fallo('Solo hay ' + disponible + ' unidad(es) disponible(s).');
  const reg = {
    id: nuevoId_(), herramientaId: herr.id, herramienta: herr.nombre + (herr.marca ? ' · ' + herr.marca : ''), cantidad,
    persona, telefono: txt_(r.telefono, 40), fechaPrestamo, fechaPrevista,
    estado: 'Prestada', fechaDevolucion: '', notas: txt_(r.notas, 500), creado: ahora_()
  };
  return agregarFila_(ESQUEMAS.prestamos, ctx.uid, reg);
}

export async function devolverHerramienta(ctx, id) {
  const p = await leerRegistro_(ESQUEMAS.prestamos, ctx.uid, id);
  if (!p) fallo('No encuentro ese préstamo.');
  if (p.estado === 'Devuelta') fallo('Ese préstamo ya estaba devuelto.');
  p.estado = 'Devuelta'; p.fechaDevolucion = hoy_();
  return escribirFila_(ESQUEMAS.prestamos, ctx.uid, p);
}

// ---------------------------------------------------------------
//  AGENDA · citas de clientes
// ---------------------------------------------------------------
export const agendaDatos = ctx => leerTabla_(ESQUEMAS.citas, ctx.uid);

const horaMin_ = h => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(h || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };

// Cita activa (pendiente o confirmada) que se cruza con ese horario
async function choqueCita_(uid, fecha, hora, dur, ignorarId) {
  const ini = horaMin_(hora);
  const filas = ok(await db().from('citas').select('*').eq('uid', uid).eq('fecha', fecha).in('estado', ['Pendiente', 'Confirmada']));
  return filas.map(f => filaAObjeto_(ESQUEMAS.citas, f))
    .find(c => c.id !== ignorarId && ini < horaMin_(c.hora) + c.duracion && horaMin_(c.hora) < ini + dur) || null;
}

export async function guardarCita(ctx, r) {
  if (!r) fallo('No llegaron los datos de la cita.');
  const cliente = txt_(r.cliente, 120), servicio = txt_(r.servicio, 160);
  if (!cliente) fallo('Falta el cliente.');
  if (!servicio) fallo('Falta el servicio o motivo.');
  const fecha = fechaIso_(r.fecha, true, 'de la cita');
  if (horaMin_(r.hora) < 0) fallo('La hora no es válida.');
  const duracion = Math.floor(Number(r.duracion));
  if (!isFinite(duracion) || duracion < 15 || duracion > 720) fallo('La duración no es válida.');
  const ch = r.forzar ? null : await choqueCita_(ctx.uid, fecha, r.hora, duracion, '');
  if (ch) fallo('Ya tienes a ' + ch.cliente + ' a las ' + ch.hora + ' ese día.');
  return agregarFila_(ESQUEMAS.citas, ctx.uid, { id: nuevoId_(), fecha, hora: r.hora, duracion, cliente, telefono: txt_(r.telefono, 40),
    servicio, direccion: txt_(r.direccion, 200), estado: 'Pendiente', notas: txt_(r.notas, 500), creado: ahora_() });
}

export async function reprogramarCita(ctx, id, fecha, hora, forzar) {
  fecha = fechaIso_(fecha, true, 'de la cita');
  if (horaMin_(hora) < 0) fallo('La hora no es válida.');
  const c = await leerRegistro_(ESQUEMAS.citas, ctx.uid, id);
  if (!c) fallo('No encuentro esa cita.');
  const ch = forzar ? null : await choqueCita_(ctx.uid, fecha, hora, c.duracion, c.id);
  if (ch) fallo('Ya tienes a ' + ch.cliente + ' a las ' + ch.hora + ' ese día.');
  c.fecha = fecha; c.hora = hora; c.estado = 'Pendiente';
  return escribirFila_(ESQUEMAS.citas, ctx.uid, c);
}

export async function cambiarEstadoCita(ctx, id, estado) {
  if (!ESTADOS_CITA.includes(estado)) fallo('Estado no válido.');
  const c = await leerRegistro_(ESQUEMAS.citas, ctx.uid, id);
  if (!c) fallo('No encuentro esa cita.');
  c.estado = estado;
  return escribirFila_(ESQUEMAS.citas, ctx.uid, c);
}

export const eliminarCita = (ctx, id) => borrarFila_(ESQUEMAS.citas, ctx.uid, id, 'No encuentro esa cita (quizás ya fue eliminada).');
