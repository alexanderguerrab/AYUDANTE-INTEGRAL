// ===============================================================
//  PLANTILLA DEL PRESUPUESTO (diseño del PDF que configura cada cliente)
//  Se guarda en perfiles.datos.plantilla (JSON en texto), igual que los métodos de pago.
//  Las imágenes (banner, sello, marca de agua) viven en el bucket «imagenes», en la carpeta del usuario.
// ===============================================================
import { db } from './db.js';
import { BUCKET_IMAGENES } from './config.js';
import { fallo, limpiarTexto_ } from './util.js';
import { ESTILOS, plantillaDefecto } from './plantillaBase.js';
import { leerPerfilCrudo_, imagenesPropias_, esIdImagen, enStorage, escribirPerfil_ } from './perfil.js';

export { ESTILOS, plantillaDefecto };

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v, min, max, def) => { const n = Number(v); return isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def; };
const bool = (v, def) => (v === undefined || v === null) ? def : v === true || v === 'true';
const opcion = (v, lista, def) => lista.includes(v) ? v : def;

// Limpia lo que llega del navegador: solo se aceptan los campos conocidos y valores dentro de rango
export function sanearPlantilla_(d, propias) {
  const base = plantillaDefecto();
  if (!d || typeof d !== 'object') return base;
  const imagen = (id, nombre) => {
    id = String(id || '');
    if (!id) return '';
    if (!esIdImagen(id) || !propias.includes(id)) fallo('La imagen de ' + nombre + ' no es válida. Vuelve a subirla.');
    return id;
  };

  const c = d.colores || {};
  const colores = {};
  Object.keys(base.colores).forEach(k => { colores[k] = HEX.test(String(c[k] || '')) ? String(c[k]).toLowerCase() : base.colores[k]; });

  const e = d.encabezado || {}, p = d.pie || {}, s = d.sello || {}, m = d.marcaAgua || {};
  const out = {
    estilo: ESTILOS[d.estilo] ? d.estilo : 'personalizado',
    titulo: limpiarTexto_(d.titulo, 30) || base.titulo,
    colores,
    encabezado: {
      modo: opcion(e.modo, ['logo', 'banner', 'texto'], 'logo'),
      bannerId: imagen(e.bannerId, 'el encabezado'),
      marca: bool(e.marca, true), especialidad: bool(e.especialidad, true), rif: bool(e.rif, true), correo: bool(e.correo, true)
    },
    pie: { direccion: bool(p.direccion, true), telefonos: bool(p.telefonos, true), vigencia: bool(p.vigencia, true), bs: bool(p.bs, true) },
    sello: { activo: bool(s.activo, false), id: imagen(s.id, 'el sello'), posicion: opcion(s.posicion, ['izquierda', 'centro', 'derecha'], 'centro'), tam: num(s.tam, 40, 160, 90) },
    marcaAgua: { activa: bool(m.activa, false), id: imagen(m.id, 'la marca de agua'), opacidad: num(m.opacidad, 3, 40, 12), tam: num(m.tam, 20, 100, 60) },
    notaDefecto: limpiarTexto_(d.notaDefecto, 600, true),
    obsDefecto: limpiarTexto_(d.obsDefecto, 600, true)
  };
  // Sin imagen no hay nada que mostrar
  if (out.encabezado.modo === 'banner' && !out.encabezado.bannerId) out.encabezado.modo = 'logo';
  out.sello.activo = !!out.sello.id;          // no hay interruptor aparte: hay imagen = se usa
  out.marcaAgua.activa = !!out.marcaAgua.id;
  return out;
}

export function leerPlantilla_(crudo) {
  try {
    const t = JSON.parse(crudo.plantilla || 'null');
    if (!t) return plantillaDefecto();
    // se combina con los valores por defecto: si más adelante se agregan opciones, las plantillas viejas siguen funcionando
    const b = plantillaDefecto();
    return Object.assign(b, t, {
      colores: Object.assign(b.colores, t.colores), encabezado: Object.assign(b.encabezado, t.encabezado),
      pie: Object.assign(b.pie, t.pie), sello: Object.assign(b.sello, t.sello), marcaAgua: Object.assign(b.marcaAgua, t.marcaAgua)
    });
  } catch (e) { return plantillaDefecto(); }
}

// Ids de imagen que usa una plantilla (para no borrarlos al limpiar el almacenamiento)
export function imagenesDePlantilla_(t) {
  return [t.encabezado && t.encabezado.bannerId, t.sello && t.sello.id, t.marcaAgua && t.marcaAgua.id].filter(Boolean);
}

export async function obtenerPlantilla(ctx) {
  return { plantilla: leerPlantilla_(await leerPerfilCrudo_(ctx.uid)), estilos: ESTILOS };
}

export async function guardarPlantilla(ctx, d) {
  const crudo = await leerPerfilCrudo_(ctx.uid);
  const propias = imagenesPropias_(crudo);
  const t = sanearPlantilla_(d, propias);

  // Imágenes que ya nadie usa (logo, QR de pagos, ni esta plantilla) se borran del almacenamiento
  const usadas = {};
  if (crudo.logoId) usadas[crudo.logoId] = true;
  try { (JSON.parse(crudo.metodos || '[]') || []).forEach(x => { if (x && x.qrId) usadas[x.qrId] = true; }); } catch (e) { /* sin métodos */ }
  imagenesDePlantilla_(t).forEach(id => { usadas[id] = true; });
  const conservar = propias.filter(id => usadas[id]);
  const sobran = propias.filter(id => !usadas[id] && enStorage(id) && id.startsWith(ctx.uid + '/'));
  if (sobran.length) await db().storage.from(BUCKET_IMAGENES).remove(sobran);

  await escribirPerfil_(ctx.uid, Object.assign({}, crudo, { plantilla: JSON.stringify(t), imagenes: JSON.stringify(conservar) }));
  ctx.perfilMemo = null;
  return { plantilla: t };
}

export async function restablecerPlantilla(ctx) {
  return guardarPlantilla(ctx, plantillaDefecto());
}
