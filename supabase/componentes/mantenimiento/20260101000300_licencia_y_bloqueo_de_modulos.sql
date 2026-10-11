-- Parte "mantenimiento" de supabase/migrations/20260101000300_licencia_y_bloqueo_de_modulos.sql (generado por scripts/herramientas/repartir.mjs).
-- Se aplica después de la parte de los componentes anteriores (base → abastecimiento → mantenimiento).

-- Licencia de módulos y bloqueo en la base de datos.
--
-- Qué módulos usa cada instalación lo define SOLO quien vende (con la clave de servicio, por el comando
-- "pnpm cliente modulos"): vive en la tabla "licencia", que ningún usuario puede escribir. Un módulo
-- apagado queda bloqueado para todos, incluido el dueño: sus tablas, sus funciones y sus archivos.
--
-- Dependencias entre módulos:
--   envios      necesita proveedores (cada envío es de un proveedor).
--   deposito    funciona solo; sus "Reparaciones" y "Proveedores por repuesto" necesitan además proveedores.
--   comisionistas, tareas: independientes.

set check_function_bodies = off;

create policy bloqueo_modulo on public.equipos as restrictive for all to public
  using (public.modulo_activo('deposito')) with check (public.modulo_activo('deposito'));

create policy bloqueo_modulo on public.equipo_items as restrictive for all to public
  using (public.modulo_activo('deposito')) with check (public.modulo_activo('deposito'));

-- Módulos deposito + proveedores (necesitan los dos)
create policy bloqueo_modulo on public.reparaciones as restrictive for all to public
  using (public.modulo_activo('deposito') and public.modulo_activo('proveedores')) with check (public.modulo_activo('deposito') and public.modulo_activo('proveedores'));

create policy bloqueo_modulo on public.reparacion_items as restrictive for all to public
  using (public.modulo_activo('deposito') and public.modulo_activo('proveedores')) with check (public.modulo_activo('deposito') and public.modulo_activo('proveedores'));

create policy bloqueo_modulo on public.reparacion_entregas as restrictive for all to public
  using (public.modulo_activo('deposito') and public.modulo_activo('proveedores')) with check (public.modulo_activo('deposito') and public.modulo_activo('proveedores'));

create policy bloqueo_modulo_documentos on storage.objects as restrictive for all to public
  using (bucket_id <> 'documentos' or public.modulo_activo('deposito'))
  with check (bucket_id <> 'documentos' or public.modulo_activo('deposito'));

-- 6) Funciones que se saltan las reglas de tabla: llevan la misma guarda.

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
  PERFORM public.exigir_modulo('deposito', 'proveedores');
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
  PERFORM public.exigir_modulo('deposito', 'proveedores');
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
  PERFORM public.exigir_modulo('deposito', 'proveedores');
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

CREATE OR REPLACE FUNCTION public.reparacion_item_pendiente(p_reparacion_item_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select ri.cantidad - coalesce((select sum(re.cantidad_devuelta) from reparacion_entregas re where re.reparacion_item_id = ri.id), 0)
  from reparacion_items ri
  where ri.id = p_reparacion_item_id
    and public.modulo_activo('deposito') and public.modulo_activo('proveedores');
$function$;
