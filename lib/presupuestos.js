// ---------------------------------------------------------------
//  PRESUPUESTOS (antes pestañas PRESUPUESTOS e Historial) y CLIENTES (antes Base_Clientes)
// ---------------------------------------------------------------
import { db } from './db.js';
import { ok, fallo, redondear_, numeroEntero_, formatearNumero_, correoValido, fmtUsd, fmtBs, fechaHoraVisible } from './util.js';
import { crearPdfPresupuesto } from './pdf.js';
import { datosEmpresa_, bytesImagen, opcionesRemitente_, consumirCupoCorreo_, leerPerfilCrudo_, imagenesPropias_ } from './perfil.js';
import { leerPlantilla_, sanearPlantilla_ } from './plantilla.js';
import { enviarCorreo, cuotaRestante } from './correo.js';

// Los presupuestos guardados con la versión de Google Sheets llevan un apóstrofo delante de =, +, - o @
const sinApostrofo = s => String(s).replace(/^'(?=[=+\-@])/, '');

export function normalizarDatos_(d) {
  if (!d) fallo('No llegaron datos del presupuesto.');
  const items = (d.items || [])
    .map(it => ({ desc: sinApostrofo(String(it.desc || '').trim()), cant: Number(it.cant) || 0, precio: Number(it.precio) || 0 }))
    .filter(it => it.desc);
  if (!items.length) fallo('El presupuesto no tiene artículos.');
  return {
    numero: formatearNumero_(d.numero),
    cliente: String(d.cliente || '').trim(),
    telefono: String(d.telefono || '').trim(),
    rif: String(d.rif || '').trim(),
    tipoContacto: d.tipoContacto === 'rif' ? 'rif' : 'telefono',   // con qué se registra el presupuesto
    correo: String(d.correo || '').trim(),
    fecha: String(d.fecha || '').trim(),
    vigencia: Number(d.vigencia) || 0,
    tasa: Number(d.tasa) || 0,
    iva: Number(d.iva) || 0,
    nota: sinApostrofo(String(d.nota || '').trim()),               // opcional: si viene vacía no se imprime
    observacion: sinApostrofo(String(d.observacion || '').trim()), // opcional: si viene vacía no se imprime
    items
  };
}

export function calcularTotales_(d) {
  const sub = d.items.reduce((s, it) => s + it.cant * it.precio, 0);
  const iva = sub * d.iva / 100;
  const total = sub + iva;
  return { sub: redondear_(sub), iva: redondear_(iva), total: redondear_(total), totalBs: redondear_(total * d.tasa) };
}

// ---------------------------------------------------------------
//  1. DATOS DE ARRANQUE
// ---------------------------------------------------------------
export async function obtenerDatosDeArranque(ctx) {
  const [numero, filas] = await Promise.all([
    proximoNumero_(ctx.uid),
    db().from('clientes').select('nombre, rif, telefono, correo').eq('uid', ctx.uid).neq('nombre', '').order('nombre').then(ok)
  ]);
  return { numero, clientes: filas.map(c => ({ nombre: c.nombre, rif: c.rif, telefono: c.telefono, correo: c.correo })) };
}

async function proximoNumero_(uid) {
  const f = ok(await db().from('presupuestos').select('numero').eq('uid', uid).order('numero', { ascending: false }).limit(1).maybeSingle());
  return formatearNumero_((f ? f.numero : 0) + 1);
}

// ---------------------------------------------------------------
//  2. PDF
// ---------------------------------------------------------------
// Una imagen que no se pueda leer nunca debe impedir el PDF: se omite
async function imagenOpcional_(id, nombre) {
  if (!id) return null;
  try { return await bytesImagen(id); } catch (e) { console.warn(nombre + ' no disponible:', e.message); return null; }
}

// `plantilla` solo se pasa en la vista previa (diseño aún sin guardar); si no, se usa la guardada del cliente
async function crearPdfBlob_(ctx, d, plantilla, emp) {
  emp = emp || await datosEmpresa_(ctx);
  const pl = plantilla || leerPlantilla_(await leerPerfilCrudo_(ctx.uid));
  const [logo, banner, sello, marca] = await Promise.all([
    imagenOpcional_(emp.logoId, 'Logo'), imagenOpcional_(pl.encabezado.bannerId, 'Encabezado'),
    imagenOpcional_(pl.sello.id, 'Sello'), imagenOpcional_(pl.marcaAgua.id, 'Marca de agua')
  ]);
  const bytes = await crearPdfPresupuesto(d, calcularTotales_(d), emp, logo, pl, { banner, sello, marca });
  return { nombre: 'Presupuesto_' + d.numero + '.pdf', bytes };
}

// PDF de prueba para el diseñador: usa el diseño que se está editando (aunque no esté guardado) y datos de ejemplo
export async function pdfDePrueba(ctx, plantilla) {
  const crudo = await leerPerfilCrudo_(ctx.uid);
  const pl = sanearPlantilla_(plantilla, imagenesPropias_(crudo));
  const real = await datosEmpresa_(ctx);
  const emp = {
    marca: real.marca, especialidad: real.especialidad || 'Tu especialidad o servicio', rif: real.rif || 'V-12345678-9',
    correo: real.correo || 'contacto@tunegocio.com', direccion: real.direccion || 'Tu dirección completa, ciudad y estado.',
    telefonos: real.telefonos || 'Teléfonos:  0414-1234567 / 0416-7654321', logoId: real.logoId
  };
  const d = normalizarDatos_({
    numero: '1', cliente: 'Cliente de ejemplo', telefono: '0414-0000000', fecha: new Date().toLocaleDateString('es-VE'),
    vigencia: 15, tasa: 40, iva: 16, nota: pl.notaDefecto, observacion: pl.obsDefecto,
    items: [
      { desc: 'Mantenimiento preventivo de equipo split 12.000 BTU', cant: 2, precio: 35 },
      { desc: 'Material e instalación (incluye garantía)', cant: 1, precio: 60 },
      { desc: 'Repuesto de ejemplo', cant: 3, precio: 12.5 }
    ]
  });
  const pdf = await crearPdfBlob_(ctx, d, pl, emp);
  return { nombre: 'Prueba_de_diseno.pdf', base64: pdf.bytes.toString('base64') };
}

export async function generarPdf(ctx, datos) {
  const pdf = await crearPdfBlob_(ctx, normalizarDatos_(datos));
  return { nombre: pdf.nombre, base64: pdf.bytes.toString('base64') };
}

// ---------------------------------------------------------------
//  3. ENVIAR POR CORREO
// ---------------------------------------------------------------
export async function enviarPresupuestoPorCorreo(ctx, datos, correoDestino) {
  const correo = String(correoDestino || '').trim();
  if (!correoValido(correo)) fallo('El correo "' + correo + '" no es válido.');
  if (await cuotaRestante() < 1) fallo('Se alcanzó el límite diario de correos del sistema. Intenta mañana o envía el PDF por WhatsApp.');
  const d = normalizarDatos_(datos);
  const emp = await datosEmpresa_(ctx);
  const opciones = await opcionesRemitente_(ctx);
  await consumirCupoCorreo_(ctx);
  const pdf = await crearPdfBlob_(ctx, d);

  const cuerpo = 'Estimado/a ' + (d.cliente || 'cliente') + ',\n\n' +
    'Adjunto a este correo encontrará el presupuesto N° ' + d.numero + ' solicitado.\n\n' +
    'Quedamos a su entera disposición para cualquier duda o consulta.\n\n' +
    'Saludos cordiales,\n\n' +
    emp.marca + '\n' +
    emp.especialidad + '\n' +
    (emp.correo ? emp.correo + '\n' : '') +
    (emp.telefonos ? emp.telefonos : '');

  await enviarCorreo(Object.assign({
    to: correo, subject: 'Presupuesto N° ' + d.numero + ' - ' + emp.marca, text: cuerpo,
    attachments: [{ filename: pdf.nombre, content: pdf.bytes, contentType: 'application/pdf' }]
  }, opciones));
  return 'EXITO';
}

// ---------------------------------------------------------------
//  4. HISTORIAL (guarda el detalle completo para poder reimprimir)
// ---------------------------------------------------------------
export async function guardarEnHistorial(ctx, datos) {
  const d = normalizarDatos_(datos);
  const t = calcularTotales_(d);
  const numero = numeroEntero_(d.numero);
  const fila = { cliente: d.cliente, total_usd: t.total, total_bs: t.totalBs, contacto: d.tipoContacto === 'rif' ? d.rif : d.telefono, detalle: d };
  // si ya existía ese Nº se actualiza conservando la fecha original de registro
  const actualizadas = ok(await db().from('presupuestos').update(fila).eq('uid', ctx.uid).eq('numero', numero).select('numero'));
  if (!actualizadas.length) {
    ok(await db().from('presupuestos').upsert(Object.assign({ uid: ctx.uid, numero, fecha: new Date().toISOString() }, fila), { onConflict: 'uid,numero' }));
  }
  return { proximo: await proximoNumero_(ctx.uid) };
}

export async function obtenerHistorial(ctx) {
  const filas = ok(await db().from('presupuestos').select('numero, fecha, cliente, total_usd, total_bs, contacto, tiene:detalle->>numero')
    .eq('uid', ctx.uid).order('numero', { ascending: false }));
  return filas.map(r => ({
    numero: formatearNumero_(r.numero),
    fecha: fechaHoraVisible(r.fecha),
    cliente: r.cliente,
    totalUsd: fmtUsd(r.total_usd),
    totalBs: fmtBs(r.total_bs),
    telefono: r.contacto || '',
    tieneDetalle: !!r.tiene
  }));
}

export async function obtenerDetalle(ctx, numero) {
  const r = ok(await db().from('presupuestos').select('detalle').eq('uid', ctx.uid).eq('numero', numeroEntero_(numero)).maybeSingle());
  if (!r) fallo('No encontré el presupuesto Nº ' + formatearNumero_(numero) + '.');
  if (!r.detalle) fallo('El presupuesto Nº ' + formatearNumero_(numero) + ' se guardó con la versión anterior y no tiene el detalle de artículos, por eso no se puede reimprimir.');
  return r.detalle;
}

export async function reimprimirPresupuesto(ctx, numero) {
  return generarPdf(ctx, await obtenerDetalle(ctx, numero));
}

// ---------------------------------------------------------------
//  5. CLIENTES (ordenados de la A a la Z)
//  Se devuelve igual que antes (fila de encabezados + filas), con el id del cliente en la 7ª posición.
// ---------------------------------------------------------------
const ENCABEZADOS_CLIENTES = ['Fecha de Registro', 'Nombre / Razón Social', 'RIF / Cédula', 'Teléfono', 'Correo Electrónico', 'Dirección/Notas', 'ID'];

export async function guardarClienteBD(ctx, c) {
  if (!c || !String(c.nombre || '').trim()) fallo('Falta el nombre del cliente.');
  const s = (v, max) => String(v || '').trim().slice(0, max);
  ok(await db().from('clientes').insert({
    uid: ctx.uid, nombre: s(c.nombre, 160), rif: s(c.rif, 40), telefono: s(c.telefono, 60), correo: s(c.correo, 160), direccion: s(c.direccion, 500)
  }));
  return 'EXITO';
}

export async function obtenerClientes(ctx) {
  const filas = ok(await db().from('clientes').select('*').eq('uid', ctx.uid).order('nombre'));
  return [ENCABEZADOS_CLIENTES].concat(filas.map(c => [fechaHoraVisible(c.fecha_registro), c.nombre, c.rif, c.telefono, c.correo, c.direccion, c.id]));
}

export async function actualizarCliente(ctx, id, valores) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) fallo('Cliente no válido. Recarga la lista.');
  if (!Array.isArray(valores) || valores.length !== 5) fallo('Datos de cliente incompletos.');
  const s = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const cambiadas = ok(await db().from('clientes').update({
    nombre: s(valores[0], 160), rif: s(valores[1], 40), telefono: s(valores[2], 60), correo: s(valores[3], 160), direccion: s(valores[4], 500)
  }).eq('uid', ctx.uid).eq('id', id).select('id'));
  if (!cambiadas.length) fallo('No encuentro ese cliente. Recarga la lista.');
  return 'EXITO';
}
