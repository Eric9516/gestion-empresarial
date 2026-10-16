-- El historial de un repuesto muestra de qué comprobante viene cada movimiento (carga o ajuste, y su número).
-- Cambia lo que devuelve la función, así que se vuelve a crear.
drop function if exists public.historial_ajustes_por_item(uuid);

create function public.historial_ajustes_por_item(p_item_id uuid)
returns table(id uuid, created_at timestamptz, usuario_id uuid, tipo text, cantidad numeric, stock_antes numeric, stock_despues numeric,
              motivo text, anulado boolean, anulado_at timestamptz, motivo_anulacion text,
              clase text, punto_venta integer, numero bigint, referencia text)
language sql stable security definer set search_path to 'public' as $$
  select ai.id, a.created_at, a.usuario_id, ai.tipo, ai.cantidad, ai.stock_antes, ai.stock_despues,
         a.motivo, a.anulado, a.anulado_at, a.motivo_anulacion,
         a.clase, a.punto_venta, a.numero, a.referencia
  from ajuste_items ai
  join ajustes_inventario a on a.id = ai.ajuste_id
  where ai.item_id = p_item_id
    and public.modulo_activo('deposito')
    and exists (
      select 1 from usuarios_perfil up
      where up.id = (select auth.uid()) and up.activo is true and (up.mantenimiento_rol is not null or (select is_owner()))
    )
  order by a.created_at desc;
$$;

revoke execute on function public.historial_ajustes_por_item(uuid) from public, anon;
grant execute on function public.historial_ajustes_por_item(uuid) to authenticated, service_role;
