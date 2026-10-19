// Actualización de una instalación que ya existe (el camino de Cremac): base armada con las 11 migraciones originales y con datos,
// más las migraciones nuevas de cada componente. Tiene que quedar con los datos intactos y con el mismo esquema que una instalación nueva.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { aplicar, crearBase } from './base.mjs';
import { comparar, sacarFoto } from './catalogo.mjs';

const RAIZ = join(import.meta.dirname, '..', '..', '..', 'supabase') + '/';
const originales = readdirSync(RAIZ + 'migrations').filter(f => f.endsWith('.sql')).sort();
const ULT = originales.at(-1).split('_')[0];
const nuevas = c => readdirSync(join(RAIZ, 'componentes', c)).filter(f => f.endsWith('.sql') && f.split('_')[0] > ULT).sort().map(f => join(RAIZ, 'componentes', c, f));
const todas = c => readdirSync(join(RAIZ, 'componentes', c)).filter(f => f.endsWith('.sql')).sort().map(f => join(RAIZ, 'componentes', c, f));

let fallas = 0;
const ok = (n, c, d = '') => { if (!c) fallas++; console.log(`${c ? 'OK   ' : 'FALLA'} ${n}${d ? '  → ' + d : ''}`); };

// 1) Cremac: original + datos + migraciones nuevas
const cremac = await crearBase(originales);
await cremac.exec(`
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a','dueno@cremac.com');
  update public.usuarios_perfil set rol='admin', mantenimiento_rol='admin', es_owner=true where id='00000000-0000-0000-0000-00000000000a';
  insert into public.proveedores (nombre) values ('Proveedor real');
  insert into public.familias (codigo, nombre) values ('AA','Fam');
  insert into public.sectores (nombre) values ('Quesería');
  insert into public.equipos (sector, nombre) values ('Quesería','Prensa');
  update public.configuracion set color_deposito = '#7a2a8a' where id = 1;
  insert into public.subfamilias (familia_id, codigo, nombre) select id, 'BB', 'Sub' from public.familias where codigo = 'AA';
  insert into public.items (codigo, numero, descripcion, detalles, familia_id, subfamilia_id) select 'MAABB00001', '00001', 'Piñón Z20', 'piñón de desmoldeo', f.id, s.id from public.familias f join public.subfamilias s on s.familia_id = f.id where f.codigo = 'AA';
`);
const antes = (await cremac.query(`select modulos from public.licencia`)).rows[0].modulos;
ok('Cremac antes: licencia con los 5 módulos de siempre, sin "mantenimiento"', antes.deposito === true && antes.mantenimiento === undefined);
// Se aplica todo lo nuevo salvo el traslado de "detalles" a "palabras clave"; la foto del repuesto se toma justo antes de ese traslado (otras migraciones sí tocan cada repuesto).
const TRASLADO = '20260101002800_palabras_clave_y_busqueda.sql';
const pendientes = [...nuevas('base'), ...nuevas('abastecimiento'), ...nuevas('mantenimiento')];
await aplicar(cremac, pendientes.filter(a => !a.endsWith(TRASLADO)));
const itemAntes = (await cremac.query(`select updated_at from public.items where codigo = 'MAABB00001'`)).rows[0];
const auditoriaAntes = (await cremac.query(`select count(*)::int as n from public.audit_log where tabla = 'items'`)).rows[0].n;
await aplicar(cremac, pendientes.filter(a => a.endsWith(TRASLADO)));
const lic = (await cremac.query(`select modulos, componentes from public.licencia`)).rows[0];
ok('Después: "mantenimiento" prendido (heredó el depósito)', lic.modulos.mantenimiento === true);
ok('Después: componentes = abastecimiento, base, mantenimiento', JSON.stringify(lic.componentes) === '["abastecimiento","base","mantenimiento"]', JSON.stringify(lic.componentes));
const datos = (await cremac.query(`select (select count(*)::int from public.proveedores) p, (select count(*)::int from public.equipos) e, (select count(*)::int from public.sectores) s, (select count(*)::int from public.usuarios_perfil) u`)).rows[0];
ok('El color que la empresa había elegido para el depósito pasó al depósito principal', (await cremac.query(`select color, icono, nombre from public.depositos where es_principal`)).rows[0].color === '#7a2a8a');
const movido = (await cremac.query(`select palabras_clave, detalles, updated_at from public.items where codigo = 'MAABB00001'`)).rows[0];
ok('Lo que había en "detalles" pasó a "palabras clave" y "detalles" quedó libre', movido.palabras_clave === 'piñón de desmoldeo' && movido.detalles === null, JSON.stringify(movido));
ok('El traslado no cambió la versión del repuesto ni llenó el historial', String(movido.updated_at) === String(itemAntes.updated_at) && (await cremac.query(`select count(*)::int as n from public.audit_log where tabla = 'items'`)).rows[0].n === auditoriaAntes);
await cremac.exec(`update public.configuracion set color_deposito = null where id = 1; update public.depositos set color = null;`); // el color era un dato de la prueba: se quita para comparar solo el esquema
ok('Los datos que ya tenía siguen ahí', datos.p === 1 && datos.e === 1 && datos.s === 1 && datos.u === 1, JSON.stringify(datos));

// 2) mismo esquema que una instalación nueva por componentes
const nueva = await crearBase([...todas('base'), ...todas('abastecimiento'), ...todas('mantenimiento')]);
const dif = comparar(await sacarFoto(nueva), await sacarFoto(cremac));
ok('El esquema de Cremac actualizado es IDÉNTICO al de una instalación nueva', dif.length === 0, dif.length ? dif.length + ' diferencias' : '');
dif.slice(0, 10).forEach(d => console.log('     ' + d));

// 3) el interruptor funciona sobre Cremac actualizado
await cremac.exec(`select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a', false); set role authenticated;`);
let e = null; try { await cremac.exec(`select public.definir_modulo_del_dueno('tareas', true)`); } catch (x) { e = x; }
await cremac.exec('reset role;');
ok('El dueño de Cremac puede apagar Tareas', !e, e?.message);
console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO BIEN: el camino de Cremac funciona');
process.exit(fallas ? 1 : 0);
