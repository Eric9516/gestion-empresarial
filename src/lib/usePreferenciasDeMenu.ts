import { useCallback, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { leerPreferencias, type PosicionMenu, type PreferenciasPantalla } from './preferencias';

// Copia en el navegador: sirve mientras la base no tenga el campo (o si falla la red) y trae el "Dejar fijo" de antes.
const CLAVE_LOCAL = 'preferencias-pantalla';
const CLAVE_FIJO_VIEJA = 'menu-lateral-fijo';

function leerLocal(): PreferenciasPantalla {
  try {
    const p = leerPreferencias(JSON.parse(localStorage.getItem(CLAVE_LOCAL) ?? '{}'));
    if (p.menu_fijo === undefined && localStorage.getItem(CLAVE_FIJO_VIEJA) !== null) p.menu_fijo = localStorage.getItem(CLAVE_FIJO_VIEJA) === '1';
    return p;
  } catch { return {}; }
}

function escribirLocal(p: PreferenciasPantalla) {
  try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify(p)); } catch { /* sin almacenamiento: queda en el perfil o solo en esta visita */ }
}

/** Dónde va el menú en la computadora y si queda fijo. Es de cada persona: se guarda en su perfil y la sigue a cualquier computadora. */
export function usePreferenciasDeMenu() {
  const { profile, guardarPreferencias } = useAuth();
  const [local, setLocal] = useState(leerLocal);
  const enPerfil = leerPreferencias(profile?.preferencias);
  const posicion: PosicionMenu = enPerfil.menu_posicion ?? local.menu_posicion ?? 'lateral';
  const fijo = enPerfil.menu_fijo ?? local.menu_fijo ?? false;

  const guardar = useCallback((cambios: PreferenciasPantalla) => {
    setLocal(prev => { const nuevo = { ...prev, ...cambios }; escribirLocal(nuevo); return nuevo; });
    guardarPreferencias(cambios).catch(e => console.warn('No se pudo guardar la preferencia en el perfil; queda en este navegador.', e));
  }, [guardarPreferencias]);

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
