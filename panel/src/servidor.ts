// Servidor del panel: un proceso de Node que escucha SOLO en 127.0.0.1 (nunca en la red). Delante va el proxy de
// Tailscale ("tailscale serve"), que pone el HTTPS y agrega el usuario de la red privada en un encabezado.
//
// Endurecimiento propio de este archivo:
//  * No usa el encabezado Host ni la dirección completa del pedido: arma la URL con el origen configurado.
//  * La interfaz (HTML/JS/CSS) se carga en memoria al arrancar y se sirve de ahí: no hay acceso al disco por pedido,
//    así que no existe el "recorrido de rutas" (../) como falla posible.
//  * Solo GET y POST; direcciones cortas; encabezados y tiempos acotados.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './server/config.ts';
import { iguales } from './server/cripto.ts';
import { ErrorHttp } from './server/errores.ts';
import { encabezadosBase, respuestaError } from './server/http.ts';
import { registrar } from './server/registro.ts';

export interface Archivo { cuerpo: Buffer; tipo: string }
export type Interfaz = Map<string, Archivo>;

const TIPOS: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

export function cargarInterfaz(carpeta: string): Interfaz {
  const mapa: Interfaz = new Map();
  for (const nombre of readdirSync(carpeta)) {
    const punto = nombre.lastIndexOf('.');
    const tipo = TIPOS[nombre.slice(punto)];
    if (!tipo || !/^[a-z0-9._-]+$/.test(nombre)) continue;
    mapa.set(nombre === 'index.html' ? '/' : `/${nombre}`, { cuerpo: readFileSync(join(carpeta, nombre)), tipo });
  }
  return mapa;
}

// Política de contenido de la interfaz: solo código propio, nada en línea, nada de afuera, sin sumideros peligrosos del DOM.
// Las conexiones inactivas se mantienen abiertas MÁS tiempo que cualquier cliente o proxy delante (el de Tailscale cierra a los 90 s):
// si el servidor cerrara antes, el cliente reutilizaría una conexión justo cuando se cierra y vería un error.
export const KEEP_ALIVE_MS = 120_000;

export const CSP_INTERFAZ = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self'", "connect-src 'self'",
  "manifest-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "require-trusted-types-for 'script'",
].join('; ');

const MAX_CUERPO_HTTP = 16 * 1024;

class RechazoTemprano extends Error {
  readonly estado: number;
  readonly codigo: string;
  constructor(estado: number, codigo: string, mensaje: string) { super(mensaje); this.estado = estado; this.codigo = codigo; }
}

// Lee el cuerpo ENTERO antes de pasarlo al manejador (así nunca queda un cuerpo a medias en una conexión reutilizada),
// exige que declare su largo (nada de "chunked" ni de cuerpos de largo desconocido) y corta en cuanto se pasa del tope.
async function leerCuerpo(req: IncomingMessage): Promise<Buffer> {
  const declarado = req.headers['content-length'];
  if (req.headers['transfer-encoding'] !== undefined) throw new RechazoTemprano(411, 'largo', 'Hay que declarar el largo del cuerpo.');
  if (declarado === undefined) return Buffer.alloc(0);
  if (!/^\d{1,6}$/.test(declarado)) throw new RechazoTemprano(400, 'largo', 'Largo de cuerpo no válido.');
  if (Number(declarado) > MAX_CUERPO_HTTP) throw new RechazoTemprano(413, 'grande', 'Pedido demasiado grande.');
  const trozos: Buffer[] = [];
  let total = 0;
  for await (const t of req) {
    total += (t as Buffer).length;
    if (total > MAX_CUERPO_HTTP) throw new RechazoTemprano(413, 'grande', 'Pedido demasiado grande.');
    trozos.push(t as Buffer);
  }
  return Buffer.concat(trozos);
}

async function aPedido(req: IncomingMessage, origen: string): Promise<Request | null> {
  const url = req.url ?? '';
  // Solo la forma "/ruta": rechaza "http://otro/..", "//otro" y direcciones larguísimas.
  // eslint-disable-next-line no-control-regex -- a propósito: se rechazan los caracteres de control en la dirección
  if (!url.startsWith('/') || url.startsWith('//') || url.length > 200 || /[\x00-\x20\\]/.test(url)
    || url.includes('%') || /(^|\/)\.\.?(\/|$|\?)/.test(url)) return null;
  const encabezados = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) { for (const x of v) encabezados.append(k, x); } else encabezados.set(k, v);
  }
  const cuerpo = req.method === 'POST' ? await leerCuerpo(req) : null;
  return new Request(origen + url, { method: req.method, headers: encabezados, ...(cuerpo && cuerpo.length ? { body: new Uint8Array(cuerpo) } : {}) });
}

async function enviar(res: ServerResponse, r: Response): Promise<void> {
  const encabezados: Record<string, string | string[]> = {};
  r.headers.forEach((v, k) => { if (k !== 'set-cookie') encabezados[k] = v; });
  const cookies = r.headers.getSetCookie();
  if (cookies.length) encabezados['set-cookie'] = cookies;
  res.writeHead(r.status, encabezados);
  res.end(Buffer.from(await r.arrayBuffer()));
}

export function crearServidor(config: Config, manejador: (r: Request) => Promise<Response>, interfaz: Interfaz): Server {
  const servidor = createServer({ maxHeaderSize: 8192, requestTimeout: 30_000, headersTimeout: 10_000, keepAliveTimeout: KEEP_ALIVE_MS }, async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'POST') return await enviar(res, respuestaError(new ErrorHttp(405, 'metodo', 'Método no permitido.'), { allow: 'GET, POST' }));
      const pedido = await aPedido(req, config.origen);
      if (!pedido) return await enviar(res, respuestaError(new ErrorHttp(400, 'direccion', 'Dirección no válida.')));
      const ruta = new URL(pedido.url).pathname;

      if (ruta.startsWith('/api/') || ruta === '/api') return await enviar(res, await manejador(pedido));

      // Interfaz: misma puerta de red privada que la API.
      if (config.usuarioRed && !iguales(pedido.headers.get('tailscale-user-login') ?? '', config.usuarioRed)) {
        return await enviar(res, respuestaError(new ErrorHttp(403, 'red', 'No permitido.')));
      }
      const archivo = req.method === 'GET' ? interfaz.get(ruta) : undefined;
      if (!archivo) return await enviar(res, respuestaError(new ErrorHttp(404, 'no_existe', 'No existe.')));
      const encabezados = { ...encabezadosBase(), 'content-type': archivo.tipo, 'content-security-policy': CSP_INTERFAZ, 'cache-control': 'no-store' };
      res.writeHead(200, encabezados);
      res.end(archivo.cuerpo);
    } catch (e) {
      if (e instanceof RechazoTemprano) {
        // Se contesta y se DESCARTA lo que el cliente siga mandando (con tope). Cortar de golpe con datos en camino hace que
        // el sistema operativo mande un "reset" que puede borrar la respuesta antes de que el cliente la lea.
        let descartado = 0;
        req.on('data', (t: Buffer) => { descartado += t.length; if (descartado > 1_000_000) req.socket.destroy(); });
        req.resume();
        await enviar(res, respuestaError(new ErrorHttp(e.estado, e.codigo, e.message)));
        return;
      }
      if (!res.headersSent) res.writeHead(500, { ...encabezadosBase(), 'content-type': 'application/json' });
      res.end('{"error":"interno"}');
    }
  });
  servidor.maxRequestsPerSocket = 200;
  servidor.maxHeadersCount = 60;
  servidor.on('clientError', (e, socket) => {
    const codigo = (e as NodeJS.ErrnoException).code ?? 'desconocido';
    registrar('aviso', 'cliente_error', { motivo: codigo }); // ("codigo" se oculta en el registro: parece un secreto)
    // Si la conexión ya no sirve (se cortó o está cerrada), no hay a quién contestar.
    if (codigo === 'ECONNRESET' || !socket.writable) { socket.destroy(); return; }
    // Una conexión que el navegador abrió "de antemano" y no usó vence por tiempo: se cierra sin contestar. Contestar "400" ahí
    // hace que el navegador, si justo la usaba para un pedido real, lo tome como respuesta a ese pedido ("Error 400" en pantalla).
    if (codigo === 'ERR_HTTP_REQUEST_TIMEOUT' || codigo === 'ERR_HTTP_HEADERS_TIMEOUT') { socket.destroy(); return; }
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  return servidor;
}
