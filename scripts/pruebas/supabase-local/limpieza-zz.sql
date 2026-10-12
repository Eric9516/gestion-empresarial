do $limpieza$
declare
  s text;
  sentencias text[] := array[
    $q$delete from public.retiro_items where retiro_id in (select id from public.retiros where observacion_general like 'ZZ-%') or item_id in (select id from public.items where descripcion like 'ZZ-%')$q$,
    $q$delete from public.retiros where observacion_general like 'ZZ-%' or usuario_id in (select id from public.usuarios_perfil where email like 'zz.%')$q$,
    $q$delete from public.reparacion_entregas where reparacion_item_id in (select id from public.reparacion_items where item_id in (select id from public.items where descripcion like 'ZZ-%'))$q$,
    $q$delete from public.reparacion_items where item_id in (select id from public.items where descripcion like 'ZZ-%')$q$,
    $q$delete from public.reparaciones where motivo like 'ZZ-%'$q$,
    $q$delete from public.item_proveedores where item_id in (select id from public.items where descripcion like 'ZZ-%')$q$,
    $q$delete from public.equipo_items where item_id in (select id from public.items where descripcion like 'ZZ-%') or equipo_id in (select equipo_id from public.equipos where nombre like 'ZZ-%')$q$,
    $q$delete from public.equipos where nombre like 'ZZ-%'$q$,
    $q$delete from public.ajuste_items where item_id in (select id from public.items where descripcion like 'ZZ-%')$q$,
    $q$delete from public.items where descripcion like 'ZZ-%'$q$,
    $q$delete from public.subfamilias where nombre like 'ZZ-%'$q$,
    $q$delete from public.familias where nombre like 'ZZ-%'$q$,
    $q$delete from public.rotulos_fotos where storage_path like 'zz-%'$q$,
    $q$delete from public.rotulos_bultos where rotulo_id in (select id from public.rotulos_generados where numero_documento like 'ZZ-%')$q$,
    $q$delete from public.rotulos_generados where numero_documento like 'ZZ-%'$q$,
    $q$delete from public.contactos where proveedor_id in (select id from public.proveedores where nombre like 'ZZ-%')$q$,
    $q$delete from public.proveedores where nombre like 'ZZ-%'$q$,
    $q$delete from public.comisionistas where nombre like 'ZZ-%'$q$,
    $q$delete from public.sectores where nombre like 'ZZ-%'$q$,
    $q$delete from public.task_history where user_id in (select id from public.usuarios_perfil where email like 'zz.%')$q$,
    $q$delete from public.tasks where title like 'ZZ-%' or user_id in (select id from public.usuarios_perfil where email like 'zz.%')$q$,
    $q$delete from public.sugerencias where mensaje like 'ZZ-%'$q$,
    $q$delete from public.error_logs where mensaje like 'ZZ-%'$q$,
    $q$delete from public.rotulo_disenos where nombre like 'ZZ-%'$q$
  ];
begin
  foreach s in array sentencias loop
    begin
      execute s;
    exception when undefined_table or undefined_column then null;
    end;
  end loop;
end
$limpieza$;
select 'familias ZZ: ' || (select count(*) from public.familias where nombre like 'ZZ-%')
    || ' | items ZZ: ' || (select count(*) from public.items where descripcion like 'ZZ-%')
    || ' | proveedores ZZ: ' || (select count(*) from public.proveedores where nombre like 'ZZ-%')
    || ' | retiros ZZ: ' || (select count(*) from public.retiros where observacion_general like 'ZZ-%') as restos;
