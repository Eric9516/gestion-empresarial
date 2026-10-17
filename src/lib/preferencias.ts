// Preferencias de pantalla de cada persona: se guardan en su perfil (usuarios_perfil.preferencias) y la base valida los valores.

export type PosicionMenu = 'lateral' | 'arriba' | 'abajo';

export const POSICIONES_MENU: { id: PosicionMenu; nombre: string }[] = [
  { id: 'lateral', nombre: 'Menú a la izquierda' },
  { id: 'arriba', nombre: 'Menú arriba' },
  { id: 'abajo', nombre: 'Menú abajo' },
];

export interface PreferenciasPantalla {
  menu_posicion?: PosicionMenu;
  menu_fijo?: boolean;
}

// Lee lo que venga (de la base o del navegador) y se queda solo con lo válido: un dato raro no rompe la pantalla.
export function leerPreferencias(valor: unknown): PreferenciasPantalla {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return {};
  const v = valor as Record<string, unknown>;
  const p: PreferenciasPantalla = {};
  if (POSICIONES_MENU.some(x => x.id === v.menu_posicion)) p.menu_posicion = v.menu_posicion as PosicionMenu;
  if (typeof v.menu_fijo === 'boolean') p.menu_fijo = v.menu_fijo;
  return p;
}
