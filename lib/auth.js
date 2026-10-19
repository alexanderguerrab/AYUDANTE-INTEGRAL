import { createHash } from 'node:crypto';
import { FIREBASE_API_KEY } from './config.js';

// Caché en memoria de la instancia (5 min), igual que el CacheService del Apps Script
const cache = new Map();
const TTL_MS = 5 * 60 * 1000;

// Valida el token de sesión de Firebase: uid y correo salen del token, nunca del navegador.
export async function verificarToken(idToken) {
  if (!idToken || typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 4000) throw 'Sesión inválida';
  const key = createHash('sha256').update(idToken).digest('base64url');
  const hit = cache.get(key);
  if (hit && hit.expira > Date.now()) return hit.valor;

  const resp = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken })
  });
  if (resp.status !== 200) throw 'Sesión inválida';
  const users = (await resp.json()).users;
  if (!users || !users.length || users[0].disabled) throw 'Sesión inválida';
  const u = users[0];
  const valor = { uid: String(u.localId), email: String(u.email || ''), verified: u.emailVerified === true };

  if (cache.size > 500) cache.clear();
  cache.set(key, { valor, expira: Date.now() + TTL_MS });
  return valor;
}
