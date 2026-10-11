import type { Config } from './config.ts';
import { ErrorHttp, malPedido, prohibido } from './errores.ts';

export const MAX_CUERPO = 16 * 1024;
export const COOKIE_SESION = '__Host-sid';

// Encabezados de seguridad de TODA respuesta (también las de error).
export function encabezadosBase(): Record<string, string> {
  return {
    'cache-control': 'no-store, max-age=0',
    pragma: 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=(), publickey-credentials-get=(self), publickey-credentials-create=(self)',
    'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
    'x-robots-tag': 'noindex, nofollow',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  };
}

export function respuestaJson(estado: number, cuerpo: unknown, extra: Record<string, string> = {}): Response {
  const encabezados = new Headers({ ...encabezadosBase(), 'content-type': 'application/json; charset=utf-8' });
  for (const [k, v] of Object.entries(extra)) encabezados.set(k, v);
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: encabezados });
}

export function respuestaError(e: ErrorHttp, extra: Record<string, string> = {}): Response {
  return respuestaJson(e.estado, { error: e.codigo, mensaje: e.message }, extra);
}

// ---------- cookies ----------
export function leerCookie(req: Request, nombre: string): string | null {
  const crudo = req.headers.get('cookie');
  if (!crudo || crudo.length > 4096) return null;
  let encontrado: string | null = null;
  for (const parte of crudo.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() !== nombre) continue;
    // Si el nombre aparece más de una vez, es sospechoso (inyección de cookies): no se acepta ninguna.
    if (encontrado !== null) return null;
    encontrado = parte.slice(i + 1).trim();
  }
  return encontrado && /^[A-Za-z0-9_-]{20,128}$/.test(encontrado) ? encontrado : null;
}

export function cookieSesion(valor: string): string {
  // __Host-: obliga a Secure, Path=/ y sin Domain (no se puede pisar desde un subdominio).
  return `${COOKIE_SESION}=${valor}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800`;
}
export const cookieBorrar = (): string => `${COOKIE_SESION}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;

// ---------- defensa contra pedidos de otros sitios ----------
// Todo pedido que cambia algo (POST) tiene que venir del propio panel: mismo origen, encabezado propio y JSON.
export function exigirMismoOrigen(req: Request, config: Config): void {
  const sitio = req.headers.get('sec-fetch-site');
  if (sitio !== null && sitio !== 'same-origin') throw prohibido('origen', 'Pedido de otro sitio.');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.headers.get('origin') !== config.origen) throw prohibido('origen', 'Pedido de otro sitio.');
    if (req.headers.get('x-panel') !== '1') throw prohibido('origen', 'Pedido de otro sitio.');
  }
}

// ---------- cuerpo ----------
function profundidad(valor: unknown, nivel = 0): number {
  if (nivel > 12) return nivel;
  if (Array.isArray(valor)) return valor.reduce<number>((m, x) => Math.max(m, profundidad(x, nivel + 1)), nivel + 1);
  if (valor !== null && typeof valor === 'object') return Object.values(valor).reduce<number>((m, x) => Math.max(m, profundidad(x, nivel + 1)), nivel + 1);
  return nivel;
}

// Lee un cuerpo JSON de tamaño acotado. Se corta apenas se pasa del límite (no se carga todo en memoria).
export async function leerJson(req: Request, max = MAX_CUERPO): Promise<Record<string, unknown>> {
  const tipo = (req.headers.get('content-type') ?? '').toLowerCase().split(';')[0]?.trim();
  if (tipo !== 'application/json') throw new ErrorHttp(415, 'tipo', 'Tipo de contenido no permitido.');
  const declarado = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declarado) && declarado > max) throw new ErrorHttp(413, 'grande', 'Pedido demasiado grande.');
  if (!req.body) return {};
  const lector = req.body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await lector.cancel().catch(() => {}); throw new ErrorHttp(413, 'grande', 'Pedido demasiado grande.'); }
    trozos.push(value);
  }
  let valor: unknown;
  try {
    const texto = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(trozos));
    if (!texto.trim()) return {};
    valor = JSON.parse(texto);
  } catch { throw malPedido('json', 'El pedido no es JSON válido.'); }
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) throw malPedido('json', 'Se esperaba un objeto.');
  if (profundidad(valor) > 10) throw malPedido('json', 'El pedido es demasiado anidado.');
  return valor as Record<string, unknown>;
}
