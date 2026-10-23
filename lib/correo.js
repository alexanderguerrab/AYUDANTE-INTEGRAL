// ---------------------------------------------------------------
//  ENVÍO DE CORREOS · Gmail por SMTP con "contraseña de aplicación"
//  · Cada usuario envía desde SU propio Gmail (contraseña cifrada en su perfil).
//  · El correo del sistema (SMTP_USER / SMTP_PASS en Vercel) solo lo usa el administrador principal
//    y los cobros de suscripción de la plataforma.
// ---------------------------------------------------------------
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { db } from './db.js';
import { SMTP, CORREO_CLAVE_CIFRADO, CORREO_CLAVE_CIFRADO_ANTERIOR } from './config.js';
import { ok, fallo, hoy_ } from './util.js';

// ---------- Cifrado de la contraseña de aplicación (AES-256-GCM) ----------
function claveCifrado() {
  const clave = Buffer.from(CORREO_CLAVE_CIFRADO, 'base64');
  if (clave.length !== 32) fallo('El servidor no tiene configurado el cifrado de correos (falta CORREO_CLAVE_CIFRADO en Vercel). Avisa al administrador.');
  return clave;
}

function claveAnterior() {
  if (!CORREO_CLAVE_CIFRADO_ANTERIOR) return null;
  const clave = Buffer.from(CORREO_CLAVE_CIFRADO_ANTERIOR, 'base64');
  return clave.length === 32 ? clave : null;
}

// Formato guardado: iv.etiqueta.datos (cada parte en base64)
export function cifrar(texto) {
  const iv = randomBytes(12);
  const cifrador = createCipheriv('aes-256-gcm', claveCifrado(), iv);
  const datos = Buffer.concat([cifrador.update(String(texto), 'utf8'), cifrador.final()]);
  return [iv, cifrador.getAuthTag(), datos].map(b => b.toString('base64')).join('.');
}

export function descifrar(cifrado) {
  const partes = String(cifrado || '').split('.');
  if (partes.length !== 3) throw new Error('Formato de contraseña guardada no válido.');
  const [iv, tag, datos] = partes.map(p => Buffer.from(p, 'base64'));
  const claves = [claveCifrado(), claveAnterior()].filter(Boolean);
  for (const clave of claves) {
    try {
      const d = createDecipheriv('aes-256-gcm', clave, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(datos), d.final()]).toString('utf8');
    } catch (e) { /* se prueba con la otra clave */ }
  }
  throw new Error('No se pudo descifrar la contraseña guardada.');
}

// ---------- Gmail propio de cada usuario ----------
const TIEMPOS = { connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 };

// Google muestra la contraseña de aplicación en bloques con espacios
export const limpiarPassword = p => String(p || '').replace(/\s+/g, '');

export function transporteGmail(email, password) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: String(email).trim(), pass: limpiarPassword(password) }, ...TIEMPOS
  });
}

const primeraLinea = e => String((e && e.message) || e || '').split('\n')[0].slice(0, 200);
const esErrorDeClave = e => !!e && (e.code === 'EAUTH' || e.responseCode === 535 || /\b535\b|Invalid login|Username and Password not accepted/i.test(String(e.message || '')));
const esErrorDeRed = e => /ETIMEDOUT|ECONNECTION|ESOCKET|ECONNRESET|EDNS/.test(String(e && e.code));

// Comprueba con Google que el correo y la contraseña de aplicación sirven (sin enviar nada)
export async function verificarGmail(email, password) {
  const t = transporteGmail(email, password);
  try {
    await t.verify();
  } catch (e) {
    if (esErrorDeClave(e)) fallo('Gmail no aceptó el correo o la contraseña de aplicación. Revisa que la contraseña sea de esa misma cuenta y que tengas activada la verificación en 2 pasos.');
    if (esErrorDeRed(e)) fallo('No se pudo conectar con Gmail ahora mismo. Intenta de nuevo en un momento.');
    fallo('No se pudo conectar con Gmail: ' + primeraLinea(e));
  } finally {
    t.close();
  }
}

// ---------- Correo del sistema ----------
let transporte = null;
function smtp() {
  if (!SMTP.user || !SMTP.pass) fallo('El envío de correos del sistema no está configurado (faltan SMTP_USER y SMTP_PASS en Vercel).');
  if (!transporte) {
    transporte = nodemailer.createTransport({
      host: SMTP.host, port: SMTP.port, secure: SMTP.port === 465, auth: { user: SMTP.user, pass: SMTP.pass }
    });
  }
  return transporte;
}

export const cuentaCorreo = () => SMTP.user.toLowerCase();
export const aliasesCorreo = () => SMTP.aliases.slice();

// Cuántos correos quedan hoy del correo del sistema (reemplaza a MailApp.getRemainingDailyQuota)
export async function cuotaRestante() {
  const fila = ok(await db().from('app_config').select('valor').eq('clave', 'CORREOS_DIA').maybeSingle());
  const [dia, n] = String((fila && fila.valor) || '').split(':');
  const usados = dia === hoy_() ? (parseInt(n, 10) || 0) : 0;
  return Math.max(0, SMTP.limiteDiario - usados);
}

async function contarEnvio() {
  const fila = ok(await db().from('app_config').select('valor').eq('clave', 'CORREOS_DIA').maybeSingle());
  const [dia, n] = String((fila && fila.valor) || '').split(':');
  const usados = dia === hoy_() ? (parseInt(n, 10) || 0) : 0;
  ok(await db().from('app_config').upsert({ clave: 'CORREOS_DIA', valor: hoy_() + ':' + (usados + 1) }));
}

// o: { to, subject, text, html?, name?, from?, replyTo?, bcc?, attachments?, cuenta? }
//   cuenta = { email, pass } → sale desde el Gmail propio del usuario (no cuenta en el límite del sistema)
export async function enviarCorreo(o) {
  if (o.cuenta) {
    const t = transporteGmail(o.cuenta.email, o.cuenta.pass);
    try {
      await t.sendMail({
        from: o.name ? { name: o.name, address: o.cuenta.email } : o.cuenta.email,
        to: o.to, subject: o.subject, text: o.text, html: o.html,
        replyTo: o.replyTo || undefined, bcc: o.bcc || undefined, attachments: o.attachments
      });
    } catch (e) {
      if (esErrorDeClave(e)) fallo('Gmail rechazó tu contraseña de aplicación (¿la eliminaste en Google?). Vuelve a conectar tu Gmail en Finanzas > Scripts de cobro.');
      if (esErrorDeRed(e)) fallo('Gmail tardó demasiado en responder. Intenta de nuevo.');
      fallo('No se pudo enviar desde tu Gmail: ' + primeraLinea(e));
    } finally {
      t.close();
    }
    return;
  }
  const desde = o.from || SMTP.user;
  await smtp().sendMail({
    from: o.name ? { name: o.name, address: desde } : desde,
    to: o.to, subject: o.subject, text: o.text, html: o.html,
    replyTo: o.replyTo || undefined, bcc: o.bcc || undefined,
    attachments: o.attachments
  });
  await contarEnvio();
}
