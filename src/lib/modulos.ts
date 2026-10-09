// Módulos que cada empresa puede tener. Los define quien vende (no el cliente) con el comando
// "pnpm cliente modulos", y quedan guardados en la tabla "licencia", que ningún usuario puede escribir.
// Un módulo apagado queda bloqueado en la base de datos para todos; acá solo se oculta lo que ya no
// se puede usar. La lista y sus dependencias están en modulos.json, que también lee el comando.

import datos from './modulos.json';

export type ModuloId = 'proveedores' | 'comisionistas' | 'envios' | 'deposito' | 'tareas';
export type Modulos = Record<ModuloId, boolean>;

export interface ModuloInfo {
  id: ModuloId;
  nombre: string;
  descripcion: string;
  // Módulos sin los cuales este no puede funcionar
  requiere: ModuloId[];
  // Qué queda bloqueado al apagarlo (lo muestra el comando que cambia la licencia)
  bloquea: string;
}

export const MODULOS = datos.modulos as ModuloInfo[];

// Un módulo está activo SOLO si la licencia lo dice de forma expresa. Lo que no figura cuenta como apagado:
// así un módulo nuevo que se agregue al sistema no llega a ningún cliente hasta que se le active.
// (La base de datos usa la misma regla en modulo_activo().)
export function normalizarModulos(valor: unknown): Modulos {
  const guardado = valor && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
  return Object.fromEntries(MODULOS.map(m => [m.id, guardado[m.id] === true])) as Modulos;
}

// Cuando la licencia todavía no se pudo leer, la pantalla no oculta nada: lo que protege es la base de datos.
export const TODOS_ACTIVOS: Modulos = Object.fromEntries(MODULOS.map(m => [m.id, true])) as Modulos;

// Un módulo solo funciona si también están activos los que necesita.
export function efectivos(m: Modulos): Modulos {
  const e = { ...m };
  // Se repite hasta que no cambie nada (una cadena de dependencias se apaga entera).
  for (let cambio = true; cambio;) {
    cambio = false;
    for (const mod of MODULOS) {
      if (e[mod.id] && mod.requiere.some(r => !e[r])) { e[mod.id] = false; cambio = true; }
    }
  }
  return e;
}

// Funciones que existen solo cuando dos módulos están activos a la vez.
export function integraciones(m: Modulos) {
  const e = efectivos(m);
  return {
    // Reparaciones y proveedores por repuesto: salen del Depósito y necesitan un proveedor.
    depositoConProveedores: e.deposito && e.proveedores,
    // Elegir un comisionista al armar un envío.
    enviosConComisionistas: e.envios && e.comisionistas,
  };
}

// ¿Queda alguna pestaña en la pantalla del Directorio?
export function hayModulosDeDirectorio(m: Modulos): boolean {
  const e = efectivos(m);
  return e.proveedores || e.comisionistas || e.envios || e.tareas;
}
