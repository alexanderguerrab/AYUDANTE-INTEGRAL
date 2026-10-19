/**
 * ==========================================================
 *  API · AYUDANTE INTEGRAL (Vercel + Supabase)
 *  Reemplaza al Apps Script: index.html hace fetch('/api') con { accion, idToken, ... }
 *  y recibe { ok: true, data } o { ok: false, error }, igual que antes.
 *
 *   · Cada persona entra con su cuenta de Supabase Auth. El servidor VALIDA el token de sesión.
 *   · Los datos de todos los clientes viven en Supabase, separados por su uid.
 * ==========================================================
 */
import { verificarToken } from '../lib/auth.js';
import { ADMIN_UID, EXIGIR_CORREO_VERIFICADO, MAX_BODY_CHARS } from '../lib/config.js';
import { mensajeError, fallo } from '../lib/util.js';
import { entornoUsuario_, isUserAdmin, registrarTelefono, getUsersList, actualizarUsuario, eliminarUser, actualizarNombreUsuario } from '../lib/usuarios.js';
import * as P from '../lib/presupuestos.js';
import * as T from '../lib/tablas.js';
import * as PF from '../lib/perfil.js';
import * as S from '../lib/saas.js';
import * as R from '../lib/respaldo.js';

// Acciones del panel de administración (solo súper admin y administradores autorizados).
const ACCIONES_ADMIN = {
  admUsuarios:          (p, uid) => getUsersList(),
  admActualizarUsuario: (p, uid) => actualizarUsuario(p.datos || {}, uid),
  admEliminarUsuario:   (p, uid) => eliminarUser((p.datos || {}).uid, uid),
  admFinanzas:          (p, uid) => S.getFinanzasData(),
  admControlDatos:      (p, uid) => S.obtenerDatosControlSaaS(p.datos || {}),
  admControlGuardar:    (p, uid) => S.guardarCambioControlSaaS(p.datos || {}),
  admControlCrear:      (p, uid) => S.crearRegistroControlSaaS(p.datos || {}),
  admControlRenovar:    (p, uid) => S.renovarControlSaaS(p.datos || {}),
  admControlEliminar:   (p, uid) => S.eliminarRegistroControlSaaS(p.datos || {}),
  admEnviarCobros:      (p, uid) => S.ejecutarEnvioCobroSaaS(p.datos || {}),
  admReportePagos:      (p, uid) => S.pagosParaReporteAdmin_(),
  admScriptsObtener:    (p, uid) => S.obtenerScripts(),
  admScriptsGuardar:    (p, uid) => S.actualizarScripts(p.datos || {}),
  admRemitenteObtener:  (p, uid) => S.obtenerRemitenteCobro(),
  admRemitenteGuardar:  (p, uid) => S.guardarRemitenteCobro(p.datos || {}),
  admConfigObtener:     (p, uid) => S.configPublica_(),
  admConfigGuardar:     (p, uid) => S.guardarConfigApp(p.datos || {}),
  admRespaldo:          (p, uid) => R.respaldoAdmin()
};

const acciones = {
  arranque:          (p, c) => arranqueCompleto_(c),
  generarPdf:        (p, c) => P.generarPdf(c, p.datos),
  enviarCorreo:      (p, c) => P.enviarPresupuestoPorCorreo(c, p.datos, p.correo),
  guardar:           (p, c) => P.guardarEnHistorial(c, p.datos),
  historial:         (p, c) => P.obtenerHistorial(c),
  detalle:           (p, c) => P.obtenerDetalle(c, p.numero),
  reimprimir:        (p, c) => P.reimprimirPresupuesto(c, p.numero),
  clientes:          (p, c) => P.obtenerClientes(c),
  guardarCliente:    (p, c) => P.guardarClienteBD(c, p.cliente),
  actualizarCliente: (p, c) => P.actualizarCliente(c, p.id, p.valores),

  // --- Respaldo de los datos del propio usuario ---
  respaldo:          (p, c) => R.respaldoUsuario(c, p),

  // --- Perfil y suscripción ---
  perfil:              (p, c) => PF.obtenerPerfil(c),
  guardarPerfil:       (p, c) => PF.guardarPerfil(c, p.perfil),
  subirImagen:         (p, c) => PF.subirImagenPerfil(c, p.imagen),
  imagenBase64:        (p, c) => PF.imagenBase64Perfil(c, p.id),
  miSuscripcion:       (p, c) => S.suscripcionDe_(c.uid),
  scriptsCobro:        (p, c) => PF.obtenerScriptsCobro(c),
  guardarScriptsCobro: (p, c) => PF.guardarScriptsCobro(c, p.scripts),
  marcarRecordatorio:  (p, c) => T.marcarRecordatorioCobro(c, p.id, p.etapa, p.canal),
  enviarRecordatorio:  (p, c) => PF.enviarRecordatorioCorreo(c, p.datos || {}),
  guardarGmail:        (p, c) => PF.guardarGmailConectado(c, p.correo),

  // --- Finanzas ---
  finanzasDatos:     (p, c) => T.finanzasDatos(c),
  guardarIngreso:    (p, c) => T.guardarIngreso(c, p.registro),
  guardarGasto:      (p, c) => T.guardarGasto(c, p.registro),
  guardarPorCobrar:  (p, c) => T.guardarPorCobrar(c, p.registro),
  cobrarPorCobrar:   (p, c) => T.cobrarPorCobrar(c, p.id, p.metodo),
  // --- Proveedores ---
  proveedoresDatos:    (p, c) => T.proveedoresDatos(c),
  guardarProveedor:    (p, c) => T.guardarProveedor(c, p.registro),
  actualizarProveedor: (p, c) => T.actualizarProveedor(c, p.id, p.valores),
  eliminarProveedor:   (p, c) => T.eliminarProveedor(c, p.id),

  guardarPorPagar:   (p, c) => T.guardarPorPagar(c, p.registro),
  pagarPorPagar:     (p, c) => T.pagarPorPagar(c, p.id, p.metodo),
  eliminarFinanza:   (p, c) => T.eliminarFinanza(c, p.tipo, p.id),

  // --- Herramientas ---
  herramientasDatos:     (p, c) => T.herramientasDatos(c),
  guardarHerramienta:    (p, c) => T.guardarHerramienta(c, p.registro),
  actualizarHerramienta: (p, c) => T.actualizarHerramienta(c, p.id, p.valores),
  eliminarHerramienta:   (p, c) => T.eliminarHerramienta(c, p.id),
  prestarHerramienta:    (p, c) => T.prestarHerramienta(c, p.registro),
  devolverHerramienta:   (p, c) => T.devolverHerramienta(c, p.id),

  // --- Agenda ---
  agendaDatos:       (p, c) => T.agendaDatos(c),
  guardarCita:       (p, c) => T.guardarCita(c, p.registro),
  reprogramarCita:   (p, c) => T.reprogramarCita(c, p.id, p.fecha, p.hora, p.forzar),
  cambiarEstadoCita: (p, c) => T.cambiarEstadoCita(c, p.id, p.estado),
  eliminarCita:      (p, c) => T.eliminarCita(c, p.id)
};

async function arranqueCompleto_(c) {
  const [base, perfil, suscripcion, scripts, config] = await Promise.all([
    P.obtenerDatosDeArranque(c), PF.obtenerPerfil(c), S.suscripcionDe_(c.uid), PF.obtenerScriptsCobro(c), S.configPublica_()
  ]);
  Object.assign(base, {
    perfil, suscripcion, scripts, config,
    isAdmin: c.env.esSuper || c.env.rol === 'Administrador', isSuperAdmin: c.env.esSuper, email: c.email
  });
  // Si el nombre o la especialidad del perfil cambiaron, se actualiza la lista de usuarios del panel
  const nombre = String(perfil.nombre || perfil.marca || '').trim().slice(0, 80);
  const espec = String(perfil.especialidad || '').trim().slice(0, 100);
  if ((nombre || espec) && (nombre !== c.env.nombreDb || espec !== c.env.especDb)) await actualizarNombreUsuario(c.uid, nombre, espec);
  return base;
}

async function procesar(p) {
  const accion = String(p.accion || '');

  // 1) Identidad verificada con Supabase Auth (uid y correo salen del token, no del navegador)
  const auth = await verificarToken(p.idToken);
  const uid = auth.uid;
  if (EXIGIR_CORREO_VERIFICADO && !auth.verified && uid !== ADMIN_UID) {
    fallo('Verifica tu correo electrónico para continuar. Te enviamos un enlace de verificación.');
  }

  // 2) Panel de administración
  if (ACCIONES_ADMIN[accion]) {
    if (!await isUserAdmin(uid)) fallo('No autorizado.');
    return ACCIONES_ADMIN[accion](p, uid);
  }

  // 3) Teléfono del registro (permitido aunque la cuenta siga pendiente)
  if (accion === 'registrarTelefono') {
    return registrarTelefono({ telefono: p.telefono, email: auth.email, emailVerificado: auth.verified }, uid);
  }

  // 4) Estado de la cuenta: solo las AUTORIZADAS pueden usar la app
  const env = await entornoUsuario_(uid, auth);
  if (!env.autorizado) {
    if (accion === 'arranque') return env.estado === 'Bloqueado' ? { isBloqueado: true } : { isPendiente: true };
    fallo('Tu cuenta no está autorizada para usar esta función.');
  }

  // 5) Contexto de la petición
  const ctx = { uid, email: auth.email, esSuper: uid === ADMIN_UID, env, perfilMemo: null };
  const fn = acciones[accion];
  if (!fn) fallo('Acción desconocida: ' + accion);
  return fn(p, ctx);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    try {
      const q = req.query || {};
      if (q.accion === 'config') return res.status(200).json({ ok: true, data: await S.configPublica_() });
      // Imágenes del perfil (logos y QR): redirige al archivo público en Supabase Storage
      if (q.accion === 'img' && /^[\w-]{10,100}\/[\w.-]{1,150}$/.test(String(q.id || ''))) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.redirect(302, PF.urlImagen(String(q.id)));
      }
      return res.status(200).json({ ok: true, mensaje: 'API de presupuestos activa' });
    } catch (err) {
      return res.status(200).json({ ok: false, error: mensajeError(err) });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido.' });

  try {
    let cuerpo = req.body;
    if (cuerpo == null || cuerpo === '') fallo('Solicitud vacía.');
    if (typeof cuerpo === 'string') {
      if (cuerpo.length > MAX_BODY_CHARS) fallo('La solicitud es demasiado grande.');
      try { cuerpo = JSON.parse(cuerpo); } catch (e) { fallo('Solicitud inválida.'); }
    } else if (Buffer.isBuffer(cuerpo)) {
      if (cuerpo.length > MAX_BODY_CHARS) fallo('La solicitud es demasiado grande.');
      try { cuerpo = JSON.parse(cuerpo.toString('utf8')); } catch (e) { fallo('Solicitud inválida.'); }
    } else if (JSON.stringify(cuerpo).length > MAX_BODY_CHARS) {
      fallo('La solicitud es demasiado grande.');
    }
    const data = await procesar(cuerpo || {});
    return res.status(200).json({ ok: true, data });
  } catch (err) {
    return res.status(200).json({ ok: false, error: mensajeError(err) });
  }
}
