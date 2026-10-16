// Pruebas de la lógica de la app (no de permisos): stock, retiros, reparaciones, fotos pendientes, auditoría,
// funciones de usuarios, reglas del dueño, restricciones de datos, apagado de módulos y acceso sin sesión.
import { terminar, http, sv, msg, hecho, crearUsuario, entrar, hoy, randomUUID, SERVICIO, dueno, correo, q } from './ayudas-local.mjs';

const res = []; let area = '';
const ok = (nombre, cond, detalle = '') => { res.push({ area, nombre, ok: !!cond, detalle: cond ? '' : String(detalle).slice(0, 300) }); if (!cond) console.log(`  ✗ [${area}] ${nombre} — ${String(detalle).slice(0, 200)}`); };
const seccion = t => { area = t; console.log('▶ ' + t); };
const sufijo = () => Math.random().toString(36).slice(2, 8);
const rastro = [];
const R = (t, id) => { rastro.push([t, id]); return id; };

// ---------- personas ----------
const P = {};
const persona = async (clave, extra) => { const mail = correo(`zz.${clave}@ensayo.invalid`); const id = await crearUsuario(mail, extra); P[clave] = { id, mail, tok: await entrar(mail), u: (m, r, c, cab) => http(m, r, { token: P[clave].tok, cuerpo: c, cab }) }; };
await persona('adminDep', { rol: 'user', mantenimiento_rol: 'admin' });
await persona('comunDep', { rol: 'user', mantenimiento_rol: 'comun' });
await persona('adminDir', { rol: 'admin', mantenimiento_rol: null });
await persona('sin', { rol: 'user', mantenimiento_rol: null });
await persona('desact', { rol: 'disabled', mantenimiento_rol: 'comun' });
await persona('reseteador', { rol: 'user', mantenimiento_rol: null, puede_resetear_contrasenas: true });
// un dueño de verdad (de la copia de Cremac)
const dueno0 = (await sv('GET', `/rest/v1/usuarios_perfil?select=id,email,rol&id=eq.${dueno}`)).d[0]; // el dueño de prueba que crea ayudas-local (con la clave de prueba)
P.dueno = { id: dueno0.id, mail: dueno0.email, tok: await entrar(dueno0.email), u: (m, r, c, cab) => http(m, r, { token: P.dueno.tok, cuerpo: c, cab }) };
const duenoB = await crearUsuario('zz.duenob@ensayo.invalid', { es_owner: true, rol: 'admin' });

// datos
const fam = R('familias', (await sv('POST', '/rest/v1/familias', { codigo: 'ZQ', nombre: 'ZZ-l fam' })).d[0].id);
const sub = R('subfamilias', (await sv('POST', '/rest/v1/subfamilias', { familia_id: fam, codigo: 'ZQ', nombre: 'ZZ-l sub' })).d[0].id);
const sector = R('sectores', (await sv('POST', '/rest/v1/sectores', { nombre: 'ZZ-l sector ' + sufijo() })).d[0].id);
// El stock entra con una carga (como en la aplicación): ni la clave de servicio puede escribirlo directo.
const nuevoItem = async ({ stock = 100, ...extra } = {}) => {
  const id = R('items', (await sv('POST', '/rest/v1/items', { codigo: 'ZZL' + sufijo(), numero: '1', descripcion: 'ZZ-l repuesto', familia_id: fam, subfamilia_id: sub, stock_minimo: 0, punto_pedido: 0, ...extra })).d[0].id);
  if (stock) await fijarStock(id, stock);
  return id;
};
const stockDe = async id => Number((await sv('GET', `/rest/v1/items?select=stock&id=eq.${id}`)).d[0].stock);
const item = async id => (await sv('GET', `/rest/v1/items?select=*&id=eq.${id}`)).d[0];
// El stock ya no se escribe a mano: para dejar un repuesto con un stock dado se hace un ajuste (como lo haría un dueño).
const fijarStock = async (id, valor) => {
  const d = valor - await stockDe(id);
  if (!d) return;
  const r = await P.dueno.u('POST', '/rest/v1/rpc/crear_movimiento_stock', { p_clase: 'ajuste', p_fecha: null, p_motivo: 'ZZ-l preparar la prueba', p_referencia: null, p_observaciones: null, p_lineas: [{ item_id: id, tipo: d > 0 ? 'suma' : 'resta', cantidad: Math.abs(d) }] });
  if (!hecho(r)) throw new Error('no se pudo dejar el stock en ' + valor + ': ' + msg(r));
};
const provId = (await sv('GET', '/rest/v1/proveedores?select=id&limit=1')).d[0].id;
const ultimaAuditoria = async (desde, filtro = '') => (await sv('GET', `/rest/v1/audit_log?select=*&id=gt.${desde}${filtro}&order=id.asc`)).d;
const maxAudit = async () => Number((await sv('GET', '/rest/v1/audit_log?select=id&order=id.desc&limit=1')).d[0]?.id ?? 0);

// =====================================================================================
seccion('Stock y retiros');
{
  const it = await nuevoItem();
  const r = await P.comunDep.u('POST', '/rest/v1/retiros', { usuario_id: P.comunDep.id, sector_id: sector });
  const ret = r.d[0].id; R('retiros', ret);
  const l = await P.comunDep.u('POST', '/rest/v1/retiro_items', { retiro_id: ret, item_id: it, cantidad: 5 });
  ok('retirar 5 descuenta el stock (100 → 95)', hecho(l) && await stockDe(it) === 95, msg(l));
  const lid = l.d[0].id;
  const a = await P.comunDep.u('PATCH', `/rest/v1/retiro_items?id=eq.${lid}`, { cantidad: 8 });
  ok('corregir la cantidad a 8 ajusta el stock (→ 92)', hecho(a) && await stockDe(it) === 92, msg(a));
  const b = await P.comunDep.u('PATCH', `/rest/v1/retiro_items?id=eq.${lid}`, { cantidad: 2 });
  ok('corregir la cantidad a 2 devuelve stock (→ 98)', hecho(b) && await stockDe(it) === 98, msg(b));
  const d = await P.comunDep.u('DELETE', `/rest/v1/retiro_items?id=eq.${lid}`);
  ok('borrar la línea devuelve todo el stock (→ 100)', hecho(d) && await stockDe(it) === 100, msg(d));
  await P.comunDep.u('POST', '/rest/v1/retiro_items', { retiro_id: ret, item_id: it, cantidad: 4 });
  const dr = await P.comunDep.u('DELETE', `/rest/v1/retiros?id=eq.${ret}`);
  ok('borrar el retiro entero devuelve el stock (→ 100)', hecho(dr) && await stockDe(it) === 100, msg(dr) + ' stock=' + await stockDe(it));
  const otro = await P.adminDep.u('GET', `/rest/v1/retiros?select=id&usuario_id=eq.${P.comunDep.id}`);
  ok('un administrador del Depósito sin "ver retiros de todos" no ve retiros ajenos', !hecho(otro));
}

seccion('Reposición (stock mínimo y punto de pedido)');
{
  const it = await nuevoItem();
  await fijarStock(it, 3);
  const a = await P.adminDep.u('PATCH', `/rest/v1/items?id=eq.${it}`, { stock_minimo: 10, punto_pedido: 6, estado_reposicion: 'compras' });
  const i1 = await item(it);
  ok('con stock bajo el punto de pedido, el estado "compras" queda y se fecha', hecho(a) && i1.estado_reposicion === 'compras' && !!i1.estado_reposicion_at, msg(a) + JSON.stringify([i1.estado_reposicion, i1.estado_reposicion_at]));
  await fijarStock(it, 50);
  const i2 = await item(it);
  ok('al reponer el stock por encima del punto de pedido, el estado se limpia solo', i2.estado_reposicion === null && i2.estado_reposicion_at === null, JSON.stringify(i2.estado_reposicion));
  await fijarStock(it, 2);
  const m = await P.adminDep.u('PATCH', `/rest/v1/items?id=eq.${it}`, { estado_reposicion: 'inventado' });
  ok('un estado de reposición inventado se rechaza', !hecho(m), msg(m));
  const n = await P.adminDep.u('PATCH', `/rest/v1/items?id=eq.${it}`, { stock_minimo: -1 });
  ok('stock mínimo negativo se rechaza', !hecho(n), msg(n));
  const o = await P.adminDep.u('PATCH', `/rest/v1/items?id=eq.${it}`, { punto_pedido: -2 });
  ok('punto de pedido negativo se rechaza', !hecho(o), msg(o));
}

seccion('Fotos de repuestos (colaborativas)');
{
  const it = await nuevoItem();
  const a = await P.comunDep.u('PATCH', `/rest/v1/items?id=eq.${it}`, { foto_url: 'zz/a.png' });
  const i1 = await item(it);
  ok('un usuario común sube una foto → queda pendiente de aprobación y a su nombre', hecho(a) && i1.foto_pendiente === true && i1.foto_subida_por === P.comunDep.id, msg(a));
  const b = await P.comunDep.u('PATCH', `/rest/v1/items?id=eq.${it}`, { foto_url_2: 'zz/b.png', foto_url_3: 'zz/c.png' });
  const i2 = await item(it);
  ok('segunda y tercera foto también quedan pendientes', hecho(b) && i2.foto_pendiente_2 === true && i2.foto_pendiente_3 === true, msg(b));
  const c = await P.comunDep.u('PATCH', `/rest/v1/items?id=eq.${it}`, { foto_url: null });
  ok('un usuario común no puede borrar una foto', !hecho(c) && /No autorizado/.test(msg(c)), msg(c));
  const d = await P.comunDep.u('PATCH', `/rest/v1/items?id=eq.${it}`, { descripcion: 'cambio' });
  ok('un usuario común no puede cambiar la descripción', !hecho(d) && /No autorizado/.test(msg(d)), msg(d));
  const e = await P.comunDep.u('PATCH', `/rest/v1/items?id=eq.${it}`, { stock: 7 });
  ok('un usuario común no puede cambiar el stock a mano', !hecho(e) && /No autorizado/.test(msg(e)), msg(e));
  const f = await P.adminDep.u('PATCH', `/rest/v1/items?id=eq.${it}`, { foto_url: 'zz/a2.png' });
  const i3 = await item(it);
  ok('un administrador del Depósito cambia la foto → queda aprobada (no pendiente)', hecho(f) && i3.foto_pendiente === false && i3.foto_subida_por === null, msg(f));
}

seccion('Reparaciones');
{
  const it = await nuevoItem({ stock: 100 });
  const ok1 = await P.adminDep.u('POST', '/rest/v1/rpc/crear_reparacion', { p_proveedor_id: provId, p_motivo: 'ZZ-l', p_fecha_salida: hoy(), p_envio_id: null, p_items: [{ item_id: it, cantidad: 3, descuenta_stock: true }] });
  const rep = ok1.d; R('reparaciones', rep);
  ok('crear una reparación que descuenta stock (100 → 97)', ok1.s === 200 && await stockDe(it) === 97, msg(ok1));
  const vacia = await P.adminDep.u('POST', '/rest/v1/rpc/crear_reparacion', { p_proveedor_id: provId, p_motivo: 'x', p_fecha_salida: hoy(), p_envio_id: null, p_items: [] });
  ok('una reparación sin artículos se rechaza', vacia.s >= 400 && /al menos un art/i.test(msg(vacia)), msg(vacia));
  const linea = (await sv('GET', `/rest/v1/reparacion_items?select=id&reparacion_id=eq.${rep}`)).d[0].id;
  const e1 = await P.adminDep.u('POST', '/rest/v1/reparacion_entregas', { reparacion_item_id: linea, cantidad_devuelta: 2, resultado: 'reparado', fecha_entrega: hoy(), registrado_por: P.adminDep.id, repone_stock: true });
  ok('entrega de 2 reparados que reponen stock (97 → 99)', hecho(e1) && await stockDe(it) === 99, msg(e1));
  const e2 = await P.adminDep.u('POST', '/rest/v1/reparacion_entregas', { reparacion_item_id: linea, cantidad_devuelta: 2, resultado: 'reparado', fecha_entrega: hoy(), registrado_por: P.adminDep.id, repone_stock: true });
  ok('no se puede entregar más de lo pendiente', !hecho(e2) && /pendientes/.test(msg(e2)), msg(e2));
  const e3 = await P.adminDep.u('POST', '/rest/v1/reparacion_entregas', { reparacion_item_id: linea, cantidad_devuelta: 1, resultado: 'baja', fecha_entrega: hoy(), registrado_por: P.adminDep.id, repone_stock: false });
  ok('entrega "baja" no repone stock (sigue en 99)', hecho(e3) && await stockDe(it) === 99, msg(e3));
  const mod = await P.adminDep.u('PATCH', `/rest/v1/reparacion_items?id=eq.${linea}`, { cantidad: 5 });
  ok('una línea con entregas no se puede modificar', !hecho(mod) && /entrega registrada/.test(msg(mod)), msg(mod));
  const pend = await P.adminDep.u('POST', '/rest/v1/rpc/reparacion_item_pendiente', { p_reparacion_item_id: linea });
  ok('pendiente calculado = 0 tras entregar todo', pend.s === 200 && Number(pend.d) === 0, JSON.stringify(pend.d));
  const el = await P.adminDep.u('POST', '/rest/v1/rpc/eliminar_reparacion', { p_reparacion_id: rep });
  const r1 = (await sv('GET', `/rest/v1/reparaciones?select=activo,eliminado_por&id=eq.${rep}`)).d[0];
  ok('eliminar la reparación la manda a la papelera con quién la eliminó', el.s < 300 && r1.activo === false && r1.eliminado_por === P.adminDep.id, msg(el));
  const re = await P.adminDep.u('POST', '/rest/v1/rpc/restaurar_reparacion', { p_reparacion_id: rep });
  const r2 = (await sv('GET', `/rest/v1/reparaciones?select=activo,eliminado_por&id=eq.${rep}`)).d[0];
  ok('restaurarla la vuelve a activar', re.s < 300 && r2.activo === true && r2.eliminado_por === null, msg(re));
  const del = await P.adminDep.u('DELETE', `/rest/v1/reparacion_entregas?id=eq.${e1.d[0].id}`);
  ok('borrar la entrega que repuso stock lo descuenta de nuevo (99 → 97)', hecho(del) && await stockDe(it) === 97, msg(del) + ' stock=' + await stockDe(it));
  // La ficha del repuesto recoge todo lo que movió la reparación (salida, regreso y borrado de la entrega; eliminar y restaurar no mueven stock porque todo ya se entregó) y los saldos cuadran con el stock.
  const fichaRep = (await P.adminDep.u('POST', '/rest/v1/rpc/ficha_de_stock', { p_item_id: it, p_limite: 200 })).d;
  let cuadra = Array.isArray(fichaRep) && fichaRep.length === 4 && Number(fichaRep[0].existencia) === 97 && fichaRep.every(m => m.tipo === 'reparacion' || m.tipo === 'ajuste');
  for (let i = 0; Array.isArray(fichaRep) && i < fichaRep.length - 1; i++) {
    if (fichaRep[i].existencia === null || fichaRep[i + 1].existencia === null) continue;
    if (Number(fichaRep[i].existencia) - (Number(fichaRep[i].entrada) - Number(fichaRep[i].salida)) !== Number(fichaRep[i + 1].existencia)) cuadra = false;
  }
  ok('la ficha del repuesto recoge los movimientos de la reparación y los saldos cuadran con el stock (97)', cuadra, JSON.stringify((fichaRep || []).map?.(m => [m.tipo, m.detalle, m.entrada, m.salida, m.existencia])));
  const noAdm = await P.comunDep.u('POST', '/rest/v1/rpc/crear_reparacion', { p_proveedor_id: provId, p_motivo: 'x', p_fecha_salida: hoy(), p_envio_id: null, p_items: [{ item_id: it, cantidad: 1, descuenta_stock: true }] });
  ok('un usuario común no puede crear reparaciones', noAdm.s >= 400, msg(noAdm));
}

seccion('Restricciones de datos');
{
  const f1 = await P.adminDep.u('POST', '/rest/v1/familias', { codigo: 'ab', nombre: 'ZZ' });
  ok('código de familia en minúsculas se rechaza', !hecho(f1), msg(f1));
  const f2 = await P.adminDep.u('POST', '/rest/v1/familias', { codigo: 'ABC', nombre: 'ZZ' });
  ok('código de familia de 3 letras se rechaza', !hecho(f2), msg(f2));
  const f3 = await P.adminDep.u('POST', '/rest/v1/familias', { codigo: 'ZQ', nombre: 'ZZ otra' });
  ok('código de familia repetido se rechaza', !hecho(f3), msg(f3));
  const s1 = await P.adminDep.u('POST', '/rest/v1/subfamilias', { familia_id: fam, codigo: 'ZQ', nombre: 'dup' });
  ok('subfamilia repetida en la misma familia se rechaza', !hecho(s1), msg(s1));
  const it = await nuevoItem();
  const d1 = await P.adminDep.u('POST', '/rest/v1/items', { codigo: (await item(it)).codigo, numero: '1', descripcion: 'dup', familia_id: fam, subfamilia_id: sub });
  ok('código de repuesto repetido se rechaza', !hecho(d1), msg(d1));
  const bf = await P.dueno.u('DELETE', `/rest/v1/familias?id=eq.${fam}`);
  ok('no se puede borrar una familia que tiene repuestos', !hecho(bf), msg(bf));
  const c1 = await P.adminDir.u('PATCH', '/rest/v1/configuracion?id=eq.1', { color_primario: '#12' });
  ok('un color mal escrito se rechaza', !hecho(c1), msg(c1));
  const c2 = await P.adminDir.u('PATCH', '/rest/v1/configuracion?id=eq.1', { color_primario: '#1a3a6b' });
  ok('un color válido se acepta', hecho(c2), msg(c2));
  await P.adminDir.u('PATCH', '/rest/v1/configuracion?id=eq.1', { color_primario: null });
  const t1 = await P.comunDep.u('POST', '/rest/v1/rpc/create_task', { p_title: '   ', p_description: '', p_traffic_level: 'green' });
  ok('tarea con título vacío se rechaza', t1.s >= 400, msg(t1));
  const t2 = await P.comunDep.u('POST', '/rest/v1/rpc/create_task', { p_title: 'x', p_description: '', p_traffic_level: 'azul' });
  ok('semáforo inválido se rechaza', t2.s >= 400, msg(t2));
  const t3 = await P.comunDep.u('POST', '/rest/v1/rpc/create_task', { p_title: 'x', p_description: '', p_traffic_level: 'green', p_assigned_date: '2020-01-01' });
  ok('tarea con fecha pasada se rechaza', t3.s >= 400, msg(t3));
}

seccion('Tareas (ciclo completo)');
{
  const c = await P.comunDep.u('POST', '/rest/v1/rpc/create_task', { p_title: 'ZZ-l tarea', p_description: 'd', p_traffic_level: 'yellow' });
  const id = c.d; R('tasks', id);
  ok('crear tarea', c.s === 200 && typeof id === 'string', msg(c));
  const e = await P.comunDep.u('POST', '/rest/v1/rpc/update_task', { p_task_id: id, p_title: 'ZZ-l editada', p_description: 'd2', p_traffic_level: 'red' });
  const t = (await sv('GET', `/rest/v1/tasks?select=*&id=eq.${id}`)).d[0];
  ok('editar tarea', e.s < 300 && t.title === 'ZZ-l editada' && t.traffic_level === 'red', msg(e));
  const rp = await P.comunDep.u('POST', '/rest/v1/rpc/reprogram_task', { p_task_id: id, p_new_assigned_date: hoy() });
  ok('reprogramar tarea', rp.s < 300, msg(rp));
  const rpP = await P.comunDep.u('POST', '/rest/v1/rpc/reprogram_task', { p_task_id: id, p_new_assigned_date: '2020-01-01' });
  ok('reprogramar a una fecha pasada se rechaza', rpP.s >= 400, msg(rpP));
  const co = await P.comunDep.u('POST', '/rest/v1/rpc/complete_task', { p_task_id: id });
  const t2 = (await sv('GET', `/rest/v1/tasks?select=status,completed_at&id=eq.${id}`)).d[0];
  ok('completar tarea', co.s < 300 && t2.status === 'completed' && !!t2.completed_at, msg(co));
  const co2 = await P.comunDep.u('POST', '/rest/v1/rpc/complete_task', { p_task_id: id });
  ok('una tarea completada no se puede volver a completar', co2.s >= 400, msg(co2));
  const c2 = await P.comunDep.u('POST', '/rest/v1/rpc/create_task', { p_title: 'ZZ-l 2', p_description: '', p_traffic_level: 'green' });
  R('tasks', c2.d);
  const ca = await P.comunDep.u('POST', '/rest/v1/rpc/cancel_task', { p_task_id: c2.d });
  ok('cancelar tarea', ca.s < 300, msg(ca));
  const h = (await sv('GET', `/rest/v1/task_history?select=action&task_id=eq.${id}&order=created_at.asc`)).d.map(x => x.action);
  ok('el historial de la tarea registra cada paso', ['created', 'edited', 'reprogrammed', 'completed'].every(a => h.includes(a)), h.join(','));
  // arrastre de tareas atrasadas
  const vieja = R('tasks', (await sv('POST', '/rest/v1/tasks', { user_id: P.comunDep.id, title: 'ZZ-l vieja', status: 'pending', traffic_level: 'green', start_date: new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10), assigned_date: new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10), pending_days: 0, carry_count: 0, is_stagnant: false })).d[0].id);
  const pr = await P.comunDep.u('POST', '/rest/v1/rpc/process_pending_tasks_for_user', { target_user_id: P.comunDep.id });
  const tv = (await sv('GET', `/rest/v1/tasks?select=*&id=eq.${vieja}`)).d[0];
  ok('una tarea atrasada se arrastra a hoy, pasa a rojo y se marca estancada', pr.s === 200 && tv.assigned_date === hoy() && tv.traffic_level === 'red' && tv.is_stagnant === true && tv.carry_count === 1, JSON.stringify(tv));
  const ajena = await P.sin.u('POST', '/rest/v1/rpc/process_pending_tasks_for_user', { target_user_id: P.comunDep.id });
  ok('un usuario común no procesa las tareas de otro', ajena.s >= 400, msg(ajena));
  const cont = await P.adminDir.u('POST', '/rest/v1/rpc/get_user_task_counts', { target_user_id: P.comunDep.id });
  ok('un administrador del Directorio ve los contadores de tareas de otro', cont.s === 200 && Number(cont.d[0].total) >= 3, JSON.stringify(cont.d));
}

seccion('Reglas del dueño');
{
  const act = await P.dueno.u('PATCH', `/rest/v1/usuarios_perfil?id=eq.${P.dueno.id}`, { activo: false });
  ok('un dueño no puede bloquearse', !hecho(act) && /bloquear a un due/.test(msg(act)), msg(act));
  const borrar = await P.dueno.u('DELETE', `/rest/v1/usuarios_perfil?id=eq.${P.adminDep.id}`);
  ok('nadie borra perfiles por la API directa (sin regla de borrado)', !hecho(borrar), msg(borrar));
  const bd = await sv('DELETE', `/rest/v1/usuarios_perfil?id=eq.${duenoB}`);
  ok('ni siquiera con la clave de servicio se borra el perfil de un dueño', !hecho(bd) && /No se puede eliminar a un due/.test(msg(bd)), msg(bd));
  const nuevo = await P.dueno.u('POST', '/rest/v1/rpc/agregar_dueno', { p_id: P.sin.id });
  ok('agregar a otro dueño', nuevo.s < 300 && (await sv('GET', `/rest/v1/usuarios_perfil?select=es_owner&id=eq.${P.sin.id}`)).d[0].es_owner === true, msg(nuevo));
  const bl = await P.dueno.u('PATCH', `/rest/v1/usuarios_perfil?id=eq.${P.sin.id}`, { activo: false });
  ok('un dueño no puede bloquear a otro dueño', !hecho(bl), msg(bl));
  const q1 = await P.dueno.u('POST', '/rest/v1/rpc/quitar_dueno', { p_id: P.sin.id });
  ok('quitar el cargo de dueño', q1.s < 300 && (await sv('GET', `/rest/v1/usuarios_perfil?select=es_owner&id=eq.${P.sin.id}`)).d[0].es_owner === false, msg(q1));
  const ex = await P.dueno.u('POST', '/rest/v1/rpc/agregar_dueno', { p_id: randomUUID() });
  ok('agregar como dueño a alguien que no existe se rechaza', ex.s >= 400, msg(ex));
  await sv('PATCH', `/rest/v1/usuarios_perfil?id=eq.${P.reseteador.id}`, { activo: false });
  const bq = await P.dueno.u('POST', '/rest/v1/rpc/agregar_dueno', { p_id: P.reseteador.id });
  ok('agregar como dueño a un usuario bloqueado se rechaza', bq.s >= 400, msg(bq));
  await sv('PATCH', `/rest/v1/usuarios_perfil?id=eq.${P.reseteador.id}`, { activo: true });
  // dejar un único dueño y probar que no se puede quedar sin ninguno
  const duenos = (await sv('GET', '/rest/v1/usuarios_perfil?select=id&es_owner=eq.true')).d.map(x => x.id).filter(id => id !== P.dueno.id);
  for (const id of duenos) await sv('PATCH', `/rest/v1/usuarios_perfil?id=eq.${id}`, { es_owner: false });
  const ult = await P.dueno.u('POST', '/rest/v1/rpc/quitar_dueno', { p_id: P.dueno.id });
  ok('no se puede quitar al último dueño', ult.s >= 400 && /al menos un due/.test(msg(ult)), msg(ult));
  const dir = await P.dueno.u('PATCH', `/rest/v1/usuarios_perfil?id=eq.${P.dueno.id}`, { es_owner: false });
  const sigue = (await sv('GET', `/rest/v1/usuarios_perfil?select=es_owner&id=eq.${P.dueno.id}`)).d[0].es_owner;
  ok('tampoco se puede quedar sin dueño sacándose el cargo por la tabla', sigue === true, msg(dir));
  for (const id of duenos) await sv('PATCH', `/rest/v1/usuarios_perfil?id=eq.${id}`, { es_owner: true });
  const duenosAlFinal = (await sv('GET', '/rest/v1/usuarios_perfil?select=id&es_owner=eq.true')).d.length;
  ok('los dueños quedaron como estaban', duenosAlFinal === duenos.length + 1, duenosAlFinal);
}

seccion('Funciones del servidor: crear, resetear y eliminar usuarios');
{
  const mail = `zz.nuevo.${sufijo()}@ensayo.invalid`;
  const c = await P.dueno.u('POST', '/functions/v1/create-user', { email: mail, password: 'Clave1234', nombre: 'ZZ Nuevo', apellido: 'Prueba', rol: 'user', mantenimiento_rol: 'comun', puede_ver_retiros: true, puede_ver_sugerencias: true });
  ok('el dueño crea un usuario', c.s === 200 && !!c.d?.id, msg(c));
  const nid = c.d?.id;
  const perfil = (await sv('GET', `/rest/v1/usuarios_perfil?select=*&id=eq.${nid}`)).d?.[0];
  ok('el usuario nuevo queda con los roles y permisos pedidos', perfil && perfil.rol === 'user' && perfil.mantenimiento_rol === 'comun' && perfil.puede_ver_retiros && perfil.puede_ver_sugerencias && !perfil.puede_ver_errores && !perfil.es_owner && perfil.activo, JSON.stringify(perfil));
  const lg = await http('POST', '/auth/v1/token?grant_type=password', { cuerpo: { email: mail, password: 'Clave1234' } });
  ok('el usuario nuevo puede entrar con su contraseña', lg.s === 200, msg(lg));
  const dup = await P.dueno.u('POST', '/functions/v1/create-user', { email: mail, password: 'Clave1234', nombre: 'dup' });
  ok('no se puede crear dos veces el mismo correo', dup.s >= 400, msg(dup));
  const corta = await P.dueno.u('POST', '/functions/v1/create-user', { email: `zz.c.${sufijo()}@ensayo.invalid`, password: '123', nombre: 'x' });
  ok('contraseña de menos de 6 caracteres se rechaza', corta.s >= 400 && /6 caracteres/.test(msg(corta)), msg(corta));
  const sinAcc = await P.dueno.u('POST', '/functions/v1/create-user', { email: `zz.s.${sufijo()}@ensayo.invalid`, password: 'Clave1234', nombre: 'x', rol: 'disabled' });
  ok('no se puede crear un usuario sin acceso a Directorio ni a Depósito', sinAcc.s >= 400, msg(sinAcc));
  const rolMalo = await P.dueno.u('POST', '/functions/v1/create-user', { email: `zz.r.${sufijo()}@ensayo.invalid`, password: 'Clave1234', nombre: 'x', rol: 'superadmin' });
  ok('un rol inventado se rechaza', rolMalo.s >= 400, msg(rolMalo));
  const antes = await maxAudit();
  const rs = await P.dueno.u('POST', '/functions/v1/reset-password', { userId: nid, password: 'NuevaClave99' });
  ok('el dueño resetea la contraseña de otro', rs.s === 200, msg(rs));
  const viejo = await http('POST', '/auth/v1/token?grant_type=password', { cuerpo: { email: mail, password: 'Clave1234' } });
  const nuevoLg = await http('POST', '/auth/v1/token?grant_type=password', { cuerpo: { email: mail, password: 'NuevaClave99' } });
  ok('después del reseteo entra con la nueva y no con la vieja', viejo.s !== 200 && nuevoLg.s === 200);
  const aud = await ultimaAuditoria(antes, '&descripcion=like.*Contrase*');
  ok('el reseteo queda en el historial, con quién lo hizo y sin la contraseña', aud.length === 1 && aud[0].usuario_email === P.dueno.mail && !JSON.stringify(aud[0]).includes('NuevaClave99'), JSON.stringify(aud));
  const propio = await P.dueno.u('POST', '/functions/v1/reset-password', { userId: P.dueno.id, password: 'Otra123456' });
  ok('nadie resetea su propia contraseña desde acá', propio.s >= 400, msg(propio));
  const rsOk = await P.reseteador.u('POST', '/functions/v1/reset-password', { userId: nid, password: 'Reset123456' });
  ok('quien tiene el permiso "resetear contraseñas" resetea a un usuario común', rsOk.s === 200, msg(rsOk));
  const rsNo = await P.reseteador.u('POST', '/functions/v1/reset-password', { userId: P.dueno.id, password: 'Reset123456' });
  ok('…pero no al dueño', rsNo.s >= 400 && /propietario/.test(msg(rsNo)), msg(rsNo));
  const rsCorta = await P.dueno.u('POST', '/functions/v1/reset-password', { userId: nid, password: '123' });
  ok('contraseña nueva demasiado corta se rechaza', rsCorta.s >= 400, msg(rsCorta));
  const sinPerm = await P.comunDep.u('POST', '/functions/v1/reset-password', { userId: nid, password: 'Reset123456' });
  ok('un usuario sin el permiso no puede resetear', sinPerm.s >= 400, msg(sinPerm));
  // eliminar
  const delDueno = await P.dueno.u('POST', '/functions/v1/delete-user', { userId: duenoB });
  const bAun = (await sv('GET', `/rest/v1/usuarios_perfil?select=id&id=eq.${duenoB}`)).d.length === 1;
  const bAuth = (await http('GET', `/auth/v1/admin/users/${duenoB}`, { token: SERVICIO, apikey: SERVICIO })).s === 200;
  ok('eliminar a otro dueño se rechaza y no toca ni su perfil ni su cuenta (error corregido en la plantilla)', delDueno.s >= 400 && bAun && bAuth, msg(delDueno));
  const delSelf = await P.dueno.u('POST', '/functions/v1/delete-user', { userId: P.dueno.id });
  ok('nadie se elimina a sí mismo', delSelf.s >= 400, msg(delSelf));
  const delNo = await P.adminDir.u('POST', '/functions/v1/delete-user', { userId: nid });
  ok('un administrador que no es dueño no elimina usuarios', delNo.s >= 400, msg(delNo));
  const del = await P.dueno.u('POST', '/functions/v1/delete-user', { userId: nid });
  const quedaP = (await sv('GET', `/rest/v1/usuarios_perfil?select=id&id=eq.${nid}`)).d.length;
  const quedaA = (await http('GET', `/auth/v1/admin/users/${nid}`, { token: SERVICIO, apikey: SERVICIO })).s;
  ok('el dueño elimina a un usuario: se van su perfil y su cuenta', del.s === 200 && quedaP === 0 && quedaA === 404, `${msg(del)} perfil=${quedaP} auth=${quedaA}`);
  const sinTok = await http('POST', '/functions/v1/delete-user', { cuerpo: { userId: nid } });
  ok('sin sesión no se puede llamar a las funciones de usuarios', sinTok.s >= 400);
}

seccion('Historial (auditoría)');
{
  const it = await nuevoItem();
  let a = await maxAudit();
  await P.adminDep.u('PATCH', `/rest/v1/items?id=eq.${it}`, { descripcion: 'ZZ-l cambiada' });
  let f = await ultimaAuditoria(a, `&tabla=eq.items&registro_id=eq.${it}`);
  ok('editar un repuesto queda en el historial con el autor', f.length === 1 && f[0].accion === 'update' && f[0].usuario_email === P.adminDep.mail, JSON.stringify(f.map(x => [x.accion, x.usuario_email])));
  a = await maxAudit();
  const directo = await P.adminDep.u('PATCH', `/rest/v1/items?id=eq.${it}`, { stock: 77 });
  ok('cambiar el stock a mano se rechaza (se hace con un movimiento)', !hecho(directo) && /movimiento/i.test(msg(directo)), msg(directo));
  await fijarStock(it, 77);
  f = await ultimaAuditoria(a, '&tabla=eq.ajustes_inventario');
  ok('cambiar el stock con un movimiento queda en el historial con su comprobante', f.length === 1 && /AJU 0001-\d{8}/.test(f[0].descripcion), JSON.stringify(f.map(x => x.descripcion)));
  a = await maxAudit();
  const r = (await P.comunDep.u('POST', '/rest/v1/retiros', { usuario_id: P.comunDep.id, sector_id: sector })).d[0].id; R('retiros', r);
  const l = (await P.comunDep.u('POST', '/rest/v1/retiro_items', { retiro_id: r, item_id: it, cantidad: 2 })).d[0].id;
  await P.comunDep.u('PATCH', `/rest/v1/retiro_items?id=eq.${l}`, { cantidad: 3 });
  await P.comunDep.u('DELETE', `/rest/v1/retiro_items?id=eq.${l}`);
  f = await ultimaAuditoria(a, '&tabla=eq.retiro_items');
  ok('corregir y borrar una línea de retiro quedan en el historial (el alta no, a propósito)', f.length === 2 && f.map(x => x.accion).join() === 'update,delete', f.map(x => x.accion).join());
  a = await maxAudit();
  const p = await P.adminDir.u('POST', '/rest/v1/proveedores', { nombre: 'ZZ-l prov aud' }); const pid = p.d[0].id; R('proveedores', pid);
  await P.adminDir.u('PATCH', `/rest/v1/proveedores?id=eq.${pid}`, { notas: 'x' });
  const co = await P.adminDir.u('POST', '/rest/v1/contactos', { proveedor_id: pid, nombre: 'ZZ-l' }); await P.adminDir.u('DELETE', `/rest/v1/contactos?id=eq.${co.d[0].id}`);
  const cm = await P.adminDir.u('POST', '/rest/v1/comisionistas', { nombre: 'ZZ-l com' }); R('comisionistas', cm.d[0].id);
  f = await ultimaAuditoria(a);
  const tablas = f.map(x => `${x.tabla}:${x.accion}`);
  ok('proveedores, contactos y comisionistas quedan en el historial', ['proveedores:insert', 'proveedores:update', 'contactos:insert', 'contactos:delete', 'comisionistas:insert'].every(k => tablas.includes(k)), tablas.join(','));
  a = await maxAudit();
  await P.dueno.u('PATCH', `/rest/v1/usuarios_perfil?id=eq.${P.sin.id}`, { puede_ver_errores: true });
  await P.dueno.u('PATCH', `/rest/v1/usuarios_perfil?id=eq.${P.sin.id}`, { puede_ver_errores: false });
  f = await ultimaAuditoria(a, '&tabla=eq.usuarios_perfil');
  ok('los cambios de permisos de un usuario quedan en el historial', f.length === 2 && f.every(x => x.usuario_email === P.dueno.mail), JSON.stringify(f.map(x => x.usuario_email)));
  a = await maxAudit();
  await P.comunDep.u('PATCH', `/rest/v1/usuarios_perfil?id=eq.${P.comunDep.id}`, { nombre: 'ZZ comun ' + sufijo() });
  f = await ultimaAuditoria(a, '&tabla=eq.usuarios_perfil');
  ok('cambiar el propio nombre también se registra', f.length === 1, f.length);
  const noLee = await P.adminDep.u('GET', '/rest/v1/audit_log?select=id&limit=1');
  ok('solo el dueño puede leer el historial', !hecho(noLee) && hecho(await P.dueno.u('GET', '/rest/v1/audit_log?select=id&limit=1')));
  const noEscribe = await P.dueno.u('POST', '/rest/v1/audit_log', { tabla: 'x', registro_id: '1', accion: 'insert' });
  const noBorra = await P.dueno.u('DELETE', '/rest/v1/audit_log?id=gt.0');
  ok('ni el dueño puede escribir ni borrar el historial por la API', !hecho(noEscribe) && !hecho(noBorra), msg(noEscribe) + ' / ' + msg(noBorra));
}

seccion('Módulos: apagar y prender cada uno (sobre los datos reales)');
{
  const lic0 = (await sv('GET', '/rest/v1/licencia?select=modulos&id=eq.1')).d[0].modulos;
  const cual = { proveedores: 'proveedores', comisionistas: 'comisionistas', envios: 'rotulos_generados', deposito: 'items', tareas: 'tasks' };
  const lee = async tabla => { const r = await P.dueno.u('GET', `/rest/v1/${tabla}?select=*&limit=1`); return r.s === 200 && Array.isArray(r.d) && r.d.length > 0; };
  for (const [mod, tabla] of Object.entries(cual)) {
    await sv('PATCH', '/rest/v1/licencia?id=eq.1', { modulos: { ...lic0, [mod]: false } });
    const apagado = await lee(tabla);
    await sv('PATCH', '/rest/v1/licencia?id=eq.1', { modulos: lic0 });
    const prendido = await lee(tabla);
    ok(`apagar "${mod}" bloquea ${tabla} (incluso para el dueño) y prenderlo la devuelve con sus datos`, apagado === false && prendido === true, `apagado=${apagado} prendido=${prendido}`);
  }
  await sv('PATCH', '/rest/v1/licencia?id=eq.1', { modulos: { ...lic0, deposito: false } });
  const rr = await P.dueno.u('POST', '/rest/v1/rpc/historial_retiros_por_item', { p_item_id: (await sv('GET', '/rest/v1/items?select=id&limit=1')).d[0].id });
  const rs = await P.dueno.u('POST', '/rest/v1/rpc/crear_reparacion', { p_proveedor_id: provId, p_motivo: 'x', p_fecha_salida: hoy(), p_envio_id: null, p_items: [] });
  const up = await http('POST', '/storage/v1/object/items/zz-l/modulo.txt', { token: P.dueno.tok, cuerpo: 'zz', crudo: true, cab: { 'Content-Type': 'text/plain' } });
  ok('con Depósito apagado, también se bloquean sus funciones y la carpeta de fotos', (rr.s === 200 && rr.d.length === 0) && rs.s >= 400 && up.s >= 400, `${rr.s} ${rs.s} ${up.s}`);
  await sv('PATCH', '/rest/v1/licencia?id=eq.1', { modulos: lic0 });
  await sv('PATCH', '/rest/v1/licencia?id=eq.1', { modulos: { ...lic0, proveedores: false } });
  const sinProv = await P.dueno.u('POST', '/rest/v1/rpc/crear_reparacion', { p_proveedor_id: provId, p_motivo: 'x', p_fecha_salida: hoy(), p_envio_id: null, p_items: [{ item_id: (await sv('GET', '/rest/v1/items?select=id&limit=1')).d[0].id, cantidad: 1 }] });
  ok('reparaciones necesitan Depósito y Proveedores: sin Proveedores se bloquean', sinProv.s >= 400, msg(sinProv));
  await sv('PATCH', '/rest/v1/licencia?id=eq.1', { modulos: lic0 });
  await sv('PATCH', '/rest/v1/licencia?id=eq.1', { modulos: {} });
  const todoApagado = !(await lee('items')) && !(await lee('proveedores')) && !(await lee('tasks'));
  ok('con la licencia vacía no hay ningún módulo activo', todoApagado);
  await sv('PATCH', '/rest/v1/licencia?id=eq.1', { modulos: lic0 });
  const mismo = JSON.stringify((await sv('GET', '/rest/v1/licencia?select=modulos&id=eq.1')).d[0].modulos) === JSON.stringify(lic0);
  ok('la licencia quedó como estaba', mismo);
  const cliente = await P.dueno.u('PATCH', '/rest/v1/licencia?id=eq.1', { modulos: {} });
  const cliente2 = await P.dueno.u('POST', '/rest/v1/licencia', { id: 2, modulos: {} });
  const cliente3 = await P.dueno.u('DELETE', '/rest/v1/licencia?id=eq.1');
  ok('ni el dueño puede cambiar la licencia de módulos por la API', !hecho(cliente) && !hecho(cliente2) && !hecho(cliente3));
}

seccion('Sin sesión (acceso anónimo)');
{
  const tablas = ['audit_log', 'comisionistas', 'configuracion', 'contactos', 'equipo_items', 'equipos', 'error_logs', 'familias', 'item_proveedores', 'items', 'licencia', 'planilla_familias', 'proveedores', 'reparacion_entregas', 'reparacion_items', 'reparaciones', 'retiro_items', 'retiros', 'rotulo_disenos', 'rotulos_bultos', 'rotulos_fotos', 'rotulos_generados', 'sectores', 'subfamilias', 'sugerencias', 'task_history', 'tasks', 'usuarios_perfil'];
  const visibles = [];
  for (const t of tablas) { const r = await http('GET', `/rest/v1/${t}?select=*&limit=1`); if (hecho(r)) visibles.push(t); }
  ok('sin iniciar sesión solo se puede leer la configuración de la empresa (nombre, logo y colores del login)', visibles.length === 1 && visibles[0] === 'configuracion', 'visibles: ' + visibles.join(', '));
  const esc = [];
  for (const t of tablas) { const r = await http('POST', `/rest/v1/${t}`, { cuerpo: {} }); if (r.s < 300) esc.push(t); }
  ok('sin sesión no se puede escribir en ninguna tabla', esc.length === 0, esc.join(', '));
  const funcs = ['definir_dueno_inicial', 'agregar_dueno', 'quitar_dueno', 'create_task', 'crear_reparacion', 'eliminar_reparacion', 'process_pending_tasks_for_user', 'historial_retiros_por_item', 'exigir_modulo', 'get_user_task_counts'];
  const llamables = [];
  const args = { definir_dueno_inicial: { p_email: 'a@b.c' }, agregar_dueno: { p_id: randomUUID() }, quitar_dueno: { p_id: randomUUID() }, create_task: { p_title: 'x' }, crear_reparacion: { p_proveedor_id: provId, p_motivo: 'x', p_fecha_salida: hoy(), p_envio_id: null, p_items: [] }, eliminar_reparacion: { p_reparacion_id: randomUUID() }, process_pending_tasks_for_user: { target_user_id: randomUUID() }, historial_retiros_por_item: { p_item_id: randomUUID() }, exigir_modulo: { p_modulos: ['deposito'] }, get_user_task_counts: { target_user_id: randomUUID() } };
  for (const f of funcs) { const r = await http('POST', `/rest/v1/rpc/${f}`, { cuerpo: args[f] }); if (r.s !== 401 && r.s !== 403 && r.s !== 404) llamables.push(`${f}(${r.s}: ${msg(r).slice(0, 40)})`); }
  ok('sin sesión no se puede ejecutar ninguna función de la base', llamables.length === 0, llamables.join(' | '));
  const dc = await http('POST', '/rest/v1/rpc/definir_dueno_inicial', { token: P.dueno.tok, cuerpo: { p_email: 'zz.otro@ensayo.invalid' } });
  ok('ni el dueño puede ejecutar "definir dueño inicial" (solo la clave de servicio del vendedor)', dc.s >= 400, msg(dc));
  const a1 = await http('POST', '/storage/v1/object/items/zz-l/anon.txt', { cuerpo: 'zz', crudo: true, cab: { 'Content-Type': 'text/plain' } });
  const a2 = await http('POST', '/storage/v1/object/rotulos/zz-l/anon.txt', { cuerpo: 'zz', crudo: true, cab: { 'Content-Type': 'text/plain' } });
  const a3 = await http('POST', '/storage/v1/object/documentos/zz-l/anon.txt', { cuerpo: 'zz', crudo: true, cab: { 'Content-Type': 'text/plain' } });
  ok('sin sesión no se pueden subir archivos', a1.s >= 400 && a2.s >= 400 && a3.s >= 400, `${a1.s} ${a2.s} ${a3.s}`);
  const fn = await http('POST', '/functions/v1/create-user', { cuerpo: { email: 'a@b.c' } });
  ok('sin sesión no se puede crear usuarios', fn.s >= 400);
  const reg = await http('POST', '/auth/v1/signup', { cuerpo: { email: `zz.reg.${sufijo()}@ensayo.invalid`, password: 'Clave12345' } });
  console.log('  (info) registro público de usuarios: HTTP', reg.s, msg(reg).slice(0, 90));
  if (reg.s === 200 && reg.d?.id) await http('DELETE', `/auth/v1/admin/users/${reg.d.id}`, { token: SERVICIO, apikey: SERVICIO });
  if (reg.s === 200 && reg.d?.user?.id) { await sv('DELETE', `/rest/v1/usuarios_perfil?id=eq.${reg.d.user.id}`); await http('DELETE', `/auth/v1/admin/users/${reg.d.user.id}`, { token: SERVICIO, apikey: SERVICIO }); }
}

seccion('Usuarios bloqueados y zona horaria');
{
  const lee = async t => { const r = await P.comunDep.u('GET', `/rest/v1/${t}?select=*&limit=1`); return hecho(r); };
  ok('un usuario activo del Depósito lee repuestos y proveedores', await lee('items') && await lee('proveedores'));
  await sv('PATCH', `/rest/v1/usuarios_perfil?id=eq.${P.comunDep.id}`, { activo: false });
  const bloq = [];
  for (const t of ['items', 'proveedores', 'contactos', 'sectores', 'familias', 'retiros', 'comisionistas']) if (await lee(t)) bloq.push(t);
  ok('un usuario BLOQUEADO con la sesión abierta no lee nada de la base', bloq.length === 0, 'lee: ' + bloq.join(', '));
  const perf = await P.comunDep.u('GET', '/rest/v1/usuarios_perfil?select=email');
  ok('…solo ve su propio perfil (para que la pantalla le avise)', Array.isArray(perf.d) && perf.d.length === 1, JSON.stringify(perf.d).slice(0, 80));
  const mov = await P.comunDep.u('POST', '/rest/v1/retiros', { usuario_id: P.comunDep.id, sector_id: sector });
  const tarea = await P.comunDep.u('POST', '/rest/v1/rpc/create_task', { p_title: 'No debería', p_description: '', p_traffic_level: 'green' });
  const cont = await P.comunDep.u('POST', '/rest/v1/rpc/get_user_task_counts', { target_user_id: P.comunDep.id });
  const hist = await P.comunDep.u('POST', '/rest/v1/rpc/historial_retiros_por_item', { p_item_id: randomUUID() });
  ok('…no registra retiros ni crea tareas ni consulta contadores ni historial', !hecho(mov) && tarea.s >= 400 && Number(cont.d?.[0]?.total ?? 0) === 0 && (hist.s !== 200 || hist.d.length === 0));
  const subida = await http('POST', '/storage/v1/object/items/zz-l/bloqueado.txt', { token: P.comunDep.tok, cuerpo: 'x', crudo: true, cab: { 'Content-Type': 'text/plain' } });
  ok('…ni sube archivos', subida.s >= 400, subida.s);
  const funcBloq = await P.comunDep.u('POST', '/functions/v1/reset-password', { userId: randomUUID(), password: 'Clave123456' });
  ok('…ni usa las funciones del servidor', funcBloq.s >= 400);
  await sv('PATCH', `/rest/v1/usuarios_perfil?id=eq.${P.comunDep.id}`, { activo: true });
  ok('al desbloquearlo vuelve a leer, con la misma sesión', await lee('items') && await lee('proveedores'));

  // eliminar usuarios: alcanza con ser dueño (aunque el rol del Directorio sea "usuario")
  await sv('PATCH', `/rest/v1/usuarios_perfil?id=eq.${P.dueno.id}`, { rol: 'user' });
  const mail = `zz.borrar.${sufijo()}@ensayo.invalid`;
  const nuevo = await P.dueno.u('POST', '/functions/v1/create-user', { email: mail, password: 'Clave1234', nombre: 'ZZ Borrar' });
  const del = await P.dueno.u('POST', '/functions/v1/delete-user', { userId: nuevo.d?.id });
  ok('un dueño con rol "usuario" en el Directorio puede crear y eliminar usuarios', nuevo.s === 200 && del.s === 200, msg(del));
  await sv('PATCH', `/rest/v1/usuarios_perfil?id=eq.${P.dueno.id}`, { rol: 'admin' });

  // zona horaria: "hoy" de la base = día de la empresa (aunque en hora universal ya sea otro día)
  const zona = (await sv('GET', '/rest/v1/configuracion?select=zona_horaria&id=eq.1')).d[0].zona_horaria;
  const hoyBase = (await sv('POST', '/rest/v1/rpc/hoy_local', {})).d;
  ok('"hoy" de la base es el día de la zona de la empresa (' + zona + ')', hoyBase === new Date().toLocaleDateString('sv-SE', { timeZone: zona }), hoyBase);
  const crear = await P.sin.u('POST', '/rest/v1/rpc/create_task', { p_title: 'ZZ-l hoy local', p_description: '', p_traffic_level: 'green', p_assigned_date: hoyBase });
  ok('se puede crear una tarea con la fecha de hoy de la empresa', crear.s === 200, msg(crear));
  if (crear.s === 200) R('tasks', crear.d);
  const mala = await sv('PATCH', '/rest/v1/configuracion?id=eq.1', { zona_horaria: 'Marte/Olimpo' });
  ok('una zona horaria inventada se rechaza', !hecho(mala));
}

// ---------- limpieza ----------
const orden = ['retiro_items', 'retiros', 'reparacion_entregas', 'reparacion_items', 'reparaciones', 'items', 'subfamilias', 'familias', 'proveedores', 'comisionistas', 'sectores', 'tasks'];
for (const tb of orden) { const m = rastro.filter(r => r[0] === tb).map(r => r[1]).filter(Boolean); for (let i = 0; i < m.length; i += 40) await sv('DELETE', `/rest/v1/${tb}?id=in.(${m.slice(i, i + 40).join(',')})`); }
// lo que crean las funciones (reparaciones, retiros) no está en "rastro": se borra por lo que apunta a los repuestos de prueba
try { await q(null, `delete from public.reparacion_entregas where reparacion_item_id in (select ri.id from public.reparacion_items ri join public.items i on i.id = ri.item_id where i.descripcion like 'ZZ-l%'); delete from public.reparacion_items where item_id in (select id from public.items where descripcion like 'ZZ-l%'); delete from public.reparaciones r where not exists (select 1 from public.reparacion_items ri where ri.reparacion_id = r.id) and r.motivo like 'ZZ-%'; delete from public.retiro_items where item_id in (select id from public.items where descripcion like 'ZZ-l%'); select 1 as ok`); } catch { /* en un cliente sin Mantenimiento esas tablas no existen */ }
await sv('DELETE', `/rest/v1/items?descripcion=like.ZZ-l*`); await sv('DELETE', `/rest/v1/subfamilias?nombre=like.ZZ-l*`); await sv('DELETE', `/rest/v1/familias?nombre=like.ZZ-l*`); await sv('DELETE', `/rest/v1/proveedores?nombre=like.ZZ-l*`);
await sv('DELETE', '/rest/v1/comisionistas?nombre=like.ZZ-l*');

const malos = res.filter(r => !r.ok);
console.log(`\nLógica: ${res.length - malos.length} de ${res.length} comprobaciones correctas, ${malos.length} diferencias.`);
for (const m of malos) console.log(`  ✗ [${m.area}] ${m.nombre}\n      ${m.detalle}`);

await terminar(malos.length ? 1 : 0);
