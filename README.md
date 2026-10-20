# Ayudante Integral

Presupuestos en PDF, clientes, finanzas, proveedores, herramientas, agenda y panel de suscripciones.

- **Frontend:** `index.html` (sin cambios de diseño).
- **Backend:** `api/index.js` + `lib/`, una función serverless de Vercel. Reemplaza al Apps Script ([legacy/CODIGO GS.txt](legacy/CODIGO%20GS.txt)).
- **Base de datos:** Supabase (Postgres + Storage para logos y QR). Reemplaza a las hojas de Google Sheets.
- **Login:** Supabase Auth (correo/contraseña y Google). Reemplaza a Firebase Auth.
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
5. **Supabase Auth** (ver la sección siguiente).

## Login con Supabase Auth

1. En `index.html` pega `SUPABASE_URL` y `SUPABASE_ANON_KEY` (Project Settings > API, clave **anon / public**; la `service_role` nunca va ahí).
2. Authentication > URL Configuration: pon tu dominio en **Site URL** y agrégalo en **Redirect URLs** (también `http://localhost:3000` para desarrollo).
3. Authentication > Emails > **SMTP Settings**: configura tu Gmail (el mismo de `SMTP_USER` y su contraseña de aplicación) o los correos de confirmación no llegarán a clientes reales (el servicio gratuito de Supabase solo envía a pocas direcciones).
3b. Authentication > Providers > **Email**: deja activado **Confirm email** (es lo que impide que alguien reclame un correo ajeno al migrar). Si quieres, personaliza las plantillas de correo en Authentication > Emails.
4. Authentication > Providers > **Google**: actívalo con el Client ID y Secret de tu proyecto de Google Cloud, y agrega en Google la URI de redirección que te muestra Supabase.
5. Vuelve a ejecutar `supabase/schema.sql` (agrega `ON UPDATE CASCADE` a las llaves foráneas; es idempotente).

### Pasar los usuarios de Firebase a Supabase

- **Datos:** no hay que hacer nada. La primera vez que alguien entra con Supabase usando el **mismo correo** (verificado), su cuenta y todos sus datos pasan solos a su nuevo UID.
- **Contraseñas:** Firebase no las entrega en claro. Cada persona pulsa **«Crear cuenta»** con el **mismo correo** que ya tenía, elige una contraseña nueva y confirma su correo con el enlace que le llega; al entrar verá todos sus datos de antes. Quien entraba con Google solo pulsa «Entrar con Google». («¿Olvidaste tu contraseña?» solo sirve cuando la cuenta ya existe en Supabase.)
- **Súper administrador:** entra tú primero. Luego copia tu «User UID» de Authentication > Users y ponlo en `ADMIN_UID` en Vercel (y vuelve a desplegar). Hasta entonces sigues siendo administrador por tu rol, pero no «súper».
- Ya no se usa `FIREBASE_API_KEY`; puedes borrarla de Vercel.

## Diseño del presupuesto (plantilla por cliente)

Pestaña **PRESUPUESTOS > Diseño del presupuesto**. Cada cliente elige el aspecto de su PDF: estilo y colores, encabezado (ícono + texto, banner a todo el ancho o solo texto), título, qué muestra el pie, sello, marca de agua y nota/observación habituales. Hay una vista previa en vivo y un botón «Ver PDF de prueba» que genera el PDF real con el diseño aún sin guardar.

- **Dónde se guarda:** `perfiles.datos.plantilla` (JSON en texto, igual que los métodos de pago). No requiere cambios en `schema.sql`. Las imágenes (banner, sello, marca de agua) van al bucket `imagenes`, en la carpeta del usuario.
- **Por defecto:** quien nunca la configuró usa el estilo «Sobria», sin sello ni marca de agua. El estilo «Clásica (verde y amarillo)» reproduce el diseño anterior del PDF.
- **Código:** `lib/plantillaBase.js` (valores por defecto), `lib/plantilla.js` (validación y guardado), `lib/pdf.js` (dibujo), acciones `plantilla`, `guardarPlantilla`, `restablecerPlantilla` y `pdfPrueba` en `api/index.js`, y el bloque «DISEÑO DE LA HOJA» al final de `index.html`.
- Los presupuestos reimpresos usan el diseño **actual** del cliente, no el que tenía cuando se creó el presupuesto.

## Respaldo de datos

Perfil > **Respaldo de datos**. Cada usuario descarga lo suyo en Excel (para revisar) o JSON completo (para guardar tal cual). Los administradores ven además la tarjeta de la plataforma: usuarios, suscripciones, pagos, plantillas de cobro y configuración, más sus propios datos; nunca los presupuestos, clientes ni finanzas de otros usuarios. El código está en `lib/respaldo.js` (acciones `respaldo` y `admRespaldo`) y al final de `index.html`.

## Desarrollo

- `npm run dev`: levanta la app y la API en local (`vercel dev`, necesita el `.env`).
- `npm run probar-pdf`: genera dos PDF de ejemplo (1 página y varias páginas) sin tocar la base de datos.

## Diferencias con la versión de Google

- El PDF se dibuja en el servidor con el mismo diseño. El membrete sale del perfil de cada usuario (también para el administrador), así que **el administrador debe subir su logo en «Mi perfil»**. El sello digital fijo de la plantilla ya no existe.
- La lista de alias de «Enviar como» ya no se lee de Gmail: se configura en `SMTP_ALIASES`.
- Eliminar un usuario borra todos sus datos de la base (antes su hoja iba a la papelera de Drive). Su historial de pagos se conserva.
