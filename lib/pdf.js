// ---------------------------------------------------------------
//  PDF DEL PRESUPUESTO (antes: se escribía la hoja PRESUPUESTOS y se exportaba desde Google)
//  Mismo diseño, tamaño carta:
//   · Membrete con logo, nombre, especialidad, RIF y correo del perfil
//   · "PRESUPUESTO 0000X" + tabla DESCRIPCION | CANTIDAD | PRECIO UNITARIO | SUBTOTAL
//   · NOTA y OBSERVACIÓN opcionales después del último artículo
//   · Recuadro DATOS DEL CLIENTE / RESUMEN (amarillo y verde) + dirección y teléfonos en azul,
//     siempre completo al pie de la ÚLTIMA página. Si la tabla no cabe, sigue en otra página
//     repitiendo el encabezado.
// ---------------------------------------------------------------
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { fmtUsd, fmtBs } from './util.js';

const PW = 612, PH = 792;            // carta, en puntos
const M = 28.8;                      // margen de 0.4"
const W = PW - 2 * M;
const COLS = [0.5, 0.13, 0.185, 0.185].map(f => f * W);
const X = [M, M + COLS[0], M + COLS[0] + COLS[1], M + COLS[0] + COLS[1] + COLS[2], M + W];

const NEGRO = rgb(0, 0, 0), BLANCO = rgb(1, 1, 1);
const VERDE = rgb(0, 1, 0), AMARILLO = rgb(1, 1, 0), AZUL = rgb(0, 0, 1);

const T = 9, LH = 11;                // letra de la tabla y alto de línea
const H_ENC = 18, H_MIN = 17;        // alto del encabezado y fila mínima
const H_RES = 16, H_DIR = 18;        // filas del recuadro y de dirección/teléfonos
const H_PIE = 6 * H_RES + 2 * H_DIR; // recuadro completo
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

export async function crearPdfPresupuesto(d, t, emp, logo) {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Presupuesto ' + d.numero);
  pdf.setProducer('Ayudante Integral');
  const F = await pdf.embedFont(StandardFonts.Helvetica);
  const FB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const FI = await pdf.embedFont(StandardFonts.HelveticaOblique);

  let img = null;
  if (logo && logo.bytes) {
    try {
      if (logo.mime === 'image/png') img = await pdf.embedPng(logo.bytes);
      else if (logo.mime === 'image/jpeg' || logo.mime === 'image/jpg') img = await pdf.embedJpg(logo.bytes);
    } catch (e) { img = null; }   // un logo dañado nunca debe impedir el PDF
  }

  let page, y;   // y = distancia desde el borde superior
  const Y = v => PH - v;

  const rect = (x, top, w, h, o = {}) => page.drawRectangle({
    x, y: Y(top + h), width: w, height: h, color: o.fondo, borderColor: o.borde === false ? undefined : NEGRO,
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
      rect(X[i], y, COLS[i], H_ENC);
      texto(s, X[i], y + (H_ENC - T) / 2, { font: FB, alinear: 'centro', ancho: COLS[i] });
    });
    y += H_ENC;
  }

  function nuevaPagina(conEncabezado) {
    page = pdf.addPage([PW, PH]);
    y = M;
    if (conEncabezado) encabezadoTabla();
  }

  // ---------- Membrete (primera página) ----------
  nuevaPagina(false);
  const H_MEMB = 92;
  const anchoLogo = img ? COLS[0] * 0.55 : 0;
  if (img) {
    const esc = Math.min((anchoLogo - 8) / img.width, (H_MEMB - 8) / img.height);
    const w = img.width * esc, h = img.height * esc;
    page.drawImage(img, { x: M + (anchoLogo - w) / 2, y: Y(y + (H_MEMB + h) / 2), width: w, height: h });
  }
  const xt = M + anchoLogo, wt = W - anchoLogo;
  const membrete = [
    [emp.marca, (img && emp.marca.length > 22) ? 13 : 16, FB],
    [emp.especialidad, 10, FI],
    [emp.rif ? 'RIF / ID: ' + emp.rif : '', 10, F],
    [emp.correo, 10, F]
  ].filter(l => l[0]);
  let ym = y + 8;
  membrete.forEach(([s, size, font]) => {
    lineas(s, font, size, wt - 8).slice(0, 2).forEach(l => {
      texto(l, xt, ym, { font, size, alinear: 'centro', ancho: wt });
      ym += size + 5;
    });
  });
  y += H_MEMB;
  page.drawLine({ start: { x: M, y: Y(y) }, end: { x: M + W, y: Y(y) }, thickness: 1.5, color: NEGRO });

  // ---------- Título ----------
  y += 10;
  texto('PRESUPUESTO ' + d.numero, M, y + 4, { font: FB, size: 14, alinear: 'centro', ancho: W });
  y += 30;
  encabezadoTabla();

  const finPagina = () => PH - M;
  const limiteConPie = () => PH - M - H_PIE - SEPARACION;

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
  if (y > limiteConPie()) nuevaPagina(false);
  let yp = PH - M - H_PIE;
  const filasIzq = [
    'CLIENTE:  ' + (d.cliente || '—'),
    d.tipoContacto === 'rif' ? 'RIF:  ' + (d.rif || '—') : 'TELÉFONO:  ' + (d.telefono || '—'),
    'Nº PRESUPUESTO:  ' + d.numero,
    'FECHA:  ' + (d.fecha || '—'),
    'VIGENCIA:  ' + d.vigencia + ' Días'
  ];
  const filasDer = [
    ['SUB TOTAL', fmtUsd(t.sub)],
    ['IVA (' + d.iva + '%)', fmtUsd(t.iva)],
    ['TOTAL PRESUPUESTO', fmtUsd(t.total), true],
    ['TASA BCV', fmtBs(d.tasa)],
    ['TOTAL EN BS', fmtBs(t.totalBs), true]
  ];
  const wDer = COLS[1] + COLS[2];
  rect(X[0], yp, COLS[0], H_RES, { fondo: VERDE });
  rect(X[1], yp, wDer + COLS[3], H_RES, { fondo: VERDE });
  texto('DATOS DEL CLIENTE', X[0], yp + (H_RES - T) / 2, { font: FB, alinear: 'centro', ancho: COLS[0] });
  texto('RESUMEN', X[1], yp + (H_RES - T) / 2, { font: FB, alinear: 'centro', ancho: wDer + COLS[3] });
  yp += H_RES;
  for (let i = 0; i < 5; i++) {
    const fondo = filasDer[i][2] ? VERDE : AMARILLO;
    rect(X[0], yp, COLS[0], H_RES, { fondo: AMARILLO });
    rect(X[1], yp, wDer, H_RES, { fondo });
    rect(X[3], yp, COLS[3], H_RES, { fondo });
    const ty = yp + (H_RES - T) / 2;
    texto(lineas(filasIzq[i], FB, T, COLS[0] - 8)[0], X[0], ty, { font: FB });
    texto(filasDer[i][0], X[1], ty, { font: FB, alinear: 'derecha', ancho: wDer });
    texto(filasDer[i][1], X[3], ty, { font: FB, alinear: 'centro', ancho: COLS[3] });
    yp += H_RES;
  }
  rect(M, yp, W, 2 * H_DIR, { fondo: BLANCO, grosor: 1.5 });
  [emp.direccion, emp.telefonos].forEach((s, i) => {
    let size = 11;
    while (size > 7 && FB.widthOfTextAtSize(seguro(s), size) > W - 8) size -= 0.5;
    texto(s, M, yp + i * H_DIR + (H_DIR - size) / 2, { font: FB, size, color: AZUL, alinear: 'centro', ancho: W });
  });

  return Buffer.from(await pdf.save());
}
