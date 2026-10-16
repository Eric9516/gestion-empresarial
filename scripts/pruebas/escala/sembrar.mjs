// Datos sintéticos para las pruebas de escala y de concurrencia: familias, repuestos, proveedores, retiros con sus líneas y auditoría, en las cantidades que se pidan.
// `ejecutar(sql)` corre SQL en UNA sola conexión (hace falta: desactiva los disparadores durante la carga y usa tablas temporales).
export async function sembrar(ejecutar, { items, retiros, auditoria, usuarios = 300 }, registrar = console.log) {
  const paso = async (nombre, sql) => { const t = Date.now(); await ejecutar(sql); registrar(`  ${nombre} (${((Date.now() - t) / 1000).toFixed(1)} s)`); };
  registrar(`cargando datos: ${items.toLocaleString('es-AR')} repuestos, ${retiros.toLocaleString('es-AR')} retiros (${(retiros * 4).toLocaleString('es-AR')} líneas), ${auditoria.toLocaleString('es-AR')} registros de auditoría`);
  // Sin disparadores durante la carga (la auditoría y demás se probaron aparte); las claves, índices y reglas quedan como en la base real.
  await ejecutar(`set session_replication_role = replica;`);
  await paso('usuarios', `insert into auth.users (id, email) select ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'u' || i || '@escala.test' from generate_series(1, ${usuarios}) i;`);
  await paso('familias, subfamilias, sectores', `
  insert into public.familias (codigo, nombre) select chr(65 + (i - 1) / 26) || chr(65 + (i - 1) % 26), 'Familia ' || i from generate_series(1, 60) i;
  insert into public.subfamilias (familia_id, codigo, nombre) select f.id, 'A' || chr(64 + s), 'Subfamilia ' || s from public.familias f, generate_series(1, 12) s;
  insert into public.sectores (nombre) select 'Sector ' || i from generate_series(1, 40) i;`);
  await paso('repuestos', `
  select set_config('app.mover_stock', 'on', true);
  insert into public.items (codigo, numero, descripcion, familia_id, subfamilia_id, stock, stock_minimo, punto_pedido, ubicacion, detalles)
  select 'M' || f.codigo || s.codigo || lpad(n::text, 5, '0'), lpad(n::text, 5, '0'),
    (array['rodamiento','junta','tornillo','bomba','valvula','sensor','correa','filtro','motor','reten','acople','resorte'])[1 + (n % 12)] || ' tipo ' || (n % 97) || ' medida ' || (n % 53),
    s.familia_id, s.id, (random() * 100)::int, 5, 8, 'Estante ' || (n % 40), case when n % 5 = 0 then 'compatible con equipo ' || (n % 31) end
  from (select id, familia_id, codigo, row_number() over () as rn from public.subfamilias) s
  join public.familias f on f.id = s.familia_id
  cross join lateral generate_series(1, ${Math.ceil(items / 720)}) n
  limit ${items};`);
  await paso('proveedores y contactos', `
  insert into public.proveedores (nombre, rubro, localidad) select 'Proveedor ' || i, 'Rubro ' || (i % 30), 'Localidad ' || (i % 200) from generate_series(1, 5000) i;
  insert into public.contactos (proveedor_id, nombre, email) select p.id, 'Contacto ' || c, 'c' || c || '@x.test' from public.proveedores p, generate_series(1, 3) c;`);
  await paso('retiros', `
  create temp table _sectores as select id, row_number() over () as rn from public.sectores;
  insert into public.retiros (usuario_id, sector_id, created_at)
  select ('00000000-0000-0000-0000-' || lpad((1 + (i % ${usuarios}))::text, 12, '0'))::uuid, (select id from _sectores where rn = 1 + (i % 40)), now() - (random() * interval '1100 days')
  from generate_series(1, ${retiros}) i;`);
  await paso('líneas de retiro', `
  create temp table _ids as select id, row_number() over () as rn from public.items;
  create index on _ids (rn);
  insert into public.retiro_items (retiro_id, item_id, cantidad)
  select r.id, (select id from _ids where rn = 1 + ((hashtext(r.id::text || k::text) & 2147483647) % ${items})), 1 + (k % 4)
  from public.retiros r cross join generate_series(1, 4) k;`);
  await paso('auditoría', `
  insert into public.audit_log (tabla, registro_id, accion, usuario_id, created_at)
  select 'items', gen_random_uuid()::text, 'update', ('00000000-0000-0000-0000-' || lpad((1 + (i % ${usuarios}))::text, 12, '0'))::uuid, now() - (random() * interval '1100 days')
  from generate_series(1, ${auditoria}) i;`);
  await ejecutar(`set session_replication_role = origin;`);
  await paso('estadísticas (ANALYZE)', 'analyze;');
}
