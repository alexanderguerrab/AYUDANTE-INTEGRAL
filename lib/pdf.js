// ---------------------------------------------------------------
//  PDF DEL PRESUPUESTO (antes: se escribía la hoja PRESUPUESTOS y se exportaba desde Google)
//  Mismo diseño, tamaño carta:
//   · Membrete con logo, nombre, especialidad, RIF y correo del perfil
//   · "PRESUPUESTO 0000X" + tabla DESCRIPCION | CANTIDAD | PRECIO UNITARIO | SUBTOTAL
//   · NOTA y OBSERVACIÓN opcionales después del último artículo
//   · Recuadro DATOS DEL CLIENTE / RESUMEN + dirección y teléfonos,
//     siempre completo al pie de la ÚLTIMA página. Si la tabla no cabe, sigue en otra página
//     repitiendo el encabezado.
//  El aspecto (colores, encabezado, sello, marca de agua, qué se muestra) lo define la plantilla de cada cliente
//  (lib/plantilla.js). Sin plantilla se usa la de por defecto.
// ---------------------------------------------------------------
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { fmtUsd, fmtBs } from './util.js';
import { plantillaDefecto } from './plantillaBase.js';

const PW = 612, PH = 792;            // carta, en puntos
const M = 28.8;                      // margen de 0.4"
const W = PW - 2 * M;
const COLS = [0.5, 0.13, 0.185, 0.185].map(f => f * W);
const X = [M, M + COLS[0], M + COLS[0] + COLS[1], M + COLS[0] + COLS[1] + COLS[2], M + W];

const NEGRO = rgb(0, 0, 0), BLANCO = rgb(1, 1, 1);

// "#rrggbb" → color del PDF, y texto negro o blanco según qué tan oscuro sea el fondo
const aRgb = h => { const n = parseInt(String(h).slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const luz = h => {   // luminancia relativa (WCAG): sirve para elegir texto negro o blanco con buen contraste
  const n = parseInt(String(h).slice(1), 16);
  const l = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * l((n >> 16) & 255) + 0.7152 * l((n >> 8) & 255) + 0.0722 * l(n & 255);
};
const esBlanco = h => String(h).toLowerCase() === '#ffffff';

const T = 9, LH = 11;                // letra de la tabla y alto de línea
const H_ENC = 18, H_MIN = 17;        // alto del encabezado y fila mínima
const H_RES = 16, H_DIR = 18;        // filas del recuadro y de dirección/teléfonos
const SEPARACION = 2 * H_RES;        // aire mínimo entre la tabla y el recuadro

// Helvetica estándar solo codifica WinAnsi: lo demás se reemplaza para que el PDF nunca falle
const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
function seguro(s) {
  return String(s == null ? '' : s).replace(/\t/g, ' ').split('').map(ch => {
    const c = ch.charCodeAt(0);
    if ((c >= 0x20 && c <= 0x7E) || (c >= 0xA0 && c <= 0xFF) || ch === '\n' || WINANSI_EXTRA.includes(ch)) return ch;
    return c === 0x2011 || c === 0x2012 ? '-' : '';   // emojis y símbolos sin equivalente se omiten
  }).join('');
}

// Corta el texto en líneas que caben en `ancho`
function lineas(texto, font, size, ancho) {
  const out = [];
  seguro(texto).split(/\r?\n/).forEach(parrafo => {
    let actual = '';
    parrafo.split(' ').forEach(palabra => {
      const prueba = actual ? actual + ' ' + palabra : palabra;
      if (font.widthOfTextAtSize(prueba, size) <= ancho) { actual = prueba; return; }
      if (actual) out.push(actual);
      // palabra más larga que la línea: se parte por letras
      let resto = palabra;
      while (font.widthOfTextAtSize(resto, size) > ancho && resto.length > 1) {
        let n = resto.length - 1;
        while (n > 1 && font.widthOfTextAtSize(resto.slice(0, n), size) > ancho) n--;
        out.push(resto.slice(0, n));
        resto = resto.slice(n);
      }
      actual = resto;
    });
    out.push(actual);
  });
  return out.length ? out : [''];
}

const cantidadTexto = n => Number(n).toLocaleString('es-VE', { maximumFractionDigits: 6 });

// imgs = { banner, sello, marca }: cada una { mime, bytes } o null. Todo lo de la plantilla es opcional.
export async function crearPdfPresupuesto(d, t, emp, logo, plantilla, imgs) {
  const pl = plantilla || plantillaDefecto();
  const C = pl.colores, ENC = pl.encabezado, PIE = pl.pie;
  imgs = imgs || {};
  const BORDE = aRgb(C.bordes);
  const texto_sobre = h => luz(h) > 0.179 ? NEGRO : BLANCO;
  const relleno = h => esBlanco(h) ? undefined : aRgb(h);   // el blanco no se pinta: así se ve la marca de agua
  const pdf = await PDFDocument.create();
  pdf.setTitle('Presupuesto ' + d.numero);
  pdf.setProducer('Ayudante Integral');
  const F = await pdf.embedFont(StandardFonts.Helvetica);
  const FB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const FI = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const incrustar = async im => {
    if (!im || !im.bytes) return null;
    try {
      if (im.mime === 'image/png') return await pdf.embedPng(im.bytes);
      if (im.mime === 'image/jpeg' || im.mime === 'image/jpg') return await pdf.embedJpg(im.bytes);
    } catch (e) { /* una imagen dañada nunca debe impedir el PDF */ }
    return null;
  };
  const img = ENC.modo === 'logo' ? await incrustar(logo) : null;
  const imgBanner = ENC.modo === 'banner' ? await incrustar(imgs.banner) : null;
  const imgSello = pl.sello.activo ? await incrustar(imgs.sello) : null;
  const imgMarca = pl.marcaAgua.activa ? await incrustar(imgs.marca) : null;

  let page, y;   // y = distancia desde el borde superior
  const Y = v => PH - v;

  const rect = (x, top, w, h, o = {}) => page.drawRectangle({
    x, y: Y(top + h), width: w, height: h, color: o.fondo, borderColor: o.borde === false ? undefined : BORDE,
    borderWidth: o.borde === false ? 0 : (o.grosor || 0.6)
  });
  const texto = (s, x, top, o = {}) => {
    const font = o.font || F, size = o.size || T;
    const str = seguro(s);
    const w = font.widthOfTextAtSize(str, size);
    let px = x + (o.pad == null ? 4 : o.pad);
    if (o.alinear === 'centro') px = x + (o.ancho - w) / 2;
    else if (o.alinear === 'derecha') px = x + o.ancho - w - (o.pad == null ? 4 : o.pad);
    page.drawText(str, { x: px, y: Y(top) - size * 0.8, size, font, color: o.color || NEGRO });
  };

  function encabezadoTabla() {
    ['DESCRIPCION', 'CANTIDAD', 'PRECIO UNITARIO', 'SUBTOTAL'].forEach((s, i) => {
      rect(X[i], y, COLS[i], H_ENC, { fondo: relleno(C.encabezadoTabla) });
      texto(s, X[i], y + (H_ENC - T) / 2, { font: FB, alinear: 'centro', ancho: COLS[i], color: texto_sobre(C.encabezadoTabla) });
    });
    y += H_ENC;
  }

  function nuevaPagina(conEncabezado) {
    page = pdf.addPage([PW, PH]);
    if (imgMarca) {   // marca de agua: se dibuja primero, detrás de todo
      const esc = Math.min(PW * pl.marcaAgua.tam / 100 / imgMarca.width, PH * 0.8 / imgMarca.height);
      const w = imgMarca.width * esc, h = imgMarca.height * esc;
      page.drawImage(imgMarca, { x: (PW - w) / 2, y: (PH - h) / 2, width: w, height: h, opacity: pl.marcaAgua.opacidad / 100 });
    }
    y = M;
    if (conEncabezado) encabezadoTabla();
  }

  // ---------- Membrete (primera página) ----------
  nuevaPagina(false);
  let H_MEMB = 92;
  if (imgBanner) {
    // banner: una imagen a todo el ancho con el diseño propio del cliente
    const esc = Math.min((W - 8) / imgBanner.width, 112 / imgBanner.height);
    const w = imgBanner.width * esc, h = imgBanner.height * esc;
    H_MEMB = Math.max(50, h + 8);
    page.drawImage(imgBanner, { x: M + (W - w) / 2, y: Y(y + (H_MEMB + h) / 2), width: w, height: h });
  } else {
    const anchoLogo = img ? COLS[0] * 0.55 : 0;
    if (img) {
      const esc = Math.min((anchoLogo - 8) / img.width, (H_MEMB - 8) / img.height);
      const w = img.width * esc, h = img.height * esc;
      page.drawImage(img, { x: M + (anchoLogo - w) / 2, y: Y(y + (H_MEMB + h) / 2), width: w, height: h });
    }
    const xt = M + anchoLogo, wt = W - anchoLogo;
    const membrete = [
      [ENC.marca ? emp.marca : '', (img && emp.marca.length > 22) ? 13 : 16, FB],
      [ENC.especialidad ? emp.especialidad : '', 10, FI],
      [ENC.rif && emp.rif ? 'RIF / ID: ' + emp.rif : '', 10, F],
      [ENC.correo ? emp.correo : '', 10, F]
    ].filter(l => l[0]);
    const alto = membrete.reduce((h, [s, size, font]) => h + lineas(s, font, size, wt - 8).slice(0, 2).length * (size + 5), 0);
    let ym = y + Math.max(8, (H_MEMB - alto) / 2);   // el texto queda centrado en el membrete
    membrete.forEach(([s, size, font]) => {
      lineas(s, font, size, wt - 8).slice(0, 2).forEach(l => {
        texto(l, xt, ym, { font, size, alinear: 'centro', ancho: wt });
        ym += size + 5;
      });
    });
  }
  y += H_MEMB;
  page.drawLine({ start: { x: M, y: Y(y) }, end: { x: M + W, y: Y(y) }, thickness: 1.5, color: BORDE });

  // ---------- Título ----------
  y += 10;
  texto(pl.titulo + ' ' + d.numero, M, y + 4, { font: FB, size: 14, alinear: 'centro', ancho: W });
  y += 30;
  encabezadoTabla();

  const finPagina = () => PH - M;

  // ---------- Artículos ----------
  d.items.forEach(it => {
    const ls = lineas(it.desc, F, T, COLS[0] - 8);
    const h = Math.max(H_MIN, ls.length * LH + 6);
    if (y + h > finPagina()) nuevaPagina(true);
    for (let i = 0; i < 4; i++) rect(X[i], y, COLS[i], h);
    const ty = y + (h - ls.length * LH) / 2 + 1;
    ls.forEach((l, k) => texto(l, X[0], ty + k * LH));
    const yc = y + (h - T) / 2;
    texto(cantidadTexto(it.cant), X[1], yc, { alinear: 'centro', ancho: COLS[1] });
    texto(fmtUsd(it.precio), X[2], yc, { alinear: 'centro', ancho: COLS[2] });
    texto(fmtUsd(it.cant * it.precio), X[3], yc, { alinear: 'centro', ancho: COLS[3] });
    y += h;
  });

  // ---------- Nota y observación (cada una completa en la misma página) ----------
  [['NOTA', d.nota], ['OBSERVACIÓN', d.observacion]].filter(b => b[1]).forEach(([titulo, cuerpo]) => {
    const ls = lineas(cuerpo, F, T, W - 8);
    const hTexto = Math.max(2 * H_MIN, ls.length * LH + 8);
    if (y + H_MIN + H_MIN + hTexto > finPagina()) nuevaPagina(false);
    else y += H_MIN;
    rect(M, y, W, H_MIN);
    texto(titulo, M, y + (H_MIN - T) / 2, { font: FB, alinear: 'centro', ancho: W });
    y += H_MIN;
    rect(M, y, W, hTexto);
    ls.forEach((l, k) => texto(l, M, y + 5 + k * LH));
    y += hTexto;
  });

  // ---------- Recuadro de totales + dirección (al pie, nunca partido) ----------
  const filasIzq = [
    'CLIENTE:  ' + (d.cliente || '—'),
    d.tipoContacto === 'rif' ? 'RIF:  ' + (d.rif || '—') : 'TELÉFONO:  ' + (d.telefono || '—'),
    'Nº PRESUPUESTO:  ' + d.numero,
    'FECHA:  ' + (d.fecha || '—')
  ];
  if (PIE.vigencia) filasIzq.push('VIGENCIA:  ' + d.vigencia + ' Días');
  const filasDer = [
    ['SUB TOTAL', fmtUsd(t.sub)],
    ['IVA (' + d.iva + '%)', fmtUsd(t.iva)],
    ['TOTAL PRESUPUESTO', fmtUsd(t.total), true]
  ];
  if (PIE.bs) filasDer.push(['TASA BCV', fmtBs(d.tasa)], ['TOTAL EN BS', fmtBs(t.totalBs), true]);
  const nFilas = Math.max(filasIzq.length, filasDer.length);
  const dirs = [PIE.direccion ? emp.direccion : '', PIE.telefonos ? emp.telefonos : ''].filter(Boolean);
  const H_PIE = (1 + nFilas) * H_RES + dirs.length * H_DIR;
  if (y > PH - M - H_PIE - SEPARACION) nuevaPagina(false);
  let yp = PH - M - H_PIE;
  const yPieTop = yp;

  const wDer = COLS[1] + COLS[2];
  const fTit = relleno(C.tituloPie), cTit = texto_sobre(C.tituloPie);
  rect(X[0], yp, COLS[0], H_RES, { fondo: fTit });
  rect(X[1], yp, wDer + COLS[3], H_RES, { fondo: fTit });
  texto('DATOS DEL CLIENTE', X[0], yp + (H_RES - T) / 2, { font: FB, alinear: 'centro', ancho: COLS[0], color: cTit });
  texto('RESUMEN', X[1], yp + (H_RES - T) / 2, { font: FB, alinear: 'centro', ancho: wDer + COLS[3], color: cTit });
  yp += H_RES;
  for (let i = 0; i < nFilas; i++) {
    const ty = yp + (H_RES - T) / 2;
    if (i < filasIzq.length) {
      rect(X[0], yp, COLS[0], H_RES, { fondo: relleno(C.filas) });
      texto(lineas(filasIzq[i], FB, T, COLS[0] - 8)[0], X[0], ty, { font: FB, color: texto_sobre(C.filas) });
    } else rect(X[0], yp, COLS[0], H_RES, {});
    if (i < filasDer.length) {
      const fc = filasDer[i][2] ? C.total : C.filas, cc = texto_sobre(fc);
      rect(X[1], yp, wDer, H_RES, { fondo: relleno(fc) });
      rect(X[3], yp, COLS[3], H_RES, { fondo: relleno(fc) });
      texto(filasDer[i][0], X[1], ty, { font: FB, alinear: 'derecha', ancho: wDer, color: cc });
      texto(filasDer[i][1], X[3], ty, { font: FB, alinear: 'centro', ancho: COLS[3], color: cc });
    } else rect(X[1], yp, wDer + COLS[3], H_RES, {});
    yp += H_RES;
  }
  if (dirs.length) {
    rect(M, yp, W, dirs.length * H_DIR, { grosor: 1.5 });
    dirs.forEach((s, i) => {
      let size = 11;
      while (size > 7 && FB.widthOfTextAtSize(seguro(s), size) > W - 8) size -= 0.5;
      texto(s, M, yp + i * H_DIR + (H_DIR - size) / 2, { font: FB, size, color: aRgb(C.direccion), alinear: 'centro', ancho: W });
    });
  }

  // Sello: encima del recuadro, en la última página
  if (imgSello) {
    const esc = pl.sello.tam / Math.max(imgSello.width, imgSello.height);
    const w = imgSello.width * esc, h = imgSello.height * esc;
    const cx = pl.sello.posicion === 'izquierda' ? M + w / 2 + 6 : pl.sello.posicion === 'derecha' ? M + W - w / 2 - 6 : X[1];
    const cy = yPieTop + (H_PIE - dirs.length * H_DIR) / 2;
    page.drawImage(imgSello, { x: cx - w / 2, y: Y(cy + h / 2), width: w, height: h, opacity: 0.92 });
  }

  return Buffer.from(await pdf.save());
}
