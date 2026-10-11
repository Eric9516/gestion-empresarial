// Varias organizaciones de Supabase (una por cliente): el panel solo ve y toca las que tiene permitidas.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearMundo, llamadasFueraDeLista, type Mundo, type Navegador } from '../ayudas/mundo.ts';
import type { Autenticador } from '../ayudas/autenticador.ts';
import { ORG, ORG2 } from '../ayudas/supabaseFalso.ts';

let m: Mundo;
let n: Navegador;
let a: Autenticador;
const VALIDO = { nombre: 'Cliente Multi', correo: 'dueno@multi.com', modulos: ['deposito'] };

beforeEach(async () => {
  m = await crearMundo({ organizaciones: [ORG, ORG2] });
  ({ n, a } = await m.conSesion());
});

describe('crear en la organización elegida', () => {
  it('con varias organizaciones hay que elegir una, y tiene que ser de la lista', async () => {
    for (const org of [undefined, '', 'otraorganizacion', 'abcdefghijklmnopqrst', 5, null, ['orgprueba1234'], { $ne: 1 }, ORG.toUpperCase(), `${ORG} `, `${ORG},${ORG2}`]) {
      const r = await n.plan('crear', { ...VALIDO, ...(org === undefined ? {} : { org }) });
      expect(r.estado, JSON.stringify(org)).toBe(400);
      expect(r.cuerpo.error).toBe('org');
    }
    expect(m.falso.llamadas.filter(l => l.metodo !== 'GET').length).toBe(0);
  });

  it('el proyecto se crea en la organización elegida (y se le manda esa a Supabase)', async () => {
    const r = await n.hacer('crear', { ...VALIDO, org: ORG2 }, a);
    expect(r.pasos.at(-1)!.cuerpo.estado).toBe('terminado');
    const p = [...m.falso.proyectos.values()].find(x => x.nombre === 'cliente-multi')!;
    expect(p.org).toBe(ORG2);
    const creacion = m.falso.llamadas.find(l => l.metodo === 'POST' && l.ruta === '/v1/projects')!;
    expect((creacion.cuerpo as { organization_slug: string }).organization_slug).toBe(ORG2);
    expect(r.plan.cuerpo.resumen.lineas.join('\n')).toContain(`Organización de Supabase: ${ORG2}`);
    expect(llamadasFueraDeLista(m.falso.llamadas)).toEqual([]);
  });

  it('la lista muestra proyectos de las dos organizaciones, con la organización de cada uno, y nunca los de otra', async () => {
    const a1 = m.falso.nuevoProyecto('uno', ORG); const a2 = m.falso.nuevoProyecto('dos', ORG2); const ajeno = m.falso.nuevoProyecto('ajeno', 'otraorganizacion');
    const lista = (await n.get('/api/clientes')).cuerpo.clientes as { ref: string; org: string }[];
    expect(lista.map(c => [c.ref, c.org]).sort()).toEqual([[a1.ref, ORG], [a2.ref, ORG2]].sort());
    expect((await n.get(`/api/clientes/${ajeno.ref}`)).estado).toBe(404);
    expect((await n.plan('actualizar', { ref: ajeno.ref })).estado).toBe(404);
  });

  it('actualizar y cambiar módulos funcionan en un proyecto de la segunda organización', async () => {
    const p = m.falso.proyectoInstalado('de-la-segunda', ['deposito']);
    p.org = ORG2;
    const u = await n.hacer('actualizar', { ref: p.ref }, a);
    expect(u.pasos.at(-1)!.cuerpo.estado).toBe('terminado');
    const mod = await n.hacer('modulos', { ref: p.ref, activar: ['tareas'] }, a);
    expect(mod.pasos.at(-1)!.cuerpo.estado).toBe('terminado');
    expect(p.licencia.tareas).toBe(true);
  });

  it('"org" no se acepta al actualizar ni al cambiar módulos (el proyecto ya tiene su organización)', async () => {
    const p = m.falso.proyectoInstalado('x', []);
    expect((await n.plan('actualizar', { ref: p.ref, org: ORG2 })).estado).toBe(400);
    expect((await n.plan('modulos', { ref: p.ref, activar: ['tareas'], org: ORG2 })).estado).toBe(400);
  });

  it('el nombre de proyecto repetido se detecta aunque esté en OTRA organización permitida', async () => {
    m.falso.nuevoProyecto('cliente-multi', ORG2);
    const r = await n.plan('crear', { ...VALIDO, org: ORG });
    expect(r.estado).toBe(400);
  });

  it('el tope de proyectos cuenta todas las organizaciones juntas', async () => {
    const m2 = await crearMundo({ organizaciones: [ORG, ORG2], maxProyectos: 2 });
    const { n: n2 } = await m2.conSesion();
    m2.falso.proyectoInstalado('uno'); const dos = m2.falso.proyectoInstalado('dos'); dos.org = ORG2;
    const r = await n2.plan('crear', { ...VALIDO, org: ORG2 });
    expect(r.estado).toBe(400);
    expect(r.cuerpo.error).toBe('limite');
  });
});

describe('con una sola organización se sigue usando sin elegir', () => {
  it('"org" es opcional si hay una sola', async () => {
    const m1 = await crearMundo();
    const { n: n1 } = await m1.conSesion();
    expect((await n1.plan('crear', VALIDO)).estado).toBe(201);
    expect((await n1.plan('crear', { ...VALIDO, nombre: 'Otro Cliente', org: 'otraorganizacion' })).estado).toBe(400);
  });
});
