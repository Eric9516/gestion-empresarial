// ATAQUE 3 — Planes: nadie ejecuta nada sin firma; concurrencia; fallas; alcance (solo la organización de clientes).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migracionesDe } from '../../src/server/componentes.ts';
import { MIGRACIONES } from '../../src/server/generado.ts';
import { Autenticador } from '../ayudas/autenticador.ts';
import { crearMundo, llamadasFueraDeLista, type Mundo, type Navegador } from '../ayudas/mundo.ts';
import { ORG } from '../ayudas/supabaseFalso.ts';

let m: Mundo;
let n: Navegador;
let a: Autenticador;
const VALIDO = { nombre: 'Cliente Prueba', correo: 'dueno@prueba.com', modulos: ['deposito'] };

beforeEach(async () => {
  m = await crearMundo();
  ({ n, a } = await m.conSesion());
});
afterEach(() => {
  // Regla de oro: pase lo que pase en la prueba, el panel nunca le pidió a Supabase nada fuera de su lista.
  expect(llamadasFueraDeLista(m.falso.llamadas)).toEqual([]);
  expect(m.falso.llamadas.some(l => l.metodo === 'DELETE')).toBe(false);
});

const estadoPlan = async (id: string) => (await m.base.sql<{ estado: string }>('select estado from panel.planes where id = $1', [id]))[0]?.estado;
const instalado = () => { const p = m.falso.proyectoInstalado('instalado-uno', ['deposito']); return p; };

describe('nada se ejecuta sin la firma de la llave', () => {
  it('un plan sin firmar no puede ejecutar pasos', async () => {
    const plan = await n.plan('crear', VALIDO);
    expect(plan.estado).toBe(201);
    const r = await n.post(`/api/planes/${plan.cuerpo.id}/paso`);
    expect(r.estado).toBe(409);
    expect(m.falso.llamadas.filter(l => l.metodo !== 'GET').length).toBe(0);
  });

  it('con la sesión robada pero SIN la llave no se puede firmar (llave ajena)', async () => {
    const plan = await n.plan('crear', VALIDO);
    const intruso = m.nuevaLlave(); // el atacante tiene su propia llave, no la registrada
    const r = await n.firmar(plan.cuerpo.id, plan.cuerpo.opciones, intruso);
    expect(r.estado).toBe(401);
    expect(await estadoPlan(plan.cuerpo.id)).toBe('pendiente');
  });

  it('una firma de INGRESO no autoriza un plan', async () => {
    const plan = await n.plan('crear', VALIDO);
    const o = await m.navegador('198.51.100.5').post('/api/ingreso/opciones');
    const r = await n.post(`/api/planes/${plan.cuerpo.id}/firmar`, { respuesta: a.firmar(o.cuerpo.opciones.challenge) });
    expect(r.estado).toBe(401);
    expect(await estadoPlan(plan.cuerpo.id)).toBe('pendiente');
  });

  it('la firma del plan A no autoriza el plan B (cambio de desafío)', async () => {
    const A = await n.plan('crear', VALIDO);
    const B = await n.plan('crear', { ...VALIDO, nombre: 'Otro Cliente' });
    const r = await n.post(`/api/planes/${B.cuerpo.id}/firmar`, { respuesta: a.firmar(A.cuerpo.opciones.challenge) });
    expect(r.estado).toBe(403);
    expect(await estadoPlan(B.cuerpo.id)).toBe('pendiente');
    expect(await estadoPlan(A.cuerpo.id)).toBe('pendiente'); // el desafío de A quedó quemado, pero A no se autorizó
  });

  it('una firma válida no se puede reutilizar', async () => {
    const plan = await n.plan('crear', VALIDO);
    const firma = a.firmar(plan.cuerpo.opciones.challenge);
    expect((await n.post(`/api/planes/${plan.cuerpo.id}/firmar`, { respuesta: firma })).estado).toBe(200);
    expect((await n.post(`/api/planes/${plan.cuerpo.id}/firmar`, { respuesta: firma })).estado).toBe(401);
  });

  it('un plan ya firmado no se vuelve a firmar ni pide otro desafío', async () => {
    const plan = await n.plan('crear', VALIDO);
    expect((await n.firmar(plan.cuerpo.id, plan.cuerpo.opciones, a)).estado).toBe(200);
    expect((await n.post(`/api/planes/${plan.cuerpo.id}/desafio`)).estado).toBe(409);
  });

  it('un plan vencido (10 minutos sin firmar) no se puede firmar', async () => {
    const plan = await n.plan('crear', VALIDO);
    await m.base.sql(`update panel.planes set vence_at = now() - interval '1 second'`);
    const r = await n.firmar(plan.cuerpo.id, plan.cuerpo.opciones, a);
    expect(r.estado).toBe(409);
    expect(await estadoPlan(plan.cuerpo.id)).toBe('pendiente');
  });

  it('diez firmas simultáneas del mismo plan: se autoriza una sola vez', async () => {
    const plan = await n.plan('crear', VALIDO);
    const firma = a.firmar(plan.cuerpo.opciones.challenge);
    const rs = await Promise.all(Array.from({ length: 10 }, () => n.post(`/api/planes/${plan.cuerpo.id}/firmar`, { respuesta: firma })));
    expect(rs.filter(r => r.estado === 200).length).toBe(1);
  });

  it.each([
    ['parametros', { parametros: { x: 1 } }], ['pasos', { pasos: [{ id: 'x', etiqueta: 'x' }] }], ['estado', { estado: 'autorizado' }],
    ['cursor', { cursor: 99 }], ['ref', { ref: 'abcdefghijklmnopqrst' }], ['id', { id: '123e4567-e89b-42d3-a456-426614174000' }],
    ['sesion_hash', { sesion_hash: 'x' }], ['__proto__', JSON.parse('{"__proto__":{"admin":true}}')], ['constructor', { constructor: { prototype: {} } }],
  ])('no se puede imponer %s al armar un plan', async (_campo, extra) => {
    const r = await n.plan('crear', { ...VALIDO, ...extra });
    expect(r.estado).toBe(400);
    expect(({} as any).admin).toBeUndefined();
    expect((await m.base.sql<{ n: number }>('select count(*)::int as n from panel.planes'))[0]!.n).toBe(0);
  });

  it.each(['borrar', 'eliminar', 'sql', 'query', 'ejecutar', 'claves', 'exportar', 'proyecto', '', 'CREAR', 'crear ', 'modulos\n'])('no existe la operación %j', async (tipo) => {
    const r = await n.post('/api/planes', { tipo, ...VALIDO });
    expect([400, 404]).toContain(r.estado);
    expect(m.falso.llamadas.filter(l => l.metodo !== 'GET').length).toBe(0);
  });
});

describe('otra sesión no ve ni toca mis planes', () => {
  it('404 en todo lo que sea del plan de otra sesión', async () => {
    const plan = await n.plan('crear', VALIDO);
    const id = plan.cuerpo.id as string;
    const otro = m.navegador('198.51.100.9', 'Otro/1.0');
    expect((await otro.ingresar(a)).estado).toBe(200);
    for (const [metodo, ruta] of [['GET', ''], ['POST', '/desafio'], ['POST', '/paso'], ['POST', '/cancelar'], ['POST', '/clave'], ['POST', '/acuse']] as const) {
      const r = await otro.pedir(metodo, `/api/planes/${id}${ruta}`, metodo === 'POST' ? {} : undefined);
      expect([404, 409]).toContain(r.estado);
      expect(r.estado === 404 || ruta === '/paso').toBe(true);
    }
    // y tampoco puede firmarlo: la firma tendría que ser de ese plan Y de esa sesión
    const r = await otro.post(`/api/planes/${id}/firmar`, { respuesta: a.firmar(plan.cuerpo.opciones.challenge) });
    expect([403, 404]).toContain(r.estado);
    expect(await estadoPlan(id)).toBe('pendiente');
  });
});

describe('ejecución: concurrencia, reintentos y fallas', () => {
  it('pasos simultáneos: se ejecutan de a uno y ninguna migración se aplica dos veces', async () => {
    const r = await n.plan('crear', VALIDO);
    await n.firmar(r.cuerpo.id, r.cuerpo.opciones, a);
    let terminado = false;
    for (let i = 0; i < 400 && !terminado; i++) {
      const rs = await Promise.all(Array.from({ length: 6 }, () => n.post(`/api/planes/${r.cuerpo.id}/paso`)));
      expect(rs.filter(x => x.estado === 200).length).toBeLessThanOrEqual(1);
      expect(rs.every(x => x.estado === 200 || x.estado === 409)).toBe(true);
      terminado = rs.some(x => x.cuerpo?.estado === 'terminado');
    }
    expect(terminado).toBe(true);
    // VALIDO contrata solo Depósito: se instalan la Base y Abastecimiento; las de Mantenimiento no se aplican ni una vez.
    for (const mig of MIGRACIONES) {
      const veces = m.falso.sqlEjecutado.filter(q => q.sql.startsWith(mig.sql)).length;
      expect(veces, mig.nombre).toBe(mig.componente === 'mantenimiento' ? 0 : 1);
    }
  });

  it('dos planes sobre el mismo proyecto: el segundo espera (un proyecto, un plan a la vez)', async () => {
    const p = instalado();
    const A = await n.plan('actualizar', { ref: p.ref });
    const B = await n.plan('actualizar', { ref: p.ref });
    await n.firmar(A.cuerpo.id, A.cuerpo.opciones, a);
    await n.firmar(B.cuerpo.id, B.cuerpo.opciones, a);
    expect((await n.post(`/api/planes/${A.cuerpo.id}/paso`)).estado).toBe(200);
    const rb = await n.post(`/api/planes/${B.cuerpo.id}/paso`);
    expect(rb.estado).toBe(409);
    expect(rb.cuerpo.error).toBe('proyecto_ocupado');
  });

  it('si el servidor se cae a mitad de un paso, el "arriendo" vence y se puede seguir sin duplicar', async () => {
    const p = instalado();
    const r = await n.plan('actualizar', { ref: p.ref });
    await n.firmar(r.cuerpo.id, r.cuerpo.opciones, a);
    // Simula un pedido que tomó el paso y murió: empieza pero nunca termina.
    const inicio: any = await m.base.almacen.rpc('panel_plan_paso_empezar', { p_id: r.cuerpo.id, p_sesion_hash: (await m.base.sql<{ sesion_hash: string }>('select sesion_hash from panel.planes'))[0]!.sesion_hash, p_token: 'token-muerto', p_segundos: 30 });
    expect(inicio.error).toBeUndefined();
    expect((await n.post(`/api/planes/${r.cuerpo.id}/paso`)).cuerpo.error).toBe('ocupado');
    await m.base.sql(`update panel.planes set arriendo_hasta = now() - interval '1 second'`);
    expect((await n.post(`/api/planes/${r.cuerpo.id}/paso`)).estado).toBe(200);
    // El pedido "muerto" no puede cerrar el paso después: el token ya no vale.
    const tarde: any = await m.base.almacen.rpc('panel_plan_paso_terminar', { p_id: r.cuerpo.id, p_token: 'token-muerto', p_indice: 0, p_resultado: 'ok', p_contexto: {}, p_error: null, p_ref: null });
    expect(tarde.error).toBe('arriendo');
  });

  it('cancelar frena todo', async () => {
    const r = await n.plan('crear', VALIDO);
    await n.firmar(r.cuerpo.id, r.cuerpo.opciones, a);
    expect((await n.post(`/api/planes/${r.cuerpo.id}/cancelar`)).estado).toBe(200);
    expect((await n.post(`/api/planes/${r.cuerpo.id}/paso`)).estado).toBe(409);
  });

  it('un plan firmado vence a los 30 minutos', async () => {
    const r = await n.plan('crear', VALIDO);
    await n.firmar(r.cuerpo.id, r.cuerpo.opciones, a);
    await m.base.sql(`update panel.planes set vence_at = now() - interval '1 second'`);
    expect((await n.post(`/api/planes/${r.cuerpo.id}/paso`)).estado).toBe(410);
    expect(await estadoPlan(r.cuerpo.id)).toBe('cancelado');
  });

  it('el pánico cancela los planes y cierra todas las sesiones', async () => {
    const r = await n.plan('crear', VALIDO);
    await n.firmar(r.cuerpo.id, r.cuerpo.opciones, a);
    expect((await n.post('/api/panico')).estado).toBe(200);
    expect((await n.get('/api/clientes')).estado).toBe(401);
    expect(await estadoPlan(r.cuerpo.id)).toBe('cancelado');
  });

  it('si Supabase rechaza la llave del panel a mitad de camino, el plan falla y no se sigue llamando', async () => {
    const r = await n.plan('crear', VALIDO);
    await n.firmar(r.cuerpo.id, r.cuerpo.opciones, a);
    let cortar = false;
    m.falso.hooks.antes = l => (cortar && l.host === 'api.supabase.com' ? new Response('{"message":"Unauthorized sbp_abcdefghijklmnop"}', { status: 401 }) : undefined);
    const pasos: any[] = [];
    for (let i = 0; i < 6; i++) { pasos.push(await n.post(`/api/planes/${r.cuerpo.id}/paso`)); if (i === 2) cortar = true; }
    const falla = pasos.find(p => p.cuerpo?.resultado === 'fallo');
    expect(falla).toBeDefined();
    expect(falla.cuerpo.mensaje).toMatch(/rechaz/i);
    expect(JSON.stringify(pasos)).not.toContain('sbp_abcdefghijklmnop');
    expect(await estadoPlan(r.cuerpo.id)).toBe('fallido');
    const antes = m.falso.llamadas.length;
    expect((await n.post(`/api/planes/${r.cuerpo.id}/paso`)).estado).toBe(409);
    expect(m.falso.llamadas.length).toBe(antes);
  });

  it('errores transitorios (500) se reintentan y el plan termina; si no paran, falla con mensaje claro', async () => {
    const r = await n.plan('crear', VALIDO);
    await n.firmar(r.cuerpo.id, r.cuerpo.opciones, a);
    let fallos = 0;
    m.falso.hooks.antes = l => (l.ruta.endsWith('/database/query') && (l.cuerpo as any)?.query?.startsWith(MIGRACIONES[0]!.sql) && fallos++ < 2 ? new Response('{"message":"boom"}', { status: 500 }) : undefined);
    const pasos = await n.correr(r.cuerpo.id);
    expect(pasos.at(-1)!.cuerpo.estado).toBe('terminado');
    expect(pasos.some(p => p.cuerpo.resultado === 'reintentar')).toBe(true);

    const r2 = await n.plan('crear', { ...VALIDO, nombre: 'Cliente Dos' });
    await n.firmar(r2.cuerpo.id, r2.cuerpo.opciones, a);
    m.falso.hooks.antes = l => (l.ruta.endsWith('/database/query') && (l.cuerpo as any)?.query?.startsWith(MIGRACIONES[0]!.sql) ? new Response('{"message":"siempre"}', { status: 500 }) : undefined);
    const pasos2 = await n.correr(r2.cuerpo.id);
    expect(pasos2.at(-1)!.cuerpo.resultado).toBe('fallo');
    expect(await estadoPlan(r2.cuerpo.id)).toBe('fallido');
  });

  it('un corte por tiempo (408) hace esperar antes de reintentar, para no lanzar dos veces la misma migración', async () => {
    const p = instalado();
    const migracionAFallar = migracionesDe(['base'])[1]!;
    p.registro = new Set([migracionesDe(['base'])[0]!.nombre]); p.tablas = 1; // como un proyecto recién creado, con la primera migración hecha
    const r = await n.plan('actualizar', { ref: p.ref });
    await n.firmar(r.cuerpo.id, r.cuerpo.opciones, a);
    expect((await n.post(`/api/planes/${r.cuerpo.id}/paso`)).cuerpo.resultado).toBe('ok'); // preparar
    m.falso.hooks.antes = l => {
      if (l.ruta.endsWith('/database/query') && (l.cuerpo as any)?.query?.startsWith(migracionAFallar.sql)) throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
      return undefined;
    };
    const t = await n.post(`/api/planes/${r.cuerpo.id}/paso`);
    expect(t.cuerpo.resultado).toBe('reintentar');
    m.falso.hooks.antes = undefined;
    const antes = m.falso.llamadas.length;
    const espera = await n.post(`/api/planes/${r.cuerpo.id}/paso`);
    expect(espera.cuerpo.resultado).toBe('reintentar');
    expect(espera.cuerpo.mensaje).toMatch(/Esperando/);
    expect(m.falso.llamadas.length).toBe(antes); // mientras espera, no toca Supabase
  });

  it('si se pierde la respuesta de "crear proyecto", el reintento adopta el proyecto en vez de duplicarlo', async () => {
    const r = await n.plan('crear', VALIDO);
    await n.firmar(r.cuerpo.id, r.cuerpo.opciones, a);
    let primera = true;
    m.falso.hooks.antes = l => {
      if (l.metodo === 'POST' && l.ruta === '/v1/projects' && primera) { primera = false; m.falso.nuevoProyecto('cliente-prueba', ORG, 'COMING_UP'); return new Response('{"message":"bad gateway"}', { status: 502 }); }
      return undefined;
    };
    const pasos = await n.correr(r.cuerpo.id);
    expect(pasos.at(-1)!.cuerpo.estado).toBe('terminado');
    expect([...m.falso.proyectos.values()].filter(p => p.nombre === 'cliente-prueba').length).toBe(1);
  });

  it('terminado un plan, pedir otro paso no hace nada', async () => {
    const r = await n.hacer('crear', VALIDO, a);
    expect(r.pasos.at(-1)!.cuerpo.estado).toBe('terminado');
    const antes = m.falso.llamadas.length;
    expect((await n.post(`/api/planes/${r.plan.cuerpo.id}/paso`)).estado).toBe(409);
    expect(m.falso.llamadas.length).toBe(antes);
  });
});

describe('alcance: solo la organización de los clientes', () => {
  it('un proyecto de otra organización no se ve, no se lista y no se puede operar', async () => {
    const ajeno = m.falso.nuevoProyecto('proyecto-ajeno', 'otraorganizacion');
    const propio = instalado();
    const lista = (await n.get('/api/clientes')).cuerpo.clientes as { ref: string }[];
    expect(lista.map(c => c.ref)).toEqual([propio.ref]);
    expect((await n.get(`/api/clientes/${ajeno.ref}`)).estado).toBe(404);
    expect((await n.plan('actualizar', { ref: ajeno.ref })).estado).toBe(404);
    expect((await n.plan('modulos', { ref: ajeno.ref, activar: ['tareas'] })).estado).toBe(404);
    expect(m.falso.llamadas.filter(l => l.ruta.includes(ajeno.ref)).length).toBe(0);
  });

  it('referencias inexistentes o mal formadas', async () => {
    expect((await n.get('/api/clientes/zzzzzzzzzzzzzzzzzzzz')).estado).toBe(404);
    for (const ref of ['abc', 'A'.repeat(20), 'a'.repeat(21), '../../v1/organizations', 'abcdefghijklmnopqrs;', '', 5, null, { $ne: 1 }, ['a'.repeat(20)]]) {
      const r = await n.plan('actualizar', { ref });
      expect(r.estado).toBe(400);
    }
    expect(m.falso.llamadas.filter(l => l.metodo !== 'GET').length).toBe(0);
  });

  it('crear: nombre repetido, módulos inexistentes o dependencias rotas → 400 sin tocar nada', async () => {
    instalado();
    for (const cuerpo of [
      { ...VALIDO, nombre: 'Instalado Uno' }, { ...VALIDO, modulos: ['no-existe'] }, { ...VALIDO, modulos: ['envios'] }, { ...VALIDO, modulos: ['deposito', 'deposito'] },
      { ...VALIDO, modulos: 'deposito' }, { ...VALIDO, region: 'mars-1' }, { ...VALIDO, urlApp: 'http://inseguro.com' }, { ...VALIDO, urlApp: 'https://a.com/ruta' },
      { ...VALIDO, urlApp: 'https://usuario:clave@a.com' }, { ...VALIDO, urlApp: 'javascript:alert(1)' },
    ]) {
      const r = await n.plan('crear', cuerpo as any);
      expect(r.estado, JSON.stringify(cuerpo)).toBe(400);
    }
    expect(m.falso.llamadas.filter(l => l.metodo !== 'GET').length).toBe(0);
  });

  it('actualizar un proyecto que no fue instalado por el panel se rechaza (no se adopta a ciegas)', async () => {
    const p = m.falso.nuevoProyecto('viejo', ORG); // sin registro de migraciones
    const r = await n.plan('actualizar', { ref: p.ref });
    expect(r.estado).toBe(400);
    expect(r.cuerpo.error).toBe('no_instalado');
  });

  it('crear sobre un proyecto que ya tiene tablas se corta sin ejecutar migraciones', async () => {
    const r = await n.plan('crear', VALIDO);
    await n.firmar(r.cuerpo.id, r.cuerpo.opciones, a);
    m.falso.hooks.antes = l => { if (l.metodo === 'POST' && l.ruta === '/v1/projects') setTimeout(() => {}, 0); return undefined; };
    let fallo: any = null;
    for (let i = 0; i < 20; i++) {
      const p = await n.post(`/api/planes/${r.cuerpo.id}/paso`);
      const creado = [...m.falso.proyectos.values()].find(x => x.nombre === 'cliente-prueba');
      if (creado) creado.tablas = 7; // alguien le cargó tablas antes de la migración
      if (p.cuerpo?.resultado === 'fallo') { fallo = p; break; }
    }
    expect(fallo).not.toBeNull();
    expect(fallo.cuerpo.mensaje).toMatch(/ya tiene tablas/);
    expect(m.falso.sqlEjecutado.some(q => q.sql.startsWith(MIGRACIONES[0]!.sql))).toBe(false);
  });

  it('módulos: si la licencia cambió entre el plan y la ejecución, no se pisa', async () => {
    const p = instalado();
    const r = await n.plan('modulos', { ref: p.ref, activar: ['tareas'] });
    p.licencia = { ...p.licencia, comisionistas: true }; // alguien la tocó
    await n.firmar(r.cuerpo.id, r.cuerpo.opciones, a);
    const paso = await n.post(`/api/planes/${r.cuerpo.id}/paso`);
    expect(paso.cuerpo.resultado).toBe('fallo');
    expect(paso.cuerpo.mensaje).toMatch(/cambió/);
    expect(p.licencia.tareas).toBeFalsy();
  });

  it('módulos: dependencias, sin cambios y combinaciones imposibles se rechazan al armar el plan', async () => {
    const p = instalado();
    expect((await n.plan('modulos', { ref: p.ref, activar: ['envios'] })).estado).toBe(400); // necesita proveedores
    expect((await n.plan('modulos', { ref: p.ref, activar: ['deposito'] })).estado).toBe(400); // ya estaba activo: sin cambios
    expect((await n.plan('modulos', { ref: p.ref, activar: ['tareas'], desactivar: ['tareas'] })).estado).toBe(400);
    expect((await n.plan('modulos', { ref: p.ref, activar: ['x'] })).estado).toBe(400);
    expect((await n.plan('modulos', { ref: p.ref, activar: ['proveedores', 'envios'] })).estado).toBe(201);
  });

  it('una migración empaquetada con la huella cambiada no se ejecuta', async () => {
    const original = MIGRACIONES[0]!.sql;
    try {
      MIGRACIONES[0]!.sql = original + '\n-- alterada';
      const r = await n.plan('crear', VALIDO);
      await n.firmar(r.cuerpo.id, r.cuerpo.opciones, a);
      const pasos = await n.correr(r.cuerpo.id);
      expect(pasos.at(-1)!.cuerpo.resultado).toBe('fallo');
      expect(pasos.at(-1)!.cuerpo.mensaje).toMatch(/huella/);
      expect(m.falso.sqlEjecutado.some(q => q.sql.includes('-- alterada'))).toBe(false);
    } finally { MIGRACIONES[0]!.sql = original; }
  });
});

describe('topes contra gastos por error o por abuso', () => {
  it('como mucho 5 clientes nuevos por día (los planes cancelados cuentan igual)', async () => {
    const estados: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await n.plan('crear', { ...VALIDO, nombre: `Cliente Numero ${i}` });
      estados.push(r.estado);
      if (r.estado === 201) await n.post(`/api/planes/${r.cuerpo.id}/cancelar`);
    }
    expect(estados).toEqual([201, 201, 201, 201, 201, 429, 429]);
  });

  it('la organización no puede pasar el tope de proyectos', async () => {
    const m2 = await crearMundo({ maxProyectos: 2 });
    const { n: n2 } = await m2.conSesion();
    m2.falso.proyectoInstalado('uno'); m2.falso.proyectoInstalado('dos');
    const r = await n2.plan('crear', VALIDO);
    expect(r.estado).toBe(400);
    expect(r.cuerpo.error).toBe('limite');
    expect(m2.falso.llamadas.filter(l => l.metodo !== 'GET').length).toBe(0);
  });
});

describe('contraseña inicial del dueño', () => {
  it('se ve una vez, solo desde la sesión del plan, y deja de verse con el acuse o a la hora', async () => {
    const r = await n.hacer('crear', VALIDO, a);
    const id = r.plan.cuerpo.id as string;
    const otro = m.navegador('198.51.100.9', 'Otro/1.0');
    await otro.ingresar(a);
    expect((await otro.post(`/api/planes/${id}/clave`)).estado).toBe(404);
    const v1 = await n.post(`/api/planes/${id}/clave`);
    const v2 = await n.post(`/api/planes/${id}/clave`);
    expect(v1.cuerpo.clave).toBe(v2.cuerpo.clave); // estable hasta el acuse
    expect(v1.cuerpo.clave).toMatch(/^[A-Za-z0-9_-]{18}-9a$/);
    await n.post(`/api/planes/${id}/acuse`);
    expect((await n.post(`/api/planes/${id}/clave`)).estado).toBe(404);

    const r2 = await n.hacer('crear', { ...VALIDO, nombre: 'Cliente Dos' }, a);
    await m.base.sql(`update panel.planes set terminado_at = now() - interval '61 minutes' where id = $1`, [r2.plan.cuerpo.id]);
    expect((await n.post(`/api/planes/${r2.plan.cuerpo.id}/clave`)).estado).toBe(404);
  });

  it('cada plan tiene una contraseña distinta, aunque el correo sea el mismo', async () => {
    const r1 = await n.hacer('crear', VALIDO, a);
    const r2 = await n.hacer('crear', { ...VALIDO, nombre: 'Cliente Dos' }, a);
    const c1 = (await n.post(`/api/planes/${r1.plan.cuerpo.id}/clave`)).cuerpo.clave;
    const c2 = (await n.post(`/api/planes/${r2.plan.cuerpo.id}/clave`)).cuerpo.clave;
    expect(c1).not.toBe(c2);
  });

  it('un plan de "actualizar" no tiene contraseña', async () => {
    const p = instalado();
    const r = await n.hacer('actualizar', { ref: p.ref }, a);
    expect((await n.post(`/api/planes/${r.plan.cuerpo.id}/clave`)).estado).toBe(404);
  });

  it('si el correo ya tenía cuenta, no se inventa una contraseña', async () => {
    // Un dueño preexistente: el panel conserva su contraseña y lo dice.
    const r = await n.plan('crear', VALIDO);
    await n.firmar(r.cuerpo.id, r.cuerpo.opciones, a);
    let preparado = false;
    for (let i = 0; i < 80; i++) {
      const p = [...m.falso.proyectos.values()].find(x => x.nombre === 'cliente-prueba');
      if (p && !preparado) { p.usuarios.set('dueno@prueba.com', 'contraseña-que-ya-existia'); preparado = true; }
      const s = await n.post(`/api/planes/${r.cuerpo.id}/paso`);
      if (s.cuerpo?.estado === 'terminado' || s.cuerpo?.resultado === 'fallo') break;
    }
    const v = await n.post(`/api/planes/${r.cuerpo.id}/clave`);
    expect(v.cuerpo.clave).toBeNull();
    expect(v.cuerpo.motivo).toMatch(/ya tenía/);
  });
});
