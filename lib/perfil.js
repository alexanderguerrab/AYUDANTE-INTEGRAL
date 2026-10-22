// ===============================================================
//  PERFIL DEL CLIENTE (antes pestaña "Perfil" de su hoja) · imágenes · scripts de cobro · recordatorios
// ===============================================================
import { db } from './db.js';
import { CONFIG, BUCKET_IMAGENES, CUPO_CORREOS_DIA } from './config.js';
import { ok, fallo, limpiarTexto_, correoValido, hoy_ } from './util.js';
import { enviarCorreo, cuotaRestante, cuentaCorreo, aliasesCorreo } from './correo.js';
import { actualizarNombreUsuario } from './usuarios.js';

const PERFIL_TEXTOS = { nombre: 80, marca: 80, especialidad: 100, rif: 30, direccion: 200, telefonos: 160, red1n: 40, red2n: 40, red3n: 40 };
const PERFIL_ENLACES = ['red1l', 'red2l', 'red3l'];
const PERFIL_NUMEROS = { iva: [0, 100], vigencia: [1, 365], metaMensual: [0, 1000000000] };
const MAX_METODOS = 8;

// Ids de imagen: "uid/archivo.jpg" en Supabase Storage (o un id antiguo de Google Drive)
export const esIdImagen = id => /^[\w-]{10,100}(\/[\w.-]{1,150})?$/.test(String(id || ''));
export const enStorage = id => String(id).includes('/');

// ---------- Lectura y escritura del perfil (jsonb clave → texto) ----------
export async function leerPerfilCrudo_(uid) {
  const f = ok(await db().from('perfiles').select('datos').eq('uid', uid).maybeSingle());
  return (f && f.datos) || {};
}

export async function escribirPerfil_(uid, datos) {
  ok(await db().from('perfiles').upsert({ uid, datos }));
}

// Guarda (o crea) claves sueltas del perfil
async function guardarClavesPerfil_(uid, claves) {
  const c = await leerPerfilCrudo_(uid);
  Object.keys(claves).forEach(k => { c[k] = String(claves[k] === null || claves[k] === undefined ? '' : claves[k]); });
  await escribirPerfil_(uid, c);
}

export function imagenesPropias_(crudo) {
  try { const a = JSON.parse(crudo.imagenes || '[]'); return Array.isArray(a) ? a.filter(esIdImagen) : []; }
  catch (e) { return []; }
}

function armarPerfil_(c) {
  let metodos = [];
  try { metodos = JSON.parse(c.metodos || '[]'); } catch (e) { metodos = []; }
  if (!Array.isArray(metodos)) metodos = [];
  const p = { metodos };
  ['nombre', 'marca', 'especialidad', 'rif', 'direccion', 'telefonos', 'correo', 'logoId', 'red1n', 'red1l', 'red2n', 'red2l', 'red3n', 'red3l'].forEach(k => { p[k] = c[k] || ''; });
  Object.keys(PERFIL_NUMEROS).forEach(k => { p[k] = (c[k] === undefined || c[k] === '') ? '' : Number(c[k]); });
  p.gmail = c.gmailCorreo || '';
  return p;
}

export async function obtenerPerfil(ctx) { return armarPerfil_(await leerPerfilCrudo_(ctx.uid)); }

export async function perfilActivo_(ctx) {
  if (!ctx.perfilMemo) ctx.perfilMemo = await obtenerPerfil(ctx);
  return ctx.perfilMemo;
}

// Datos que salen impresos en el PDF y en el correo. Un cliente NUNCA hereda los datos del administrador.
export async function datosEmpresa_(ctx) {
  const p = await perfilActivo_(ctx);
  const admin = ctx.esSuper;
  const tel = p.telefonos ? (/^tel/i.test(p.telefonos) ? p.telefonos : 'Teléfonos:  ' + p.telefonos) : (admin ? CONFIG.TELEFONOS : '');
  return {
    marca: p.marca || p.nombre || (admin ? CONFIG.NOMBRE_REMITENTE : 'Mi negocio'),
    especialidad: p.especialidad || (admin ? CONFIG.ESPECIALIDAD_ADMIN : ''),
    direccion: p.direccion || (admin ? CONFIG.DIRECCION : ''),
    telefonos: tel,
    correo: p.correo || (admin ? CONFIG.CORREO_REMITENTE : ''),
    rif: p.rif || '',
    logoId: p.logoId || ''
  };
}

function urlHttp_(v, max, nombre) {
  const s = limpiarTexto_(v, max + 1);
  if (!s) return '';
  if (s.length > max) fallo(nombre + ' es demasiado largo.');
  if (!/^https?:\/\/[^\s"'<>\\]+$/i.test(s)) fallo(nombre + ' no es válido (debe empezar con http:// o https://).');
  return s;
}

export async function guardarPerfil(ctx, d) {
  if (!d || typeof d !== 'object') fallo('No llegaron los datos del perfil.');
  const crudo = await leerPerfilCrudo_(ctx.uid);
  const propias = imagenesPropias_(crudo);
  const nuevo = {};

  Object.keys(PERFIL_TEXTOS).forEach(k => { nuevo[k] = limpiarTexto_(d[k], PERFIL_TEXTOS[k]); });
  PERFIL_ENLACES.forEach(k => { nuevo[k] = urlHttp_(d[k], 500, 'El enlace de la red social'); });

  const correo = limpiarTexto_(d.correo, 120);
  if (correo && !correoValido(correo)) fallo('El correo de contacto no es válido.');
  nuevo.correo = correo;

  Object.keys(PERFIL_NUMEROS).forEach(k => {
    const raw = (d[k] === null || d[k] === undefined) ? '' : String(d[k]).trim().replace(',', '.');
    if (raw === '') { nuevo[k] = ''; return; }
    const n = Number(raw), lim = PERFIL_NUMEROS[k];
    if (!isFinite(n) || n < lim[0] || n > lim[1]) fallo('El valor de «' + k + '» debe estar entre ' + lim[0] + ' y ' + lim[1] + '.');
    nuevo[k] = n;
  });

  const logoId = String(d.logoId || '');
  if (logoId && !propias.includes(logoId)) fallo('La imagen del logo no es válida. Vuelve a subirla.');
  nuevo.logoId = logoId;

  // Métodos de pago: nombre + datos (texto) + enlace + código QR (imagen)
  const lista = Array.isArray(d.metodos) ? d.metodos : [];
  if (lista.length > MAX_METODOS) fallo('Máximo ' + MAX_METODOS + ' métodos de pago.');
  const vistos = {};
  const metodos = [];
  lista.forEach((m, i) => {
    const nombre = limpiarTexto_(m && m.nombre, 40);
    const datos = limpiarTexto_(m && m.datos, 400, true);
    const enlace = urlHttp_(m && m.enlace, 500, 'El enlace del método de pago');
    const qrId = String((m && m.qrId) || '');
    if (!nombre) { if (datos || enlace || qrId) fallo('El método de pago #' + (i + 1) + ' necesita un nombre.'); return; }
    if (qrId && !propias.includes(qrId)) fallo('El código QR de «' + nombre + '» no es válido. Vuelve a subirlo.');
    const k = nombre.toLowerCase();
    if (vistos[k]) fallo('El método «' + nombre + '» está repetido.');
    vistos[k] = true;
    metodos.push({ nombre, datos, enlace, qrId });
  });
  const metodosJson = JSON.stringify(metodos);
  if (metodosJson.length > 20000) fallo('Los métodos de pago ocupan demasiado espacio. Acorta los textos.');

  // Imágenes que ya no se usan (logo o QR reemplazados/quitados) se borran del almacenamiento
  const usadas = {};
  if (logoId) usadas[logoId] = true;
  metodos.forEach(m => { if (m.qrId) usadas[m.qrId] = true; });
  try {   // imágenes de la plantilla del presupuesto (banner, sello, marca de agua)
    const pl = JSON.parse(crudo.plantilla || 'null') || {};
    [pl.encabezado && pl.encabezado.bannerId, pl.sello && pl.sello.id, pl.marcaAgua && pl.marcaAgua.id].forEach(id => { if (id) usadas[id] = true; });
  } catch (e) { /* plantilla ilegible: no hay imágenes que proteger */ }
  const conservar = propias.filter(id => usadas[id]);
  const sobran = propias.filter(id => !usadas[id] && enStorage(id) && id.startsWith(ctx.uid + '/'));
  if (sobran.length) await db().storage.from(BUCKET_IMAGENES).remove(sobran);

  const extra = {};
  Object.keys(crudo).forEach(k => { if (/^(script|gmail|envios|plantilla)/.test(k)) extra[k] = crudo[k]; });   // claves que guardan otras pantallas
  const valores = Object.assign({}, nuevo, extra, { metodos: metodosJson, imagenes: JSON.stringify(conservar) });
  const datos = {};
  Object.keys(valores).forEach(k => { datos[k] = (valores[k] === null || valores[k] === undefined) ? '' : String(valores[k]); });
  await escribirPerfil_(ctx.uid, datos);
  ctx.perfilMemo = null;

  // Nombre visible en el panel de administración
  await actualizarNombreUsuario(ctx.uid, nuevo.nombre || nuevo.marca, nuevo.especialidad);
  return obtenerPerfil(ctx);
}

// Sube el logo o un código QR (el navegador ya la reduce). Devuelve el id; el perfil lo guarda al pulsar «Guardar».
export async function subirImagenPerfil(ctx, img) {
  if (!img || !img.base64) fallo('No llegó la imagen.');
  const mime = String(img.mime || '');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) fallo('Solo se aceptan imágenes JPG, PNG o WEBP.');
  const bytes = Buffer.from(String(img.base64).replace(/^data:[^,]*,/, ''), 'base64');
  if (bytes.length > 300 * 1024) fallo('La imagen es demasiado grande (máximo 300 KB). Usa una más pequeña.');
  const u = bytes.subarray(0, 12);
  const esJpg = u[0] === 0xFF && u[1] === 0xD8;
  const esPng = u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4E && u[3] === 0x47;
  const esWebp = u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46 && u[8] === 0x57 && u[9] === 0x45;
  if (!(esJpg || esPng || esWebp)) fallo('El archivo no parece una imagen válida.');

  const crudo = await leerPerfilCrudo_(ctx.uid);
  const propias = imagenesPropias_(crudo);
  if (propias.length >= 40) fallo('Tienes demasiadas imágenes pendientes. Pulsa «Guardar» en tu perfil para limpiar las que no usas.');

  const ext = esPng ? 'png' : (esWebp ? 'webp' : 'jpg');
  const tipoMime = esPng ? 'image/png' : (esWebp ? 'image/webp' : 'image/jpeg');
  const tipo = ['qr', 'sello', 'marca', 'banner'].includes(img.tipo) ? img.tipo : 'logo';
  const id = ctx.uid + '/' + tipo + '_' + Date.now() + '.' + ext;
  ok(await db().storage.from(BUCKET_IMAGENES).upload(id, bytes, { contentType: tipoMime, upsert: false }));

  // registrar la imagen como "propia" de este cliente (solo esas se pueden leer o asignar después)
  propias.push(id);
  await guardarClavesPerfil_(ctx.uid, { imagenes: JSON.stringify(propias) });
  return { id, url: urlImagen(id) };
}

export function urlImagen(id) {
  if (!enStorage(id)) return 'https://lh3.googleusercontent.com/d/' + id;
  return db().storage.from(BUCKET_IMAGENES).getPublicUrl(id).data.publicUrl;
}

// Bytes de una imagen propia (para el PDF y para compartirla desde el celular)
export async function bytesImagen(id) {
  if (enStorage(id)) {
    const { data, error } = await db().storage.from(BUCKET_IMAGENES).download(id);
    if (error) throw new Error('Supabase storage: ' + error.message);
    return { mime: data.type || 'image/jpeg', bytes: Buffer.from(await data.arrayBuffer()) };
  }
  const r = await fetch('https://lh3.googleusercontent.com/d/' + id);
  if (!r.ok) throw new Error('No se pudo descargar la imagen de Drive');
  return { mime: r.headers.get('content-type') || 'image/jpeg', bytes: Buffer.from(await r.arrayBuffer()) };
}

export async function imagenBase64Perfil(ctx, id) {
  id = String(id || '');
  if (!imagenesPropias_(await leerPerfilCrudo_(ctx.uid)).includes(id)) fallo('Imagen no encontrada.');
  const img = await bytesImagen(id);
  return { mime: img.mime, base64: img.bytes.toString('base64') };
}

export async function borrarImagenesDeUsuario(uid) {
  const bucket = db().storage.from(BUCKET_IMAGENES);
  const { data } = await bucket.list(uid, { limit: 1000 });
  if (data && data.length) await bucket.remove(data.map(f => uid + '/' + f.name));
}

// ===============================================================
//  SCRIPTS DE COBRO DEL CLIENTE · RECORDATORIOS · GMAIL
// ===============================================================
// Mensajes que el cliente envía por WhatsApp o correo (cuentas por cobrar y herramientas prestadas).
const SCRIPTS_CLAVES = { hoy: 'scriptHoy', d7: 'script7', d15: 'script15', herr: 'scriptHerr' };
const SCRIPT_MAX = 1200;
const SCRIPTS_DEFECTO = {
  hoy: 'Hola [Nombre], espero que estés teniendo una excelente semana. Te escribo solo para confirmar si recibiste el cobro de "[Proyecto]" por [Monto], ya que en mi sistema aún aparece como pendiente. ¡Quedo atento por si necesitas que te lo reenvíe! — [Negocio]',
  d7: 'Hola [Nombre], te contacto para dar seguimiento al pago de "[Proyecto]" por [Monto]. Me ayudaría mucho si pudieras confirmarme una fecha estimada para el pago, así puedo mantener organizada mi agenda de trabajos. Saludos. — [Negocio]',
  d15: 'Hola [Nombre]. Debido a que el pago de "[Proyecto]" por [Monto] presenta un retraso considerable, me veo en la necesidad de pausar los trabajos y servicios pendientes hasta que el saldo sea regularizado. Avísame en cuanto tengas el comprobante para retomar de inmediato. — [Negocio]',
  herr: 'Hola [Nombre], te escribe [Negocio]. Te recuerdo la herramienta que te presté ([Cantidad] × [Herramienta]); la fecha de devolución era el [Fecha]. ¿Cuándo podemos coordinar la entrega? ¡Gracias!'
};

// Texto vacío = se usa el mensaje original (así, si algún día mejoramos los originales, se actualizan solos)
export async function obtenerScriptsCobro(ctx) {
  const c = await leerPerfilCrudo_(ctx.uid), o = {};
  Object.keys(SCRIPTS_CLAVES).forEach(k => { const v = c[SCRIPTS_CLAVES[k]]; o[k] = (v && String(v).trim()) ? v : SCRIPTS_DEFECTO[k]; });
  return o;
}

export async function guardarScriptsCobro(ctx, s) {
  if (!s || typeof s !== 'object') fallo('No llegaron los mensajes.');
  const claves = {};
  Object.keys(SCRIPTS_CLAVES).forEach(k => {
    const txt = limpiarTexto_(s[k], SCRIPT_MAX + 1, true);
    if (txt.length > SCRIPT_MAX) fallo('Un mensaje es demasiado largo (máximo ' + SCRIPT_MAX + ' caracteres).');
    claves[SCRIPTS_CLAVES[k]] = txt === SCRIPTS_DEFECTO[k] ? '' : txt;
  });
  await guardarClavesPerfil_(ctx.uid, claves);
  return obtenerScriptsCobro(ctx);
}

// Límite diario de correos enviados desde el sistema (no aplica al administrador ni a quien conecta su propio Gmail)
export async function consumirCupoCorreo_(ctx) {
  if (ctx.esSuper) return;
  const hoy = hoy_(), partes = String((await leerPerfilCrudo_(ctx.uid)).enviosDia || '').split(':');
  const n = partes[0] === hoy ? (parseInt(partes[1], 10) || 0) : 0;
  if (n >= CUPO_CORREOS_DIA) fallo('Llegaste al límite de ' + CUPO_CORREOS_DIA + ' correos por día desde el sistema. Conecta tu Gmail (Finanzas > Scripts de cobro) para enviar sin ese límite, o usa WhatsApp.');
  await guardarClavesPerfil_(ctx.uid, { enviosDia: hoy + ':' + (n + 1) });
}

// Desde qué dirección sale el correo.
//  · Clientes: sale del sistema con el NOMBRE de su negocio y las respuestas llegan al correo de SU perfil (reply-to).
//  · Súper administrador: nombre fijo de la app, reply-to al correo del administrador.
export async function opcionesRemitente_(ctx) {
  const emp = await datosEmpresa_(ctx);
  const propio = cuentaCorreo();
  if (!ctx.esSuper) return { name: emp.marca, replyTo: emp.correo || propio };
  const remitente = (CONFIG.CORREO_REMITENTE || propio).toLowerCase();
  const o = { name: CONFIG.NOMBRE_REMITENTE, replyTo: remitente };
  if (CONFIG.COPIA_OCULTA) o.bcc = CONFIG.COPIA_OCULTA;
  if (remitente !== propio && aliasesCorreo().includes(remitente)) o.from = remitente;   // alias de "Enviar como"
  return o;
}

// Correo de recordatorio enviado desde el sistema con el nombre del negocio del cliente
export async function enviarRecordatorioCorreo(ctx, p) {
  const para = String((p && p.para) || '').trim();
  if (para.length > 120 || !correoValido(para)) fallo('El correo de destino no es válido.');
  const mensaje = limpiarTexto_(p.mensaje, 2000, true);
  if (!mensaje) fallo('El mensaje está vacío.');
  const asunto = limpiarTexto_(p.asunto, 120) || 'Recordatorio';
  if (await cuotaRestante() < 1) fallo('Se alcanzó el límite diario de correos del sistema. Usa WhatsApp o conecta tu Gmail.');
  const emp = await datosEmpresa_(ctx);
  const opciones = await opcionesRemitente_(ctx);
  await consumirCupoCorreo_(ctx);
  const cuerpo = mensaje + (emp.marca ? '\n\n— ' + emp.marca : '') + (emp.telefonos ? '\n' + emp.telefonos : '');
  await enviarCorreo(Object.assign({ to: para, subject: asunto, text: cuerpo }, opciones));
  return { ok: true };
}

// El envío "desde mi Gmail" lo hace el navegador con permiso de Google; aquí solo se recuerda qué cuenta se conectó.
export async function guardarGmailConectado(ctx, correo) {
  const c = limpiarTexto_(correo, 120);
  if (c && !correoValido(c)) fallo('El correo no es válido.');
  await guardarClavesPerfil_(ctx.uid, { gmailCorreo: c });
  ctx.perfilMemo = null;
  return { gmail: c };
}
