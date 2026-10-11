// Cliente de la API de administración de Supabase (https://api.supabase.com).
//
// Seguridad:
//  * Solo existen las operaciones que el panel necesita (lista cerrada). NO hay "borrar proyecto", ni "pasar cualquier
//    ruta", ni cambiar de organización: aunque alguien lograra llamar a esta capa, no tiene con qué hacer más.
//  * El host está fijo y la ruta se arma solo con identificadores ya validados (nunca con texto libre).
//  * Sin redirecciones, con tiempo máximo y con tamaño máximo de respuesta.
//  * Los mensajes de error se recortan y se les quitan secretos antes de salir de acá.
import { conocerSecreto, ocultarSecretos } from './registro.ts';
import { REF } from './validar.ts';

const BASE = 'https://api.supabase.com';
const MAX_RESPUESTA = 4 * 1024 * 1024;

export class ErrorSupabase extends Error {
  readonly estado: number;
  constructor(estado: number, mensaje: string) {
    super(mensaje);
    this.estado = estado;
  }
}

export interface ProyectoApi {
  ref: string;
  nombre: string;
  estado: string;
  region: string;
  creado: string;
  /** Identificador de la organización dueña del proyecto. */
  org: string;
}

export interface Claves { anon: string; servicio: string }
export type Fila = Record<string, unknown>;

export interface SupabaseApi {
  /** Organizaciones que la llave del panel puede ver (todas, no solo las permitidas): sirve para comprobar que una organización invitó al panel. */
  listarOrganizaciones(): Promise<string[]>;
  listarProyectos(): Promise<ProyectoApi[]>;
  obtenerProyecto(ref: string): Promise<ProyectoApi | null>;
  crearProyecto(datos: { nombre: string; region: string; clave: string; org: string }): Promise<ProyectoApi>;
  consultar(ref: string, sql: string, opciones?: { soloLectura?: boolean }): Promise<Fila[]>;
  claves(ref: string): Promise<Claves>;
  fijarSecretos(ref: string, secretos: { name: string; value: string }[]): Promise<void>;
  desplegarFuncion(ref: string, slug: string, fuente: string): Promise<void>;
  configurarAuth(ref: string, cambios: { disable_signup?: boolean; site_url?: string; uri_allow_list?: string }): Promise<void>;
}

const SLUG_FUNCION = /^[a-z][a-z0-9-]{0,40}$/;

type OrgsPermitidas = string[] | (() => string[] | Promise<string[]>);

export function crearSupabaseApi(token: string, organizacionesPermitidas: OrgsPermitidas, tiempoMs: number, fetchImpl: typeof fetch = fetch): SupabaseApi {
  conocerSecreto(token);
  const permitidas = async (): Promise<string[]> => (typeof organizacionesPermitidas === 'function' ? await organizacionesPermitidas() : organizacionesPermitidas);
  async function llamar(metodo: 'GET' | 'POST' | 'PATCH', ruta: string, opciones: { json?: unknown; formulario?: FormData } = {}): Promise<unknown> {
    if (!ruta.startsWith('/v1/') || ruta.includes('..') || ruta.includes('//') || ruta.includes('\\')) throw new Error('Ruta de API no permitida');
    const encabezados: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json' };
    let cuerpo: BodyInit | undefined;
    if (opciones.json !== undefined) { encabezados['content-type'] = 'application/json'; cuerpo = JSON.stringify(opciones.json); }
    else if (opciones.formulario) cuerpo = opciones.formulario;
    let r: Response;
    try {
      r = await fetchImpl(BASE + ruta, { method: metodo, headers: encabezados, body: cuerpo, redirect: 'error', signal: AbortSignal.timeout(tiempoMs) });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new ErrorSupabase(timeout ? 408 : 0, timeout ? 'Supabase tardó demasiado en responder.' : 'No se pudo conectar con Supabase.');
    }
    const texto = (await r.text()).slice(0, MAX_RESPUESTA);
    let datos: unknown = null;
    try { datos = texto ? JSON.parse(texto) : null; } catch { datos = null; }
    if (!r.ok) {
      const crudo = datos && typeof datos === 'object' && 'message' in datos ? String((datos as { message: unknown }).message) : '';
      throw new ErrorSupabase(r.status, ocultarSecretos(crudo).slice(0, 200) || `Supabase respondió ${r.status}.`);
    }
    return datos;
  }

  const refOk = (ref: string): string => {
    if (!REF.test(ref)) throw new Error('Identificador de proyecto inválido');
    return ref;
  };

  const aProyecto = (p: Record<string, unknown>): ProyectoApi => ({
    ref: String(p.ref ?? p.id ?? ''),
    nombre: String(p.name ?? ''),
    estado: String(p.status ?? ''),
    region: String(p.region ?? ''),
    creado: String(p.created_at ?? ''),
    org: String(p.organization_slug ?? ''),
  });

  const api: SupabaseApi = {
    async listarOrganizaciones() {
      const datos = await llamar('GET', '/v1/organizations');
      if (!Array.isArray(datos)) throw new ErrorSupabase(502, 'Respuesta inesperada de Supabase.');
      return datos.map(o => String((o as Record<string, unknown>).slug ?? (o as Record<string, unknown>).id ?? '')).filter(s => /^[a-z0-9]{10,40}$/.test(s));
    },
    async listarProyectos() {
      const organizaciones = await permitidas();
      const datos = await llamar('GET', '/v1/projects');
      if (!Array.isArray(datos)) throw new ErrorSupabase(502, 'Respuesta inesperada de Supabase.');
      // Solo los de la organización de los clientes (aunque el token alcanzara más, el panel no los ve).
      return datos
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && organizaciones.includes(String((p as Record<string, unknown>).organization_slug ?? '')))
        .map(aProyecto)
        .filter(p => REF.test(p.ref));
    },
    async obtenerProyecto(ref) {
      const lista = await api.listarProyectos();
      return lista.find(p => p.ref === refOk(ref)) ?? null;
    },
    async crearProyecto({ nombre, region, clave, org }) {
      if (!(await permitidas()).includes(org)) throw new Error('Organización no permitida');
      const datos = await llamar('POST', '/v1/projects', {
        json: { name: nombre, organization_slug: org, db_pass: clave, region_selection: { type: 'specific', code: region } },
      });
      const p = aProyecto((datos ?? {}) as Record<string, unknown>);
      if (!REF.test(p.ref)) throw new ErrorSupabase(502, 'Supabase no devolvió el identificador del proyecto.');
      return p;
    },
    async consultar(ref, sql, opciones = {}) {
      const datos = await llamar('POST', `/v1/projects/${refOk(ref)}/database/query`, { json: { query: sql, read_only: opciones.soloLectura === true } });
      return Array.isArray(datos) ? (datos as Fila[]) : [];
    },
    async claves(ref) {
      const datos = await llamar('GET', `/v1/projects/${refOk(ref)}/api-keys?reveal=true`);
      const lista = (Array.isArray(datos) ? datos : []) as Record<string, unknown>[];
      const clave = (re: RegExp, prefijo: RegExp) => {
        const k = lista.find(x => re.test(String(x.name ?? '')) && typeof x.api_key === 'string')
          ?? lista.find(x => prefijo.test(String(x.api_key ?? '')));
        return typeof k?.api_key === 'string' ? k.api_key : '';
      };
      const anon = clave(/^anon$/i, /^sb_publishable_/);
      const servicio = clave(/^service_role$/i, /^sb_secret_/);
      conocerSecreto(anon); conocerSecreto(servicio);
      if (!anon || !servicio) throw new ErrorSupabase(502, 'No pude leer las claves del proyecto.');
      return { anon, servicio };
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
    async configurarAuth(ref, cambios) {
      await llamar('PATCH', `/v1/projects/${refOk(ref)}/config/auth`, { json: cambios });
    },
  };
  return api;
}
