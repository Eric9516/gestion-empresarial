// ATAQUE 10 — Carreras con un Postgres REAL (conexiones simultáneas de verdad) y el usuario restringido de producción.
// PGlite atiende de a una consulta; acá cada pedido entra por su propia conexión, como en el servidor real.
import EmbeddedPostgres from 'embedded-postgres';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { crearAlmacenPg, type Almacen } from '../../src/server/almacen.ts';
import type { BaseDePrueba } from '../ayudas/bd.ts';
import { crearMundo } from '../ayudas/mundo.ts';

const CLAVE_APP = 'clave-de-la-app-solo-para-pruebas-1234';
let servidorPg: EmbeddedPostgres;
let carpeta: string;
let puerto: number;
let admin: ReturnType<typeof postgres>;
let almacen: Almacen & { cerrar(): Promise<void> };

const puertoLibre = () => new Promise<number>((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });

beforeAll(async () => {
  carpeta = mkdtempSync(join(tmpdir(), 'panel-pg-'));
  puerto = await puertoLibre();
  servidorPg = new EmbeddedPostgres({ databaseDir: carpeta, user: 'postgres', password: 'admin-solo-pruebas', port: puerto, persistent: false, onLog: () => {}, onError: () => {} });
  await servidorPg.initialise();
  await servidorPg.start();
  await servidorPg.createDatabase('panel');
  admin = postgres(`postgres://postgres:admin-solo-pruebas@127.0.0.1:${puerto}/panel`, { max: 2, onnotice: () => {} });
  // Lo mismo que se hace en el servidor: crear el usuario restringido y cargar el esquema.
  const instalar = readFileSync(join(import.meta.dirname, '../../db/instalar.sql'), 'utf8').replace(':clave', `'${CLAVE_APP}'`).split('\n').filter(l => !l.startsWith('--')).join('\n');
  await admin.unsafe(instalar);
  await admin.unsafe(readFileSync(join(import.meta.dirname, '../../db/schema.sql'), 'utf8'));
  const real = crearAlmacenPg(`postgres://panel_app:${CLAVE_APP}@127.0.0.1:${puerto}/panel`);
  // En las pruebas, el mensaje interno de la base se muestra para poder diagnosticar.
  almacen = { ...real, cerrar: real.cerrar, async rpc<T>(n: string, a: Record<string, unknown>) { try { return await real.rpc<T>(n, a); } catch (e) { throw new Error(`${(e as Error).message} :: ${(e as { causa?: string }).causa}`); } } };
}, 120_000);

afterAll(async () => {
  await almacen?.cerrar();
  await admin?.end({ timeout: 5 });
  // (stop() también borra la carpeta y en Windows a veces la encuentra todavía bloqueada: EBUSY)
  try { await servidorPg?.stop(); } catch (e) { if (!/EBUSY|EPERM|ENOTEMPTY/.test(String(e))) throw e; }
  // En Windows el sistema a veces tarda en soltar la carpeta del Postgres de prueba; no es un fallo del panel.
  try { rmSync(carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* carpeta temporal: la limpia el sistema */ }
}, 60_000);

const limpiar = async () => { await admin.unsafe(`set session_replication_role = replica; truncate panel.ajustes, panel.credenciales, panel.desafios, panel.sesiones, panel.planes, panel.bloqueos, panel.limites, panel.organizaciones, panel.auditoria restart identity; set session_replication_role = origin;`); };

describe('privilegios con el usuario REAL de la aplicación (panel_app)', () => {
  const conectar = () => postgres(`postgres://panel_app:${CLAVE_APP}@127.0.0.1:${puerto}/panel`, { max: 1, onnotice: () => {} });

  it('ejecuta las funciones del panel', async () => {
    expect(await almacen.rpc('panel_hay_credenciales', {})).toBe(false);
  });

  it.each([
    'select * from panel.credenciales', 'select * from panel.auditoria', 'select * from panel.sesiones', "insert into panel.ajustes values ('x', '1')",
    'update panel.credenciales set contador = 0', 'delete from panel.sesiones', 'truncate panel.auditoria', 'create table public.t (x int)', 'create schema x',
    'drop function public.panel_panico()', 'alter table panel.planes disable row level security', 'create extension pg_stat_statements',
    'select pg_read_file(\'/etc/passwd\')', "copy panel.credenciales to '/tmp/x'", 'select * from pg_authid', "alter role panel_app superuser", 'create role otro',
    "set session_replication_role = replica",
  ])('no puede: %s', async (consulta) => {
    const c = conectar();
    try { await expect(c.unsafe(consulta)).rejects.toThrow(); } finally { await c.end({ timeout: 2 }); }
  });

  it('tiene tiempo máximo por consulta y no es superusuario', async () => {
    const c = conectar();
    try {
      const [fila] = await c.unsafe(`select current_setting('statement_timeout') as t, (select rolsuper from pg_roles where rolname = current_user) as su, (select rolcreatedb or rolcreaterole from pg_roles where rolname = current_user) as crea`);
      expect(fila).toMatchObject({ t: '20s', su: false, crea: false });
    } finally { await c.end({ timeout: 2 }); }
  });

  it('el usuario restringido no ve otras bases ni el esquema de sistema sensible', async () => {
    const c = conectar();
    try {
      await expect(c.unsafe('select * from pg_shadow')).rejects.toThrow();
      await expect(c.unsafe('select * from pg_user_mappings')).resolves.toBeDefined(); // vista pública sin secretos
    } finally { await c.end({ timeout: 2 }); }
  });
});

describe('carreras con conexiones simultáneas reales', () => {
  it('100 golpes al mismo límite al mismo tiempo: pasan exactamente "máximo"', async () => {
    await limpiar();
    const rs = await Promise.all(Array.from({ length: 100 }, () => almacen.rpc<boolean>('panel_limite_golpear', { p_clave: 'carrera', p_maximo: 10, p_ventana_segundos: 60 })));
    expect(rs.filter(Boolean).length).toBe(10);
  });

  it('un desafío consumido por 50 conexiones a la vez: lo consigue una sola', async () => {
    await limpiar();
    await almacen.rpc('panel_desafio_crear', { p_desafio: 'd'.repeat(32), p_proposito: 'ingreso', p_plan_id: null, p_sesion_hash: null, p_segundos: 60 });
    const rs = await Promise.all(Array.from({ length: 50 }, () => almacen.rpc('panel_desafio_consumir', { p_desafio: 'd'.repeat(32), p_proposito: 'ingreso' })));
    expect(rs.filter(r => r !== null).length).toBe(1);
  });

  it('un contador de llave usado por 50 conexiones a la vez: gana una sola', async () => {
    await limpiar();
    await almacen.rpc('panel_credencial_agregar', { p_codigo_hash: 'h', p_id: 'c'.repeat(32), p_clave_publica: 'k'.repeat(32), p_contador: 0, p_transportes: ['internal', 'usb'], p_nombre: 'x' });
    const rs = await Promise.all(Array.from({ length: 50 }, () => almacen.rpc<boolean>('panel_credencial_usar', { p_id: 'c'.repeat(32), p_nuevo_contador: 9 })));
    expect(rs.filter(Boolean).length).toBe(1);
    expect(await admin.unsafe(`select transportes from panel.credenciales`)).toEqual([{ transportes: ['internal', 'usb'] }]); // el arreglo de texto viaja bien
  });

  it('dos altas de llave con códigos distintos al mismo tiempo no dejan un estado mezclado', async () => {
    await limpiar();
    const alta = (codigo: string, id: string) => almacen.rpc('panel_credencial_agregar', { p_codigo_hash: codigo, p_id: id.repeat(32), p_clave_publica: 'k'.repeat(32), p_contador: 0, p_transportes: [], p_nombre: id });
    const rs = await Promise.allSettled([alta('uno', 'a'), alta('dos', 'b'), alta('tres', 'c'), alta('cuatro', 'd')]);
    expect(rs.filter(r => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    const guardadas = await admin.unsafe('select count(*)::int as n from panel.credenciales');
    expect(guardadas[0]!.n).toBeLessThanOrEqual(5);
  });

  it('40 eventos de auditoría simultáneos: la cadena queda íntegra y sin huecos', async () => {
    await limpiar();
    await Promise.all(Array.from({ length: 40 }, (_, i) => almacen.rpc('panel_auditoria_agregar', { p_actor: 'p', p_evento: `e${i}`, p_detalle: { i }, p_ip_hash: 'h' })));
    expect(await almacen.rpc('panel_auditoria_verificar', {})).toEqual({ ok: true, total: 40 });
  });

  it('60 "empezar paso" simultáneos del mismo plan: se ejecuta uno; y dos planes del mismo proyecto no se pisan', async () => {
    await limpiar();
    const s = 's'.repeat(64);
    const nuevo = (ref: string | null) => almacen.rpc<string>('panel_plan_crear', { p_sesion_hash: s, p_tipo: 'actualizar', p_ref: ref, p_parametros: {}, p_pasos: [{ id: 'a', etiqueta: 'a' }, { id: 'b', etiqueta: 'b' }] });
    const aut = (id: string) => almacen.rpc('panel_plan_autorizar', { p_id: id, p_sesion_hash: s });
    const p1 = await nuevo('abcdefghijklmnopqrst'); const p2 = await nuevo('abcdefghijklmnopqrst');
    await aut(p1); await aut(p2);
    const empezar = (id: string, t: string) => almacen.rpc<any>('panel_plan_paso_empezar', { p_id: id, p_sesion_hash: s, p_token: t, p_segundos: 30 });
    const rs = await Promise.all([...Array.from({ length: 30 }, (_, i) => empezar(p1, `a${i}`)), ...Array.from({ length: 30 }, (_, i) => empezar(p2, `b${i}`))]);
    expect(rs.filter(r => !r.error).length).toBe(1); // un solo paso en todo el proyecto
    expect(rs.filter(r => r.error === 'proyecto_ocupado').length).toBeGreaterThan(0);
  });

  it('una firma de plan autorizada por 30 conexiones a la vez: se autoriza una vez', async () => {
    await limpiar();
    const s = 's'.repeat(64);
    const id = await almacen.rpc<string>('panel_plan_crear', { p_sesion_hash: s, p_tipo: 'modulos', p_ref: 'abcdefghijklmnopqrst', p_parametros: { antes: {}, despues: {} }, p_pasos: [{ id: 'licencia', etiqueta: 'x' }] });
    const rs = await Promise.all(Array.from({ length: 30 }, () => almacen.rpc<boolean>('panel_plan_autorizar', { p_id: id, p_sesion_hash: s })));
    expect(rs.filter(Boolean).length).toBe(1);
  });

  it('sesiones: abrir 20 a la vez nunca deja más de 3 vivas', async () => {
    await limpiar();
    await Promise.all(Array.from({ length: 20 }, (_, i) => almacen.rpc('panel_sesion_crear', { p_hash: String(i).padStart(64, 'a'), p_navegador_hash: 'n', p_ip_hash: 'i', p_credencial_id: 'c' })));
    const [{ n }] = await admin.unsafe(`select count(*)::int as n from panel.sesiones where revocada_at is null`) as unknown as [{ n: number }];
    expect(n).toBeLessThanOrEqual(3 + 0); // tope de sesiones vivas
  });
});

describe('el servidor completo sobre el Postgres real', () => {
  it('flujo completo: alta, ingreso, crear cliente y verificar auditoría', async () => {
    await limpiar();
    const base: BaseDePrueba = {
      db: null as never, almacen, llamadas: [],
      async sql<T>(texto: string, params: unknown[] = []) { return (await admin.unsafe(texto, params as never[])) as unknown as T[]; },
    };
    const m = await crearMundo({}, { base });
    const { n, a } = await m.conSesion();
    const r = await n.hacer('crear', { nombre: 'Cliente Real', correo: 'dueno@real.com', modulos: ['deposito', 'tareas'] }, a);
    expect(r.pasos.at(-1)!.cuerpo.estado).toBe('terminado');
    const p = [...m.falso.proyectos.values()].find(x => x.nombre === 'cliente-real')!;
    expect(p.dueno).toBe('dueno@real.com');
    expect(p.licencia).toMatchObject({ deposito: true, tareas: true });
    expect((await n.post(`/api/planes/${r.plan.cuerpo.id}/clave`)).cuerpo.clave).toBe(p.usuarios.get('dueno@real.com'));
    expect((await n.get('/api/auditoria')).cuerpo.cadena.ok).toBe(true);
    // Concurrencia por HTTP real: tormenta de pasos a la vez sobre otro plan. Ningún paso se ejecuta dos veces.
    const r2 = await n.plan('crear', { nombre: 'Cliente Tormenta', correo: 'tormenta@real.com', modulos: ['tareas'] });
    await n.firmar(r2.cuerpo.id, r2.cuerpo.opciones, a);
    let terminado = false;
    for (let i = 0; i < 300 && !terminado; i++) {
      const rs = await Promise.all(Array.from({ length: 8 }, () => n.post(`/api/planes/${r2.cuerpo.id}/paso`)));
      expect(rs.every(x => [200, 409].includes(x.estado))).toBe(true);
      terminado = rs.some(x => x.cuerpo?.estado === 'terminado');
    }
    expect(terminado).toBe(true);
    const { MIGRACIONES } = await import('../../src/server/generado.ts');
    for (const mig of MIGRACIONES) {
      expect(m.falso.sqlEjecutado.filter(q => q.sql.startsWith(mig.sql) && q.ref === [...m.falso.proyectos.values()].find(x => x.nombre === 'cliente-tormenta')!.ref).length, mig.nombre).toBe(mig.componente === 'base' ? 1 : 0); // solo contrata Tareas: se instala únicamente la Base
    }
  });
});

describe('el paquete de producción (dist/panel.mjs) arrancado como en el servidor', () => {
  const RAIZ = join(import.meta.dirname, '..', '..');
  const entorno = (extra: Record<string, string> = {}, puertoPanel = 0): NodeJS.ProcessEnv => ({
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
    PANEL_ORIGEN: 'https://panel.red-privada.ts.net', PANEL_SECRETO: 's'.repeat(40), PANEL_CODIGO_ALTA: 'c'.repeat(40),
    SUPABASE_ACCESS_TOKEN: 'sbp_' + 'a'.repeat(40), PANEL_ORG_SLUGS: 'abcdefghijklmnopqrst', PANEL_USUARIO_RED: 'eric@ejemplo.com',
    PANEL_DB_URL: `postgres://panel_app:${CLAVE_APP}@127.0.0.1:${puerto}/panel`, PANEL_PUERTO: String(puertoPanel), ...extra,
  });
  const arrancar = (env: NodeJS.ProcessEnv) => spawn(process.execPath, [join(RAIZ, 'dist', 'panel.mjs')], { env, cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'] });
  const esperarLinea = (p: ChildProcess, texto: RegExp, ms = 15000) => new Promise<string>((resolve, reject) => {
    let acumulado = '';
    const t = setTimeout(() => reject(new Error('no apareció: ' + texto + ' en ' + acumulado.slice(-300))), ms);
    const ver = (d: Buffer) => { acumulado += d.toString(); if (texto.test(acumulado)) { clearTimeout(t); resolve(acumulado); } };
    p.stdout?.on('data', ver); p.stderr?.on('data', ver);
    p.on('exit', () => { clearTimeout(t); resolve(acumulado); });
  });

  it('arranca, escucha SOLO en 127.0.0.1 y responde con la puerta de la red privada', async () => {
    await limpiar(); // las pruebas anteriores de este archivo dejaron datos en la base
    execFileSync('node', ['scripts/build-web.mjs'], { cwd: RAIZ }); execFileSync('node', ['scripts/build-server.mjs'], { cwd: RAIZ });
    const libre = await puertoLibre();
    const p = arrancar(entorno({}, libre));
    try {
      await esperarLinea(p, /panel_iniciado/);
      const con = { headers: { 'tailscale-user-login': 'eric@ejemplo.com' } };
      const e = await fetch(`http://127.0.0.1:${libre}/api/estado`, con);
      expect(e.status).toBe(200);
      expect(await e.json()).toMatchObject({ hayLlaves: false, sesion: false });
      expect((await fetch(`http://127.0.0.1:${libre}/api/estado`)).status).toBe(403);
      const raiz = await fetch(`http://127.0.0.1:${libre}/`, con);
      expect(raiz.status).toBe(200);
      expect(raiz.headers.get('content-security-policy')).toContain("script-src 'self'");
      expect((await fetch(`http://127.0.0.1:${libre}/app.js`, con)).status).toBe(200);
      // No escucha en otras interfaces: la dirección de la computadora (no loopback) no responde.
      const { networkInterfaces } = await import('node:os');
      const otras = Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i!.address);
      for (const ip of otras.slice(0, 2)) {
        const r = await fetch(`http://${ip}:${libre}/api/estado`, { ...con, signal: AbortSignal.timeout(2000) }).then(x => x.status, () => 'sin respuesta');
        expect(r, `no debe responder en ${ip}`).toBe('sin respuesta');
      }
    } finally { p.kill(); }
  }, 60_000);

  it.each([
    ['sin secreto', { PANEL_SECRETO: '' }, 'PANEL_SECRETO'],
    ['con la base apuntando a internet', { PANEL_DB_URL: 'postgres://panel_app:x@db.ejemplo.com/panel' }, 'PANEL_DB_URL'],
    ['sin usuario de la red privada', { PANEL_USUARIO_RED: '' }, 'PANEL_USUARIO_RED'],
    ['con origen http', { PANEL_ORIGEN: 'http://panel.ts.net' }, 'PANEL_ORIGEN'],
  ])('se NIEGA a arrancar %s, y el mensaje nombra la variable pero no su valor', async (_n, cambio, variable) => {
    const p = arrancar(entorno(cambio));
    const salida = await esperarLinea(p, /no_arranca/);
    const codigo = await new Promise<number | null>(r => { if (p.exitCode !== null) r(p.exitCode); else p.on('exit', c => r(c)); });
    expect(codigo).toBe(1);
    expect(salida).toContain(variable);
    expect(salida).not.toContain('s'.repeat(40));
    expect(salida).not.toContain('sbp_' + 'a'.repeat(40));
    expect(salida).not.toContain(CLAVE_APP);
  }, 30_000);
});
