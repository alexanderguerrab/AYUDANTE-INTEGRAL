// Genera PDFs de prueba sin tocar la base de datos (equivale a probarPaginacion() del Apps Script).
// Uso:  npm run probar-pdf   → crea prueba-1-pagina.pdf y prueba-varias-paginas.pdf en la carpeta actual
import { writeFileSync } from 'node:fs';
import { crearPdfPresupuesto } from '../lib/pdf.js';
import { normalizarDatos_, calcularTotales_ } from '../lib/presupuestos.js';

const emp = {
  marca: 'Ayudante Integral', especialidad: 'Técnico en Aire Acondicionado y Refrigeración', rif: 'V-12345678-9',
  correo: 'correo@ejemplo.com', direccion: 'Calle nueva, casa 8-56, sector Ciudad Carton, Porlamar.',
  telefonos: 'Telefonos:  (0295) 274.02.85  /  58 (0416) 399.00.52  /  58 (0414) 786.98.58'
};

const base = { cliente: 'PRUEBA C.A.', telefono: '0414-0000000', fecha: '01/01/2026', vigencia: 15, tasa: 40.5, iva: 16 };

const casos = {
  'prueba-1-pagina.pdf': Object.assign({ numero: '7', nota: 'Precios sujetos a cambio sin previo aviso.', items: [
    { desc: 'Mantenimiento preventivo de aire acondicionado split 12.000 BTU', cant: 2, precio: 35 },
    { desc: 'Carga de gas refrigerante R-410A (incluye prueba de fugas, vacío y limpieza de serpentín) — servicio completo con garantía de 3 meses', cant: 1, precio: 60 },
    { desc: '-Capacitor 35+5 µF', cant: 1.5, precio: 12.5 }
  ] }, base),
  'prueba-varias-paginas.pdf': Object.assign({ numero: '99999', nota: 'Nota de prueba.\nSegunda línea de la nota.', observacion: 'Observación de prueba ✓ con símbolos raros.',
    items: Array.from({ length: 45 }, (_, i) => ({ desc: 'Artículo de prueba ' + (i + 1), cant: 1, precio: 10 })) }, base)
};

for (const [archivo, datos] of Object.entries(casos)) {
  const d = normalizarDatos_(datos);
  writeFileSync(archivo, await crearPdfPresupuesto(d, calcularTotales_(d), emp, null));
  console.log('Creado', archivo);
}
