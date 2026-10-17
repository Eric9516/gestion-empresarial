import { describe, expect, it } from 'vitest';
import { leerPreferencias } from './preferencias';

describe('leerPreferencias', () => {
  it('toma la posición del menú y si queda fijo', () => {
    expect(leerPreferencias({ menu_posicion: 'abajo', menu_fijo: true })).toEqual({ menu_posicion: 'abajo', menu_fijo: true });
  });

  it('descarta lo inválido sin romper', () => {
    expect(leerPreferencias({ menu_posicion: 'derecha', menu_fijo: 'sí', otra: 1 })).toEqual({});
    expect(leerPreferencias(null)).toEqual({});
    expect(leerPreferencias('arriba')).toEqual({});
    expect(leerPreferencias([1, 2])).toEqual({});
  });
});
