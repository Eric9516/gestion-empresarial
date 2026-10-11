// Agregar y quitar organizaciones desde el panel (con firma), y datos para publicar la app de un cliente.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearMundo, llamadasFueraDeLista, type Mundo, type Navegador } from '../ayudas/mundo.ts';
import type { Autenticador } from '../ayudas/autenticador.ts';
import { ORG, ORG2 } from '../ayudas/supabaseFalso.ts';

let m: Mundo;
let n: Navegador;
let a: Autenticador;
const VALIDO = { nombre: 'Cliente Org', correo: 'dueno@org.com', modulos: ['deposito'] };
const guardadas = async () => (await m.base.sql<{ slug: string }>('select slug from panel.organizaciones order by slug')).map(x => x.slug);

beforeEach(async () => {
  m = await crearMundo({ organizaciones: [] }); // el servidor no trae ninguna: todo se agrega desde el panel
  ({ n, a } = await m.conSesion());
});
afterEach(() => { expect(llamadasFueraDeLista(m.falso.llamadas)).toEqual([]); });

describe('agregar una organización', () => {
  it('con la firma, queda agregada y desde ese momento se puede crear y operar ahí', async () => {
    expect((await n.plan('crear', { ...VALIDO, org: ORG2 })).estado).toBe(400); // antes de agregarla, no se puede
    const r = await n.hacer('org_agregar', { org: ORG2 }, a);
    expect(r.plan.estado).toBe(201);
    expect(r.pasos.at(-1)!.cuerpo.estado).toBe('terminado');
    expect(await guardadas()).toEqual([ORG2]);
    expect((await n.get('/api/organizaciones')).cuerpo.organizaciones).toEqual([{ slug: ORG2, origen: 'panel' }]);
    expect((await n.get('/api/modulos')).cuerpo.organizaciones).toEqual([ORG2]);

    const c = await n.hacer('crear', { ...VALIDO, org: ORG2 }, a);
    expect(c.pasos.at(-1)!.cuerpo.estado).toBe('terminado');
    const p = [...m.falso.proyectos.values()].find(x => x.nombre === 'cliente-org')!;
    expect(p.org).toBe(ORG2);
    expect(((await n.get('/api/clientes')).cuerpo.clientes as { ref: string }[]).map(x => x.ref)).toContain(p.ref);
  });

  it('sin la firma NO se agrega nada', async () => {
    const plan = await n.plan('org_agregar', { org: ORG2 });
    expect(plan.estado).toBe(201);
    expect((await n.post(`/api/planes/${plan.cuerpo.id}/paso`)).estado).toBe(409);
    expect(await guardadas()).toEqual([]);
  });

  it('si la cuenta del panel no ve esa organización (nadie la invitó), se rechaza', async () => {
    m.falso.orgsVisibles.delete(ORG2);
    const r = await n.plan('org_agregar', { org: ORG2 });
    expect(r.estado).toBe(400);
    expect(r.cuerpo.error).toBe('no_visible');
    expect(await guardadas()).toEqual([]);
  });

  it('si la invitación desaparece entre el plan y la ejecución, falla sin agregar', async () => {
    const plan = await n.plan('org_agregar', { org: ORG2 });
    await n.firmar(plan.cuerpo.id, plan.cuerpo.opciones, a);
    m.falso.orgsVisibles.delete(ORG2);
    const paso = await n.post(`/api/planes/${plan.cuerpo.id}/paso`);
    expect(paso.cuerpo.resultado).toBe('fallo');
    expect(await guardadas()).toEqual([]);
  });

  it.each([
    undefined, '', 'x', 'ABCDEFGHIJKLMNOPQRST', 'con espacios aca', '../../v1/organizations', `${ORG};drop`, 5, null, [ORG2], { slug: ORG2 }, 'a'.repeat(41), ORG2 + '\n',
  ])('identificador inválido %j → 400', async (org) => {
    const r = await n.plan('org_agregar', org === undefined ? {} : { org });
    expect(r.estado).toBe(400);
    expect(m.falso.llamadas.filter(l => l.metodo !== 'GET').length).toBe(0);
  });

  it('no se puede agregar dos veces ni una que ya viene del servidor', async () => {
    await n.hacer('org_agregar', { org: ORG2 }, a);
    expect((await n.plan('org_agregar', { org: ORG2 })).cuerpo.error).toBe('ya_esta');
    const m2 = await crearMundo({ organizaciones: [ORG] });
    const { n: n2 } = await m2.conSesion();
    expect((await n2.plan('org_agregar', { org: ORG })).cuerpo.error).toBe('ya_esta');
  });

  it('dos planes iguales a la vez dejan una sola organización', async () => {
    const p1 = await n.plan('org_agregar', { org: ORG2 });
    const p2 = await n.plan('org_agregar', { org: ORG2 });
    await n.firmar(p1.cuerpo.id, p1.cuerpo.opciones, a);
    await n.firmar(p2.cuerpo.id, p2.cuerpo.opciones, a);
    await n.correr(p1.cuerpo.id); await n.correr(p2.cuerpo.id);
    expect(await guardadas()).toEqual([ORG2]);
  });

  it('hay un tope de 30 organizaciones', async () => {
    for (let i = 0; i < 30; i++) await m.base.almacen.rpc('panel_org_agregar', { p_slug: `organizacion${String(i).padStart(3, '0')}` });
    const r = await n.plan('org_agregar', { org: ORG2 });
    expect(r.estado).toBe(400);
    expect(r.cuerpo.error).toBe('limite');
  });

  it('la base rechaza identificadores inválidos aunque se llame directo', async () => {
    for (const mala of ['', 'x', 'Mayusculas12345', 'con espacio 12345', "x'; drop table panel.organizaciones;--"]) {
      await expect(m.base.almacen.rpc('panel_org_agregar', { p_slug: mala })).rejects.toThrow();
    }
    expect(await guardadas()).toEqual([]);
  });
});

describe('quitar una organización', () => {
  it('con la firma deja de verse y de operarse; no se toca nada en Supabase', async () => {
    await n.hacer('org_agregar', { org: ORG2 }, a);
    const p = m.falso.proyectoInstalado('de-la-org2', ['deposito']); p.org = ORG2;
    expect(((await n.get('/api/clientes')).cuerpo.clientes as unknown[]).length).toBe(1);
    const antes = m.falso.llamadas.filter(l => l.metodo !== 'GET').length;

    const r = await n.hacer('org_quitar', { org: ORG2 }, a);
    expect(r.pasos.at(-1)!.cuerpo.estado).toBe('terminado');
    expect(await guardadas()).toEqual([]);
    expect((await n.get('/api/clientes')).cuerpo.clientes).toEqual([]);
    expect((await n.get(`/api/clientes/${p.ref}`)).estado).toBe(404);
    expect((await n.plan('actualizar', { ref: p.ref })).estado).toBe(404);
    expect(m.falso.llamadas.filter(l => l.metodo !== 'GET').length).toBe(antes); // quitarla no hizo ninguna llamada de escritura a Supabase
    expect([...m.falso.proyectos.keys()]).toContain(p.ref); // el proyecto del cliente sigue existiendo
  });

  it('una organización de la configuración del servidor no se quita desde el panel', async () => {
    const m2 = await crearMundo({ organizaciones: [ORG] });
    const { n: n2 } = await m2.conSesion();
    const r = await n2.plan('org_quitar', { org: ORG });
    expect(r.estado).toBe(400);
    expect(r.cuerpo.error).toBe('de_servidor');
  });

  it('quitar una que no está → 400; sin firma no se quita', async () => {
    expect((await n.plan('org_quitar', { org: ORG2 })).cuerpo.error).toBe('no_esta');
    await n.hacer('org_agregar', { org: ORG2 }, a);
    const plan = await n.plan('org_quitar', { org: ORG2 });
    expect((await n.post(`/api/planes/${plan.cuerpo.id}/paso`)).estado).toBe(409);
    expect(await guardadas()).toEqual([ORG2]);
  });

  it('las dos operaciones quedan en la auditoría con la organización', async () => {
    await n.hacer('org_agregar', { org: ORG2 }, a);
    await n.hacer('org_quitar', { org: ORG2 }, a);
    const eventos = await m.base.sql<{ evento: string; detalle: { tipo?: string; org?: string } }>(`select evento, detalle from panel.auditoria where evento = 'plan_creado' order by seq`);
    expect(eventos.map(e => [e.detalle.tipo, e.detalle.org])).toEqual([['org_agregar', ORG2], ['org_quitar', ORG2]]);
    expect(((await n.get('/api/auditoria')).cuerpo.cadena as { ok: boolean }).ok).toBe(true);
  });
});

describe('datos para publicar la app del cliente', () => {
  beforeEach(async () => { await n.hacer('org_agregar', { org: ORG2 }, a); });
  const proyecto = () => { const p = m.falso.proyectoInstalado('para-publicar', ['deposito']); p.org = ORG2; return p; };

  it('devuelve la dirección y la llave PÚBLICA, nunca la de servicio', async () => {
    const p = proyecto();
    const r = await n.get(`/api/clientes/${p.ref}/publicar`);
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toEqual({ nombre: 'para-publicar', url: `https://${p.ref}.supabase.co`, anon: p.claves.anon });
    expect(r.texto).not.toContain(p.claves.servicio);
    expect(r.texto).not.toMatch(/service_role|servicio/);
  });

  it('exige sesión', async () => {
    const p = proyecto();
    expect((await m.navegador('198.51.100.3').get(`/api/clientes/${p.ref}/publicar`)).estado).toBe(401);
  });

  it('un proyecto de una organización que el panel no opera no se puede consultar', async () => {
    const ajeno = m.falso.nuevoProyecto('ajeno', 'otraorganizacion');
    expect((await n.get(`/api/clientes/${ajeno.ref}/publicar`)).estado).toBe(404);
    const quitado = proyecto();
    await n.hacer('org_quitar', { org: ORG2 }, a);
    expect((await n.get(`/api/clientes/${quitado.ref}/publicar`)).estado).toBe(404);
    expect(m.falso.llamadas.some(l => l.ruta.includes(`${ajeno.ref}/api-keys`))).toBe(false);
  });

  it('si el proyecto todavía no está listo, avisa', async () => {
    const p = proyecto(); p.estado = 'COMING_UP'; p.sondeos = -1000; // el simulador lo "activa" tras unas consultas: se lo impide
    const r = await n.get(`/api/clientes/${p.ref}/publicar`);
    expect(r.estado).toBe(409);
    expect(r.cuerpo.error).toBe('no_listo');
  });

  it('no se puede usar con referencias inventadas', async () => {
    for (const ref of ['abc', 'A'.repeat(20), 'a'.repeat(21), '..']) expect((await n.get(`/api/clientes/${ref}/publicar`)).estado).toBe(404);
  });
});

describe('sin organizaciones configuradas', () => {
  it('el panel arranca vacío: no ve proyectos y no deja crear hasta agregar una', async () => {
    m.falso.proyectoInstalado('invisible'); // está en ORG, pero el panel no la tiene
    expect((await n.get('/api/clientes')).cuerpo.clientes).toEqual([]);
    expect((await n.plan('crear', VALIDO)).cuerpo.error).toBe('org');
    expect((await n.get('/api/organizaciones')).cuerpo.organizaciones).toEqual([]);
    void ORG;
  });
});
