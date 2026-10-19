// La búsqueda de repuestos y el informe de reposición con muchísimos datos, sin competencia: cuánto tarda cada tipo de búsqueda con 200.000 repuestos buscando "a mano" sobre la tabla (como se hacía)
// y con la función buscar_repuestos, y si la función devuelve lo que tiene que devolver. Con las reglas de seguridad puestas, como las ve una persona real.
//   node scripts/pruebas/concurrencia/busqueda.mjs [--items 200000] [--estricto]
import { performance } from 'node:perf_hooks';
import { sembrar } from '../escala/sembrar.mjs';
import { iniciarPostgres, instalarEsquema } from './postgres-real.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const ITEMS = arg('items', 200_000), ESTRICTO = process.argv.includes('--estricto');
const PRESUPUESTO_MS = arg('presupuesto', 150), PRESUPUESTO_REPOSICION_MS = arg('presupuesto-reposicion', 400);
const U = '00000000-0000-0000-0000-000000000001';

const servidor = await iniciarPostgres({ puerto: arg('puerto', 55433), conexiones: 20 });
let admin, codigoDeSalida = 0;
try {
  admin = await servidor.pool(1).connect();
  await instalarEsquema(admin);
  await admin.query(`update public.licencia set modulos = '{"deposito":true,"proveedores":true,"comisionistas":true,"envios":true,"mantenimiento":true,"tareas":true}'::jsonb`);
  await sembrar(sql => admin.query(sql), { items: ITEMS, retiros: 1000, auditoria: 1000 });
  await admin.query(`insert into public.usuarios_perfil (id, email, nombre, apellido, rol, activo, mantenimiento_rol) select id, email, 'Usuario', 'Prueba', 'admin', true, 'admin' from auth.users on conflict (id) do update set activo = true, rol = excluded.rol, mantenimiento_rol = 'admin'`); // activo y con acceso al Depósito (la búsqueda lo exige)
  await admin.query(`set role authenticated; select set_config('request.jwt.claim.sub', '${U}', false)`);
  // un código con ceros a la izquierda y un repuesto con detalles, para comprobar esos casos
  const [fam] = (await admin.query(`select id from public.familias order by codigo limit 1`)).rows;
  const [sub] = (await admin.query(`select id from public.subfamilias where familia_id = $1 order by codigo limit 1`, [fam.id])).rows;
  await admin.query(`reset role`);
  await admin.query(`select set_config('app.mover_stock', 'on', false)`);
  await admin.query(`insert into public.items (codigo, numero, descripcion, detalles, familia_id, subfamilia_id, stock) values ('MZZPU00003', '00003', 'Repuesto especial único', 'compatible con la prensa hidráulica XJ-77', '${fam.id}', '${sub.id}', 1)`);
  await admin.query(`insert into public.items (codigo, numero, descripcion, familia_id, subfamilia_id, stock, stock_minimo, punto_pedido) values ('MZZRP00007', '00007', 'Sello especial de reposición', '${fam.id}', '${sub.id}', 2, 10, 5)`);
  await admin.query(`select set_config('app.mover_stock', 'off', false)`);
  await admin.query(`analyze public.items`);
  await admin.query(`set role authenticated; select set_config('request.jwt.claim.sub', '${U}', false)`);

  const medir = async (sql, params) => {
    const t = []; let filas = 0;
    for (let i = 0; i < 5; i++) { const t0 = performance.now(); const r = await admin.query(sql, params); t.push(performance.now() - t0); filas = r.rowCount; }
    t.sort((a, b) => a - b); return { ms: t[2], filas };
  };
  const CASOS = [
    ['una palabra muy común', 'rodamiento'],
    ['una palabra poco común', 'xj-77'],
    ['dos palabras', 'bomba 12'],
    ['varias palabras', 'valvula tipo 5 medida'],
    ['un código parcial', 'MAAAA00'],
    ['un código sin los ceros', 'PU3'],
    ['algo que no existe', 'zzzz-nada'],
    ['con "de" y "para"', 'filtro de aceite para motor'],
  ];
  console.log(`\n${ITEMS.toLocaleString('es-AR')} repuestos, con las reglas de seguridad puestas (mediana de 5 búsquedas)\n`);
  console.log('búsqueda'.padEnd(30) + 'directa'.padStart(11) + 'función'.padStart(11) + '  filas');
  let problemas = 0;
  for (const [nombre, texto] of CASOS) {
    const directa = await medir(`select id, codigo, descripcion, stock from public.items where activo and (codigo ilike $1 or descripcion ilike $1) order by codigo limit 50`, [`%${texto}%`]);
    const funcion = await medir(`select * from public.buscar_repuestos($1, 50)`, [texto]);
    const lento = funcion.ms > PRESUPUESTO_MS;
    if (lento) problemas++;
    console.log(`${lento ? '✗' : '✓'} ${nombre}`.padEnd(30) + `${directa.ms.toFixed(0)} ms`.padStart(11) + `${funcion.ms.toFixed(0)} ms`.padStart(11) + `  ${funcion.filas}`);
  }

  // ---- el informe de reposición: lo que hay que comprar (hasta 500 filas, con el total) ----
  const cuentaRegla = Number((await admin.query(`select count(*) as n from public.items where activo and stock_minimo > 0 and coalesce(stock, 0) <= punto_pedido`)).rows[0].n);
  console.log(`\ninforme de reposición: ${cuentaRegla.toLocaleString('es-AR')} repuestos a reponer (mediana de 5 consultas, hasta 500 filas con el total)\n`);
  console.log('informe'.padEnd(36) + 'función'.padStart(11) + '  filas');
  for (const [nombre, texto, familia, estado] of [
    ['sin filtros (los 500 más urgentes)', null, null, null],
    ['con texto', 'rodamiento', null, null],
    ['con dos palabras', 'bomba tipo', null, null],
    ['por familia', null, fam.id, null],
    ['solo los sin marcar', null, null, 'sin'],
    ['texto + familia + estado', 'bomba', fam.id, 'sin'],
  ]) {
    const r = await medir('select * from public.repuestos_a_reponer($1, $2, $3, 500)', [texto, familia, estado]);
    const lento = r.ms > PRESUPUESTO_REPOSICION_MS;
    if (lento) problemas++;
    console.log(`${lento ? '✗' : '✓'} ${nombre}`.padEnd(36) + `${r.ms.toFixed(0)} ms`.padStart(11) + `  ${r.filas}`);
  }
  const todoRepo = (await admin.query('select * from public.repuestos_a_reponer(null, null, null, 5000)')).rows;
  const sinStockRegla = Number((await admin.query(`select count(*) as n from public.items where activo and stock_minimo > 0 and coalesce(stock, 0) <= punto_pedido and coalesce(stock, 0) = 0`)).rows[0].n);
  const urgencia = (a, b) => (Number(a.stock ?? 0) > 0) - (Number(b.stock ?? 0) > 0) || (Number(b.stock_minimo) - Number(b.stock ?? 0)) - (Number(a.stock_minimo) - Number(a.stock ?? 0)) || (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0);
  const ordenado = todoRepo.every((r, i) => i === 0 || urgencia(todoRepo[i - 1], r) <= 0);

  // ---- ¿devuelve lo que tiene que devolver? ----
  const q = async (texto, extra = []) => (await admin.query(`select * from public.buscar_repuestos($1, 50${extra.length ? ', $2, $3' : ''})`, [texto, ...extra])).rows;
  const revisiones = [];
  const sinCeros = await q('PU3'); revisiones.push(['un código escrito sin ceros ("PU3") encuentra "MZZPU00003"', sinCeros.some(r => r.codigo === 'MZZPU00003')]);
  const enDetalles = await q('prensa hidráulica'); revisiones.push(['encuentra por lo que dice en los detalles', enDetalles[0]?.codigo === 'MZZPU00003']);
  const todas = await q('valvula tipo 5 medida'); revisiones.push(['con varias palabras, primero los que tienen todas', todas.length > 0 && todas.slice(0, 5).every(r => r.puntaje === 4 && /valvula/.test(r.descripcion) && /tipo/.test(r.descripcion) && /medida/.test(r.descripcion))]);
  const alguna = await q('filtro aceite motor'); revisiones.push(['si ninguno tiene todas las palabras, devuelve los que tienen alguna', alguna.length > 0 && alguna.every(r => /filtro|motor/.test(r.descripcion))]);
  const ordenadas = await q('filtro de aceite para motor'); revisiones.push(['"de" y "para" no cuentan como palabras', ordenadas.length > 0 && ordenadas.every(r => r.puntaje >= 1)]);
  const comodines = await q('%'); revisiones.push(['un "%" escrito no busca "todo": se toma como letra', comodines.length === 0]);
  const vacio = await q('   '); revisiones.push(['sin texto no devuelve nada', vacio.length === 0]);
  const porFam = await q('rodamiento', [fam.id, sub.id]); revisiones.push(['filtra por familia y subfamilia', porFam.length > 0 && porFam.every(r => r.familia_id === fam.id && r.subfamilia_id === sub.id)]);
  const limite = (await admin.query(`select count(*) as n from public.buscar_repuestos('rodamiento', 7)`)).rows[0].n; revisiones.push(['respeta el límite pedido', Number(limite) === 7]);

  // informe de reposición
  const rr = async (...a) => (await admin.query('select * from public.repuestos_a_reponer($1, $2, $3, $4)', a)).rows;
  revisiones.push(['reposición: el total coincide con la regla (stock mínimo cargado y stock en el punto de pedido o por debajo)', todoRepo.length > 0 && Number(todoRepo[0].total) === cuentaRegla && todoRepo.length === Math.min(cuentaRegla, 5000)]);
  revisiones.push(['reposición: todos los que trae cumplen la regla', todoRepo.every(r => Number(r.stock_minimo) > 0 && Number(r.stock ?? 0) <= Number(r.punto_pedido))]);
  revisiones.push(['reposición: primero los sin stock, después los de mayor cantidad a comprar', ordenado]);
  revisiones.push(['reposición: informa cuántos están sin stock', Number(todoRepo[0]?.total_sin_stock) === sinStockRegla]);
  const pocos = await rr(null, null, null, 7); revisiones.push(['reposición: respeta el límite pero informa el total', pocos.length === 7 && Number(pocos[0].total) === cuentaRegla]);
  revisiones.push(['reposición: un texto escrito sin ceros ("RP7") encuentra "MZZRP00007"', (await rr('RP7', null, null, 50)).some(r => r.codigo === 'MZZRP00007')]);
  revisiones.push(['reposición: con varias palabras deben estar todas', (await rr('sello especial', null, null, 50)).some(r => r.codigo === 'MZZRP00007') && (await rr('sello inexistente', null, null, 50)).length === 0]);
  const deFam = await rr(null, fam.id, null, 500); revisiones.push(['reposición: filtra por familia', deFam.length > 0 && deFam.every(r => r.familia_id === fam.id)]);
  await admin.query('reset role');
  await admin.query("update public.items set estado_reposicion = 'compras' where codigo = 'MZZRP00007'");
  await admin.query(`set role authenticated; select set_config('request.jwt.claim.sub', '${U}', false)`);
  const conEstado = await rr('RP7', null, 'compras', 50), sinMarcar = await rr('RP7', null, 'sin', 50), otroEstado = await rr('RP7', null, 'presupuesto', 50), cualquiera = await rr('RP7', null, '', 50);
  revisiones.push(['reposición: filtra por estado ("compras", "sin marcar", "presupuesto" y cualquiera)', conEstado.length === 1 && sinMarcar.length === 0 && otroEstado.length === 0 && cualquiera.length === 1]);
  revisiones.push(['reposición: no trae los que ya llegaron al stock mínimo ni los sin mínimo cargado', !(await rr('MZZPU00003', null, null, 50)).length]);
  revisiones.push(['reposición: un "%" escrito no trae todo', (await rr('%', null, null, 50)).length === 0]);
  await admin.query(`reset role`);
  await admin.query(`update public.licencia set modulos = jsonb_set(modulos, '{deposito}', 'false'::jsonb)`);
  await admin.query(`set role authenticated; select set_config('request.jwt.claim.sub', '${U}', false)`);
  let apagado = false; try { await admin.query(`select * from public.buscar_repuestos('rodamiento')`); } catch (e) { apagado = /no está activo/.test(e.message); }
  revisiones.push(['con el módulo de depósito apagado no devuelve nada (error)', apagado]);
  let apagadoRepo = false; try { await admin.query('select * from public.repuestos_a_reponer()'); } catch (e) { apagadoRepo = /no está activo/.test(e.message); }
  revisiones.push(['reposición: con el módulo de depósito apagado no devuelve nada (error)', apagadoRepo]);
  await admin.query(`reset role`);
  await admin.query(`set role anon`);
  let sinSesion = false; try { await admin.query(`select * from public.buscar_repuestos('rodamiento')`); } catch (e) { sinSesion = /permission denied/.test(e.message); }
  revisiones.push(['sin sesión no se puede usar', sinSesion]);
  let sinSesionRepo = false; try { await admin.query('select * from public.repuestos_a_reponer()'); } catch (e) { sinSesionRepo = /permission denied/.test(e.message); }
  revisiones.push(['reposición: sin sesión no se puede usar', sinSesionRepo]);
  await admin.query(`reset role`);

  console.log('\nsi devuelve lo que tiene que devolver:');
  for (const [nombre, ok] of revisiones) { console.log(`  ${ok ? '✓' : '✗'} ${nombre}`); if (!ok) problemas++; }
  console.log(`\n${problemas === 0 ? 'Todo en orden' : problemas + ' problema(s)'}`);
  if (ESTRICTO && problemas) codigoDeSalida = 1;
} catch (e) { console.error('la prueba falló:', e); codigoDeSalida = 1; }
finally { try { admin?.release(); } catch { /* ya liberada */ } await servidor.apagar(); }
process.exit(codigoDeSalida);
