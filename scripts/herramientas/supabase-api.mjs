// Habla directo con la API de administración de Supabase (https://api.supabase.com), sin la CLI `supabase`.
// La CLI abre su propia interfaz en una consola de Windows y puede quedarse esperando; la API responde siempre igual.
// Lo usa scripts/cliente.mjs. Es la misma idea que panel/src/server/supabaseApi.ts (el panel del servidor).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://api.supabase.com';
const REF = /^[a-z0-9]{20}$/;
const SLUG_FUNCION = /^[a-z][a-z0-9-]{0,40}$/;

/** Error de la API con un mensaje que se puede mostrar tal cual (sin la llave). */
export class ErrorApi extends Error {
  constructor(estado, mensaje) { super(mensaje); this.estado = estado; }
}

/**
 * La llave de la cuenta de Supabase: de la variable SUPABASE_ACCESS_TOKEN o del archivo clientes/cuenta-supabase.env.local
 * (ese archivo es privado: Git lo ignora). Devuelve null si no hay ninguna.
 */
export function leerLlave(raiz, env = process.env) {
  const deEntorno = String(env.SUPABASE_ACCESS_TOKEN ?? '').trim();
  if (deEntorno) return deEntorno;
  const archivo = join(raiz, 'clientes', 'cuenta-supabase.env.local');
  if (!existsSync(archivo)) return null;
  const linea = readFileSync(archivo, 'utf8').split(/\r?\n/).find(l => /^\s*SUPABASE_ACCESS_TOKEN\s*=/.test(l));
  const valor = linea ? linea.slice(linea.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') : '';
  return valor || null;
}

export function crearApi(llave, { fetchImpl = fetch, tiempoMs = 120_000 } = {}) {
  const ocultar = t => String(t ?? '').split(llave).join('***');

  async function llamar(metodo, ruta, { json, formulario } = {}) {
    if (!ruta.startsWith('/v1/') || ruta.includes('..')) throw new Error('Ruta de API no permitida');
    const cab = { authorization: `Bearer ${llave}`, accept: 'application/json' };
    let cuerpo;
    if (json !== undefined) { cab['content-type'] = 'application/json'; cuerpo = JSON.stringify(json); }
    else if (formulario) cuerpo = formulario;
    let r;
    try { r = await fetchImpl(BASE + ruta, { method: metodo, headers: cab, body: cuerpo, signal: AbortSignal.timeout(tiempoMs) }); }
    catch (e) {
      const demora = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new ErrorApi(demora ? 408 : 0, demora ? 'Supabase tardó demasiado en responder.' : 'No se pudo conectar con Supabase. Revisá tu conexión a internet.');
    }
    const texto = await r.text();
    let datos = null;
    try { datos = texto ? JSON.parse(texto) : null; } catch { datos = null; }
    if (!r.ok) {
      const crudo = datos && typeof datos === 'object' && 'message' in datos ? String(datos.message) : '';
      const ayuda = r.status === 401 ? ' La llave de Supabase no sirve (venció, está mal copiada o se revocó): generá una nueva en https://supabase.com/dashboard/account/tokens.' : '';
      throw new ErrorApi(r.status, (ocultar(crudo).slice(0, 300) || `Supabase respondió ${r.status}.`) + ayuda);
    }
    return datos;
  }

  const refOk = ref => { if (!REF.test(ref)) throw new Error(`Identificador de proyecto inválido: ${ref}`); return ref; };
  const aProyecto = p => ({ ref: String(p.ref ?? p.id ?? ''), nombre: String(p.name ?? ''), estado: String(p.status ?? ''), region: String(p.region ?? ''), org: String(p.organization_slug ?? p.organization_id ?? '') });

  return {
    async organizaciones() {
      const d = await llamar('GET', '/v1/organizations');
      return (Array.isArray(d) ? d : []).map(o => ({ id: String(o.slug ?? o.id ?? ''), nombre: String(o.name ?? '') }));
    },
    async proyectos() {
      const d = await llamar('GET', '/v1/projects');
      return (Array.isArray(d) ? d : []).map(aProyecto);
    },
    async crearProyecto({ nombre, region, clave, org }) {
      const d = await llamar('POST', '/v1/projects', { json: { name: nombre, organization_slug: org, db_pass: clave, region_selection: { type: 'specific', code: region } } });
      return aProyecto(d ?? {});
    },
    /** Ejecuta SQL (puede traer varias instrucciones). Devuelve las filas de la última consulta. */
    async consultar(ref, sql) {
      const d = await llamar('POST', `/v1/projects/${refOk(ref)}/database/query`, { json: { query: sql } });
      return Array.isArray(d) ? d : [];
    },
    async claves(ref) {
      const d = await llamar('GET', `/v1/projects/${refOk(ref)}/api-keys?reveal=true`);
      const lista = Array.isArray(d) ? d : [];
      const buscar = (nombre, prefijo) => lista.find(k => nombre.test(String(k.name ?? '')) && typeof k.api_key === 'string')?.api_key
        ?? lista.find(k => prefijo.test(String(k.api_key ?? '')))?.api_key ?? '';
      return { anon: buscar(/^anon$/i, /^sb_publishable_/), servicio: buscar(/^service_role$/i, /^sb_secret_/) };
    },
    async fijarSecretos(ref, secretos) {
      for (const s of secretos) if (!/^[A-Z][A-Z0-9_]{0,60}$/.test(s.name)) throw new Error('Nombre de secreto inválido');
      await llamar('POST', `/v1/projects/${refOk(ref)}/secrets`, { json: secretos });
    },
    async desplegarFuncion(ref, slug, fuente) {
      if (!SLUG_FUNCION.test(slug)) throw new Error('Nombre de función inválido');
      const f = new FormData();
      f.append('metadata', JSON.stringify({ entrypoint_path: 'index.ts', name: slug, verify_jwt: true }));
      f.append('file', new Blob([fuente], { type: 'application/typescript' }), 'index.ts');
      await llamar('POST', `/v1/projects/${refOk(ref)}/functions/deploy?slug=${slug}`, { formulario: f });
    },
  };
}
