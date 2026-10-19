-- =====================================================================
--  AYUDANTE INTEGRAL · Esquema de base de datos (Supabase / PostgreSQL)
--  Reemplaza a las hojas de Google Sheets:
--   · Hoja central: DB_Perfiles, CONTROL_SAAS, FINANZAS_PAGOS, FINANZAS_ESTADO, SCRIPTS DE COBRO
--   · Hoja de cada cliente: Historial, Base_Clientes, Perfil, Fin_*, Proveedores, Herr_*, Agenda_Citas
--  Antes cada cliente tenía su propia hoja de cálculo; ahora todo vive en las mismas tablas
--  separado por la columna uid (el UID de Firebase).
--
--  Seguridad: RLS activado SIN políticas. Solo el backend de Vercel (con la service_role key)
--  puede leer o escribir. La anon key no tiene acceso a nada.
--  El script es idempotente: se puede ejecutar varias veces.
-- =====================================================================

-- ---------- Usuarios (antes DB_Perfiles) ----------
create table if not exists usuarios (
  uid            text primary key,
  nombre         text not null default '',
  especialidad   text not null default '',
  estado         text not null default 'Pendiente',   -- Pendiente / Autorizado / Bloqueado
  correo         text not null default '',
  telefono       text not null default '',
  fecha_registro timestamptz default now(),
  rol            text not null default 'Cliente',     -- Cliente / Administrador
  hoja_id        text not null default '',            -- id de la hoja de Google antigua (solo referencia)
  orden          bigint generated always as identity
);
create index if not exists usuarios_correo_idx on usuarios (lower(correo));

-- ---------- Perfil de cada cliente (antes pestaña "Perfil": clave / valor) ----------
create table if not exists perfiles (
  uid   text primary key references usuarios(uid) on delete cascade,
  datos jsonb not null default '{}'::jsonb
);

-- ---------- Presupuestos (antes pestaña "Historial") ----------
create table if not exists presupuestos (
  uid       text not null references usuarios(uid) on delete cascade,
  numero    integer not null,
  fecha     timestamptz not null default now(),
  cliente   text not null default '',
  total_usd numeric(16,2) not null default 0,
  total_bs  numeric(18,2) not null default 0,
  contacto  text not null default '',
  detalle   jsonb,
  primary key (uid, numero)
);

-- ---------- Clientes (antes pestaña "Base_Clientes") ----------
create table if not exists clientes (
  id             uuid primary key default gen_random_uuid(),
  uid            text not null references usuarios(uid) on delete cascade,
  fecha_registro timestamptz not null default now(),
  nombre         text not null default '',
  rif            text not null default '',
  telefono       text not null default '',
  correo         text not null default '',
  direccion      text not null default ''
);
create index if not exists clientes_uid_idx on clientes (uid, nombre);

-- ---------- Finanzas ----------
create table if not exists ingresos (
  uid text not null references usuarios(uid) on delete cascade,
  id  text not null,
  fecha date, cliente text not null default '', presupuesto text not null default '',
  concepto text not null default '', monto numeric(16,2) not null default 0, metodo text not null default '',
  notas text not null default '', creado text not null default '',
  orden bigint generated always as identity,
  primary key (uid, id)
);

create table if not exists gastos (
  uid text not null references usuarios(uid) on delete cascade,
  id  text not null,
  fecha date, categoria text not null default '', descripcion text not null default '',
  proveedor text not null default '', monto numeric(16,2) not null default 0, metodo text not null default '',
  notas text not null default '', creado text not null default '',
  orden bigint generated always as identity,
  primary key (uid, id)
);

create table if not exists por_cobrar (
  uid text not null references usuarios(uid) on delete cascade,
  id  text not null,
  fecha date, cliente text not null default '', presupuesto text not null default '',
  concepto text not null default '', monto numeric(16,2) not null default 0, vence date,
  estado text not null default 'Pendiente', fecha_cobro date, notas text not null default '', creado text not null default '',
  rec0 text not null default '', rec7 text not null default '', rec15 text not null default '',
  orden bigint generated always as identity,
  primary key (uid, id)
);

create table if not exists proveedores (
  uid text not null references usuarios(uid) on delete cascade,
  id  text not null,
  nombre text not null default '', rif text not null default '', telefono text not null default '',
  correo text not null default '', direccion text not null default '', notas text not null default '', creado text not null default '',
  orden bigint generated always as identity,
  primary key (uid, id)
);

create table if not exists por_pagar (
  uid text not null references usuarios(uid) on delete cascade,
  id  text not null,
  fecha date, proveedor text not null default '', categoria text not null default '',
  descripcion text not null default '', monto numeric(16,2) not null default 0, vence date,
  estado text not null default 'Pendiente', fecha_pago date, notas text not null default '', creado text not null default '',
  orden bigint generated always as identity,
  primary key (uid, id)
);

-- ---------- Herramientas ----------
create table if not exists herramientas (
  uid text not null references usuarios(uid) on delete cascade,
  id  text not null,
  nombre text not null default '', marca text not null default '', categoria text not null default '',
  cantidad integer not null default 0, estado text not null default 'Buena', ubicacion text not null default '',
  valor numeric(16,2) not null default 0, notas text not null default '', creado text not null default '',
  orden bigint generated always as identity,
  primary key (uid, id)
);

create table if not exists prestamos (
  uid text not null references usuarios(uid) on delete cascade,
  id  text not null,
  herramienta_id text not null default '', herramienta text not null default '', cantidad integer not null default 0,
  persona text not null default '', telefono text not null default '', fecha_prestamo date, fecha_prevista date,
  estado text not null default 'Prestada', fecha_devolucion date, notas text not null default '', creado text not null default '',
  orden bigint generated always as identity,
  primary key (uid, id)
);

-- ---------- Agenda ----------
create table if not exists citas (
  uid text not null references usuarios(uid) on delete cascade,
  id  text not null,
  fecha date, hora text not null default '', duracion integer not null default 60,
  cliente text not null default '', telefono text not null default '', servicio text not null default '',
  direccion text not null default '', estado text not null default 'Pendiente', notas text not null default '', creado text not null default '',
  orden bigint generated always as identity,
  primary key (uid, id)
);

-- ---------- Panel de administración (antes hoja central) ----------
-- CONTROL_SAAS: cuotas de suscripción de cada cliente
create table if not exists control_saas (
  id                text primary key default gen_random_uuid()::text,
  plan              text not null default '',
  correo            text not null default '',
  monto             numeric(16,2) not null default 0,
  cobrado           boolean not null default false,
  fecha_suscripcion date,
  fecha_pago        date,
  aviso_hoy         text not null default '',   -- "ENVIADO" / "OMITIDO" / "VENCIDO" / ''
  aviso_7d          text not null default '',
  aviso_15d         text not null default '',
  comprobante_url   text not null default '',
  metodo_pago       text not null default '',
  tipo_suscripcion  text not null default 'Mensual',
  orden             bigint generated always as identity
);

-- FINANZAS_PAGOS: historial de pagos de suscripción
create table if not exists pagos (
  id          bigint generated always as identity primary key,
  uid         text not null default '',
  nombre      text not null default '',
  fecha_pago  date,
  mes         text not null default '',
  anio        integer,
  plan        text not null default '',
  metodo      text not null default '',
  comprobante text not null default '',
  costo       numeric(16,2) not null default 0,
  control_id  text not null default '',
  correo      text not null default ''
);
create index if not exists pagos_uid_idx on pagos (uid);
create index if not exists pagos_control_idx on pagos (control_id);

-- FINANZAS_ESTADO: plan y próximo pago de cada usuario (lo que ve en "Mi suscripción")
create table if not exists suscripcion_estado (
  uid          text primary key,
  fecha_base   date,
  plan         text not null default '',
  proximo_pago date
);

-- Ajustes sueltos (antes Script Properties y la hoja "SCRIPTS DE COBRO")
create table if not exists app_config (
  clave text primary key,
  valor text not null default ''
);

-- ---------- Seguridad: RLS sin políticas (solo la service_role key entra) ----------
alter table usuarios           enable row level security;
alter table perfiles           enable row level security;
alter table presupuestos       enable row level security;
alter table clientes           enable row level security;
alter table ingresos           enable row level security;
alter table gastos             enable row level security;
alter table por_cobrar         enable row level security;
alter table proveedores        enable row level security;
alter table por_pagar          enable row level security;
alter table herramientas       enable row level security;
alter table prestamos          enable row level security;
alter table citas              enable row level security;
alter table control_saas       enable row level security;
alter table pagos              enable row level security;
alter table suscripcion_estado enable row level security;
alter table app_config         enable row level security;

-- ---------- Almacenamiento de imágenes (logos y códigos QR; antes en Google Drive) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imagenes', 'imagenes', true, 307200, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
