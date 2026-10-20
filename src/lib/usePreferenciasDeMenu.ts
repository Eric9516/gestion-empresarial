import { useCallback } from 'react';
import type { PosicionMenu } from './preferencias';
import { usePreferencias } from './usePreferencias';

/** Dónde va el menú en la computadora y si queda fijo. Es de cada persona: se guarda en su perfil y la sigue a cualquier computadora. */
export function usePreferenciasDeMenu() {
  const { preferencias, guardar } = usePreferencias();
  const posicion: PosicionMenu = preferencias.menu_posicion ?? 'lateral';
  const fijo = preferencias.menu_fijo ?? false;
  return {
    posicion,
    fijo,
    cambiarPosicion: useCallback((p: PosicionMenu) => guardar({ menu_posicion: p }), [guardar]),
    alternarFijo: useCallback(() => guardar({ menu_fijo: !fijo }), [guardar, fijo]),
  };
}

/** Las clases de la pantalla según dónde está el menú (para que el contenido le deje lugar). */
export function clasesDelMenu(posicion: PosicionMenu, fijo: boolean): string {
  return `con-menu menu-en-${posicion}${posicion === 'lateral' && fijo ? ' menu-fijo' : ''}`;
}
