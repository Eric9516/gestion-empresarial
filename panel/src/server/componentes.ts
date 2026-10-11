// Componentes del producto (Base, Abastecimiento, Mantenimiento): cuáles hay que instalar para los módulos que contrata un cliente
// y cuáles ya tiene instalados. Es la misma lógica que usa el instalador de la plantilla (scripts/herramientas/componentes.mjs);
// una prueba vigila que las dos den siempre el mismo resultado.
import { MIGRACIONES, MODULOS } from './generado.ts';

export const ORDEN_COMPONENTES = ['base', 'abastecimiento', 'mantenimiento'] as const;
export type Componente = (typeof ORDEN_COMPONENTES)[number];

export const NECESITA: Record<Componente, Componente[]> = { base: [], abastecimiento: ['base'], mantenimiento: ['base', 'abastecimiento'] };

export const NOMBRE_COMPONENTE: Record<Componente, string> = { base: 'Base', abastecimiento: 'Abastecimiento', mantenimiento: 'Mantenimiento' };

export const esComponente = (v: unknown): v is Componente => typeof v === 'string' && (ORDEN_COMPONENTES as readonly string[]).includes(v);

const ordenar = (set: Set<string>): Componente[] => ORDEN_COMPONENTES.filter(c => set.has(c));

/** Componentes a instalar para una lista de módulos (ids). */
export function componentesParaModulos(ids: string[]): Componente[] {
  const vistos = new Set<string>();
  const visitar = (id: string): void => {
    if (vistos.has(id)) return;
    const m = MODULOS.find(x => x.id === id);
    if (!m) throw new Error(`Módulo desconocido: ${id}`);
    vistos.add(id);
    m.requiere.forEach(visitar);
  };
  ids.forEach(visitar);
  const comps = new Set<string>(['base']);
  for (const id of vistos) {
    const c = MODULOS.find(x => x.id === id)!.componente as Componente;
    for (const x of [c, ...NECESITA[c]]) comps.add(x);
  }
  return ordenar(comps);
}

/** Lo que falta instalar antes de poder instalar `componente`. */
export const faltantesPara = (componente: Componente, instalados: readonly string[]): Componente[] => NECESITA[componente].filter(c => !instalados.includes(c));

/** Migraciones del registro del cliente, con las de antes de existir los componentes ("archivo.sql") expandidas a "componente/archivo.sql". */
export function expandirRegistro(registrados: string[], disponibles: string[] = MIGRACIONES.map(m => m.nombre)): Set<string> {
  const hechas = new Set(registrados.filter(n => n.includes('/')));
  for (const n of registrados.filter(x => !x.includes('/'))) for (const d of disponibles) if (d.endsWith('/' + n)) hechas.add(d);
  return hechas;
}

/** Componentes instalados según el registro (un registro de antes de los componentes viene de una instalación completa). */
export function componentesInstalados(registrados: string[]): Componente[] {
  const comps = new Set<string>();
  for (const n of registrados) {
    if (!n.includes('/')) ORDEN_COMPONENTES.forEach(c => comps.add(c));
    else { const c = n.split('/')[0]!; if (esComponente(c)) comps.add(c); }
  }
  if (comps.size) comps.add('base');
  return ordenar(comps);
}

/** Migraciones empaquetadas de los componentes pedidos, en el orden en que se aplican. */
export const migracionesDe = (componentes: readonly string[]) => MIGRACIONES.filter(m => componentes.includes(m.componente));

/** Etiqueta legible de una migración para mostrar en los pasos. */
export const etiquetaMigracion = (m: { nombre: string; componente: string }): string =>
  `Base de datos (${NOMBRE_COMPONENTE[m.componente as Componente] ?? m.componente}): ${m.nombre.split('/').pop()!.replace(/\.sql$/, '').replace(/^\d+_/, '').replaceAll('_', ' ')}`;
