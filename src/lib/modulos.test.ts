import { describe, expect, it } from 'vitest';
import { MODULOS, TODOS_ACTIVOS, efectivos, hayModulosDeDirectorio, integraciones, normalizarModulos, type Modulos } from './modulos';

const todos = (): Modulos => ({ ...TODOS_ACTIVOS });

describe('normalizarModulos (lo que no figura expresamente activo, está apagado)', () => {
  it('sin licencia o con un dato inválido no hay ningún módulo activo', () => {
    for (const v of [undefined, null, {}, [], 'x', 5]) {
      const m = normalizarModulos(v);
      expect(MODULOS.every(mod => m[mod.id] === false)).toBe(true);
    }
  });

  it('solo cuenta como activo lo que dice true de forma expresa', () => {
    const m = normalizarModulos({ proveedores: true, tareas: 1, comisionistas: 'si', envios: null, deposito: false });
    expect(m.proveedores).toBe(true);
    expect(m.tareas).toBe(false);
    expect(m.comisionistas).toBe(false);
    expect(m.envios).toBe(false);
    expect(m.deposito).toBe(false);
  });

  it('un módulo nuevo que no está en la licencia nace apagado', () => {
    // Una licencia de antes de que existiera un módulo: lista solo los que tenía.
    const licenciaVieja = Object.fromEntries(MODULOS.slice(0, -1).map(m => [m.id, true]));
    const m = normalizarModulos(licenciaVieja);
    expect(m[MODULOS.at(-1)!.id]).toBe(false);
    expect(MODULOS.slice(0, -1).every(mod => m[mod.id] === true)).toBe(true);
  });

  it('ignora claves desconocidas y devuelve siempre todas las conocidas', () => {
    const m = normalizarModulos({ inventado: true, deposito: true });
    expect(Object.keys(m).sort()).toEqual(MODULOS.map(x => x.id).sort());
    expect(m.deposito).toBe(true);
    expect(Object.keys(m).includes('inventado')).toBe(false);
  });
});

describe('TODOS_ACTIVOS', () => {
  it('es lo que se usa solo mientras la licencia no se pudo leer, y tiene todos los módulos', () => {
    expect(MODULOS.every(m => TODOS_ACTIVOS[m.id] === true)).toBe(true);
  });
});

describe('módulos.json', () => {
  it('cada dependencia apunta a un módulo que existe y ninguno se requiere a sí mismo', () => {
    const ids = new Set(MODULOS.map(m => m.id));
    for (const m of MODULOS) {
      expect(m.requiere.every(r => ids.has(r) && r !== m.id)).toBe(true);
    }
  });
});

describe('efectivos', () => {
  it('Envíos se apaga solo si falta Proveedores', () => {
    const m = efectivos({ ...todos(), proveedores: false });
    expect(m.envios).toBe(false);
    expect(m.deposito).toBe(true);
    expect(m.tareas).toBe(true);
  });
  it('no cambia nada si las dependencias están completas', () => {
    expect(efectivos(todos())).toEqual(todos());
  });
});

describe('integraciones', () => {
  it('reparaciones y proveedores por repuesto necesitan Depósito y Proveedores', () => {
    expect(integraciones(todos()).depositoConProveedores).toBe(true);
    expect(integraciones({ ...todos(), proveedores: false }).depositoConProveedores).toBe(false);
    expect(integraciones({ ...todos(), deposito: false }).depositoConProveedores).toBe(false);
  });
  it('elegir comisionista en un envío necesita Envíos y Comisionistas', () => {
    expect(integraciones(todos()).enviosConComisionistas).toBe(true);
    expect(integraciones({ ...todos(), comisionistas: false }).enviosConComisionistas).toBe(false);
    expect(integraciones({ ...todos(), envios: false }).enviosConComisionistas).toBe(false);
  });
});

describe('hayModulosDeDirectorio', () => {
  it('es falso solo si los cuatro módulos del Directorio están apagados', () => {
    const apagado = { proveedores: false, comisionistas: false, envios: false, tareas: false, deposito: true };
    expect(hayModulosDeDirectorio(apagado)).toBe(false);
    expect(hayModulosDeDirectorio({ ...apagado, tareas: true })).toBe(true);
    expect(hayModulosDeDirectorio({ ...apagado, comisionistas: true })).toBe(true);
  });
  it('Envíos sin Proveedores no cuenta (no puede funcionar)', () => {
    expect(hayModulosDeDirectorio({ proveedores: false, comisionistas: false, envios: true, tareas: false, deposito: true })).toBe(false);
  });
});
