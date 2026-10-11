-- Base de datos PROPIA del panel (Postgres en el servidor del proveedor, sin datos de clientes).
--
-- Reglas de seguridad de este archivo:
--  * Las tablas viven en el esquema "panel". El usuario de la aplicación ("panel_app") no tiene permiso sobre ellas.
--  * Lo único que puede hacer ese usuario es ejecutar las funciones "panel_*" del esquema public
--    (se les quita el permiso a todos los demás roles).
--  * Cada función hace UNA operación atómica (consumir un desafío, avanzar un plan, contar un intento…):
--    así dos pedidos simultáneos no pueden saltearse un límite ni usar dos veces algo de un solo uso.
--  * Todo está en SQL plano y con search_path vacío para que nadie pueda "sombrear" una función.
--  * El registro de auditoría es solo de agregar (triggers lo impiden modificar o borrar) y está encadenado.

create schema if not exists panel;

-- ---------------------------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------------------------

create table if not exists panel.ajustes (
  clave text primary key check (char_length(clave) <= 64),
  valor jsonb not null
);

-- Llaves de acceso (passkeys) registradas. La clave pública no es secreta; el contador no puede retroceder.
create table if not exists panel.credenciales (
  id text primary key check (char_length(id) between 16 and 1024),         -- id de credencial (base64url)
  clave_publica text not null check (char_length(clave_publica) between 16 and 4096), -- base64url
  contador bigint not null default 0 check (contador >= 0),
  transportes text[] not null default '{}',
  nombre text not null default '' check (char_length(nombre) <= 60),
  creada_at timestamptz not null default now(),
  ultimo_uso_at timestamptz
);

-- Desafíos de un solo uso (los que firma la llave). Vencen a los pocos minutos.
create table if not exists panel.desafios (
  desafio text primary key check (char_length(desafio) between 16 and 256),
  proposito text not null check (proposito in ('alta', 'ingreso', 'plan')),
  plan_id uuid,
  sesion_hash text,
  vence_at timestamptz not null,
  creado_at timestamptz not null default now()
);

-- Sesiones. Se guarda solo el hash del identificador (si se filtrara la tabla, no sirve para entrar).
create table if not exists panel.sesiones (
  hash text primary key check (hash ~ '^[0-9a-f]{64}$'),
  navegador_hash text not null,
  ip_hash text not null,
  credencial_id text not null,
  creada_at timestamptz not null default now(),
  ultimo_uso_at timestamptz not null default now(),
  vence_at timestamptz not null,                                           -- tope absoluto
  revocada_at timestamptz
);

-- Planes de operación (crear cliente, actualizar, módulos). Se firman una vez y se ejecutan paso a paso.
create table if not exists panel.planes (
  id uuid primary key default gen_random_uuid(),
  sesion_hash text not null,
  tipo text not null check (tipo in ('crear', 'actualizar', 'modulos', 'componente', 'org_agregar', 'org_quitar')),
  ref text check (ref is null or ref ~ '^[a-z]{20}$'),
  parametros jsonb not null,
  pasos jsonb not null,
  cursor integer not null default 0 check (cursor >= 0),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'autorizado', 'en_curso', 'terminado', 'fallido', 'cancelado')),
  contexto jsonb not null default '{}'::jsonb,
  arriendo_token text,
  arriendo_hasta timestamptz,
  error text check (error is null or char_length(error) <= 500),
  clave_entregada boolean not null default false,
  creado_at timestamptz not null default now(),
  autorizado_at timestamptz,
  terminado_at timestamptz,
  vence_at timestamptz not null
);

-- Un solo plan activo por proyecto a la vez.
create table if not exists panel.bloqueos (
  ref text primary key check (ref ~ '^[a-z]{20}$' or ref like 'nuevo:%'),
  plan_id uuid not null,
  hasta timestamptz not null
);

-- Organizaciones de Supabase (una por cliente) que el panel puede operar, además de las que vienen en la configuración del servidor.
create table if not exists panel.organizaciones (
  slug text primary key check (slug ~ '^[a-z0-9]{10,40}$'),
  agregada_at timestamptz not null default now()
);

create table if not exists panel.limites (
  clave text not null check (char_length(clave) <= 120),
  ventana timestamptz not null,
  cuenta integer not null default 0,
  primary key (clave, ventana)
);

create table if not exists panel.auditoria (
  seq bigint primary key,                       -- lo asigna el trigger, dentro del candado (ver abajo)
  at timestamptz not null default clock_timestamp(),
  actor text not null check (char_length(actor) <= 60),
  evento text not null check (char_length(evento) <= 80),
  detalle jsonb not null default '{}'::jsonb,
  ip_hash text not null default '' check (char_length(ip_hash) <= 64),
  hash_anterior text not null default '',
  hash text not null default ''
);

alter table panel.ajustes enable row level security;
alter table panel.credenciales enable row level security;
alter table panel.desafios enable row level security;
alter table panel.sesiones enable row level security;
alter table panel.planes enable row level security;
alter table panel.bloqueos enable row level security;
alter table panel.limites enable row level security;
alter table panel.organizaciones enable row level security;
alter table panel.auditoria enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Auditoría encadenada, solo de agregar
-- ---------------------------------------------------------------------------------------------

create or replace function panel.auditoria_hash(
  p_anterior text, p_seq bigint, p_at timestamptz, p_actor text, p_evento text, p_detalle jsonb, p_ip text
) returns text language sql immutable set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    p_anterior || '|' || p_seq::text || '|' ||
    pg_catalog.to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
    p_actor || '|' || p_evento || '|' || p_detalle::text || '|' || p_ip, 'UTF8')), 'hex');
$$;

create or replace function panel.auditoria_antes_de_insertar() returns trigger
language plpgsql set search_path = '' as $$
declare v_anterior text; v_seq bigint;
begin
  -- Serializa las altas: la cadena no puede bifurcarse aunque entren dos eventos a la vez. El número de secuencia se
  -- asigna ADENTRO del candado (no con una columna identidad): así el orden por número es el orden real de la cadena.
  perform pg_catalog.pg_advisory_xact_lock(7190001);
  select a.hash, a.seq into v_anterior, v_seq from panel.auditoria a order by a.seq desc limit 1;
  new.seq := coalesce(v_seq, 0) + 1;
  new.hash_anterior := coalesce(v_anterior, '');
  new.at := pg_catalog.clock_timestamp();
  new.hash := panel.auditoria_hash(new.hash_anterior, new.seq, new.at, new.actor, new.evento, new.detalle, new.ip_hash);
  return new;
end $$;

create or replace function panel.auditoria_inmutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'El registro de auditoría no se puede modificar ni borrar' using errcode = '42501';
end $$;

drop trigger if exists auditoria_antes_insertar on panel.auditoria;
create trigger auditoria_antes_insertar before insert on panel.auditoria
  for each row execute function panel.auditoria_antes_de_insertar();
drop trigger if exists auditoria_sin_cambios on panel.auditoria;
create trigger auditoria_sin_cambios before update or delete on panel.auditoria
  for each row execute function panel.auditoria_inmutable();
drop trigger if exists auditoria_sin_vaciar on panel.auditoria;
create trigger auditoria_sin_vaciar before truncate on panel.auditoria
  for each statement execute function panel.auditoria_inmutable();

-- ---------------------------------------------------------------------------------------------
-- Funciones (lo único que se puede llamar desde afuera)
-- ---------------------------------------------------------------------------------------------

-- Auditoría ------------------------------------------------------------------------------------
create or replace function public.panel_auditoria_agregar(p_actor text, p_evento text, p_detalle jsonb, p_ip_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  insert into panel.auditoria (actor, evento, detalle, ip_hash)
  values (left(coalesce(p_actor, ''), 60), left(coalesce(p_evento, ''), 80), coalesce(p_detalle, '{}'::jsonb), left(coalesce(p_ip_hash, ''), 64))
  returning hash into v_hash;
  return v_hash;
end $$;

create or replace function public.panel_auditoria_recientes(p_limite integer)
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.seq desc), '[]'::jsonb)
  from (select a.seq, a.at, a.actor, a.evento, a.detalle, a.hash
        from panel.auditoria a order by a.seq desc limit least(greatest(coalesce(p_limite, 50), 1), 200)) x;
$$;

-- Recorre toda la cadena: devuelve {ok:true,total:n} o {ok:false,roto_en:seq}.
create or replace function public.panel_auditoria_verificar()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; v_prev text := ''; v_total integer := 0; v_esperado text;
begin
  for r in select * from panel.auditoria order by seq asc loop
    v_esperado := panel.auditoria_hash(v_prev, r.seq, r.at, r.actor, r.evento, r.detalle, r.ip_hash);
    if r.hash_anterior <> v_prev or r.hash <> v_esperado then
      return pg_catalog.jsonb_build_object('ok', false, 'roto_en', r.seq);
    end if;
    v_prev := r.hash; v_total := v_total + 1;
  end loop;
  return pg_catalog.jsonb_build_object('ok', true, 'total', v_total);
end $$;

-- Límites de velocidad ---------------------------------------------------------------------------
-- Cuenta el intento y dice si todavía está permitido. Atómico: no hay forma de colarse entre dos pedidos.
create or replace function public.panel_limite_golpear(p_clave text, p_maximo integer, p_ventana_segundos integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_ventana timestamptz; v_cuenta integer;
begin
  if p_ventana_segundos < 1 or p_ventana_segundos > 86400 or p_maximo < 1 then
    raise exception 'parámetros inválidos';
  end if;
  v_ventana := pg_catalog.to_timestamp(pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.now()) / p_ventana_segundos) * p_ventana_segundos);
  insert into panel.limites (clave, ventana, cuenta) values (left(p_clave, 120), v_ventana, 1)
  on conflict (clave, ventana) do update set cuenta = panel.limites.cuenta + 1
  returning cuenta into v_cuenta;
  -- Limpieza oportunista de ventanas viejas (acotada para no demorar el pedido).
  delete from panel.limites where ctid in (select l.ctid from panel.limites l where l.ventana < pg_catalog.now() - interval '2 days' limit 50);
  return v_cuenta <= p_maximo;
end $$;

-- Llaves de acceso -------------------------------------------------------------------------------
-- Estado del alta de llaves. p_codigo_hash = sha256 del código de alta vigente (variable de entorno).
--   'abierto_nuevo'  : no hay llaves, o el código cambió (recuperación: reemplaza a todas las anteriores)
--   'abierto_ventana': se registró una llave con este código hace menos de 15 minutos (para sumar la de respaldo)
--   'cerrado'        : no se puede registrar nada
create or replace function public.panel_alta_estado(p_codigo_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_n integer; v_usado text; v_hasta timestamptz;
begin
  select pg_catalog.count(*) into v_n from panel.credenciales;
  if v_n = 0 then return 'abierto_nuevo'; end if;
  select a.valor #>> '{}' into v_usado from panel.ajustes a where a.clave = 'codigo_alta_usado';
  if v_usado is distinct from p_codigo_hash then return 'abierto_nuevo'; end if;
  select (a.valor #>> '{}')::timestamptz into v_hasta from panel.ajustes a where a.clave = 'alta_ventana_hasta';
  if v_hasta is not null and pg_catalog.now() < v_hasta and v_n < 5 then return 'abierto_ventana'; end if;
  return 'cerrado';
end $$;

create or replace function public.panel_credencial_agregar(
  p_codigo_hash text, p_id text, p_clave_publica text, p_contador bigint, p_transportes text[], p_nombre text
) returns text language plpgsql security definer set search_path = '' as $$
declare v_estado text;
begin
  perform pg_catalog.pg_advisory_xact_lock(7190002);
  v_estado := public.panel_alta_estado(p_codigo_hash);
  if v_estado = 'cerrado' then raise exception 'alta cerrada' using errcode = '42501'; end if;
  if v_estado = 'abierto_nuevo' then
    -- Alta inicial o recuperación: todo lo anterior deja de valer (llaves, sesiones, planes, desafíos).
    delete from panel.credenciales;
    update panel.sesiones set revocada_at = pg_catalog.now() where revocada_at is null;
    update panel.planes set estado = 'cancelado', terminado_at = pg_catalog.now() where estado in ('pendiente', 'autorizado', 'en_curso');
    delete from panel.bloqueos;
    delete from panel.desafios;
  end if;
  insert into panel.credenciales (id, clave_publica, contador, transportes, nombre)
  values (p_id, p_clave_publica, greatest(coalesce(p_contador, 0), 0), coalesce(p_transportes, '{}'), left(coalesce(p_nombre, ''), 60));
  insert into panel.ajustes (clave, valor) values ('codigo_alta_usado', pg_catalog.to_jsonb(p_codigo_hash))
    on conflict (clave) do update set valor = excluded.valor;
  if v_estado = 'abierto_nuevo' then
    insert into panel.ajustes (clave, valor) values ('alta_ventana_hasta', pg_catalog.to_jsonb((pg_catalog.now() + interval '15 minutes')::text))
      on conflict (clave) do update set valor = excluded.valor;
  end if;
  return v_estado;
end $$;

create or replace function public.panel_credenciales_listar()
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', c.id, 'transportes', c.transportes, 'nombre', c.nombre,
    'creada_at', c.creada_at, 'ultimo_uso_at', c.ultimo_uso_at) order by c.creada_at), '[]'::jsonb)
  from panel.credenciales c;
$$;

create or replace function public.panel_credencial_obtener(p_id text)
returns jsonb language sql security definer set search_path = '' as $$
  select pg_catalog.to_jsonb(x) from (select c.id, c.clave_publica, c.contador, c.transportes from panel.credenciales c where c.id = p_id) x;
$$;

-- Sube el contador. Un contador que no avanza (o retrocede) indica una llave clonada: se rechaza.
-- Excepción: las llaves que no llevan cuenta reportan siempre 0 (se aceptan si el guardado también es 0).
create or replace function public.panel_credencial_usar(p_id text, p_nuevo_contador bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_actual bigint;
begin
  select c.contador into v_actual from panel.credenciales c where c.id = p_id for update;
  if not found then return false; end if;
  if not ((v_actual = 0 and p_nuevo_contador = 0) or p_nuevo_contador > v_actual) then return false; end if;
  update panel.credenciales set contador = p_nuevo_contador, ultimo_uso_at = pg_catalog.now() where id = p_id;
  return true;
end $$;

create or replace function public.panel_hay_credenciales()
returns boolean language sql security definer set search_path = '' as $$ select exists (select 1 from panel.credenciales); $$;

-- Desafíos -------------------------------------------------------------------------------------
create or replace function public.panel_desafio_crear(p_desafio text, p_proposito text, p_plan_id uuid, p_sesion_hash text, p_segundos integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_segundos < 10 or p_segundos > 300 then raise exception 'ttl inválido'; end if;
  delete from panel.desafios where vence_at < pg_catalog.now();
  -- Tope de desafíos pendientes: evita llenar la tabla.
  if (select pg_catalog.count(*) from panel.desafios) >= 100 then raise exception 'demasiados desafíos pendientes' using errcode = '53400'; end if;
  insert into panel.desafios (desafio, proposito, plan_id, sesion_hash, vence_at)
  values (p_desafio, p_proposito, p_plan_id, p_sesion_hash, pg_catalog.now() + pg_catalog.make_interval(secs => p_segundos));
end $$;

-- Lo consume (lo borra) y devuelve de qué era. Si no existe, venció o es de otro propósito: null.
create or replace function public.panel_desafio_consumir(p_desafio text, p_proposito text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  delete from panel.desafios where desafio = p_desafio and proposito = p_proposito and vence_at > pg_catalog.now()
  returning plan_id, sesion_hash into r;
  if not found then return null; end if;
  return pg_catalog.jsonb_build_object('plan_id', r.plan_id, 'sesion_hash', r.sesion_hash);
end $$;

-- Sesiones ---------------------------------------------------------------------------------------
create or replace function public.panel_sesion_crear(p_hash text, p_navegador_hash text, p_ip_hash text, p_credencial_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Un solo ingreso a la vez (si no, 20 ingresos simultáneos se saltean el tope de abajo).
  perform pg_catalog.pg_advisory_xact_lock(7190003);
  -- Máximo 3 sesiones vivas: al crear una nueva se cierran las más viejas.
  update panel.sesiones set revocada_at = pg_catalog.now()
   where revocada_at is null and hash in (
     select s.hash from panel.sesiones s where s.revocada_at is null and s.vence_at > pg_catalog.now()
     order by s.creada_at desc offset 2);
  insert into panel.sesiones (hash, navegador_hash, ip_hash, credencial_id, vence_at)
  values (p_hash, p_navegador_hash, p_ip_hash, p_credencial_id, pg_catalog.now() + interval '8 hours');
  delete from panel.sesiones where vence_at < pg_catalog.now() - interval '2 days';
end $$;

-- Valida y renueva. Inactividad máxima 15 minutos; tope absoluto 8 horas. Si el navegador no coincide, se revoca.
create or replace function public.panel_sesion_validar(p_hash text, p_navegador_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  select * into s from panel.sesiones where hash = p_hash for update;
  if not found or s.revocada_at is not null or s.vence_at <= pg_catalog.now()
     or s.ultimo_uso_at < pg_catalog.now() - interval '15 minutes' then
    return null;
  end if;
  if s.navegador_hash <> p_navegador_hash then
    update panel.sesiones set revocada_at = pg_catalog.now() where hash = p_hash;
    return pg_catalog.jsonb_build_object('revocada_por_navegador', true);
  end if;
  update panel.sesiones set ultimo_uso_at = pg_catalog.now() where hash = p_hash;
  return pg_catalog.jsonb_build_object('hash', s.hash, 'credencial_id', s.credencial_id, 'creada_at', s.creada_at);
end $$;

create or replace function public.panel_sesion_revocar(p_hash text)
returns void language sql security definer set search_path = '' as $$
  update panel.sesiones set revocada_at = pg_catalog.now() where hash = p_hash and revocada_at is null;
$$;

-- Pánico: cierra todas las sesiones y cancela todo plan sin terminar.
create or replace function public.panel_panico()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_s integer; v_p integer;
begin
  update panel.sesiones set revocada_at = pg_catalog.now() where revocada_at is null;
  get diagnostics v_s = row_count;
  update panel.planes set estado = 'cancelado', terminado_at = pg_catalog.now(), arriendo_token = null
   where estado in ('pendiente', 'autorizado', 'en_curso');
  get diagnostics v_p = row_count;
  delete from panel.bloqueos;
  delete from panel.desafios;
  return pg_catalog.jsonb_build_object('sesiones', v_s, 'planes', v_p);
end $$;

-- Organizaciones -----------------------------------------------------------------------------------
create or replace function public.panel_org_listar()
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(o.slug order by o.agregada_at), '[]'::jsonb) from panel.organizaciones o;
$$;

-- Devuelve true si la agregó (false si ya estaba). Tope de 30 organizaciones.
create or replace function public.panel_org_agregar(p_slug text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(7190004);
  if p_slug is null or p_slug !~ '^[a-z0-9]{10,40}$' then raise exception 'organización inválida'; end if;
  if exists (select 1 from panel.organizaciones where slug = p_slug) then return false; end if;
  if (select pg_catalog.count(*) from panel.organizaciones) >= 30 then raise exception 'demasiadas organizaciones' using errcode = '53400'; end if;
  insert into panel.organizaciones (slug) values (p_slug);
  return true;
end $$;

-- Devuelve true si la quitó. No toca nada de Supabase: solo deja de operarla desde el panel.
create or replace function public.panel_org_quitar(p_slug text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_borradas integer;
begin
  delete from panel.organizaciones where slug = p_slug;
  get diagnostics v_borradas = row_count;
  return v_borradas > 0;
end $$;

-- Planes -----------------------------------------------------------------------------------------
create or replace function public.panel_plan_crear(p_sesion_hash text, p_tipo text, p_ref text, p_parametros jsonb, p_pasos jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if pg_catalog.jsonb_typeof(p_pasos) <> 'array' or pg_catalog.jsonb_array_length(p_pasos) not between 1 and 60 then
    raise exception 'pasos inválidos';
  end if;
  -- Los planes sin firmar vencen a los 10 minutos.
  update panel.planes set estado = 'cancelado', terminado_at = pg_catalog.now() where estado = 'pendiente' and vence_at < pg_catalog.now();
  if (select pg_catalog.count(*) from panel.planes where sesion_hash = p_sesion_hash and estado = 'pendiente') >= 5 then
    raise exception 'demasiados planes pendientes' using errcode = '53400';
  end if;
  insert into panel.planes (sesion_hash, tipo, ref, parametros, pasos, vence_at)
  values (p_sesion_hash, p_tipo, p_ref, p_parametros, p_pasos, pg_catalog.now() + interval '10 minutes')
  returning id into v_id;
  return v_id;
end $$;

-- Devuelve el plan SOLO si pertenece a esa sesión (si no, es como si no existiera).
create or replace function public.panel_plan_obtener(p_id uuid, p_sesion_hash text)
returns jsonb language sql security definer set search_path = '' as $$
  select pg_catalog.to_jsonb(x) from (
    select p.id, p.tipo, p.ref, p.parametros, p.pasos, p.cursor, p.estado, p.contexto, p.error, p.clave_entregada,
           p.creado_at, p.autorizado_at, p.terminado_at, p.vence_at
    from panel.planes p where p.id = p_id and p.sesion_hash = p_sesion_hash) x;
$$;

-- Pasa de 'pendiente' a 'autorizado' (una sola vez, solo si no venció y es de esa sesión).
create or replace function public.panel_plan_autorizar(p_id uuid, p_sesion_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update panel.planes set estado = 'autorizado', autorizado_at = pg_catalog.now(), vence_at = pg_catalog.now() + interval '30 minutes'
   where id = p_id and sesion_hash = p_sesion_hash and estado = 'pendiente' and vence_at > pg_catalog.now();
  return found;
end $$;

create or replace function public.panel_plan_cancelar(p_id uuid, p_sesion_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_cancelados integer;
begin
  update panel.planes set estado = 'cancelado', terminado_at = pg_catalog.now(), arriendo_token = null
   where id = p_id and sesion_hash = p_sesion_hash and estado in ('pendiente', 'autorizado', 'en_curso');
  get diagnostics v_cancelados = row_count;
  delete from panel.bloqueos where plan_id = p_id;
  return v_cancelados > 0;
end $$;

-- Toma el "arriendo" del paso siguiente. Solo uno a la vez: si otro pedido ya lo tiene vigente, devuelve ocupado.
-- Devuelve {paso, indice, parametros, contexto, ref, token} o {error:'...'}.
create or replace function public.panel_plan_paso_empezar(p_id uuid, p_sesion_hash text, p_token text, p_segundos integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p record; v_bloqueo text;
begin
  if p_segundos < 5 or p_segundos > 300 then raise exception 'arriendo inválido'; end if;
  select * into p from panel.planes where id = p_id and sesion_hash = p_sesion_hash for update;
  if not found then return pg_catalog.jsonb_build_object('error', 'no_existe'); end if;
  if p.estado not in ('autorizado', 'en_curso') then return pg_catalog.jsonb_build_object('error', 'estado', 'estado', p.estado); end if;
  if p.vence_at <= pg_catalog.now() then
    update panel.planes set estado = 'cancelado', terminado_at = pg_catalog.now() where id = p_id;
    delete from panel.bloqueos where plan_id = p_id;
    return pg_catalog.jsonb_build_object('error', 'vencido');
  end if;
  if p.arriendo_hasta is not null and p.arriendo_hasta > pg_catalog.now() then return pg_catalog.jsonb_build_object('error', 'ocupado'); end if;
  if p.cursor >= pg_catalog.jsonb_array_length(p.pasos) then return pg_catalog.jsonb_build_object('error', 'estado', 'estado', 'terminado'); end if;
  -- Un solo plan por proyecto (para "crear", la clave es el propio plan: aún no hay proyecto).
  v_bloqueo := coalesce(p.ref, 'nuevo:' || p.id::text);
  insert into panel.bloqueos (ref, plan_id, hasta) values (v_bloqueo, p.id, pg_catalog.now() + interval '10 minutes')
  on conflict (ref) do update set plan_id = excluded.plan_id, hasta = excluded.hasta
    where panel.bloqueos.plan_id = excluded.plan_id or panel.bloqueos.hasta < pg_catalog.now();
  if not found then return pg_catalog.jsonb_build_object('error', 'proyecto_ocupado'); end if;
  update panel.planes set estado = 'en_curso', arriendo_token = p_token, arriendo_hasta = pg_catalog.now() + pg_catalog.make_interval(secs => p_segundos)
   where id = p_id;
  return pg_catalog.jsonb_build_object('paso', p.pasos -> p.cursor, 'indice', p.cursor, 'total', pg_catalog.jsonb_array_length(p.pasos),
    'tipo', p.tipo, 'parametros', p.parametros, 'contexto', p.contexto, 'ref', p.ref, 'token', p_token);
end $$;

-- Cierra el paso. Solo vale con el token del arriendo y para el paso esperado.
--   p_resultado: 'ok' (avanza), 'reintentar' (queda en el mismo paso), 'fallo' (termina el plan como fallido)
create or replace function public.panel_plan_paso_terminar(p_id uuid, p_token text, p_indice integer, p_resultado text, p_contexto jsonb, p_error text, p_ref text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p record; v_total integer; v_nuevo integer; v_estado text;
begin
  select * into p from panel.planes where id = p_id for update;
  if not found or p.arriendo_token is null or p.arriendo_token <> p_token or p.cursor <> p_indice or p.estado <> 'en_curso' then
    return pg_catalog.jsonb_build_object('error', 'arriendo');
  end if;
  v_total := pg_catalog.jsonb_array_length(p.pasos);
  if p_resultado = 'ok' then
    v_nuevo := p.cursor + 1;
    v_estado := case when v_nuevo >= v_total then 'terminado' else 'en_curso' end;
    update panel.planes set cursor = v_nuevo, estado = v_estado, arriendo_token = null, arriendo_hasta = null, error = null,
      contexto = p.contexto || coalesce(p_contexto, '{}'::jsonb),
      ref = coalesce(p.ref, p_ref),
      terminado_at = case when v_estado = 'terminado' then pg_catalog.now() end
     where id = p_id;
    if v_estado = 'terminado' then delete from panel.bloqueos where plan_id = p_id; end if;
    -- Cuando el plan "crear" descubre el proyecto, el bloqueo pasa a ser por proyecto.
    if p.ref is null and p_ref is not null and v_estado <> 'terminado' then
      delete from panel.bloqueos where plan_id = p_id;
      insert into panel.bloqueos (ref, plan_id, hasta) values (p_ref, p_id, pg_catalog.now() + interval '10 minutes')
        on conflict (ref) do update set plan_id = excluded.plan_id, hasta = excluded.hasta
        where panel.bloqueos.plan_id = excluded.plan_id or panel.bloqueos.hasta < pg_catalog.now();
    end if;
    return pg_catalog.jsonb_build_object('estado', v_estado, 'cursor', v_nuevo, 'total', v_total);
  elsif p_resultado = 'reintentar' then
    update panel.planes set arriendo_token = null, arriendo_hasta = null, error = left(coalesce(p_error, ''), 500),
      contexto = p.contexto || coalesce(p_contexto, '{}'::jsonb) where id = p_id;
    return pg_catalog.jsonb_build_object('estado', 'en_curso', 'cursor', p.cursor, 'total', v_total);
  else
    update panel.planes set estado = 'fallido', arriendo_token = null, arriendo_hasta = null, error = left(coalesce(p_error, ''), 500), terminado_at = pg_catalog.now() where id = p_id;
    delete from panel.bloqueos where plan_id = p_id;
    return pg_catalog.jsonb_build_object('estado', 'fallido', 'cursor', p.cursor, 'total', v_total);
  end if;
end $$;

-- La contraseña inicial del dueño se puede ver mientras el plan está terminado, dentro de 60 minutos y sin acuse.
create or replace function public.panel_plan_clave_disponible(p_id uuid, p_sesion_hash text)
returns boolean language sql security definer set search_path = '' as $$
  select exists (select 1 from panel.planes p where p.id = p_id and p.sesion_hash = p_sesion_hash and p.tipo = 'crear'
    and p.estado = 'terminado' and not p.clave_entregada and p.terminado_at > pg_catalog.now() - interval '60 minutes');
$$;

create or replace function public.panel_plan_clave_acusar(p_id uuid, p_sesion_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update panel.planes set clave_entregada = true where id = p_id and sesion_hash = p_sesion_hash and tipo = 'crear' and estado = 'terminado';
  return found;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Permisos: ninguna función es pública; solo el usuario de la aplicación (panel_app)
-- ---------------------------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as firma from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'panel\_%' loop
    execute format('revoke all on function %s from public', f.firma);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.firma); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f.firma); end if;
    if exists (select 1 from pg_roles where rolname = 'panel_app') then execute format('grant execute on function %s to panel_app', f.firma); end if;
  end loop;
  revoke all on schema panel from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on schema panel from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on schema panel from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'panel_app') then revoke all on schema panel from panel_app; grant usage on schema public to panel_app; end if;
  revoke all on all tables in schema panel from public;
end $$;
