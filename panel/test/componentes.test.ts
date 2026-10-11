// Instalación por componentes: el cliente recibe solo lo que contrata, se amplía sin perder nada y el panel y el instalador
// de la plantilla (scripts/cliente.mjs) deciden exactamente igual.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error — es un módulo .mjs de la plantilla, sin tipos
import * as plantilla from '../../scripts/herramientas/componentes.mjs';
import { componentesInstalados, componentesParaModulos, expandirRegistro, faltantesPara, migracionesDe } from '../src/server/componentes.ts';
import { MIGRACIONES, MODULOS } from '../src/server/generado.ts';
import { Autenticador } from './ayudas/autenticador.ts';
import { crearMundo, llamadasFueraDeLista, type Mundo, type Navegador } from './ayudas/mundo.ts';

const IDS = MODULOS.map(m => m.id);

describe('el panel y el instalador de la plantilla deciden igual', () => {
  it('componentes para cualquier combinación de módulos (con dependencias)', () => {
    fc.assert(fc.property(fc.subarray(IDS), ids => {
      expect(componentesParaModulos(ids)).toEqual(plantilla.componentesParaModulos(ids, MODULOS));
    }), { numRuns: 300 });
  });
  it('componentes instalados y registro expandido, con registros nuevos y de antes de los componentes', () => {
    const nombres = MIGRACIONES.map(m => m.nombre);
    const viejos = nombres.map(n => n.split('/')[1]!);
    fc.assert(fc.property(fc.subarray([...nombres, ...viejos]), reg => {
      expect(componentesInstalados(reg)).toEqual(plantilla.componentesInstalados(reg));
      expect([...expandirRegistro(reg, nombres)].sort()).toEqual([...plantilla.expandirRegistro(reg, nombres)].sort());
    }), { numRuns: 300 });
  });
  it('lo que falta instalar antes', () => {
    for (const c of ['abastecimiento', 'mantenimiento'] as const) {
      for (const inst of [[], ['base'], ['base', 'abastecimiento']]) expect(faltantesPara(c, inst)).toEqual(plantilla.faltantesPara(c, inst));
    }
  });
});

describe('qué componentes salen de los módulos', () => {
  it('sin módulos o solo Tareas: solo la Base', () => {
    expect(componentesParaModulos([])).toEqual(['base']);
    expect(componentesParaModulos(['tareas'])).toEqual(['base']);
  });
  it('Proveedores, Comisionistas, Envíos o Depósito: Base + Abastecimiento', () => {
    for (const m of ['proveedores', 'comisionistas', 'envios', 'deposito']) expect(componentesParaModulos([m]), m).toEqual(['base', 'abastecimiento']);
  });
  it('Mantenimiento trae todo lo que necesita (aunque no se marque Depósito)', () => {
    expect(componentesParaModulos(['mantenimiento'])).toEqual(['base', 'abastecimiento', 'mantenimiento']);
  });
  it('un módulo que no existe se rechaza', () => {
    expect(() => componentesParaModulos(['inventado'])).toThrow();
  });
  it('cada módulo declara un componente que existe y que tiene migraciones', () => {
    for (const m of MODULOS) expect(migracionesDe([m.componente]).length, m.id).toBeGreaterThan(0);
  });
  it('los archivos empaquetados son exactamente los de supabase/componentes, en orden base → abastecimiento → mantenimiento', () => {
    const raiz = join(import.meta.dirname, '..', '..', 'supabase', 'componentes');
    const esperados = ['base', 'abastecimiento', 'mantenimiento'].flatMap(c => readdirSync(join(raiz, c)).filter(f => f.endsWith('.sql')).sort().map(f => `${c}/${f}`));
    expect(MIGRACIONES.map(m => m.nombre)).toEqual(esperados);
  });
});

describe('el registro de antes de los componentes cuenta como instalación completa', () => {
  const originales = readdirSync(join(import.meta.dirname, '..', '..', 'supabase', 'migrations')).filter(f => f.endsWith('.sql'));
  it('se reconocen los tres componentes y quedan hechas solo las migraciones originales', () => {
    expect(componentesInstalados(originales)).toEqual(['base', 'abastecimiento', 'mantenimiento']);
    const hechas = expandirRegistro(originales);
    const pendientes = MIGRACIONES.filter(m => !hechas.has(m.nombre)).map(m => m.nombre.split('/')[1]!.slice(0, 14));
    expect(pendientes.length).toBeGreaterThan(0);
    expect(pendientes.every(v => v > '20260101001000')).toBe(true); // lo pendiente es solo lo agregado después de congelar la cadena original
  });
  it('un registro vacío no instala nada por deducción', () => {
    expect(componentesInstalados([])).toEqual([]);
  });
});

describe('planes sobre un cliente real (simulado)', () => {
  let m: Mundo; let n: Navegador; let a: Autenticador;
  beforeEach(async () => { m = await crearMundo(); ({ n, a } = await m.conSesion()); });
  afterEach(() => {
    expect(llamadasFueraDeLista(m.falso.llamadas)).toEqual([]);
    expect(m.falso.llamadas.some(l => l.metodo === 'DELETE')).toBe(false);
  });
  const instalarEnSimulador = (nombre: string, modulos: string[], comps: string[]) => m.falso.proyectoInstalado(nombre, modulos, comps);

  it('crear un cliente que solo contrata Tareas instala únicamente la Base', async () => {
    const r = await n.hacer('crear', { nombre: 'Solo Tareas', correo: 'a@b.com', modulos: ['tareas'] }, a);
    expect(r.plan.cuerpo.resumen.lineas.join(' ')).toContain('Se instala: Base');
    expect(r.plan.cuerpo.resumen.lineas.join(' ')).not.toContain('Abastecimiento');
    expect(r.pasos.at(-1)!.cuerpo.estado).toBe('terminado');
    const p = [...m.falso.proyectos.values()].find(x => x.nombre === 'solo-tareas')!;
    expect([...p.registro!].every(x => x.startsWith('base/'))).toBe(true);
    expect(p.registro!.size).toBe(migracionesDe(['base']).length);
  });

  it('crear con Mantenimiento instala los tres componentes', async () => {
    const r = await n.hacer('crear', { nombre: 'Completo', correo: 'a@b.com', modulos: ['mantenimiento', 'deposito', 'proveedores'] }, a);
    expect(r.pasos.at(-1)!.cuerpo.estado).toBe('terminado');
    const p = [...m.falso.proyectos.values()].find(x => x.nombre === 'completo')!;
    expect(p.registro).toEqual(new Set(MIGRACIONES.map(x => x.nombre)));
  });

  it('un plan de "crear" lista pasos solo de los componentes elegidos', async () => {
    const r = await n.plan('crear', { nombre: 'Solo Tareas', correo: 'a@b.com', modulos: ['tareas'] });
    const ids = (r.cuerpo.pasos as { id: string }[]).map(p => p.id).filter(id => id.startsWith('migracion:'));
    expect(ids).toEqual(migracionesDe(['base']).map(x => `migracion:${x.nombre}`));
  });

  it('instalar Mantenimiento en un cliente que ya tiene Base + Abastecimiento: se agrega sin tocar lo anterior', async () => {
    const p = instalarEnSimulador('cliente-a', ['deposito'], ['base', 'abastecimiento']);
    const antes = new Set(p.registro);
    const r = await n.hacer('componente', { ref: p.ref, componente: 'mantenimiento' }, a);
    expect(r.plan.cuerpo.resumen.lineas.join(' ')).toContain('APAGADOS');
    expect(r.pasos.at(-1)!.cuerpo.estado).toBe('terminado');
    expect(p.registro).toEqual(new Set(MIGRACIONES.map(x => x.nombre)));
    // Lo que ya estaba no se volvió a ejecutar.
    for (const nombre of antes) {
      const mig = MIGRACIONES.find(x => x.nombre === nombre)!;
      expect(m.falso.sqlEjecutado.filter(q => q.ref === p.ref && q.sql.startsWith(mig.sql)).length, nombre).toBe(0);
    }
    // Los módulos del componente nuevo siguen apagados: eso se decide aparte.
    expect(p.licencia.mantenimiento).toBeFalsy();
  });

  it('no se instala dos veces, ni sin sus requisitos, ni la Base, ni algo inventado', async () => {
    const completo = instalarEnSimulador('cliente-completo', ['deposito'], ['base', 'abastecimiento', 'mantenimiento']);
    const soloBase = instalarEnSimulador('cliente-base', ['tareas'], ['base']);
    const ya = await n.plan('componente', { ref: completo.ref, componente: 'mantenimiento' });
    expect(ya.estado).toBe(400); expect(ya.cuerpo.error ?? ya.cuerpo.codigo).toMatch(/ya_instalado/);
    const sinReq = await n.plan('componente', { ref: soloBase.ref, componente: 'mantenimiento' });
    expect(sinReq.estado).toBe(400); expect(sinReq.cuerpo.error ?? sinReq.cuerpo.codigo).toMatch(/requisitos/);
    expect((await n.plan('componente', { ref: soloBase.ref, componente: 'base' })).estado).toBe(400);
    expect((await n.plan('componente', { ref: soloBase.ref, componente: 'inventado' })).estado).toBe(400);
    expect((await n.plan('componente', { ref: soloBase.ref })).estado).toBe(400);
    expect((await n.plan('componente', { ref: soloBase.ref, componente: 'abastecimiento', extra: 1 })).estado).toBe(400);
  });

  it('el cliente que cambió mientras tanto: al ejecutar se vuelve a comprobar el requisito', async () => {
    const p = instalarEnSimulador('cliente-b', ['deposito'], ['base', 'abastecimiento']);
    const r = await n.plan('componente', { ref: p.ref, componente: 'mantenimiento' });
    await n.firmar(r.cuerpo.id, r.cuerpo.opciones, a);
    p.registro = new Set(MIGRACIONES.filter(x => x.componente === 'base').map(x => x.nombre)); // alguien lo cambió: ya no tiene Abastecimiento
    const pasos = await n.correr(r.cuerpo.id);
    expect(pasos.at(-1)!.cuerpo.resultado).toBe('fallo');
    expect(pasos.at(-1)!.cuerpo.mensaje).toMatch(/Falta instalar antes/);
    expect([...p.registro].some(x => x.startsWith('mantenimiento/'))).toBe(false);
  });

  it('no se puede activar un módulo cuyo componente no está instalado (pero sí los de la Base)', async () => {
    const p = instalarEnSimulador('cliente-c', [], ['base']);
    const mal = await n.plan('modulos', { ref: p.ref, activar: ['deposito'] });
    expect(mal.estado).toBe(400); expect(mal.cuerpo.error ?? mal.cuerpo.codigo).toMatch(/componente/);
    const bien = await n.plan('modulos', { ref: p.ref, activar: ['tareas'] });
    expect(bien.estado).toBe(201);
  });

  it('actualizar un cliente "de antes" (registro viejo): solo falta lo agregado después, en todos los componentes', async () => {
    const p = m.falso.proyectoInstalado('cliente-viejo', ['deposito']);
    p.registro = new Set(readdirSync(join(import.meta.dirname, '..', '..', 'supabase', 'migrations')).filter(f => f.endsWith('.sql')));
    const r = await n.hacer('actualizar', { ref: p.ref }, a);
    expect(r.plan.cuerpo.resumen.lineas.join(' ')).toContain('Base + Abastecimiento + Mantenimiento');
    expect(r.pasos.at(-1)!.cuerpo.estado).toBe('terminado');
    // Se aplicó lo nuevo de cada componente y nada de lo viejo.
    for (const mig of MIGRACIONES) {
      const veces = m.falso.sqlEjecutado.filter(q => q.ref === p.ref && q.sql.startsWith(mig.sql)).length;
      expect(veces, mig.nombre).toBe(mig.nombre.split('/')[1]! <= '20260101001000_zzz' ? 0 : 1);
    }
  });

  it('el detalle del cliente informa qué tiene instalado y qué se le puede agregar', async () => {
    const p = instalarEnSimulador('cliente-d', ['deposito'], ['base', 'abastecimiento']);
    const r = await n.get(`/api/clientes/${p.ref}`);
    expect(r.cuerpo.detalle.componentes.instalados.map((x: { id: string }) => x.id)).toEqual(['base', 'abastecimiento']);
    expect(r.cuerpo.detalle.componentes.instalables.map((x: { id: string }) => x.id)).toEqual(['mantenimiento']);
    const base = instalarEnSimulador('cliente-e', [], ['base']);
    const r2 = await n.get(`/api/clientes/${base.ref}`);
    expect(r2.cuerpo.detalle.componentes.instalables.map((x: { id: string }) => x.id)).toEqual(['abastecimiento']); // Mantenimiento todavía no: le falta Abastecimiento
  });
});
