// Prueba de TODAS las combinaciones de módulos (64) con un dueño iniciando sesión, contra el Supabase local; y además el interruptor del dueño.
// Para cada combinación comprueba tablas, funciones y carpetas de archivos contra lo que dicen las reglas de bloqueo.
import { terminar, q, http, sv, msg, hecho, crearUsuario, entrar, hoy, randomUUID, SERVICIO } from './ayudas-local.mjs';

const MODS = ['proveedores', 'comisionistas', 'envios', 'deposito', 'mantenimiento', 'tareas'];
// qué módulos exige cada tabla (de las reglas "bloqueo_modulo" de la base)
const TABLAS = {
  comisionistas: ['comisionistas'], contactos: ['proveedores'], proveedores: ['proveedores'],
  equipo_items: ['mantenimiento', 'deposito'], equipos: ['mantenimiento', 'deposito'], familias: ['deposito'], items: ['deposito'], planilla_familias: ['deposito'],
  retiro_items: ['deposito'], retiros: ['deposito'], sectores: ['deposito'], subfamilias: ['deposito'],
  item_proveedores: ['deposito', 'proveedores'], reparacion_entregas: ['deposito', 'proveedores'], reparacion_items: ['deposito', 'proveedores'], reparaciones: ['deposito', 'proveedores'],
  rotulo_disenos: ['envios'], rotulos_bultos: ['envios'], rotulos_fotos: ['envios'], rotulos_generados: ['envios'],
  task_history: ['tareas'], tasks: ['tareas'],
  ajustes_inventario: ['deposito'], ajuste_items: ['deposito'],
};
const FUNCIONES = {
  create_task: [['tareas'], { p_title: '', p_description: '', p_traffic_level: 'green' }],
  update_task: [['tareas'], { p_task_id: randomUUID(), p_title: 'x', p_description: '', p_traffic_level: 'green' }],
  complete_task: [['tareas'], { p_task_id: randomUUID() }],
  cancel_task: [['tareas'], { p_task_id: randomUUID() }],
  reprogram_task: [['tareas'], { p_task_id: randomUUID(), p_new_assigned_date: hoy() }],
  process_pending_tasks_for_user: [['tareas'], null],
  crear_reparacion: [['deposito', 'proveedores'], { p_proveedor_id: randomUUID(), p_motivo: 'x', p_fecha_salida: hoy(), p_envio_id: null, p_items: [] }],
  eliminar_reparacion: [['deposito', 'proveedores'], { p_reparacion_id: randomUUID() }],
  restaurar_reparacion: [['deposito', 'proveedores'], { p_reparacion_id: randomUUID() }],
};
FUNCIONES.crear_ajuste_inventario = [['deposito'], { p_motivo: '', p_lineas: [] }];
FUNCIONES.anular_ajuste_inventario = [['deposito'], { p_ajuste_id: randomUUID(), p_motivo: 'x' }];
const BUCKETS = { items: ['deposito'], documentos: ['mantenimiento', 'deposito'], rotulos: ['envios'] };

// datos para que cada tabla tenga al menos una fila que leer
const rastro = [];
const mk = async (t, c) => { const r = await sv('POST', `/rest/v1/${t}`, c); if (!hecho(r)) throw new Error(`siembra ${t}: ${msg(r)}`); const id = r.d[0].id ?? r.d[0].equipo_id; rastro.push([t, id]); return id; };
const dueno = await crearUsuario('zz.ui.dueno@ensayo.invalid', { es_owner: true, rol: 'admin', mantenimiento_rol: 'admin' });
const tok = await entrar('zz.ui.dueno@ensayo.invalid');
const fam = (await sv('GET', '/rest/v1/familias?select=id&nombre=not.like.ZZ*&limit=1')).d[0].id;
const sub = (await sv('GET', `/rest/v1/subfamilias?select=id&familia_id=eq.${fam}&limit=1`)).d[0].id;
const prov = (await sv('GET', '/rest/v1/proveedores?select=id&nombre=not.like.ZZ*&limit=1')).d[0].id;
const item = await mk('items', { codigo: 'ZZMOD' + Math.random().toString(36).slice(2, 7), numero: '1', descripcion: 'ZZ-mod', familia_id: fam, subfamilia_id: sub, stock: 50 });
const sector = (await sv('GET', '/rest/v1/sectores?select=id&limit=1')).d[0].id;
const ret = await mk('retiros', { usuario_id: dueno, sector_id: sector, observacion_general: 'ZZ-mod' });
await mk('retiro_items', { retiro_id: ret, item_id: item, cantidad: 1 });
const equ = await mk('equipos', { sector: 'ZZ', nombre: 'ZZ-mod' }); await sv('POST', '/rest/v1/equipo_items', { equipo_id: equ, item_id: item });
const rep = await mk('reparaciones', { proveedor_id: prov, motivo: 'ZZ-mod', fecha_salida: hoy(), responsable_id: dueno });
const rli = await mk('reparacion_items', { reparacion_id: rep, item_id: item, cantidad: 2, descuenta_stock: true });
await mk('reparacion_entregas', { reparacion_item_id: rli, cantidad_devuelta: 1, resultado: 'baja', fecha_entrega: hoy(), registrado_por: dueno, repone_stock: false });
const tarea = await mk('tasks', { user_id: dueno, title: 'ZZ-mod', status: 'pending', traffic_level: 'green', start_date: hoy(), assigned_date: hoy() });
await sv('POST', '/rest/v1/task_history', { task_id: tarea, user_id: dueno, action: 'created', note: 'ZZ-mod' });
const prov2 = await mk('proveedores', { nombre: 'ZZ-mod prov' }); await mk('contactos', { proveedor_id: prov2, nombre: 'ZZ-mod' });
await mk('comisionistas', { nombre: 'ZZ-mod com' });
const rot = await mk('rotulos_generados', { proveedor_id: prov2, grupo_id: randomUUID(), numero_documento: 'ZZ-mod' });
await mk('rotulos_bultos', { rotulo_id: rot, numero: 1 }); await mk('rotulos_fotos', { grupo_id: randomUUID(), proveedor_id: prov2, storage_path: 'zz-mod/x.png' });
await mk('item_proveedores', { item_id: item, proveedor_id: prov2 });

const ajSeed = await http('POST', '/rest/v1/rpc/crear_ajuste_inventario', { token: tok, cuerpo: { p_motivo: 'ZZ-mod', p_lineas: [{ item_id: item, tipo: 'suma', cantidad: 1 }] } });
if (ajSeed.s !== 200) throw new Error('No pude sembrar el ajuste: ' + msg(ajSeed));
const lic0 = (await sv('GET', '/rest/v1/licencia?select=modulos&id=eq.1')).d[0].modulos;
const fallos = []; let total = 0;
const ponerLicencia = async m => { const r = await sv('PATCH', '/rest/v1/licencia?id=eq.1', { modulos: m }); if (!hecho(r)) throw new Error('licencia: ' + msg(r)); };
const combos = [];
for (let n = 0; n < 64; n++) { const m = {}; MODS.forEach((k, i) => { m[k] = !!(n & (1 << i)); }); combos.push({ nombre: MODS.filter(k => m[k]).join('+') || '(ninguno)', m, licencia: m }); }
// variantes con el módulo ausente (en vez de "false"): deben comportarse igual que apagado
for (const k of MODS) { const m = Object.fromEntries(MODS.map(x => [x, true])); delete m[k]; combos.push({ nombre: `todos menos ${k} (clave ausente)`, m: { ...m, [k]: false }, licencia: m }); }
combos.push({ nombre: 'licencia vacía {}', m: Object.fromEntries(MODS.map(k => [k, false])), licencia: {} });

for (const c of combos) {
  await ponerLicencia(c.licencia);
  const act = ms => ms.every(k => c.m[k]);
  const previos = fallos.length;
  const chk = (que, esperado, real) => { total++; if (esperado !== real) fallos.push(`[${c.nombre}] ${que}: esperado=${esperado} real=${real}`); };
  for (const [t, ms] of Object.entries(TABLAS)) {
    const r = await http('GET', `/rest/v1/${t}?select=*&limit=1`, { token: tok });
    chk(`leer ${t}`, act(ms), r.s === 200 && Array.isArray(r.d) && r.d.length > 0);
  }
  for (const [f, [ms, args]] of Object.entries(FUNCIONES)) {
    const r = await http('POST', `/rest/v1/rpc/${f}`, { token: tok, cuerpo: args ?? { target_user_id: dueno } });
    chk(`función ${f}`, !act(ms), /no está activo/.test(msg(r)));
  }
  const ha = await http('POST', '/rest/v1/rpc/historial_ajustes_por_item', { token: tok, cuerpo: { p_item_id: item } });
  chk('función historial_ajustes_por_item', c.m.deposito, ha.s === 200 && Array.isArray(ha.d) && ha.d.length > 0);
  const h = await http('POST', '/rest/v1/rpc/historial_retiros_por_item', { token: tok, cuerpo: { p_item_id: item } });
  chk('función historial_retiros_por_item', c.m.deposito, h.s === 200 && Array.isArray(h.d) && h.d.length > 0);
  for (const [b, ms] of Object.entries(BUCKETS)) {
    const ruta = `zz-mod/${Math.random().toString(36).slice(2, 8)}.txt`;
    const r = await http('POST', `/storage/v1/object/${b}/${ruta}`, { token: tok, cuerpo: 'zz', crudo: true, cab: { 'Content-Type': 'text/plain' } });
    if (r.s < 300) await http('DELETE', `/storage/v1/object/${b}/${ruta}`, { token: SERVICIO, apikey: SERVICIO });
    chk(`subir a carpeta ${b}`, act(ms), r.s < 300);
  }
  console.log(`${c.nombre.padEnd(52)} ${fallos.length > previos ? '✗' : '✓'}`);
}
await ponerLicencia(lic0);

// ---- el interruptor del dueño (preferencias_modulos): con la licencia completa, apagar un módulo se ve igual que apagarlo en la licencia ----
await ponerLicencia(Object.fromEntries(MODS.map((k) => [k, true])));
const apagarDueno = async (apagados) => { const r = await sv('PATCH', '/rest/v1/preferencias_modulos?id=eq.1', { apagados }); if (!hecho(r) && r.s >= 300) throw new Error('preferencias: ' + msg(r)); };
const gruposDueno = [...MODS.map((k) => [k]), ['proveedores', 'envios'], ['deposito', 'mantenimiento'], ['comisionistas', 'tareas'], MODS];
for (const apagados of gruposDueno) {
  await apagarDueno(Object.fromEntries(apagados.map((k) => [k, true])));
  const m = Object.fromEntries(MODS.map((k) => [k, !apagados.includes(k)]));
  const act = (ms) => ms.every((k) => m[k]);
  const previos = fallos.length;
  const chk = (que, esperado, real) => { total++; if (esperado !== real) fallos.push('[dueño apagó ' + apagados.join('+') + '] ' + que + ': esperado=' + esperado + ' real=' + real); };
  for (const [t, ms] of Object.entries(TABLAS)) {
    const r = await http('GET', '/rest/v1/' + t + '?select=*&limit=1', { token: tok });
    chk('leer ' + t, act(ms), r.s === 200 && Array.isArray(r.d) && r.d.length > 0);
  }
  for (const [f, [ms, args]] of Object.entries(FUNCIONES)) {
    const r = await http('POST', '/rest/v1/rpc/' + f, { token: tok, cuerpo: args ?? { target_user_id: dueno } });
    chk('función ' + f, !act(ms), /no está activo/.test(msg(r)));
  }
  for (const [b, ms] of Object.entries(BUCKETS)) {
    const ruta = 'zz-mod/' + Math.random().toString(36).slice(2, 8) + '.txt';
    const r = await http('POST', '/storage/v1/object/' + b + '/' + ruta, { token: tok, cuerpo: 'zz', crudo: true, cab: { 'Content-Type': 'text/plain' } });
    if (r.s < 300) await http('DELETE', '/storage/v1/object/' + b + '/' + ruta, { token: SERVICIO, apikey: SERVICIO });
    chk('subir a carpeta ' + b, act(ms), r.s < 300);
  }
  console.log(('dueño apagó ' + apagados.join('+')).padEnd(52) + ' ' + (fallos.length > previos ? '✗' : '✓'));
}
await apagarDueno({});
const orden = ['reparacion_entregas', 'reparacion_items', 'reparaciones', 'item_proveedores', 'retiro_items', 'retiros', 'rotulos_fotos', 'rotulos_bultos', 'rotulos_generados', 'contactos', 'proveedores', 'comisionistas', 'tasks', 'equipos', 'items'];
await q(null, `set session_replication_role = replica; delete from public.ajuste_items; delete from public.ajustes_inventario; select 1 ok`);
for (const t of orden) { const ids = rastro.filter(r => r[0] === t).map(r => r[1]); if (ids.length) await sv('DELETE', `/rest/v1/${t}?id=in.(${ids.join(',')})`); }
await sv('DELETE', '/rest/v1/comisionistas?nombre=like.ZZ-mod*'); await sv('DELETE', '/rest/v1/proveedores?nombre=like.ZZ-mod*');
console.log(`\n${total} comprobaciones sobre ${combos.length} combinaciones de módulos: ${fallos.length} diferencias.`);
for (const f of fallos.slice(0, 40)) console.log('  ✗ ' + f);
const lic1 = (await sv('GET', '/rest/v1/licencia?select=modulos&id=eq.1')).d[0].modulos;
console.log('licencia final igual a la inicial:', JSON.stringify(lic1) === JSON.stringify(lic0));

await terminar(fallos.length ? 1 : 0);
