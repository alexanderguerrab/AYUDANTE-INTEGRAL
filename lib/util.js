import { randomUUID } from 'node:crypto';
import { CONFIG } from './config.js';

// Errores pensados para el usuario: se muestran tal cual. Cualquier otro error se registra y se responde genérico.
export class AppError extends Error {
  constructor(msg) { super(msg); this.name = 'AppError'; }
}
export const fallo = msg => { throw new AppError(msg); };

export function mensajeError(e) {
  if (typeof e === 'string') return e;
  if (e instanceof AppError) return e.message;
  console.error(e && e.stack ? e.stack : e);
  return 'Error interno del servidor. Intenta de nuevo.';
}

// Lanza el error de Supabase (si lo hay) y devuelve los datos
export function ok({ data, error }) {
  if (error) throw new Error('Supabase: ' + error.message);
  return data;
}

// ---------- Texto ----------
export const txt_ = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 300);

export function limpiarTexto_(v, max, multilinea) {
  let s = (v === null || v === undefined) ? '' : String(v);
  s = multilinea ? s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') : s.replace(/[\u0000-\u001F]/g, ' ');
  s = s.trim();
  return s.length > max ? s.substring(0, max) : s;
}

export function textoSeguro(v, max) {
  let s = (v == null) ? '' : String(v);
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (max && s.length > max) s = s.substring(0, max);
  return s;
}

export const correoValido = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));

export function escaparHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- Números ----------
export const redondear_ = n => Math.round(n * 100) / 100;
export const round2 = redondear_;
export const numeroEntero_ = v => parseInt(String(v).replace(/\D/g, ''), 10) || 0;
export const formatearNumero_ = v => ('00000' + (numeroEntero_(v) || 1)).slice(-5);

export function monto_(v) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) fallo('El monto debe ser mayor que cero.');
  return redondear_(n);
}

const fmtNum = n => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtUsd = n => '$' + fmtNum(n);
export const fmtBs = n => 'Bs' + fmtNum(n);

// ---------- IDs ----------
export const nuevoId_ = () => randomUUID().replace(/-/g, '').slice(0, 8);

// ---------- Fechas (en la zona horaria de la app) ----------
function partes(fecha = new Date()) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: CONFIG.TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(fecha).forEach(x => { p[x.type] = x.value; });
  return p;
}
export const hoy_ = () => { const p = partes(); return `${p.year}-${p.month}-${p.day}`; };
export const ahora_ = () => { const p = partes(); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; };
// "18/10/2026 17:04:00" (como mostraba Google Sheets)
export function fechaHoraVisible(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const p = partes(d);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
}
// Marca de tiempo → "yyyy-MM-dd" en la zona horaria de la app
export function isoEnTz(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const p = partes(d);
  return `${p.year}-${p.month}-${p.day}`;
}
export function fechaVisible(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const p = partes(d);
  return `${p.day}/${p.month}/${p.year}`;
}

export function fechaIso_(v, obligatoria, nombre) {
  const s = txt_(v, 10);
  if (!s) { if (obligatoria) fallo('Falta la fecha ' + nombre + '.'); return ''; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fallo('La fecha ' + nombre + ' no es válida.');
  return s;
}

// Fechas "solo día" (aritmética de calendario, sin zona horaria)
export function parseFechaIso(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}
export const isoDesdeFecha = d => d.toISOString().slice(0, 10);
export function aIsoFecha(v) {
  if (typeof v === 'string') { const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; }
  return '';
}
export function diasDesdeIso(iso, hoy) {
  const f = parseFechaIso(iso), r = parseFechaIso(hoy);
  if (!f || !r) return null;
  return Math.round((r.getTime() - f.getTime()) / 86400000);
}
// 30-ago + 1 mes = 30-sep y 31-ago + 1 mes = 30-sep (no desborda al mes siguiente)
export function sumarMesesIso(iso, meses) {
  const f = parseFechaIso(iso) || parseFechaIso(hoy_());
  const dia = f.getUTCDate();
  f.setUTCDate(1); f.setUTCMonth(f.getUTCMonth() + meses);
  const ultimo = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0)).getUTCDate();
  f.setUTCDate(Math.min(dia, ultimo));
  return isoDesdeFecha(f);
}
// La fecha del navegador solo se acepta si está a ±1 día de la del servidor (evita fechas manipuladas)
export function hoyIso(hoyCliente) {
  const servidor = hoy_();
  if (/^\d{4}-\d{2}-\d{2}$/.test(hoyCliente || '')) {
    const dd = diasDesdeIso(hoyCliente, servidor);
    if (dd !== null && Math.abs(dd) <= 1) return hoyCliente;
  }
  return servidor;
}
