// Instalación desde cero: aplica TODAS las migraciones, en orden, sobre una base vacía (PGlite con piezas de Supabase simuladas)
// y comprueba la estructura de seguridad y el comportamiento de las reglas nuevas.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { crearBase } from './base.mjs';
import { COMPONENTE, puedeApuntar } from './componentes.mjs';

const BASE = join(import.meta.dirname, '..', '..', '..', 'supabase', 'migrations');
// Con --componentes se prueba la instalación por componentes (supabase/componentes) en vez de la cadena original: tiene que pasar exactamente lo mismo.
const porComponentes = process.argv.includes('--componentes');
const COMP = join(BASE, '..', 'componentes');
const archivos = porComponentes
  ? ['base', 'abastecimiento', 'mantenimiento'].flatMap(c => readdirSync(join(COMP, c)).filter(f => f.endsWith('.sql')).sort().map(f => join(COMP, c, f)))
  : readdirSync(BASE).filter(f => f.endsWith('.sql')).sort();
console.log(porComponentes ? 'instalación por componentes, archivos:' : 'migraciones:', archivos.length);
let db;
try { db = await crearBase(archivos); } catch (e) { console.log('FALLÓ al aplicar la cadena:', e.message.slice(0, 300)); process.exit(1); }
console.log('cadena completa aplicada sin errores');

const q = async s => (await db.query(s)).rows;
let fallas = 0;
const ok = (n, c, d = '') => { if (!c) fallas++; console.log(`${c ? 'OK   ' : 'FALLA'} ${n}${d ? '  → ' + d : ''}`); };

ok('tablas con RLS apagado: ninguna', (await q(`select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity`)).length === 0);
ok('toda tabla tiene la regla "requiere_usuario_activo" (salvo las 4 exceptuadas)', (await q(`select c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relrowsecurity and c.relname not in ('configuracion','licencia','usuarios_perfil','migraciones_aplicadas') and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname and p.policyname='requiere_usuario_activo')`)).length === 0);
ok('anon no tiene permisos de tabla salvo leer configuracion', (await q(`select table_name, privilege_type from information_schema.role_table_grants where grantee='anon' and table_schema='public' and not (table_name='configuracion' and privilege_type='SELECT')`)).length === 0);
const abiertas = await q(`select p.proname from pg_proc p where p.pronamespace='public'::regnamespace and p.prorettype not in ('trigger'::regtype,'event_trigger'::regtype) and has_function_privilege('anon', p.oid, 'execute') and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')`);
ok('ninguna función propia ejecutable sin sesión', abiertas.length === 0, abiertas.map(x => x.proname).join(', '));
ok('contactos y planilla_familias solo para usuarios con sesión', (await q(`select tablename from pg_policies where schemaname='public' and policyname in ('contactos_select','planilla_familias_select') and roles::text not like '%authenticated%'`)).length === 0);

// --- comportamiento ---
const A = '00000000-0000-0000-0000-00000000000a', B = '00000000-0000-0000-0000-00000000000b';
await db.exec(`
  insert into auth.users (id, email) values ('${A}','activo@x.com'), ('${B}','bloqueado@x.com');
  update public.usuarios_perfil set activo=true, rol='admin', mantenimiento_rol='admin', es_owner=true where id='${A}';
  update public.usuarios_perfil set rol='admin', mantenimiento_rol='admin', activo=false where id='${B}';
  update public.licencia set modulos = '{"proveedores":true,"comisionistas":true,"envios":true,"deposito":true,"tareas":true}'::jsonb;
  insert into public.proveedores (nombre) values ('P1');
  insert into public.contactos (proveedor_id, nombre, email) select id, 'C1', 'c@x.com' from public.proveedores limit 1;
`);
const como = async (rol, uid, sql) => {
  await db.exec(`set role ${rol}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return (await db.query(sql)).rows; } catch (e) { return { error: e.message }; } finally { await db.exec('reset role;'); }
};
const filas = r => Array.isArray(r) ? r.length : -1;
ok('sin sesión (anon): contactos denegado', (await como('anon', null, 'select * from public.contactos')).error?.includes('permission denied'));
ok('sin sesión (anon): configuracion legible', filas(await como('anon', null, 'select * from public.configuracion')) === 1);
ok('usuario activo y dueño lee contactos', filas(await como('authenticated', A, 'select * from public.contactos')) === 1);
ok('usuario BLOQUEADO no lee proveedores', filas(await como('authenticated', B, 'select * from public.proveedores')) === 0);
ok('usuario BLOQUEADO no lee contactos', filas(await como('authenticated', B, 'select * from public.contactos')) === 0);
ok('usuario BLOQUEADO lee solo su propio perfil', filas(await como('authenticated', B, 'select * from public.usuarios_perfil')) === 1);
ok('usuario activo lee todos los perfiles', filas(await como('authenticated', A, 'select * from public.usuarios_perfil')) === 2);
ok('un bloqueado, aunque figure como administrador, no es administrador', (await como('authenticated', B, 'select public.is_directorio_admin() as v'))[0].v === false && (await como('authenticated', B, 'select public.is_mantenimiento_admin() as v'))[0].v === false);
ok('el dueño activo sí', (await como('authenticated', A, 'select public.is_owner() as v'))[0].v === true);
const hoy = (await como('authenticated', A, 'select public.hoy_local() as v'))[0].v;
ok('hoy_local() devuelve una fecha', !!hoy, String(hoy));
await db.exec(`update public.configuracion set zona_horaria = 'Pacific/Kiritimati'`);
const hk = (await como('authenticated', A, `select public.hoy_local()::text as v, (now() at time zone 'Pacific/Kiritimati')::date::text as e`))[0];
ok('hoy_local() sigue la zona configurada', hk.v === hk.e, `${hk.v} = ${hk.e}`);
let malo = false; try { await db.exec(`update public.configuracion set zona_horaria = 'Marte/Olimpo'`); } catch { malo = true; }
ok('una zona horaria inventada se rechaza', malo);
await db.exec(`update public.configuracion set zona_horaria = 'America/Argentina/Buenos_Aires'`);
const t1 = await como('authenticated', A, `select public.create_task('Tarea de hoy', '', 'green', public.hoy_local()) as id`);
ok('crear una tarea con el "hoy" de la empresa funciona', Array.isArray(t1) && !!t1[0]?.id, JSON.stringify(t1).slice(0, 120));
const t2 = await como('authenticated', A, `select public.create_task('Tarea vieja', '', 'green', '2020-01-01') as id`);
ok('una fecha pasada se rechaza', !!t2.error && /anterior a hoy/.test(t2.error), t2.error?.slice(0, 80));
const t3 = await como('authenticated', B, `select public.create_task('No debería', '', 'green', null) as id`);
ok('un usuario bloqueado no crea tareas', !!t3.error, t3.error?.slice(0, 80));
const defStart = (await q(`select pg_get_expr(adbin, adrelid) as d from pg_attrdef where adrelid='public.tasks'::regclass and adnum=(select attnum from pg_attribute where attrelid='public.tasks'::regclass and attname='start_date')`))[0].d;
ok('las fechas por defecto de las tareas usan el día de la empresa', /hoy_local/.test(defStart), defStart);


// --- ajuste de inventario ---
await db.exec("select set_config('request.jwt.claim.sub', '', false)"); // sin sesión: así preparo los datos como lo haría el servicio
// El stock inicial de los datos de prueba se siembra habilitando el cambio directo solo en esta conexión (en la aplicación solo se cambia con mover_stock).
await db.exec(`
  select set_config('app.mover_stock', 'on', false);
  insert into public.familias (codigo, nombre) values ('ZZ', 'Fam');
  insert into public.subfamilias (familia_id, codigo, nombre) select id, 'ZZ', 'Sub' from public.familias where codigo = 'ZZ';
  insert into public.items (codigo, numero, descripcion, familia_id, subfamilia_id, stock)
    select 'AJ1', '1', 'Repuesto', f.id, sf.id, 10 from public.familias f join public.subfamilias sf on sf.familia_id = f.id where f.codigo = 'ZZ';
  update public.usuarios_perfil set puede_ajustar_inventario = true where id = '${B}';
  select set_config('app.mover_stock', 'off', false);
`);
const item = (await q(`select id from public.items where codigo = 'AJ1'`))[0].id;
const aj = await como('authenticated', A, `select public.crear_ajuste_inventario('conteo', '[{"item_id":"${item}","tipo":"resta","cantidad":4}]'::jsonb) as id`);
ok('el dueño crea un ajuste', Array.isArray(aj) && !!aj[0]?.id, JSON.stringify(aj).slice(0, 160));
ok('el stock bajó de 10 a 6', Number((await q(`select stock from public.items where id = '${item}'`))[0].stock) === 6);
const lin = (await q(`select stock_antes, stock_despues, tipo from public.ajuste_items`))[0];
ok('la línea guarda antes (10), después (6) y que resta', Number(lin.stock_antes) === 10 && Number(lin.stock_despues) === 6 && lin.tipo === 'resta');
const n = async () => (await q(`select count(*)::int as n from public.audit_log where tabla in ('ajuste_items', 'ajustes_inventario')`))[0].n;
ok('quedó en el historial (el ajuste y su línea)', (await n()) === 2, String(await n()));
ok('un bloqueado, aunque tenga el permiso, no puede ajustar', !!(await como('authenticated', B, `select public.crear_ajuste_inventario('x', '[{"item_id":"${item}","tipo":"suma","cantidad":1}]'::jsonb)`)).error);
ok('sin sesión no se puede ajustar', !!(await como('anon', null, `select public.crear_ajuste_inventario('x', '[]'::jsonb)`)).error);
ok('restar de más se rechaza', /No se puede restar/.test((await como('authenticated', A, `select public.crear_ajuste_inventario('x', '[{"item_id":"${item}","tipo":"resta","cantidad":99}]'::jsonb)`)).error ?? ''));
let borro = false; try { await db.exec('delete from public.ajustes_inventario'); } catch { borro = true; }
ok('un ajuste no se puede borrar (ni con permisos totales)', borro);
let vacio = false; try { await db.exec('truncate public.ajuste_items, public.ajustes_inventario'); } catch { vacio = true; }
ok('ni vaciar las tablas', vacio);
let edito = false; try { await db.exec('update public.ajuste_items set cantidad = 1'); } catch { edito = true; }
ok('ni cambiar una línea', edito);
ok('quien no es dueño no anula', !!(await como('authenticated', B, `select public.anular_ajuste_inventario('${aj[0].id}', 'x')`)).error);
const an = await como('authenticated', A, `select public.anular_ajuste_inventario('${aj[0].id}', 'error')`);
ok('el dueño anula el ajuste', !an.error, an.error);
ok('el stock vuelve a 10', Number((await q(`select stock from public.items where id = '${item}'`))[0].stock) === 10);
ok('la anulación suma la cabecera y la línea al historial (4 en total)', (await n()) === 4, String(await n()));
ok('anular de nuevo se rechaza', !!(await como('authenticated', A, `select public.anular_ajuste_inventario('${aj[0].id}', 'otra vez')`)).error);


// --- Varios depósitos: cada uno con su letra y sus repuestos; cada usuario con su depósito (solo en la instalación por componentes: la cadena original no los tiene) ---
if ((await q(`select to_regclass('public.depositos') is not null as hay`))[0].hay) {
  const principal = (await q(`select id, prefijo from public.depositos where es_principal`))[0];
  ok('el depósito principal tomó la letra de los repuestos que ya había, y el repuesto de prueba está en él', (await q(`select deposito_id from public.items where id = '${item}'`))[0].deposito_id === principal.id && /^[A-Z]$/.test(principal.prefijo));
  await db.exec(`insert into public.depositos (codigo, nombre, prefijo) values ('02', 'Insumos', 'I')`);
  const insumos = (await q(`select id from public.depositos where codigo = '02'`))[0].id;
  ok('dos depósitos no pueden tener la misma letra ni el mismo nombre', await db.exec(`insert into public.depositos (codigo, nombre, prefijo) values ('03', 'Otro', 'I')`).then(() => false, () => true)
    && await db.exec(`insert into public.depositos (codigo, nombre, prefijo) values ('03', 'insumos', 'P')`).then(() => false, () => true));
  ok('la letra tiene que ser una sola mayúscula', await db.exec(`insert into public.depositos (codigo, nombre, prefijo) values ('03', 'Otro', 'ab')`).then(() => false, () => true));
  ok('un solo depósito principal', await db.exec(`update public.depositos set es_principal = true where codigo = '02'`).then(() => false, () => true));

  // crear repuestos: van al depósito elegido (entre los del usuario) y su código empieza con la letra de ese depósito
  const fam = (await q(`select f.id as f, s.id as s, f.codigo as fc, s.codigo as sc from public.familias f join public.subfamilias s on s.familia_id = f.id where f.codigo = 'ZZ'`))[0];
  const crear = (dep, num = null) => como('authenticated', A, `select (t.x).id as id, (t.x).codigo as codigo, (t.x).numero as numero, (t.x).deposito_id as deposito_id from (select public.crear_repuesto('${fam.f}', '${fam.s}', ${num === null ? 'null' : `'${num}'`}, 'Rodamiento nuevo', '', 0, 0, 0, '', 'Uni'${dep ? `, '${dep}'` : ''}) as x) t`);
  const r1 = await crear(null);
  ok('un repuesto creado sin decir el depósito va al del usuario y usa su letra', !r1.error && r1[0]?.deposito_id === principal.id && r1[0].codigo.startsWith(principal.prefijo), JSON.stringify(r1).slice(0, 150));
  const r2 = await crear(insumos);
  ok('creado en Insumos: su código empieza con la I y es de ese depósito', !r2.error && r2[0]?.deposito_id === insumos && r2[0].codigo === `IZZZZ${r2[0].numero}`, JSON.stringify(r2).slice(0, 150));
  ok('la numeración es de cada depósito: ambos arrancan en su propia secuencia', !!r1[0] && !!r2[0] && Number(r2[0].numero) === 1 && Number(r1[0].numero) >= 1);

  // acceso: A es dueño (ve todo); C es un administrador del depósito (activo, no dueño) que al recibir su rol queda asignado al principal
  const C = '00000000-0000-0000-0000-0000000000c1';
  await db.exec(`insert into auth.users (id, email) values ('${C}', 'comun@x.com'); update public.usuarios_perfil set activo = true, rol = 'admin', mantenimiento_rol = 'admin' where id = '${C}';`);
  const idsDe = async u => (await como('authenticated', u, `select * from public.depositos_del_usuario() as id`)).map(x => x.id);
  ok('el dueño tiene acceso a todos los depósitos', (await idsDe(A)).length === 2);
  ok('un usuario del depósito empieza solo con el principal (se le asignó solo al recibir su rol)', JSON.stringify(await idsDe(C)) === JSON.stringify([principal.id]));
  const sinAcceso = await como('authenticated', C, `select public.crear_repuesto('${fam.f}', '${fam.s}', null, 'No debería', '', 0, 0, 0, '', 'Uni', '${insumos}')`);
  ok('sin acceso al depósito no se puede crear ahí (aunque se pida)', !!sinAcceso.error && /no tenés acceso a ese depósito/.test(sinAcceso.error), JSON.stringify(sinAcceso).slice(0, 120));
  const propio = await como('authenticated', C, `select (t.x).deposito_id as deposito_id, (t.x).codigo as codigo from (select public.crear_repuesto('${fam.f}', '${fam.s}', null, 'De Mantenimiento', '', 0, 0, 0, '', 'Uni') as x) t`);
  ok('el administrador del depósito crea en el suyo, con la letra del suyo', !propio.error && propio[0]?.deposito_id === principal.id && propio[0].codigo.startsWith(principal.prefijo), JSON.stringify(propio).slice(0, 120));
  await db.exec(`insert into public.usuarios_depositos (usuario_id, deposito_id) values ('${C}', '${insumos}')`);
  ok('al darle acceso a otro depósito, el usuario lo ve (y sigue viendo el suyo)', (await idsDe(C)).length === 2);
  const enInsumos = await como('authenticated', C, `select (t.x).deposito_id as deposito_id, (t.x).codigo as codigo from (select public.crear_repuesto('${fam.f}', '${fam.s}', null, 'De Insumos', '', 0, 0, 0, '', 'Uni', '${insumos}') as x) t`);
  ok('con acceso a los dos, elige dónde crea y cada código lleva la letra de su depósito', !enInsumos.error && enInsumos[0]?.deposito_id === insumos && enInsumos[0].codigo.startsWith('I'), JSON.stringify(enInsumos).slice(0, 120));
  ok('quien no es dueño no puede darse acceso a sí mismo ni a otro (no escribe en las asignaciones)', !!(await como('authenticated', C, `insert into public.usuarios_depositos (usuario_id, deposito_id) values ('${C}', '${principal.id}')`)).error);

  // cada movimiento anota el depósito de su repuesto
  const itemI = r2[0].id;
  await db.exec(`select set_config('request.jwt.claim.sub', '${A}', false)`);
  await q(`select public.mover_stock('${itemI}', 5, 'carga', 'prueba')`);
  ok('el movimiento de un repuesto de Insumos anota el depósito Insumos', (await q(`select deposito_id from public.movimientos_stock where item_id = '${itemI}' order by id desc limit 1`))[0].deposito_id === insumos);
  ok('las personas no pueden usar mover_stock ni escribir depósitos', !!(await como('authenticated', A, `select public.mover_stock('${item}', 1, 'carga', 'x')`)).error
    && !!(await como('authenticated', A, `update public.depositos set nombre = 'x'`)).error);
  ok('quien tiene acceso ve los depósitos', (await como('authenticated', A, `select count(*)::int as n from public.depositos`))[0]?.n >= 2);
  ok('un depósito con repuestos no se puede borrar', await db.exec(`delete from public.depositos where codigo = '02'`).then(() => false, () => true));
}


// --- Avisos del menú: qué vio cada persona por última vez (solo en la instalación por componentes: la cadena original no lo tiene) ---
if ((await q(`select to_regclass('public.avisos_vistos') is not null as hay`))[0].hay) {
  const marcar = clave => como('authenticated', A, `select public.marcar_aviso_visto('${clave}') as t`);
  const primera = await marcar('sugerencias');
  ok('"ya lo vi" deja la hora de la base y crea la fila de quien la usa', !primera.error && primera[0]?.t !== null && filas(await como('authenticated', A, `select * from public.avisos_vistos where usuario_id = '${A}' and clave = 'sugerencias'`)) === 1, JSON.stringify(primera).slice(0, 120));
  await db.exec(`select pg_sleep(0.05)`);
  const segunda = await marcar('sugerencias');
  ok('marcar de nuevo actualiza la misma fila (no la duplica) y la hora avanza', !segunda.error && new Date(segunda[0].t) > new Date(primera[0].t) && filas(await como('authenticated', A, `select * from public.avisos_vistos where usuario_id = '${A}'`)) === 1);
  ok('solo hay avisos de "retiros" y "sugerencias"', !!(await marcar('cualquier-cosa')).error);
  ok('cada persona ve solo lo suyo: un usuario no puede escribir la fila de otro', !!(await como('authenticated', A, `insert into public.avisos_vistos (usuario_id, clave) values ('${B}', 'retiros')`)).error);
  ok('un usuario bloqueado no usa los avisos', !!(await como('authenticated', B, `select public.marcar_aviso_visto('retiros')`)).error || filas(await como('authenticated', B, 'select * from public.avisos_vistos')) === 0);
  ok('sin sesión no se ven ni se marcan avisos', !!(await como('anon', null, 'select * from public.avisos_vistos')).error && !!(await como('anon', null, `select public.marcar_aviso_visto('retiros')`)).error);
  ok('nadie borra avisos desde la aplicación', !!(await como('authenticated', A, 'delete from public.avisos_vistos')).error);
}


// --- Componentes (E1): ninguna tabla sin dueño y ninguna dependencia en la dirección equivocada ---
const comp = n => COMPONENTE[String(n).replace(/"/g, '').replace(/^public\./, '')];
const tablasBD = (await q("select relname from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p')")).map(x => x.relname);
const sinDueno = tablasBD.filter(t => !comp(t));
ok('todas las tablas tienen componente asignado (scripts/pruebas/esquema/componentes.mjs)', sinDueno.length === 0, sinDueno.join(', '));
const claves = await q("select conrelid::regclass::text as de, confrelid::regclass::text as a, conname from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace");
const clavesMalas = claves.filter(c => comp(c.de) && comp(c.a) && !puedeApuntar(comp(c.de), comp(c.a)));
ok('ninguna clave entre tablas apunta en la dirección equivocada (Base → nada; Abastecimiento → Base; Mantenimiento → Base y Abastecimiento)', clavesMalas.length === 0,
  clavesMalas.map(c => c.de + ' -> ' + c.a).join(', '));
ok('la Base no tiene ninguna clave hacia Abastecimiento o Mantenimiento', claves.filter(c => comp(c.de) === 'base' && comp(c.a) !== 'base').length === 0);

// --- E1a: diseño de rótulo predeterminado sin clave en la Base ---
const idDiseno = (await q("insert into public.rotulo_disenos (nombre, design) values ('Diseño de prueba', '{}'::jsonb) returning id"))[0].id;
await db.exec('update public.configuracion set rotulo_diseno_id = ' + idDiseno);
ok('se puede elegir un diseño existente como predeterminado', Number((await q('select rotulo_diseno_id as v from public.configuracion'))[0].v) === Number(idDiseno));
let inexistente = null; try { await db.exec('update public.configuracion set rotulo_diseno_id = 999999'); } catch (e) { inexistente = e; }
ok('un diseño que no existe se rechaza (antes lo hacía la clave)', !!inexistente && /no existe/.test(inexistente.message), inexistente?.message?.slice(0, 60));
await db.exec('delete from public.rotulo_disenos where id = ' + idDiseno);
ok('al borrar el diseño predeterminado, la configuración queda sin predeterminado', (await q('select rotulo_diseno_id as v from public.configuracion'))[0].v === null);
ok('no queda ninguna clave de configuracion hacia rotulo_disenos', claves.filter(c => c.conname === 'configuracion_rotulo_diseno_id_fkey').length === 0);

// --- Licencia por componentes y interruptor del dueño (E1c): solo existe en la cadena por componentes ---
if (porComponentes) {
  const fs = await import('node:fs');
  const C = '00000000-0000-0000-0000-00000000000c';
  const TODOS6 = '{"proveedores":true,"comisionistas":true,"envios":true,"deposito":true,"tareas":true,"mantenimiento":true}';
  const lic = async (m) => db.exec(`update public.licencia set modulos = '${m}'::jsonb; update public.preferencias_modulos set apagados = '{}'::jsonb;`);
  await db.exec("select set_config('request.jwt.claim.sub', '', false)");
  await db.exec(`insert into auth.users (id, email) values ('${C}','admin@x.com'); update public.usuarios_perfil set activo=true, rol='admin', mantenimiento_rol='admin' where id='${C}';`);
  const act = async (m) => (await q(`select public.modulo_activo('${m}') as v`))[0].v;
  const apagar = (uid, m, v = true) => como('authenticated', uid, `select public.definir_modulo_del_dueno('${m}', ${v})`);

  const nueva = await crearBase(archivos); // una instalación recién hecha, sin los cambios de arriba
  const l0 = (await nueva.query('select componentes, modulos from public.licencia')).rows[0];
  ok('la licencia anota los tres componentes instalados', JSON.stringify(l0.componentes) === JSON.stringify(['abastecimiento', 'base', 'mantenimiento']), JSON.stringify(l0.componentes));
  ok('el módulo "mantenimiento" nace prendido cuando el depósito estaba prendido', l0.modulos.mantenimiento === true && l0.modulos.deposito === true);
  const json = JSON.parse(fs.readFileSync(join(BASE, '..', '..', 'src', 'lib', 'modulos.json'), 'utf8')).modulos;
  const esperados = Object.fromEntries(json.filter(m => m.requiere.length).map(m => [m.id, m.requiere]));
  const enBD = (await q('select public.modulo_requisitos() as r'))[0].r;
  ok('los requisitos de la base coinciden con src/lib/modulos.json', JSON.stringify(enBD) === JSON.stringify(esperados), JSON.stringify(enBD) + ' vs ' + JSON.stringify(esperados));
  ok('modulos.json y la licencia hablan de los mismos módulos', JSON.stringify(json.map(m => m.id).sort()) === JSON.stringify(Object.keys(JSON.parse(TODOS6)).sort()));

  await lic(TODOS6);
  ok('con todo prendido, todos los módulos están activos', (await Promise.all(Object.keys(JSON.parse(TODOS6)).map(act))).every(Boolean));

  // quién puede mover el interruptor
  ok('solo el dueño: un administrador común no puede', /Solo el dueño/.test((await apagar(C, 'comisionistas')).error ?? ''));
  ok('solo el dueño: un bloqueado no puede', /Solo el dueño/.test((await apagar(B, 'comisionistas')).error ?? ''));
  ok('solo el dueño: sin sesión no puede', !!(await como('anon', null, `select public.definir_modulo_del_dueno('comisionistas', true)`)).error);
  const directo = await como('authenticated', A, `update public.preferencias_modulos set apagados = '{"tareas": true}'::jsonb returning id`);
  ok('nadie escribe preferencias_modulos directo (ni el dueño)', (Array.isArray(directo) ? directo.length === 0 : !!directo.error) && (await act('tareas')) === true);
  ok('el dueño lee sus preferencias', filas(await como('authenticated', A, 'select * from public.preferencias_modulos')) === 1);
  ok('un bloqueado no lee las preferencias', filas(await como('authenticated', B, 'select * from public.preferencias_modulos')) === 0);

  // apagar y prender
  await db.exec(`insert into public.comisionistas (nombre) values ('Com1')`);
  ok('con Comisionistas prendido el dueño los ve', filas(await como('authenticated', A, 'select * from public.comisionistas')) === 1);
  const r1 = await apagar(A, 'comisionistas');
  ok('el dueño apaga Comisionistas', !r1.error && (await act('comisionistas')) === false, r1.error);
  ok('apagado por el dueño: la base bloquea la lectura (también al dueño)', filas(await como('authenticated', A, 'select * from public.comisionistas')) === 0);
  ok('apagado por el dueño: la base bloquea la escritura', !!(await como('authenticated', A, `insert into public.comisionistas (nombre) values ('Otro')`)).error);
  ok('apagar Comisionistas no toca a los demás', (await act('proveedores')) && (await act('tareas')));
  ok('el apagado queda en el historial con quién lo hizo', (await q(`select 1 from public.audit_log where tabla = 'preferencias_modulos' and descripcion like '%comisionistas: apagado%' and usuario_id = '${A}'`)).length === 1);
  const r2 = await apagar(A, 'comisionistas', false);
  ok('el dueño vuelve a prender Comisionistas', !r2.error && (await act('comisionistas')) === true, r2.error);

  // lo que la licencia no incluye, el dueño no lo puede tocar
  await lic('{"proveedores":true,"comisionistas":false,"envios":true,"deposito":true,"tareas":true,"mantenimiento":true}');
  ok('el dueño no puede prender lo que la licencia no incluye', /no está incluido/.test((await apagar(A, 'comisionistas', false)).error ?? ''));
  ok('el dueño no puede inventar un módulo', /no está incluido/.test((await apagar(A, 'inventado')).error ?? ''));
  ok('un módulo fuera de la licencia sigue apagado', (await act('comisionistas')) === false);

  // dependencias
  await lic(TODOS6);
  ok('no se apaga Proveedores si Envíos sigue prendido', /Primero apagá "envios"/.test((await apagar(A, 'proveedores')).error ?? ''));
  ok('no se apaga Depósito si Mantenimiento sigue prendido', /Primero apagá "mantenimiento"/.test((await apagar(A, 'deposito')).error ?? ''));
  ok('se apaga Envíos y después Proveedores', !(await apagar(A, 'envios')).error && !(await apagar(A, 'proveedores')).error);
  ok('no se prende Envíos si Proveedores está apagado', /Primero activá "proveedores"/.test((await apagar(A, 'envios', false)).error ?? ''));
  ok('se prende Proveedores y después Envíos', !(await apagar(A, 'proveedores', false)).error && !(await apagar(A, 'envios', false)).error);

  // Mantenimiento como módulo propio (los equipos). Las reparaciones NO son de Mantenimiento: son del Depósito (necesitan Depósito y Proveedores).
  const prov = (await q(`insert into public.proveedores (nombre) values ('ProvM') returning id`))[0].id;
  const crearRep = (motivo) => como('authenticated', A, `select public.crear_reparacion('${prov}', '${motivo}', current_date, null, '[{"item_id":"${item}","cantidad":1}]'::jsonb) as id`);
  const rep = await crearRep('prueba');
  ok('con el Depósito y Proveedores prendidos se crea una reparación', Array.isArray(rep) && !!rep[0]?.id, JSON.stringify(rep).slice(0, 140));
  ok('el dueño apaga Mantenimiento', !(await apagar(A, 'mantenimiento')).error);
  const otra = await crearRep('otra');
  ok('con Mantenimiento apagado las reparaciones siguen funcionando (no son de Mantenimiento)', Array.isArray(otra) && !!otra[0]?.id, JSON.stringify(otra).slice(0, 140));
  ok('con Mantenimiento apagado se siguen leyendo las reparaciones', filas(await como('authenticated', A, 'select * from public.reparaciones')) >= 2);
  ok('apagado: la base bloquea los equipos', filas(await como('authenticated', A, 'select * from public.equipos')) === 0);
  ok('apagado: el Depósito sigue funcionando', filas(await como('authenticated', A, 'select * from public.items')) >= 1);
  await apagar(A, 'mantenimiento', false);
  await lic('{"proveedores":true,"comisionistas":true,"envios":true,"deposito":true,"tareas":true,"mantenimiento":false}');
  const sinMant = await crearRep('sin-mantenimiento');
  ok('si la licencia no incluye Mantenimiento, las reparaciones siguen (el depósito y los proveedores están prendidos)', Array.isArray(sinMant) && !!sinMant[0]?.id && filas(await como('authenticated', A, 'select * from public.reparaciones')) >= 3, JSON.stringify(sinMant).slice(0, 140));
  ok('...y los equipos no existen para él (bloqueados)', filas(await como('authenticated', A, 'select * from public.equipos')) === 0);
  ok('...y el dueño no puede prender Mantenimiento', /no está incluido/.test((await apagar(A, 'mantenimiento', false)).error ?? ''));
  // las reparaciones sí dependen del Depósito y de Proveedores
  await lic('{"proveedores":false,"comisionistas":true,"envios":false,"deposito":true,"tareas":true,"mantenimiento":false}');
  ok('sin Proveedores en la licencia no se pueden crear reparaciones ni leerlas', /no está activo/.test((await crearRep('sin-prov')).error ?? '') && filas(await como('authenticated', A, 'select * from public.reparaciones')) === 0);
  await lic('{"proveedores":true,"comisionistas":true,"envios":true,"deposito":false,"tareas":true,"mantenimiento":false}');
  ok('sin Depósito en la licencia no se pueden crear reparaciones ni leerlas', /no está activo/.test((await crearRep('sin-dep')).error ?? '') && filas(await como('authenticated', A, 'select * from public.reparaciones')) === 0);

  // la licencia sigue siendo solo del vendedor
  await lic(TODOS6);
  const toca = await como('authenticated', A, `update public.licencia set modulos = '{"tareas": false}'::jsonb returning id`);
  ok('el dueño no puede cambiar la licencia', (Array.isArray(toca) ? toca.length === 0 : !!toca.error) && (await act('proveedores')) === true);
  await db.exec(`update public.licencia set componentes = array['base','abastecimiento']`);
  ok('un cambio de componentes de la licencia queda en el historial', (await q(`select 1 from public.audit_log where tabla = 'licencia' and descripcion like '%componentes: base, abastecimiento%'`)).length === 1);
  await db.exec(`update public.licencia set componentes = array['abastecimiento','base','mantenimiento']`);

  // --- Depósitos que el dueño crea y edita: nombre, color, ícono, letra y el tope de la licencia ---
  const sinDueno = '00000000-0000-0000-0000-0000000000d1'; // activo y con acceso al depósito, pero no es dueño ni administrador
  await db.exec(`insert into auth.users (id, email) values ('${sinDueno}', 'operario@x.com'); update public.usuarios_perfil set activo = true, rol = 'user', mantenimiento_rol = 'comun' where id = '${sinDueno}';`);
  const principalId = (await q(`select id from public.depositos where es_principal`))[0].id;
  const insumosId = (await q(`select id from public.depositos where nombre = 'Insumos'`))[0].id;
  const q1 = (r) => Array.isArray(r) ? r[0] : null;
  const msj = (r) => r?.error ?? '';
  const crearDep = (uid, nombre, letra, color = null, icono = 'deposito') =>
    como('authenticated', uid, `select * from public.crear_deposito('${nombre}', '${letra}', ${color ? `'${color}'` : 'null'}, '${icono}')`);
  const editarDep = (uid, id, nombre, color, icono, activo, letra = null) =>
    como('authenticated', uid, `select * from public.editar_deposito('${id}', '${nombre}', ${color ? `'${color}'` : 'null'}, '${icono}', ${activo}, ${letra ? `'${letra}'` : 'null'})`);
  const tope = (n) => db.exec(`update public.licencia set max_depositos = ${n}`);

  ok('el depósito principal nace con el ícono de depósito y sin color propio', (await q(`select icono, color from public.depositos where es_principal`))[0].icono === 'deposito');
  await tope(2); // ya hay dos (el principal e Insumos)
  ok('con el tope lleno no se puede crear otro depósito, y el aviso dice cuántos permite', /permite hasta 2/.test(msj(await crearDep(A, 'Producción', 'p'))));
  await tope(5);
  const prod = q1(await crearDep(A, 'Producción', 'p', '#2a6f97', 'fabrica'));
  ok('el dueño crea un depósito: la letra se pone en mayúscula, se numera solo y guarda su color e ícono', !!prod && prod.prefijo === 'P' && prod.codigo === '03' && prod.color === '#2a6f97' && prod.icono === 'fabrica' && prod.activo === true, JSON.stringify(prod));
  ok('el depósito nuevo tiene su propio punto de venta (el siguiente)', !!prod && prod.punto_venta === 2, String(prod?.punto_venta));
  ok('un administrador del depósito (no dueño) no puede crear depósitos', /Solo el dueño/.test(msj(await crearDep(C, 'Taller', 't'))));
  ok('un operario no puede crear depósitos', /Solo el dueño/.test(msj(await crearDep(sinDueno, 'Taller', 't'))));
  ok('sin sesión no se pueden crear depósitos', !!(await como('anon', null, `select * from public.crear_deposito('Taller', 'T', null, 'deposito')`)).error);
  ok('el nombre no se puede repetir (ni cambiando mayúsculas)', /Ya hay un depósito con ese nombre/.test(msj(await crearDep(A, 'producción', 't'))));
  ok('la letra no se puede repetir', /letra ya la usa/.test(msj(await crearDep(A, 'Otro', 'p'))));
  ok('la letra tiene que ser una sola letra', /una sola letra/.test(msj(await crearDep(A, 'Otro', '1'))) && /una sola letra/.test(msj(await crearDep(A, 'Otro', 'ab'))));
  ok('el color tiene que ser un código de color', /color/.test(msj(await crearDep(A, 'Otro', 'o', 'rojo'))));
  ok('el nombre no puede estar vacío', /nombre/.test(msj(await crearDep(A, '   ', 'o'))));
  ok('el ícono tiene que ser una palabra simple', /ícono/.test(msj(await crearDep(A, 'Otro', 'o', null, 'Mal icono!'))));
  ok('crear un depósito no deja nada a medias cuando falla (sigue habiendo 3)', (await q(`select count(*)::int as n from public.depositos`))[0].n === 3);

  const ed = q1(await editarDep(A, prod.id, 'Producción 2', '#aa3300', 'cajas', true));
  ok('el dueño edita nombre, color e ícono', !!ed && ed.nombre === 'Producción 2' && ed.color === '#aa3300' && ed.icono === 'cajas', JSON.stringify(ed));
  ok('quitar el color (volver al de la marca) funciona', q1(await editarDep(A, prod.id, 'Producción 2', null, 'cajas', true))?.color === null);
  ok('un administrador del depósito (no dueño) no puede editar depósitos', /Solo el dueño/.test(msj(await editarDep(C, prod.id, 'X', null, 'deposito', true))));
  ok('editar no deja repetir el nombre de otro depósito', /Ya hay un depósito con ese nombre/.test(msj(await editarDep(A, prod.id, 'insumos', null, 'cajas', true))));
  ok('la letra se puede cambiar mientras el depósito no tiene repuestos', q1(await editarDep(A, prod.id, 'Producción 2', null, 'cajas', true, 'q'))?.prefijo === 'Q');
  ok('la letra ya no se puede cambiar cuando hay repuestos', /ya no se puede cambiar/.test(msj(await editarDep(A, insumosId, 'Insumos', null, 'deposito', true, 'Z'))));
  ok('el depósito principal no se puede desactivar', /principal no se puede desactivar/.test(msj(await editarDep(A, principalId, 'Principal', null, 'deposito', false))));
  ok('editar un depósito que no existe avisa', /No existe/.test(msj(await editarDep(A, '00000000-0000-0000-0000-0000000000ff', 'X', null, 'deposito', true))));
  ok('nadie escribe la tabla de depósitos directamente (ni el dueño)', !!(await como('authenticated', A, `update public.depositos set nombre = 'Hackeado' where id = '${prod.id}'`)).error
    || (await q(`select nombre from public.depositos where id = '${prod.id}'`))[0].nombre === 'Producción 2');

  // desactivar libera un lugar del tope; reactivar lo vuelve a ocupar (y respeta el tope)
  ok('el dueño desactiva un depósito', q1(await editarDep(A, prod.id, 'Producción 2', null, 'cajas', false))?.activo === false);
  await tope(2); // principal + Insumos
  ok('no se puede reactivar un depósito si el tope ya está lleno', /permite hasta 2/.test(msj(await editarDep(A, prod.id, 'Producción 2', null, 'cajas', true))));
  await tope(3);
  ok('con lugar en el tope se reactiva', q1(await editarDep(A, prod.id, 'Producción 2', null, 'cajas', true))?.activo === true);
  ok('desactivado o no, el depósito conserva su número y no se borra', (await q(`select count(*)::int as n from public.depositos where codigo = '03'`))[0].n === 1);

  // el tope es solo de quien vende: el dueño no puede subirlo
  const subir = await como('authenticated', A, `update public.licencia set max_depositos = 50 returning id`);
  ok('el dueño no puede cambiar el tope de depósitos', (Array.isArray(subir) ? subir.length === 0 : !!subir.error) && (await q(`select max_depositos from public.licencia`))[0].max_depositos === 3);
  ok('el tope tiene que estar entre 1 y 100', await db.exec(`update public.licencia set max_depositos = 0`).then(() => false, () => true) && await db.exec(`update public.licencia set max_depositos = 101`).then(() => false, () => true));

  // --- Permiso "Gestionar depósitos": el dueño autoriza a otras personas ---
  await tope(10);
  const darPermiso = (quien, uid, valor) => como('authenticated', quien, `update public.usuarios_perfil set puede_gestionar_depositos = ${valor} where id = '${uid}' returning id`);
  ok('nadie nace con el permiso de gestionar depósitos', (await q(`select count(*)::int as n from public.usuarios_perfil where puede_gestionar_depositos`))[0].n === 0);
  ok('una persona no se puede dar a sí misma el permiso', /No tenés permiso/.test(msj(await darPermiso(sinDueno, sinDueno, true))));
  const intento = await darPermiso(C, sinDueno, true); // la base no le deja tocar la fila de otro: o falla o no cambia ninguna
  ok('un administrador del depósito (no dueño) no se lo puede dar a otro', (Array.isArray(intento) ? intento.length === 0 : !!intento.error)
    && (await q(`select puede_gestionar_depositos as v from public.usuarios_perfil where id = '${sinDueno}'`))[0].v === false);
  ok('el dueño da el permiso', Array.isArray(await darPermiso(A, sinDueno, true)) && (await q(`select puede_gestionar_depositos as v from public.usuarios_perfil where id = '${sinDueno}'`))[0].v === true);
  ok('dar el permiso queda en el historial', (await q(`select 1 from public.audit_log where tabla = 'usuarios_perfil' and registro_id = '${sinDueno}' and descripcion like '%gestionar depósitos%'`)).length >= 1);
  const delAutorizado = q1(await crearDep(sinDueno, 'Taller', 't', null, 'herramienta'));
  ok('con el permiso, una persona que no es dueña crea un depósito', !!delAutorizado && delAutorizado.nombre === 'Taller', JSON.stringify(delAutorizado));
  ok('con el permiso, edita un depósito', q1(await editarDep(sinDueno, delAutorizado.id, 'Taller central', null, 'herramienta', true))?.nombre === 'Taller central');
  ok('con el permiso igual respeta el tope', await tope(4).then(async () => /permite hasta 4/.test(msj(await crearDep(sinDueno, 'Otro más', 'x')))));
  await tope(10);
  ok('con el permiso no puede subir el tope (eso es de quien vende)', (await como('authenticated', sinDueno, `update public.licencia set max_depositos = 50 returning id`)).length === 0);
  await db.exec(`select set_config('request.jwt.claim.sub', '', false); update public.usuarios_perfil set activo = false where id = '${sinDueno}'`);
  ok('bloqueado, el permiso no le sirve', !!msj(await crearDep(sinDueno, 'Bloqueado', 'b')));
  await db.exec(`select set_config('request.jwt.claim.sub', '', false); update public.usuarios_perfil set activo = true where id = '${sinDueno}'`);
  ok('el dueño saca el permiso', Array.isArray(await darPermiso(A, sinDueno, false)));
  ok('sin el permiso ya no puede crear ni editar depósitos', /Solo el dueño/.test(msj(await crearDep(sinDueno, 'Otro', 'o'))) && /Solo el dueño/.test(msj(await editarDep(sinDueno, delAutorizado.id, 'X', null, 'deposito', true))));
  await tope(1);

  // --- Seguridad, fase 1 (auditoría del 2026-10-17) ---
  await db.exec("select set_config('request.jwt.claim.sub', '', false)");
  const NUEVO = '00000000-0000-0000-0000-0000000000e1', SOLO_DIR = '00000000-0000-0000-0000-0000000000e2';
  await db.exec(`insert into auth.users (id, email) values ('${NUEVO}', 'nuevo@x.com'), ('${SOLO_DIR}', 'directorio@x.com');
    update public.usuarios_perfil set activo = true, rol = 'admin', mantenimiento_rol = null where id = '${SOLO_DIR}';`);
  ok('una cuenta nueva nace bloqueada (sin acceso hasta que un dueño la habilite)', (await q(`select activo from public.usuarios_perfil where id = '${NUEVO}'`))[0].activo === false);
  ok('la cuenta nueva no lee nada (ni proveedores)', filas(await como('authenticated', NUEVO, 'select * from public.proveedores')) === 0);
  const sobrantes = await q(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')`);
  ok('nadie con o sin sesión tiene TRUNCATE, REFERENCES ni TRIGGER sobre las tablas', sobrantes.length === 0, sobrantes.slice(0, 3).map(x => `${x.table_name}:${x.grantee}:${x.privilege_type}`).join(', '));
  ok('quien es solo del Directorio no lee los repuestos', filas(await como('authenticated', SOLO_DIR, 'select * from public.items')) === 0);
  ok('quien tiene acceso al Depósito sí los lee', filas(await como('authenticated', sinDueno, 'select * from public.items')) >= 1);
  ok('quien es solo del Directorio no puede buscar repuestos', /No autorizado/.test(msj(await como('authenticated', SOLO_DIR, `select * from public.buscar_repuestos('ZZ', 10, null, null)`))));
  ok('un usuario común del Depósito sí busca', Array.isArray(await como('authenticated', sinDueno, `select * from public.buscar_repuestos('ZZ', 10, null, null)`)));
  ok('el Informe de reposición no lo pide un usuario común del Depósito', /No autorizado/.test(msj(await como('authenticated', sinDueno, `select * from public.repuestos_a_reponer(null, null, null, 10)`))));
  ok('el Informe sí lo pide un administrador del Depósito', Array.isArray(await como('authenticated', C, `select * from public.repuestos_a_reponer(null, null, null, 10)`)));
  const porFila = await q(`select schemaname || '.' || tablename || '.' || policyname as p from pg_policies where schemaname in ('public', 'storage')
    and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(auth\\.uid\\(\\)|is_owner\\(\\)|is_[a-z_]*admin\\(\\)|tiene_acceso_[a-z]*\\(\\)|modulo_activo\\(|usuario_activo\\(\\)|can_[a-z_]*\\(\\))'
    and (coalesce(qual, '') || coalesce(with_check, '')) !~* '\\( *select'`);
  ok('ninguna regla llama funciones fila por fila (todas una sola vez por consulta)', porFila.length === 0, porFila.map(x => x.p).join(', '));
  ok('hay índice para listar los movimientos de un depósito', (await q(`select 1 from pg_indexes where indexname = 'movimientos_stock_deposito_fecha_idx'`)).length === 1);
  ok('la función que quita permisos no la ejecuta nadie con sesión', (await q(`select has_function_privilege('authenticated', 'public._quitar_permisos_sobrantes()', 'execute') as v`))[0].v === false);
}

console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO BIEN en la instalación desde cero');
process.exit(fallas ? 1 : 0);
