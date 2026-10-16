-- Varios depósitos: estructura (etapa 1).
--
-- Un "depósito" es un área con su propio stock (Mantenimiento, Insumos, Producción…). Esta etapa agrega las tablas y hace que mover_stock() mueva el stock de UN depósito, sin cambiar
-- lo que ve el usuario: todo lo actual pasa a un depósito principal y todo lo que no diga de qué depósito es, va a ese. El stock total de cada repuesto (items.stock) sigue estando
-- y se mantiene al día: es la suma de sus depósitos. Un depósito nunca puede quedar con stock negativo.
-- (Etapas siguientes: elegir depósito en las pantallas, mínimos por depósito, permisos por depósito, transferencias.)

-- ---------------------------------------------------------------------------------------------
-- 1) Los depósitos
-- ---------------------------------------------------------------------------------------------
create table public.depositos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (length(btrim(codigo)) between 1 and 10),
  nombre text not null check (length(btrim(nombre)) between 1 and 120),
  -- el punto de venta con el que se numeran los comprobantes de este depósito (0001, 0002…)
  punto_venta integer not null default 1 check (punto_venta between 1 and 9999),
  activo boolean not null default true,
  es_principal boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index depositos_nombre_uidx on public.depositos (lower(btrim(nombre)));
-- a lo sumo un depósito principal
create unique index depositos_principal_uidx on public.depositos ((true)) where es_principal;

insert into public.depositos (codigo, nombre, es_principal)
select '01', 'Depósito principal', true where not exists (select 1 from public.depositos);

-- El depósito al que va todo lo que no dice de cuál es (por ahora, todo).
create or replace function public.deposito_principal()
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select id from public.depositos where es_principal limit 1 $$;
revoke execute on function public.deposito_principal() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2) El stock de cada repuesto en cada depósito (solo hay fila si alguna vez tuvo movimiento)
-- ---------------------------------------------------------------------------------------------
create table public.stock_por_deposito (
  deposito_id uuid not null references public.depositos(id) on delete restrict,
  item_id uuid not null references public.items(id) on delete cascade,
  stock numeric not null default 0 check (stock >= 0),
  primary key (deposito_id, item_id)
);
create index stock_por_deposito_item_idx on public.stock_por_deposito (item_id);

-- Solo se cambia desde mover_stock (igual que items.stock). Borrar se permite únicamente en cascada (cuando se borra el repuesto).
create or replace function public.stock_por_deposito_proteger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.mover_stock', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'El stock de un depósito no se edita directamente: se cambia con un movimiento (carga de stock o ajuste), que queda registrado.' using errcode = 'check_violation';
end;
$$;
create trigger trg_stock_por_deposito_proteger
  before insert or update or delete on public.stock_por_deposito
  for each row execute function public.stock_por_deposito_proteger();

-- Lo que había: todo el stock actual pasa al depósito principal.
alter table public.stock_por_deposito disable trigger trg_stock_por_deposito_proteger;
insert into public.stock_por_deposito (deposito_id, item_id, stock)
select public.deposito_principal(), i.id, i.stock from public.items i where i.stock is not null and i.stock > 0
on conflict (deposito_id, item_id) do nothing;
alter table public.stock_por_deposito enable trigger trg_stock_por_deposito_proteger;

-- ---------------------------------------------------------------------------------------------
-- 3) Seguridad: se leen (quien ve el depósito), no se escriben
-- ---------------------------------------------------------------------------------------------
alter table public.depositos enable row level security;
alter table public.stock_por_deposito enable row level security;

create policy depositos_select on public.depositos for select to authenticated
  using (exists (select 1 from public.usuarios_perfil up where up.id = (select auth.uid()) and up.activo is true and (up.mantenimiento_rol is not null or (select public.is_owner()))));
create policy stock_por_deposito_select on public.stock_por_deposito for select to authenticated
  using (exists (select 1 from public.usuarios_perfil up where up.id = (select auth.uid()) and up.activo is true and (up.mantenimiento_rol is not null or (select public.is_owner()))));

revoke all on public.depositos, public.stock_por_deposito from anon;
revoke insert, update, delete, truncate, references, trigger on public.depositos, public.stock_por_deposito from authenticated;

create policy bloqueo_modulo on public.depositos as restrictive for all to public
  using (public.modulo_activo('deposito')) with check (public.modulo_activo('deposito'));
create policy bloqueo_modulo on public.stock_por_deposito as restrictive for all to public
  using (public.modulo_activo('deposito')) with check (public.modulo_activo('deposito'));
create policy requiere_usuario_activo on public.depositos as restrictive for all to authenticated
  using ((select public.usuario_activo())) with check ((select public.usuario_activo()));
create policy requiere_usuario_activo on public.stock_por_deposito as restrictive for all to authenticated
  using ((select public.usuario_activo())) with check ((select public.usuario_activo()));

-- ---------------------------------------------------------------------------------------------
-- 4) Cada movimiento anota de qué depósito es (y su saldo es el de ese depósito)
-- ---------------------------------------------------------------------------------------------
alter table public.movimientos_stock add column if not exists deposito_id uuid references public.depositos(id);
update public.movimientos_stock set deposito_id = public.deposito_principal() where deposito_id is null;
alter table public.movimientos_stock alter column deposito_id set not null;

-- ---------------------------------------------------------------------------------------------
-- 5) mover_stock: mueve el stock de un depósito y mantiene el total del repuesto
-- ---------------------------------------------------------------------------------------------
drop function if exists public.mover_stock(uuid, numeric, text, text, text, uuid);

create or replace function public.mover_stock(
  p_item_id uuid, p_delta numeric, p_tipo text, p_detalle text, p_ref_tabla text default null, p_ref_id uuid default null, p_deposito uuid default null
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dep uuid := coalesce(p_deposito, public.deposito_principal());
  v_codigo text;
  v_en_deposito numeric;
  v_total numeric;
  v_ok boolean;
  v_tipo text := p_tipo;
  v_comprobante text;
  v_referencia text;
  v_sector text;
  v_motivo text;
  v_detalle text := p_detalle;
begin
  if p_delta is null or p_delta = 0 then
    return (select coalesce(stock, 0) from public.items where id = p_item_id);
  end if;

  -- Siempre en el mismo orden (primero el repuesto, después su depósito): dos movimientos a la vez nunca se traban entre sí. El candado del repuesto es "sin clave" (no choca con el
  -- candado liviano que ya tiene quien está insertando una línea que lo menciona): uno más fuerte hacía que dos retiros del mismo repuesto se trabaran entre sí.
  select codigo into v_codigo from public.items where id = p_item_id for no key update;
  if not found then raise exception 'El repuesto no existe.'; end if;

  perform set_config('app.mover_stock', 'on', true);
  if p_delta < 0 then
    update public.stock_por_deposito set stock = stock + p_delta where deposito_id = v_dep and item_id = p_item_id and stock + p_delta >= 0 returning stock into v_en_deposito;
    v_ok := found;
    if not v_ok then
      raise exception 'No hay stock suficiente de %: hay % y se necesitan %.', v_codigo,
        coalesce((select s.stock from public.stock_por_deposito s where s.deposito_id = v_dep and s.item_id = p_item_id), 0), -p_delta
        using errcode = 'check_violation';
    end if;
  else
    insert into public.stock_por_deposito as s (deposito_id, item_id, stock) values (v_dep, p_item_id, p_delta)
    on conflict (deposito_id, item_id) do update set stock = s.stock + p_delta returning s.stock into v_en_deposito;
  end if;
  update public.items set stock = coalesce(stock, 0) + p_delta where id = p_item_id returning stock into v_total;
  perform set_config('app.mover_stock', 'off', true);

  if p_ref_tabla = 'ajustes_inventario' then
    select a.clase, public.comprobante_texto(a.clase, a.punto_venta, a.numero), a.referencia, a.motivo
      into v_tipo, v_comprobante, v_referencia, v_motivo
    from public.ajustes_inventario a where a.id = p_ref_id;
    v_detalle := coalesce(v_detalle, case v_tipo when 'carga' then 'Carga de stock' else 'Ajuste de inventario' end);
  elsif p_ref_tabla = 'retiros' then
    select s.nombre, r.observacion_general into v_sector, v_motivo
    from public.retiros r left join public.sectores s on s.id = r.sector_id where r.id = p_ref_id;
  elsif p_ref_tabla = 'reparaciones' then
    select r.motivo into v_motivo from public.reparaciones r where r.id = p_ref_id;
  end if;

  insert into public.movimientos_stock (item_id, deposito_id, tipo, detalle, entrada, salida, existencia, comprobante, referencia, sector, motivo, ref_tabla, ref_id, usuario_id)
  values (p_item_id, v_dep, coalesce(v_tipo, 'otro'), coalesce(v_detalle, 'Movimiento de stock'), greatest(p_delta, 0), greatest(-p_delta, 0), v_en_deposito,
          v_comprobante, v_referencia, v_sector, v_motivo, p_ref_tabla, p_ref_id, (select auth.uid()));
  return v_total;
end;
$$;
revoke execute on function public.mover_stock(uuid, numeric, text, text, text, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6) Control de integridad: el total de cada repuesto tiene que ser la suma de sus depósitos
-- ---------------------------------------------------------------------------------------------
-- Devuelve cuántos repuestos no cuadran (tiene que ser 0). Es para controles periódicos y para las pruebas; no se le da a las personas.
create or replace function public.repuestos_sin_cuadrar_con_sus_depositos()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*) from public.items i
  where coalesce(i.stock, 0) <> coalesce((select sum(s.stock) from public.stock_por_deposito s where s.item_id = i.id), 0)
$$;
revoke execute on function public.repuestos_sin_cuadrar_con_sus_depositos() from public, anon, authenticated;
grant execute on function public.repuestos_sin_cuadrar_con_sus_depositos() to service_role;

-- Herramienta de reparación y de carga de datos de prueba: vuelve a armar el stock del depósito principal a partir del total de cada repuesto (items.stock).
-- No es para uso común: solo el dueño de la base y la clave de servicio.
create or replace function public.reconstruir_stock_por_deposito()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_n bigint;
begin
  perform set_config('app.mover_stock', 'on', true);
  delete from public.stock_por_deposito;
  insert into public.stock_por_deposito (deposito_id, item_id, stock)
  select public.deposito_principal(), i.id, i.stock from public.items i where i.stock is not null and i.stock > 0;
  get diagnostics v_n = row_count;
  perform set_config('app.mover_stock', 'off', true);
  return v_n;
end;
$$;
revoke execute on function public.reconstruir_stock_por_deposito() from public, anon, authenticated;
grant execute on function public.reconstruir_stock_por_deposito() to service_role;
