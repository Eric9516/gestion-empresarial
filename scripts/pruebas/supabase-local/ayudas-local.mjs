// Herramientas comunes de las pruebas grandes (permisos, módulos, lógica) contra el Supabase local.
// Al importarlo se levanta un servidor, se arma un proyecto con los tres componentes y se siembra lo mínimo que esas pruebas esperan
// (un dueño, una familia, un proveedor, un sector, una planilla y un diseño de rótulo). Al terminar hay que llamar a `terminar()`.
import { randomUUID } from 'node:crypto';
import { archivosDeComponentes, publicarFunciones } from './preparar.mjs';
import { iniciarServidor } from './servidor.mjs';

export const servidor = await iniciarServidor();
export const proyecto = await servidor.crearProyecto({ nombre: 'ensayo-local', archivos: archivosDeComponentes() });
publicarFunciones(proyecto);
proyecto.secretos.set('PROJECT_SECRET_KEY', proyecto.claveServicio);

export const BASE = servidor.urlDe(proyecto);
export const ANON = proyecto.claveAnon;
export const SERVICIO = proyecto.claveServicio;
export const CLAVE = 'ClaveDePrueba-9!zz';
export const ENSAYO = proyecto.ref;
export const CREMAC = 'no-aplica';
export { randomUUID };

export async function http(metodo, ruta, { token, cuerpo, base = BASE, cab = {}, crudo = false, apikey } = {}) {
  const headers = { apikey: apikey ?? ANON, Authorization: `Bearer ${token ?? ANON}`, Prefer: 'return=representation', ...cab };
  if (cuerpo !== undefined && !crudo) headers['Content-Type'] = 'application/json';
  const r = await fetch(base + ruta, { method: metodo, headers, body: cuerpo === undefined ? undefined : (crudo ? cuerpo : JSON.stringify(cuerpo)) });
  const txt = await r.text();
  let d = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
  return { s: r.status, d };
}
export const sv = (m, ruta, cuerpo, cab) => http(m, ruta, { token: SERVICIO, apikey: SERVICIO, cuerpo, cab });
export const msg = (r) => (r.d && (r.d.message || r.d.error || r.d.msg)) ? String(r.d.message || r.d.error || r.d.msg) : (typeof r.d === 'string' ? r.d : '');
export const hecho = (r) => r.s >= 200 && r.s < 300 && (!Array.isArray(r.d) || r.d.length > 0);

export async function crearUsuario(email, extra = {}) {
  const r = await http('POST', '/auth/v1/admin/users', { token: SERVICIO, apikey: SERVICIO, cuerpo: { email, password: CLAVE, email_confirm: true } });
  let id = r.d?.id;
  if (!id) {
    const l = await http('GET', '/auth/v1/admin/users?per_page=1000', { token: SERVICIO, apikey: SERVICIO });
    id = l.d.users.find((u) => u.email.toLowerCase() === email.toLowerCase())?.id;
  }
  if (!id) throw new Error('No se pudo crear ' + email + ': ' + JSON.stringify(r.d));
  await sv('POST', '/rest/v1/usuarios_perfil?on_conflict=id', { id, email, nombre: 'ZZ ' + email.split('@')[0], apellido: '', rol: 'user', activo: true, ...extra }, { Prefer: 'resolution=merge-duplicates,return=representation' });
  return id;
}
export async function entrar(email) {
  const r = await http('POST', '/auth/v1/token?grant_type=password', { cuerpo: { email, password: CLAVE } });
  if (r.s === 200) return r.d.access_token;
  throw new Error('No pude entrar como ' + email);
}
// El "hoy" de la empresa (Argentina), igual que usa la base.
export const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });

/** SQL directo sobre la base del proyecto (como `supabase db query`). Devuelve las filas del último SELECT. */
export async function q(_ref, sql) {
  const resultados = await proyecto.serializar(() => proyecto.db.exec(sql));
  proyecto.invalidarEsquema();
  const ultimo = [...resultados].reverse().find((x) => x.fields?.length);
  return ultimo ? ultimo.rows : [];
}

// ---- lo que las pruebas esperan encontrar ya cargado (en el ensayo salía de una copia de datos reales) ----
const dueno = await crearUsuario('dueno@ensayo-local.test', { es_owner: true, rol: 'admin', mantenimiento_rol: 'admin' });
const fam = (await sv('POST', '/rest/v1/familias', { codigo: 'AA', nombre: 'Familia base' })).d[0].id;
await sv('POST', '/rest/v1/subfamilias', { familia_id: fam, codigo: 'AA', nombre: 'Subfamilia base' });
const provBase = (await sv('POST', '/rest/v1/proveedores', { nombre: 'Proveedor base' })).d[0].id;
await sv('POST', '/rest/v1/rotulos_generados', { proveedor_id: provBase, grupo_id: randomUUID(), numero_documento: 'base' });
await sv('POST', '/rest/v1/sectores', { nombre: 'Sector base' });
await sv('POST', '/rest/v1/planilla_familias', { id: true, storage_path: 'base/planilla.xlsx', nombre_archivo: 'planilla.xlsx' });
await sv('POST', '/rest/v1/rotulo_disenos', { nombre: 'Diseño base', design: {} });
export { dueno };

export async function terminar(codigo = 0) { await servidor.cerrar(); process.exit(codigo); }
