// ---------------------------------------------------------------
//  ENVÍO DE CORREOS (antes GmailApp) · Gmail por SMTP con "contraseña de aplicación"
// ---------------------------------------------------------------
import nodemailer from 'nodemailer';
import { db } from './db.js';
import { SMTP } from './config.js';
import { ok, fallo, hoy_ } from './util.js';

let transporte = null;
function smtp() {
  if (!SMTP.user || !SMTP.pass) fallo('El envío de correos no está configurado (faltan SMTP_USER y SMTP_PASS en Vercel).');
  if (!transporte) {
    transporte = nodemailer.createTransport({
      host: SMTP.host, port: SMTP.port, secure: SMTP.port === 465, auth: { user: SMTP.user, pass: SMTP.pass }
    });
  }
  return transporte;
}

export const cuentaCorreo = () => SMTP.user.toLowerCase();
export const aliasesCorreo = () => SMTP.aliases.slice();

// Cuántos correos quedan hoy (reemplaza a MailApp.getRemainingDailyQuota)
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

// o: { to, subject, text, html?, name?, from?, replyTo?, bcc?, attachments? }
export async function enviarCorreo(o) {
  const desde = o.from || SMTP.user;
  await smtp().sendMail({
    from: o.name ? { name: o.name, address: desde } : desde,
    to: o.to, subject: o.subject, text: o.text, html: o.html,
    replyTo: o.replyTo || undefined, bcc: o.bcc || undefined,
    attachments: o.attachments
  });
  await contarEnvio();
}
