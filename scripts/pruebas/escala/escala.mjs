// Prueba de ESCALA de la base de datos: llena una base real en memoria (PGlite = PostgreSQL) con muchísimos datos sintéticos y mide las consultas que hace la app,
// con las reglas de seguridad puestas (como las ve un usuario real). Marca las que leen toda una tabla grande (recorrido secuencial) y las que pasan del presupuesto de tiempo.
//
//   node scripts/pruebas/escala/escala.mjs [--items 200000] [--retiros 300000] [--auditoria 500000] [--estricto]
//
// Los tiempos de PGlite (PostgreSQL compilado a WebAssembly) son más lentos que los de un PostgreSQL de verdad: sirven para comparar y para detectar consultas que no usan índice,
// que es lo que se rompe al crecer. Con --estricto, termina con error si alguna consulta usa recorrido secuencial sobre una tabla grande o pasa del presupuesto.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { crearBase } from '../esquema/base.mjs';
import { sembrar } from './sembrar.mjs';

const arg = (nombre, defecto) => { const i = process.argv.indexOf('--' + nombre); return i >= 0 ? Number(process.argv[i + 1]) : defecto; };
const N_ITEMS = arg('items', 200_000), N_RETIROS = arg('retiros', 300_000), N_AUDIT = arg('auditoria', 500_000);
const ESTRICTO = process.argv.includes('--estricto');
const PRESUPUESTO_MS = arg('presupuesto', 300); // más holgado que el real: PGlite es más lento que PostgreSQL nativo
const GRANDE = 20_000; // una tabla con más filas que esto no se debería recorrer entera en una consulta de la app

const COMP = join(import.meta.dirname, '..', '..', '..', 'supabase', 'componentes');
const archivos = ['base', 'abastecimiento', 'mantenimiento'].flatMap(c => readdirSync(join(COMP, c)).filter(f => f.endsWith('.sql')).sort().map(f => join(COMP, c, f)));
const t0 = Date.now();
const db = await crearBase(archivos);
console.log(`base creada con ${archivos.length} archivos (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

const DUENO = '00000000-0000-0000-0000-0000000000a1';
await db.exec(`insert into auth.users (id, email) values ('${DUENO}', 'dueno@escala.test');
  update public.usuarios_perfil set activo=true, rol='admin', mantenimiento_rol='admin', es_owner=true where id='${DUENO}';
  update public.licencia set modulos = '{"proveedores":true,"comisionistas":true,"envios":true,"deposito":true,"mantenimiento":true,"tareas":true}'::jsonb;`);

// ---------- datos sintéticos ----------
await sembrar(sql => db.exec(sql), { items: N_ITEMS, retiros: N_RETIROS, auditoria: N_AUDIT });

// ---------- las consultas de la app ----------
const itemUno = (await db.query(`select id from public.items offset ${Math.floor(N_ITEMS / 2)} limit 1`)).rows[0].id;
const provUno = (await db.query(`select id from public.proveedores limit 1`)).rows[0].id;
const diaCualquiera = (await db.query(`select (now() - interval '200 days')::date::text as d`)).rows[0].d;
// Consultas que hoy leen el catálogo entero a propósito: se resuelven con el rediseño del catálogo (sincronizar solo los cambios y buscar con una función en el servidor,
// porque con las reglas de seguridad puestas Postgres no deja usar el índice de texto para un ILIKE). Se muestran, pero no hacen fallar la prueba.
const PENDIENTE = 'pendiente';
const CONSULTAS = [
  ['repuestos: primera tanda de 1.000 (como hoy)', `select id, codigo, numero, descripcion, stock from public.items where activo order by codigo limit 1000 offset 0`],
  ['repuestos: tanda profunda (offset)', PENDIENTE, `select id, codigo, numero, descripcion, stock from public.items where activo order by codigo limit 1000 offset ${N_ITEMS - 1000}`],
  ['repuestos: total (count exacto)', PENDIENTE, `select count(*) from public.items where activo`],
  ['repuestos: búsqueda por texto en el servidor', PENDIENTE, `select id, codigo, descripcion from public.items where activo and (codigo ilike '%rodam%' or descripcion ilike '%rodam%') order by codigo limit 50`],
  ['repuestos: búsqueda selectiva en el servidor', PENDIENTE, `select id, codigo, descripcion from public.items where activo and (codigo ilike '%tipo 96 medida 52%' or descripcion ilike '%tipo 96 medida 52%') order by codigo limit 50`],
  ['repuestos: tanda siguiente por clave (sin offset)', `select id, codigo, numero, descripcion, stock from public.items where activo and codigo > 'MAAAA00500' order by codigo limit 1000`],
  ['repuestos: por código exacto', `select id from public.items where codigo = 'MAAAA00100'`],
  ['repuestos: de una subfamilia', `select id from public.items where subfamilia_id = (select id from public.subfamilias limit 1) order by numero`],
  ['historial de retiros: últimos 30 días con sus líneas', `select r.id, r.created_at, (select json_agg(json_build_object('id', ri.id, 'cantidad', ri.cantidad, 'item', (select codigo from public.items i where i.id = ri.item_id))) from public.retiro_items ri where ri.retiro_id = r.id) from public.retiros r where r.created_at >= now() - interval '30 days' order by r.created_at desc`],
  ['historial de retiros: un día', `select r.id from public.retiros r where r.created_at >= '${diaCualquiera}' and r.created_at < ('${diaCualquiera}'::date + 1) order by r.created_at desc`],
  ['historial de un repuesto (retiros)', `select ri.id, ri.cantidad, r.created_at from public.retiro_items ri join public.retiros r on r.id = ri.retiro_id where ri.item_id = '${itemUno}' order by r.created_at desc limit 100`],
  ['retiros de un usuario', `select id from public.retiros where usuario_id = '00000000-0000-0000-0000-000000000007' order by created_at desc limit 100`],
  ['auditoría: últimos 200', `select * from public.audit_log order by created_at desc limit 200`],
  ['auditoría: de una tabla y un registro', `select * from public.audit_log where tabla = 'items' and registro_id = '${itemUno}' order by created_at desc`],
  ['proveedores con sus contactos', `select p.*, (select json_agg(c) from public.contactos c where c.proveedor_id = p.id) from public.proveedores p where not eliminado order by nombre`],
  ['contactos de un proveedor', `select * from public.contactos where proveedor_id = '${provUno}'`],
  ['repuestos de un proveedor', `select item_id from public.item_proveedores where proveedor_id = '${provUno}'`],
  ['perfil de un usuario', `select * from public.usuarios_perfil where id = '${DUENO}'`],
];

function nodos(plan, acc = []) { acc.push(plan); for (const h of plan.Plans ?? []) nodos(h, acc); return acc; }
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${DUENO}', false);`);
const tamano = async tabla => Number((await db.query(`select reltuples::bigint as n from pg_class where oid = 'public.${tabla}'::regclass`)).rows[0].n);
const filasDe = {};
for (const t of ['items', 'retiros', 'retiro_items', 'audit_log', 'proveedores', 'contactos', 'item_proveedores', 'usuarios_perfil', 'subfamilias']) filasDe[t] = await tamano(t);

const informe = [];
for (const entrada of CONSULTAS) {
  const [nombre, sql, pendiente] = entrada.length === 3 ? [entrada[0], entrada[2], true] : entrada;
  const r = (await db.query(`explain (analyze, format json) ${sql}`)).rows[0]['QUERY PLAN'][0];
  const todos = nodos(r.Plan);
  const secuenciales = todos.filter(n => n['Node Type'] === 'Seq Scan' && (filasDe[n['Relation Name']] ?? 0) > GRANDE).map(n => `${n['Relation Name']} (${n['Rows Removed by Filter'] ?? 0} descartadas)`);
  const ms = r['Execution Time'];
  informe.push({ nombre, ms, secuenciales, pendiente });
}
await db.exec('reset role;');

console.log('\nconsulta'.padEnd(66) + 'tiempo'.padStart(10) + '  observación');
// Claves foráneas sin índice: Postgres no los crea solo, y sin ellos cada unión o borrado recorre la tabla entera.
const fkSinIndice = (await db.query(`
  select c.conrelid::regclass::text as tabla, c.conname as clave
  from pg_constraint c
  where c.contype = 'f' and c.connamespace = 'public'::regnamespace
    and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey)
  order by 1, 2`)).rows;
let problemas = 0;
for (const { nombre, ms, secuenciales, pendiente } of informe) {
  const lento = ms > PRESUPUESTO_MS;
  const marca = (pendiente && (secuenciales.length || lento) ? '(pendiente del rediseño) ' : '') + (secuenciales.length ? 'LEE TODA LA TABLA: ' + secuenciales.join(', ') : lento ? 'pasa del presupuesto' : 'ok');
  if ((secuenciales.length || lento) && !pendiente) problemas++;
  console.log(`${(secuenciales.length || lento ? (pendiente ? '… ' : '✗ ') : '✓ ') + nombre}`.padEnd(66) + `${ms.toFixed(1)} ms`.padStart(10) + '  ' + marca);
}
if (fkSinIndice.length) {
  problemas += fkSinIndice.length;
  console.log(`\n✗ ${fkSinIndice.length} clave(s) foránea(s) sin índice:\n  ` + fkSinIndice.map(x => x.tabla.replace('public.', '') + ' → ' + x.clave).join('\n  '));
} else console.log('\n✓ todas las claves foráneas tienen índice');
console.log(`\n${problemas === 0 ? 'Todas las consultas dentro del presupuesto' : problemas + ' consulta(s) con problemas de escala'} — tablas: ${Object.entries(filasDe).map(([t, n]) => `${t} ${n.toLocaleString('es-AR')}`).join(' · ')}`);
if (ESTRICTO && problemas) process.exit(1);
