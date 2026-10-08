import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabaseClient';
import { fetchUsuariosPorIds, nombreUsuario } from '../../lib/usuarios';

export interface HistorialItemFila {
  id: string;
  cantidad: number;
  observacion: string | null;
  created_at: string;
  usuarioNombre: string;
  sector: string | null;
}

// Historial de retiros de un repuesto puntual, para responder "¿quién se
// llevó esto, cuándo y de qué sector?" al hacer click en el stock del ítem.
// Usa el RPC historial_retiros_por_item en vez de una consulta directa a
// retiro_items: cualquier usuario de Mantenimiento (común o admin) puede ver
// el historial de UN ítem puntual, aunque no tenga el permiso general de "ver
// todos los retiros" que sigue restringiendo la pantalla "Mis retiros".
export function useHistorialPorItem(itemId: string | null) {
  return useQuery({
    queryKey: ['historial-por-item', itemId],
    enabled: !!itemId,
    queryFn: async (): Promise<HistorialItemFila[]> => {
      const { data, error } = await supabase.rpc('historial_retiros_por_item', { p_item_id: itemId as string });
      if (error) throw error;

      const filas = data ?? [];
      const usuarios = await fetchUsuariosPorIds(filas.map(f => f.usuario_id));

      return filas.map(f => ({
        id: f.id,
        cantidad: f.cantidad,
        observacion: f.observacion,
        created_at: f.created_at,
        usuarioNombre: nombreUsuario(usuarios[f.usuario_id], f.usuario_id),
        sector: f.sector,
      }));
    },
  });
}
