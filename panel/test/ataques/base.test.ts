// ATAQUE 5 — La base de datos: permisos mínimos, funciones atómicas, auditoría inviolable.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearMundo, type Mundo } from '../ayudas/mundo.ts';

let m: Mundo;
beforeEach(async () => { m = await crearMundo(); });

async function como<T>(rol: string, fn: () => Promise<T>): Promise<T> {
  await m.base.db.exec(`set role ${rol}`);
  try { return await fn(); } finally { await m.base.db.exec('reset role'); }
}

describe('privilegios', () => {
  it.each(['anon', 'authenticated', 'service_role'])('el rol %s no puede ejecutar ninguna función del panel', async (rol) => {
    const funciones = await m.base.sql<{ proname: string }>(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname like 'panel\\_%'`);
    expect(funciones.length).toBeGreaterThan(15);
    for (const f of funciones) {
      const permitido = await m.base.sql<{ ok: boolean }>(`select has_function_privilege($1, p.oid, 'execute') as ok from pg_proc p where p.proname = $2`, [rol, f.proname]);
      expect(permitido[0]!.ok, `${rol} → ${f.proname}`).toBe(false);
    }
  });

  it('panel_app ejecuta las funciones pero no toca tablas, ni esquemas, ni crea nada', async () => {
    await expect(como('panel_app', async () => (await m.base.sql<{ r: boolean }>('select public.panel_hay_credenciales() as r'))[0]!.r)).resolves.toBe(false);
    for (const q of [
      'select * from panel.credenciales', 'select * from panel.sesiones', 'select * from panel.auditoria', 'insert into panel.ajustes values (\'x\', \'1\')',
      'update panel.credenciales set contador = 0', 'delete from panel.sesiones', 'truncate panel.auditoria', 'create table public.t (x int)', 'create schema x',
      'drop function public.panel_panico()', 'alter table panel.planes disable row level security', 'create function public.f() returns int language sql as \'select 1\'',
    ]) {
      await expect(como('panel_app', () => m.base.db.query(q)), q).rejects.toThrow();
    }
  });

  it('todas las funciones son SECURITY DEFINER con search_path vacío (nadie las puede "sombrear")', async () => {
    const f = await m.base.sql<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(`select proname, prosecdef, proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','panel') and (proname like 'panel\\_%' or n.nspname = 'panel')`);
    expect(f.length).toBeGreaterThan(20);
    for (const x of f) {
      expect(x.proconfig?.some(c => /^search_path=("")?$/.test(c) || c === 'search_path=""' || c.startsWith('search_path='))).toBe(true);
      if (x.proname.startsWith('panel_')) expect(x.prosecdef, x.proname).toBe(true);
    }
  });

  it('todas las tablas del panel tienen seguridad por filas activada y ninguna política abierta', async () => {
    const t = await m.base.sql<{ relname: string; relrowsecurity: boolean }>(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'panel' and c.relkind = 'r'`);
    expect(t.length).toBe(9);
    expect(t.every(x => x.relrowsecurity)).toBe(true);
    expect((await m.base.sql('select * from pg_policies where schemaname = \'panel\'')).length).toBe(0);
  });
});

describe('auditoría inviolable', () => {
  async function registrarEventos(n = 5) { for (let i = 0; i < n; i++) await m.base.almacen.rpc('panel_auditoria_agregar', { p_actor: 'prueba', p_evento: `evento_${i}`, p_detalle: { i }, p_ip_hash: 'h' }); }

  it('no se puede modificar, borrar ni vaciar', async () => {
    await registrarEventos();
    await expect(m.base.db.query(`update panel.auditoria set evento = 'otro' where seq = 1`)).rejects.toThrow(/no se puede modificar/);
    await expect(m.base.db.query(`delete from panel.auditoria where seq = 1`)).rejects.toThrow(/no se puede modificar/);
    await expect(m.base.db.query(`truncate panel.auditoria`)).rejects.toThrow(/no se puede modificar/);
    expect(((await m.base.almacen.rpc('panel_auditoria_verificar', {})) as any).ok).toBe(true);
  });

  it('si alguien con acceso total apaga los triggers y edita, la cadena lo delata (y dónde)', async () => {
    await registrarEventos(6);
    await m.base.db.exec(`set session_replication_role = replica; update panel.auditoria set detalle = '{"i": 999}' where seq = 3; set session_replication_role = origin;`);
    const r: any = await m.base.almacen.rpc('panel_auditoria_verificar', {});
    expect(r).toEqual({ ok: false, roto_en: 3 });
  });

  it('borrar un registro del medio también se detecta', async () => {
    await registrarEventos(6);
    await m.base.db.exec(`set session_replication_role = replica; delete from panel.auditoria where seq = 2; set session_replication_role = origin;`);
    expect(((await m.base.almacen.rpc('panel_auditoria_verificar', {})) as any).ok).toBe(false);
  });

  it('cambiar el último registro (sin otro que lo "ate") se detecta con el hash propio', async () => {
    await registrarEventos(3);
    await m.base.db.exec(`set session_replication_role = replica; update panel.auditoria set actor = 'falso' where seq = 3; set session_replication_role = origin;`);
    expect(((await m.base.almacen.rpc('panel_auditoria_verificar', {})) as any).ok).toBe(false);
  });

  it('cuarenta altas simultáneas dejan una cadena íntegra y sin huecos', async () => {
    await Promise.all(Array.from({ length: 40 }, (_, i) => m.base.almacen.rpc('panel_auditoria_agregar', { p_actor: 'p', p_evento: `e${i}`, p_detalle: { i }, p_ip_hash: 'h' })));
    const r: any = await m.base.almacen.rpc('panel_auditoria_verificar', {});
    expect(r).toEqual({ ok: true, total: 40 });
    const seqs = (await m.base.sql<{ seq: string }>('select seq from panel.auditoria order by seq')).map(x => Number(x.seq));
    expect(seqs).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  });

  it('no acepta datos desmedidos (actor/evento largos se recortan o se rechazan)', async () => {
    const h: string = await m.base.almacen.rpc('panel_auditoria_agregar', { p_actor: 'x'.repeat(500), p_evento: 'y'.repeat(500), p_detalle: { a: 'z'.repeat(100000) }, p_ip_hash: 'h'.repeat(500) });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    const fila = (await m.base.sql<{ actor: string; evento: string; ip_hash: string }>('select actor, evento, ip_hash from panel.auditoria'))[0]!;
    expect(fila.actor.length).toBeLessThanOrEqual(60);
    expect(fila.evento.length).toBeLessThanOrEqual(80);
    expect(fila.ip_hash.length).toBeLessThanOrEqual(64);
  });
});

describe('contador de llaves (llaves clonadas)', () => {
  const alta = async () => m.base.almacen.rpc('panel_credencial_agregar', { p_codigo_hash: 'h', p_id: 'c'.repeat(32), p_clave_publica: 'k'.repeat(32), p_contador: 0, p_transportes: ['internal'], p_nombre: 'x' });
  const usar = (c: number) => m.base.almacen.rpc<boolean>('panel_credencial_usar', { p_id: 'c'.repeat(32), p_nuevo_contador: c });

  it('el contador solo puede subir', async () => {
    await alta();
    expect(await usar(1)).toBe(true);
    expect(await usar(1)).toBe(false); // igual: repetición
    expect(await usar(0)).toBe(false); // retrocede
    expect(await usar(5)).toBe(true);
    expect(await usar(4)).toBe(false);
  });
  it('las llaves que no cuentan (siempre 0) se aceptan solo mientras estén en 0', async () => {
    await alta();
    expect(await usar(0)).toBe(true);
    expect(await usar(0)).toBe(true);
    expect(await usar(3)).toBe(true);
    expect(await usar(0)).toBe(false);
  });
  it('una credencial inexistente nunca "sirve"', async () => {
    expect(await m.base.almacen.rpc<boolean>('panel_credencial_usar', { p_id: 'no-existe-'.repeat(4), p_nuevo_contador: 5 })).toBe(false);
  });
  it('cincuenta usos simultáneos del mismo contador: gana uno solo', async () => {
    await alta();
    const rs = await Promise.all(Array.from({ length: 50 }, () => usar(7)));
    expect(rs.filter(Boolean).length).toBe(1);
  });
});

describe('límites de velocidad', () => {
  const golpear = (clave: string, max = 3, seg = 60) => m.base.almacen.rpc<boolean>('panel_limite_golpear', { p_clave: clave, p_maximo: max, p_ventana_segundos: seg });

  it('corta justo en el máximo, por clave', async () => {
    expect([await golpear('a'), await golpear('a'), await golpear('a'), await golpear('a')]).toEqual([true, true, true, false]);
    expect(await golpear('b')).toBe(true);
  });
  it('cien golpes simultáneos: pasan exactamente "máximo"', async () => {
    const rs = await Promise.all(Array.from({ length: 100 }, () => golpear('simultaneo', 10)));
    expect(rs.filter(Boolean).length).toBe(10);
  });
  it('parámetros absurdos se rechazan', async () => {
    await expect(golpear('x', 0)).rejects.toThrow();
    await expect(golpear('x', 5, 0)).rejects.toThrow();
    await expect(golpear('x', 5, 999999)).rejects.toThrow();
  });
  it('una clave larguísima no desborda ni rompe la tabla', async () => {
    expect(await golpear('k'.repeat(10000))).toBe(true);
    expect((await m.base.sql<{ clave: string }>('select clave from panel.limites'))[0]!.clave.length).toBeLessThanOrEqual(120);
  });
});

describe('desafíos', () => {
  const crear = (d: string, p = 'ingreso', s = 60) => m.base.almacen.rpc('panel_desafio_crear', { p_desafio: d, p_proposito: p, p_plan_id: null, p_sesion_hash: null, p_segundos: s });
  const consumir = (d: string, p = 'ingreso') => m.base.almacen.rpc<any>('panel_desafio_consumir', { p_desafio: d, p_proposito: p });

  it('se usan una sola vez y solo para su propósito', async () => {
    await crear('d'.repeat(30));
    expect(await consumir('d'.repeat(30), 'alta')).toBeNull();
    expect(await consumir('d'.repeat(30), 'plan')).toBeNull();
    expect(await consumir('d'.repeat(30))).not.toBeNull();
    expect(await consumir('d'.repeat(30))).toBeNull();
  });
  it('vigencia máxima de 5 minutos y mínima de 10 segundos', async () => {
    await expect(crear('e'.repeat(30), 'ingreso', 301)).rejects.toThrow();
    await expect(crear('e'.repeat(30), 'ingreso', 5)).rejects.toThrow();
  });
  it('propósito desconocido y largos absurdos se rechazan', async () => {
    await expect(crear('f'.repeat(30), 'admin')).rejects.toThrow();
    await expect(crear('corto')).rejects.toThrow();
    await expect(crear('g'.repeat(1000))).rejects.toThrow();
  });
  it('no más de 100 pendientes a la vez (no se puede inundar la tabla)', async () => {
    for (let i = 0; i < 100; i++) await crear(`r${String(i).padStart(3, '0')}`.padEnd(30, 'x'));
    await expect(crear('uno-mas'.padEnd(30, '0'))).rejects.toMatchObject({ codigoSql: '53400' });
  });
});

describe('máquina de estados de los planes (llamando directo a la base)', () => {
  const crearPlan = (extra: Record<string, unknown> = {}) => m.base.almacen.rpc<string>('panel_plan_crear', { p_sesion_hash: 's'.repeat(64), p_tipo: 'actualizar', p_ref: 'abcdefghijklmnopqrst', p_parametros: {}, p_pasos: [{ id: 'a', etiqueta: 'a' }, { id: 'b', etiqueta: 'b' }], ...extra });
  const empezar = (id: string, token = 't1') => m.base.almacen.rpc<any>('panel_plan_paso_empezar', { p_id: id, p_sesion_hash: 's'.repeat(64), p_token: token, p_segundos: 30 });
  const terminar = (id: string, token: string, indice: number, resultado = 'ok') => m.base.almacen.rpc<any>('panel_plan_paso_terminar', { p_id: id, p_token: token, p_indice: indice, p_resultado: resultado, p_contexto: {}, p_error: null, p_ref: null });
  const autorizar = (id: string) => m.base.almacen.rpc<boolean>('panel_plan_autorizar', { p_id: id, p_sesion_hash: 's'.repeat(64) });

  it('no se ejecuta sin autorizar; se autoriza una sola vez', async () => {
    const id = await crearPlan();
    expect((await empezar(id)).error).toBe('estado');
    expect(await autorizar(id)).toBe(true);
    expect(await autorizar(id)).toBe(false);
  });
  it('solo avanza con el token del arriendo y para el paso esperado', async () => {
    const id = await crearPlan(); await autorizar(id);
    const e = await empezar(id, 'bueno');
    expect(e.indice).toBe(0);
    expect((await terminar(id, 'malo', 0)).error).toBe('arriendo');
    expect((await terminar(id, 'bueno', 1)).error).toBe('arriendo');
    expect((await terminar(id, 'bueno', 0)).estado).toBe('en_curso');
    expect((await terminar(id, 'bueno', 0)).error).toBe('arriendo'); // ya cerrado: no se puede cerrar dos veces
    const e2 = await empezar(id, 'otro');
    expect(e2.indice).toBe(1);
    expect((await terminar(id, 'otro', 1)).estado).toBe('terminado');
    expect((await empezar(id, 'mas')).error).toBe('estado');
  });
  it('un plan cancelado o fallido no se puede reanimar', async () => {
    const id = await crearPlan(); await autorizar(id);
    const e = await empezar(id, 't'); expect(e.error).toBeUndefined();
    await terminar(id, 't', 0, 'fallo');
    expect((await empezar(id, 'x')).error).toBe('estado');
    expect(await autorizar(id)).toBe(false);
  });
  it('límites: sin pasos, demasiados pasos, no-arreglo y muchos pendientes', async () => {
    await expect(crearPlan({ p_pasos: [] })).rejects.toThrow();
    await expect(crearPlan({ p_pasos: Array.from({ length: 61 }, () => ({ id: 'x' })) })).rejects.toThrow();
    await expect(crearPlan({ p_pasos: { a: 1 } })).rejects.toThrow();
    await expect(crearPlan({ p_tipo: 'borrar' })).rejects.toThrow();
    await expect(crearPlan({ p_ref: 'no-es-un-ref' })).rejects.toThrow();
    for (let i = 0; i < 5; i++) await crearPlan();
    await expect(crearPlan()).rejects.toMatchObject({ codigoSql: '53400' });
  });
  it('otra sesión no obtiene ni autoriza un plan ajeno', async () => {
    const id = await crearPlan();
    expect(await m.base.almacen.rpc('panel_plan_obtener', { p_id: id, p_sesion_hash: 'x'.repeat(64) })).toBeNull();
    expect(await m.base.almacen.rpc<boolean>('panel_plan_autorizar', { p_id: id, p_sesion_hash: 'x'.repeat(64) })).toBe(false);
    expect((await m.base.almacen.rpc<any>('panel_plan_paso_empezar', { p_id: id, p_sesion_hash: 'x'.repeat(64), p_token: 't', p_segundos: 30 })).error).toBe('no_existe');
  });
  it('cien "empezar paso" simultáneos: gana uno solo', async () => {
    const id = await crearPlan(); await autorizar(id);
    const rs = await Promise.all(Array.from({ length: 100 }, (_, i) => empezar(id, `t${i}`)));
    expect(rs.filter(r => !r.error).length).toBe(1);
  });
});

describe('sesiones y alta (directo a la base)', () => {
  it('el alta nueva borra todo lo anterior', async () => {
    await m.base.almacen.rpc('panel_credencial_agregar', { p_codigo_hash: 'uno', p_id: 'a'.repeat(32), p_clave_publica: 'k'.repeat(32), p_contador: 0, p_transportes: [], p_nombre: 'a' });
    await m.base.almacen.rpc('panel_sesion_crear', { p_hash: 'a'.repeat(64), p_navegador_hash: 'n', p_ip_hash: 'i', p_credencial_id: 'a'.repeat(32) });
    await m.base.almacen.rpc('panel_credencial_agregar', { p_codigo_hash: 'dos', p_id: 'b'.repeat(32), p_clave_publica: 'k'.repeat(32), p_contador: 0, p_transportes: [], p_nombre: 'b' });
    expect((await m.base.sql<{ id: string }>('select id from panel.credenciales')).map(x => x.id)).toEqual(['b'.repeat(32)]);
    expect(await m.base.almacen.rpc('panel_sesion_validar', { p_hash: 'a'.repeat(64), p_navegador_hash: 'n' })).toBeNull();
  });
  it('la misma credencial dos veces se rechaza', async () => {
    const args = { p_codigo_hash: 'uno', p_id: 'a'.repeat(32), p_clave_publica: 'k'.repeat(32), p_contador: 0, p_transportes: [], p_nombre: 'a' };
    await m.base.almacen.rpc('panel_credencial_agregar', args);
    await expect(m.base.almacen.rpc('panel_credencial_agregar', args)).rejects.toThrow();
  });
});
