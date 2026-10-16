// PRUEBA DE CARGA Y CONCURRENCIA contra una PostgreSQL real.
//
// Llena la base con datos sintéticos y después pone a trabajar a muchas personas a la vez (por defecto 40): buscan, listan, miran el historial, editan, retiran, ajustan, crean y
// borran repuestos, todo mezclado y durante un rato, con las reglas de seguridad puestas, igual que lo vería la app (cada operación es una transacción con el rol y el usuario de quien la hace).
// Mide cuánto tarda cada operación (mediana, p95, p99, peor caso) y comprueba al final lo que NUNCA puede fallar:
//   · el stock de los repuestos más usados = stock inicial − lo retirado + lo ajustado (nada perdido ni inventado);
//   · ningún retiro quedó vacío (encabezado sin líneas);
//   · ningún bloqueo mutuo entre transacciones (deadlock);
//   · ningún código de repuesto repetido al crear a la vez.
//
//   node scripts/pruebas/concurrencia/carga.mjs [--items 100000] [--retiros 100000] [--auditoria 200000] [--usuarios 40] [--segundos 30] [--calientes 200] [--estricto]
//   --viejo : repite el comportamiento de ANTES de las correcciones (guardar el stock a ciegas, retiro en dos pasos sin orden) para comprobar que la prueba detecta los problemas.
import { performance } from 'node:perf_hooks';
import { sembrar } from '../escala/sembrar.mjs';
import { iniciarPostgres, instalarEsquema } from './postgres-real.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const ITEMS = arg('items', 100_000), RETIROS = arg('retiros', 100_000), AUDITORIA = arg('auditoria', 200_000);
const TRABAJADORES = arg('usuarios', 40), SEGUNDOS = arg('segundos', 30), CALIENTES = arg('calientes', 200);
const VIEJO = process.argv.includes('--viejo'), ESTRICTO = process.argv.includes('--estricto');
const BUSQUEDA_DIRECTA = process.argv.includes('--busqueda-directa'); // buscar sobre la tabla, sin la función (como se hacía): para comparar
const STOCK_INICIAL = 1_000_000;
const STOCK_ESCASO = 40; // repuestos con poco stock, que varias personas se disputan: sirven para comprobar que el stock NUNCA queda negativo

const dormir = ms => new Promise(r => setTimeout(r, ms));
const azar = n => Math.floor(Math.random() * n);
const elegir = lista => lista[azar(lista.length)];
const muestra = (lista, n) => { const c = [...lista]; const r = []; while (r.length < n && c.length) r.push(c.splice(azar(c.length), 1)[0]); return r; };
const uid = i => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`;

const servidor = await iniciarPostgres({ puerto: arg('puerto', 55432), conexiones: TRABAJADORES + 40 });
let codigoDeSalida = 0;
let admin;
try {
  // ---------- preparar la base ----------
  admin = await servidor.pool(1).connect();
  const t0 = Date.now();
  await instalarEsquema(admin);
  console.log(`PostgreSQL real lista con el esquema completo (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  await admin.query(`update public.licencia set modulos = '{"proveedores":true,"comisionistas":true,"envios":true,"deposito":true,"mantenimiento":true,"tareas":true}'::jsonb`);
  await sembrar(sql => admin.query(sql), { items: ITEMS, retiros: RETIROS, auditoria: AUDITORIA, usuarios: Math.max(300, TRABAJADORES + 10) });
  // (durante la carga de datos los disparadores están apagados, así que los perfiles de los usuarios se crean acá)
  await admin.query(`insert into public.usuarios_perfil (id, email, nombre, apellido, rol, activo) select id, email, 'Usuario', 'Prueba', 'user', true from auth.users on conflict (id) do nothing`);
  await admin.query(`update public.usuarios_perfil set rol = 'admin', mantenimiento_rol = 'admin', es_owner = true where id between '${uid(1)}' and '${uid(TRABAJADORES)}'`);

  const hot = (await admin.query(`select id from public.items order by codigo limit ${CALIENTES}`)).rows.map(r => r.id);
  const tibios = (await admin.query(`select id from public.items order by codigo offset ${CALIENTES} limit 3000`)).rows.map(r => r.id);
  const papelera = (await admin.query(`select id from public.items order by codigo offset ${CALIENTES + 3000} limit 500`)).rows.map(r => r.id);
  const codigos = (await admin.query(`select codigo from public.items where mod(abs(hashtext(codigo)), ${Math.max(1, Math.floor(ITEMS / 300))}) = 0 limit 300`)).rows.map(r => r.codigo);
  const escasos = (await admin.query(`select id from public.items order by codigo offset ${CALIENTES + 3600} limit 5`)).rows.map(r => r.id);
  const sectores = (await admin.query(`select id from public.sectores`)).rows.map(r => r.id);
  const [fam] = (await admin.query(`select id from public.familias order by codigo limit 1`)).rows;
  const subfamilias = (await admin.query(`select id from public.subfamilias where familia_id = $1 order by codigo limit 3`, [fam.id])).rows.map(r => r.id);
  // el stock inicial se deja como lo dejaría una persona (con su usuario), porque la base no deja tocar repuestos sin saber quién es
  await admin.query(`select set_config('request.jwt.claim.sub', '${uid(1)}', false)`);
  await admin.query(`select set_config('app.mover_stock', 'on', false)`); // solo para dejar los datos de prueba (en la aplicación el stock se cambia con mover_stock)
  await admin.query(`update public.items set stock = ${STOCK_INICIAL} where id = any($1::uuid[])`, [hot]);
  await admin.query(`update public.items set stock = ${STOCK_ESCASO} where id = any($1::uuid[])`, [escasos]);
  await admin.query(`select set_config('app.mover_stock', 'off', false)`);
  const baseRetirado = new Map((await admin.query(`select item_id, sum(cantidad) as s from public.retiro_items where item_id = any($1::uuid[]) group by item_id`, [[...hot, ...escasos]])).rows.map(r => [r.item_id, Number(r.s)]));
  const inicioDeLaPrueba = (await admin.query(`select now() as t`)).rows[0].t;

  // ---------- el trabajo ----------
  const pool = servidor.pool(TRABAJADORES + 10);
  const tiempos = new Map(), errores = new Map(), contadores = { conflictos: 0, repuestosCreados: 0, retiros: 0, rechazosPorStock: 0 };
  const registrar = (nombre, ms) => { if (!tiempos.has(nombre)) tiempos.set(nombre, []); tiempos.get(nombre).push(ms); };
  const fallar = (nombre, e) => {
    // Rechazar un retiro porque no alcanza el stock NO es un error: es la regla funcionando.
    if (String(e.message).includes('No hay stock suficiente')) { contadores.rechazosPorStock++; return; }
    const clave = `${nombre}: ${e.code ?? 'sin código'} ${String(e.message).split('\n')[0].slice(0, 70)}`; errores.set(clave, (errores.get(clave) ?? 0) + 1); };

  // Cada operación es una transacción con el rol "authenticated" y el usuario de quien la hace, como la ve la app a través de la API.
  async function tx(usuario, fn) {
    const cx = await pool.connect();
    try {
      await cx.query('begin');
      await cx.query(`set local role authenticated`);
      await cx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [usuario]);
      await cx.query(`select set_config('app.mover_stock', 'on', true)`); // el comportamiento anterior escribía el stock directo
      const r = await fn(cx);
      await cx.query('commit');
      return r;
    } catch (e) { try { await cx.query('rollback'); } catch { /* conexión caída */ } throw e; }
    finally { cx.release(); }
  }
  // Sin cambiar de rol (para reproducir el comportamiento anterior, cuando una persona podía escribir el stock directo).
  async function txComoDuenoDeLaBase(usuario, fn) {
    const cx = await pool.connect();
    try {
      await cx.query('begin');
      await cx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [usuario]);
      const r = await fn(cx);
      await cx.query('commit');
      return r;
    } catch (e) { try { await cx.query('rollback'); } catch { /* conexión caída */ } throw e; }
    finally { cx.release(); }
  }
  const medir = async (nombre, usuario, fn, comoDueno = false) => {
    const t = performance.now();
    try { const r = await (comoDueno ? txComoDuenoDeLaBase : tx)(usuario, fn); registrar(nombre, performance.now() - t); return r; }
    catch (e) { registrar(nombre, performance.now() - t); fallar(nombre, e); return null; }
  };

  const TERMINOS = ['rodamiento', 'bomba 12', 'valvula tipo 5', 'tipo 96 medida 52', 'MAAAA00', 'sensor', 'zzzz'];
  const OPERACIONES = [
    [30, 'buscar', u => BUSQUEDA_DIRECTA
      ? medir('buscar (directo sobre la tabla)', u, c => c.query(`select id, codigo, descripcion, stock from public.items where activo and (codigo ilike $1 or descripcion ilike $1) order by codigo limit 50`, [`%${elegir(TERMINOS)}%`]))
      : medir('buscar (función buscar_repuestos)', u, c => c.query(`select * from public.buscar_repuestos($1, 50)`, [elegir(TERMINOS)]))],
    [10, 'listar', u => medir('listar (siguiente tanda por clave)', u, c => c.query(`select id, codigo, numero, descripcion, stock from public.items where activo and codigo > $1 order by codigo limit 100`, [elegir(codigos)]))],
    [3, 'historial', u => medir('historial de retiros (30 días)', u, c => c.query(`select r.id, r.created_at, (select json_agg(json_build_object('id', ri.id, 'cantidad', ri.cantidad)) from public.retiro_items ri where ri.retiro_id = r.id) from public.retiros r where r.created_at >= now() - interval '30 days' order by r.created_at desc`))],
    [2, 'proveedores', u => medir('proveedores con contactos', u, c => c.query(`select p.*, (select json_agg(c) from public.contactos c where c.proveedor_id = p.id) from public.proveedores p where not eliminado order by nombre`))],
    [14, 'editar', async u => {
      // como la app: se lee el repuesto, la persona lo mira un momento y guarda TODO el formulario (con el stock que veía)
      const id = Math.random() < 0.5 ? elegir(hot) : elegir(tibios);
      const f = await medir('editar: leer', u, c => c.query(`select id, stock, updated_at::text as version from public.items where id = $1`, [id]));
      if (!f?.rows[0]) return;
      await dormir(20 + azar(120));
      const { stock, version } = f.rows[0];
      const ubicacion = `Estante ${azar(1000)}`;
      if (VIEJO) { await medir('editar: guardar', u, c => c.query(`update public.items set ubicacion = $2, stock = $3 where id = $1`, [id, ubicacion, stock]), true); return; }
      const g = await medir('editar: guardar', u, c => c.query(`update public.items set ubicacion = $2 where id = $1 and updated_at = $3::timestamptz returning id`, [id, ubicacion, version]));
      if (g && !g.rowCount) contadores.conflictos++;
    }],
    [22, 'retirar', async u => {
      const ids = muestra(hot, 1 + azar(4));
      const lineas = ids.map(item_id => ({ item_id, cantidad: 1 + azar(3), observacion: '' }));
      if (VIEJO) {
        // como antes: primero el retiro, después sus líneas en el orden en que vienen (dos pedidos, sin ordenar)
        const r = await medir('retirar: encabezado', u, c => c.query(`insert into public.retiros (usuario_id, sector_id) values ($1, $2) returning id`, [u, elegir(sectores)]));
        if (!r) return;
        const ok = await medir('retirar: líneas', u, c => c.query(`insert into public.retiro_items (retiro_id, item_id, cantidad) select $1, (l->>'item_id')::uuid, (l->>'cantidad')::numeric from jsonb_array_elements($2::jsonb) with ordinality as t(l, n) order by n`, [r.rows[0].id, JSON.stringify(lineas)]));
        if (ok) contadores.retiros++;
        return;
      }
      const r = await medir('retirar (confirmar_retiro)', u, c => c.query(`select public.confirmar_retiro($1, '', $2::jsonb)`, [elegir(sectores), JSON.stringify(lineas)]));
      if (r) contadores.retiros++;
    }],
    [10, 'retirar escaso', async u => {
      const lineas = muestra(escasos, 1 + azar(2)).map(item_id => ({ item_id, cantidad: 1 + azar(3), observacion: '' }));
      const r = await medir('retirar de un repuesto con poco stock', u, c => c.query(`select public.confirmar_retiro($1, '', $2::jsonb)`, [elegir(sectores), JSON.stringify(lineas)]));
      if (r) contadores.retiros++;
    }],
    [3, 'ajustar', u => medir('ajuste de inventario', u, c => c.query(`select public.crear_ajuste_inventario('carga', $1::jsonb)`, [JSON.stringify(muestra(hot, 1 + azar(2)).map(item_id => ({ item_id, tipo: Math.random() < 0.5 ? 'suma' : 'resta', cantidad: 1 + azar(3) })))]))],
    [5, 'crear', async u => {
      const r = await medir('crear repuesto (número automático)', u, c => c.query(`select * from public.crear_repuesto($1, $2, null, 'zz carga', '', 5, 0, 0, '')`, [fam.id, elegir(subfamilias)]));
      if (r) contadores.repuestosCreados++;
    }],
    [6, 'borrar', u => {
      const id = elegir(papelera);
      return Math.random() < 0.5
        ? medir('borrar (a la papelera)', u, c => c.query(`update public.items set activo = false, eliminado_por = $2, eliminado_at = now() where id = $1`, [id, u]))
        : medir('restaurar', u, c => c.query(`update public.items set activo = true, eliminado_por = null, eliminado_at = null where id = $1`, [id]));
    }],
  ];
  const sumaPesos = OPERACIONES.reduce((s, o) => s + o[0], 0);
  const siguiente = () => { let x = Math.random() * sumaPesos; for (const o of OPERACIONES) { x -= o[0]; if (x <= 0) return o; } return OPERACIONES[0]; };

  console.log(`\nuna prueba de ${SEGUNDOS} s con ${TRABAJADORES} personas trabajando a la vez${VIEJO ? ' — COMPORTAMIENTO ANTERIOR (para comprobar que la prueba detecta los problemas)' : ''}…`);
  const fin = Date.now() + SEGUNDOS * 1000;
  const inicio = performance.now();
  await Promise.all(Array.from({ length: TRABAJADORES }, async (_, i) => {
    const u = uid(i + 1);
    while (Date.now() < fin) { const [, , op] = siguiente(); await op(u); await dormir(azar(40)); }
  }));
  const duracion = (performance.now() - inicio) / 1000;

  // ---------- resultados ----------
  const pct = (a, p) => { const o = [...a].sort((x, y) => x - y); return o[Math.min(o.length - 1, Math.floor(o.length * p))]; };
  console.log('\noperación'.padEnd(46) + 'veces'.padStart(8) + 'por seg'.padStart(9) + 'mediana'.padStart(9) + 'p95'.padStart(9) + 'p99'.padStart(9) + 'peor'.padStart(9));
  let total = 0;
  for (const [nombre, a] of [...tiempos].sort((x, y) => y[1].length - x[1].length)) {
    total += a.length;
    console.log(nombre.padEnd(46) + String(a.length).padStart(8) + (a.length / duracion).toFixed(1).padStart(9) + pct(a, 0.5).toFixed(0).padStart(7) + 'ms' + pct(a, 0.95).toFixed(0).padStart(7) + 'ms' + pct(a, 0.99).toFixed(0).padStart(7) + 'ms' + Math.max(...a).toFixed(0).padStart(7) + 'ms');
  }
  console.log(`\n${total} operaciones en ${duracion.toFixed(1)} s (${(total / duracion).toFixed(0)} por segundo) · ${contadores.retiros} retiros · ${contadores.repuestosCreados} repuestos creados · ${contadores.conflictos} ediciones frenadas por el control de versión · ${contadores.rechazosPorStock} retiros rechazados por falta de stock`);
  if (errores.size) { console.log('\nerrores:'); for (const [k, v] of errores) console.log(`  ${String(v).padStart(5)} × ${k}`); }

  // ---------- lo que nunca puede fallar ----------
  const dif = (await admin.query(`
    select i.id, i.stock::numeric as stock,
      ${STOCK_INICIAL} - coalesce((select sum(cantidad) from public.retiro_items where item_id = i.id), 0)
        + coalesce((select sum(case ai.tipo when 'suma' then ai.cantidad else -ai.cantidad end) from public.ajuste_items ai join public.ajustes_inventario a on a.id = ai.ajuste_id where ai.item_id = i.id and not a.anulado), 0) as esperado
    from public.items i where i.id = any($1::uuid[])`, [hot])).rows.map(r => ({ ...r, esperado: Number(r.esperado) + (baseRetirado.get(r.id) ?? 0), stock: Number(r.stock) }));
  const distintos = dif.filter(r => r.stock !== r.esperado);
  const unidades = distintos.reduce((s, r) => s + Math.abs(r.stock - r.esperado), 0);
  // los repuestos con poco stock: nunca negativo, y el stock final = lo que había − lo que se retiró (solo se aceptaron los retiros que alcanzaban)
  const escasosFinal = (await admin.query(`
    select i.id, i.stock::numeric as stock,
      ${STOCK_ESCASO} - coalesce((select sum(cantidad) from public.retiro_items where item_id = i.id), 0) as esperado
    from public.items i where i.id = any($1::uuid[])`, [escasos])).rows.map(r => ({ ...r, stock: Number(r.stock), esperado: Number(r.esperado) + (baseRetirado.get(r.id) ?? 0) }));
  const escasosMal = escasosFinal.filter(r => r.stock !== r.esperado || r.stock < 0);
  const negativos = Number((await admin.query(`select count(*) as n from public.items where stock < 0`)).rows[0].n);
  // La lista de movimientos tiene que cuadrar con el stock: el saldo del último movimiento de cada repuesto es su stock, y cada movimiento nuevo suma o resta exactamente lo que dice.
  const sinCuadrar = Number((await admin.query(`select count(*) as n from public.items i join lateral (select existencia from public.movimientos_stock m where m.item_id = i.id and m.existencia is not null order by m.id desc limit 1) u on true where u.existencia is distinct from coalesce(i.stock, 0)`)).rows[0].n);
  const saltos = Number((await admin.query(`select count(*) as n from (select existencia - lag(existencia) over (partition by item_id order by id) - (entrada - salida) as d from public.movimientos_stock where existencia is not null) t where d is not null and d <> 0`)).rows[0].n);
  // Todo repuesto tiene su depósito y cada movimiento de la ficha es del depósito de su repuesto.
  const sinCuadrarDepositos = Number((await admin.query(`select count(*) as n from public.movimientos_stock m join public.items i on i.id = m.item_id where m.deposito_id <> i.deposito_id`)).rows[0].n);
  const depositosNegativos = Number((await admin.query(`select count(*) as n from public.items where deposito_id is null`)).rows[0].n);
  const huerfanos = Number((await admin.query(`select count(*) as n from public.retiros r where r.created_at >= $1 and not exists (select 1 from public.retiro_items ri where ri.retiro_id = r.id)`, [inicioDeLaPrueba])).rows[0].n);
  const bloqueos = [...errores].filter(([k]) => k.includes('40P01')).reduce((s, [, v]) => s + v, 0);
  const duplicados = [...errores].filter(([k]) => k.includes('23505')).reduce((s, [, v]) => s + v, 0);
  const otros = [...errores].filter(([k]) => !k.includes('40P01') && !k.includes('23505')).reduce((s, [, v]) => s + v, 0);
  const revisiones = [
    ['stock sin perder ni inventar unidades (repuestos más usados)', distintos.length === 0, distintos.length ? `${distintos.length} de ${hot.length} repuestos con stock equivocado (${unidades} unidades de diferencia)` : `${hot.length} repuestos verificados`],
    ['el stock nunca quedó negativo (ningún repuesto) y los de poco stock cuadran exacto', negativos === 0 && escasosMal.length === 0, negativos || escasosMal.length ? `${negativos} repuestos en negativo; ${escasosMal.length} de poco stock que no cuadran` : `${escasos.length} repuestos de poco stock, ${contadores.rechazosPorStock} retiros rechazados por no alcanzar`],
    ['la lista de movimientos cuadra con el stock (último saldo = stock actual, sin saltos entre un movimiento y el siguiente)', sinCuadrar === 0 && saltos === 0, sinCuadrar || saltos ? `${sinCuadrar} repuestos cuyo último saldo no es su stock; ${saltos} saltos` : ''],
    ['todo repuesto tiene su depósito y cada movimiento de la ficha es del depósito de su repuesto', sinCuadrarDepositos === 0 && depositosNegativos === 0, sinCuadrarDepositos || depositosNegativos ? `${sinCuadrarDepositos} movimientos con otro depósito; ${depositosNegativos} repuestos sin depósito` : ''],
    ['ningún retiro quedó vacío (encabezado sin líneas)', huerfanos === 0, huerfanos ? `${huerfanos} retiros vacíos` : ''],
    ['ningún bloqueo mutuo entre transacciones (deadlock)', bloqueos === 0, bloqueos ? `${bloqueos} bloqueos mutuos` : ''],
    ['ningún código de repuesto repetido al crear a la vez', duplicados === 0, duplicados ? `${duplicados} repetidos` : ''],
    ['ningún otro error inesperado', otros === 0, otros ? `${otros} errores (ver arriba)` : ''],
  ];
  console.log('\nlo que nunca puede fallar:');
  for (const [nombre, ok, detalle] of revisiones) console.log(`  ${ok ? '✓' : '✗'} ${nombre}${detalle ? ' — ' + detalle : ''}`);
  const peorP99 = Math.max(...[...tiempos.values()].map(a => pct(a, 0.99)));
  console.log(`\npeor p99 de todas las operaciones: ${peorP99.toFixed(0)} ms`);
  if (ESTRICTO && !VIEJO && revisiones.some(r => !r[1])) codigoDeSalida = 1;
} catch (e) {
  console.error('la prueba falló:', e);
  codigoDeSalida = 1;
} finally {
  try { admin?.release(); } catch { /* ya liberada */ }
  await servidor.apagar();
}
process.exit(codigoDeSalida);
