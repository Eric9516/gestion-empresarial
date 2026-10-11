// Arma "el mundo" de una prueba: servidor del panel + base real + Supabase falso + navegador simulado.
import { randomBytes } from 'node:crypto';
import type { Config } from '../../src/server/config.ts';
import { crearManejador } from '../../src/server/manejador.ts';
import { crearPermitidas } from '../../src/server/organizaciones.ts';
import { crearSupabaseApi } from '../../src/server/supabaseApi.ts';
import { Autenticador } from './autenticador.ts';
import { crearBase, type BaseDePrueba } from './bd.ts';
import { crearSupabaseFalso, ORG, TOKEN } from './supabaseFalso.ts';

export const ORIGEN = 'https://panel.test';
export const USUARIO_RED = 'eric@ejemplo.com';
export const CODIGO_ALTA = 'codigo-de-alta-'.padEnd(40, 'x');

export function configDePrueba(sobre: Partial<Config> = {}): Config {
  return {
    origen: ORIGEN, rpId: 'panel.test', rpNombre: 'Panel de clientes', secreto: 'secreto-de-pruebas-'.padEnd(48, 's'),
    codigoAlta: CODIGO_ALTA, tokenSupabase: TOKEN, organizaciones: [ORG], dbUrl: 'postgres://panel_app:clave@127.0.0.1:5432/panel',
    alertaUrl: 'https://alertas.test/tema', encabezadoIp: 'x-forwarded-for', usuarioRed: USUARIO_RED, desarrollo: false, pasoTimeoutMs: 9000, puerto: 3100, maxProyectos: 40, ...sobre,
  };
}

export interface Respuesta { estado: number; cuerpo: any; headers: Headers; texto: string }
export interface Registro { metodo: string; ruta: string; estado: number; texto: string; cookies: string[] }

// Simula un navegador: guarda cookies, manda los mismos encabezados que mandaría el panel real.
export class Navegador {
  cookies = new Map<string, string>();
  ip: string;
  ua: string;
  encabezadosExtra: Record<string, string> = {};
  /** Si está definido, cada intercambio queda anotado (para buscar fugas). */
  registro: Registro[] | null = null;
  private readonly manejador: (r: Request) => Promise<Response>;
  constructor(manejador: (r: Request) => Promise<Response>, ip = '203.0.113.7', ua = 'Mozilla/5.0 (Pruebas)') { this.manejador = manejador; this.ip = ip; this.ua = ua; }

  get sesion(): string | undefined { return this.cookies.get('__Host-sid'); }

  async pedir(metodo: string, ruta: string, cuerpo?: unknown, extra: Record<string, string | null> = {}): Promise<Respuesta> {
    const h: Record<string, string> = {
      origin: ORIGEN, 'x-panel': '1', 'sec-fetch-site': 'same-origin', 'user-agent': this.ua, 'x-forwarded-for': this.ip, 'tailscale-user-login': USUARIO_RED,
      ...this.encabezadosExtra,
    };
    if (cuerpo !== undefined) h['content-type'] = 'application/json';
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    for (const [k, v] of Object.entries(extra)) { if (v === null) delete h[k]; else h[k] = v; }
    const r = await this.manejador(new Request(ORIGEN + ruta, { method: metodo, headers: h, body: cuerpo === undefined ? undefined : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) }));
    for (const sc of r.headers.getSetCookie()) {
      const [par] = sc.split(';');
      const [k, ...v] = par!.split('=');
      if (/Max-Age=0/.test(sc)) this.cookies.delete(k!); else this.cookies.set(k!, v.join('='));
    }
    const texto = await r.text();
    this.registro?.push({ metodo, ruta, estado: r.status, texto, cookies: r.headers.getSetCookie() });
    let json: any = null; try { json = JSON.parse(texto); } catch { /* no es JSON */ }
    return { estado: r.status, cuerpo: json, headers: r.headers, texto };
  }
  get = (ruta: string, extra?: Record<string, string | null>) => this.pedir('GET', ruta, undefined, extra);
  post = (ruta: string, cuerpo: unknown = {}, extra?: Record<string, string | null>) => this.pedir('POST', ruta, cuerpo, extra);

  async registrar(a: Autenticador, nombre = 'Celular'): Promise<Respuesta> {
    const o = await this.post('/api/alta/opciones', { codigo: CODIGO_ALTA });
    if (o.estado !== 200) return o;
    return this.post('/api/alta/verificar', { codigo: CODIGO_ALTA, nombre, respuesta: a.crear(o.cuerpo.opciones.challenge) });
  }

  async ingresar(a: Autenticador): Promise<Respuesta> {
    const o = await this.post('/api/ingreso/opciones');
    if (o.estado !== 200) return o;
    return this.post('/api/ingreso/verificar', { respuesta: a.firmar(o.cuerpo.opciones.challenge) });
  }

  async plan(tipo: string, params: Record<string, unknown> = {}): Promise<Respuesta> { return this.post('/api/planes', { tipo, ...params }); }

  async firmar(planId: string, opciones: any, a: Autenticador): Promise<Respuesta> {
    return this.post(`/api/planes/${planId}/firmar`, { respuesta: a.firmar(opciones.challenge) });
  }

  // Crea, firma y corre un plan hasta el final. Devuelve cada respuesta de paso.
  async correr(planId: string, maximo = 200): Promise<Respuesta[]> {
    const pasos: Respuesta[] = [];
    for (let i = 0; i < maximo; i++) {
      const r = await this.post(`/api/planes/${planId}/paso`);
      pasos.push(r);
      if (r.estado === 409 && r.cuerpo?.error === 'ocupado') continue;
      if (r.estado !== 200) break;
      if (r.cuerpo.estado === 'terminado' || r.cuerpo.estado === 'fallido') break;
    }
    return pasos;
  }

  async hacer(tipo: string, params: Record<string, unknown>, a: Autenticador): Promise<{ plan: Respuesta; firma: Respuesta; pasos: Respuesta[] }> {
    const plan = await this.plan(tipo, params);
    if (plan.estado !== 201) return { plan, firma: plan, pasos: [] };
    const firma = await this.firmar(plan.cuerpo.id, plan.cuerpo.opciones, a);
    if (firma.estado !== 200) return { plan, firma, pasos: [] };
    return { plan, firma, pasos: await this.correr(plan.cuerpo.id) };
  }
}

export interface Mundo {
  base: BaseDePrueba;
  falso: ReturnType<typeof crearSupabaseFalso>;
  config: Config;
  manejador: (r: Request) => Promise<Response>;
  alertas: string[];
  /** Todos los intercambios HTTP de los navegadores creados con navegador()/conSesion(). */
  registro: Registro[];
  navegador(ip?: string, ua?: string): Navegador;
  /** Llave virtual ya registrada y navegador con sesión iniciada. */
  conSesion(): Promise<{ n: Navegador; a: Autenticador }>;
  nuevaLlave(): Autenticador;
  /** Otro servidor sobre la MISMA base (p. ej. con otro código de alta, para probar la recuperación). */
  servidorCon(sobre: Partial<Config>): (r: Request) => Promise<Response>;
}

export async function crearMundo(sobre: Partial<Config> = {}, opciones: { sondeosParaListo?: number; aislado?: boolean; base?: BaseDePrueba } = {}): Promise<Mundo> {
  const base = opciones.base ?? await crearBase({ aislada: opciones.aislado === true });
  const falso = crearSupabaseFalso(opciones);
  const config = configDePrueba(sobre);
  const alertas: string[] = [];
  const fetchCombinado: typeof fetch = async (entrada, init) => {
    const url = new URL(typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
    if (url.host === 'alertas.test') { alertas.push(String(init?.body ?? '')); return new Response('ok'); }
    return falso.fetch(entrada, init);
  };
  const api = crearSupabaseApi(config.tokenSupabase, crearPermitidas(config, base.almacen), config.pasoTimeoutMs, fetchCombinado);
  const manejador = crearManejador({ config, almacen: base.almacen, api, fetchImpl: fetchCombinado });
  const nuevaLlave = () => new Autenticador(config.origen, config.rpId);
  let llaveRegistrada: Autenticador | null = null;
  const registro: Registro[] = [];
  const navegador = (ip = '203.0.113.7', ua = 'Mozilla/5.0 (Pruebas)') => { const x = new Navegador(manejador, ip, ua); x.registro = registro; return x; };
  const servidorCon = (sob: Partial<Config>) => crearManejador({ config: { ...config, ...sob }, almacen: base.almacen, api, fetchImpl: fetchCombinado });
  return {
    base, falso, config, manejador, alertas, registro, navegador, nuevaLlave, servidorCon,
    async conSesion() {
      // La llave se registra una sola vez por mundo (el alta tiene sus propios límites); cada sesión entra con ella.
      const n = navegador();
      if (!llaveRegistrada) {
        const nueva = nuevaLlave();
        const r = await n.registrar(nueva);
        if (r.estado !== 200) throw new Error(`No se pudo registrar la llave: ${r.estado} ${r.texto}`);
        llaveRegistrada = nueva;
      }
      const a = llaveRegistrada;
      const i = await n.ingresar(a);
      if (i.estado !== 200) throw new Error(`No se pudo ingresar: ${i.estado} ${i.texto}`);
      return { n, a };
    },
  };
}

export const aleatorio = (n = 8) => randomBytes(n).toString('hex');

// Lo ÚNICO que el panel puede pedirle a Supabase. Cualquier otra llamada es una falla grave.
export const LLAMADAS_PERMITIDAS: { host: RegExp; metodo: string; ruta: RegExp }[] = [
  { host: /^api\.supabase\.com$/, metodo: 'GET', ruta: /^\/v1\/projects$/ },
  { host: /^api\.supabase\.com$/, metodo: 'GET', ruta: /^\/v1\/organizations$/ },
  { host: /^api\.supabase\.com$/, metodo: 'POST', ruta: /^\/v1\/projects$/ },
  { host: /^api\.supabase\.com$/, metodo: 'GET', ruta: /^\/v1\/projects\/[a-z]{20}\/api-keys\?reveal=true$/ },
  { host: /^api\.supabase\.com$/, metodo: 'POST', ruta: /^\/v1\/projects\/[a-z]{20}\/secrets$/ },
  { host: /^api\.supabase\.com$/, metodo: 'POST', ruta: /^\/v1\/projects\/[a-z]{20}\/functions\/deploy\?slug=[a-z0-9-]+$/ },
  { host: /^api\.supabase\.com$/, metodo: 'PATCH', ruta: /^\/v1\/projects\/[a-z]{20}\/config\/auth$/ },
  { host: /^api\.supabase\.com$/, metodo: 'POST', ruta: /^\/v1\/projects\/[a-z]{20}\/database\/query$/ },
  { host: /^[a-z]{20}\.supabase\.co$/, metodo: 'GET', ruta: /^\/auth\/v1\/settings$/ },
  { host: /^[a-z]{20}\.supabase\.co$/, metodo: 'POST', ruta: /^\/auth\/v1\/admin\/users$/ },
  { host: /^[a-z]{20}\.supabase\.co$/, metodo: 'POST', ruta: /^\/rest\/v1\/rpc\/definir_dueno_inicial$/ },
  { host: /^[a-z]{20}\.supabase\.co$/, metodo: 'PATCH', ruta: /^\/rest\/v1\/configuracion\?id=eq\.1$/ },
  { host: /^[a-z]{20}\.supabase\.co$/, metodo: 'GET', ruta: /^\/rest\/v1\/licencia\?select=modulos&id=eq\.1$/ },
  { host: /^[a-z]{20}\.supabase\.co$/, metodo: 'PATCH', ruta: /^\/rest\/v1\/licencia\?id=eq\.1$/ },
];

export function llamadasFueraDeLista(llamadas: { host: string; metodo: string; ruta: string }[]) {
  return llamadas.filter(l => !LLAMADAS_PERMITIDAS.some(p => p.host.test(l.host) && p.metodo === l.metodo && p.ruta.test(l.ruta)));
}
