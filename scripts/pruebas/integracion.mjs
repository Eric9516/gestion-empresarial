#!/usr/bin/env node
// Prueba de punta a punta de una instalación: permisos, dueños, stock, auditoría, funciones
// del servidor, módulos y colores. Usa usuarios y datos de prueba REALES de ese proyecto.
//
//   pnpm pruebas:integracion --cliente clientes/mi-cliente.env.local --es-un-proyecto-de-pruebas
//
// SOLO para proyectos de pruebas: crea usuarios (@prueba-plantilla.com), repuestos y retiros, y
// cambia por un momento el nombre de la empresa. Se niega a correr si encuentra usuarios reales.

import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argumentos = process.argv.slice(2);
const opcion = n => { const i = argumentos.indexOf(`--${n}`); return i >= 0 ? (argumentos[i + 1]?.startsWith('--') || argumentos[i + 1] === undefined ? true : argumentos[i + 1]) : undefined; };

if (!opcion('es-un-proyecto-de-pruebas')) { console.error('Falta --es-un-proyecto-de-pruebas: este script crea y borra datos de prueba.'); process.exit(1); }
const archivoCliente = opcion('cliente');
if (!archivoCliente || archivoCliente === true) { console.error('Falta --cliente <archivo .env.local del cliente>.'); process.exit(1); }

const leer = ruta => Object.fromEntries(readFileSync(ruta, 'utf8').split('\n').filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const cfg = leer(join(RAIZ, archivoCliente));
const URL = cfg.VITE_SUPABASE_URL, ANON = cfg.VITE_SUPABASE_ANON_KEY, SERVICIO = cfg.SUPABASE_SECRET_KEY, REF = cfg.SUPABASE_PROJECT_REF;
if (!URL || !ANON || !SERVICIO || !REF || !cfg.PRIMER_DUENO_EMAIL || !cfg.PRIMER_DUENO_CLAVE_INICIAL) {
  console.error('El archivo del cliente está incompleto (hace falta URL, claves, proyecto y el dueño con su contraseña inicial).'); process.exit(1);
}

const resultados = [];
const ok = (nombre, cond, detalle = '') => { resultados.push(Boolean(cond)); console.log(`${cond ? 'OK   ' : 'FALLA'} ${nombre}${detalle ? '  → ' + detalle : ''}`); };
const msg = r => String((r.datos && (r.datos.message || r.datos.msg || r.datos.error_description || r.datos.error)) || '').slice(0, 90);

async function http(ruta, { metodo = 'GET', token, clave = ANON, cuerpo } = {}) {
  const r = await fetch(URL + ruta, {
    method: metodo,
    headers: { apikey: clave, Authorization: `Bearer ${token || clave}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  let datos = null; try { datos = await r.json(); } catch { /* sin cuerpo */ }
  return { estado: r.status, datos };
}
const admin = (ruta, o = {}) => http(ruta, { ...o, clave: SERVICIO });
const ingresar = async (email, password) => (await http('/auth/v1/token?grant_type=password', { metodo: 'POST', cuerpo: { email, password } })).datos?.access_token;
const funcion = (nombre, token, cuerpo) => http(`/functions/v1/${nombre}`, { metodo: 'POST', token, cuerpo });
const perfil = async email => (await admin(`/rest/v1/usuarios_perfil?select=*&email=eq.${encodeURIComponent(email)}`)).datos?.[0];

function sql(texto) {
  const archivo = 'scripts/pruebas/.tmp.sql';
  execFileSync(process.execPath, ['-e', `require('fs').writeFileSync(${JSON.stringify(join(RAIZ, archivo))}, ${JSON.stringify(texto)})`]);
  return execFileSync('npx', ['--yes', 'supabase', 'db', 'query', '--linked', '--project-ref', REF, '-f', archivo], { cwd: RAIZ, shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// ---------- seguridad antes de empezar ----------
const todos = (await admin('/rest/v1/usuarios_perfil?select=email')).datos ?? [];
const ajenos = todos.filter(u => !u.email.endsWith('@prueba-plantilla.com') && u.email.toLowerCase() !== cfg.PRIMER_DUENO_EMAIL.toLowerCase());
if (ajenos.length) { console.error(`Este proyecto tiene usuarios que no son de prueba (${ajenos.length}). No toco nada.`); process.exit(1); }

const limpieza = `
truncate public.reparacion_entregas, public.reparacion_items, public.reparaciones, public.item_proveedores,
  public.equipo_items, public.equipos, public.retiro_items, public.retiros, public.items, public.subfamilias,
  public.familias, public.sectores, public.planilla_familias, public.rotulos_bultos, public.rotulos_fotos,
  public.rotulos_generados, public.contactos, public.proveedores, public.comisionistas,
  public.task_history, public.tasks restart identity cascade;
-- (rotulo_disenos se borra aparte: la configuración apunta a esa tabla y un "cascade" también la vaciaría)
delete from public.rotulo_disenos;
alter table public.usuarios_perfil disable trigger trg_evitar_borrar_dueno;
alter table public.usuarios_perfil disable trigger trg_evitar_sin_owner;
delete from public.usuarios_perfil where email like '%@prueba-plantilla.com';
delete from auth.users where email like '%@prueba-plantilla.com';
alter table public.usuarios_perfil enable trigger trg_evitar_borrar_dueno;
alter table public.usuarios_perfil enable trigger trg_evitar_sin_owner;
update public.licencia set modulos = '{"proveedores": true, "comisionistas": true, "envios": true, "tareas": true, "deposito": true}'::jsonb;
truncate public.audit_log restart identity;
insert into public.configuracion (id) values (1) on conflict (id) do nothing;
select 1 as ok;`;
sql(limpieza);
const configOriginal = (await admin('/rest/v1/configuracion?id=eq.1&select=empresa_nombre,color_primario,color_deposito,inicial_cerrada_at')).datos?.[0];

// ---------- 1) usuarios y dueño de la instalación ----------
const clave = () => 'Pr' + randomBytes(9).toString('base64url') + '9!';
const dueno = { email: cfg.PRIMER_DUENO_EMAIL, clave: cfg.PRIMER_DUENO_CLAVE_INICIAL };
const deposito = { email: 'deposito@prueba-plantilla.com', nombre: 'Admin Depósito', clave: clave() };
const comun = { email: 'comun@prueba-plantilla.com', nombre: 'Usuario Común', clave: clave() };
for (const p of [deposito, comun]) {
  const r = await admin('/auth/v1/admin/users', { metodo: 'POST', cuerpo: { email: p.email, password: p.clave, email_confirm: true, user_metadata: { full_name: p.nombre } } });
  if (r.estado >= 300) { console.error('No se pudo crear', p.email, JSON.stringify(r.datos).slice(0, 150)); process.exit(1); }
  p.id = r.datos.id;
}
dueno.token = await ingresar(dueno.email, dueno.clave);
ok('El dueño que dejó el instalador puede iniciar sesión', !!dueno.token);
const pDueno = await perfil(dueno.email);
dueno.id = pDueno?.id;
ok('Ese usuario es dueño y administrador', pDueno?.es_owner === true && pDueno?.rol === 'admin' && pDueno?.mantenimiento_rol === 'admin');
const perfiles = await admin(`/rest/v1/usuarios_perfil?select=email,access_status,es_owner,rol&email=like.*@prueba-plantilla.com`);
ok('El disparador creó el perfil de cada usuario nuevo, sin privilegios y con acceso activo', perfiles.datos.length === 2 && perfiles.datos.every(x => x.access_status === 'active' && !x.es_owner && x.rol === 'user'));
let r = await admin('/rest/v1/rpc/definir_dueno_inicial', { metodo: 'POST', cuerpo: { p_email: comun.email } });
ok('Ya con un dueño, "definir primer dueño" se rechaza', r.estado >= 400, msg(r).slice(0, 60));
for (const p of [deposito, comun]) p.token = await ingresar(p.email, p.clave);
ok('Los usuarios de prueba inician sesión', deposito.token && comun.token);
r = await http('/rest/v1/rpc/definir_dueno_inicial', { metodo: 'POST', token: dueno.token, cuerpo: { p_email: comun.email } });
ok('Con sesión de usuario tampoco se puede usar esa función', r.estado >= 400);

// ---------- 2) seguridad de roles ----------
r = await http(`/rest/v1/usuarios_perfil?id=eq.${comun.id}`, { metodo: 'PATCH', token: comun.token, cuerpo: { rol: 'admin', mantenimiento_rol: 'admin' } });
ok('Un usuario común NO puede ascenderse solo', r.estado >= 400, msg(r).slice(0, 60));
r = await http(`/rest/v1/usuarios_perfil?id=eq.${comun.id}`, { metodo: 'PATCH', token: comun.token, cuerpo: { es_owner: true } });
ok('Un usuario común NO puede hacerse dueño', r.estado >= 400);
r = await http(`/rest/v1/usuarios_perfil?id=eq.${comun.id}`, { metodo: 'PATCH', token: comun.token, cuerpo: { nombre: 'Común Editado' } });
ok('Un usuario común SÍ puede cambiar su nombre', r.estado < 300 && r.datos?.[0]?.nombre === 'Común Editado');
r = await http(`/rest/v1/usuarios_perfil?id=eq.${deposito.id}`, { metodo: 'PATCH', token: dueno.token, cuerpo: { mantenimiento_rol: 'admin', puede_ver_retiros: true } });
ok('El dueño SÍ puede dar roles y permisos', r.estado < 300 && r.datos?.[0]?.mantenimiento_rol === 'admin');
r = await http(`/rest/v1/usuarios_perfil?id=eq.${comun.id}`, { metodo: 'PATCH', token: dueno.token, cuerpo: { mantenimiento_rol: 'comun' } });
ok('El dueño le da acceso al Depósito al usuario común', r.estado < 300);

// ---------- 3) varios dueños ----------
r = await http('/rest/v1/rpc/agregar_dueno', { metodo: 'POST', token: dueno.token, cuerpo: { p_id: deposito.id } });
ok('El dueño agrega un segundo dueño', r.estado < 300);
ok('Hay 2 dueños', (await admin('/rest/v1/usuarios_perfil?select=id&es_owner=eq.true')).datos.length === 2);
r = await http(`/rest/v1/usuarios_perfil?id=eq.${dueno.id}`, { metodo: 'PATCH', token: deposito.token, cuerpo: { activo: false } });
ok('El segundo dueño NO puede bloquear al primero', r.estado >= 400);
r = await http(`/rest/v1/usuarios_perfil?id=eq.${comun.id}`, { metodo: 'PATCH', token: deposito.token, cuerpo: { puede_ver_errores: true } });
ok('El segundo dueño SÍ puede editar a otro usuario', r.estado < 300);
r = await http('/rest/v1/rpc/quitar_dueno', { metodo: 'POST', token: deposito.token, cuerpo: { p_id: dueno.id } });
ok('Un dueño puede quitarle el cargo al otro', r.estado < 300);
r = await http('/rest/v1/rpc/quitar_dueno', { metodo: 'POST', token: deposito.token, cuerpo: { p_id: deposito.id } });
ok('No se puede quitar al último dueño', r.estado >= 400, msg(r).slice(0, 60));
r = await http('/rest/v1/rpc/agregar_dueno', { metodo: 'POST', token: deposito.token, cuerpo: { p_id: dueno.id } });
ok('Se vuelve a dejar a los dos como dueños', r.estado < 300);
r = await http('/rest/v1/rpc/agregar_dueno', { metodo: 'POST', token: comun.token, cuerpo: { p_id: comun.id } });
ok('Un usuario común no puede agregar dueños', r.estado >= 400);
r = await http('/rest/v1/rpc/agregar_dueno', { metodo: 'POST', cuerpo: { p_id: comun.id } });
ok('Sin sesión tampoco', r.estado >= 400);

// ---------- 4) depósito: repuestos, retiros, stock, auditoría ----------
r = await http('/rest/v1/familias', { metodo: 'POST', token: dueno.token, cuerpo: { codigo: 'TE', nombre: 'Familia de prueba' } });
const familiaId = r.datos?.[0]?.id;
r = await http('/rest/v1/subfamilias', { metodo: 'POST', token: dueno.token, cuerpo: { familia_id: familiaId, codigo: 'SU', nombre: 'Subfamilia de prueba' } });
const subId = r.datos?.[0]?.id;
ok('El dueño crea familia y subfamilia', !!familiaId && !!subId);
r = await http('/rest/v1/items', { metodo: 'POST', token: deposito.token, cuerpo: { codigo: 'PRB00001', descripcion: 'Repuesto de prueba', stock: 20, numero: 1, familia_id: familiaId, subfamilia_id: subId } });
const itemId = r.datos?.[0]?.id;
ok('Un administrador crea un repuesto', !!itemId, msg(r).slice(0, 60));
r = await http('/rest/v1/sectores', { metodo: 'POST', token: deposito.token, cuerpo: { nombre: 'Sector de prueba' } });
const sectorId = r.datos?.[0]?.id;
ok('Se crea un sector', !!sectorId);
r = await http('/rest/v1/retiros', { metodo: 'POST', token: comun.token, cuerpo: { usuario_id: comun.id, sector_id: sectorId } });
const retiroId = r.datos?.[0]?.id;
ok('Un usuario del Depósito registra un retiro propio', !!retiroId, msg(r).slice(0, 60));
r = await http('/rest/v1/retiro_items', { metodo: 'POST', token: comun.token, cuerpo: { retiro_id: retiroId, item_id: itemId, cantidad: 3 } });
const riId = r.datos?.[0]?.id;
let it = await http(`/rest/v1/items?id=eq.${itemId}&select=stock`, { token: deposito.token });
ok('El stock bajó solo de 20 a 17', it.datos?.[0]?.stock === 17, `stock=${it.datos?.[0]?.stock}`);
const antes = (await http('/rest/v1/audit_log?select=id&tabla=eq.items', { token: dueno.token })).datos.length;
r = await http(`/rest/v1/items?id=eq.${itemId}`, { metodo: 'PATCH', token: deposito.token, cuerpo: { stock: 50, ubicacion: 'Estante 3' } });
const aud = await http('/rest/v1/audit_log?select=descripcion&tabla=eq.items&order=id.desc', { token: dueno.token });
ok('Corregir el stock a mano queda en la auditoría con el detalle', aud.datos?.length === antes + 1 && /stock 17 → 50/.test(aud.datos[0].descripcion), aud.datos?.[0]?.descripcion?.slice(0, 70));
r = await http(`/rest/v1/retiro_items?id=eq.${riId}`, { metodo: 'PATCH', token: comun.token, cuerpo: { cantidad: 5 } });
it = await http(`/rest/v1/items?id=eq.${itemId}&select=stock`, { token: deposito.token });
ok('Corregir un retiro ajusta el stock solo (50 → 48)', it.datos?.[0]?.stock === 48, `stock=${it.datos?.[0]?.stock}`);
ok('…y ese ajuste automático no se duplica en la auditoría de repuestos', (await http('/rest/v1/audit_log?select=id&tabla=eq.items', { token: dueno.token })).datos.length === antes + 1);
ok('…pero la corrección del retiro sí queda registrada', (await http('/rest/v1/audit_log?select=id&tabla=eq.retiro_items', { token: dueno.token })).datos.length >= 1);
r = await http('/rest/v1/audit_log?select=id', { token: comun.token });
ok('Un usuario común NO puede leer la auditoría', Array.isArray(r.datos) ? r.datos.length === 0 : r.estado >= 400);
r = await http('/rest/v1/audit_log?select=id', { token: dueno.token });
ok('El dueño SÍ la lee', Array.isArray(r.datos) && r.datos.length > 0);

// ---------- 5) sin sesión ----------
for (const t of ['items', 'usuarios_perfil', 'retiros', 'audit_log', 'proveedores', 'tasks']) {
  r = await http(`/rest/v1/${t}?select=*&limit=1`);
  ok(`Sin sesión no se ve nada en ${t}`, (Array.isArray(r.datos) && r.datos.length === 0) || r.estado >= 400);
}
r = await http('/rest/v1/configuracion?select=empresa_nombre');
ok('Sin sesión SÍ se ve la configuración (a propósito: el ingreso muestra nombre y logo)', Array.isArray(r.datos) && r.datos.length === 1);
r = await http('/rest/v1/configuracion?id=eq.1', { metodo: 'PATCH', token: comun.token, cuerpo: { empresa_nombre: 'Intento' } });
ok('Un usuario común no puede cambiar la configuración', !(r.datos?.length > 0));

// ---------- 6) colores de marca ----------
r = await http('/rest/v1/configuracion?id=eq.1', { metodo: 'PATCH', token: dueno.token, cuerpo: { color_primario: '#0b6e4f', color_deposito: '#7a2a8a' } });
ok('El dueño guarda los colores de la marca', r.estado < 300 && r.datos?.[0]?.color_primario === '#0b6e4f');
r = await http('/rest/v1/configuracion?id=eq.1', { metodo: 'PATCH', token: dueno.token, cuerpo: { color_primario: 'rojo' } });
ok('Un color inválido se rechaza', r.estado >= 400);
r = await http('/rest/v1/configuracion?id=eq.1', { metodo: 'PATCH', token: comun.token, cuerpo: { inicial_cerrada_at: new Date().toISOString() } });
ok('Un usuario común no puede cerrar el asistente de configuración inicial', !(r.datos?.length > 0));
r = await http('/rest/v1/configuracion?id=eq.1', { metodo: 'PATCH', token: dueno.token, cuerpo: { inicial_cerrada_at: null } });
ok('El dueño puede reabrirlo y cerrarlo', r.estado < 300 && r.datos?.[0]?.inicial_cerrada_at === null);
r = await http('/rest/v1/configuracion?id=eq.1', { metodo: 'PATCH', token: dueno.token, cuerpo: { inicial_cerrada_at: new Date().toISOString() } });
ok('…y cerrarlo', r.estado < 300 && !!r.datos?.[0]?.inicial_cerrada_at);
r = await http('/rest/v1/configuracion?id=eq.1', { metodo: 'PATCH', token: dueno.token, cuerpo: { color_primario: null, color_deposito: null } });
ok('Se puede volver a los colores originales', r.estado < 300 && r.datos?.[0]?.color_primario === null);

// ---------- 7) funciones del servidor ----------
const nuevoMail = 'nuevo@prueba-plantilla.com', nuevaClave = clave(), claveReset = clave();
r = await funcion('create-user', null, { email: nuevoMail, password: nuevaClave, nombre: 'Nuevo' });
ok('Crear usuario sin sesión se rechaza', r.estado >= 400);
r = await funcion('create-user', comun.token, { email: nuevoMail, password: nuevaClave, nombre: 'Nuevo' });
ok('Un usuario común no puede crear usuarios', r.estado >= 400 || r.datos?.error, msg(r));
r = await funcion('create-user', dueno.token, { email: nuevoMail, password: nuevaClave, nombre: 'Nuevo', apellido: 'Usuario', rol: 'user', mantenimiento_rol: 'comun', puede_ver_retiros: true, puede_ver_errores: false, puede_resetear_contrasenas: false, puede_ver_sugerencias: false });
ok('El dueño crea un usuario con roles y permisos', r.estado < 300 && !r.datos?.error, msg(r));
const pNuevo = await perfil(nuevoMail);
ok('El perfil quedó con lo pedido', pNuevo?.mantenimiento_rol === 'comun' && pNuevo?.puede_ver_retiros === true && pNuevo?.rol === 'user');
ok('El usuario creado puede iniciar sesión', !!(await ingresar(nuevoMail, nuevaClave)));
r = await funcion('reset-password', comun.token, { userId: pNuevo.id, password: claveReset });
ok('Sin permiso no se pueden resetear contraseñas', r.estado >= 400 || r.datos?.error);
r = await funcion('reset-password', dueno.token, { userId: pNuevo.id, password: claveReset });
ok('El dueño resetea una contraseña', r.estado < 300 && !r.datos?.error);
ok('Con la nueva se entra y con la vieja no', !!(await ingresar(nuevoMail, claveReset)) && !(await ingresar(nuevoMail, nuevaClave)));
const audPw = await http('/rest/v1/audit_log?select=descripcion,usuario_nombre&descripcion=like.Contraseña*', { token: dueno.token });
ok('El reseteo queda en la auditoría, sin la contraseña', audPw.datos?.length >= 1 && !JSON.stringify(audPw.datos).includes(claveReset));
r = await funcion('delete-user', comun.token, { userId: pNuevo.id });
ok('Un usuario común no puede eliminar usuarios', r.estado >= 400 || r.datos?.error);
r = await funcion('delete-user', dueno.token, { userId: dueno.id });
ok('Nadie puede eliminarse a sí mismo', r.estado >= 400 || r.datos?.error);
r = await funcion('delete-user', dueno.token, { userId: deposito.id });
const sigue = (await admin(`/auth/v1/admin/users/${deposito.id}`)).estado === 200 && !!(await perfil(deposito.email));
ok('Eliminar a otro dueño se rechaza y no deja la cuenta a medias', (r.estado >= 400 || r.datos?.error) && sigue, msg(r).slice(0, 70));
r = await funcion('delete-user', dueno.token, { userId: pNuevo.id });
ok('El dueño elimina a un usuario común (perfil y cuenta)', r.estado < 300 && !(await perfil(nuevoMail)) && (await admin(`/auth/v1/admin/users/${pNuevo.id}`)).estado === 404);

// ---------- 8) licencia de módulos: bloqueo real en la base de datos ----------
const licenciaActual = async () => (await admin('/rest/v1/licencia?select=modulos')).datos?.[0]?.modulos;
const poner = async (apagados = []) => {
  const m = { proveedores: true, comisionistas: true, envios: true, tareas: true, deposito: true };
  for (const k of apagados) m[k] = false;
  const x = await admin('/rest/v1/licencia?id=eq.1', { metodo: 'PATCH', cuerpo: { modulos: m } });
  if (x.estado >= 300) throw new Error('No se pudo cambiar la licencia: ' + JSON.stringify(x.datos));
};

r = await http('/rest/v1/licencia?select=modulos', { token: comun.token });
ok('Un usuario con sesión puede leer la licencia', r.datos?.length === 1);
r = await http('/rest/v1/licencia?select=modulos');
ok('Sin sesión no se lee la licencia', !(Array.isArray(r.datos) && r.datos.length > 0));
for (const [quien, token] of [['El dueño', dueno.token], ['Un usuario común', comun.token]]) {
  await http('/rest/v1/licencia?id=eq.1', { metodo: 'PATCH', token, cuerpo: { modulos: { deposito: false, tareas: false } } });
  const actual = await licenciaActual();
  ok(`${quien} NO puede cambiar la licencia`, actual.deposito !== false && actual.tareas !== false);
}
r = await http('/rest/v1/licencia', { metodo: 'POST', token: dueno.token, cuerpo: { id: 1, modulos: {} } });
ok('Nadie con sesión puede crear otra licencia', r.estado >= 400);
await http('/rest/v1/licencia?id=eq.1', { metodo: 'DELETE', token: dueno.token });
ok('Ni borrarla', (await licenciaActual()) !== undefined);

// Una fila en cada tabla de módulo (con la clave de servicio, que no pasa por las reglas)
const sembrar = async (tabla, cuerpo) => {
  const x = await admin(`/rest/v1/${tabla}`, { metodo: 'POST', cuerpo });
  if (x.estado >= 300) throw new Error(`No se pudo sembrar ${tabla}: ${JSON.stringify(x.datos).slice(0, 150)}`);
  return x.datos?.[0];
};
const grupo = randomUUID();
const prov = await sembrar('proveedores', { nombre: 'Proveedor de prueba' });
await sembrar('contactos', { proveedor_id: prov.id, nombre: 'Contacto de prueba' });
await sembrar('comisionistas', { nombre: 'Comisionista de prueba' });
const rot = await sembrar('rotulos_generados', { proveedor_id: prov.id, grupo_id: grupo });
await sembrar('rotulos_bultos', { rotulo_id: rot.id, numero: 1 });
await sembrar('rotulos_fotos', { grupo_id: grupo, proveedor_id: prov.id, storage_path: 'prueba/x.jpg' });
await sembrar('rotulo_disenos', { nombre: 'Diseño de prueba', design: {} });
await sembrar('planilla_familias', { id: true, storage_path: 'prueba/x.xlsx', nombre_archivo: 'x.xlsx' });
const equipo = await sembrar('equipos', { sector: 'Sector de prueba', nombre: 'Equipo de prueba' });
await sembrar('equipo_items', { equipo_id: equipo.id, item_id: itemId });
const reparacion = await sembrar('reparaciones', { proveedor_id: prov.id, motivo: 'Prueba', fecha_salida: '2026-01-01', responsable_id: dueno.id });
await sembrar('reparacion_items', { reparacion_id: reparacion.id, item_id: itemId, cantidad: 1 });
await sembrar('item_proveedores', { item_id: itemId, proveedor_id: prov.id });
r = await http('/rest/v1/rpc/create_task', { metodo: 'POST', token: dueno.token, cuerpo: { p_title: 'Tarea de prueba' } });
ok('Con todos los módulos activos se puede crear una tarea', r.estado < 300, msg(r));

// Qué módulos necesita cada tabla (los de dos módulos necesitan los dos)
const NECESITA = {
  proveedores: ['proveedores'], contactos: ['proveedores'], comisionistas: ['comisionistas'],
  rotulos_generados: ['envios'], rotulos_bultos: ['envios'], rotulos_fotos: ['envios'], rotulo_disenos: ['envios'],
  items: ['deposito'], familias: ['deposito'], subfamilias: ['deposito'], planilla_familias: ['deposito'], retiros: ['deposito'],
  retiro_items: ['deposito'], sectores: ['deposito'], equipos: ['deposito'], equipo_items: ['deposito'],
  reparaciones: ['deposito', 'proveedores'], reparacion_items: ['deposito', 'proveedores'], item_proveedores: ['deposito', 'proveedores'],
  tasks: ['tareas'],
};
const verTodas = async token => {
  const ve = {};
  for (const t of Object.keys(NECESITA)) { const x = await http(`/rest/v1/${t}?select=*&limit=1`, { token }); ve[t] = Array.isArray(x.datos) && x.datos.length > 0; }
  return ve;
};
const comparar = (ve, apagados) => Object.keys(NECESITA).filter(t => ve[t] !== NECESITA[t].every(m => !apagados.includes(m)));
const subirTxt = async (bucket, token) => {
  const nombre = `prueba-modulos-${Date.now()}.txt`;
  const x = await fetch(`${URL}/storage/v1/object/${bucket}/${nombre}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' }, body: 'prueba' });
  await fetch(`${URL}/storage/v1/object/${bucket}/${nombre}`, { method: 'DELETE', headers: { apikey: SERVICIO, Authorization: `Bearer ${SERVICIO}` } });
  return x.status;
};

await poner([]);
let desvios = comparar(await verTodas(dueno.token), []);
ok(`Con todos los módulos activos, el dueño ve las ${Object.keys(NECESITA).length} tablas con datos`, desvios.length === 0, desvios.join(', '));
ok('…y puede subir archivos a las carpetas de Depósito y de Envíos', (await subirTxt('items', dueno.token)) < 300 && (await subirTxt('rotulos', dueno.token)) < 300);

for (const apagado of ['proveedores', 'comisionistas', 'envios', 'deposito', 'tareas']) {
  await poner([apagado]);
  desvios = comparar(await verTodas(dueno.token), [apagado]);
  ok(`Con "${apagado}" apagado, el dueño pierde exactamente las tablas de ese módulo y conserva las demás`, desvios.length === 0, desvios.length ? 'distintas a lo esperado: ' + desvios.join(', ') : '');
  r = await http('/rest/v1/items', { metodo: 'POST', token: dueno.token, cuerpo: { codigo: 'BLQ1', descripcion: 'x', numero: 9, stock: 1, familia_id: familiaId, subfamilia_id: subId } });
  if (apagado === 'deposito') ok('   …escribir en una tabla del módulo apagado se rechaza', r.estado >= 400 && /row-level security/i.test(msg(r)), msg(r));
  else ok('   …escribir en las tablas de los otros módulos sigue permitido', r.estado < 300, msg(r));
  if (r.estado < 300) await admin('/rest/v1/items?codigo=eq.BLQ1', { metodo: 'DELETE' });
  if (apagado === 'tareas') {
    r = await http('/rest/v1/rpc/create_task', { metodo: 'POST', token: dueno.token, cuerpo: { p_title: 'No debería' } });
    ok('   …crear una tarea se rechaza', r.estado >= 400 && /no est[aá] activo/i.test(msg(r)), msg(r));
  }
  if (apagado === 'deposito' || apagado === 'proveedores') {
    r = await http('/rest/v1/rpc/crear_reparacion', { metodo: 'POST', token: dueno.token, cuerpo: { p_proveedor_id: prov.id, p_motivo: 'x', p_fecha_salida: '2026-01-01', p_envio_id: null, p_items: [] } });
    ok('   …crear una reparación se rechaza por el módulo (no por otra causa)', r.estado >= 400 && /no est[aá] activo/i.test(msg(r)), msg(r));
  }
  if (apagado === 'deposito') {
    r = await http('/rest/v1/rpc/historial_retiros_por_item', { metodo: 'POST', token: dueno.token, cuerpo: { p_item_id: itemId } });
    ok('   …el historial de retiros de un repuesto no devuelve nada', Array.isArray(r.datos) && r.datos.length === 0);
    ok('   …no se pueden subir archivos a la carpeta de Depósito, pero sí a la de Envíos', (await subirTxt('items', dueno.token)) >= 400 && (await subirTxt('rotulos', dueno.token)) < 300);
  }
  if (apagado === 'envios') ok('   …no se pueden subir archivos a la carpeta de Envíos, pero sí a la de Depósito', (await subirTxt('rotulos', dueno.token)) >= 400 && (await subirTxt('items', dueno.token)) < 300);
}

// Varios módulos apagados a la vez
await poner(['proveedores', 'envios', 'tareas']);
desvios = comparar(await verTodas(dueno.token), ['proveedores', 'envios', 'tareas']);
ok('Con varios apagados a la vez, cada tabla sigue a sus módulos', desvios.length === 0, desvios.join(', '));
await poner([]);

// Un módulo que NO figura en la licencia está apagado: así un módulo nuevo no llega a ningún cliente sin comprarlo.
const ponerCrudo = async m => {
  const x = await admin('/rest/v1/licencia?id=eq.1', { metodo: 'PATCH', cuerpo: { modulos: m } });
  if (x.estado >= 300) throw new Error('No se pudo cambiar la licencia: ' + JSON.stringify(x.datos));
};
await ponerCrudo({ proveedores: true, comisionistas: true, envios: true, deposito: true }); // sin "tareas"
r = await http('/rest/v1/rpc/create_task', { metodo: 'POST', token: dueno.token, cuerpo: { p_title: 'No debería' } });
ok('Un módulo que no figura en la licencia está apagado (aunque los demás sí estén activos)', r.estado >= 400 && /no est[aá] activo/i.test(msg(r)), msg(r));
desvios = comparar(await verTodas(dueno.token), ['tareas']);
ok('…sus tablas quedan bloqueadas y las de los demás módulos siguen disponibles', desvios.length === 0, desvios.join(', '));
await ponerCrudo({});
const conLicenciaVacia = await verTodas(dueno.token);
ok('Con la licencia vacía no hay ningún módulo activo', Object.values(conLicenciaVacia).every(v => v === false));
await poner([]);
ok('Y al ponerlos expresamente activos, todo vuelve', Object.values(await verTodas(dueno.token)).every(v => v === true));

const reglas = sql(`select count(*)::int as n from pg_policies where policyname = 'bloqueo_modulo' and permissive = 'RESTRICTIVE'`);
ok('Cada tabla de módulo tiene su regla de bloqueo (22 reglas)', /"n":\s*22/.test(reglas), (reglas.match(/"n":\s*\d+/) || [''])[0]);
const regStorage = sql(`select count(*)::int as n from pg_policies where tablename = 'objects' and policyname like 'bloqueo_modulo_%'`);
ok('Cada carpeta de archivos tiene su regla (3 reglas)', /"n":\s*3/.test(regStorage));
const audLic = await http('/rest/v1/audit_log?select=descripcion,usuario_nombre&tabla=eq.licencia&order=id.desc', { token: dueno.token });
ok('Cada cambio de la licencia quedó en el historial', audLic.datos?.length >= 6 && audLic.datos.some(x => /apagado/.test(x.descripcion)), audLic.datos?.[0]?.descripcion);
r = await http('/rest/v1/audit_log?select=id&tabla=eq.licencia', { token: comun.token });
ok('…y un usuario común no lo ve', Array.isArray(r.datos) ? r.datos.length === 0 : r.estado >= 400);

// ---------- 11) sin sesión: solo se ve la configuración de la empresa ----------
const provSinSesion = (await admin('/rest/v1/proveedores', { metodo: 'POST', cuerpo: { nombre: 'Proveedor de prueba sin sesión' } })).datos?.[0]?.id;
await admin('/rest/v1/contactos', { metodo: 'POST', cuerpo: { proveedor_id: provSinSesion, nombre: 'Contacto de prueba', email: 'contacto@prueba-plantilla.com', celular: '3510000000' } });
for (const t of ['contactos', 'planilla_familias', 'proveedores', 'items', 'comisionistas', 'usuarios_perfil', 'audit_log', 'licencia', 'tasks', 'retiros']) {
  r = await http(`/rest/v1/${t}?select=*&limit=1`);
  ok(`Sin sesión no se puede leer ${t}`, r.estado >= 400 || (Array.isArray(r.datos) && r.datos.length === 0), `HTTP ${r.estado}`);
}
r = await http('/rest/v1/configuracion?select=empresa_nombre&limit=1');
ok('Sin sesión SÍ se lee el nombre de la empresa (lo necesita la pantalla de ingreso)', r.estado === 200 && r.datos?.length === 1);
r = await http('/rest/v1/proveedores', { metodo: 'POST', cuerpo: { nombre: 'No debería' } });
ok('Sin sesión no se puede escribir', r.estado >= 400);
r = await http('/rest/v1/rpc/exigir_modulo', { metodo: 'POST', cuerpo: { p_modulos: ['deposito'] } });
ok('Sin sesión no se ejecutan funciones de la base', r.estado >= 400);
const abiertas = sql(`select count(*)::int as n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype) and has_function_privilege('anon', p.oid, 'execute') and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`);
ok('Ninguna función propia se puede ejecutar sin sesión (una función nueva hay que cerrarla: ver NUEVO-MODULO.md)', /"n":\s*0\b/.test(abiertas), (abiertas.match(/"n":\s*\d+/) || [''])[0]);
const permisosAnon = sql(`select count(*)::int as n from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public' and not (table_name = 'configuracion' and privilege_type = 'SELECT')`);
ok('Sin sesión no hay permisos de tabla, salvo leer la configuración', /"n":\s*0\b/.test(permisosAnon), (permisosAnon.match(/"n":\s*\d+/) || [''])[0]);
const sinRegla = sql(`select count(*)::int as n from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity and c.relname not in ('configuracion', 'licencia', 'usuarios_perfil', 'migraciones_aplicadas') and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'requiere_usuario_activo')`);
ok('Toda tabla tiene su regla de "usuario activo" (una tabla nueva necesita la suya: ver NUEVO-MODULO.md)', /"n":\s*0\b/.test(sinRegla), (sinRegla.match(/"n":\s*\d+/) || [''])[0]);

// ---------- 12) usuarios bloqueados ----------
await admin('/rest/v1/proveedores', { metodo: 'POST', cuerpo: { nombre: 'Proveedor visible para activos' } });
r = await http('/rest/v1/proveedores?select=id&limit=1', { token: comun.token });
ok('Un usuario activo ve los proveedores', Array.isArray(r.datos) && r.datos.length > 0);
await admin(`/rest/v1/usuarios_perfil?id=eq.${comun.id}`, { metodo: 'PATCH', cuerpo: { activo: false } });
for (const t of ['proveedores', 'items', 'contactos', 'retiros', 'sectores', 'familias']) {
  r = await http(`/rest/v1/${t}?select=*&limit=1`, { token: comun.token });
  ok(`Un usuario BLOQUEADO con sesión abierta no lee ${t}`, r.estado >= 400 || (Array.isArray(r.datos) && r.datos.length === 0), `HTTP ${r.estado}`);
}
r = await http('/rest/v1/retiros', { metodo: 'POST', token: comun.token, cuerpo: { usuario_id: comun.id } });
ok('…no puede crear retiros', r.estado >= 400);
r = await http('/rest/v1/usuarios_perfil?select=email', { token: comun.token });
ok('…solo puede leer su propio perfil (la pantalla lo necesita para avisarle)', Array.isArray(r.datos) && r.datos.length === 1 && r.datos[0].email === comun.email, `${r.datos?.length} perfiles`);
r = await http('/rest/v1/rpc/create_task', { metodo: 'POST', token: comun.token, cuerpo: { p_title: 'No debería' } });
ok('…tampoco crea tareas', r.estado >= 400);
const subidaBloqueado = await fetch(`${URL}/storage/v1/object/items/prueba-bloqueado.txt`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${comun.token}`, 'Content-Type': 'text/plain' }, body: 'x' });
ok('…ni sube archivos', subidaBloqueado.status >= 400, `HTTP ${subidaBloqueado.status}`);
await admin(`/rest/v1/usuarios_perfil?id=eq.${comun.id}`, { metodo: 'PATCH', cuerpo: { activo: true } });
r = await http('/rest/v1/proveedores?select=id&limit=1', { token: comun.token });
ok('Al desbloquearlo, todo vuelve a funcionar sin volver a iniciar sesión', Array.isArray(r.datos) && r.datos.length > 0);
// el dueño sigue siendo dueño aunque otro quiera bloquearlo
r = await http(`/rest/v1/usuarios_perfil?id=eq.${dueno.id}`, { metodo: 'PATCH', token: deposito.token, cuerpo: { activo: false } });
ok('A un dueño sigue sin poder bloqueárselo', r.estado >= 400);

// ---------- 13) eliminar usuarios: solo hace falta ser dueño ----------
const aBorrar = (await admin('/auth/v1/admin/users', { metodo: 'POST', cuerpo: { email: 'borrar@prueba-plantilla.com', password: clave(), email_confirm: true } })).datos?.id;
r = await funcion('delete-user', deposito.token, { userId: aBorrar });
const perfilDeposito = await perfil(deposito.email);
ok('Un dueño con rol "usuario" en el Directorio SÍ puede eliminar usuarios (antes fallaba con "solo administradores")', r.estado === 200 && perfilDeposito?.es_owner === true && perfilDeposito?.rol === 'user', msg(r));
r = await funcion('delete-user', comun.token, { userId: deposito.id });
ok('Un usuario que no es dueño no elimina usuarios', r.estado >= 400);

// ---------- 14) zona horaria de la empresa ----------
const diaEn = zona => new Date().toLocaleDateString('sv-SE', { timeZone: zona });
const hoyBase = async () => (await http('/rest/v1/rpc/hoy_local', { metodo: 'POST', token: dueno.token, cuerpo: {} })).datos;
let hb = await hoyBase();
ok('La fecha de "hoy" de la base sigue la zona de la empresa (Argentina por defecto)', hb === diaEn('America/Argentina/Buenos_Aires'), `${hb}`);
r = await http('/rest/v1/configuracion?id=eq.1', { metodo: 'PATCH', token: dueno.token, cuerpo: { zona_horaria: 'Pacific/Kiritimati' } });
ok('El dueño puede cambiar la zona horaria', r.estado < 300);
hb = await hoyBase();
ok('Cambiarla cambia el "hoy" de la base (Kiritimati va 14 horas adelante de UTC)', hb === diaEn('Pacific/Kiritimati'), `${hb}`);
r = await http('/rest/v1/rpc/create_task', { metodo: 'POST', token: dueno.token, cuerpo: { p_title: 'Tarea de hoy en esa zona', p_description: '', p_traffic_level: 'green', p_assigned_date: hb } });
ok('Se puede crear una tarea para el "hoy" de la zona de la empresa (aunque en hora universal sea otro día)', r.estado === 200, msg(r));
r = await http('/rest/v1/rpc/create_task', { metodo: 'POST', token: dueno.token, cuerpo: { p_title: 'Ayer', p_description: '', p_traffic_level: 'green', p_assigned_date: '2020-01-01' } });
ok('Una fecha pasada se sigue rechazando', r.estado >= 400 && /anterior a hoy/.test(msg(r)), msg(r));
r = await http('/rest/v1/configuracion?id=eq.1', { metodo: 'PATCH', token: dueno.token, cuerpo: { zona_horaria: 'Marte/Olimpo' } });
ok('Una zona horaria inventada se rechaza', r.estado >= 400);
await http('/rest/v1/configuracion?id=eq.1', { metodo: 'PATCH', token: dueno.token, cuerpo: { zona_horaria: 'America/Argentina/Buenos_Aires' } });

// ---------- limpieza ----------
await admin('/rest/v1/configuracion?id=eq.1', { metodo: 'PATCH', cuerpo: configOriginal });
sql(limpieza);
const fallas = resultados.filter(x => !x).length;
console.log(`\n${resultados.length - fallas}/${resultados.length} pruebas correctas${fallas ? ` — ${fallas} FALLARON` : ''}`);
process.exit(fallas ? 1 : 0);
