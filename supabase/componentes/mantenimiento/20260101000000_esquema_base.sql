-- Parte "mantenimiento" de supabase/migrations/20260101000000_esquema_base.sql (generado por scripts/herramientas/repartir.mjs).
-- Se aplica después de la parte de los componentes anteriores (base → abastecimiento → mantenimiento).

-- Esquema base de la plantilla (sin datos de ninguna empresa).
-- Generado a partir de una instalación real y verificado contra ella.
-- Las mejoras propias de la plantilla van en las migraciones siguientes.
set check_function_bodies = off;
set search_path = public;

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

alter table only public."equipo_items" add constraint "equipo_items_pkey" PRIMARY KEY (equipo_id, item_id);

alter table only public."equipos" add constraint "equipos_pkey" PRIMARY KEY (id);

alter table only public."reparacion_entregas" add constraint "reparacion_entregas_pkey" PRIMARY KEY (id);

alter table only public."reparacion_items" add constraint "reparacion_items_pkey" PRIMARY KEY (id);

alter table only public."reparaciones" add constraint "reparaciones_pkey" PRIMARY KEY (id);

alter table only public."reparacion_entregas" add constraint "reparacion_entregas_cantidad_devuelta_check" CHECK ((cantidad_devuelta > (0)::numeric));

alter table only public."reparacion_entregas" add constraint "reparacion_entregas_resultado_check" CHECK ((resultado = ANY (ARRAY['reparado'::text, 'baja'::text])));

alter table only public."reparacion_items" add constraint "reparacion_items_cantidad_check" CHECK ((cantidad > (0)::numeric));

alter table only public."equipo_items" add constraint "equipo_items_equipo_id_fkey" FOREIGN KEY (equipo_id) REFERENCES equipos(id) ON DELETE CASCADE;

alter table only public."equipo_items" add constraint "equipo_items_item_id_fkey" FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;

alter table only public."reparacion_entregas" add constraint "reparacion_entregas_registrado_por_fkey" FOREIGN KEY (registrado_por) REFERENCES usuarios_perfil(id);

alter table only public."reparacion_entregas" add constraint "reparacion_entregas_reparacion_item_id_fkey" FOREIGN KEY (reparacion_item_id) REFERENCES reparacion_items(id) ON DELETE CASCADE;

alter table only public."reparacion_items" add constraint "reparacion_items_item_id_fkey" FOREIGN KEY (item_id) REFERENCES items(id);

alter table only public."reparacion_items" add constraint "reparacion_items_reparacion_id_fkey" FOREIGN KEY (reparacion_id) REFERENCES reparaciones(id) ON DELETE CASCADE;

alter table only public."reparaciones" add constraint "reparaciones_eliminado_por_fkey" FOREIGN KEY (eliminado_por) REFERENCES usuarios_perfil(id);

alter table only public."reparaciones" add constraint "reparaciones_envio_id_fkey" FOREIGN KEY (envio_id) REFERENCES rotulos_generados(id);

alter table only public."reparaciones" add constraint "reparaciones_proveedor_id_fkey" FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);

alter table only public."reparaciones" add constraint "reparaciones_responsable_id_fkey" FOREIGN KEY (responsable_id) REFERENCES usuarios_perfil(id);

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

CREATE TRIGGER equipos_set_updated_at BEFORE UPDATE ON public.equipos FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_audit_reparacion_entregas AFTER INSERT OR DELETE ON public.reparacion_entregas FOR EACH ROW EXECUTE FUNCTION fn_audit_log_reparaciones();

CREATE TRIGGER trg_reparacion_entregas_delete BEFORE DELETE ON public.reparacion_entregas FOR EACH ROW EXECUTE FUNCTION reparacion_entregas_trg_delete();

CREATE TRIGGER trg_reparacion_entregas_validar BEFORE INSERT ON public.reparacion_entregas FOR EACH ROW EXECUTE FUNCTION reparacion_entregas_trg_validar_y_stock();

CREATE TRIGGER trg_audit_reparacion_items AFTER INSERT OR DELETE OR UPDATE ON public.reparacion_items FOR EACH ROW EXECUTE FUNCTION fn_audit_log_reparaciones();

CREATE TRIGGER trg_reparacion_items_stock BEFORE DELETE OR UPDATE ON public.reparacion_items FOR EACH ROW EXECUTE FUNCTION reparacion_items_trg_stock();

CREATE TRIGGER trg_reparacion_items_stock_insert AFTER INSERT ON public.reparacion_items FOR EACH ROW EXECUTE FUNCTION reparacion_items_trg_stock();

CREATE TRIGGER trg_audit_reparaciones AFTER INSERT OR DELETE OR UPDATE ON public.reparaciones FOR EACH ROW EXECUTE FUNCTION fn_audit_log_reparaciones();

alter table public."equipo_items" enable row level security;

alter table public."equipos" enable row level security;

alter table public."reparacion_entregas" enable row level security;

alter table public."reparacion_items" enable row level security;

alter table public."reparaciones" enable row level security;

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

create policy "documentos_select" on storage."objects"
  as permissive for select to public
  using ((bucket_id = 'documentos'::text));

create policy "documentos_write" on storage."objects"
  as permissive for all to public
  using (((bucket_id = 'documentos'::text) AND is_mantenimiento_admin()))
  with check (((bucket_id = 'documentos'::text) AND is_mantenimiento_admin()));

-- ======================================================================
-- Almacenamiento de archivos (buckets)
-- ======================================================================

insert into storage.buckets (id, name, public) values ('documentos', 'documentos', true) on conflict (id) do nothing;

revoke execute on function public."crear_reparacion"(p_proveedor_id uuid, p_motivo text, p_fecha_salida date, p_envio_id uuid, p_items jsonb) from public, anon;

revoke execute on function public."eliminar_reparacion"(p_reparacion_id uuid) from public, anon;

revoke execute on function public."reparacion_item_pendiente"(p_reparacion_item_id uuid) from public, anon;

revoke execute on function public."restaurar_reparacion"(p_reparacion_id uuid) from public, anon;
