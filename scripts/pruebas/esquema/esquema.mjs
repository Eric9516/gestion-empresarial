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
  update public.usuarios_perfil set rol='admin', mantenimiento_rol='admin', es_owner=true where id='${A}';
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
await db.exec(`
  insert into public.familias (codigo, nombre) values ('ZZ', 'Fam');
  insert into public.subfamilias (familia_id, codigo, nombre) select id, 'ZZ', 'Sub' from public.familias where codigo = 'ZZ';
  insert into public.items (codigo, numero, descripcion, familia_id, subfamilia_id, stock)
    select 'AJ1', '1', 'Repuesto', f.id, sf.id, 10 from public.familias f join public.subfamilias sf on sf.familia_id = f.id where f.codigo = 'ZZ';
  update public.usuarios_perfil set puede_ajustar_inventario = true where id = '${B}';
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
  await db.exec(`insert into auth.users (id, email) values ('${C}','admin@x.com'); update public.usuarios_perfil set rol='admin', mantenimiento_rol='admin' where id='${C}';`);
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

  // Mantenimiento como módulo propio
  const prov = (await q(`insert into public.proveedores (nombre) values ('ProvM') returning id`))[0].id;
  const rep = await como('authenticated', A, `select public.crear_reparacion('${prov}', 'prueba', current_date, null, '[{"item_id":"${item}","cantidad":1}]'::jsonb) as id`);
  ok('con Mantenimiento prendido se crea una reparación', Array.isArray(rep) && !!rep[0]?.id, JSON.stringify(rep).slice(0, 140));
  ok('el dueño apaga Mantenimiento', !(await apagar(A, 'mantenimiento')).error);
  ok('apagado: las reparaciones no se pueden crear', /no está activo/.test((await como('authenticated', A, `select public.crear_reparacion('${prov}', 'otra', current_date, null, '[{"item_id":"${item}","cantidad":1}]'::jsonb)`)).error ?? ''));
  ok('apagado: la base bloquea la lectura de reparaciones', filas(await como('authenticated', A, 'select * from public.reparaciones')) === 0);
  ok('apagado: la base bloquea los equipos', filas(await como('authenticated', A, 'select * from public.equipos')) === 0);
  ok('apagado: el Depósito sigue funcionando', filas(await como('authenticated', A, 'select * from public.items')) >= 1);
  await apagar(A, 'mantenimiento', false);
  await lic('{"proveedores":true,"comisionistas":true,"envios":true,"deposito":true,"tareas":true,"mantenimiento":false}');
  ok('si la licencia no incluye Mantenimiento: no hay reparaciones (aunque el depósito esté prendido)', /no está activo/.test((await como('authenticated', A, `select public.crear_reparacion('${prov}', 'x', current_date, null, '[]'::jsonb)`)).error ?? '') && filas(await como('authenticated', A, 'select * from public.reparaciones')) === 0);
  ok('...y el dueño no puede prenderlo', /no está incluido/.test((await apagar(A, 'mantenimiento', false)).error ?? ''));

  // la licencia sigue siendo solo del vendedor
  await lic(TODOS6);
  const toca = await como('authenticated', A, `update public.licencia set modulos = '{"tareas": false}'::jsonb returning id`);
  ok('el dueño no puede cambiar la licencia', (Array.isArray(toca) ? toca.length === 0 : !!toca.error) && (await act('proveedores')) === true);
  await db.exec(`update public.licencia set componentes = array['base','abastecimiento']`);
  ok('un cambio de componentes de la licencia queda en el historial', (await q(`select 1 from public.audit_log where tabla = 'licencia' and descripcion like '%componentes: base, abastecimiento%'`)).length === 1);
  await db.exec(`update public.licencia set componentes = array['abastecimiento','base','mantenimiento']`);
}

console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO BIEN en la instalación desde cero');
process.exit(fallas ? 1 : 0);
