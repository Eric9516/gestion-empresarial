// Herramientas comunes de las pruebas grandes (permisos, módulos, lógica, horarios).
//
// Dos modos:
//  · LOCAL (por defecto): al importarlo se levanta un servidor, se arma un proyecto con los tres componentes y se siembra lo mínimo
//    que esas pruebas esperan. Al terminar hay que llamar a `terminar()`.
//  · REAL: con PROYECTO_REAL=clientes/<cliente>.env.local (y SUPABASE_ACCESS_TOKEN) las mismas pruebas corren contra un proyecto
//    de Supabase DE PRUEBAS de verdad. No se levanta nada; el SQL directo va por la API de administración. Se niega a correr si el
//    proyecto tiene datos que no son de prueba (usuarios reales).
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archivosDeComponentes, publicarFunciones } from './preparar.mjs';
import { iniciarServidor } from './servidor.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const REAL = process.env.PROYECTO_REAL ? String(process.env.PROYECTO_REAL) : null;
const leerEnv = (ruta) => Object.fromEntries(readFileSync(ruta, 'utf8').split('\n').filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const cfg = REAL ? leerEnv(join(RAIZ, REAL)) : null;
if (REAL && (!cfg.VITE_SUPABASE_URL || !cfg.VITE_SUPABASE_ANON_KEY || !cfg.SUPABASE_SECRET_KEY || !cfg.SUPABASE_PROJECT_REF || !process.env.SUPABASE_ACCESS_TOKEN)) {
  console.error('Modo REAL: faltan datos en el archivo del cliente o SUPABASE_ACCESS_TOKEN.'); process.exit(1);
}

export const servidor = REAL ? { cerrar: async () => {} } : await iniciarServidor();
export const proyecto = REAL ? null : await servidor.crearProyecto({ nombre: 'ensayo-local', archivos: archivosDeComponentes(process.env.COMPONENTES_LOCAL ? process.env.COMPONENTES_LOCAL.split(',') : undefined) });
if (!REAL) { publicarFunciones(proyecto); proyecto.secretos.set('PROJECT_SECRET_KEY', proyecto.claveServicio); }

export const BASE = REAL ? cfg.VITE_SUPABASE_URL : servidor.urlDe(proyecto);
export const ANON = REAL ? cfg.VITE_SUPABASE_ANON_KEY : proyecto.claveAnon;
export const SERVICIO = REAL ? cfg.SUPABASE_SECRET_KEY : proyecto.claveServicio;
export const CLAVE = 'ClaveDePrueba-9!zz';
export const ENSAYO = REAL ? cfg.SUPABASE_PROJECT_REF : proyecto.ref;
export const CREMAC = 'no-aplica';
export { randomUUID };

// Un proveedor de correo real rechaza dominios inventados (.invalid, .test): en modo REAL se usa uno aceptado.
export const correo = (email) => (REAL ? email.replace(/@ensayo(-local)?\.(invalid|test)$/, '@prueba-plantilla.com') : email);

export async function http(metodo, ruta, { token, cuerpo, base = BASE, cab = {}, crudo = false, apikey } = {}) {
  const headers = { apikey: apikey ?? ANON, Authorization: `Bearer ${token ?? ANON}`, Prefer: 'return=representation', ...cab };
  if (cuerpo !== undefined && !crudo) headers['Content-Type'] = 'application/json';
  // Contra el servicio real puede haber cortes de red o límites de velocidad: se reintenta unas veces antes de dar por perdido el pedido.
  for (let intento = 0; ; intento++) {
    try {
      const r = await fetch(base + ruta, { method: metodo, headers, body: cuerpo === undefined ? undefined : (crudo ? cuerpo : JSON.stringify(cuerpo)) });
      if (REAL && (r.status === 429 || r.status === 502 || r.status === 503 || r.status === 504) && intento < 6) { await new Promise((x) => setTimeout(x, 800 * (intento + 1))); continue; }
      const txt = await r.text();
      let d = null; try { d = txt ? JSON.parse(txt) : null; } catch { d = txt; }
      return { s: r.status, d };
    } catch (e) {
      if (!REAL || intento >= 6) throw e;
      await new Promise((x) => setTimeout(x, 800 * (intento + 1)));
    }
  }
}
export const sv = (m, ruta, cuerpo, cab) => http(m, ruta, { token: SERVICIO, apikey: SERVICIO, cuerpo, cab });
// Qué componentes tiene instalados el cliente (un Plan 1 no tiene Mantenimiento: sus tablas y funciones no existen, y las pruebas lo tienen en cuenta).
export const COMPONENTES = (await sv('GET', '/rest/v1/licencia?select=componentes')).d?.[0]?.componentes ?? ['base'];
export const SIN_MANT = !COMPONENTES.includes('mantenimiento');
export const msg = (r) => (r.d && (r.d.message || r.d.error || r.d.msg)) ? String(r.d.message || r.d.error || r.d.msg) : (typeof r.d === 'string' ? r.d : '');
export const hecho = (r) => r.s >= 200 && r.s < 300 && (!Array.isArray(r.d) || r.d.length > 0);

export async function crearUsuario(email, extra = {}) {
  email = correo(email);
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
  email = correo(email);
  // El ingreso real tiene límite de velocidad por origen: se reintenta con espera.
  for (let intento = 0; intento < 8; intento++) {
    const r = await http('POST', '/auth/v1/token?grant_type=password', { cuerpo: { email, password: CLAVE } });
    if (r.s === 200) return r.d.access_token;
    if (!REAL || (r.s !== 429 && r.s !== 400)) break;
    await new Promise((x) => setTimeout(x, 1500 * (intento + 1)));
  }
  throw new Error('No pude entrar como ' + email);
}
// El "hoy" de la empresa (Argentina), igual que usa la base.
export const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });

/** SQL directo sobre la base del proyecto (como `supabase db query`). Devuelve las filas del último SELECT. */
export async function q(_ref, sql) {
  if (REAL) {
    for (let intento = 0; ; intento++) {
      const r = await fetch(`https://api.supabase.com/v1/projects/${cfg.SUPABASE_PROJECT_REF}/database/query`, {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }),
      });
      if (r.status === 429 && intento < 8) { await new Promise((x) => setTimeout(x, 2000 * (intento + 1))); continue; }
      const t = await r.text();
      if (r.status >= 300) throw new Error(`SQL real falló (${r.status}): ${t.slice(0, 300)}`);
      const d = JSON.parse(t); return Array.isArray(d) ? d : [];
    }
  }
  const resultados = await proyecto.serializar(() => proyecto.db.exec(sql));
  proyecto.invalidarEsquema();
  const ultimo = [...resultados].reverse().find((x) => x.fields?.length);
  return ultimo ? ultimo.rows : [];
}

/** Borra los datos de prueba (ZZ-…) que haya dejado una corrida interrumpida o que no pudo limpiar por un corte; así la siguiente no choca con ellos. */
export async function limpiarRestos() {
  await q(null, readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'limpieza-zz.sql'), 'utf8'));
}

// ---- lo que las pruebas esperan encontrar ya cargado (en el ensayo salía de una copia de datos reales) ----
if (REAL) {
  // Un proyecto real: solo se corre si no hay usuarios que no sean de prueba.
  const reales = await q(null, `select count(*)::int as n from public.usuarios_perfil where email is not null and email not like '%@prueba-plantilla.com' and email not like '%@example.com' and email not like '%@ensayo%'`);
  if (Number(reales[0]?.n ?? 0) > 0) { console.error('Este proyecto tiene usuarios que no son de prueba: no se corre nada.'); process.exit(1); }
}
const dueno = await crearUsuario('dueno@ensayo-local.test', { es_owner: true, rol: 'admin', mantenimiento_rol: 'admin' });
// get-or-create: en el modo REAL el proyecto puede traer lo sembrado por una corrida anterior.
const unico = async (tabla, filtro, cuerpo) => {
  const hay = await sv('GET', `/rest/v1/${tabla}?select=id&${filtro}&limit=1`);
  if (hay.s === 200 && hay.d?.length) return hay.d[0].id;
  return (await sv('POST', `/rest/v1/${tabla}`, cuerpo)).d?.[0]?.id;
};
const fam = await unico('familias', 'codigo=eq.AA', { codigo: 'AA', nombre: 'Familia base' });
if (!(await sv('GET', '/rest/v1/subfamilias?select=id&limit=1')).d?.length) await sv('POST', '/rest/v1/subfamilias', { familia_id: fam, codigo: 'AA', nombre: 'Subfamilia base' });
const provBase = await unico('proveedores', 'nombre=eq.Proveedor%20base', { nombre: 'Proveedor base' });
if (!(await sv('GET', '/rest/v1/rotulos_generados?select=id&limit=1')).d?.length) await sv('POST', '/rest/v1/rotulos_generados', { proveedor_id: provBase, grupo_id: randomUUID(), numero_documento: 'base' });
await unico('sectores', 'nombre=eq.Sector%20base', { nombre: 'Sector base' });
if (!(await sv('GET', '/rest/v1/planilla_familias?select=id&limit=1')).d?.length) await sv('POST', '/rest/v1/planilla_familias', { id: true, storage_path: 'base/planilla.xlsx', nombre_archivo: 'planilla.xlsx' });
await unico('rotulo_disenos', 'nombre=eq.Dise%C3%B1o%20base', { nombre: 'Diseño base', design: {} });
export { dueno };

export async function terminar(codigo = 0) { await servidor.cerrar(); process.exit(codigo); }
