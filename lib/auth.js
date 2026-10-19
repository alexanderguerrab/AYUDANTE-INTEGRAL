import { createHash } from 'node:crypto';
import { db } from './db.js';

// Caché en memoria de la instancia (5 min), igual que el CacheService del Apps Script
const cache = new Map();
const TTL_MS = 5 * 60 * 1000;

// Valida el token de sesión de Supabase Auth: uid y correo salen del token, nunca del navegador.
// (auth.getUser consulta al servidor de Supabase, así que un token falso, vencido o de un usuario borrado se rechaza.)
export async function verificarToken(idToken) {
  if (!idToken || typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 4000) throw 'Sesión inválida';
  const key = createHash('sha256').update(idToken).digest('base64url');
  const hit = cache.get(key);
  if (hit && hit.expira > Date.now()) return hit.valor;

  const { data, error } = await db().auth.getUser(idToken);
  if (error) {
    // Caídas de red o del servicio de Supabase NO deben cerrarle la sesión a nadie
    if (error.name === 'AuthRetryableFetchError' || (error.status && error.status >= 500)) throw new Error('Supabase Auth: ' + error.message);
    throw 'Sesión inválida';
  }
  const u = data && data.user;
  if (!u || !u.id) throw 'Sesión inválida';
  if (u.banned_until && new Date(u.banned_until) > new Date()) throw 'Sesión inválida';

  const valor = {
    uid: String(u.id),
    email: String(u.email || ''),
    verified: !!u.email_confirmed_at,                                  // Google y los correos confirmados
    telefono: String((u.user_metadata && u.user_metadata.telefono) || '')   // lo guarda el formulario de registro
  };

  if (cache.size > 500) cache.clear();
  cache.set(key, { valor, expira: Date.now() + TTL_MS });
  return valor;
}
