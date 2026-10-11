// Supabase "de mentira": responde como la API de administración y como los proyectos de clientes, y REGISTRA cada
// llamada. Sirve para comprobar dos cosas: que el panel hace lo que debe, y que NUNCA llama a nada fuera de su lista.
import { randomBytes } from 'node:crypto';
import { MIGRACIONES, MODULOS } from '../../src/server/generado.ts';

export const TOKEN = 'sbp_' + 'a'.repeat(40);
export const ORG = 'orgprueba1234';
export const ORG2 = 'orgcliente5678';
const PERMITIDAS = [ORG, ORG2];

export interface ProyectoFalso {
  ref: string; nombre: string; org: string; creadoMs: number; sondeos: number; estado: string;
  registro: Set<string> | null; tablas: number; secretos: Map<string, string>; funciones: Map<string, string>;
  auth: { disable_signup: boolean; site_url?: string; uri_allow_list?: string };
  licencia: Record<string, boolean>; usuarios: Map<string, string>; dueno: string | null; empresa: string | null;
  claves: { anon: string; servicio: string };
}

export interface Llamada { host: string; metodo: string; ruta: string; cuerpo?: unknown }

const json = (estado: number, cuerpo: unknown): Response => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } });
const refAleatorio = () => Array.from(randomBytes(20), b => 'abcdefghijklmnopqrstuvwxyz'[b % 26]).join('');

export function crearSupabaseFalso(opciones: { sondeosParaListo?: number } = {}) {
  const proyectos = new Map<string, ProyectoFalso>();
  // Organizaciones que la llave del panel "ve" (las que invitaron a la cuenta del panel).
  const orgsVisibles = new Set<string>([ORG, ORG2]);
  const llamadas: Llamada[] = [];
  const sqlInesperado: string[] = [];
  const sqlEjecutado: { ref: string; sql: string; soloLectura: boolean }[] = [];
  const hooks: { antes?: (l: Llamada) => Response | undefined | Promise<Response | undefined> } = {};
  const sondeosParaListo = opciones.sondeosParaListo ?? 1;

  function nuevoProyecto(nombre: string, org: string, estado = 'ACTIVE_HEALTHY'): ProyectoFalso {
    const p: ProyectoFalso = {
      ref: refAleatorio(), nombre, org, creadoMs: Date.now(), sondeos: 0, estado,
      registro: null, tablas: 0, secretos: new Map(), funciones: new Map(),
      auth: { disable_signup: false }, licencia: {}, usuarios: new Map(), dueno: null, empresa: null,
      claves: { anon: 'eyJ' + randomBytes(24).toString('base64url') + '.anon.firma1234', servicio: 'eyJ' + randomBytes(24).toString('base64url') + '.service.firma1234' },
    };
    proyectos.set(p.ref, p);
    return p;
  }

  // Un proyecto ya instalado por el panel: con todas las migraciones y la licencia puesta.
  function proyectoInstalado(nombre: string, modulos: string[] = [], componentes: readonly string[] = ['base', 'abastecimiento', 'mantenimiento']): ProyectoFalso {
    const p = nuevoProyecto(nombre, ORG);
    p.registro = new Set(MIGRACIONES.filter(m => componentes.includes(m.componente)).map(m => m.nombre));
    p.tablas = 20;
    p.licencia = Object.fromEntries(MODULOS.map(m => [m.id, modulos.includes(m.id)]));
    p.auth.disable_signup = true;
    return p;
  }

  function consulta(p: ProyectoFalso, sql: string, soloLectura: boolean): Response {
    sqlEjecutado.push({ ref: p.ref, sql, soloLectura });
    const compacto = sql.trim().replace(/\s+/g, ' ');
    const esSelect = /^select /i.test(compacto);
    if (soloLectura && !esSelect) return json(400, { message: 'cannot execute in a read-only transaction' });
    if (compacto === 'select 1 as ok') return json(201, [{ ok: 1 }]);
    if (compacto === "select to_regclass('public.migraciones_aplicadas') is not null as hay") return json(201, [{ hay: p.registro !== null }]);
    if (compacto === "select count(*)::int as n from pg_tables where schemaname = 'public'") return json(201, [{ n: p.tablas }]);
    if (compacto === 'select nombre from public.migraciones_aplicadas') {
      if (!p.registro) return json(400, { message: 'relation "public.migraciones_aplicadas" does not exist' });
      return json(201, [...p.registro].map(nombre => ({ nombre })));
    }
    const hecha = compacto.match(/^select 1 as ok from public\.migraciones_aplicadas where nombre in \('((?:base|abastecimiento|mantenimiento)\/[0-9]{14}_[a-z0-9_]+\.sql)', '([0-9]{14}_[a-z0-9_]+\.sql)'\)$/);
    if (hecha) return json(201, p.registro?.has(hecha[1]!) || p.registro?.has(hecha[2]!) ? [{ ok: 1 }] : []);
    if (/^create table if not exists public\.migraciones_aplicadas/.test(compacto)) { p.registro ??= new Set(); return json(201, []); }
    const alta = compacto.match(/insert into public\.migraciones_aplicadas \(nombre\) values \('((?:base|abastecimiento|mantenimiento)\/[0-9]{14}_[a-z0-9_]+\.sql)'\) on conflict do nothing;$/);
    if (alta) {
      const m = MIGRACIONES.find(x => x.nombre === alta[1]);
      if (!m || !sql.startsWith(m.sql) || !p.registro) { sqlInesperado.push(compacto.slice(0, 200)); return json(400, { message: 'migración no reconocida' }); }
      p.registro.add(m.nombre); p.tablas = 20;
      return json(201, []);
    }
    sqlInesperado.push(compacto.slice(0, 200));
    return json(400, { message: 'consulta no reconocida por el simulador' });
  }

  async function manejarApi(req: Request, url: URL): Promise<Response> {
    if (req.headers.get('authorization') !== `Bearer ${TOKEN}`) return json(401, { message: 'Unauthorized' });
    const ruta = url.pathname;
    const metodo = req.method;
    if (metodo === 'GET' && ruta === '/v1/organizations') return json(200, [...orgsVisibles].map(s => ({ id: s, slug: s, name: `Org ${s}` })));
    if (metodo === 'GET' && ruta === '/v1/projects') {
      for (const p of proyectos.values()) if (p.estado === 'COMING_UP' && ++p.sondeos >= sondeosParaListo) p.estado = 'ACTIVE_HEALTHY';
      return json(200, [...proyectos.values()].map(p => ({ id: p.ref, ref: p.ref, name: p.nombre, organization_slug: p.org, status: p.estado, region: 'sa-east-1', created_at: new Date(p.creadoMs).toISOString() })));
    }
    if (metodo === 'POST' && ruta === '/v1/projects') {
      const b = (await req.json()) as { name: string; organization_slug: string; db_pass: string; region_selection?: { code?: string } };
      if (!PERMITIDAS.includes(b.organization_slug) || !b.db_pass || b.db_pass.length < 16) return json(400, { message: 'datos inválidos' });
      const p = nuevoProyecto(b.name, b.organization_slug, 'COMING_UP');
      return json(201, { id: p.ref, ref: p.ref, name: p.nombre, organization_slug: b.organization_slug, status: 'COMING_UP', region: b.region_selection?.code ?? 'sa-east-1', created_at: new Date(p.creadoMs).toISOString() });
    }
    const m = ruta.match(/^\/v1\/projects\/([a-z]{20})\/(.+)$/);
    const p = m ? proyectos.get(m[1]!) : undefined;
    if (!m || !p || !PERMITIDAS.includes(p.org)) return json(404, { message: 'Project not found' });
    const resto = m[2]!;
    if (metodo === 'GET' && resto === 'api-keys') {
      if (url.searchParams.get('reveal') !== 'true') return json(200, [{ name: 'anon', api_key: 'oculta' }, { name: 'service_role', api_key: 'oculta' }]);
      return json(200, [{ name: 'anon', type: 'legacy', api_key: p.claves.anon }, { name: 'service_role', type: 'legacy', api_key: p.claves.servicio }]);
    }
    if (metodo === 'POST' && resto === 'secrets') {
      const lista = (await req.json()) as { name: string; value: string }[];
      for (const s of lista) p.secretos.set(s.name, s.value);
      return json(201, {});
    }
    if (metodo === 'POST' && resto === 'functions/deploy') {
      const f = await req.formData();
      const meta = JSON.parse(String(f.get('metadata'))) as { name: string; entrypoint_path: string };
      const archivo = f.get('file') as File;
      p.funciones.set(url.searchParams.get('slug') ?? meta.name, await archivo.text());
      return json(201, { slug: meta.name });
    }
    if (metodo === 'PATCH' && resto === 'config/auth') {
      Object.assign(p.auth, await req.json());
      return json(200, {});
    }
    if (metodo === 'POST' && resto === 'database/query') {
      const b = (await req.json()) as { query: string; read_only?: boolean };
      return consulta(p, b.query, b.read_only === true);
    }
    return json(404, { message: 'Not found' });
  }

  async function manejarProyecto(req: Request, url: URL, p: ProyectoFalso): Promise<Response> {
    const apikey = req.headers.get('apikey');
    const ruta = url.pathname + url.search;
    if (req.method === 'GET' && url.pathname === '/auth/v1/settings') return json(200, { disable_signup: p.auth.disable_signup });
    if (apikey !== p.claves.servicio) return json(401, { message: 'Invalid API key' });
    if (req.method === 'POST' && url.pathname === '/auth/v1/admin/users') {
      const b = (await req.json()) as { email: string; password: string };
      if (p.usuarios.has(b.email)) return json(422, { error_code: 'email_exists', message: 'exists' });
      p.usuarios.set(b.email, b.password);
      return json(200, { id: 'u1', email: b.email });
    }
    if (req.method === 'POST' && url.pathname === '/rest/v1/rpc/definir_dueno_inicial') {
      const b = (await req.json()) as { p_email: string };
      if (p.dueno) return json(400, { message: 'La instalación ya tiene un dueño' });
      p.dueno = b.p_email;
      return json(200, null);
    }
    if (req.method === 'PATCH' && ruta === '/rest/v1/configuracion?id=eq.1') {
      p.empresa = ((await req.json()) as { empresa_nombre: string }).empresa_nombre;
      return json(200, [{ id: 1 }]);
    }
    if (req.method === 'GET' && ruta === '/rest/v1/licencia?select=modulos&id=eq.1') return json(200, [{ modulos: p.licencia }]);
    if (req.method === 'PATCH' && ruta === '/rest/v1/licencia?id=eq.1') {
      p.licencia = ((await req.json()) as { modulos: Record<string, boolean> }).modulos;
      return json(200, [{ id: 1 }]);
    }
    return json(404, { message: 'Not found' });
  }

  const fetchFalso: typeof fetch = async (entrada, init) => {
    const req = new Request(entrada as Request | string, init);
    const url = new URL(req.url);
    const cuerpoCrudo = ['POST', 'PATCH'].includes(req.method) && !(req.headers.get('content-type') ?? '').startsWith('multipart') ? await req.clone().text() : undefined;
    let cuerpo: unknown; try { cuerpo = cuerpoCrudo ? JSON.parse(cuerpoCrudo) : undefined; } catch { cuerpo = cuerpoCrudo; }
    const llamada: Llamada = { host: url.host, metodo: req.method, ruta: url.pathname + url.search, cuerpo };
    llamadas.push(llamada);
    const forzada = await hooks.antes?.(llamada);
    if (forzada) return forzada;
    if (url.host === 'api.supabase.com') return manejarApi(req, url);
    const m = url.host.match(/^([a-z]{20})\.supabase\.co$/);
    const p = m ? proyectos.get(m[1]!) : undefined;
    if (p) return manejarProyecto(req, url, p);
    return json(404, { message: 'host desconocido' });
  };

  return { fetch: fetchFalso, orgsVisibles, proyectos, llamadas, sqlInesperado, sqlEjecutado, hooks, nuevoProyecto, proyectoInstalado };
}
