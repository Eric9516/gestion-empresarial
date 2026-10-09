import { describe, expect, it } from 'vitest';
import { MODULOS, efectivos, hayModulosDeDirectorio, integraciones, normalizarModulos, type Modulos } from './modulos';

const todos = (): Modulos => normalizarModulos({});

describe('normalizarModulos', () => {
  it('todo activo cuando no hay nada guardado o el dato es inválido', () => {
    for (const v of [undefined, null, {}, [], 'x', 5]) {
      const m = normalizarModulos(v);
      expect(MODULOS.every(mod => m[mod.id] === true)).toBe(true);
    }
  });

  it('solo se apaga lo que dice false de forma explícita', () => {
    const m = normalizarModulos({ proveedores: false, tareas: 0, comisionistas: null, envios: 'no' });
    expect(m.proveedores).toBe(false);
    expect(m.tareas).toBe(true);
    expect(m.comisionistas).toBe(true);
    expect(m.envios).toBe(true);
  });

  it('ignora claves desconocidas y devuelve siempre todas las conocidas', () => {
    const m = normalizarModulos({ inventado: false, deposito: false });
    expect(Object.keys(m).sort()).toEqual(MODULOS.map(x => x.id).sort());
    expect(m.deposito).toBe(false);
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
