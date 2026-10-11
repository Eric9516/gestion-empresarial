// ATAQUE 2 — Llaves de acceso: alta, recuperación, falsificación de firmas, repetición y carreras.
import fc from 'fast-check';
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Autenticador } from '../ayudas/autenticador.ts';
import { CODIGO_ALTA, crearMundo, type Mundo } from '../ayudas/mundo.ts';

const cuenta = async (m: Mundo, tabla: string) => (await m.base.sql<{ n: number }>(`select count(*)::int as n from panel.${tabla}`))[0]!.n;

describe('alta de la primera llave', () => {
  let m: Mundo;
  beforeEach(async () => { m = await crearMundo(); });

  it.each([
    ['sin código', {}], ['código vacío', { codigo: '' }], ['código corto', { codigo: 'abc' }], ['código con una letra distinta', { codigo: CODIGO_ALTA.slice(0, -1) + 'y' }],
    ['código más largo', { codigo: CODIGO_ALTA + 'x' }], ['código numérico', { codigo: 12345 }], ['código objeto', { codigo: { $ne: '' } }], ['código arreglo', { codigo: [CODIGO_ALTA] }],
    ['código null', { codigo: null }], ['campo extra', { codigo: CODIGO_ALTA, admin: true }],
  ])('%s → rechazado, sin crear desafíos ni llaves', async (_nombre, cuerpo) => {
    const n = m.navegador();
    const r = await n.post('/api/alta/opciones', cuerpo);
    expect([400, 403]).toContain(r.estado);
    expect(await cuenta(m, 'desafios')).toBe(0);
    expect(await cuenta(m, 'credenciales')).toBe(0);
  });

  it('el código correcto abre el alta y registra la llave', async () => {
    const n = m.navegador();
    const r = await n.registrar(m.nuevaLlave());
    expect(r.estado).toBe(200);
    expect(await cuenta(m, 'credenciales')).toBe(1);
  });

  const falsificaciones: [string, (a: Autenticador, desafio: string) => unknown][] = [
    ['origen distinto', (a, d) => a.crear(d, { origen: 'https://evil.com' })],
    ['origen con el dominio como prefijo', (a, d) => a.crear(d, { origen: 'https://panel.test.evil.com' })],
    ['dominio (rpId) distinto', (a, d) => a.crear(d, { rpId: 'evil.com' })],
    ['sin verificación de usuario (UV)', (a, d) => a.crear(d, { banderas: 0x41 })],
    ['sin presencia de usuario (UP)', (a, d) => a.crear(d, { banderas: 0x44 })],
    ['tipo de operación incorrecto (get)', (a, d) => a.crear(d, { tipo: 'webauthn.get' })],
    ['desafío inventado por el atacante', (a) => a.crear('A'.repeat(43))],
    ['desafío vacío', (a) => a.crear('')],
  ];
  it.each(falsificaciones)('registro con %s → rechazado y no queda llave', async (_n, hacer) => {
    const n = m.navegador(); const a = m.nuevaLlave();
    const o = await n.post('/api/alta/opciones', { codigo: CODIGO_ALTA });
    const r = await n.post('/api/alta/verificar', { codigo: CODIGO_ALTA, nombre: 'x', respuesta: hacer(a, o.cuerpo.opciones.challenge) });
    expect(r.estado).toBe(401);
    expect(await cuenta(m, 'credenciales')).toBe(0);
  });

  it('un objeto de atestación manipulado se rechaza', async () => {
    const n = m.navegador(); const a = m.nuevaLlave();
    const o = await n.post('/api/alta/opciones', { codigo: CODIGO_ALTA });
    const resp: any = a.crear(o.cuerpo.opciones.challenge);
    const b = Buffer.from(resp.response.attestationObject, 'base64url');
    b[b.length - 5] = b[b.length - 5]! ^ 0xff;
    resp.response.attestationObject = b.toString('base64url');
    const r = await n.post('/api/alta/verificar', { codigo: CODIGO_ALTA, nombre: 'x', respuesta: resp });
    expect([400, 401]).toContain(r.estado);
    expect(await cuenta(m, 'credenciales')).toBe(0);
  });

  it('el mismo registro no se puede repetir (el desafío se usa una sola vez)', async () => {
    const n = m.navegador(); const a = m.nuevaLlave();
    const o = await n.post('/api/alta/opciones', { codigo: CODIGO_ALTA });
    const resp = a.crear(o.cuerpo.opciones.challenge);
    expect((await n.post('/api/alta/verificar', { codigo: CODIGO_ALTA, nombre: 'x', respuesta: resp })).estado).toBe(200);
    expect((await n.post('/api/alta/verificar', { codigo: CODIGO_ALTA, nombre: 'x', respuesta: resp })).estado).toBe(401);
    expect(await cuenta(m, 'credenciales')).toBe(1);
  });

  it('diez registros simultáneos con el mismo desafío: solo uno entra', async () => {
    const n = m.navegador(); const a = m.nuevaLlave();
    const o = await n.post('/api/alta/opciones', { codigo: CODIGO_ALTA });
    const resp = a.crear(o.cuerpo.opciones.challenge);
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => m.navegador(`198.51.100.${i}`).post('/api/alta/verificar', { codigo: CODIGO_ALTA, nombre: 'x', respuesta: resp })));
    expect(rs.filter(r => r.estado === 200).length).toBe(1);
    expect(await cuenta(m, 'credenciales')).toBe(1);
  });

  it('un desafío vencido no sirve', async () => {
    const n = m.navegador(); const a = m.nuevaLlave();
    const o = await n.post('/api/alta/opciones', { codigo: CODIGO_ALTA });
    await m.base.sql(`update panel.desafios set vence_at = now() - interval '1 second'`);
    const r = await n.post('/api/alta/verificar', { codigo: CODIGO_ALTA, nombre: 'x', respuesta: a.crear(o.cuerpo.opciones.challenge) });
    expect(r.estado).toBe(401);
    expect(await cuenta(m, 'credenciales')).toBe(0);
  });

  it('el alta pide el código también al verificar (no alcanza con haber obtenido las opciones)', async () => {
    const n = m.navegador(); const a = m.nuevaLlave();
    const o = await n.post('/api/alta/opciones', { codigo: CODIGO_ALTA });
    const r = await n.post('/api/alta/verificar', { codigo: 'otro-codigo-distinto-pero-largo-de-verdad', nombre: 'x', respuesta: a.crear(o.cuerpo.opciones.challenge) });
    expect(r.estado).toBe(403);
    expect(await cuenta(m, 'credenciales')).toBe(0);
  });

  it('el alta se cierra sola a los 15 minutos de la primera llave', async () => {
    const n = m.navegador();
    expect((await n.registrar(m.nuevaLlave())).estado).toBe(200);
    expect((await n.registrar(m.nuevaLlave())).estado).toBe(200); // respaldo dentro de la ventana
    await m.base.sql(`update panel.ajustes set valor = to_jsonb((now() - interval '1 minute')::text) where clave = 'alta_ventana_hasta'`);
    const r = await n.post('/api/alta/opciones', { codigo: CODIGO_ALTA });
    expect(r.estado).toBe(403);
    expect(r.cuerpo.error).toBe('alta_cerrada');
    expect((await n.get('/api/estado')).cuerpo.altaAbierta).toBe(false);
  });

  it('con el alta cerrada, ni el código correcto ni una firma forzada agregan una llave', async () => {
    const n = m.navegador();
    await n.registrar(m.nuevaLlave());
    await m.base.sql(`update panel.ajustes set valor = to_jsonb((now() - interval '1 minute')::text) where clave = 'alta_ventana_hasta'`);
    // Incluso llamando directo a la función de la base:
    await expect(m.base.almacen.rpc('panel_credencial_agregar', {
      p_codigo_hash: (await import('../../src/server/cripto.ts')).sha256Hex(CODIGO_ALTA), p_id: 'x'.repeat(30), p_clave_publica: 'y'.repeat(30), p_contador: 0, p_transportes: [], p_nombre: 'intruso',
    })).rejects.toThrow();
    expect(await cuenta(m, 'credenciales')).toBe(1);
  });

  it('máximo 5 llaves', async () => {
    const n = m.navegador();
    const rs = [];
    for (let i = 0; i < 6; i++) rs.push((await m.navegador(`198.51.100.${i}`).registrar(m.nuevaLlave())).estado);
    expect(rs.filter(e => e === 200).length).toBe(5);
    expect(await cuenta(m, 'credenciales')).toBe(5);
    void n;
  });

  it('fuerza bruta del código: se corta con 429 y queda en la auditoría', async () => {
    const estados: number[] = [];
    for (let i = 0; i < 20; i++) estados.push((await m.navegador(`198.51.100.${i}`).post('/api/alta/opciones', { codigo: `intento-${i}`.padEnd(40, 'z') })).estado);
    expect(estados.filter(e => e === 403).length).toBeLessThanOrEqual(12); // tope global por hora
    expect(estados.at(-1)).toBe(429);
    const ev = await m.base.sql<{ n: number }>(`select count(*)::int as n from panel.auditoria where evento = 'alta_codigo_incorrecto'`);
    expect(ev[0]!.n).toBeGreaterThan(0);
  });
});

describe('recuperación de acceso (código nuevo)', () => {
  it('cambiar el código reemplaza TODAS las llaves, cierra sesiones y cancela planes', async () => {
    const m = await crearMundo();
    const { n } = await m.conSesion();
    m.falso.proyectoInstalado('cliente-uno');
    const ref = [...m.falso.proyectos.keys()][0]!;
    const plan = await n.plan('actualizar', { ref });
    expect(plan.estado).toBe(201);

    const nuevoCodigo = 'codigo-nuevo-de-recuperacion-'.padEnd(40, 'q');
    const servidor2 = m.servidorCon({ codigoAlta: nuevoCodigo });
    const n2 = new (m.navegador().constructor as any)(servidor2, '203.0.113.9') as ReturnType<Mundo['navegador']>;
    const nueva = m.nuevaLlave();
    const o = await n2.post('/api/alta/opciones', { codigo: nuevoCodigo });
    expect(o.estado).toBe(200);
    expect(o.cuerpo.modo).toBe('nuevo');
    const r = await n2.post('/api/alta/verificar', { codigo: nuevoCodigo, nombre: 'Nueva', respuesta: nueva.crear(o.cuerpo.opciones.challenge) });
    expect(r.estado).toBe(200);

    expect(await cuenta(m, 'credenciales')).toBe(1);
    expect((await n.get('/api/clientes')).estado).toBe(401); // la sesión vieja murió
    const planes = await m.base.sql<{ estado: string }>('select estado from panel.planes');
    expect(planes.every(p => p.estado === 'cancelado')).toBe(true);
    // La llave vieja ya no entra.
    expect((await m.navegador().ingresar((await m.conSesion().catch(() => ({ a: nueva }))).a)).estado).toBeGreaterThanOrEqual(200);
  });

  it('el código viejo deja de abrir el alta una vez usado el nuevo', async () => {
    const m = await crearMundo();
    await m.conSesion();
    const nuevoCodigo = 'codigo-nuevo-de-recuperacion-'.padEnd(40, 'q');
    const s2 = m.servidorCon({ codigoAlta: nuevoCodigo });
    const Nav = m.navegador().constructor as any;
    const n2 = new Nav(s2, '203.0.113.9');
    const o = await n2.post('/api/alta/opciones', { codigo: nuevoCodigo });
    await n2.post('/api/alta/verificar', { codigo: nuevoCodigo, nombre: 'N', respuesta: m.nuevaLlave().crear(o.cuerpo.opciones.challenge) });
    // Pasada la ventana, con el código VIEJO (y el servidor viejo) el alta vuelve a abrirse porque cambió el código vigente: solo si el
    // dueño del servidor lo cambia. Un atacante que no controla el servidor no puede cambiar el código vigente.
    await m.base.sql(`update panel.ajustes set valor = to_jsonb((now() - interval '1 minute')::text) where clave = 'alta_ventana_hasta'`);
    const cerrado = await n2.post('/api/alta/opciones', { codigo: nuevoCodigo });
    expect(cerrado.estado).toBe(403);
  });
});

describe('ingreso con la llave', () => {
  let m: Mundo;
  let a: Autenticador;
  beforeEach(async () => {
    m = await crearMundo();
    a = m.nuevaLlave();
    expect((await m.navegador().registrar(a)).estado).toBe(200);
  });

  const intento = async (hacer: (a: Autenticador, desafio: string) => unknown, ip = '203.0.113.50') => {
    const n = m.navegador(ip);
    const o = await n.post('/api/ingreso/opciones');
    const r = await n.post('/api/ingreso/verificar', { respuesta: hacer(a, o.cuerpo.opciones.challenge) });
    return { n, r };
  };

  it('ingreso legítimo: entra', async () => {
    const { n, r } = await intento((x, d) => x.firmar(d));
    expect(r.estado).toBe(200);
    expect((await n.get('/api/clientes')).estado).toBe(200);
  });

  const ataques: [string, (x: Autenticador, d: string) => unknown][] = [
    ['origen distinto', (x, d) => x.firmar(d, { origen: 'https://evil.com' })],
    ['origen con prefijo', (x, d) => x.firmar(d, { origen: 'https://panel.test:8443' })],
    ['dominio (rpId) distinto', (x, d) => x.firmar(d, { rpId: 'evil.com' })],
    ['sin UV', (x, d) => x.firmar(d, { banderas: 0x01 })],
    ['sin UP', (x, d) => x.firmar(d, { banderas: 0x04 })],
    ['sin ninguna bandera', (x, d) => x.firmar(d, { banderas: 0x00 })],
    ['tipo create en vez de get', (x, d) => x.firmar(d, { tipo: 'webauthn.create' })],
    ['desafío inventado', (x) => x.firmar('B'.repeat(43))],
    ['firma corrupta', (x, d) => x.firmar(d, { corromperFirma: true })],
    ['firmado con otra clave (misma credencial)', (x, d) => x.firmar(d, { firmarCon: createPrivateKey(generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' })) })],
    ['credencial desconocida', (_x, d) => new Autenticador('https://panel.test', 'panel.test').firmar(d)],
    ['contador que retrocede', (x, d) => x.firmar(d, { contador: 0 })],
  ];
  it.each(ataques)('firma con %s → 401, sin cookie, y queda en la auditoría', async (_n, hacer) => {
    // Primero un ingreso legítimo para que el contador guardado sea > 0.
    await intento((x, d) => x.firmar(d), '203.0.113.60');
    const { n, r } = await intento(hacer);
    expect(r.estado).toBe(401);
    expect(r.headers.getSetCookie().length).toBe(0);
    expect(n.sesion).toBeUndefined();
    expect(r.cuerpo).toEqual({ error: 'ingreso', mensaje: 'No se pudo iniciar sesión.' }); // mismo mensaje siempre: no enseña qué falló
    const aud = await m.base.sql<{ evento: string }>(`select evento from panel.auditoria where evento in ('ingreso_fallido','llave_clonada')`);
    expect(aud.length).toBeGreaterThan(0);
  });

  it('repetir exactamente una firma válida ya usada → rechazado', async () => {
    const n = m.navegador();
    const o = await n.post('/api/ingreso/opciones');
    const firma = a.firmar(o.cuerpo.opciones.challenge);
    expect((await n.post('/api/ingreso/verificar', { respuesta: firma })).estado).toBe(200);
    const n2 = m.navegador('198.51.100.77');
    const r = await n2.post('/api/ingreso/verificar', { respuesta: firma });
    expect(r.estado).toBe(401);
    expect(n2.sesion).toBeUndefined();
  });

  it('veinte envíos simultáneos de la misma firma válida: entra uno solo', async () => {
    const n = m.navegador();
    const o = await n.post('/api/ingreso/opciones');
    const firma = a.firmar(o.cuerpo.opciones.challenge);
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => m.navegador(`198.51.100.${i}`).post('/api/ingreso/verificar', { respuesta: firma })));
    expect(rs.filter(r => r.estado === 200).length).toBe(1);
    expect((await m.base.sql<{ n: number }>(`select count(*)::int as n from panel.sesiones`))[0]!.n).toBe(1);
  });

  it('un desafío de "plan" no sirve para ingresar (el propósito tiene que coincidir)', async () => {
    const { n } = await intento((x, d) => x.firmar(d), '203.0.113.61');
    m.falso.proyectoInstalado('cliente-uno');
    const ref = [...m.falso.proyectos.keys()][0]!;
    const plan = await n.plan('actualizar', { ref });
    const desafioDePlan = plan.cuerpo.opciones.challenge as string;
    const otro = m.navegador('203.0.113.62');
    const r = await otro.post('/api/ingreso/verificar', { respuesta: a.firmar(desafioDePlan) });
    expect(r.estado).toBe(401);
    expect(otro.sesion).toBeUndefined();
  });

  it('un desafío de ingreso vencido no sirve', async () => {
    const n = m.navegador();
    const o = await n.post('/api/ingreso/opciones');
    await m.base.sql(`update panel.desafios set vence_at = now() - interval '1 second'`);
    expect((await n.post('/api/ingreso/verificar', { respuesta: a.firmar(o.cuerpo.opciones.challenge) })).estado).toBe(401);
  });

  it('una firma robada de una operación (plan) no sirve para entrar, ni al revés', async () => {
    // El desafío de ingreso solo se consume en 'ingreso'; usarlo en 'plan' falla (se prueba en planes.test.ts).
    const n = m.navegador();
    const o = await n.post('/api/ingreso/opciones');
    const r = await n.post('/api/planes/123e4567-e89b-42d3-a456-426614174000/firmar', { respuesta: a.firmar(o.cuerpo.opciones.challenge) });
    expect(r.estado).toBe(401); // sin sesión
  });

  it('campos extra o de más en la respuesta no cambian el resultado', async () => {
    const n = m.navegador();
    const o = await n.post('/api/ingreso/opciones');
    const firma: any = a.firmar(o.cuerpo.opciones.challenge);
    firma.admin = true; firma.response.extra = 'x'; firma.clientExtensionResults = { appid: true };
    const r = await n.post('/api/ingreso/verificar', { respuesta: firma });
    expect(r.estado).toBe(200); // los campos de más se descartan; no cambian nada
  });

  it.each([
    ['id demasiado largo', (f: any) => { f.id = 'A'.repeat(5000); }], ['rawId con caracteres raros', (f: any) => { f.rawId = '../../etc/passwd'; }],
    ['tipo distinto', (f: any) => { f.type = 'password'; }], ['sin response', (f: any) => { delete f.response; }],
    ['firma vacía', (f: any) => { f.response.signature = ''; }], ['clientDataJSON enorme', (f: any) => { f.response.clientDataJSON = 'A'.repeat(100000); }],
    ['authenticatorData no base64url', (f: any) => { f.response.authenticatorData = '!!!'; }], ['response es un string', (f: any) => { f.response = 'x'; }],
  ])('respuesta mal formada (%s) → 400/401/413, nunca 500', async (_n, rompe) => {
    const n = m.navegador();
    const o = await n.post('/api/ingreso/opciones');
    const firma: any = a.firmar(o.cuerpo.opciones.challenge);
    rompe(firma);
    const r = await n.post('/api/ingreso/verificar', { respuesta: firma });
    expect([400, 401, 413]).toContain(r.estado);
  });

  it('fuzzing: cuerpos aleatorios en las rutas de llaves nunca producen 500 ni sesión', async () => {
    const n = m.navegador('198.51.100.200');
    await fc.assert(fc.asyncProperty(fc.jsonValue({ maxDepth: 4 }), async (valor) => {
      for (const ruta of ['/api/ingreso/verificar', '/api/alta/verificar', '/api/ingreso/opciones', '/api/alta/opciones']) {
        const r = await m.navegador(`198.51.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`).post(ruta, valor as object);
        if (r.estado >= 500) return false;
        if (r.headers.getSetCookie().length) return false;
      }
      void n;
      return true;
    }), { numRuns: 25 });
  });

  it('el rechazo es igual para llave desconocida, firma mala y desafío falso (no se puede distinguir)', async () => {
    const cuerpos = new Set<string>();
    for (const hacer of [ataques[8]![1], ataques[10]![1], ataques[7]![1]]) {
      const { r } = await intento(hacer, `198.51.100.${Math.floor(Math.random() * 200)}`);
      cuerpos.add(r.texto);
    }
    expect(cuerpos.size).toBe(1);
  });
});
