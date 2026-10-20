// Valores por defecto de la plantilla del presupuesto (sin dependencias, también los usa el PDF y su script de prueba)
// ---------- Estilos listos para elegir ----------
export const ESTILOS = {
  sobria: { nombre: 'Sobria', colores: { encabezadoTabla: '#1e293b', tituloPie: '#1e293b', filas: '#f1f5f9', total: '#cbd5e1', direccion: '#1e293b', bordes: '#94a3b8' } },
  azul: { nombre: 'Azul', colores: { encabezadoTabla: '#0369a1', tituloPie: '#0369a1', filas: '#e0f2fe', total: '#bae6fd', direccion: '#0369a1', bordes: '#7dd3fc' } },
  minimal: { nombre: 'Minimalista', colores: { encabezadoTabla: '#ffffff', tituloPie: '#ffffff', filas: '#ffffff', total: '#f3f4f6', direccion: '#111827', bordes: '#9ca3af' } },
  clasica: { nombre: 'Clásica (verde y amarillo)', colores: { encabezadoTabla: '#ffffff', tituloPie: '#00ff00', filas: '#ffff00', total: '#00ff00', direccion: '#0000ff', bordes: '#000000' } }
};

// Plantilla por defecto: sencilla y neutra, sin sello ni marca de agua. Es lo que ve quien nunca la ha configurado.
export function plantillaDefecto() {
  return {
    estilo: 'sobria',
    titulo: 'PRESUPUESTO',
    colores: Object.assign({}, ESTILOS.sobria.colores),
    encabezado: { modo: 'logo', bannerId: '', marca: true, especialidad: true, rif: true, correo: true },
    pie: { direccion: true, telefonos: true, vigencia: true, bs: true },
    sello: { activo: false, id: '', posicion: 'centro', tam: 90 },
    marcaAgua: { activa: false, id: '', opacidad: 12, tam: 60 },
    notaDefecto: '',
    obsDefecto: ''
  };
}
