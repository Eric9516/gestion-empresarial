import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabaseClient';
import { efectivos, integraciones, normalizarModulos } from '../../lib/modulos';

// Módulos activos de esta instalación, según la licencia (que solo puede cambiar quien vende, por
// el comando "pnpm cliente modulos"). `modulos` ya descuenta los que no pueden funcionar porque
// les falta uno que necesitan, e `integ` dice qué funciones cruzadas existen. `listo` es falso solo
// mientras se carga por primera vez: las pantallas esperan para no mostrar pestañas que desaparecen.
export function useModulos() {
  const { data, isLoading } = useQuery({
    queryKey: ['licencia'],
    queryFn: async () => {
      const { data: fila, error } = await supabase.from('licencia').select('modulos').eq('id', 1).maybeSingle();
      if (error) throw error;
      return fila?.modulos ?? null;
    },
    staleTime: 60_000,
    // Se vuelve a leer cada minuto: un cambio de licencia llega a las pantallas abiertas sin recargar.
    refetchInterval: 60_000,
  });
  const modulos = useMemo(() => efectivos(normalizarModulos(data)), [data]);
  const integ = useMemo(() => integraciones(modulos), [modulos]);
  return { modulos, integ, listo: !isLoading };
}
