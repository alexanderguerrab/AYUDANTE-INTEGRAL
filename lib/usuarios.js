// ===============================================================
//  USUARIOS (antes hoja DB_Perfiles) · estado de la cuenta · panel de administración
// ===============================================================
import { db } from './db.js';
import { ADMIN_UID } from './config.js';
import { ok, fallo, textoSeguro, isoEnTz } from './util.js';
import { recalcularSuscripcionSaaS } from './saas.js';
import { borrarImagenesDeUsuario } from './perfil.js';

// Compatibilidad: el valor antiguo "Admin" en el estatus se lee como Rol=Administrador + Estatus=Autorizado.
export function leerRolEstado(u) {
  let estado = u.estado || 'Autorizado';
  let rol = u.rol || 'Cliente';
  if (estado === 'Admin') { estado = 'Autorizado'; rol = 'Administrador'; }
  return { rol, estado };
}

async function leerUsuario(uid) {
  return ok(await db().from('usuarios').select('*').eq('uid', uid).maybeSingle());
}

// Crea la fila del usuario si no existe y completa el correo si falta.
export async function asegurarUsuario(uid, email, verificado) {
  const correo = textoSeguro(email, 120);
  let u = await leerUsuario(uid);
  if (u) {
    if (correo && !u.correo) {
      u = ok(await db().from('usuarios').update({ correo }).eq('uid', uid).select().single());
    }
    return u;
  }
  const esSuper = uid === ADMIN_UID;
  // ignoreDuplicates: si dos peticiones llegan a la vez, solo una crea la fila
  ok(await db().from('usuarios').upsert({
    uid, correo, estado: esSuper ? 'Autorizado' : 'Pendiente', rol: esSuper ? 'Administrador' : 'Cliente', fecha_registro: new Date().toISOString()
  }, { onConflict: 'uid', ignoreDuplicates: true }));
  if (correo && verificado === true) await vincularPagosHuerfanos(correo, uid);
  return leerUsuario(uid);
}

// Pagos registrados con el correo antes de que la persona se registrara: se enlazan a su uid.
async function vincularPagosHuerfanos(correo, uid) {
  try {
    const c = correo.toLowerCase();
    const pagos = ok(await db().from('pagos').select('id, correo').eq('uid', '')).filter(p => String(p.correo || '').trim().toLowerCase() === c);
    if (!pagos.length) return;
    ok(await db().from('pagos').update({ uid }).in('id', pagos.map(p => p.id)));
    await recalcularSuscripcionSaaS(correo, {});
  } catch (err) { console.error(err); }
}

export async function entornoUsuario_(uid, auth) {
  const u = await asegurarUsuario(uid, auth.email, auth.verified);
  const esSuper = uid === ADMIN_UID;
  const re = leerRolEstado(u);
  const estado = esSuper ? 'Autorizado' : re.estado;
  return {
    estado, rol: esSuper ? 'Administrador' : re.rol, esSuper, autorizado: estado === 'Autorizado',
    nombreDb: u.nombre || '', especDb: u.especialidad || ''
  };
}

export async function isUserAdmin(uid) {
  if (uid === ADMIN_UID) return true;
  const u = await leerUsuario(uid);
  if (!u) return false;
  const re = leerRolEstado(u);
  return re.rol === 'Administrador' && re.estado === 'Autorizado';
}

function limpiarTelefono(t) {
  const s = String(t == null ? '' : t).trim();
  if (!s) return '';
  if (!/^\+?[\d\s\-()]{7,25}$/.test(s)) fallo('Teléfono inválido. Usa solo números, espacios y el signo + (ej: +584121234567).');
  return s;
}

export async function registrarTelefono(payload, uid) {
  await asegurarUsuario(uid, payload.email, payload.emailVerificado);
  const tel = limpiarTelefono(payload.telefono);
  if (tel) ok(await db().from('usuarios').update({ telefono: tel }).eq('uid', uid));   // vacío (login con Google) no borra el guardado
  return 'Teléfono guardado';
}

// Nombre visible en el panel de administración
export async function actualizarNombreUsuario(uid, nombre, especialidad) {
  ok(await db().from('usuarios').update({ nombre: textoSeguro(nombre, 80), especialidad: textoSeguro(especialidad, 100) }).eq('uid', uid));
}

// ---------- Panel de administración ----------
export async function getUsersList() {
  const filas = ok(await db().from('usuarios').select('*').order('orden'));
  return filas.map(u => {
    const re = leerRolEstado(u);
    return { uid: u.uid, nombre: u.nombre, email: u.correo, telefono: u.telefono, fechaRegistro: isoEnTz(u.fecha_registro), rol: re.rol, estado: re.estado, protegido: u.uid === ADMIN_UID };
  });
}

export async function actualizarUsuario(p, quien) {
  const uid = String(p.uid || '');
  if (!uid) fallo('Falta el usuario.');
  if (!await leerUsuario(uid)) fallo('Usuario no encontrado.');
  const cambios = { telefono: limpiarTelefono(p.telefono) };
  // Ni el súper admin ni tu propia cuenta pueden cambiar de rol o estatus.
  if (uid !== ADMIN_UID && uid !== quien) {
    cambios.rol = p.rol === 'Administrador' ? 'Administrador' : 'Cliente';
    cambios.estado = ['Pendiente', 'Autorizado', 'Bloqueado'].includes(p.estado) ? p.estado : 'Pendiente';
  }
  ok(await db().from('usuarios').update(cambios).eq('uid', uid));
  return 'Usuario actualizado';
}

// Borra al usuario y TODOS sus datos (antes se mandaba su hoja a la papelera). El historial de pagos se conserva.
export async function eliminarUser(uid, quien) {
  uid = String(uid || '');
  if (!uid) fallo('Falta el usuario.');
  if (uid === quien || uid === ADMIN_UID) fallo('No puedes eliminar tu propia cuenta de administrador.');
  if (!await leerUsuario(uid)) fallo('Usuario no encontrado.');
  await borrarImagenesDeUsuario(uid);
  ok(await db().from('usuarios').delete().eq('uid', uid));   // en cascada: perfil, presupuestos, clientes, finanzas...
  ok(await db().from('suscripcion_estado').delete().eq('uid', uid));
  return 'Usuario eliminado correctamente';
}
