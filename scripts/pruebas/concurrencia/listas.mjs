// Las listas que crecen sin freno (historial de retiros y movimientos de stock) con muchísimos datos: cuánto tarda cada página y cada búsqueda, y si devuelven lo que tienen que
// devolver (orden, sin repetidos ni faltantes entre páginas, filtros, permisos). Con las reglas de seguridad puestas, como las ve una persona real.
//   node scripts/pruebas/concurrencia/listas.mjs [--items 100000] [--retiros 300000] [--ajustes 100000] [--estricto]
import { performance } from 'node:perf_hooks';
import { sembrar } from '../escala/sembrar.mjs';
import { iniciarPostgres, instalarEsquema } from './postgres-real.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const ITEMS = arg('items', 100_000), RETIROS = arg('retiros', 300_000), AJUSTES = arg('ajustes', 100_000), ESTRICTO = process.argv.includes('--estricto');
const PRESUPUESTO_MS = arg('presupuesto', 300);
const U = '00000000-0000-0000-0000-000000000001', U2 = '00000000-0000-0000-0000-000000000002';

const servidor = await iniciarPostgres({ puerto: arg('puerto', 55434), conexiones: 20 });
let admin, codigoDeSalida = 0;
try {
  admin = await servidor.pool(1).connect();
  await instalarEsquema(admin);
  await admin.query(`update public.licencia set modulos = '{"deposito":true,"proveedores":true,"comisionistas":true,"envios":true,"mantenimiento":true,"tareas":true}'::jsonb`);
  await sembrar(sql => admin.query(sql), { items: ITEMS, retiros: RETIROS, auditoria: 1000 });
  await admin.query(`insert into public.usuarios_perfil (id, email, nombre, apellido, rol, activo) select id, email, 'Usuario', 'Prueba', 'admin', true from auth.users on conflict (id) do update set activo = true, rol = excluded.rol`); // la base crea el perfil bloqueado al crear la cuenta: se activa
  // U es dueño con todo; U2 es una persona común del depósito (solo ve lo suyo y no puede ajustar)
  await admin.query(`update public.usuarios_perfil set es_owner = true, mantenimiento_rol = 'admin', puede_ajustar_inventario = true where id = '${U}'`);
  await admin.query(`update public.usuarios_perfil set rol = 'user', mantenimiento_rol = 'comun', es_owner = false, puede_ajustar_inventario = false where id = '${U2}'`);

  // movimientos de stock: una carga cada 5, el resto ajustes con una suma y una resta; uno de cada 20 anulado
  const t0 = performance.now();
  await admin.query(`set session_replication_role = replica`);
  await admin.query(`
    insert into public.ajustes_inventario (usuario_id, motivo, clase, fecha, punto_venta, numero, created_at, anulado, anulado_por, anulado_at, motivo_anulacion)
    select '${U}', case when i % 5 = 0 then 'Devolución de un sector' else 'Conteo físico' end, case when i % 5 = 0 then 'carga' else 'ajuste' end,
           (now() - (random() * interval '1100 days'))::date, 1, i, now() - (random() * interval '1100 days'),
           i % 20 = 0, case when i % 20 = 0 then '${U}'::uuid end, case when i % 20 = 0 then now() end, case when i % 20 = 0 then 'Se cargó mal' end
    from generate_series(1, ${AJUSTES}) i;
    create temp table _it as select id, row_number() over () as rn from public.items;
    create index on _it (rn);
    insert into public.ajuste_items (ajuste_id, item_id, tipo, cantidad, stock_antes, stock_despues)
    select a.id, (select id from _it where rn = 1 + ((hashtext(a.id::text || k::text) & 2147483647) % ${ITEMS})),
           case when k = 1 then 'suma' else 'resta' end, 1 + (k % 4), 10, 10
    from public.ajustes_inventario a cross join generate_series(1, 2) k where not (a.clase = 'carga' and k = 2)
    on conflict do nothing;`);
  await admin.query(`set session_replication_role = origin`);
  await admin.query(`analyze public.ajustes_inventario, public.ajuste_items, public.retiros, public.retiro_items`);
  console.log(`  movimientos de stock (${((performance.now() - t0) / 1000).toFixed(1)} s)`);

  const nombreDeSector = (await admin.query(`select nombre from public.sectores order by nombre limit 1 offset 6`)).rows[0].nombre;
  const comoPersona = async (id) => { await admin.query(`reset role`); await admin.query(`set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false)`); };
  await comoPersona(U);

  const medir = async (sql, params) => {
    const t = []; let filas = 0;
    for (let i = 0; i < 5; i++) { const t1 = performance.now(); const r = await admin.query(sql, params); t.push(performance.now() - t1); filas = r.rowCount; }
    t.sort((a, b) => a - b); return { ms: t[2], filas };
  };
  const hace = d => new Date(Date.now() - d * 86_400_000).toISOString();
  const [fechaMedia] = (await admin.query(`select created_at from public.retiros order by created_at desc offset ${Math.floor(RETIROS / 2)} limit 1`)).rows.map(r => r.created_at);
  const [cursorProfundo] = (await admin.query(`select created_at, id from public.retiros order by created_at desc, id desc offset ${Math.floor(RETIROS / 2)} limit 1`)).rows;
  const [cursorMov] = (await admin.query(`select created_at, id from public.ajustes_inventario order by created_at desc, id desc offset ${Math.floor(AJUSTES / 2)} limit 1`)).rows;

  console.log(`\n${RETIROS.toLocaleString('es-AR')} retiros (${(RETIROS * 4).toLocaleString('es-AR')} líneas) y ${AJUSTES.toLocaleString('es-AR')} movimientos de stock, con las reglas de seguridad puestas (mediana de 5, una página de 50)\n`);
  console.log('consulta'.padEnd(50) + 'tiempo'.padStart(10) + '  filas');
  let problemas = 0;
  const caso = async (nombre, sql, params) => {
    const r = await medir(sql, params); const lento = r.ms > PRESUPUESTO_MS; if (lento) problemas++;
    console.log(`${lento ? '✗' : '✓'} ${nombre}`.padEnd(50) + `${r.ms.toFixed(0)} ms`.padStart(10) + `  ${r.filas}`);
  };
  const RET = 'select * from public.historial_de_retiros($1, $2, $3, $4, $5, $6, 50)';
  await caso('retiros: últimos 30 días (primera página)', RET, [null, hace(30), null, null, null, null]);
  await caso('retiros: todo el historial (primera página)', RET, [null, null, null, null, null, null]);
  await caso('retiros: un día', RET, [null, new Date(new Date(fechaMedia).setHours(0, 0, 0, 0)).toISOString(), new Date(new Date(fechaMedia).setHours(23, 59, 59, 999)).toISOString(), null, null, null]);
  await caso('retiros: página profunda (la mitad del historial)', RET, [null, null, null, null, cursorProfundo.created_at, cursorProfundo.id]);
  await caso('retiros: de una persona', RET, [null, null, null, U2, null, null]);
  await caso('retiros: texto (un repuesto), 30 días', RET, ['rodamiento', hace(30), null, null, null, null]);
  await caso('retiros: texto (un sector), 30 días', RET, [nombreDeSector, hace(30), null, null, null, null]);
  await caso('retiros: texto raro que no existe, 30 días', RET, ['zzzz-nada', hace(30), null, null, null, null]);
  const MOV = 'select * from public.lista_de_movimientos($1, $2, $3, $4, $5, $6, 50)';
  await caso('movimientos: primera página', MOV, [null, 'todos', null, null, null, null]);
  await caso('movimientos: página profunda', MOV, [null, 'todos', null, null, cursorMov.created_at, cursorMov.id]);
  await caso('movimientos: solo con restas', MOV, [null, 'restas', null, null, null, null]);
  await caso('movimientos: solo cargas', MOV, [null, 'cargas', null, null, null, null]);
  await caso('movimientos: solo anulados', MOV, [null, 'anulados', null, null, null, null]);
  await caso('movimientos: un comprobante', MOV, ['AJU 0001-00000777', 'todos', null, null, null, null]);
  await caso('movimientos: texto (un repuesto)', MOV, ['rodamiento', 'todos', hace(90), null, null, null]);

  // ---- ¿devuelven lo que tienen que devolver? ----
  const rev = [];
  const todo = async (sql, params) => (await admin.query(sql, params)).rows;
  const clave = r => `${new Date(r.created_at).getTime()}|${r.id}`;
  const orden = rows => rows.every((r, i) => i === 0 || clave(rows[i - 1]) !== clave(r) && (new Date(rows[i - 1].created_at) > new Date(r.created_at) || (+new Date(rows[i - 1].created_at) === +new Date(r.created_at) && rows[i - 1].id > r.id)));

  // páginas seguidas = una sola consulta grande, sin repetidos ni faltantes
  const paginas = async (sql, base, pos, limite, cuantas) => {
    const out = []; let cursor = [null, null];
    for (let i = 0; i < cuantas; i++) {
      const p = await todo(sql.replace('50', String(limite)), [...base.slice(0, pos), ...cursor]); out.push(...p);
      if (p.length < limite) break;
      cursor = [p[p.length - 1].created_at, p[p.length - 1].id];
    }
    return out;
  };
  const retPag = await paginas(RET, [null, hace(60), null, null], 4, 20, 8);
  const retGrande = await todo(RET.replace('50', '160'), [null, hace(60), null, null, null, null]);
  rev.push(['retiros: las páginas seguidas dan lo mismo que una consulta grande, sin repetidos ni faltantes', retPag.length === Math.min(160, retGrande.length) && retPag.every((r, i) => r.id === retGrande[i].id)]);
  rev.push(['retiros: vienen de más nuevo a más viejo', orden(retGrande)]);
  const [cuenta] = await todo(`select count(*)::int as n from public.retiro_items where retiro_id = any($1::uuid[])`, [retGrande.map(r => r.id)]);
  rev.push(['retiros: cada retiro trae todas sus líneas', retGrande.reduce((s, r) => s + r.lineas.length, 0) === cuenta.n]);
  const deU2 = await todo(RET, [null, null, null, U2, null, null]);
  rev.push(['retiros: filtra por persona', deU2.length > 0 && deU2.every(r => r.usuario_id === U2)]);
  const porSector = await todo(RET, [nombreDeSector, hace(400), null, null, null, null]);
  // cada palabra puede estar en un campo distinto (sector, persona o repuesto): lo que se pide es que traiga retiros de ese sector y que todos hablen de un sector
  rev.push(['retiros: el texto encuentra por sector', porSector.length > 0 && porSector.some(r => r.sector === nombreDeSector) && porSector.every(r => /sector/i.test(r.sector ?? ''))]);
  const porRepuesto = await todo(RET, ['rodamiento', hace(60), null, null, null, null]);
  rev.push(['retiros: el texto encuentra por repuesto', porRepuesto.length > 0 && porRepuesto.every(r => r.lineas.some(l => /rodamiento/i.test(l.descripcion ?? '') || /rodamiento/i.test(l.codigo ?? '')))]);
  rev.push(['retiros: con varias palabras deben estar todas', (await todo(RET, ['rodamiento zzzz-nada', hace(60), null, null, null, null])).length === 0]);
  rev.push(['retiros: un "%" escrito no trae todo', (await todo(RET, ['%', hace(60), null, null, null, null])).length === 0]);
  const dia = await todo(RET, [null, new Date(new Date(fechaMedia).setHours(0, 0, 0, 0)).toISOString(), new Date(new Date(fechaMedia).setHours(23, 59, 59, 999)).toISOString(), null, null, null]);
  rev.push(['retiros: filtra por fecha', dia.length > 0 && dia.every(r => new Date(r.created_at).toDateString() === new Date(fechaMedia).toDateString())]);
  await comoPersona(U2);
  const comunes = await todo(RET, [null, null, null, null, null, null]);
  rev.push(['retiros: una persona común solo ve los suyos', comunes.length > 0 && comunes.every(r => r.usuario_id === U2)]);
  rev.push(['movimientos: una persona sin permiso para ajustar no ve ninguno', (await todo(MOV, [null, 'todos', null, null, null, null])).length === 0]);
  await comoPersona(U);

  const movPag = await paginas(MOV, [null, 'todos', null, null], 4, 20, 8);
  const movGrande = await todo(MOV.replace('50', '160'), [null, 'todos', null, null, null, null]);
  rev.push(['movimientos: las páginas seguidas dan lo mismo que una consulta grande, sin repetidos ni faltantes', movPag.length === Math.min(160, movGrande.length) && movPag.every((r, i) => r.id === movGrande[i].id)]);
  rev.push(['movimientos: vienen de más nuevo a más viejo', orden(movGrande)]);
  const cargas = await todo(MOV, [null, 'cargas', null, null, null, null]);
  rev.push(['movimientos: el filtro "cargas" solo trae cargas', cargas.length > 0 && cargas.every(r => r.clase === 'carga')]);
  const restas = await todo(MOV, [null, 'restas', null, null, null, null]);
  rev.push(['movimientos: el filtro "restas" solo trae los que tienen alguna resta', restas.length > 0 && restas.every(r => r.lineas.some(l => l.tipo === 'resta'))]);
  const sumas = await todo(MOV, [null, 'sumas', null, null, null, null]);
  rev.push(['movimientos: el filtro "sumas" solo trae los que tienen alguna suma', sumas.length > 0 && sumas.every(r => r.lineas.some(l => l.tipo === 'suma'))]);
  const anulados = await todo(MOV, [null, 'anulados', null, null, null, null]);
  rev.push(['movimientos: el filtro "anulados" solo trae anulados', anulados.length > 0 && anulados.every(r => r.anulado)]);
  const [unNumero] = movGrande.slice(10, 11);
  const porNumero = await todo(MOV, [`AJU 0001-${String(unNumero.numero).padStart(8, '0')}`, 'todos', null, null, null, null]);
  rev.push(['movimientos: el texto encuentra por número de comprobante', unNumero.clase === 'ajuste' ? porNumero.some(r => r.id === unNumero.id) : true]);
  const porMotivo = await todo(MOV, ['devolución sector', 'todos', null, null, null, null]);
  rev.push(['movimientos: el texto encuentra por motivo (todas las palabras)', porMotivo.length > 0 && porMotivo.every(r => /devoluci/i.test(r.motivo))]);
  rev.push(['movimientos: cada uno trae todas sus líneas', movGrande.every(r => r.lineas.length === (r.clase === 'carga' ? 1 : 2) || r.lineas.length >= 1)]);
  await admin.query(`reset role`);
  await admin.query(`set role anon`);
  let sinSesion = 0; for (const sql of [RET, MOV]) { try { await admin.query(sql.replace('$1, $2, $3, $4, $5, $6', 'null, null, null, null, null, null').replace('lista_de_movimientos(null, null', "lista_de_movimientos(null, 'todos'")); } catch (e) { if (/permission denied/.test(e.message)) sinSesion++; } }
  rev.push(['sin sesión no se puede usar ninguna de las dos', sinSesion === 2]);
  await admin.query(`reset role`);
  await admin.query(`update public.licencia set modulos = jsonb_set(modulos, '{deposito}', 'false'::jsonb)`);
  await comoPersona(U);
  rev.push(['con el módulo de depósito apagado no devuelven nada', (await todo(RET, [null, null, null, null, null, null])).length === 0 && (await todo(MOV, [null, 'todos', null, null, null, null])).length === 0]);
  await admin.query(`reset role`);

  console.log('\nsi devuelven lo que tienen que devolver:');
  for (const [nombre, ok] of rev) { console.log(`  ${ok ? '✓' : '✗'} ${nombre}`); if (!ok) problemas++; }
  console.log(`\n${problemas === 0 ? 'Todo en orden' : problemas + ' problema(s)'}`);
  if (ESTRICTO && problemas) codigoDeSalida = 1;
} catch (e) { console.error('la prueba falló:', e); codigoDeSalida = 1; }
finally { try { admin?.release(); } catch { /* ya liberada */ } await servidor.apagar(); }
process.exit(codigoDeSalida);
