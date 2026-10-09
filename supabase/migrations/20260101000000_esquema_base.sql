-- Esquema base de la plantilla (sin datos de ninguna empresa).
-- Generado a partir de una instalación real y verificado contra ella.
-- Las mejoras propias de la plantilla van en las migraciones siguientes.
set check_function_bodies = off;
set search_path = public;


-- ======================================================================
-- Extensiones
-- ======================================================================

create extension if not exists pg_trgm with schema public;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- ======================================================================
-- Tablas
-- ======================================================================

create table public."audit_log" (
  "id" bigint generated always as identity not null,
  "tabla" text not null,
  "registro_id" text not null,
  "descripcion" text,
  "accion" text not null,
  "usuario_id" uuid,
  "usuario_nombre" text,
  "usuario_email" text,
  "datos_anteriores" jsonb,
  "datos_nuevos" jsonb,
  "created_at" timestamp with time zone default now() not null
);
create table public."comisionistas" (
  "id" uuid default gen_random_uuid() not null,
  "nombre" text not null,
  "zona" text,
  "empresa" text,
  "telefono" text,
  "celular" text,
  "email" text,
  "localidad" text,
  "provincia" text,
  "notas" text,
  "activo" boolean default true,
  "campos_extra" jsonb default '{}'::jsonb,
  "modificado_por" text,
  "updated_at" timestamp with time zone default now()
);
create table public."configuracion" (
  "id" integer default 1 not null,
  "empresa_nombre" text default 'Mi Empresa'::text,
  "empresa_direccion" text,
  "empresa_telefono" text,
  "empresa_email" text,
  "rotulo_pie" text,
  "rotulo_campos" jsonb default '{"horario": true, "telefono": true, "direccion": true}'::jsonb,
  "logo_base64" text default ''::text,
  "rotulo_design" jsonb default '{}'::jsonb,
  "comisionistas_campos_custom" jsonb default '[]'::jsonb,
  "rotulo_diseno_id" bigint
);
create table public."contactos" (
  "id" uuid default gen_random_uuid() not null,
  "proveedor_id" uuid,
  "nombre" text not null,
  "cargo" text,
  "telefono" text,
  "celular" text,
  "email" text,
  "created_at" timestamp with time zone default now()
);
create table public."equipo_items" (
  "equipo_id" uuid not null,
  "item_id" uuid not null
);
create table public."equipos" (
  "id" uuid default gen_random_uuid() not null,
  "sector" text not null,
  "nombre" text not null,
  "datos_tecnicos" text,
  "manual_url" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."error_logs" (
  "id" uuid default gen_random_uuid() not null,
  "created_at" timestamp with time zone default now() not null,
  "usuario_id" uuid,
  "usuario_email" text,
  "mensaje" text not null,
  "stack" text,
  "pantalla" text,
  "url" text,
  "user_agent" text
);
create table public."familias" (
  "id" uuid default gen_random_uuid() not null,
  "codigo" text not null,
  "nombre" text not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."item_proveedores" (
  "id" uuid default gen_random_uuid() not null,
  "item_id" uuid not null,
  "proveedor_id" uuid not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."items" (
  "id" uuid default gen_random_uuid() not null,
  "codigo" text not null,
  "numero" text not null,
  "descripcion" text not null,
  "familia_id" uuid not null,
  "subfamilia_id" uuid not null,
  "ubicacion" text,
  "stock" numeric,
  "foto_url" text,
  "activo" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "eliminado_por" uuid,
  "eliminado_at" timestamp with time zone,
  "detalles" text,
  "foto_url_2" text,
  "foto_pendiente" boolean default false not null,
  "foto_pendiente_2" boolean default false not null,
  "foto_subida_por" uuid,
  "foto_subida_por_2" uuid,
  "foto_subida_at" timestamp with time zone,
  "foto_subida_at_2" timestamp with time zone,
  "foto_url_3" text,
  "foto_pendiente_3" boolean default false not null,
  "foto_subida_por_3" uuid,
  "foto_subida_at_3" timestamp with time zone,
  "stock_minimo" numeric default 0 not null,
  "punto_pedido" numeric default 0 not null,
  "estado_reposicion" text,
  "estado_reposicion_at" timestamp with time zone
);
create table public."planilla_familias" (
  "id" boolean default true not null,
  "storage_path" text not null,
  "nombre_archivo" text not null,
  "actualizada_por" uuid,
  "actualizada_at" timestamp with time zone default now() not null
);
create table public."proveedores" (
  "id" uuid default gen_random_uuid() not null,
  "nombre" text not null,
  "rubro" text,
  "email" text,
  "direccion" text,
  "localidad" text,
  "provincia" text,
  "horario" text,
  "notas" text,
  "activo" boolean default true,
  "modificado_por" text,
  "updated_at" timestamp with time zone default now(),
  "created_at" timestamp with time zone default now(),
  "codigo_postal" text default ''::text,
  "eliminado" boolean default false not null,
  "eliminado_por" uuid,
  "eliminado_at" timestamp with time zone
);
create table public."reparacion_entregas" (
  "id" uuid default gen_random_uuid() not null,
  "reparacion_item_id" uuid not null,
  "cantidad_devuelta" numeric not null,
  "resultado" text not null,
  "remito_punto_venta" text,
  "remito_numero" text,
  "remito_fecha" date,
  "fecha_entrega" date not null,
  "registrado_por" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "repone_stock" boolean default true not null
);
create table public."reparacion_items" (
  "id" uuid default gen_random_uuid() not null,
  "reparacion_id" uuid not null,
  "item_id" uuid not null,
  "cantidad" numeric not null,
  "descuenta_stock" boolean default true not null
);
create table public."reparaciones" (
  "id" uuid default gen_random_uuid() not null,
  "proveedor_id" uuid not null,
  "motivo" text not null,
  "fecha_salida" date not null,
  "responsable_id" uuid not null,
  "envio_id" uuid,
  "orden_compra_numero" text,
  "orden_compra_fecha" date,
  "activo" boolean default true not null,
  "eliminado_por" uuid,
  "eliminado_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null
);
create table public."retiro_items" (
  "id" uuid default gen_random_uuid() not null,
  "retiro_id" uuid not null,
  "item_id" uuid not null,
  "cantidad" numeric default 1 not null,
  "observacion" text
);
create table public."retiros" (
  "id" uuid default gen_random_uuid() not null,
  "usuario_id" uuid not null,
  "observacion_general" text,
  "created_at" timestamp with time zone default now() not null,
  "exportado" boolean default false not null,
  "sector_id" uuid not null
);
create table public."rotulo_disenos" (
  "id" bigint generated always as identity not null,
  "nombre" text not null,
  "design" jsonb not null,
  "pie" text,
  "campos" jsonb,
  "created_at" timestamp with time zone default now() not null
);
create table public."rotulos_bultos" (
  "id" uuid default gen_random_uuid() not null,
  "rotulo_id" uuid not null,
  "numero" integer not null,
  "detalle" text,
  "storage_path" text,
  "created_at" timestamp with time zone default now() not null
);
create table public."rotulos_fotos" (
  "id" uuid default gen_random_uuid() not null,
  "grupo_id" uuid not null,
  "proveedor_id" uuid not null,
  "storage_path" text not null,
  "creado_por" uuid,
  "created_at" timestamp with time zone default now() not null
);
create table public."rotulos_generados" (
  "id" uuid default gen_random_uuid() not null,
  "proveedor_id" uuid not null,
  "tipo_documento" text,
  "numero_documento" text,
  "bulto_actual" integer,
  "bulto_total" integer,
  "storage_path" text,
  "creado_por" uuid,
  "created_at" timestamp with time zone default now() not null,
  "grupo_id" uuid not null,
  "version" integer default 1 not null,
  "vigente" boolean default true not null,
  "motivo_edicion" text,
  "detalle" text,
  "extra" text,
  "ancho_mm" numeric,
  "alto_mm" numeric,
  "valor_declarado" text,
  "comisionista_id" uuid,
  "design_snapshot" jsonb,
  "eliminado" boolean default false not null,
  "eliminado_por" uuid,
  "eliminado_at" timestamp with time zone,
  "comentario" text
);
create table public."sectores" (
  "id" uuid default gen_random_uuid() not null,
  "nombre" text not null,
  "activo" boolean default true not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."subfamilias" (
  "id" uuid default gen_random_uuid() not null,
  "familia_id" uuid not null,
  "codigo" text not null,
  "nombre" text not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."sugerencias" (
  "id" uuid default gen_random_uuid() not null,
  "usuario_id" uuid,
  "mensaje" text not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."task_history" (
  "id" uuid default gen_random_uuid() not null,
  "task_id" uuid not null,
  "user_id" uuid not null,
  "action" text not null,
  "note" text default ''::text,
  "created_at" timestamp with time zone default now() not null
);
create table public."tasks" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "title" text not null,
  "description" text default ''::text,
  "status" text default 'pending'::text not null,
  "traffic_level" text default 'green'::text not null,
  "start_date" date default CURRENT_DATE not null,
  "assigned_date" date default CURRENT_DATE not null,
  "completed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "pending_days" integer default 0 not null,
  "carry_count" integer default 0 not null,
  "is_stagnant" boolean default false not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."usuarios_perfil" (
  "id" uuid not null,
  "nombre" text,
  "apellido" text,
  "email" text,
  "rol" text default 'user'::text,
  "activo" boolean default true,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "last_login_at" timestamp with time zone,
  "access_status" text default 'active'::text not null,
  "access_expires_at" timestamp with time zone,
  "mantenimiento_rol" text,
  "puede_ver_retiros" boolean default false not null,
  "puede_ver_errores" boolean default false not null,
  "puede_resetear_contrasenas" boolean default false not null,
  "puede_ver_sugerencias" boolean default false not null,
  "es_owner" boolean default false not null
);

-- ======================================================================
-- Restricciones (claves, únicos, chequeos y relaciones)
-- ======================================================================

alter table only public."audit_log" add constraint "audit_log_pkey" PRIMARY KEY (id);
alter table only public."comisionistas" add constraint "comisionistas_pkey" PRIMARY KEY (id);
alter table only public."configuracion" add constraint "configuracion_pkey" PRIMARY KEY (id);
alter table only public."contactos" add constraint "contactos_pkey" PRIMARY KEY (id);
alter table only public."equipo_items" add constraint "equipo_items_pkey" PRIMARY KEY (equipo_id, item_id);
alter table only public."equipos" add constraint "equipos_pkey" PRIMARY KEY (id);
alter table only public."error_logs" add constraint "error_logs_pkey" PRIMARY KEY (id);
alter table only public."familias" add constraint "familias_pkey" PRIMARY KEY (id);
alter table only public."item_proveedores" add constraint "item_proveedores_pkey" PRIMARY KEY (id);
alter table only public."items" add constraint "items_pkey" PRIMARY KEY (id);
alter table only public."planilla_familias" add constraint "planilla_familias_pkey" PRIMARY KEY (id);
alter table only public."proveedores" add constraint "proveedores_pkey" PRIMARY KEY (id);
alter table only public."reparacion_entregas" add constraint "reparacion_entregas_pkey" PRIMARY KEY (id);
alter table only public."reparacion_items" add constraint "reparacion_items_pkey" PRIMARY KEY (id);
alter table only public."reparaciones" add constraint "reparaciones_pkey" PRIMARY KEY (id);
alter table only public."retiro_items" add constraint "retiro_items_pkey" PRIMARY KEY (id);
alter table only public."retiros" add constraint "retiros_pkey" PRIMARY KEY (id);
alter table only public."rotulo_disenos" add constraint "rotulo_disenos_pkey" PRIMARY KEY (id);
alter table only public."rotulos_bultos" add constraint "rotulos_bultos_pkey" PRIMARY KEY (id);
alter table only public."rotulos_fotos" add constraint "rotulos_fotos_pkey" PRIMARY KEY (id);
alter table only public."rotulos_generados" add constraint "rotulos_generados_pkey" PRIMARY KEY (id);
alter table only public."sectores" add constraint "sectores_pkey" PRIMARY KEY (id);
alter table only public."subfamilias" add constraint "subfamilias_pkey" PRIMARY KEY (id);
alter table only public."sugerencias" add constraint "sugerencias_pkey" PRIMARY KEY (id);
alter table only public."task_history" add constraint "task_history_pkey" PRIMARY KEY (id);
alter table only public."tasks" add constraint "tasks_pkey" PRIMARY KEY (id);
alter table only public."usuarios_perfil" add constraint "usuarios_perfil_pkey" PRIMARY KEY (id);
alter table only public."familias" add constraint "familias_codigo_key" UNIQUE (codigo);
alter table only public."item_proveedores" add constraint "item_proveedores_item_id_proveedor_id_key" UNIQUE (item_id, proveedor_id);
alter table only public."items" add constraint "items_codigo_key" UNIQUE (codigo);
alter table only public."sectores" add constraint "sectores_nombre_key" UNIQUE (nombre);
alter table only public."subfamilias" add constraint "subfamilias_familia_id_codigo_key" UNIQUE (familia_id, codigo);
alter table only public."audit_log" add constraint "audit_log_accion_check" CHECK ((accion = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text])));
alter table only public."familias" add constraint "familias_codigo_check" CHECK (((char_length(codigo) = 2) AND (codigo = upper(codigo))));
alter table only public."items" add constraint "items_estado_reposicion_check" CHECK ((estado_reposicion = ANY (ARRAY['presupuesto'::text, 'compras'::text])));
alter table only public."items" add constraint "items_punto_pedido_check" CHECK ((punto_pedido >= (0)::numeric));
alter table only public."items" add constraint "items_stock_minimo_check" CHECK ((stock_minimo >= (0)::numeric));
alter table only public."planilla_familias" add constraint "solo_una_fila" CHECK ((id = true));
alter table only public."reparacion_entregas" add constraint "reparacion_entregas_cantidad_devuelta_check" CHECK ((cantidad_devuelta > (0)::numeric));
alter table only public."reparacion_entregas" add constraint "reparacion_entregas_resultado_check" CHECK ((resultado = ANY (ARRAY['reparado'::text, 'baja'::text])));
alter table only public."reparacion_items" add constraint "reparacion_items_cantidad_check" CHECK ((cantidad > (0)::numeric));
alter table only public."subfamilias" add constraint "subfamilias_codigo_check" CHECK (((char_length(codigo) = 2) AND (codigo = upper(codigo))));
alter table only public."task_history" add constraint "task_history_action_check" CHECK ((action = ANY (ARRAY['created'::text, 'edited'::text, 'completed'::text, 'cancelled'::text, 'carried'::text, 'reprogrammed'::text, 'traffic_changed'::text, 'stagnant_detected'::text])));
alter table only public."task_history" add constraint "task_history_note_check" CHECK ((char_length(note) <= 1000));
alter table only public."tasks" add constraint "tasks_carry_count_check" CHECK ((carry_count >= 0));
alter table only public."tasks" add constraint "tasks_description_check" CHECK ((char_length(description) <= 5000));
alter table only public."tasks" add constraint "tasks_pending_days_check" CHECK ((pending_days >= 0));
alter table only public."tasks" add constraint "tasks_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'cancelled'::text])));
alter table only public."tasks" add constraint "tasks_title_check" CHECK (((char_length(title) > 0) AND (char_length(title) <= 500)));
alter table only public."tasks" add constraint "tasks_traffic_level_check" CHECK ((traffic_level = ANY (ARRAY['green'::text, 'yellow'::text, 'red'::text])));
alter table only public."usuarios_perfil" add constraint "chk_no_sin_acceso_a_ambos" CHECK ((NOT ((rol = 'disabled'::text) AND (mantenimiento_rol IS NULL))));
alter table only public."usuarios_perfil" add constraint "usuarios_perfil_access_status_check" CHECK ((access_status = ANY (ARRAY['active'::text, 'blocked'::text, 'trial'::text, 'expired'::text])));
alter table only public."usuarios_perfil" add constraint "usuarios_perfil_mantenimiento_rol_check" CHECK ((mantenimiento_rol = ANY (ARRAY['comun'::text, 'admin'::text])));
alter table only public."configuracion" add constraint "configuracion_rotulo_diseno_id_fkey" FOREIGN KEY (rotulo_diseno_id) REFERENCES rotulo_disenos(id) ON DELETE SET NULL;
alter table only public."contactos" add constraint "contactos_proveedor_id_fkey" FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE;
alter table only public."equipo_items" add constraint "equipo_items_equipo_id_fkey" FOREIGN KEY (equipo_id) REFERENCES equipos(id) ON DELETE CASCADE;
alter table only public."equipo_items" add constraint "equipo_items_item_id_fkey" FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;
alter table only public."error_logs" add constraint "error_logs_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios_perfil(id);
alter table only public."item_proveedores" add constraint "item_proveedores_item_id_fkey" FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;
alter table only public."item_proveedores" add constraint "item_proveedores_proveedor_id_fkey" FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE;
alter table only public."items" add constraint "items_eliminado_por_fkey" FOREIGN KEY (eliminado_por) REFERENCES usuarios_perfil(id);
alter table only public."items" add constraint "items_familia_id_fkey" FOREIGN KEY (familia_id) REFERENCES familias(id) ON DELETE RESTRICT;
alter table only public."items" add constraint "items_foto_subida_por_2_fkey" FOREIGN KEY (foto_subida_por_2) REFERENCES usuarios_perfil(id);
alter table only public."items" add constraint "items_foto_subida_por_3_fkey" FOREIGN KEY (foto_subida_por_3) REFERENCES usuarios_perfil(id);
alter table only public."items" add constraint "items_foto_subida_por_fkey" FOREIGN KEY (foto_subida_por) REFERENCES usuarios_perfil(id);
alter table only public."items" add constraint "items_subfamilia_id_fkey" FOREIGN KEY (subfamilia_id) REFERENCES subfamilias(id) ON DELETE RESTRICT;
alter table only public."planilla_familias" add constraint "planilla_familias_actualizada_por_fkey" FOREIGN KEY (actualizada_por) REFERENCES usuarios_perfil(id);
alter table only public."proveedores" add constraint "proveedores_eliminado_por_fkey" FOREIGN KEY (eliminado_por) REFERENCES usuarios_perfil(id);
alter table only public."reparacion_entregas" add constraint "reparacion_entregas_registrado_por_fkey" FOREIGN KEY (registrado_por) REFERENCES usuarios_perfil(id);
alter table only public."reparacion_entregas" add constraint "reparacion_entregas_reparacion_item_id_fkey" FOREIGN KEY (reparacion_item_id) REFERENCES reparacion_items(id) ON DELETE CASCADE;
alter table only public."reparacion_items" add constraint "reparacion_items_item_id_fkey" FOREIGN KEY (item_id) REFERENCES items(id);
alter table only public."reparacion_items" add constraint "reparacion_items_reparacion_id_fkey" FOREIGN KEY (reparacion_id) REFERENCES reparaciones(id) ON DELETE CASCADE;
alter table only public."reparaciones" add constraint "reparaciones_eliminado_por_fkey" FOREIGN KEY (eliminado_por) REFERENCES usuarios_perfil(id);
alter table only public."reparaciones" add constraint "reparaciones_envio_id_fkey" FOREIGN KEY (envio_id) REFERENCES rotulos_generados(id);
alter table only public."reparaciones" add constraint "reparaciones_proveedor_id_fkey" FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
alter table only public."reparaciones" add constraint "reparaciones_responsable_id_fkey" FOREIGN KEY (responsable_id) REFERENCES usuarios_perfil(id);
alter table only public."retiro_items" add constraint "retiro_items_item_id_fkey" FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT;
alter table only public."retiro_items" add constraint "retiro_items_retiro_id_fkey" FOREIGN KEY (retiro_id) REFERENCES retiros(id) ON DELETE CASCADE;
alter table only public."retiros" add constraint "retiros_sector_id_fkey" FOREIGN KEY (sector_id) REFERENCES sectores(id);
alter table only public."retiros" add constraint "retiros_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES auth.users(id);
alter table only public."rotulos_bultos" add constraint "rotulos_bultos_rotulo_id_fkey" FOREIGN KEY (rotulo_id) REFERENCES rotulos_generados(id) ON DELETE CASCADE;
alter table only public."rotulos_fotos" add constraint "rotulos_fotos_creado_por_fkey" FOREIGN KEY (creado_por) REFERENCES usuarios_perfil(id);
alter table only public."rotulos_fotos" add constraint "rotulos_fotos_proveedor_id_fkey" FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE;
alter table only public."rotulos_generados" add constraint "rotulos_generados_comisionista_id_fkey" FOREIGN KEY (comisionista_id) REFERENCES comisionistas(id);
alter table only public."rotulos_generados" add constraint "rotulos_generados_creado_por_fkey" FOREIGN KEY (creado_por) REFERENCES usuarios_perfil(id);
alter table only public."rotulos_generados" add constraint "rotulos_generados_eliminado_por_fkey" FOREIGN KEY (eliminado_por) REFERENCES usuarios_perfil(id);
alter table only public."rotulos_generados" add constraint "rotulos_generados_proveedor_id_fkey" FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE;
alter table only public."subfamilias" add constraint "subfamilias_familia_id_fkey" FOREIGN KEY (familia_id) REFERENCES familias(id) ON DELETE RESTRICT;
alter table only public."sugerencias" add constraint "sugerencias_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios_perfil(id);
alter table only public."task_history" add constraint "task_history_task_id_fkey" FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table only public."task_history" add constraint "task_history_user_id_fkey" FOREIGN KEY (user_id) REFERENCES usuarios_perfil(id) ON DELETE CASCADE;
alter table only public."tasks" add constraint "tasks_user_id_fkey" FOREIGN KEY (user_id) REFERENCES usuarios_perfil(id) ON DELETE CASCADE;

-- ======================================================================
-- Índices
-- ======================================================================

CREATE INDEX item_proveedores_item_idx ON public.item_proveedores USING btree (item_id);
CREATE INDEX item_proveedores_proveedor_idx ON public.item_proveedores USING btree (proveedor_id);
CREATE INDEX items_codigo_trgm_idx ON public.items USING gin (codigo gin_trgm_ops);
CREATE INDEX items_descripcion_trgm_idx ON public.items USING gin (descripcion gin_trgm_ops);
CREATE INDEX items_numero_idx ON public.items USING btree (numero);
CREATE INDEX idx_task_history_task_id ON public.task_history USING btree (task_id);
CREATE INDEX idx_tasks_user_assigned ON public.tasks USING btree (user_id, assigned_date);
CREATE INDEX idx_tasks_user_id ON public.tasks USING btree (user_id);
CREATE INDEX idx_tasks_user_status ON public.tasks USING btree (user_id, status);

-- ======================================================================
-- Funciones
-- ======================================================================

CREATE OR REPLACE FUNCTION public._aud_actor(OUT p_nombre text, OUT p_email text)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  select nullif(trim(coalesce(nombre, '') || ' ' || coalesce(apellido, '')), ''), email
    into p_nombre, p_email
  from usuarios_perfil where id = auth.uid();
end;
$function$;

CREATE OR REPLACE FUNCTION public._aud_cambio(etiqueta text, anterior text, nuevo text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when anterior is distinct from nuevo
    then etiqueta || ' ' || coalesce(nullif(left(anterior, 60), ''), '—') || ' → ' || coalesce(nullif(left(nuevo, 60), ''), '—')
  end;
$function$;

CREATE OR REPLACE FUNCTION public.agregar_dueno(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_owner() then
    raise exception 'Solo un dueño puede agregar a otro dueño.';
  end if;
  if not exists (select 1 from usuarios_perfil where id = p_id) then
    raise exception 'Ese usuario no existe.';
  end if;
  if exists (select 1 from usuarios_perfil where id = p_id and activo is not true) then
    raise exception 'No se puede agregar como dueño a un usuario bloqueado.';
  end if;
  update usuarios_perfil set es_owner = true where id = p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ajustar_stock_por_retiro_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    update items set stock = coalesce(stock, 0) - new.cantidad where id = new.item_id;
  elsif tg_op = 'UPDATE' then
    update items set stock = coalesce(stock, 0) + old.cantidad - new.cantidad where id = new.item_id;
  elsif tg_op = 'DELETE' then
    update items set stock = coalesce(stock, 0) + old.cantidad where id = old.item_id;
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.can_view_all_retiros()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM usuarios_perfil
    WHERE id = auth.uid() AND puede_ver_retiros = true
  ) OR is_owner();
$function$;

CREATE OR REPLACE FUNCTION public.can_view_errores()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM usuarios_perfil
    WHERE id = auth.uid() AND puede_ver_errores = true
  ) OR is_owner();
$function$;

CREATE OR REPLACE FUNCTION public.can_view_papelera()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM usuarios_perfil
    WHERE id = auth.uid() AND puede_ver_papelera = true
  ) OR is_owner();
$function$;

CREATE OR REPLACE FUNCTION public.can_view_sugerencias()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from usuarios_perfil
    where id = auth.uid() and puede_ver_sugerencias = true
  ) or is_owner();
$function$;

CREATE OR REPLACE FUNCTION public.cancel_task(p_task_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  task_owner UUID;
BEGIN
  SELECT user_id INTO task_owner
  FROM public.tasks
  WHERE id = p_task_id AND status = 'pending';

  IF task_owner IS NULL THEN
    RAISE EXCEPTION 'Tarea no encontrada o no está pendiente';
  END IF;

  IF task_owner != auth.uid() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF NOT public.has_active_access(auth.uid()) THEN
    RAISE EXCEPTION 'Acceso deshabilitado';
  END IF;

  UPDATE public.tasks
  SET
    status = 'cancelled',
    cancelled_at = now(),
    completed_at = NULL
  WHERE id = p_task_id;

  INSERT INTO public.task_history (task_id, user_id, action, note)
  VALUES (p_task_id, auth.uid(), 'cancelled', 'Tarea cancelada');
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_task(p_task_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  task_owner UUID;
BEGIN
  SELECT user_id INTO task_owner
  FROM public.tasks
  WHERE id = p_task_id AND status = 'pending';

  IF task_owner IS NULL THEN
    RAISE EXCEPTION 'Tarea no encontrada o no está pendiente';
  END IF;

  IF task_owner != auth.uid() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF NOT public.has_active_access(auth.uid()) THEN
    RAISE EXCEPTION 'Acceso deshabilitado';
  END IF;

  UPDATE public.tasks
  SET
    status = 'completed',
    completed_at = now(),
    cancelled_at = NULL
  WHERE id = p_task_id;

  INSERT INTO public.task_history (task_id, user_id, action, note)
  VALUES (p_task_id, auth.uid(), 'completed', 'Tarea completada');
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_reparacion(p_proveedor_id uuid, p_motivo text, p_fecha_salida date, p_envio_id uuid, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reparacion_id uuid;
  v_item jsonb;
begin
  if not is_mantenimiento_admin() then
    raise exception 'No autorizado';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un artículo';
  end if;

  insert into reparaciones (proveedor_id, motivo, fecha_salida, responsable_id, envio_id)
  values (p_proveedor_id, p_motivo, p_fecha_salida, auth.uid(), p_envio_id)
  returning id into v_reparacion_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into reparacion_items (reparacion_id, item_id, cantidad, descuenta_stock)
    values (v_reparacion_id, (v_item->>'item_id')::uuid, (v_item->>'cantidad')::numeric, coalesce((v_item->>'descuenta_stock')::boolean, true));
  end loop;

  return v_reparacion_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_task(p_title text, p_description text DEFAULT ''::text, p_traffic_level text DEFAULT 'green'::text, p_assigned_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_task_id UUID;
  final_assigned_date DATE;
BEGIN
  IF NOT public.has_active_access(auth.uid()) THEN
    RAISE EXCEPTION 'Acceso deshabilitado';
  END IF;

  IF p_title IS NULL OR char_length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION 'El título no puede estar vacío';
  END IF;

  IF p_traffic_level NOT IN ('green', 'yellow', 'red') THEN
    RAISE EXCEPTION 'Nivel de semáforo inválido: %', p_traffic_level;
  END IF;

  IF p_assigned_date IS NOT NULL AND p_assigned_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'La fecha asignada no puede ser anterior a hoy';
  END IF;

  final_assigned_date := COALESCE(p_assigned_date, CURRENT_DATE);

  INSERT INTO public.tasks (
    user_id, title, description, status, traffic_level,
    start_date, assigned_date, pending_days, carry_count, is_stagnant
  )
  VALUES (
    auth.uid(), trim(p_title), COALESCE(p_description, ''), 'pending', p_traffic_level,
    CURRENT_DATE, final_assigned_date, 0, 0, false
  )
  RETURNING id INTO new_task_id;

  INSERT INTO public.task_history (task_id, user_id, action, note)
  VALUES (new_task_id, auth.uid(), 'created', 'Tarea creada');

  RETURN new_task_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.eliminar_reparacion(p_reparacion_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_linea record;
  v_pendiente numeric;
begin
  if not is_mantenimiento_admin() then
    raise exception 'No autorizado';
  end if;

  for v_linea in select id, item_id from reparacion_items where reparacion_id = p_reparacion_id and descuenta_stock loop
    v_pendiente := reparacion_item_pendiente(v_linea.id);
    if v_pendiente > 0 then
      update items set stock = coalesce(stock, 0) + v_pendiente where id = v_linea.item_id;
    end if;
  end loop;

  update reparaciones set activo = false, eliminado_por = auth.uid(), eliminado_at = now() where id = p_reparacion_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.evitar_borrar_dueno()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.es_owner then
    raise exception 'No se puede eliminar a un dueño del sistema. Quitale primero el cargo de dueño.';
  end if;
  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION public.evitar_sin_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (select count(*) from usuarios_perfil where es_owner = true) = 0 then
    raise exception 'El sistema debe tener siempre un dueño — asigná uno antes de sacar el actual.';
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_audit_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_perfil record;
  v_desc text;
begin
  select nombre, apellido, email into v_perfil from usuarios_perfil where id = auth.uid();

  v_desc := case when tg_op = 'DELETE' then old.nombre else new.nombre end;

  insert into audit_log (tabla, registro_id, descripcion, accion, usuario_id, usuario_nombre, usuario_email, datos_anteriores, datos_nuevos)
  values (
    tg_table_name,
    (case when tg_op = 'DELETE' then old.id else new.id end)::text,
    v_desc,
    lower(tg_op),
    auth.uid(),
    nullif(trim(coalesce(v_perfil.nombre,'') || ' ' || coalesce(v_perfil.apellido,'')), ''),
    v_perfil.email,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );

  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_audit_log_items()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor record;
  v_row record;
  v_desc text;
  v_cambios text;
begin
  select * into v_actor from _aud_actor();
  v_row := coalesce(new, old);
  v_desc := concat(v_row.codigo, ' — ', left(coalesce(v_row.descripcion, ''), 60));

  if tg_op = 'UPDATE' then
    v_cambios := concat_ws('; ',
      _aud_cambio('código', old.codigo, new.codigo),
      _aud_cambio('número', old.numero::text, new.numero::text),
      _aud_cambio('descripción', old.descripcion, new.descripcion),
      _aud_cambio('familia', (select nombre from familias where id = old.familia_id), (select nombre from familias where id = new.familia_id)),
      _aud_cambio('subfamilia', (select nombre from subfamilias where id = old.subfamilia_id), (select nombre from subfamilias where id = new.subfamilia_id)),
      _aud_cambio('ubicación', old.ubicacion, new.ubicacion),
      _aud_cambio('stock', old.stock::text, new.stock::text),
      case when old.detalles is distinct from new.detalles then 'detalles modificados' end,
      _aud_cambio('stock mínimo', old.stock_minimo::text, new.stock_minimo::text),
      _aud_cambio('punto de pedido', old.punto_pedido::text, new.punto_pedido::text),
      case when old.activo is distinct from new.activo
        then case when new.activo then 'restaurado desde la papelera' else 'enviado a la papelera' end end
    );
    v_desc := concat(v_desc, ' · ', v_cambios);
  end if;

  insert into audit_log (tabla, registro_id, descripcion, accion, usuario_id, usuario_nombre, usuario_email, datos_anteriores, datos_nuevos)
  values (
    'items',
    v_row.id::text,
    v_desc,
    lower(tg_op),
    auth.uid(),
    v_actor.p_nombre,
    v_actor.p_email,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );

  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_audit_log_reparaciones()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_perfil record;
  v_desc text;
  v_row record;
begin
  select nombre, apellido, email into v_perfil from usuarios_perfil where id = auth.uid();
  v_row := coalesce(new, old);

  if tg_table_name = 'reparaciones' then
    v_desc := (case when tg_op = 'DELETE' then old.motivo else new.motivo end);
  elsif tg_table_name = 'reparacion_items' then
    select concat(codigo, ' x', v_row.cantidad) into v_desc from items where id = v_row.item_id;
  elsif tg_table_name = 'reparacion_entregas' then
    v_desc := concat('Entrega ', v_row.resultado, ' — ', v_row.cantidad_devuelta, ' unidad(es)');
  end if;

  insert into audit_log (tabla, registro_id, descripcion, accion, usuario_id, usuario_nombre, usuario_email, datos_anteriores, datos_nuevos)
  values (
    tg_table_name,
    v_row.id::text,
    v_desc,
    lower(tg_op),
    auth.uid(),
    nullif(trim(coalesce(v_perfil.nombre, '') || ' ' || coalesce(v_perfil.apellido, '')), ''),
    v_perfil.email,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_audit_log_retiro_items()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_perfil record;
  v_dueno record;
  v_codigo text;
begin
  select nombre, apellido, email into v_perfil from usuarios_perfil where id = auth.uid();

  select codigo into v_codigo from items where id = old.item_id;

  select p.nombre, p.apellido into v_dueno
  from retiros r join usuarios_perfil p on p.id = r.usuario_id
  where r.id = old.retiro_id;

  insert into audit_log (tabla, registro_id, descripcion, accion, usuario_id, usuario_nombre, usuario_email, datos_anteriores, datos_nuevos)
  values (
    'retiro_items',
    old.id::text,
    concat(
      coalesce(v_codigo, 'Repuesto'), ' x', old.cantidad,
      case when tg_op = 'UPDATE' then concat(' → x', new.cantidad) else '' end,
      case when v_dueno.nombre is not null
        then concat(' — retiro de ', trim(concat(v_dueno.nombre, ' ', coalesce(v_dueno.apellido, ''))))
        else '' end
    ),
    lower(tg_op),
    auth.uid(),
    nullif(trim(coalesce(v_perfil.nombre, '') || ' ' || coalesce(v_perfil.apellido, '')), ''),
    v_perfil.email,
    to_jsonb(old),
    case when tg_op = 'UPDATE' then to_jsonb(new) else null end
  );

  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_audit_log_usuarios()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor record;
  v_row record;
  v_desc text;
  v_cambios text;
  v_nombre text;
begin
  select * into v_actor from _aud_actor();
  v_row := coalesce(new, old);
  v_nombre := coalesce(nullif(trim(concat(v_row.nombre, ' ', v_row.apellido)), ''), v_row.email);
  v_desc := concat(v_nombre, ' (', v_row.email, ')');

  if tg_op = 'UPDATE' then
    v_cambios := concat_ws('; ',
      _aud_cambio('nombre', nullif(trim(concat(old.nombre, ' ', old.apellido)), ''), nullif(trim(concat(new.nombre, ' ', new.apellido)), '')),
      _aud_cambio('rol en Directorio',
        case old.rol when 'admin' then 'Administrador' when 'user' then 'Usuario' when 'disabled' then 'Desactivado' else old.rol end,
        case new.rol when 'admin' then 'Administrador' when 'user' then 'Usuario' when 'disabled' then 'Desactivado' else new.rol end),
      _aud_cambio('rol en Depósito',
        case old.mantenimiento_rol when 'admin' then 'Administrador' when 'comun' then 'Usuario' else 'Desactivado' end,
        case new.mantenimiento_rol when 'admin' then 'Administrador' when 'comun' then 'Usuario' else 'Desactivado' end),
      _aud_cambio('ver los retiros de todos', case when old.puede_ver_retiros then 'sí' else 'no' end, case when new.puede_ver_retiros then 'sí' else 'no' end),
      _aud_cambio('ver el log de errores', case when old.puede_ver_errores then 'sí' else 'no' end, case when new.puede_ver_errores then 'sí' else 'no' end),
      _aud_cambio('resetear contraseñas', case when old.puede_resetear_contrasenas then 'sí' else 'no' end, case when new.puede_resetear_contrasenas then 'sí' else 'no' end),
      _aud_cambio('ver sugerencias', case when old.puede_ver_sugerencias then 'sí' else 'no' end, case when new.puede_ver_sugerencias then 'sí' else 'no' end),
      case when old.activo is distinct from new.activo then case when new.activo then 'desbloqueado' else 'bloqueado' end end,
      case when old.es_owner is distinct from new.es_owner then case when new.es_owner then 'pasa a ser dueño del sistema' else 'deja de ser dueño del sistema' end end
    );
    v_desc := concat(v_desc, ' · ', v_cambios);
  end if;

  insert into audit_log (tabla, registro_id, descripcion, accion, usuario_id, usuario_nombre, usuario_email, datos_anteriores, datos_nuevos)
  values (
    'usuarios_perfil',
    v_row.id::text,
    v_desc,
    lower(tg_op),
    auth.uid(),
    -- Las altas y bajas las ejecuta una función del servidor sin sesión de usuario.
    case when auth.uid() is null then 'Panel de usuarios' else v_actor.p_nombre end,
    v_actor.p_email,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );

  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_task_counts(target_user_id uuid)
 RETURNS TABLE(total bigint, pending bigint, completed bigint, cancelled bigint, stagnant bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    COUNT(*)::BIGINT AS total,
    COUNT(*) FILTER (WHERE status = 'pending')::BIGINT AS pending,
    COUNT(*) FILTER (WHERE status = 'completed')::BIGINT AS completed,
    COUNT(*) FILTER (WHERE status = 'cancelled')::BIGINT AS cancelled,
    COUNT(*) FILTER (WHERE is_stagnant = true AND status = 'pending')::BIGINT AS stagnant
  FROM public.tasks
  WHERE user_id = target_user_id
    AND (target_user_id = auth.uid() OR public.is_admin(auth.uid()));
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.usuarios_perfil (id, nombre, apellido, email, rol, activo, access_status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    '',
    COALESCE(NEW.email, ''),
    'user',
    true,
    'trial'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_active_access(user_uuid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios_perfil
    WHERE id = user_uuid
    AND access_status IN ('active', 'trial')
    AND (access_expires_at IS NULL OR access_expires_at > now())
  );
$function$;

CREATE OR REPLACE FUNCTION public.historial_retiros_por_item(p_item_id uuid)
 RETURNS TABLE(id uuid, cantidad numeric, observacion text, created_at timestamp with time zone, usuario_id uuid, sector text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select ri.id, ri.cantidad, ri.observacion, r.created_at, r.usuario_id, s.nombre as sector
  from retiro_items ri
  join retiros r on r.id = ri.retiro_id
  left join sectores s on s.id = r.sector_id
  where ri.item_id = p_item_id
    and exists (
      select 1 from usuarios_perfil up
      where up.id = auth.uid() and (up.mantenimiento_rol is not null or is_owner())
    )
  order by r.created_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.is_admin(user_uuid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from usuarios_perfil
    where id = user_uuid and rol = 'admin'
  ) or is_owner();
$function$;

CREATE OR REPLACE FUNCTION public.is_directorio_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM usuarios_perfil
    WHERE id = auth.uid() AND rol = 'admin'
  ) OR is_owner();
$function$;

CREATE OR REPLACE FUNCTION public.is_mantenimiento_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM usuarios_perfil
    WHERE id = auth.uid() AND mantenimiento_rol = 'admin'
  ) OR is_owner();
$function$;

CREATE OR REPLACE FUNCTION public.is_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select es_owner from usuarios_perfil where id = auth.uid()), false);
$function$;

CREATE OR REPLACE FUNCTION public.items_trg_estado_reposicion()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.estado_reposicion is null
     or new.stock_minimo <= 0
     or coalesce(new.stock, 0) > new.punto_pedido then
    new.estado_reposicion := null;
    new.estado_reposicion_at := null;
  elsif new.estado_reposicion is distinct from old.estado_reposicion then
    new.estado_reposicion_at := now();
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.items_trg_fotos_pendientes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin boolean := is_mantenimiento_admin();
begin
  if pg_trigger_depth() > 1 then
    return NEW;
  end if;

  if not v_admin then
    if (NEW.codigo, NEW.familia_id, NEW.subfamilia_id, NEW.numero, NEW.descripcion,
        NEW.ubicacion, NEW.stock, NEW.detalles, NEW.activo)
       is distinct from
       (OLD.codigo, OLD.familia_id, OLD.subfamilia_id, OLD.numero, OLD.descripcion,
        OLD.ubicacion, OLD.stock, OLD.detalles, OLD.activo)
    then
      raise exception 'No autorizado a modificar ese campo';
    end if;
    if NEW.foto_url is distinct from OLD.foto_url then
      if NEW.foto_url is null then raise exception 'No autorizado a eliminar la foto'; end if;
      NEW.foto_pendiente := true;
      NEW.foto_subida_por := auth.uid();
      NEW.foto_subida_at := now();
    end if;
    if NEW.foto_url_2 is distinct from OLD.foto_url_2 then
      if NEW.foto_url_2 is null then raise exception 'No autorizado a eliminar la foto'; end if;
      NEW.foto_pendiente_2 := true;
      NEW.foto_subida_por_2 := auth.uid();
      NEW.foto_subida_at_2 := now();
    end if;
    if NEW.foto_url_3 is distinct from OLD.foto_url_3 then
      if NEW.foto_url_3 is null then raise exception 'No autorizado a eliminar la foto'; end if;
      NEW.foto_pendiente_3 := true;
      NEW.foto_subida_por_3 := auth.uid();
      NEW.foto_subida_at_3 := now();
    end if;
  else
    if NEW.foto_url is distinct from OLD.foto_url then
      NEW.foto_pendiente := false;
      NEW.foto_subida_por := null;
      NEW.foto_subida_at := null;
    end if;
    if NEW.foto_url_2 is distinct from OLD.foto_url_2 then
      NEW.foto_pendiente_2 := false;
      NEW.foto_subida_por_2 := null;
      NEW.foto_subida_at_2 := null;
    end if;
    if NEW.foto_url_3 is distinct from OLD.foto_url_3 then
      NEW.foto_pendiente_3 := false;
      NEW.foto_subida_por_3 := null;
      NEW.foto_subida_at_3 := null;
    end if;
  end if;
  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.process_pending_tasks_for_user(target_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  task_row RECORD;
  new_pending_days INTEGER;
  new_traffic TEXT;
  old_traffic TEXT;
  new_carry INTEGER;
  new_stagnant BOOLEAN;
  processed_count INTEGER := 0;
BEGIN
  IF target_user_id != auth.uid() AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF NOT public.has_active_access(target_user_id) THEN
    RAISE EXCEPTION 'Acceso deshabilitado';
  END IF;

  FOR task_row IN
    SELECT id, start_date, traffic_level, carry_count, is_stagnant
    FROM public.tasks
    WHERE user_id = target_user_id
      AND status = 'pending'
      AND assigned_date < CURRENT_DATE
  LOOP
    old_traffic := task_row.traffic_level;
    new_pending_days := CURRENT_DATE - task_row.start_date;
    new_carry := task_row.carry_count + 1;

    IF new_pending_days <= 1 THEN
      new_traffic := 'green';
    ELSIF new_pending_days <= 3 THEN
      new_traffic := 'yellow';
    ELSE
      new_traffic := 'red';
    END IF;

    new_stagnant := (
      new_pending_days >= 5
      OR new_carry >= 3
      OR new_traffic = 'red'
    );

    UPDATE public.tasks
    SET
      assigned_date = CURRENT_DATE,
      pending_days = new_pending_days,
      carry_count = new_carry,
      traffic_level = new_traffic,
      is_stagnant = new_stagnant
    WHERE id = task_row.id;

    INSERT INTO public.task_history (task_id, user_id, action, note)
    VALUES (
      task_row.id,
      target_user_id,
      'carried',
      'Arrastrada al ' || CURRENT_DATE::TEXT || '. Días pendiente: ' || new_pending_days || '. Arrastres: ' || new_carry
    );

    IF new_traffic != old_traffic THEN
      INSERT INTO public.task_history (task_id, user_id, action, note)
      VALUES (
        task_row.id,
        target_user_id,
        'traffic_changed',
        'Semáforo cambió de ' || old_traffic || ' a ' || new_traffic
      );
    END IF;

    IF new_stagnant AND NOT task_row.is_stagnant THEN
      INSERT INTO public.task_history (task_id, user_id, action, note)
      VALUES (
        task_row.id,
        target_user_id,
        'stagnant_detected',
        'Tarea marcada como estancada. Días: ' || new_pending_days || ', arrastres: ' || new_carry || ', semáforo: ' || new_traffic
      );
    END IF;

    processed_count := processed_count + 1;
  END LOOP;

  RETURN processed_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.proteger_campos_privilegiados()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    return new;
  end if;

  if not is_owner() then
    if (new.rol, new.mantenimiento_rol, new.puede_ver_retiros, new.puede_ver_errores,
        new.puede_resetear_contrasenas, new.puede_ver_sugerencias, new.activo, new.es_owner,
        new.access_status, new.access_expires_at, new.email)
       is distinct from
       (old.rol, old.mantenimiento_rol, old.puede_ver_retiros, old.puede_ver_errores,
        old.puede_resetear_contrasenas, old.puede_ver_sugerencias, old.activo, old.es_owner,
        old.access_status, old.access_expires_at, old.email) then
      raise exception 'No tenés permiso para cambiar roles ni permisos.';
    end if;
  end if;

  -- A un dueño no se lo puede bloquear: primero hay que sacarle el cargo.
  if new.es_owner and new.activo is not true then
    raise exception 'No se puede bloquear a un dueño del sistema. Quitale primero el cargo de dueño.';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.quitar_dueno(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_owner() then
    raise exception 'Solo un dueño puede quitarle el cargo a otro dueño.';
  end if;
  if (select count(*) from usuarios_perfil where es_owner) <= 1 then
    raise exception 'El sistema debe tener siempre al menos un dueño.';
  end if;
  update usuarios_perfil set es_owner = false where id = p_id and es_owner;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reparacion_entregas_trg_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item_id uuid;
begin
  if old.resultado = 'reparado' and old.repone_stock then
    select item_id into v_item_id from reparacion_items where id = old.reparacion_item_id;
    update items set stock = coalesce(stock, 0) - old.cantidad_devuelta where id = v_item_id;
  end if;
  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reparacion_entregas_trg_validar_y_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pendiente numeric;
  v_item_id uuid;
begin
  select reparacion_item_pendiente(new.reparacion_item_id) into v_pendiente;
  if new.cantidad_devuelta > v_pendiente then
    raise exception 'No podés registrar %, quedan % pendientes en esa línea.', new.cantidad_devuelta, v_pendiente;
  end if;

  if new.resultado = 'reparado' and new.repone_stock then
    select item_id into v_item_id from reparacion_items where id = new.reparacion_item_id;
    update items set stock = coalesce(stock, 0) + new.cantidad_devuelta where id = v_item_id;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reparacion_item_pendiente(p_reparacion_item_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select ri.cantidad - coalesce((select sum(re.cantidad_devuelta) from reparacion_entregas re where re.reparacion_item_id = ri.id), 0)
  from reparacion_items ri
  where ri.id = p_reparacion_item_id;
$function$;

CREATE OR REPLACE FUNCTION public.reparacion_items_trg_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    if new.descuenta_stock then
      update items set stock = coalesce(stock, 0) - new.cantidad where id = new.item_id;
    end if;
    return new;
  end if;

  if exists (select 1 from reparacion_entregas where reparacion_item_id = old.id) then
    raise exception 'Esta línea ya tiene una entrega registrada — borrala primero para poder modificarla.';
  end if;

  if tg_op = 'UPDATE' then
    if new.descuenta_stock then
      update items set stock = coalesce(stock, 0) - (new.cantidad - old.cantidad) where id = new.item_id;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.descuenta_stock then
      update items set stock = coalesce(stock, 0) + old.cantidad where id = old.item_id;
    end if;
    return old;
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reprogram_task(p_task_id uuid, p_new_assigned_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  task_row RECORD;
  new_pending_days INTEGER;
  new_traffic TEXT;
  old_traffic TEXT;
  new_stagnant BOOLEAN;
BEGIN
  IF p_new_assigned_date IS NULL THEN
    RAISE EXCEPTION 'La fecha asignada no puede ser null';
  END IF;

  IF p_new_assigned_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'La fecha asignada no puede ser anterior a hoy';
  END IF;

  SELECT id, user_id, start_date, traffic_level, carry_count, is_stagnant
  INTO task_row
  FROM public.tasks
  WHERE id = p_task_id AND status = 'pending';

  IF task_row.id IS NULL THEN
    RAISE EXCEPTION 'Tarea no encontrada o no está pendiente';
  END IF;

  IF task_row.user_id != auth.uid() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF NOT public.has_active_access(auth.uid()) THEN
    RAISE EXCEPTION 'Acceso deshabilitado';
  END IF;

  old_traffic := task_row.traffic_level;
  new_pending_days := CURRENT_DATE - task_row.start_date;

  IF new_pending_days <= 1 THEN
    new_traffic := 'green';
  ELSIF new_pending_days <= 3 THEN
    new_traffic := 'yellow';
  ELSE
    new_traffic := 'red';
  END IF;

  new_stagnant := (
    new_pending_days >= 5
    OR task_row.carry_count >= 3
    OR new_traffic = 'red'
  );

  UPDATE public.tasks
  SET
    assigned_date = p_new_assigned_date,
    pending_days = new_pending_days,
    traffic_level = new_traffic,
    is_stagnant = new_stagnant
  WHERE id = p_task_id;

  INSERT INTO public.task_history (task_id, user_id, action, note)
  VALUES (
    p_task_id,
    auth.uid(),
    'reprogrammed',
    'Reprogramada al ' || p_new_assigned_date::TEXT || '. Días pendiente: ' || new_pending_days
  );

  IF new_traffic != old_traffic THEN
    INSERT INTO public.task_history (task_id, user_id, action, note)
    VALUES (
      p_task_id,
      auth.uid(),
      'traffic_changed',
      'Semáforo cambió de ' || old_traffic || ' a ' || new_traffic
    );
  END IF;

  IF new_stagnant AND NOT task_row.is_stagnant THEN
    INSERT INTO public.task_history (task_id, user_id, action, note)
    VALUES (
      p_task_id,
      auth.uid(),
      'stagnant_detected',
      'Tarea marcada como estancada. Días: ' || new_pending_days || ', arrastres: ' || task_row.carry_count || ', semáforo: ' || new_traffic
    );
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.restaurar_reparacion(p_reparacion_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_linea record;
  v_pendiente numeric;
begin
  if not is_mantenimiento_admin() then
    raise exception 'No autorizado';
  end if;

  for v_linea in select id, item_id from reparacion_items where reparacion_id = p_reparacion_id and descuenta_stock loop
    v_pendiente := reparacion_item_pendiente(v_linea.id);
    if v_pendiente > 0 then
      update items set stock = coalesce(stock, 0) - v_pendiente where id = v_linea.item_id;
    end if;
  end loop;

  update reparaciones set activo = true, eliminado_por = null, eliminado_at = null where id = p_reparacion_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tiene_acceso_mantenimiento()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from usuarios_perfil
    where id = auth.uid() and mantenimiento_rol is not null
  ) or is_mantenimiento_admin();
$function$;

CREATE OR REPLACE FUNCTION public.transferir_ownership(p_nuevo_owner_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_owner() then
    raise exception 'Solo el dueño actual puede transferir este rol';
  end if;
  if p_nuevo_owner_id = auth.uid() then
    raise exception 'Ya sos el dueño';
  end if;
  update usuarios_perfil set es_owner = true where id = p_nuevo_owner_id;
  update usuarios_perfil set es_owner = false where id = auth.uid();
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_task(p_task_id uuid, p_title text, p_description text, p_traffic_level text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  task_row record;
begin
  if p_title is null or trim(p_title) = '' then
    raise exception 'El título no puede estar vacío';
  end if;
  if p_traffic_level not in ('green', 'yellow', 'red') then
    raise exception 'Nivel de semáforo inválido';
  end if;

  select id, user_id into task_row
  from public.tasks
  where id = p_task_id and status = 'pending';

  if task_row.id is null then
    raise exception 'Tarea no encontrada o no está pendiente';
  end if;

  if task_row.user_id != auth.uid() then
    raise exception 'No autorizado';
  end if;

  if not public.has_active_access(auth.uid()) then
    raise exception 'Acceso deshabilitado';
  end if;

  update public.tasks
  set title = trim(p_title), description = p_description, traffic_level = p_traffic_level
  where id = p_task_id;

  insert into public.task_history (task_id, user_id, action, note)
  values (p_task_id, auth.uid(), 'edited', 'Tarea editada');
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;


-- ======================================================================
-- Disparadores
-- ======================================================================

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
CREATE TRIGGER trg_audit_comisionistas AFTER INSERT OR DELETE OR UPDATE ON public.comisionistas FOR EACH ROW EXECUTE FUNCTION fn_audit_log();
CREATE TRIGGER trg_audit_contactos AFTER INSERT OR DELETE OR UPDATE ON public.contactos FOR EACH ROW EXECUTE FUNCTION fn_audit_log();
CREATE TRIGGER equipos_set_updated_at BEFORE UPDATE ON public.equipos FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER items_set_updated_at BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_audit_items_delete AFTER DELETE ON public.items FOR EACH ROW WHEN ((pg_trigger_depth() = 0)) EXECUTE FUNCTION fn_audit_log_items();
CREATE TRIGGER trg_audit_items_insert AFTER INSERT ON public.items FOR EACH ROW WHEN ((pg_trigger_depth() = 0)) EXECUTE FUNCTION fn_audit_log_items();
CREATE TRIGGER trg_audit_items_update AFTER UPDATE OF codigo, numero, descripcion, familia_id, subfamilia_id, ubicacion, stock, detalles, stock_minimo, punto_pedido, activo ON public.items FOR EACH ROW WHEN (((pg_trigger_depth() = 0) AND (((((((((((old.codigo IS DISTINCT FROM new.codigo) OR (old.numero IS DISTINCT FROM new.numero)) OR (old.descripcion IS DISTINCT FROM new.descripcion)) OR (old.familia_id IS DISTINCT FROM new.familia_id)) OR (old.subfamilia_id IS DISTINCT FROM new.subfamilia_id)) OR (old.ubicacion IS DISTINCT FROM new.ubicacion)) OR (old.stock IS DISTINCT FROM new.stock)) OR (old.detalles IS DISTINCT FROM new.detalles)) OR (old.stock_minimo IS DISTINCT FROM new.stock_minimo)) OR (old.punto_pedido IS DISTINCT FROM new.punto_pedido)) OR (old.activo IS DISTINCT FROM new.activo)))) EXECUTE FUNCTION fn_audit_log_items();
CREATE TRIGGER trg_items_estado_reposicion BEFORE UPDATE OF stock, stock_minimo, punto_pedido, estado_reposicion ON public.items FOR EACH ROW EXECUTE FUNCTION items_trg_estado_reposicion();
CREATE TRIGGER trg_items_fotos_pendientes BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION items_trg_fotos_pendientes();
CREATE TRIGGER trg_audit_proveedores AFTER INSERT OR DELETE OR UPDATE ON public.proveedores FOR EACH ROW EXECUTE FUNCTION fn_audit_log();
CREATE TRIGGER trg_audit_reparacion_entregas AFTER INSERT OR DELETE ON public.reparacion_entregas FOR EACH ROW EXECUTE FUNCTION fn_audit_log_reparaciones();
CREATE TRIGGER trg_reparacion_entregas_delete BEFORE DELETE ON public.reparacion_entregas FOR EACH ROW EXECUTE FUNCTION reparacion_entregas_trg_delete();
CREATE TRIGGER trg_reparacion_entregas_validar BEFORE INSERT ON public.reparacion_entregas FOR EACH ROW EXECUTE FUNCTION reparacion_entregas_trg_validar_y_stock();
CREATE TRIGGER trg_audit_reparacion_items AFTER INSERT OR DELETE OR UPDATE ON public.reparacion_items FOR EACH ROW EXECUTE FUNCTION fn_audit_log_reparaciones();
CREATE TRIGGER trg_reparacion_items_stock BEFORE DELETE OR UPDATE ON public.reparacion_items FOR EACH ROW EXECUTE FUNCTION reparacion_items_trg_stock();
CREATE TRIGGER trg_reparacion_items_stock_insert AFTER INSERT ON public.reparacion_items FOR EACH ROW EXECUTE FUNCTION reparacion_items_trg_stock();
CREATE TRIGGER trg_audit_reparaciones AFTER INSERT OR DELETE OR UPDATE ON public.reparaciones FOR EACH ROW EXECUTE FUNCTION fn_audit_log_reparaciones();
CREATE TRIGGER trg_ajustar_stock_retiro_item AFTER INSERT OR DELETE OR UPDATE OF cantidad ON public.retiro_items FOR EACH ROW EXECUTE FUNCTION ajustar_stock_por_retiro_item();
CREATE TRIGGER trg_audit_retiro_items_delete AFTER DELETE ON public.retiro_items FOR EACH ROW EXECUTE FUNCTION fn_audit_log_retiro_items();
CREATE TRIGGER trg_audit_retiro_items_update AFTER UPDATE OF cantidad ON public.retiro_items FOR EACH ROW WHEN ((old.cantidad IS DISTINCT FROM new.cantidad)) EXECUTE FUNCTION fn_audit_log_retiro_items();
CREATE TRIGGER set_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_usuarios_perfil_updated_at BEFORE UPDATE ON public.usuarios_perfil FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_audit_usuarios_delete AFTER DELETE ON public.usuarios_perfil FOR EACH ROW EXECUTE FUNCTION fn_audit_log_usuarios();
CREATE TRIGGER trg_audit_usuarios_insert AFTER INSERT ON public.usuarios_perfil FOR EACH ROW EXECUTE FUNCTION fn_audit_log_usuarios();
CREATE TRIGGER trg_audit_usuarios_update AFTER UPDATE OF nombre, apellido, rol, mantenimiento_rol, puede_ver_retiros, puede_ver_errores, puede_resetear_contrasenas, puede_ver_sugerencias, activo, es_owner ON public.usuarios_perfil FOR EACH ROW WHEN (((((((((((old.nombre IS DISTINCT FROM new.nombre) OR (old.apellido IS DISTINCT FROM new.apellido)) OR (old.rol IS DISTINCT FROM new.rol)) OR (old.mantenimiento_rol IS DISTINCT FROM new.mantenimiento_rol)) OR (old.puede_ver_retiros IS DISTINCT FROM new.puede_ver_retiros)) OR (old.puede_ver_errores IS DISTINCT FROM new.puede_ver_errores)) OR (old.puede_resetear_contrasenas IS DISTINCT FROM new.puede_resetear_contrasenas)) OR (old.puede_ver_sugerencias IS DISTINCT FROM new.puede_ver_sugerencias)) OR (old.activo IS DISTINCT FROM new.activo)) OR (old.es_owner IS DISTINCT FROM new.es_owner))) EXECUTE FUNCTION fn_audit_log_usuarios();
CREATE TRIGGER trg_evitar_borrar_dueno BEFORE DELETE ON public.usuarios_perfil FOR EACH ROW EXECUTE FUNCTION evitar_borrar_dueno();
CREATE CONSTRAINT TRIGGER trg_evitar_sin_owner AFTER UPDATE OF es_owner ON public.usuarios_perfil DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION evitar_sin_owner();
CREATE TRIGGER trg_proteger_campos_privilegiados BEFORE UPDATE ON public.usuarios_perfil FOR EACH ROW EXECUTE FUNCTION proteger_campos_privilegiados();

-- ======================================================================
-- Seguridad a nivel de fila (RLS)
-- ======================================================================

alter table public."audit_log" enable row level security;
alter table public."comisionistas" enable row level security;
alter table public."configuracion" enable row level security;
alter table public."contactos" enable row level security;
alter table public."equipo_items" enable row level security;
alter table public."equipos" enable row level security;
alter table public."error_logs" enable row level security;
alter table public."familias" enable row level security;
alter table public."item_proveedores" enable row level security;
alter table public."items" enable row level security;
alter table public."planilla_familias" enable row level security;
alter table public."proveedores" enable row level security;
alter table public."reparacion_entregas" enable row level security;
alter table public."reparacion_items" enable row level security;
alter table public."reparaciones" enable row level security;
alter table public."retiro_items" enable row level security;
alter table public."retiros" enable row level security;
alter table public."rotulo_disenos" enable row level security;
alter table public."rotulos_bultos" enable row level security;
alter table public."rotulos_fotos" enable row level security;
alter table public."rotulos_generados" enable row level security;
alter table public."sectores" enable row level security;
alter table public."subfamilias" enable row level security;
alter table public."sugerencias" enable row level security;
alter table public."task_history" enable row level security;
alter table public."tasks" enable row level security;
alter table public."usuarios_perfil" enable row level security;

-- ======================================================================
-- Políticas de acceso
-- ======================================================================

create policy "audit_log_select_owner" on public."audit_log"
  as permissive for select to authenticated
  using (is_owner());
create policy "autenticados pueden leer" on public."comisionistas"
  as permissive for select to authenticated
  using (true);
create policy "comisionistas_delete" on public."comisionistas"
  as permissive for delete to public
  using (is_directorio_admin());
create policy "comisionistas_insert" on public."comisionistas"
  as permissive for insert to public
  with check (is_directorio_admin());
create policy "comisionistas_update" on public."comisionistas"
  as permissive for update to public
  using (is_directorio_admin())
  with check (is_directorio_admin());
create policy "configuracion_select" on public."configuracion"
  as permissive for select to authenticated
  using (true);
create policy "configuracion_select_anon" on public."configuracion"
  as permissive for select to anon
  using (true);
create policy "configuracion_write_admin" on public."configuracion"
  as permissive for all to authenticated
  using (is_directorio_admin())
  with check (is_directorio_admin());
create policy "contactos_delete" on public."contactos"
  as permissive for delete to public
  using (is_directorio_admin());
create policy "contactos_insert" on public."contactos"
  as permissive for insert to public
  with check (is_directorio_admin());
create policy "contactos_select" on public."contactos"
  as permissive for select to public
  using (true);
create policy "contactos_update" on public."contactos"
  as permissive for update to public
  using (is_directorio_admin())
  with check (is_directorio_admin());
create policy "equipo_items_select" on public."equipo_items"
  as permissive for select to public
  using (true);
create policy "equipo_items_write" on public."equipo_items"
  as permissive for all to authenticated
  using (is_mantenimiento_admin())
  with check (is_mantenimiento_admin());
create policy "equipos_select" on public."equipos"
  as permissive for select to public
  using (true);
create policy "equipos_write" on public."equipos"
  as permissive for all to authenticated
  using (is_mantenimiento_admin())
  with check (is_mantenimiento_admin());
create policy "error_logs_delete" on public."error_logs"
  as permissive for delete to authenticated
  using (can_view_errores());
create policy "error_logs_insert" on public."error_logs"
  as permissive for insert to authenticated
  with check ((usuario_id = auth.uid()));
create policy "error_logs_select" on public."error_logs"
  as permissive for select to authenticated
  using (can_view_errores());
create policy "familias_delete" on public."familias"
  as permissive for delete to public
  using (is_owner());
create policy "familias_insert" on public."familias"
  as permissive for insert to public
  with check (is_mantenimiento_admin());
create policy "familias_select" on public."familias"
  as permissive for select to authenticated
  using (true);
create policy "familias_update" on public."familias"
  as permissive for update to public
  using (is_owner())
  with check (is_owner());
create policy "item_proveedores_delete" on public."item_proveedores"
  as permissive for delete to authenticated
  using (is_mantenimiento_admin());
create policy "item_proveedores_insert" on public."item_proveedores"
  as permissive for insert to authenticated
  with check (is_mantenimiento_admin());
create policy "item_proveedores_select" on public."item_proveedores"
  as permissive for select to authenticated
  using (is_mantenimiento_admin());
create policy "items_delete" on public."items"
  as permissive for delete to authenticated
  using (is_owner());
create policy "items_insert" on public."items"
  as permissive for insert to authenticated
  with check (is_mantenimiento_admin());
create policy "items_select" on public."items"
  as permissive for select to authenticated
  using (true);
create policy "items_update" on public."items"
  as permissive for update to authenticated
  using (tiene_acceso_mantenimiento())
  with check (tiene_acceso_mantenimiento());
create policy "planilla_familias_select" on public."planilla_familias"
  as permissive for select to public
  using (true);
create policy "planilla_familias_update" on public."planilla_familias"
  as permissive for update to public
  using (is_mantenimiento_admin())
  with check (is_mantenimiento_admin());
create policy "planilla_familias_upsert" on public."planilla_familias"
  as permissive for insert to public
  with check (is_mantenimiento_admin());
create policy "proveedores_delete" on public."proveedores"
  as permissive for delete to authenticated
  using (is_owner());
create policy "proveedores_insert" on public."proveedores"
  as permissive for insert to authenticated
  with check (is_directorio_admin());
create policy "proveedores_select" on public."proveedores"
  as permissive for select to authenticated
  using (true);
create policy "proveedores_update" on public."proveedores"
  as permissive for update to authenticated
  using (is_directorio_admin())
  with check (is_directorio_admin());
create policy "reparacion_entregas_delete" on public."reparacion_entregas"
  as permissive for delete to authenticated
  using (is_mantenimiento_admin());
create policy "reparacion_entregas_insert" on public."reparacion_entregas"
  as permissive for insert to authenticated
  with check (is_mantenimiento_admin());
create policy "reparacion_entregas_select" on public."reparacion_entregas"
  as permissive for select to authenticated
  using (is_mantenimiento_admin());
create policy "reparacion_items_delete" on public."reparacion_items"
  as permissive for delete to authenticated
  using (is_mantenimiento_admin());
create policy "reparacion_items_insert" on public."reparacion_items"
  as permissive for insert to authenticated
  with check (is_mantenimiento_admin());
create policy "reparacion_items_select" on public."reparacion_items"
  as permissive for select to authenticated
  using (is_mantenimiento_admin());
create policy "reparacion_items_update" on public."reparacion_items"
  as permissive for update to authenticated
  using (is_mantenimiento_admin())
  with check (is_mantenimiento_admin());
create policy "reparaciones_delete" on public."reparaciones"
  as permissive for delete to authenticated
  using (is_owner());
create policy "reparaciones_insert" on public."reparaciones"
  as permissive for insert to authenticated
  with check (is_mantenimiento_admin());
create policy "reparaciones_select" on public."reparaciones"
  as permissive for select to authenticated
  using (is_mantenimiento_admin());
create policy "reparaciones_update" on public."reparaciones"
  as permissive for update to authenticated
  using (is_mantenimiento_admin())
  with check (is_mantenimiento_admin());
create policy "retiro_items_delete" on public."retiro_items"
  as permissive for delete to authenticated
  using ((EXISTS ( SELECT 1
   FROM retiros r
  WHERE ((r.id = retiro_items.retiro_id) AND (can_view_all_retiros() OR ((r.usuario_id = auth.uid()) AND (r.created_at > (now() - '24:00:00'::interval))))))));
create policy "retiro_items_insert" on public."retiro_items"
  as permissive for insert to authenticated
  with check ((EXISTS ( SELECT 1
   FROM retiros r
  WHERE ((r.id = retiro_items.retiro_id) AND (r.usuario_id = auth.uid())))));
create policy "retiro_items_select" on public."retiro_items"
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM retiros r
  WHERE ((r.id = retiro_items.retiro_id) AND ((r.usuario_id = auth.uid()) OR can_view_all_retiros())))));
create policy "retiro_items_update" on public."retiro_items"
  as permissive for update to authenticated
  using ((EXISTS ( SELECT 1
   FROM retiros r
  WHERE ((r.id = retiro_items.retiro_id) AND (can_view_all_retiros() OR ((r.usuario_id = auth.uid()) AND (r.created_at > (now() - '24:00:00'::interval))))))))
  with check ((EXISTS ( SELECT 1
   FROM retiros r
  WHERE ((r.id = retiro_items.retiro_id) AND (can_view_all_retiros() OR ((r.usuario_id = auth.uid()) AND ((r.created_at)::date = ((now() AT TIME ZONE 'utc'::text))::date)))))));
create policy "retiros_delete" on public."retiros"
  as permissive for delete to authenticated
  using ((can_view_all_retiros() OR ((usuario_id = auth.uid()) AND (created_at > (now() - '24:00:00'::interval)))));
create policy "retiros_insert" on public."retiros"
  as permissive for insert to authenticated
  with check ((usuario_id = auth.uid()));
create policy "retiros_select" on public."retiros"
  as permissive for select to authenticated
  using (((usuario_id = auth.uid()) OR can_view_all_retiros()));
create policy "retiros_update" on public."retiros"
  as permissive for update to authenticated
  using ((can_view_all_retiros() OR ((usuario_id = auth.uid()) AND (created_at > (now() - '24:00:00'::interval)))))
  with check ((can_view_all_retiros() OR ((usuario_id = auth.uid()) AND ((created_at)::date = ((now() AT TIME ZONE 'utc'::text))::date))));
create policy "rotulo_disenos_select" on public."rotulo_disenos"
  as permissive for select to authenticated
  using (true);
create policy "rotulo_disenos_write_admin" on public."rotulo_disenos"
  as permissive for all to authenticated
  using (is_directorio_admin())
  with check (is_directorio_admin());
create policy "rotulos_bultos_insert" on public."rotulos_bultos"
  as permissive for insert to authenticated
  with check (true);
create policy "rotulos_bultos_select" on public."rotulos_bultos"
  as permissive for select to authenticated
  using (true);
create policy "rotulos_fotos_delete" on public."rotulos_fotos"
  as permissive for delete to authenticated
  using (true);
create policy "rotulos_fotos_insert" on public."rotulos_fotos"
  as permissive for insert to authenticated
  with check (true);
create policy "rotulos_fotos_select" on public."rotulos_fotos"
  as permissive for select to authenticated
  using (true);
create policy "rotulos_generados_delete_owner" on public."rotulos_generados"
  as permissive for delete to public
  using (is_owner());
create policy "rotulos_generados_insert" on public."rotulos_generados"
  as permissive for insert to authenticated
  with check (true);
create policy "rotulos_generados_select" on public."rotulos_generados"
  as permissive for select to authenticated
  using (true);
create policy "rotulos_generados_update_admin" on public."rotulos_generados"
  as permissive for update to authenticated
  using (is_directorio_admin())
  with check (is_directorio_admin());
create policy "sectores_select" on public."sectores"
  as permissive for select to authenticated
  using (true);
create policy "sectores_write" on public."sectores"
  as permissive for all to authenticated
  using (is_mantenimiento_admin())
  with check (is_mantenimiento_admin());
create policy "subfamilias_delete" on public."subfamilias"
  as permissive for delete to public
  using (is_owner());
create policy "subfamilias_insert" on public."subfamilias"
  as permissive for insert to public
  with check (is_mantenimiento_admin());
create policy "subfamilias_select" on public."subfamilias"
  as permissive for select to authenticated
  using (true);
create policy "subfamilias_update" on public."subfamilias"
  as permissive for update to public
  using (is_owner())
  with check (is_owner());
create policy "sugerencias_delete" on public."sugerencias"
  as permissive for delete to public
  using (can_view_sugerencias());
create policy "sugerencias_insert" on public."sugerencias"
  as permissive for insert to public
  with check ((usuario_id = auth.uid()));
create policy "sugerencias_select" on public."sugerencias"
  as permissive for select to public
  using (can_view_sugerencias());
create policy "task_history_insert_own" on public."task_history"
  as permissive for insert to public
  with check (((user_id = auth.uid()) AND has_active_access(auth.uid())));
create policy "task_history_select_admin" on public."task_history"
  as permissive for select to public
  using (is_admin(auth.uid()));
create policy "task_history_select_own" on public."task_history"
  as permissive for select to public
  using (((user_id = auth.uid()) AND has_active_access(auth.uid())));
create policy "tasks_insert_own" on public."tasks"
  as permissive for insert to public
  with check (((user_id = auth.uid()) AND has_active_access(auth.uid())));
create policy "tasks_select_admin" on public."tasks"
  as permissive for select to public
  using (is_admin(auth.uid()));
create policy "tasks_select_own" on public."tasks"
  as permissive for select to public
  using (((user_id = auth.uid()) AND has_active_access(auth.uid())));
create policy "tasks_update_own" on public."tasks"
  as permissive for update to public
  using (((user_id = auth.uid()) AND has_active_access(auth.uid())))
  with check ((user_id = auth.uid()));
create policy "usuarios_perfil_select" on public."usuarios_perfil"
  as permissive for select to authenticated
  using (true);
create policy "usuarios_perfil_update" on public."usuarios_perfil"
  as permissive for update to authenticated
  using (((auth.uid() = id) OR is_owner()))
  with check (((auth.uid() = id) OR is_owner()));
create policy "authenticated_delete_rotulos_storage" on storage."objects"
  as permissive for delete to authenticated
  using (((bucket_id = 'rotulos'::text) AND (EXISTS ( SELECT 1
   FROM usuarios_perfil
  WHERE ((usuarios_perfil.id = auth.uid()) AND (usuarios_perfil.rol = 'admin'::text))))));
create policy "authenticated_upload_rotulos_storage" on storage."objects"
  as permissive for insert to authenticated
  with check ((bucket_id = 'rotulos'::text));
create policy "documentos_select" on storage."objects"
  as permissive for select to public
  using ((bucket_id = 'documentos'::text));
create policy "documentos_write" on storage."objects"
  as permissive for all to public
  using (((bucket_id = 'documentos'::text) AND is_mantenimiento_admin()))
  with check (((bucket_id = 'documentos'::text) AND is_mantenimiento_admin()));
create policy "items_photos_select" on storage."objects"
  as permissive for select to public
  using ((bucket_id = 'items'::text));
create policy "items_photos_write" on storage."objects"
  as permissive for all to authenticated
  using (((bucket_id = 'items'::text) AND tiene_acceso_mantenimiento()))
  with check (((bucket_id = 'items'::text) AND tiene_acceso_mantenimiento()));
create policy "public_read_rotulos_storage" on storage."objects"
  as permissive for select to public
  using ((bucket_id = 'rotulos'::text));

-- ======================================================================
-- Almacenamiento de archivos (buckets)
-- ======================================================================

insert into storage.buckets (id, name, public) values ('documentos', 'documentos', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('items', 'items', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('rotulos', 'rotulos', true) on conflict (id) do nothing;

-- ======================================================================
-- Permisos de ejecución de funciones
-- ======================================================================

revoke execute on function public."can_view_all_retiros"() from public, anon;
revoke execute on function public."can_view_errores"() from public, anon;
revoke execute on function public."can_view_papelera"() from public, anon;
revoke execute on function public."can_view_sugerencias"() from public, anon;
revoke execute on function public."cancel_task"(p_task_id uuid) from public, anon;
revoke execute on function public."complete_task"(p_task_id uuid) from public, anon;
revoke execute on function public."crear_reparacion"(p_proveedor_id uuid, p_motivo text, p_fecha_salida date, p_envio_id uuid, p_items jsonb) from public, anon;
revoke execute on function public."create_task"(p_title text, p_description text, p_traffic_level text, p_assigned_date date) from public, anon;
revoke execute on function public."eliminar_reparacion"(p_reparacion_id uuid) from public, anon;
revoke execute on function public."get_user_task_counts"(target_user_id uuid) from public, anon;
revoke execute on function public."has_active_access"(user_uuid uuid) from public, anon;
revoke execute on function public."historial_retiros_por_item"(p_item_id uuid) from public, anon;
revoke execute on function public."is_admin"(user_uuid uuid) from public, anon;
revoke execute on function public."is_directorio_admin"() from public, anon;
revoke execute on function public."is_mantenimiento_admin"() from public, anon;
revoke execute on function public."is_owner"() from public, anon;
revoke execute on function public."process_pending_tasks_for_user"(target_user_id uuid) from public, anon;
revoke execute on function public."reparacion_item_pendiente"(p_reparacion_item_id uuid) from public, anon;
revoke execute on function public."reprogram_task"(p_task_id uuid, p_new_assigned_date date) from public, anon;
revoke execute on function public."restaurar_reparacion"(p_reparacion_id uuid) from public, anon;
revoke execute on function public."tiene_acceso_mantenimiento"() from public, anon;
revoke execute on function public."transferir_ownership"(p_nuevo_owner_id uuid) from public, anon;
revoke execute on function public."update_task"(p_task_id uuid, p_title text, p_description text, p_traffic_level text) from public, anon;

-- ======================================================================
-- Datos mínimos de arranque
-- ======================================================================

-- La app lee siempre la fila 1 de configuración (nombre, logo, diseño del rótulo).
insert into public.configuracion (id) values (1) on conflict (id) do nothing;
