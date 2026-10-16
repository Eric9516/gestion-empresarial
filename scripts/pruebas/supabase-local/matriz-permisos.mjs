// Prueba exhaustiva de permisos (contra el Supabase local): cada configuración posible de usuario contra cada tabla, función y carpeta de archivos.
// Un mismo usuario de prueba cambia de perfil entre combinaciones (los permisos se leen del perfil, no del token).
import { terminar, q, http, sv, msg, hecho, crearUsuario, entrar, hoy, randomUUID, SERVICIO, SIN_MANT, limpiarRestos } from './ayudas-local.mjs';
// Un cliente Plan 1 (sin el componente Mantenimiento) no tiene estas tablas: las comprobaciones que las tocan tienen que dar "no" (el módulo no existe).
const TABLAS_MANT = new Set(['equipos', 'equipo_items']);

const TRABAJADORES = Number(process.env.TRABAJADORES ?? 8);
const SOLO = process.env.SOLO ? process.env.SOLO.split(',') : null; // filtrar por etiqueta
const LIMITE = Number(process.env.LIMITE ?? 0); // para pruebas rápidas
// CRUZAR_MODULOS=1: además de la matriz normal (plan completo), corre un subconjunto representativo de usuarios contra 16 estados de licencia
// (Plan 1, Plan 2, cada módulo apagado por la licencia, cada módulo apagado por el dueño, solo Tareas, ninguno). Sirve para probar
// "todos los planes × todos los tipos de usuario": una operación solo se permite si el usuario tiene el permiso Y los módulos que toca están activos.
// SOLO_CRUZAR=1 salta la matriz normal.
const CRUZAR = process.env.CRUZAR_MODULOS === '1';
const SOLO_CRUZAR = process.env.SOLO_CRUZAR === '1';

// ---------- datos de prueba compartidos ----------
const rastro = []; // [tabla, id] a limpiar al final
const rastrear = (t, id) => { if (id) rastro.push([t, id]); return id; };
const crear = async (tabla, cuerpo) => {
  const r = await sv('POST', `/rest/v1/${tabla}`, cuerpo);
  if (!hecho(r)) throw new Error(`No pude sembrar ${tabla}: ${r.s} ${msg(r)} ${JSON.stringify(cuerpo).slice(0, 200)}`);
  return rastrear(tabla, r.d[0].id ?? r.d[0].equipo_id);
};

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const sufijo = () => Math.random().toString(36).slice(2, 8);

console.log('Preparando usuarios y datos de prueba…');
await limpiarRestos(); // restos de una corrida anterior interrumpida
const otroId = await crearUsuario('zz.otro@ensayo.invalid', { mantenimiento_rol: 'comun' });
const objetivoId = await crearUsuario('zz.objetivo@ensayo.invalid');
const duenoBId = await crearUsuario('zz.duenob@ensayo.invalid', { es_owner: true, rol: 'admin' });
// cada trabajador tiene su propio "dueño al que se le quita el cargo" (si lo compartieran, una comprobación le sacaría el cargo mientras otra lo usa)
const duenosQuitar = [];
for (let i = 0; i < TRABAJADORES; i++) duenosQuitar.push(await crearUsuario(`zz.duenoq${i}@ensayo.invalid`, { es_owner: true, rol: 'admin' }));
const ids = [], toks = [], mails = [];
for (let i = 0; i < TRABAJADORES; i++) {
  const mail = `zz.t${i}@ensayo.invalid`;
  mails.push(mail); ids.push(await crearUsuario(mail)); toks.push(await entrar(mail));
}
// perfil base de los trabajadores (la combinación lo cambia)


const config0 = (await sv('GET', '/rest/v1/configuracion?select=*&id=eq.1')).d[0];
const diseno0 = (await sv('GET', '/rest/v1/rotulo_disenos?select=id,nombre&limit=1')).d[0];
const planilla0 = (await sv('GET', '/rest/v1/planilla_familias?select=nombre_archivo&limit=1')).d[0];
const proveedorBase = (await sv('GET', '/rest/v1/proveedores?select=id&limit=1')).d[0];

// sembrados compartidos
await crear('sugerencias', { usuario_id: otroId, mensaje: 'ZZ-m sugerencia' });
await crear('error_logs', { usuario_id: otroId, mensaje: 'ZZ-m error' });
await crear('sectores', { nombre: 'ZZ-m sector común ' + sufijo() });
const tareaOtro = (await sv('POST', '/rest/v1/tasks', { user_id: otroId, title: 'ZZ-m tarea ajena', status: 'pending', traffic_level: 'green', start_date: hoy(), assigned_date: hoy(), pending_days: 0, carry_count: 0, is_stagnant: false })).d[0].id;
rastrear('tasks', tareaOtro);
await sv('POST', '/rest/v1/task_history', { task_id: tareaOtro, user_id: otroId, action: 'created', note: 'ZZ-m' });

// fixtures por trabajador
const F = [];
for (let w = 0; w < TRABAJADORES; w++) {
  const f = {};
  f.prov = await crear('proveedores', { nombre: `ZZ-m prov ${w} ${sufijo()}` });
  f.com = await crear('comisionistas', { nombre: `ZZ-m com ${w}` });
  f.cto = await crear('contactos', { proveedor_id: f.prov, nombre: 'ZZ-m contacto' });
  f.fam = await crear('familias', { codigo: 'Z' + LETRAS[w], nombre: 'ZZ-m familia' + w });
  f.sub = await crear('subfamilias', { familia_id: f.fam, codigo: 'Z' + LETRAS[w], nombre: 'ZZ-m sub' });
  f.sec = await crear('sectores', { nombre: `ZZ-m sec ${w} ${sufijo()}` });
  // el repuesto de prueba se siembra con su stock por SQL (en la aplicación el stock solo cambia con movimientos)
  f.item = rastrear('items', (await q(null, `select set_config('app.mover_stock', 'on', true); insert into public.items (codigo, numero, descripcion, familia_id, subfamilia_id, stock, stock_minimo, punto_pedido) values ('ZZM${w}${sufijo()}', '1', 'ZZ-m repuesto', '${f.fam}', '${f.sub}', 1000, 0, 0) returning id`))[0].id);
  f.rot = await crear('rotulos_generados', { proveedor_id: f.prov, grupo_id: randomUUID(), numero_documento: 'ZZ-m', creado_por: otroId });
  f.bulto = await crear('rotulos_bultos', { rotulo_id: f.rot, numero: 1 });
  f.foto = await crear('rotulos_fotos', { grupo_id: randomUUID(), proveedor_id: f.prov, storage_path: 'zz-m/' + w + '.png' });
  if (SIN_MANT) f.equ = randomUUID();
  else { f.equ = await crear('equipos', { sector: 'ZZ', nombre: 'ZZ-m equipo' }); await sv('POST', '/rest/v1/equipo_items', { equipo_id: f.equ, item_id: f.item }); }
  f.itemprov = await crear('item_proveedores', { item_id: f.item, proveedor_id: f.prov });
  // retiro ajeno con una línea (para historial y para probar "ver retiros de todos")
  f.retOtro = await crear('retiros', { usuario_id: otroId, sector_id: f.sec, observacion_general: 'ZZ-m' });
  f.retOtroItem = await crear('retiro_items', { retiro_id: f.retOtro, item_id: f.item, cantidad: 1 });
  // retiros propios del trabajador (los usa la combinación)
  f.retPropio = await crear('retiros', { usuario_id: ids[w], sector_id: f.sec, observacion_general: 'ZZ-m propio' });
  f.retViejo = await crear('retiros', { usuario_id: ids[w], sector_id: f.sec, observacion_general: 'ZZ-m viejo' });
  await sv('PATCH', `/rest/v1/retiros?id=eq.${f.retViejo}`, { created_at: new Date(Date.now() - 30 * 3600e3).toISOString() });
  f.tarea = (await sv('POST', '/rest/v1/tasks', { user_id: ids[w], title: 'ZZ-m tarea propia', status: 'pending', traffic_level: 'green', start_date: hoy(), assigned_date: hoy(), pending_days: 0, carry_count: 0, is_stagnant: false })).d[0].id;
  rastrear('tasks', f.tarea);
  // una reparación con una línea y una entrega, para leer y para eliminar/restaurar
  { // las reparaciones son del Depósito: existen aunque el cliente no tenga Mantenimiento
    const rr = await sv('POST', '/rest/v1/reparaciones', { proveedor_id: f.prov, motivo: 'ZZ-m', fecha_salida: hoy(), responsable_id: otroId });
    f.rep = rastrear('reparaciones', rr.d[0].id);
    const ri = await sv('POST', '/rest/v1/reparacion_items', { reparacion_id: f.rep, item_id: f.item, cantidad: 2, descuenta_stock: true });
    f.repItem = rastrear('reparacion_items', ri.d[0].id);
    const re = await sv('POST', '/rest/v1/reparacion_entregas', { reparacion_item_id: f.repItem, cantidad_devuelta: 1, resultado: 'reparado', fecha_entrega: hoy(), registrado_por: otroId, repone_stock: false });
    f.repEntrega = rastrear('reparacion_entregas', re.d[0].id);
  }
  F.push(f);
}

// ---------- combinaciones de usuario ----------
const combos = [];
for (const rol of ['user', 'admin', 'disabled']) for (const mant of [null, 'comun', 'admin']) {
  if (rol === 'disabled' && mant === null) continue; // la base no lo permite
  for (let m = 0; m < 16; m++) for (const activo of [true, false]) {
    combos.push({ rol, mant, es_owner: false, activo, ver_retiros: !!(m & 1), ver_errores: !!(m & 2), resetear: !!(m & 4), ver_sug: !!(m & 8) });
  }
  for (const todo of [false, true]) combos.push({ rol, mant, es_owner: true, activo: true, ver_retiros: todo, ver_errores: todo, resetear: todo, ver_sug: todo });
}
const desc = c => `${c.es_owner ? 'DUEÑO ' : ''}dir=${c.rol} dep=${c.mant ?? 'sin'} ${c.activo ? '' : 'BLOQUEADO '}${[c.ver_retiros && 'retiros', c.ver_errores && 'errores', c.resetear && 'resetear', c.ver_sug && 'sugerencias'].filter(Boolean).join('+')}`.trim();

// ---------- lo que DEBE poder hacer cada combinación (según las reglas de la base) ----------
const P = c => {
  const own = c.es_owner;
  const dir = own || c.rol === 'admin', mantAdm = own || c.mant === 'admin';
  return {
    own, dir, mantAdm, mantAcc: c.mant !== null || mantAdm,
    verRet: own || c.ver_retiros, verErr: own || c.ver_errores, verSug: own || c.ver_sug,
    reset: own || c.resetear, rolAdmin: c.rol === 'admin', tareasAdm: c.rol === 'admin' || own,
    tareasOk: c.activo, // access_status: 'active' si está activo, 'blocked' si no
  };
};

const PERMITE_BLOQUEADO = new Set(['leer configuracion', 'leer licencia', 'leer usuarios_perfil']);
// ---------- las comprobaciones ----------
const T = [];
const t = (area, etiqueta, esperado, correr) => T.push({ area, etiqueta, esperado, correr });
const SIEMPRE = () => true, NUNCA = () => false;

// lecturas
const lee = (tabla, esperado, filtro = '') => t('lectura', `leer ${tabla}`, esperado, async x => hecho(await x.u('GET', `/rest/v1/${tabla}?select=*&limit=3${filtro}`)));
for (const tb of ['comisionistas', 'contactos', 'configuracion', 'familias', 'subfamilias', 'sectores', 'items', 'proveedores', 'rotulo_disenos', 'rotulos_generados', 'rotulos_bultos', 'rotulos_fotos', 'planilla_familias', 'licencia', 'usuarios_perfil', 'equipos', 'equipo_items']) lee(tb, SIEMPRE);
for (const tb of ['item_proveedores', 'reparaciones', 'reparacion_items', 'reparacion_entregas']) lee(tb, p => p.mantAdm);
lee('audit_log', p => p.own);
lee('error_logs', p => p.verErr);
lee('sugerencias', p => p.verSug);
t('lectura', 'leer retiros ajenos', p => p.verRet, async x => hecho(await x.u('GET', `/rest/v1/retiros?select=id&id=eq.${x.f.retOtro}`)));
t('lectura', 'leer líneas de retiros ajenos', p => p.verRet, async x => hecho(await x.u('GET', `/rest/v1/retiro_items?select=id&id=eq.${x.f.retOtroItem}`)));
t('lectura', 'leer retiros propios', SIEMPRE, async x => hecho(await x.u('GET', `/rest/v1/retiros?select=id&id=eq.${x.f.retPropio}`)));
t('lectura', 'leer tareas propias', p => p.tareasOk || p.tareasAdm, async x => hecho(await x.u('GET', `/rest/v1/tasks?select=id&id=eq.${x.f.tarea}`)));
t('lectura', 'leer tareas ajenas', p => p.tareasAdm, async x => hecho(await x.u('GET', `/rest/v1/tasks?select=id&id=eq.${tareaOtro}`)));
t('lectura', 'leer historial de tareas ajeno', p => p.tareasAdm, async x => hecho(await x.u('GET', `/rest/v1/task_history?select=id&limit=1&user_id=eq.${otroId}`)));

// directorio
const ins = (tabla, cuerpo) => async x => { const r = await x.u('POST', `/rest/v1/${tabla}`, cuerpo(x)); if (hecho(r)) await sv('DELETE', `/rest/v1/${tabla}?id=eq.${r.d[0].id}`); return hecho(r); };
// Sin pedir la fila de vuelta (como hace la app): quien puede insertar no siempre puede leer.
const insMin = (tabla, cuerpo) => async x => { const c = cuerpo(x); const r = await x.u('POST', `/rest/v1/${tabla}`, c, { Prefer: 'return=minimal' }); const ok = r.s >= 200 && r.s < 300; if (ok) await sv('DELETE', `/rest/v1/${tabla}?mensaje=eq.${encodeURIComponent(c.mensaje)}&usuario_id=eq.${c.usuario_id}`); return ok; };
const upd = (tabla, idf, cuerpo) => async x => hecho(await x.u('PATCH', `/rest/v1/${tabla}?id=eq.${idf(x)}`, cuerpo(x)));
const del = (tabla, fab) => async x => { const id = await fab(x); const r = await x.u('DELETE', `/rest/v1/${tabla}?id=eq.${id}`); if (!hecho(r)) await sv('DELETE', `/rest/v1/${tabla}?id=eq.${id}`); else quitarRastro(tabla, id); return hecho(r); };
const quitarRastro = (tb, id) => { const i = rastro.findIndex(r => r[0] === tb && r[1] === id); if (i >= 0) rastro.splice(i, 1); };
const mk = (tabla, cuerpo) => async x => (SIN_MANT && TABLAS_MANT.has(tabla)) ? randomUUID() : rastrear(tabla, (await sv('POST', `/rest/v1/${tabla}`, cuerpo(x))).d[0].id);

t('directorio', 'crear proveedor', p => p.dir, ins('proveedores', () => ({ nombre: 'ZZ-m nuevo ' + sufijo() })));
t('directorio', 'editar proveedor', p => p.dir, upd('proveedores', x => x.f.prov, () => ({ notas: 'ZZ' })));
t('directorio', 'eliminar proveedor', p => p.own, del('proveedores', mk('proveedores', () => ({ nombre: 'ZZ-m borrar ' + sufijo() }))));
t('directorio', 'crear contacto', p => p.dir, ins('contactos', x => ({ proveedor_id: x.f.prov, nombre: 'ZZ-m' })));
t('directorio', 'editar contacto', p => p.dir, upd('contactos', x => x.f.cto, () => ({ cargo: 'ZZ' })));
t('directorio', 'eliminar contacto', p => p.dir, del('contactos', mk('contactos', x => ({ proveedor_id: x.f.prov, nombre: 'ZZ-m borrar' }))));
t('directorio', 'crear comisionista', p => p.dir, ins('comisionistas', () => ({ nombre: 'ZZ-m nuevo ' + sufijo() })));
t('directorio', 'editar comisionista', p => p.dir, upd('comisionistas', x => x.f.com, () => ({ zona: 'ZZ' })));
t('directorio', 'eliminar comisionista', p => p.dir, del('comisionistas', mk('comisionistas', () => ({ nombre: 'ZZ-m borrar' }))));
t('directorio', 'editar datos de la empresa', p => p.dir, async x => hecho(await x.u('PATCH', '/rest/v1/configuracion?id=eq.1', { empresa_telefono: config0.empresa_telefono })));
t('directorio', 'crear diseño de rótulo', p => p.dir, ins('rotulo_disenos', () => ({ nombre: 'ZZ-m diseño', design: {} })));
t('directorio', 'editar diseño de rótulo', p => p.dir, async x => hecho(await x.u('PATCH', `/rest/v1/rotulo_disenos?id=eq.${diseno0.id}`, { nombre: diseno0.nombre })));
t('directorio', 'crear envío (rótulo)', SIEMPRE, ins('rotulos_generados', x => ({ proveedor_id: x.f.prov, grupo_id: randomUUID(), creado_por: x.me })));
t('directorio', 'editar envío', p => p.dir, upd('rotulos_generados', x => x.f.rot, () => ({ comentario: 'ZZ' })));
t('directorio', 'eliminar envío', p => p.own, del('rotulos_generados', mk('rotulos_generados', x => ({ proveedor_id: x.f.prov, grupo_id: randomUUID() }))));
t('directorio', 'agregar bulto a un envío', SIEMPRE, ins('rotulos_bultos', x => ({ rotulo_id: x.f.rot, numero: 9 })));
t('directorio', 'borrar bulto de un envío', NUNCA, async x => hecho(await x.u('DELETE', `/rest/v1/rotulos_bultos?id=eq.${x.f.bulto}`)));
t('directorio', 'agregar foto a un envío', SIEMPRE, ins('rotulos_fotos', x => ({ grupo_id: randomUUID(), proveedor_id: x.f.prov, storage_path: 'zz-m/n.png', creado_por: x.me })));
t('directorio', 'borrar foto de un envío', SIEMPRE, del('rotulos_fotos', mk('rotulos_fotos', x => ({ grupo_id: randomUUID(), proveedor_id: x.f.prov, storage_path: 'zz-m/b.png' }))));

// depósito
t('deposito', 'crear familia', p => p.mantAdm, ins('familias', x => ({ codigo: 'Y' + LETRAS[x.w], nombre: 'ZZ-m' })));
t('deposito', 'editar familia', p => p.own, upd('familias', x => x.f.fam, () => ({ nombre: 'ZZ-m ed' })));
t('deposito', 'eliminar familia', p => p.own, del('familias', mk('familias', x => ({ codigo: 'X' + LETRAS[x.w], nombre: 'ZZ-m borrar' }))));
t('deposito', 'crear subfamilia', p => p.mantAdm, ins('subfamilias', x => ({ familia_id: x.f.fam, codigo: 'Y' + LETRAS[x.w], nombre: 'ZZ-m' })));
t('deposito', 'editar subfamilia', p => p.own, upd('subfamilias', x => x.f.sub, () => ({ nombre: 'ZZ-m ed' })));
t('deposito', 'eliminar subfamilia', p => p.own, del('subfamilias', mk('subfamilias', x => ({ familia_id: x.f.fam, codigo: 'X' + LETRAS[x.w], nombre: 'ZZ-m borrar' }))));
t('deposito', 'actualizar planilla de familias', p => p.mantAdm, async x => hecho(await x.u('PATCH', '/rest/v1/planilla_familias?id=eq.true', { nombre_archivo: planilla0.nombre_archivo })));
t('deposito', 'crear sector', p => p.mantAdm, ins('sectores', () => ({ nombre: 'ZZ-m sector ' + sufijo() })));
t('deposito', 'editar sector', p => p.mantAdm, upd('sectores', x => x.f.sec, () => ({ activo: true })));
t('deposito', 'eliminar sector', p => p.mantAdm, del('sectores', mk('sectores', () => ({ nombre: 'ZZ-m borrar ' + sufijo() }))));
t('deposito', 'crear repuesto', p => p.mantAdm, ins('items', x => ({ codigo: `ZZN${x.w}${sufijo()}`, numero: '1', descripcion: 'ZZ-m', familia_id: x.f.fam, subfamilia_id: x.f.sub })));
t('deposito', 'editar repuesto: descripción', p => p.mantAdm, upd('items', x => x.f.item, () => ({ descripcion: 'ZZ-m repuesto ' + randomUUID() })));
t('deposito', 'editar repuesto: stock directo (ya no lo puede cambiar nadie)', () => false, upd('items', x => x.f.item, () => ({ stock: 300 + Math.random() * 600 })));
t('deposito', 'editar repuesto: stock mínimo', p => p.mantAcc, upd('items', x => x.f.item, () => ({ stock_minimo: 0 })));
t('deposito', 'eliminar repuesto', p => p.own, del('items', mk('items', x => ({ codigo: `ZZD${x.w}${sufijo()}`, numero: '1', descripcion: 'ZZ-m borrar', familia_id: x.f.fam, subfamilia_id: x.f.sub }))));
t('deposito', 'vincular proveedor a repuesto', p => p.mantAdm, ins('item_proveedores', x => ({ item_id: x.f.item, proveedor_id: proveedorBase.id })));
t('deposito', 'desvincular proveedor de repuesto', p => p.mantAdm, del('item_proveedores', mk('item_proveedores', x => ({ item_id: x.f.item, proveedor_id: proveedorBase.id }))));
t('deposito', 'crear equipo', p => p.mantAdm, ins('equipos', () => ({ sector: 'ZZ', nombre: 'ZZ-m nuevo' })));
t('deposito', 'editar equipo', p => p.mantAdm, upd('equipos', x => x.f.equ, () => ({ datos_tecnicos: 'ZZ' })));
t('deposito', 'eliminar equipo', p => p.mantAdm, del('equipos', mk('equipos', () => ({ sector: 'ZZ', nombre: 'ZZ-m borrar' }))));
t('deposito', 'historial de retiros de un repuesto', p => p.mantAcc, async x => { const r = await x.u('POST', '/rest/v1/rpc/historial_retiros_por_item', { p_item_id: x.f.item }); return r.s === 200 && Array.isArray(r.d) && r.d.length > 0; });

// reparaciones
t('reparaciones', 'crear reparación (función)', p => p.mantAdm, async x => { const r = await x.u('POST', '/rest/v1/rpc/crear_reparacion', { p_proveedor_id: x.f.prov, p_motivo: 'ZZ-m', p_fecha_salida: hoy(), p_envio_id: null, p_items: [{ item_id: x.f.item, cantidad: 1, descuenta_stock: false }] }); if (r.s === 200 && typeof r.d === 'string') await sv('DELETE', `/rest/v1/reparaciones?id=eq.${r.d}`); return r.s === 200; });
t('reparaciones', 'eliminar reparación (a la papelera)', p => p.mantAdm, async x => (await x.u('POST', '/rest/v1/rpc/eliminar_reparacion', { p_reparacion_id: x.f.rep })).s < 300);
t('reparaciones', 'restaurar reparación', p => p.mantAdm, async x => (await x.u('POST', '/rest/v1/rpc/restaurar_reparacion', { p_reparacion_id: x.f.rep })).s < 300);
t('reparaciones', 'borrar reparación definitivamente', p => p.own, del('reparaciones', mk('reparaciones', x => ({ proveedor_id: x.f.prov, motivo: 'ZZ-m borrar', fecha_salida: hoy(), responsable_id: otroId }))));
t('reparaciones', 'registrar entrega', p => p.mantAdm, ins('reparacion_entregas', x => ({ reparacion_item_id: x.f.repItem, cantidad_devuelta: 0.01, resultado: 'baja', fecha_entrega: hoy(), registrado_por: x.me, repone_stock: false })));

// retiros
t('retiros', 'crear retiro propio', SIEMPRE, ins('retiros', x => ({ usuario_id: x.me, sector_id: x.f.sec })));
t('retiros', 'crear retiro a nombre de otro', NUNCA, ins('retiros', x => ({ usuario_id: otroId, sector_id: x.f.sec })));
t('retiros', 'agregar línea a retiro propio', SIEMPRE, ins('retiro_items', x => ({ retiro_id: x.f.retPropio, item_id: x.f.item, cantidad: 1 })));
t('retiros', 'agregar línea a retiro ajeno', NUNCA, ins('retiro_items', x => ({ retiro_id: x.f.retOtro, item_id: x.f.item, cantidad: 1 })));
t('retiros', 'editar retiro propio (menos de 24 h)', SIEMPRE, upd('retiros', x => x.f.retPropio, () => ({ observacion_general: 'ZZ' })));
t('retiros', 'editar retiro propio (más de 24 h)', p => p.verRet, upd('retiros', x => x.f.retViejo, () => ({ observacion_general: 'ZZ' })));
t('retiros', 'editar retiro ajeno', p => p.verRet, upd('retiros', x => x.f.retOtro, () => ({ observacion_general: 'ZZ' })));
t('retiros', 'borrar retiro propio (menos de 24 h)', SIEMPRE, del('retiros', mk('retiros', x => ({ usuario_id: x.me, sector_id: x.f.sec }))));
t('retiros', 'borrar retiro propio (más de 24 h)', p => p.verRet, del('retiros', async x => { const id = await mk('retiros', () => ({ usuario_id: x.me, sector_id: x.f.sec }))(x); await sv('PATCH', `/rest/v1/retiros?id=eq.${id}`, { created_at: new Date(Date.now() - 30 * 3600e3).toISOString() }); return id; }));
t('retiros', 'borrar retiro ajeno', p => p.verRet, del('retiros', mk('retiros', x => ({ usuario_id: otroId, sector_id: x.f.sec }))));

// soporte
t('soporte', 'registrar error propio', SIEMPRE, insMin('error_logs', x => ({ usuario_id: x.me, mensaje: 'ZZ-m' })));
t('soporte', 'registrar error a nombre de otro', NUNCA, insMin('error_logs', () => ({ usuario_id: otroId, mensaje: 'ZZ-m' })));
t('soporte', 'borrar error', p => p.verErr, del('error_logs', mk('error_logs', () => ({ usuario_id: otroId, mensaje: 'ZZ-m borrar' }))));
t('soporte', 'enviar sugerencia propia', SIEMPRE, insMin('sugerencias', x => ({ usuario_id: x.me, mensaje: 'ZZ-m' })));
t('soporte', 'enviar sugerencia a nombre de otro', NUNCA, insMin('sugerencias', () => ({ usuario_id: otroId, mensaje: 'ZZ-m' })));
t('soporte', 'borrar sugerencia', p => p.verSug, del('sugerencias', mk('sugerencias', () => ({ usuario_id: otroId, mensaje: 'ZZ-m borrar' }))));

// usuarios
t('usuarios', 'cambiar mi propio nombre', SIEMPRE, async x => hecho(await x.u('PATCH', `/rest/v1/usuarios_perfil?id=eq.${x.me}`, { nombre: 'ZZ nombre ' + sufijo() })));
t('usuarios', 'cambiarme el rol de Directorio', p => p.own, async x => hecho(await x.u('PATCH', `/rest/v1/usuarios_perfil?id=eq.${x.me}`, { rol: x.c.rol === 'admin' ? 'user' : 'admin' })));
t('usuarios', 'cambiarme el rol de Depósito', p => p.own, async x => hecho(await x.u('PATCH', `/rest/v1/usuarios_perfil?id=eq.${x.me}`, { mantenimiento_rol: x.c.mant === 'admin' ? 'comun' : 'admin' })));
t('usuarios', 'darme un permiso suelto', p => p.own, async x => hecho(await x.u('PATCH', `/rest/v1/usuarios_perfil?id=eq.${x.me}`, { puede_ver_errores: !x.c.ver_errores })));
t('usuarios', 'hacerme dueño', p => p.own, async x => hecho(await x.u('PATCH', `/rest/v1/usuarios_perfil?id=eq.${x.me}`, { es_owner: true })));
t('usuarios', 'desbloquearme / bloquearme', p => p.own, async x => hecho(await x.u('PATCH', `/rest/v1/usuarios_perfil?id=eq.${x.me}`, { activo: x.c.es_owner ? true : !x.c.activo })));
t('usuarios', 'cambiar el nombre de otro usuario', p => p.own, async x => hecho(await x.u('PATCH', `/rest/v1/usuarios_perfil?id=eq.${objetivoId}`, { nombre: 'ZZ objetivo' })));
t('usuarios', 'darle un rol a otro usuario', p => p.own, async x => hecho(await x.u('PATCH', `/rest/v1/usuarios_perfil?id=eq.${objetivoId}`, { puede_ver_sugerencias: false })));
t('usuarios', 'agregar a otro dueño', p => p.own, async x => { const r = await x.u('POST', '/rest/v1/rpc/agregar_dueno', { p_id: objetivoId }); if (r.s < 300) await sv('PATCH', `/rest/v1/usuarios_perfil?id=eq.${objetivoId}`, { es_owner: false }); return r.s < 300; });
t('usuarios', 'quitar el cargo a otro dueño', p => p.own, async x => (await x.u('POST', '/rest/v1/rpc/quitar_dueno', { p_id: duenosQuitar[x.w] })).s < 300 && !!(await sv('PATCH', `/rest/v1/usuarios_perfil?id=eq.${duenosQuitar[x.w]}`, { es_owner: true })));

// tareas
t('tareas', 'crear tarea', p => p.tareasOk, async x => { const r = await x.u('POST', '/rest/v1/rpc/create_task', { p_title: 'ZZ-m', p_description: '', p_traffic_level: 'green' }); if (r.s === 200 && typeof r.d === 'string') await sv('DELETE', `/rest/v1/tasks?id=eq.${r.d}`); return r.s === 200; });
t('tareas', 'editar tarea propia', p => p.tareasOk, async x => (await x.u('POST', '/rest/v1/rpc/update_task', { p_task_id: x.f.tarea, p_title: 'ZZ-m', p_description: '', p_traffic_level: 'green' })).s < 300);
t('tareas', 'editar tarea ajena', NUNCA, async x => (await x.u('POST', '/rest/v1/rpc/update_task', { p_task_id: tareaOtro, p_title: 'ZZ-m', p_description: '', p_traffic_level: 'green' })).s < 300);
t('tareas', 'reprogramar tarea propia', p => p.tareasOk, async x => (await x.u('POST', '/rest/v1/rpc/reprogram_task', { p_task_id: x.f.tarea, p_new_assigned_date: hoy() })).s < 300);
t('tareas', 'completar tarea ajena', NUNCA, async x => (await x.u('POST', '/rest/v1/rpc/complete_task', { p_task_id: tareaOtro })).s < 300);
t('tareas', 'cancelar tarea ajena', NUNCA, async x => (await x.u('POST', '/rest/v1/rpc/cancel_task', { p_task_id: tareaOtro })).s < 300);
t('tareas', 'ver contadores propios', SIEMPRE, async x => { const r = await x.u('POST', '/rest/v1/rpc/get_user_task_counts', { target_user_id: x.me }); return r.s === 200 && Number(r.d?.[0]?.total ?? 0) > 0; });
t('tareas', 'ver contadores de otro', p => p.tareasAdm, async x => { const r = await x.u('POST', '/rest/v1/rpc/get_user_task_counts', { target_user_id: otroId }); return r.s === 200 && Number(r.d?.[0]?.total ?? r.d?.total ?? 0) > 0; });
t('tareas', 'procesar tareas pendientes de otro', p => p.tareasAdm, async x => (await x.u('POST', '/rest/v1/rpc/process_pending_tasks_for_user', { target_user_id: otroId })).s < 300);

// archivos
const sube = (bucket) => async x => { const ruta = `zz-m/${x.w}-${sufijo()}.txt`; const r = await http('POST', `/storage/v1/object/${bucket}/${ruta}`, { token: x.tok, cuerpo: 'zz', crudo: true, cab: { 'Content-Type': 'text/plain', 'x-upsert': 'false' } }); if (r.s < 300) { x.sub[bucket] = ruta; } return r.s < 300; };
const borra = (bucket) => async x => { const ruta = `zz-m/${x.w}-b${sufijo()}.txt`; await http('POST', `/storage/v1/object/${bucket}/${ruta}`, { token: SERVICIO, apikey: SERVICIO, cuerpo: 'zz', crudo: true, cab: { 'Content-Type': 'text/plain' } }); const r = await http('DELETE', `/storage/v1/object/${bucket}/${ruta}`, { token: x.tok }); const sigue = (await http('GET', `/storage/v1/object/public/${bucket}/${ruta}`)).s === 200; if (sigue) await http('DELETE', `/storage/v1/object/${bucket}/${ruta}`, { token: SERVICIO, apikey: SERVICIO }); return r.s < 300 && !sigue; };
t('archivos', 'subir foto de repuesto', p => p.mantAcc, sube('items'));
t('archivos', 'borrar foto de repuesto', p => p.mantAcc, borra('items'));
t('archivos', 'subir manual/documento', p => p.mantAdm, sube('documentos'));
t('archivos', 'borrar manual/documento', p => p.mantAdm, borra('documentos'));
t('archivos', 'subir PDF de rótulo', SIEMPRE, sube('rotulos'));
t('archivos', 'borrar PDF de rótulo', p => p.rolAdmin, borra('rotulos'));

// funciones del servidor (solo se comprueba la puerta de entrada: quién pasa y quién es rechazado)
const fn = (nombre, cuerpo) => async x => { const r = await http('POST', `/functions/v1/${nombre}`, { token: x.tok, cuerpo }); const m = msg(r); return !/No autorizado|No autenticado/.test(m); };
t('servidor', 'crear usuario (entrada)', p => p.own, async x => fn('create-user', { email: 'x@y.z' })(x));
t('servidor', 'eliminar usuario (entrada)', p => p.own, async x => fn('delete-user', { userId: randomUUID() })(x));
t('servidor', 'resetear contraseña (entrada)', p => p.reset, async x => fn('reset-password', { userId: randomUUID(), password: 'ZZtest123' })(x));
t('servidor', 'resetear contraseña de un dueño', p => p.own, async x => { const r = await http('POST', '/functions/v1/reset-password', { token: x.tok, cuerpo: { userId: duenoBId, password: 'ZZtest123' } }); return r.s === 200; });

// ---------- qué módulos toca cada comprobación (para el cruce con los planes) ----------
const modsDe = (area, e) => {
  const r = (re) => re.test(e);
  if (area === 'lectura') {
    if (r(/^leer (equipos|equipo_items)$/)) return ['mantenimiento', 'deposito'];
    if (r(/^leer (item_proveedores)$/)) return ['deposito', 'proveedores'];
    if (r(/^leer (reparaciones|reparacion_items|reparacion_entregas)$/)) return ['deposito', 'proveedores'];
    if (r(/^leer (familias|subfamilias|sectores|items|planilla_familias)$/) || r(/retiros/)) return ['deposito'];
    if (r(/^leer (contactos|proveedores)$/)) return ['proveedores'];
    if (r(/^leer comisionistas$/)) return ['comisionistas'];
    if (r(/^leer (rotulo_disenos|rotulos_generados|rotulos_bultos|rotulos_fotos)$/)) return ['envios'];
    if (r(/tareas/)) return ['tareas'];
    return [];
  }
  if (area === 'directorio') {
    if (r(/proveedor$|contacto/)) return ['proveedores'];
    if (r(/comisionista/)) return ['comisionistas'];
    if (r(/diseño|envío|bulto|foto/)) return ['envios'];
    return [];
  }
  if (area === 'deposito') {
    if (r(/vincular|desvincular/)) return ['deposito', 'proveedores'];
    if (r(/equipo/)) return ['mantenimiento', 'deposito'];
    return ['deposito'];
  }
  if (area === 'reparaciones') return ['deposito', 'proveedores'];
  if (area === 'retiros') return ['deposito'];
  if (area === 'tareas') return ['tareas'];
  if (area === 'archivos') return r(/foto de repuesto/) ? ['deposito'] : r(/manual/) ? ['mantenimiento', 'deposito'] : ['envios'];
  return []; // soporte, usuarios, servidor
};
for (const prueba of T) prueba.mods = modsDe(prueba.area, prueba.etiqueta);
let activos = Object.fromEntries(['proveedores', 'comisionistas', 'envios', 'deposito', 'mantenimiento', 'tareas'].map((m) => [m, !(SIN_MANT && m === 'mantenimiento')]));
let estadoActual = 'plan completo';

// ---------- ejecución ----------
const fallos = [], resumen = {};
let total = 0, hechas = 0;
let lista = [];
let pend = [];
async function perfil(w, c) {
  const poner = () => sv('PATCH', `/rest/v1/usuarios_perfil?id=eq.${ids[w]}`, { rol: c.rol, mantenimiento_rol: c.mant, es_owner: c.es_owner, activo: c.activo, access_status: c.activo ? 'active' : 'blocked', puede_ver_retiros: c.ver_retiros, puede_ver_errores: c.ver_errores, puede_resetear_contrasenas: c.resetear, puede_ver_sugerencias: c.ver_sug });
  let r = await poner();
  // Solo pasa en el simulador local (PGlite agota su pila después de muchos minutos): se vuelve a fijar el límite y se reintenta.
  if (!hecho(r) && /stack depth/.test(msg(r))) { await q(null, "set max_stack_depth = '7MB'; select 1 as ok"); r = await poner(); }
  if (!hecho(r)) throw new Error('No pude fijar el perfil: ' + msg(r) + ' ' + desc(c));
}
async function trabajador(w) {
  const x0 = { w, f: F[w], me: ids[w], tok: toks[w] };
  while (pend.length) {
    const i = pend.shift(); const c = lista[i];
    await perfil(w, c);
    const p = P(c);
    const x = { ...x0, c, sub: {}, u: async (m, ruta, cuerpo, cab) => { let r = await http(m, ruta, { token: x0.tok, cuerpo, cab }); if (r.s === 401 && /expired|JWT/i.test(msg(r))) { x0.tok = await entrar(mails[w]); x.tok = x0.tok; r = await http(m, ruta, { token: x0.tok, cuerpo, cab }); } x.ultimo = { s: r.s, m: msg(r).slice(0, 90) }; return r; } };
    for (const prueba of T) {
      if (SOLO && !SOLO.includes(prueba.etiqueta)) continue;
      let real; try { real = !!(await prueba.correr(x)); } catch (e) { real = 'ERROR ' + e.message.slice(0, 120); }
      if (prueba.area === 'usuarios') await perfil(w, c); // estas comprobaciones cambian el perfil: se restablece
      // un usuario bloqueado no puede nada, salvo leer lo mínimo para que la pantalla le avise (su perfil y la configuración);
      // y un módulo apagado (por la licencia o por el dueño) bloquea lo suyo para TODOS, dueño incluido
      const esperado = !!prueba.esperado(p) && (c.activo || PERMITE_BLOQUEADO.has(prueba.etiqueta)) && prueba.mods.every((m) => activos[m]);
      total++;
      const k = prueba.area + ' · ' + prueba.etiqueta;
      resumen[k] ??= { ok: 0, mal: 0 };
      if (real === esperado) resumen[k].ok++;
      else { resumen[k].mal++; fallos.push({ k, combo: desc(c), esperado, real, estado: estadoActual }); console.log(`  DIF [${k}] (${desc(c)}) [${estadoActual}] esperado=${esperado} real=${real} última respuesta=${JSON.stringify(x.ultimo ?? null)}`); }
    }
    // dejar al trabajador en estado neutro
    for (const [b, ruta] of Object.entries(x.sub)) await http('DELETE', `/storage/v1/object/${b}/${ruta}`, { token: SERVICIO, apikey: SERVICIO });
    hechas++;
    if (hechas % 20 === 0) console.log(`  ${hechas}/${lista.length} configuraciones, ${fallos.length} diferencias`);
  }
}
async function correr(configs, etiqueta) {
  lista = configs; pend = [...lista.keys()]; hechas = 0; estadoActual = etiqueta;
  console.log(`Probando ${lista.length} configuraciones de usuario × ${T.length} comprobaciones (${etiqueta})…`);
  await Promise.all(Array.from({ length: TRABAJADORES }, (_, w) => trabajador(w)));
}
const t0 = Date.now();
if (!SOLO_CRUZAR) await correr(combos.slice(0, LIMITE || combos.length), 'plan completo');

if (CRUZAR) {
  const MODS6 = ['proveedores', 'comisionistas', 'envios', 'deposito', 'mantenimiento', 'tareas'];
  const todos = Object.fromEntries(MODS6.map((m) => [m, true])), ninguno = Object.fromEntries(MODS6.map((m) => [m, false]));
  const ESTADOS = [
    { n: 'Plan 2 (todo)', lic: todos, sw: {} },
    { n: 'Plan 1 (sin Mantenimiento)', lic: { ...todos, mantenimiento: false }, sw: {} },
    ...MODS6.map((m) => ({ n: `Plan 2 sin ${m} (licencia)`, lic: { ...todos, [m]: false }, sw: {} })),
    ...MODS6.map((m) => ({ n: `Plan 2, el dueño apagó ${m}`, lic: todos, sw: { [m]: true } })),
    { n: 'solo Tareas', lic: { ...ninguno, tareas: true }, sw: {} },
    { n: 'sin ningún módulo', lic: ninguno, sw: {} },
  ];
  // usuarios representativos: cada rol de Directorio × cada rol de Depósito (con todos los permisos sueltos o ninguno), un bloqueado y los dos tipos de dueño
  const repr = combos.filter((c) => (c.es_owner ? true : !c.activo ? (c.rol === 'user' && c.mant === 'comun' && !c.ver_retiros && !c.ver_errores && !c.resetear && !c.ver_sug) : (c.ver_retiros === c.ver_errores && c.ver_errores === c.resetear && c.resetear === c.ver_sug)));
  const lic0c = (await sv('GET', '/rest/v1/licencia?select=modulos&id=eq.1')).d[0].modulos;
  const apag0c = (await q(null, 'select apagados from public.preferencias_modulos where id = 1'))[0]?.apagados ?? {};
  try {
    // ESTADOS=a-b corre solo esos estados (índices desde 0): el simulador local se degrada si trabaja muchos minutos seguidos, así que se parte en tandas.
    const rango = String(process.env.ESTADOS ?? '').match(/^(\d+)-(\d+)$/);
    for (const e of (rango ? ESTADOS.slice(Number(rango[1]), Number(rango[2]) + 1) : ESTADOS)) {
      const r = await sv('PATCH', '/rest/v1/licencia?id=eq.1', { modulos: SIN_MANT ? { ...e.lic, mantenimiento: false } : e.lic }); if (!hecho(r)) throw new Error('licencia: ' + msg(r));
      await q(null, `update public.preferencias_modulos set apagados = '${JSON.stringify(e.sw)}'::jsonb where id = 1; select 1 as ok`);
      activos = Object.fromEntries(MODS6.map((m) => [m, e.lic[m] === true && e.sw[m] !== true && !(SIN_MANT && m === 'mantenimiento')]));
      await correr(repr, e.n);
    }
  } finally {
    await sv('PATCH', '/rest/v1/licencia?id=eq.1', { modulos: lic0c });
    await q(null, `update public.preferencias_modulos set apagados = '${JSON.stringify(apag0c)}'::jsonb where id = 1; select 1 as ok`);
    activos = Object.fromEntries(MODS6.map((m) => [m, !(SIN_MANT && m === 'mantenimiento')]));
  }
}
console.log(`Listo en ${Math.round((Date.now() - t0) / 1000)} s: ${total} comprobaciones, ${fallos.length} diferencias.`);

// ---------- limpieza ----------
const orden = ['retiro_items', 'retiros', 'reparacion_entregas', 'reparacion_items', 'reparaciones', 'item_proveedores', 'equipo_items', 'equipos', 'items', 'subfamilias', 'familias', 'rotulos_fotos', 'rotulos_bultos', 'rotulos_generados', 'contactos', 'comisionistas', 'proveedores', 'sectores', 'tasks', 'sugerencias', 'error_logs', 'rotulo_disenos'];
for (const tb of orden) {
  const mios = rastro.filter(r => r[0] === tb).map(r => r[1]);
  for (let i = 0; i < mios.length; i += 50) await sv('DELETE', `/rest/v1/${tb}?id=in.(${mios.slice(i, i + 50).join(',')})`);
}
await sv('DELETE', `/rest/v1/rotulo_disenos?nombre=eq.ZZ-m diseño`);
await sv('DELETE', `/rest/v1/equipos?nombre=like.ZZ-m*`); await sv('DELETE', `/rest/v1/proveedores?nombre=like.ZZ-m*`);
await sv('DELETE', `/rest/v1/items?descripcion=like.ZZ-m*`); await sv('DELETE', `/rest/v1/familias?nombre=like.ZZ-m*`); await sv('DELETE', `/rest/v1/sectores?nombre=like.ZZ-m*`);
await sv('DELETE', `/rest/v1/comisionistas?nombre=like.ZZ-m*`);
await sv('PATCH', '/rest/v1/configuracion?id=eq.1', { empresa_telefono: config0.empresa_telefono });

// ---------- informe ----------
console.log('\nResumen por comprobación (ok / diferencias):');
for (const [k, v] of Object.entries(resumen)) console.log(`${v.mal ? '✗' : '✓'} ${k.padEnd(62)} ${String(v.ok).padStart(4)} / ${v.mal}`);
const grupos = {}; for (const f of fallos) (grupos[f.k] ??= []).push(f);
for (const [k, l] of Object.entries(grupos)) { console.log(`\n✗ ${k}: ${l.length} diferencias. Ejemplos:`); for (const f of l.slice(0, 4)) console.log(`   [${f.combo}] esperado=${f.esperado} real=${f.real}`); }

await terminar(fallos.length ? 1 : 0);
