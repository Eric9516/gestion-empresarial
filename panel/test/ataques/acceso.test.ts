// ATAQUE 1 — Acceso sin credenciales, red privada, CSRF, rutas trucadas, métodos y encabezados.
import { beforeAll, describe, expect, it } from 'vitest';
import { crearManejador } from '../../src/server/manejador.ts';
import { crearSupabaseApi } from '../../src/server/supabaseApi.ts';
import { configDePrueba, crearMundo, ORIGEN, USUARIO_RED, type Mundo } from '../ayudas/mundo.ts';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const REF = 'abcdefghijklmnopqrst';

// Todas las rutas que existen, con su método. Las que tienen sesión: true deben responder 401 sin sesión.
const CON_SESION: [string, string][] = [
  ['GET', '/api/clientes'], ['GET', `/api/clientes/${REF}`], ['GET', '/api/modulos'], ['GET', '/api/auditoria'],
  ['POST', '/api/planes'], ['GET', `/api/planes/${UUID}`], ['POST', `/api/planes/${UUID}/desafio`], ['POST', `/api/planes/${UUID}/firmar`],
  ['POST', `/api/planes/${UUID}/paso`], ['POST', `/api/planes/${UUID}/cancelar`], ['POST', `/api/planes/${UUID}/clave`],
  ['POST', `/api/planes/${UUID}/acuse`], ['POST', '/api/panico'],
];
const PUBLICAS: [string, string][] = [
  ['GET', '/api/estado'], ['POST', '/api/alta/opciones'], ['POST', '/api/alta/verificar'], ['POST', '/api/ingreso/opciones'],
  ['POST', '/api/ingreso/verificar'], ['POST', '/api/salida'],
];

let m: Mundo;
beforeAll(async () => { m = await crearMundo(); });

describe('sin sesión nada de lo sensible responde', () => {
  it.each(CON_SESION)('%s %s → 401', async (metodo, ruta) => {
    const n = m.navegador();
    const r = await n.pedir(metodo, ruta, metodo === 'POST' ? {} : undefined);
    expect(r.estado).toBe(401);
    expect(r.texto).not.toMatch(/sbp_|eyJ|stack|at \w+ \(/);
  });

  it.each([
    ['vacía', ''], ['basura', 'cualquier-cosa'], ['formato válido pero desconocida', 'A'.repeat(43)],
    ['larguísima', 'A'.repeat(5000)], ['con caracteres raros', '%00%0d%0aset-cookie:x'],
  ])('cookie de sesión %s → 401', async (_n, valor) => {
    const n = m.navegador();
    n.cookies.set('__Host-sid', valor);
    expect((await n.get('/api/clientes')).estado).toBe(401);
  });

  it('cookie repetida (inyección de cookies) → 401 aunque una sea válida', async () => {
    const { n } = await m.conSesion();
    const valida = n.sesion!;
    const r = await n.pedir('GET', '/api/clientes', undefined, { cookie: `__Host-sid=${'B'.repeat(43)}; __Host-sid=${valida}` });
    expect(r.estado).toBe(401);
  });

  it('la sesión de una cookie se puede usar con el mismo navegador, y solo ahí', async () => {
    const { n } = await m.conSesion();
    expect((await n.get('/api/clientes')).estado).toBe(200);
    const otro = m.navegador('203.0.113.7', 'Otro-Navegador/1.0');
    otro.cookies.set('__Host-sid', n.sesion!);
    expect((await otro.get('/api/clientes')).estado).toBe(401); // robo de cookie hacia otro navegador
    expect((await n.get('/api/clientes')).estado).toBe(401); // y la sesión robada queda revocada
  });
});

describe('red privada: solo tu usuario de Tailscale', () => {
  it('sin el encabezado de la red privada, TODO recibe la misma respuesta 403 y no toca la base', async () => {
    const antes = m.base.llamadas.length;
    const rutas = [...CON_SESION, ...PUBLICAS, ['GET', '/api/no-existe'], ['GET', '/'], ['POST', '/api/estado']];
    const respuestas = new Set<string>();
    for (const [metodo, ruta] of rutas) {
      const n = m.navegador();
      const r = await n.pedir(metodo!, ruta!, metodo === 'POST' ? {} : undefined, { 'tailscale-user-login': null });
      expect(r.estado).toBe(403);
      respuestas.add(r.texto);
    }
    expect(respuestas.size).toBe(1);
    expect(m.base.llamadas.length).toBe(antes);
  });

  it.each(['otro@ejemplo.com', 'ERIC@EJEMPLO.COM', ' ', USUARIO_RED + 'x', 'x' + USUARIO_RED, USUARIO_RED + '.evil'])('usuario de red incorrecto (%j) → 403', async (u) => {
    const n = m.navegador();
    expect((await n.get('/api/estado', { 'tailscale-user-login': u })).estado).toBe(403);
  });
});

describe('CSRF: pedidos que no vienen del propio panel', () => {
  let n: Awaited<ReturnType<Mundo['conSesion']>>['n'];
  beforeAll(async () => { ({ n } = await m.conSesion()); });
  const cuerpo = { tipo: 'modulos', ref: REF };

  it.each([
    ['sin Origin', { origin: null }],
    ['Origin de otro sitio', { origin: 'https://evil.com' }],
    ['Origin "null" (iframe/archivo local)', { origin: 'null' }],
    ['Origin con el dominio como prefijo', { origin: `${ORIGEN}.evil.com` }],
    ['Origin con otro puerto', { origin: `${ORIGEN}:8443` }],
    ['Origin http', { origin: 'http://panel.test' }],
    ['sin encabezado propio x-panel', { 'x-panel': null }],
    ['x-panel con otro valor', { 'x-panel': 'true' }],
    ['Sec-Fetch-Site cross-site', { 'sec-fetch-site': 'cross-site' }],
    ['Sec-Fetch-Site same-site', { 'sec-fetch-site': 'same-site' }],
    ['Sec-Fetch-Site none', { 'sec-fetch-site': 'none' }],
  ])('POST con sesión válida pero %s → 403, sin llegar a la lógica', async (_nombre, extra) => {
    const antes = m.base.llamadas.length;
    const r = await n.pedir('POST', '/api/planes', cuerpo, extra);
    expect(r.estado).toBe(403);
    expect(m.base.llamadas.length).toBe(antes);
  });

  it('GET desde otro sitio también se rechaza (lectura entre sitios)', async () => {
    expect((await n.get('/api/clientes', { 'sec-fetch-site': 'cross-site' })).estado).toBe(403);
  });

  it.each([
    ['formulario', 'application/x-www-form-urlencoded'], ['texto plano (CSRF clásico sin preflight)', 'text/plain'],
    ['multipart', 'multipart/form-data; boundary=x'], ['sin tipo', ''], ['json con otro nombre', 'application/jsonp'], ['xml', 'application/xml'],
  ])('tipo de contenido %s → 415', async (_nombre, tipo) => {
    const r = await n.pedir('POST', '/api/planes', JSON.stringify(cuerpo), { 'content-type': tipo || null });
    expect(r.estado).toBe(415);
  });

  it('cabeceras de "cambio de método" no cambian nada', async () => {
    const r = await n.pedir('GET', '/api/planes', undefined, { 'x-http-method-override': 'POST', 'x-method-override': 'POST', 'x-http-method': 'POST' });
    expect(r.estado).toBe(405);
  });
});

describe('rutas trucadas, métodos y tamaños', () => {
  let n: Awaited<ReturnType<Mundo['conSesion']>>['n'];
  beforeAll(async () => { ({ n } = await m.conSesion()); });

  it.each([
    '/api/estado/', '/api//estado', '/api/%2e%2e/estado', '/api/estado%00', '/api/ESTADO', '/API/estado', '/api/estado?x=1',
    '/api/clientes/%2e%2e%2fauditoria', `/api/clientes/${REF.toUpperCase()}`, `/api/clientes/${REF}a`,
    `/api/clientes/${REF.slice(1)}`, '/api/clientes/abcdefghijklmnopqrs1', `/api/clientes/${REF}/`, '/api/planes/no-es-uuid',
    `/api/planes/${UUID}/../paso`, `/api/planes/${UUID.toUpperCase()}`, '/api/' + 'a'.repeat(300), '/api/\\estado', '/api/estado%5c..%5c', '/', '/index.html', '/api',
  ])('ruta %j → 404/400, nunca 200 ni 500', async (ruta) => {
    const r = await n.get(ruta);
    expect([400, 404]).toContain(r.estado);
    expect(r.estado).not.toBe(500);
  });

  it.each(['PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT', 'PROPFIND'])('método %s → 405 sin cabeceras CORS', async (metodo) => {
    // Los métodos que no existen en rutas conocidas devuelven 405 (o 404 si la ruta no existe).
    const r = await n.pedir(metodo, '/api/clientes', metodo === 'HEAD' || metodo === 'OPTIONS' ? undefined : {}).catch(() => null);
    if (!r) return; // el motor de pruebas no soporta el método: no hay nada que atacar
    expect([404, 405]).toContain(r.estado);
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
    expect(r.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('POST a una ruta que solo acepta GET → 405 con Allow', async () => {
    const r = await n.post('/api/clientes', {});
    expect(r.estado).toBe(405);
    expect(r.headers.get('allow')).toBe('GET');
  });

  it('cuerpo enorme → 413 sin cargarlo entero', async () => {
    const r = await n.pedir('POST', '/api/planes', JSON.stringify({ tipo: 'crear', nombre: 'x'.repeat(2_000_000) }));
    expect(r.estado).toBe(413);
  });

  it('cuerpo sin content-length que se pasa del límite → 413', async () => {
    const trozo = 'a'.repeat(1000);
    const flujo = new ReadableStream({ start(c) { for (let i = 0; i < 40; i++) c.enqueue(new TextEncoder().encode(trozo)); c.close(); } });
    const r = await m.manejador(new Request(ORIGEN + '/api/planes', {
      method: 'POST', body: flujo, duplex: 'half',
      headers: { origin: ORIGEN, 'x-panel': '1', 'content-type': 'application/json', cookie: `__Host-sid=${n.sesion}`, 'tailscale-user-login': USUARIO_RED, 'user-agent': 'Mozilla/5.0 (Pruebas)', 'x-forwarded-for': '203.0.113.7' },
    } as RequestInit));
    expect(r.status).toBe(413);
  });

  it.each([
    ['no es JSON', '{"tipo":'], ['es un arreglo', '[1,2,3]'], ['es un número', '42'], ['es null', 'null'], ['UTF-8 inválido', String.fromCharCode(123, 34, 255, 254, 34, 58, 49, 125)],
    ['anidado 50 niveles', '{"a":'.repeat(50) + '1' + '}'.repeat(50)],
  ])('cuerpo %s → 400, nunca 500', async (_nombre, crudo) => {
    const r = await n.pedir('POST', '/api/planes', crudo);
    expect([400, 413]).toContain(r.estado);
  });
});

describe('encabezados de seguridad en TODAS las respuestas', () => {
  const REQUERIDOS: Record<string, RegExp> = {
    'cache-control': /no-store/, 'x-content-type-options': /^nosniff$/, 'referrer-policy': /^no-referrer$/, 'x-frame-options': /^DENY$/,
    'cross-origin-opener-policy': /^same-origin$/, 'cross-origin-resource-policy': /^same-origin$/,
    'strict-transport-security': /max-age=\d{8,}/, 'content-security-policy': /default-src 'none'/, 'permissions-policy': /camera=\(\)/,
  };
  const casos: [string, () => Promise<{ headers: Headers }>][] = [
    ['200', async () => m.navegador().get('/api/estado')],
    ['400', async () => (await m.conSesion()).n.post('/api/planes', 'xx')],
    ['401', async () => m.navegador().get('/api/clientes')],
    ['403 red', async () => m.navegador().get('/api/estado', { 'tailscale-user-login': null })],
    ['403 origen', async () => m.navegador().post('/api/salida', {}, { origin: 'https://evil.com' })],
    ['404', async () => m.navegador().get('/api/nada')],
    ['405', async () => m.navegador().post('/api/clientes', {})],
    ['415', async () => m.navegador().post('/api/salida', '{}', { 'content-type': 'text/plain' })],
  ];
  it.each(casos)('respuesta %s', async (_n, hacer) => {
    const r = await hacer();
    for (const [h, re] of Object.entries(REQUERIDOS)) expect(r.headers.get(h), h).toMatch(re);
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
    expect(r.headers.get('server')).toBeNull();
    expect(r.headers.get('x-powered-by')).toBeNull();
  });

  it('un error interno inesperado responde 500 genérico, sin detalles ni secretos', async () => {
    const roto = crearManejador({
      config: configDePrueba(), api: crearSupabaseApi('sbp_' + 'a'.repeat(40), ['orgprueba1234'], 1000),
      almacen: { rpc: async () => { throw new Error('boom: secreto sbp_abcdefghijklmnop en /home/usuario/panel/src/x.ts:12'); } },
    });
    const n = m.navegador();
    n.cookies.set('__Host-sid', 'A'.repeat(43));
    const r = await roto(new Request(ORIGEN + '/api/estado', { headers: { 'tailscale-user-login': USUARIO_RED, cookie: '__Host-sid=' + 'A'.repeat(43) } }));
    expect(r.status).toBe(500);
    const t = await r.text();
    expect(t).toBe('{"error":"interno","mensaje":"Error interno."}');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
  });
});

describe('la IP no se puede falsificar para saltear límites', () => {
  it('solo cuenta el último valor del encabezado (el que pone el proxy de confianza)', async () => {
    const w = await crearMundo({}, { aislado: true });
    // Un atacante manda su propia lista; el proxy agrega la IP real al final. Cambiar el comienzo no cambia el "cubo".
    const respuestas: number[] = [];
    for (let i = 0; i < 30; i++) {
      const n = w.navegador(`10.0.0.${i}, 198.51.100.9`);
      respuestas.push((await n.post('/api/alta/opciones', { codigo: 'incorrecto' })).estado);
    }
    expect(respuestas.slice(0, 6).every(e => e === 403)).toBe(true);
    expect(respuestas.slice(6).every(e => e === 429)).toBe(true);
  });
});
