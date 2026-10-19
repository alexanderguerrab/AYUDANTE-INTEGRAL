// ==========================================================
//  CONFIGURACIÓN · AYUDANTE INTEGRAL (backend en Vercel)
//  Los secretos van en las variables de entorno de Vercel (ver .env.example).
// ==========================================================

const env = (k, d = '') => (process.env[k] ?? d).trim();

export const CONFIG = {
  // Zona horaria con la que se calculan "hoy", fechas de registro, etc.
  TZ: env('APP_TZ', 'America/Caracas'),

  // --- CORREO (Gmail por SMTP con "contraseña de aplicación") ---
  // El remitente es la cuenta SMTP_USER. Los clientes envían con el NOMBRE de su negocio y reply-to a su correo.
  NOMBRE_REMITENTE: 'Ayudante Integral',
  COPIA_OCULTA: env('COPIA_OCULTA'),   // opcional: recibir copia oculta de los presupuestos del administrador

  // Datos impresos en TUS presupuestos (súper administrador) mientras tu perfil esté vacío.
  CORREO_REMITENTE: 'alexanderguerrab@gmail.com',
  DIRECCION: 'Calle nueva, casa 8-56, sector Ciudad Carton, Porlamar.',
  TELEFONOS: 'Telefonos:  (0295) 274.02.85  /  58 (0416) 399.00.52  /  58 (0414) 786.98.58',
  ESPECIALIDAD_ADMIN: 'Técnico en Aire Acondicionado y Refrigeración'
};

// Tu UID de Firebase (súper administrador)
export const ADMIN_UID = env('ADMIN_UID', 'l6rkm3BVfxWNzbvVEQ5tCkwKSxM2');
// apiKey pública de Firebase (la misma de index.html): sirve para validar quién hace cada petición
export const FIREBASE_API_KEY = env('FIREBASE_API_KEY', 'AIzaSyDbmz_PlxvG0EdqMTn5SVJTfvD8r_Du3gQ');
// true = quien se registre con correo/contraseña debe verificar su correo antes de usar la app
export const EXIGIR_CORREO_VERIFICADO = env('EXIGIR_CORREO_VERIFICADO') === 'true';

export const SUPABASE_URL = env('SUPABASE_URL');
export const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
export const BUCKET_IMAGENES = 'imagenes';

export const SMTP = {
  host: env('SMTP_HOST', 'smtp.gmail.com'),
  port: Number(env('SMTP_PORT', '465')),
  user: env('SMTP_USER'),
  pass: env('SMTP_PASS').replace(/\s/g, ''),   // Google muestra la contraseña de aplicación con espacios
  // "Enviar como" configurados en Gmail (separados por coma); se ofrecen como remitente de los cobros
  aliases: env('SMTP_ALIASES').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  limiteDiario: Number(env('SMTP_LIMITE_DIARIO', '450'))   // Gmail permite ~500 por día
};

export const MAX_BODY_CHARS = 400000;        // tamaño máximo de una petición
export const MAX_ENVIOS_POR_EJECUCION = 15;  // correos de cobro por ejecución
export const CUPO_CORREOS_DIA = 30;          // correos/día que un cliente puede enviar desde el correo del sistema
