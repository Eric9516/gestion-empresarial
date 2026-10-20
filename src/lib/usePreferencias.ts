import { useCallback, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { LETRA_PDF_POR_DEFECTO, leerPreferencias, type LetraPdf, type PreferenciasPantalla } from './preferencias';

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

/** Las preferencias de pantalla de la persona (las de su perfil mandan) y cómo guardar una. Las usan el menú, la letra de los PDF, etc. */
export function usePreferencias() {
  const { profile, guardarPreferencias } = useAuth();
  const [local, setLocal] = useState(leerLocal);
  const preferencias: PreferenciasPantalla = { ...local, ...leerPreferencias(profile?.preferencias) };

  const guardar = useCallback((cambios: PreferenciasPantalla) => {
    setLocal(prev => { const nuevo = { ...prev, ...cambios }; escribirLocal(nuevo); return nuevo; });
    guardarPreferencias(cambios).catch(e => console.warn('No se pudo guardar la preferencia en el perfil; queda en este navegador.', e));
  }, [guardarPreferencias]);

  return { preferencias, guardar };
}

/** El tamaño de letra que la persona eligió para los PDF con tablas. */
export function useLetraPdf(): [LetraPdf, (l: LetraPdf) => void] {
  const { preferencias, guardar } = usePreferencias();
  const cambiar = useCallback((l: LetraPdf) => guardar({ pdf_letra: l }), [guardar]);
  return [preferencias.pdf_letra ?? LETRA_PDF_POR_DEFECTO, cambiar];
}
