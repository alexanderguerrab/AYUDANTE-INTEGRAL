// Service worker de Ayudante Integral.
// Objetivo: que la app abra rápido y muestre su interfaz aunque no haya red.
// NO guarda nada de /api ni de Supabase: son datos de clientes, presupuestos y pagos y siempre van a la red.
// Subir VERSION cuando cambie esta lógica para limpiar cachés viejas.
const VERSION = 'ayudante-v1';
const CACHE = VERSION;

// Archivos propios para abrir sin red (la app entera vive en index.html).
const PRECARGA = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Librerías externas con versión fija (no cambian nunca). Se guardan para que la interfaz arranque sin red.
// Se usan tal como las pide la página (sin permiso CORS), por eso la copia es "opaca": sirve igual para <script>.
const CDN_FIJAS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11.10.8',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/'
];
const PRECARGA_CDN = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11.10.8'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all([
        // Una por una: si un archivo falla no se cae toda la instalación.
        ...PRECARGA.map((u) => c.add(u).catch(() => null)),
        ...PRECARGA_CDN.map((u) => {
          const req = new Request(u, { mode: 'no-cors' });
          return fetch(req).then((r) => c.put(req, r)).catch(() => null);
        })
      ]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Librerías externas fijas: caché primero (su versión nunca cambia), y se rellena al usarlas.
  if (url.origin !== self.location.origin) {
    if (CDN_FIJAS.some((p) => req.url.startsWith(p))) {
      e.respondWith(
        caches.match(req).then((enCache) => enCache || fetch(req).then((resp) => {
          if (resp.ok || resp.type === 'opaque') {
            const copia = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, copia));
          }
          return resp;
        }))
      );
    }
    return;   // Todo lo demás de otros dominios (Supabase, Google, Gmail) va directo a la red.
  }

  // La API (incluido /api?accion=config) nunca se guarda.
  if (url.pathname.startsWith('/api')) return;
  // Los vídeos usan peticiones por rangos; no se guardan.
  if (/\.(mp4|webm)$/i.test(url.pathname)) return;
  // El propio service worker no se guarda.
  if (url.pathname === '/sw.js') return;

  // Páginas: red primero (así las actualizaciones llegan), caché si no hay red.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp.ok && (url.pathname === '/' || url.pathname === '/index.html')) {
            const copia = resp.clone();
            caches.open(CACHE).then((c) => c.put('/', copia));
          }
          return resp;
        })
        .catch(() => caches.match('/').then((r) => r || caches.match(req)))
    );
    return;
  }

  // Archivos estáticos propios: sirve la caché y la refresca en segundo plano.
  e.respondWith(
    caches.match(req).then((enCache) => {
      const red = fetch(req)
        .then((resp) => {
          if (resp.ok) {
            const copia = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, copia));
          }
          return resp;
        })
        .catch(() => enCache);
      return enCache || red;
    })
  );
});
