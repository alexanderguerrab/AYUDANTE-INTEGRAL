# Ayudante Integral

Presupuestos en PDF, clientes, finanzas, proveedores, herramientas, agenda y panel de suscripciones.

- **Frontend:** `index.html` (sin cambios de diseño).
- **Backend:** `api/index.js` + `lib/`, una función serverless de Vercel. Reemplaza al Apps Script ([legacy/CODIGO GS.txt](legacy/CODIGO%20GS.txt)).
- **Base de datos:** Supabase (Postgres + Storage para logos y QR). Reemplaza a las hojas de Google Sheets.
- **Login:** Firebase Auth (el mismo de antes, los usuarios no cambian).
- **Correo:** Gmail por SMTP con contraseña de aplicación (reemplaza a `GmailApp`).

| Antes (Google Sheets)                          | Ahora (Supabase)                          |
|------------------------------------------------|-------------------------------------------|
| `DB_Perfiles`                                  | `usuarios`                                |
| Pestaña `Perfil` de cada cliente               | `perfiles` (jsonb)                        |
| `Historial`                                    | `presupuestos`                            |
| `Base_Clientes`                                | `clientes`                                |
| `Fin_Ingresos`, `Fin_Gastos`, `Fin_PorCobrar`, `Fin_PorPagar`, `Proveedores` | `ingresos`, `gastos`, `por_cobrar`, `por_pagar`, `proveedores` |
| `Herr_Inventario`, `Herr_Prestamos`, `Agenda_Citas` | `herramientas`, `prestamos`, `citas` |
| `CONTROL_SAAS`, `FINANZAS_PAGOS`, `FINANZAS_ESTADO` | `control_saas`, `pagos`, `suscripcion_estado` |
| `SCRIPTS DE COBRO` + Script Properties         | `app_config`                              |
| Imágenes en Google Drive                       | Bucket `imagenes` de Supabase Storage     |

Antes cada cliente tenía su propia hoja de cálculo. Ahora todo está en las mismas tablas, separado por `uid`.

## Puesta en marcha

1. **Supabase:** ejecuta [supabase/schema.sql](supabase/schema.sql) en el SQL Editor.
2. **Variables de entorno en Vercel** (Settings > Environment Variables). Ver [.env.example](.env.example):
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SMTP_USER`, `SMTP_PASS` (y opcionalmente `SMTP_ALIASES`, `APP_TZ`).
   La contraseña SMTP es una [contraseña de aplicación de Google](https://myaccount.google.com/apppasswords) (requiere verificación en 2 pasos).
3. **Migrar los datos** (una sola vez, antes de abrir la app nueva):
   1. En el Apps Script actual crea un archivo nuevo, pega [migracion/exportar.gs](migracion/exportar.gs) y ejecuta `exportarParaSupabase()`. Si se corta por tiempo, vuelve a ejecutarla hasta que diga «EXPORTACIÓN COMPLETA».
   2. Descarga la carpeta «Exportacion Supabase» de Drive y descomprímela en `migracion/datos/`.
   3. Copia `.env.example` a `.env`, llénalo y ejecuta `npm install` y luego `npm run importar`.
4. **Desplegar:** haz push a GitHub (Vercel despliega solo) o ejecuta `vercel --prod`.
5. **Firebase:** si el dominio cambia, agrégalo en Firebase > Authentication > Settings > Authorized domains.

## Desarrollo

- `npm run dev`: levanta la app y la API en local (`vercel dev`, necesita el `.env`).
- `npm run probar-pdf`: genera dos PDF de ejemplo (1 página y varias páginas) sin tocar la base de datos.

## Diferencias con la versión de Google

- El PDF se dibuja en el servidor con el mismo diseño. El membrete sale del perfil de cada usuario (también para el administrador), así que **el administrador debe subir su logo en «Mi perfil»**. El sello digital fijo de la plantilla ya no existe.
- La lista de alias de «Enviar como» ya no se lee de Gmail: se configura en `SMTP_ALIASES`.
- Eliminar un usuario borra todos sus datos de la base (antes su hoja iba a la papelera de Drive). Su historial de pagos se conserva.
