-- Parte "abastecimiento" de supabase/migrations/20260101000300_licencia_y_bloqueo_de_modulos.sql (generado por scripts/herramientas/repartir.mjs).
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

-- 4) Bloqueo de tablas: una regla "restrictiva" por tabla, que se suma (con Y) a los permisos que ya tiene.
--    Con el módulo apagado, nadie (salvo la clave de servicio) puede leer ni escribir esas tablas.

-- Módulo proveedores
create policy bloqueo_modulo on public.proveedores as restrictive for all to public
  using (public.modulo_activo('proveedores')) with check (public.modulo_activo('proveedores'));

create policy bloqueo_modulo on public.contactos as restrictive for all to public
  using (public.modulo_activo('proveedores')) with check (public.modulo_activo('proveedores'));

-- Módulo comisionistas
create policy bloqueo_modulo on public.comisionistas as restrictive for all to public
  using (public.modulo_activo('comisionistas')) with check (public.modulo_activo('comisionistas'));

-- Módulo envios
create policy bloqueo_modulo on public.rotulos_generados as restrictive for all to public
  using (public.modulo_activo('envios')) with check (public.modulo_activo('envios'));

create policy bloqueo_modulo on public.rotulos_bultos as restrictive for all to public
  using (public.modulo_activo('envios')) with check (public.modulo_activo('envios'));

create policy bloqueo_modulo on public.rotulos_fotos as restrictive for all to public
  using (public.modulo_activo('envios')) with check (public.modulo_activo('envios'));

create policy bloqueo_modulo on public.rotulo_disenos as restrictive for all to public
  using (public.modulo_activo('envios')) with check (public.modulo_activo('envios'));

-- Módulo deposito
create policy bloqueo_modulo on public.items as restrictive for all to public
  using (public.modulo_activo('deposito')) with check (public.modulo_activo('deposito'));

create policy bloqueo_modulo on public.familias as restrictive for all to public
  using (public.modulo_activo('deposito')) with check (public.modulo_activo('deposito'));

create policy bloqueo_modulo on public.subfamilias as restrictive for all to public
  using (public.modulo_activo('deposito')) with check (public.modulo_activo('deposito'));

create policy bloqueo_modulo on public.planilla_familias as restrictive for all to public
  using (public.modulo_activo('deposito')) with check (public.modulo_activo('deposito'));

create policy bloqueo_modulo on public.retiros as restrictive for all to public
  using (public.modulo_activo('deposito')) with check (public.modulo_activo('deposito'));

create policy bloqueo_modulo on public.retiro_items as restrictive for all to public
  using (public.modulo_activo('deposito')) with check (public.modulo_activo('deposito'));

create policy bloqueo_modulo on public.sectores as restrictive for all to public
  using (public.modulo_activo('deposito')) with check (public.modulo_activo('deposito'));

create policy bloqueo_modulo on public.item_proveedores as restrictive for all to public
  using (public.modulo_activo('deposito') and public.modulo_activo('proveedores')) with check (public.modulo_activo('deposito') and public.modulo_activo('proveedores'));

-- 5) Archivos: cada carpeta de almacenamiento sigue a su módulo.
--    (Los archivos de carpetas públicas se pueden abrir con su dirección exacta aunque el módulo esté apagado;
--    lo que no se puede es subir, borrar ni listar.)
create policy bloqueo_modulo_items on storage.objects as restrictive for all to public
  using (bucket_id <> 'items' or public.modulo_activo('deposito'))
  with check (bucket_id <> 'items' or public.modulo_activo('deposito'));

create policy bloqueo_modulo_rotulos on storage.objects as restrictive for all to public
  using (bucket_id <> 'rotulos' or public.modulo_activo('envios'))
  with check (bucket_id <> 'rotulos' or public.modulo_activo('envios'));

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
    and public.modulo_activo('deposito')
    and exists (
      select 1 from usuarios_perfil up
      where up.id = auth.uid() and (up.mantenimiento_rol is not null or is_owner())
    )
  order by r.created_at desc;
$function$;
