// ATAQUE 4 — Sesiones: robo, fijación, vencimiento, revocación.
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearMundo, type Mundo } from '../ayudas/mundo.ts';

let m: Mundo;
beforeEach(async () => { m = await crearMundo(); });

describe('cookie de sesión', () => {
  it('es larga, aleatoria y distinta en cada ingreso; en la base solo queda su hash', async () => {
    const { n, a } = await m.conSesion();
    const otro = m.navegador('198.51.100.1'); await otro.ingresar(a);
    expect(n.sesion).not.toBe(otro.sesion);
    expect(n.sesion!.length).toBeGreaterThanOrEqual(43);
    const filas = await m.base.sql<{ hash: string }>('select hash from panel.sesiones');
    expect(filas.length).toBe(2);
    for (const f of filas) {
      expect(f.hash).toMatch(/^[0-9a-f]{64}$/);
      expect([n.sesion, otro.sesion]).not.toContain(f.hash);
      expect(f.hash).not.toBe(createHash('sha256').update(n.sesion!).digest('hex')); // ni el hash simple: lleva un prefijo propio
    }
    const todo = JSON.stringify(await m.base.sql('select * from panel.sesiones'));
    expect(todo).not.toContain(n.sesion!);
  });

  it('fijación de sesión: una cookie puesta de antemano por el atacante no sirve ni se conserva', async () => {
    const { a } = await m.conSesion();
    const victima = m.navegador('198.51.100.2');
    const fijada = 'F'.repeat(43);
    victima.cookies.set('__Host-sid', fijada);
    const r = await victima.ingresar(a);
    expect(r.estado).toBe(200);
    expect(victima.sesion).not.toBe(fijada);
    const atacante = m.navegador('198.51.100.3');
    atacante.cookies.set('__Host-sid', fijada);
    expect((await atacante.get('/api/clientes')).estado).toBe(401);
  });
});

describe('vencimientos y revocación', () => {
  it('a los 15 minutos de inactividad la sesión muere', async () => {
    const { n } = await m.conSesion();
    expect((await n.get('/api/clientes')).estado).toBe(200);
    await m.base.sql(`update panel.sesiones set ultimo_uso_at = now() - interval '16 minutes'`);
    expect((await n.get('/api/clientes')).estado).toBe(401);
  });

  it('cada uso renueva la inactividad, pero el tope absoluto de 8 horas no se renueva', async () => {
    const { n } = await m.conSesion();
    await m.base.sql(`update panel.sesiones set ultimo_uso_at = now() - interval '14 minutes'`);
    expect((await n.get('/api/clientes')).estado).toBe(200); // renueva
    await m.base.sql(`update panel.sesiones set ultimo_uso_at = now() - interval '5 minutes'`);
    expect((await n.get('/api/clientes')).estado).toBe(200);
    await m.base.sql(`update panel.sesiones set vence_at = now() - interval '1 second'`);
    expect((await n.get('/api/clientes')).estado).toBe(401); // tope absoluto
  });

  it('salir revoca la sesión en el servidor: la cookie copiada antes ya no sirve', async () => {
    const { n } = await m.conSesion();
    const copiada = n.sesion!;
    expect((await n.post('/api/salida')).estado).toBe(200);
    const atacante = m.navegador();
    atacante.cookies.set('__Host-sid', copiada);
    expect((await atacante.get('/api/clientes')).estado).toBe(401);
  });

  it('salir sin cookie o con cookie falsa no falla ni revela nada', async () => {
    expect((await m.navegador().post('/api/salida')).estado).toBe(200);
    const n = m.navegador(); n.cookies.set('__Host-sid', 'Z'.repeat(43));
    expect((await n.post('/api/salida')).estado).toBe(200);
  });

  it('máximo 3 sesiones vivas: al abrir la cuarta, se cierra la más vieja', async () => {
    const { a } = await m.conSesion();
    const navs = [] as ReturnType<Mundo['navegador']>[];
    for (let i = 0; i < 4; i++) { const x = m.navegador(`198.51.100.${10 + i}`, `UA-${i}`); await x.ingresar(a); navs.push(x); }
    const vivas = await Promise.all(navs.map(async x => (await x.get('/api/clientes')).estado));
    expect(vivas).toEqual([401, 200, 200, 200]);
  });

  it('cambiar de navegador (User-Agent) con la misma cookie la revoca y avisa', async () => {
    const { n } = await m.conSesion();
    const ladron = m.navegador('198.51.100.30', 'Navegador-Del-Ladron/9.9');
    ladron.cookies.set('__Host-sid', n.sesion!);
    expect((await ladron.get('/api/clientes')).estado).toBe(401);
    expect((await n.get('/api/clientes')).estado).toBe(401); // la víctima también queda fuera: mejor perder la sesión que arriesgarla
    const aud = await m.base.sql<{ evento: string }>(`select evento from panel.auditoria where evento = 'sesion_otro_navegador'`);
    expect(aud.length).toBe(1);
    expect(m.alertas.some(t => t.includes('sesion_otro_navegador'))).toBe(true);
  });

  it('cambiar de IP no corta la sesión (en el celular la red cambia); el navegador sí cuenta', async () => {
    const { n } = await m.conSesion();
    n.ip = '198.51.100.99';
    expect((await n.get('/api/clientes')).estado).toBe(200);
  });

  it('pánico: cierra todas las sesiones, de todos los navegadores', async () => {
    const { n, a } = await m.conSesion();
    const otro = m.navegador('198.51.100.40', 'Otro/1.0'); await otro.ingresar(a);
    expect((await n.post('/api/panico')).estado).toBe(200);
    expect((await n.get('/api/clientes')).estado).toBe(401);
    expect((await otro.get('/api/clientes')).estado).toBe(401);
    // y se puede volver a entrar con la llave
    expect((await m.navegador('198.51.100.41').ingresar(a)).estado).toBe(200);
  });

  it('la cookie nunca viaja en el cuerpo de las respuestas', async () => {
    const { n } = await m.conSesion();
    for (const ruta of ['/api/estado', '/api/clientes', '/api/auditoria', '/api/modulos']) {
      expect((await n.get(ruta)).texto).not.toContain(n.sesion!);
    }
  });
});
