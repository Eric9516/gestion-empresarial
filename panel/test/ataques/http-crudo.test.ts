// ATAQUE 8 — El servidor HTTP real, con sockets crudos: contrabando de pedidos, rutas, encabezados enormes, archivos.
import { createConnection, type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { cargarInterfaz, crearServidor, CSP_INTERFAZ, KEEP_ALIVE_MS } from '../../src/servidor.ts';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { crearMundo, ORIGEN, USUARIO_RED, type Mundo } from '../ayudas/mundo.ts';

let m: Mundo;
let servidor: Server;
let puerto: number;

beforeAll(async () => {
  m = await crearMundo();
  const carpeta = mkdtempSync(join(tmpdir(), 'panel-web-'));
  mkdirSync(carpeta, { recursive: true });
  writeFileSync(join(carpeta, 'index.html'), '<!doctype html><title>x</title><script type="module" src="/app.js"></script>');
  writeFileSync(join(carpeta, 'app.js'), 'console.log(1)');
  writeFileSync(join(carpeta, 'estilos.css'), 'body{}');
  writeFileSync(join(carpeta, 'secreto.txt'), 'NO SE DEBE SERVIR'); // tipo no permitido
  writeFileSync(join(carpeta, '.env'), 'X=1'); // oculto
  servidor = crearServidor(m.config, m.manejador, cargarInterfaz(carpeta));
  await new Promise<void>(r => servidor.listen(0, '127.0.0.1', r));
  puerto = (servidor.address() as AddressInfo).port;
});
afterAll(async () => { await new Promise<void>(r => servidor.close(() => r())); });

// Manda bytes crudos y devuelve todo lo que conteste el servidor.
// (la espera es un tope: con "Connection: close" se resuelve apenas el servidor cierra; 300 ms era poco con la máquina cargada)
function crudo(texto: string, esperaMs = 1500): Promise<string> {
  return new Promise((resolve) => {
    const s = createConnection(puerto, '127.0.0.1');
    let datos = '';
    s.on('data', d => { datos += d.toString('latin1'); });
    s.on('error', () => resolve(datos));
    s.on('close', () => resolve(datos));
    s.on('connect', () => { s.write(Buffer.from(texto, 'latin1')); setTimeout(() => s.destroy(), esperaMs); });
  });
}
const estado = (r: string) => Number(r.match(/^HTTP\/1\.1 (\d{3})/)?.[1] ?? 0);
const base = `Host: panel.test\r\ntailscale-user-login: ${USUARIO_RED}\r\nConnection: close\r\n`;

describe('pedidos mal formados', () => {
  it('el servidor responde a lo normal', async () => {
    expect(estado(await crudo(`GET /api/estado HTTP/1.1\r\n${base}\r\n`))).toBe(200);
  });

  it.each([
    ['dirección absoluta (estilo proxy)', `GET http://evil.com/api/estado HTTP/1.1\r\n${base}\r\n`],
    ['doble barra al comienzo', `GET //evil.com/api/estado HTTP/1.1\r\n${base}\r\n`],
    ['recorrido de rutas ../', `GET /api/clientes/../estado HTTP/1.1\r\n${base}\r\n`],
    ['recorrido codificado %2e', `GET /api/%2e%2e/estado HTTP/1.1\r\n${base}\r\n`],
    ['barra invertida', `GET /api\\estado HTTP/1.1\r\n${base}\r\n`],
    ['byte nulo codificado', `GET /api/estado%00 HTTP/1.1\r\n${base}\r\n`],
    ['dirección larguísima', `GET /api/${'a'.repeat(400)} HTTP/1.1\r\n${base}\r\n`],
  ])('%s → 400/404', async (_n, pedido) => {
    expect([400, 404]).toContain(estado(await crudo(pedido)));
  });

  it.each(['PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT', 'FOO'])('método %s → 400/405 o cierre sin respuesta', async (metodo) => {
    expect([0, 400, 405]).toContain(estado(await crudo(`${metodo} /api/estado HTTP/1.1\r\n${base}\r\n`)));
  });

  it('contrabando de pedidos: Content-Length y Transfer-Encoding juntos → Node lo rechaza', async () => {
    const r = await crudo(`POST /api/salida HTTP/1.1\r\n${base}Content-Type: application/json\r\nContent-Length: 4\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\nGET /api/clientes HTTP/1.1\r\n${base}\r\n`);
    expect(estado(r)).toBe(400);
    expect((r.match(/HTTP\/1\.1 \d{3}/g) ?? []).length).toBe(1); // no hubo un segundo pedido "escondido"
  });

  it('Content-Length repetido o inválido → 400', async () => {
    expect(estado(await crudo(`POST /api/salida HTTP/1.1\r\n${base}Content-Type: application/json\r\nContent-Length: 2\r\nContent-Length: 3\r\n\r\n{}`))).toBe(400);
    expect(estado(await crudo(`POST /api/salida HTTP/1.1\r\n${base}Content-Type: application/json\r\nContent-Length: abc\r\n\r\n{}`))).toBe(400);
  });

  it('encabezados enormes → 431 o cierre (no se carga en memoria)', async () => {
    const r = await crudo(`GET /api/estado HTTP/1.1\r\n${base}X-Basura: ${'a'.repeat(20000)}\r\n\r\n`);
    expect([431, 400, 0]).toContain(estado(r));
  });

  it('demasiados encabezados: los que sobran se descartan y, si era el de la red privada, queda rechazado (falla cerrado)', async () => {
    const muchos = Array.from({ length: 400 }, (_, i) => `X-${i}: v`).join('\r\n');
    const r = await crudo(`GET /api/estado HTTP/1.1\r\nHost: panel.test\r\n${muchos}\r\ntailscale-user-login: ${USUARIO_RED}\r\nConnection: close\r\n\r\n`);
    expect([403, 431, 400, 0]).toContain(estado(r));
  });

  it('cabecera con salto de línea inyectado no crea otra cabecera', async () => {
    const r = await crudo(`GET /api/estado HTTP/1.1\r\n${base}X-A: b\nTailscale-User-Login: otro@x.com\r\n\r\n`);
    // Aunque el servidor tolere el \n suelto, el usuario de red que vale es el primero (el correcto), nunca uno inyectado.
    expect([200, 400, 403]).toContain(estado(r));
  });

  it('ningún método ni ruta devuelve cabeceras de CORS ni datos del servidor', async () => {
    const r = await crudo(`GET /api/estado HTTP/1.1\r\n${base}Origin: https://evil.com\r\n\r\n`);
    expect(r.toLowerCase()).not.toContain('access-control-allow');
    expect(r.toLowerCase()).not.toMatch(/x-powered-by|server: /);
  });

  it('el encabezado Host no cambia nada (se usa el origen configurado)', async () => {
    const r = await crudo(`GET /api/estado HTTP/1.1\r\nHost: evil.com\r\ntailscale-user-login: ${USUARIO_RED}\r\nConnection: close\r\n\r\n`);
    expect(estado(r)).toBe(200);
  });
});

describe('conexiones reutilizadas (keep-alive)', () => {
  // Envía varios pedidos por la MISMA conexión y devuelve todas las respuestas juntas.
  const serie = (pedidos: string[], esperaMs = 600) => crudo(pedidos.join(''), esperaMs);
  const cuerpoJson = '{"x":1}';
  const post = (ruta: string, cuerpo = cuerpoJson) =>
    `POST ${ruta} HTTP/1.1\r\nHost: panel.test\r\ntailscale-user-login: ${USUARIO_RED}\r\nOrigin: ${ORIGEN}\r\nx-panel: 1\r\nContent-Type: application/json\r\nContent-Length: ${cuerpo.length}\r\n\r\n${cuerpo}`;
  const get = (ruta: string) => `GET ${ruta} HTTP/1.1\r\nHost: panel.test\r\ntailscale-user-login: ${USUARIO_RED}\r\n\r\n`;

  it('una ruta que responde SIN leer el cuerpo no desfasa el pedido siguiente', async () => {
    // Sin sesión: la respuesta 401 sale antes de mirar el cuerpo.
    const r = await serie([post('/api/planes/123e4567-e89b-42d3-a456-426614174000/clave'), get('/api/estado'), post('/api/planes/123e4567-e89b-42d3-a456-426614174000/acuse'), get('/api/estado')]);
    const estados = [...r.matchAll(/HTTP\/1\.1 (\d{3})/g)].map(x => Number(x[1]));
    expect(estados).toEqual([401, 200, 401, 200]);
  });

  // Como hace un navegador de verdad: primero llegan los encabezados y, un instante después, el cuerpo.
  const porTrozos = (trozos: string[], pausaMs = 120) => new Promise<string>((resolve) => {
    const s = createConnection(puerto, '127.0.0.1');
    let datos = '';
    s.on('data', d => { datos += d.toString('latin1'); });
    s.on('error', () => resolve(datos));
    s.on('close', () => resolve(datos));
    s.on('connect', async () => {
      for (const t of trozos) { s.write(Buffer.from(t, 'latin1')); await new Promise(r => setTimeout(r, pausaMs)); }
      setTimeout(() => s.destroy(), 400);
    });
  });

  it('encabezados y cuerpo en paquetes separados (como un navegador) con una ruta que no lee el cuerpo', async () => {
    const ruta = '/api/planes/123e4567-e89b-42d3-a456-426614174000/clave';
    const cabeza = `POST ${ruta} HTTP/1.1\r\nHost: panel.test\r\ntailscale-user-login: ${USUARIO_RED}\r\nOrigin: ${ORIGEN}\r\nx-panel: 1\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n`;
    const r = await porTrozos([cabeza, '{}', get('/api/estado'), cabeza + '{}', get('/api/estado')]);
    const estados = [...r.matchAll(/HTTP\/1\.1 (\d{3})/g)].map(x => Number(x[1]));
    expect(estados).toEqual([401, 200, 401, 200]);
  });

  it('el servidor mantiene abiertas las conexiones más tiempo que cualquier proxy o navegador (regresión: error al reutilizar una conexión inactiva)', () => {
    expect(KEEP_ALIVE_MS).toBeGreaterThanOrEqual(90_000); // el proxy de Tailscale cierra las suyas a los 90 s
    expect(servidor.keepAliveTimeout).toBe(KEEP_ALIVE_MS);
    expect(servidor.headersTimeout).toBeLessThan(servidor.requestTimeout);
  });

  it('una conexión que vence por tiempo se cierra sin contestar "400" (regresión: "Error 400" al entrar, por conexiones abiertas de antemano)', () => {
    for (const codigo of ['ERR_HTTP_REQUEST_TIMEOUT', 'ERR_HTTP_HEADERS_TIMEOUT']) {
      const escrito: string[] = []; let destruido = false;
      const falso = { writable: true, destroy: () => { destruido = true; }, end: (t: string) => { escrito.push(t); } };
      servidor.emit('clientError', Object.assign(new Error('vencido'), { code: codigo }), falso);
      expect({ codigo, destruido, escrito }).toEqual({ codigo, destruido: true, escrito: [] });
    }
    // un pedido realmente mal formado sigue recibiendo 400
    const falso = { writable: true, destroy: () => {}, end: (t: string) => { escrito = t; } }; let escrito = '';
    servidor.emit('clientError', Object.assign(new Error('mal'), { code: 'HPE_INVALID_METHOD' }), falso);
    expect(escrito).toContain('400 Bad Request');
  });

  it('una conexión que estuvo inactiva unos segundos se puede volver a usar sin error', async () => {
    const http = await import('node:http');
    const agente = new http.Agent({ keepAlive: true, maxSockets: 1 });
    let conexiones = 0;
    servidor.on('connection', () => { conexiones++; });
    const pedir = () => new Promise<number>((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: puerto, path: '/api/estado', agent: agente, headers: { 'tailscale-user-login': USUARIO_RED } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); });
      req.on('error', () => resolve(-1));
      req.end();
    });
    expect(await pedir()).toBe(200);
    await new Promise(r => setTimeout(r, 7000)); // más que los 5 s que tenía antes
    expect(await pedir()).toBe(200);
    expect(conexiones).toBe(1); // se reutilizó la misma conexión
    agente.destroy();
  }, 20_000);

  it('un cuerpo grande ignorado por la ruta tampoco rompe la conexión', async () => {
    const grande = JSON.stringify({ relleno: 'a'.repeat(12000) });
    const r = await serie([post('/api/planes/123e4567-e89b-42d3-a456-426614174000/clave', grande), get('/api/estado')]);
    const estados = [...r.matchAll(/HTTP\/1\.1 (\d{3})/g)].map(x => Number(x[1]));
    expect(estados).toEqual([401, 200]);
  });

  it('un cuerpo que se pasa del límite recibe 413, se descarta sin procesarlo y la conexión sigue sana', async () => {
    const enorme = JSON.stringify({ relleno: 'a'.repeat(40000) });
    const r = await serie([post('/api/planes', enorme), get('/api/estado')]);
    const estados = [...r.matchAll(/HTTP\/1\.1 (\d{3})/g)].map(x => Number(x[1]));
    expect(estados).toEqual([413, 200]);
  });
});

describe('interfaz (archivos estáticos)', () => {
  const get = (ruta: string, extra = '') => crudo(`GET ${ruta} HTTP/1.1\r\n${base}${extra}\r\n`);

  it('sirve solo los archivos permitidos, con CSP estricta', async () => {
    for (const [ruta, tipo] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/estilos.css', 'text/css']]) {
      const r = await get(ruta!);
      expect(estado(r)).toBe(200);
      expect(r.toLowerCase()).toContain(`content-type: ${tipo}`);
      expect(r).toContain(`content-security-policy: ${CSP_INTERFAZ}`);
      expect(r.toLowerCase()).toContain('x-content-type-options: nosniff');
      expect(r.toLowerCase()).toContain('cache-control: no-store');
    }
  });

  it.each([
    '/secreto.txt', '/.env', '/package.json', '/src/server/config.ts', '/dist/web/app.js', '/index.html', '/app.js.map', '/favicon.ico', '/robots.txt', '/api', '/admin', '/node_modules/x',
  ])('%s → 404', async (ruta) => {
    const r = await get(ruta);
    expect([400, 404]).toContain(estado(r));
    expect(r).not.toContain('NO SE DEBE SERVIR');
    expect(r).not.toContain('X=1');
  });

  it('la CSP prohíbe lo peligroso', () => {
    expect(CSP_INTERFAZ).toContain("default-src 'none'");
    expect(CSP_INTERFAZ).toContain("script-src 'self'");
    expect(CSP_INTERFAZ).not.toMatch(/unsafe-inline|unsafe-eval|\*|data:(?!.*img)|http:/);
    expect(CSP_INTERFAZ).toContain("frame-ancestors 'none'");
    expect(CSP_INTERFAZ).toContain("require-trusted-types-for 'script'");
    expect(CSP_INTERFAZ).toContain("form-action 'none'");
  });

  it('la interfaz también exige el usuario de la red privada', async () => {
    const r = await crudo(`GET / HTTP/1.1\r\nHost: panel.test\r\nConnection: close\r\n\r\n`);
    expect(estado(r)).toBe(403);
    expect(r).not.toContain('<title>');
  });

  it('POST a la interfaz no existe', async () => {
    expect([404, 405]).toContain(estado(await crudo(`POST / HTTP/1.1\r\n${base}Content-Length: 0\r\n\r\n`)));
  });
});

describe('API a través del servidor real', () => {
  it('el flujo de ingreso funciona por HTTP real (cookie incluida)', async () => {
    const f = async (ruta: string, cuerpo?: unknown, cookie = '') => {
      const r = await fetch(`http://127.0.0.1:${puerto}${ruta}`, {
        method: cuerpo === undefined ? 'GET' : 'POST',
        headers: { 'tailscale-user-login': USUARIO_RED, origin: ORIGEN, 'x-panel': '1', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '203.0.113.7', ...(cookie ? { cookie } : {}) },
        ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
      });
      return { estado: r.status, json: await r.json().catch(() => null), cookies: r.headers.getSetCookie() };
    };
    const llave = m.nuevaLlave();
    const { CODIGO_ALTA } = await import('../ayudas/mundo.ts');
    const o = await f('/api/alta/opciones', { codigo: CODIGO_ALTA });
    expect(o.estado).toBe(200);
    expect((await f('/api/alta/verificar', { codigo: CODIGO_ALTA, nombre: 'x', respuesta: llave.crear(o.json.opciones.challenge) })).estado).toBe(200);
    const io = await f('/api/ingreso/opciones', {});
    const iv = await f('/api/ingreso/verificar', { respuesta: llave.firmar(io.json.opciones.challenge) });
    expect(iv.estado).toBe(200);
    const cookie = iv.cookies[0]!.split(';')[0]!;
    expect((await f('/api/clientes', undefined, cookie)).estado).toBe(200);
    expect((await f('/api/clientes')).estado).toBe(401);
  });

  it('un cuerpo con la cantidad de bytes declarada pero que nunca llega no deja el servidor colgado para otros', async () => {
    const lento = createConnection(puerto, '127.0.0.1');
    lento.write(`POST /api/salida HTTP/1.1\r\n${base}Content-Type: application/json\r\nContent-Length: 50\r\n\r\n{`);
    const t0 = Date.now();
    const r = await crudo(`GET /api/estado HTTP/1.1\r\n${base}\r\n`);
    expect(estado(r)).toBe(200);
    expect(Date.now() - t0).toBeLessThan(2000);
    lento.destroy();
  });
});
