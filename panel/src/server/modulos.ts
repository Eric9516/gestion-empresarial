import { MODULOS } from './generado.ts';

export const IDS_MODULOS: string[] = MODULOS.map(m => m.id);
export type EstadoModulos = Record<string, boolean>;

export const nombreModulo = (id: string): string => MODULOS.find(m => m.id === id)?.nombre ?? id;

export function estadoDesdeLista(activos: string[]): EstadoModulos {
  return Object.fromEntries(IDS_MODULOS.map(id => [id, activos.includes(id)]));
}

// Cada módulo activo necesita que estén activos los que requiere. Devuelve los problemas (vacío si está bien).
export function problemasDeDependencias(estado: EstadoModulos): string[] {
  const errores: string[] = [];
  for (const m of MODULOS) {
    if (!estado[m.id]) continue;
    for (const r of m.requiere) if (!estado[r]) errores.push(`"${m.nombre}" necesita "${nombreModulo(r)}", que quedaría apagado.`);
  }
  return errores;
}

// Solo cuenta como activo lo que la licencia dice de forma expresa (igual que la base de datos del cliente).
export function normalizarLicencia(crudo: unknown): EstadoModulos {
  const obj = (crudo && typeof crudo === 'object' ? crudo : {}) as Record<string, unknown>;
  return Object.fromEntries(IDS_MODULOS.map(id => [id, obj[id] === true]));
}
